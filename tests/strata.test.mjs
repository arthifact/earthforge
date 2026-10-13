import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { unitAt } from '../validation/numerics/metrics.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const bundle = await build({ stdin: { contents: 'export * from "./src/strata.ts"; export * from "./src/normalTransport.ts"; export * from "./src/basin.ts"; export * from "./src/sedimentBudget.ts"; export {compactedThickness, invalidStateCells, cutoffs} from "./src/basinVerify.ts";', resolveDir: root }, bundle: true, platform: 'node', format: 'esm', write: false });
const { cutoffs, remapNormal, compactColumn, depositedLayer, emptyLayer, portion, packColumn, sliceColumn, rasterize, columnsFromRaster, cellLayers,
  expectedInventory, porosity, effectiveDepth, compactedThickness, inventoryOf, remapThrust, BASIN_DEFAULTS, simulate, windowOf, layerVelocity, invalidStateCells } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
const near = (a, b, tol = 1e-8) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b} (${tol})`);
const physics = { porosity, effectiveDepth };
const beds = [{ unit: 0, carbonate: false }, { unit: 1, carbonate: true }, { unit: 2, carbonate: false }];
const bed = (id, height, solid, fraction = 0.4) => ({ bed: id, height, solid, fraction, burial: 0, loading: 0, offsetX: 0, offsetZ: 0 });
const inventory = (columns, h = 20) => inventoryOf({ columns, beds, h });
const componentsEqual = (a, b, tol = 1e-7) => {
  for (const k of ['total', 'sand', 'shale', 'carbonate']) near(a[k], b[k], tol);
  for (let j = 0; j < Math.max(a.byBed.length, b.byBed.length); j++) {
    near(a.byBed[j] ?? 0, b.byBed[j] ?? 0, tol);
    for (const k of ['sand', 'shale', 'carbonate']) near(a.byBedComponents[k][j] ?? 0, b.byBedComponents[k][j] ?? 0, tol);
  }
};

test('sub-millimetre beds and mixed carbonate/clastic contacts survive every raster round trip', () => {
  const original = [[emptyLayer(-1, 7.25), bed(0, 0.0001, 0.00004, 1), bed(1, 2.125, 0.85, 0), bed(2, 3.875, 1.55, 0), emptyLayer(-2, 186.7499)]];
  for (const h of [40, 20, 10]) {
    const state = { ...rasterize(original, 200 / h, h), beds, h };
    const restored = columnsFromRaster(state, 1, 200 / h, h);
    componentsEqual(inventory(original, h), inventoryOf(state)); componentsEqual(inventory(original, h), inventory(restored, h));
    for (const id of [0, 1, 2]) near(restored[0].filter(p => p.bed === id).reduce((s, p) => s + p.height, 0), original[0].find(p => p.bed === id).height);
    assert.equal(restored[0].filter(p => p.bed >= 0).length >= 3, true);
  }
});

test('continuous compaction has no cell floor and keeps bulk pore volume consistent', () => {
  const constant = { effectiveDepth: d => Math.max(0, d), porosity: () => 0.25 };
  const column = [emptyLayer(-1, 10), bed(0, 3, 0.75), bed(1, 0.4, 0.15, 0), emptyLayer(-2, 86.6)];
  const before = structuredClone(column), out = compactColumn(column, beds, null, constant).column;
  assert.deepEqual(column, before); componentsEqual(inventory([column]), inventory([out]));
  near(out.find(p => p.bed === 0).height, 1, 1e-9); near(out.find(p => p.bed === 1).height, 0.2, 1e-9);
  for (const p of out.filter(p => p.bed >= 0)) near(1 - p.solid / p.height, 0.25, 1e-9);
});

test('continuous column agrees with independent integrated porosity law and bed subdivision', () => {
  for (const [fraction, carbonate] of [[0, false], [1, false], [0, true]]) {
    const localBeds = [{ carbonate }, { carbonate }];
    const grains = depositedLayer(0, 500, fraction, carbonate, 0, null, physics);
    const S = grains.reduce((s, p) => s + p.solid, 0), overburden = emptyLayer(-2, 1000);
    const column = [emptyLayer(-1, 100), overburden, ...grains, emptyLayer(-2, 400)];
    const a = compactColumn(column, localBeds, null, physics).column;
    const thickness = a.filter(p => p.bed === 0).reduce((s, p) => s + p.height, 0);
    near(thickness, compactedThickness(S, 1000, fraction, carbonate), 0.02);
    const split = grains.flatMap((p, j) => [{ ...portion(p, p.height / 2), bed: j % 2 }, { ...portion(p, p.height / 2), bed: (j + 1) % 2 }]);
    const b = compactColumn([emptyLayer(-1, 100), overburden, ...split, emptyLayer(-2, 400)], localBeds, null, physics).column;
    near(thickness, b.filter(p => p.bed >= 0).reduce((s, p) => s + p.height, 0), 0.02);
    near(S, b.filter(p => p.bed >= 0).reduce((s, p) => s + p.solid, 0), 1e-9);
  }
});

test('material quadrature refines toward the analytical column independently of display cells', () => {
  for (const [fraction, carbonate] of [[0, false], [1, false], [0, true]]) {
    const exact = compactedThickness(200, 1000, fraction, carbonate), errors = [];
    for (const step of [40, 20, 10, 5]) {
      const n = Math.ceil(500 / step), parts = Array.from({ length: n }, () => bed(0, 500 / n, 200 / n, fraction));
      const col = [emptyLayer(-1, 100), emptyLayer(-2, 1000), ...parts, emptyLayer(-2, 400)];
      const result = compactColumn(col, [{ carbonate }], null, physics).column;
      const actual = result.filter(p => p.bed === 0).reduce((s, p) => s + p.height, 0);
      errors.push(Math.abs(actual - exact));
    }
    assert.ok(errors[3] < errors[2] && errors[2] < errors[1] && errors[1] < errors[0]);
    assert.ok(errors[2] < 0.02, JSON.stringify(errors));
  }
});

test('erosion, clipping and unloading preserve retained thin-bed state and never expand grains', () => {
  const p = { ...bed(0, 2, 1.2, 0.75), burial: 2000, loading: 1500, offsetX: 4, offsetZ: -2 };
  const col = [emptyLayer(-1, 10), p, bed(1, 1, 0.6, 0), emptyLayer(-2, 87)];
  const kept = sliceColumn(col, 11.75, 100), lost = sliceColumn(col, 0, 11.75);
  componentsEqual(inventory([col]), inventory([[...lost, ...kept]]));
  const remnant = kept[0]; near(remnant.height, 0.25); near(remnant.solid, 0.15);
  assert.equal(remnant.burial, 2000); assert.equal(remnant.loading, 1500); assert.equal(remnant.fraction, 0.75);
  const out = compactColumn([emptyLayer(-1, 11.75), ...kept], beds, 800, physics).column;
  const r = out.find(p => p.bed === 0); assert.ok(r.height <= remnant.height + 1e-10);
  assert.equal(r.burial, 2000); assert.equal(r.loading, 1500);
});

test('packing a physical overhang retains subcell material volume and the numerical-offset correction', () => {
  const col = [emptyLayer(-1, 10), bed(0, 0.25, 0.1), emptyLayer(-1, 2), bed(1, 0.5, 0.2, 0), emptyLayer(-2, 87.25)];
  const packed = packColumn(col, () => 2);
  near(packed.gaps, 2); near(packed.column[0].height, 12);
  near(packed.column.find(p => p.bed === 0).offsetZ, -2);
  componentsEqual(inventory([col]), inventory([packed.column]));
});

test('thrust transport retains all subcell bed constituents and independently counted boundary flux', () => {
  for (const h of [40, 20, 10]) for (const dir of [-1, 1]) {
    const nx = 9, nz = 8, col = [emptyLayer(-1, h / 3), bed(0, h / 10, h / 25, 1), bed(1, h / 8, h / 20, 0), bed(2, 4 * h - h / 3 - h / 10 - h / 8, h, 0), emptyLayer(-2, 4 * h)];
    const columns = Array.from({ length: nx }, () => structuredClone(col));
    const state = { ...rasterize(columns, nz, h), nx, nz, h, beds };
    const end = -2000 + (nx - 1) * h;
    const P = dir > 0 ? [[-2000, 5 * h], [end, 5 * h]] : [[end, 5 * h], [-2000, 5 * h]];
    const out = remapThrust(state, P, h, [0], true);
    componentsEqual(inventoryOf(state), inventoryOf({ ...out, h, beds }));
    const incoming = out.flux.inflow[dir > 0 ? 'left' : 'right'];
    const departing = out.flux.outflow[dir > 0 ? 'right' : 'left'];
    componentsEqual(incoming, inventory([col], h)); componentsEqual(departing, inventory([col], h));
    assert.ok(out.subcells.size > 0);
    componentsEqual(inventoryOf(state), inventory(columnsFromRaster(out, nx, nz, h), h));
  }
});

test('subcell grain centroids follow an analytical ramp while each bed and memory survive', () => {
  const h = 20, nx = 31, nz = 40, angle = 25 * Math.PI / 180, slip = 27;
  for (const dir of [-1, 1]) {
    const columns = Array.from({ length: nx }, (_, i) => i < 13 || i > 16 ? [emptyLayer(-1, nz * h)] :
      [emptyLayer(-1, 120), { ...bed(0, 0.15, 0.06, 1), burial: 500, loading: 400 }, { ...bed(1, 5.3, 2.12, 0), burial: 700, loading: 300 }, emptyLayer(-1, nz * h - 125.45)]);
    const state = { ...rasterize(columns, nz, h), nx, nz, h, beds };
    const P = dir > 0 ? [[-2000, 600], [-1400, 600 - 600 * Math.tan(angle)]] : [[-1400, 600], [-2000, 600 - 600 * Math.tan(angle)]];
    const moved = remapThrust(state, P, slip, [0], true);
    componentsEqual(inventoryOf(state), inventoryOf({ ...moved, beds, h }));
    const moment = r => {
      const out = [0, 0, 0];
      for (let n = 0; n < nx * nz; n++) {
        let z = Math.floor(n / nx) * h;
        for (const p of cellLayers(r, n, h)) {
          if (p.bed >= 0) { out[0] += p.solid; out[1] += p.solid * (-2000 + n % nx * h + p.offsetX); out[2] += p.solid * (z + p.height / 2 + p.offsetZ); }
          z += p.height;
        }
      }
      return [out[1] / out[0], out[2] / out[0]];
    };
    const a = moment(state), b = moment(moved);
    near(b[0] - a[0], dir * slip * Math.cos(angle), 1e-7); near(b[1] - a[1], -slip * Math.sin(angle), 1e-7);
    for (const parts of moved.subcells.values()) for (const p of parts) if (p.bed >= 0) {
      assert.equal(p.burial, p.bed === 0 ? 500 : 700); assert.equal(p.loading, p.bed === 0 ? 400 : 300);
    }
  }
});

test('harmonic cell velocity includes a thin bed that does not own the display label', () => {
  const columns = [[emptyLayer(-1, 100), ...depositedLayer(0, 19, 1, false, 0, null, physics), ...depositedLayer(1, 1, 0, true, 19, null, physics), emptyLayer(-2, 3080)]];
  const b = { columns, nx: 1, nz: 160, h: 20, beds, overpressure: null, basementVelocity: 5000 };
  const w = windowOf(b), cell = 5 * w.nx;
  let z = 0, time = 0;
  for (const p of columns[0]) { if (p.bed >= 0) time += p.height / layerVelocity(b, p, z, 100); z += p.height; }
  near(w.velocity[cell], 20 / time, 0.001); assert.equal(w.beds[cell], 0);
  const changed = structuredClone(b); changed.columns[0].find(p => p.bed === 1).solid = 0.85;
  assert.notEqual(windowOf(changed).velocity[cell], w.velocity[cell]);
});

test('continuous interval metrics recover physical interfaces and preserve the original resolution eligibility', () => {
  const column = [emptyLayer(-1, 103.25), bed(0, 83.5, 40), bed(1, 1.2, 0.4, 0), emptyLayer(-2, 212.05)];
  for (const h of [40, 20, 10]) {
    const b = { columns: [column], nx: 1, nz: 400 / h, h, beds, faults: [] };
    const r = unitAt(b, -2000, 0, () => 2500, [0, 400]);
    assert.equal(r.status, 'matched'); near(r.metrics.top_m, 103.25); near(r.metrics.thickness_m, 83.5); near(r.metrics.solid_height_m, 40); near(r.metrics.effective_velocity_m_s, 2500);
    assert.equal(unitAt(b, -2000, 1, () => 4000, [0, 400]).status, 'one-cell', 'preserved physically but still excluded by the frozen two-cell interval rule');
  }
});

test('replay preserves its thin-bed slowness projection and rejects lossy resampling', () => {
  const column = [emptyLayer(-1, 100), bed(0, 19, 8), bed(1, 1, 0.85, 0), emptyLayer(-2, 3080)];
  const b = { columns: [column], nx: 1, nz: 160, h: 20, beds, overpressure: null, basementVelocity: 5000 };
  const view = windowOf(b), snapshot = { view };
  const replay = windowOf(b, snapshot);
  assert.deepEqual(replay, view); replay.velocity[0] = 0; replay.beds[0] = 999;
  assert.notEqual(replay.velocity[0], view.velocity[0]); assert.notEqual(replay.beds[0], view.beds[0]);
  assert.throws(() => windowOf(b, snapshot, 10), /Replay snapshots/);
  assert.throws(() => windowOf(b, b, 0), /positive/);
});

test('actual deposition retains every declared bed in a positive full deposit at all three grids', () => {
  for (const h of [40, 20, 10]) {
    let fullDeposits = 0, thinBeds = 0;
    const b = simulate({ ...BASIN_DEFAULTS, h, seed: 910001, setting: 'extension', faults: [0, 0], quiet: true, overpressure: 0 }, state => {
      if (state.process !== 'deposition') return;
      const ids = state.beds.flatMap((bed, j) => bed.unit === state.step ? [j] : []);
      for (const column of state.columns) {
        const newParts = column.filter(p => p.bed >= 0 && state.beds[p.bed].unit === state.step);
        if (column[0].bed !== -1 || column[0].height < 1e-7) continue; // explicit clipping at the upper boundary
        fullDeposits++;
        assert.deepEqual([...new Set(newParts.map(p => p.bed))], ids);
        thinBeds += ids.filter(id => newParts.filter(p => p.bed === id).reduce((s, p) => s + p.height, 0) < h).length;
      }
    });
    assert.ok(fullDeposits > 0 && thinBeds > 0, `grid ${h}: exercise actual subcell deposits`);
    assert.equal(b.budget.summary.closed, true); assert.equal(invalidStateCells(b), 0);
  }
});

test('uplifted synthetic history erodes partial layers at the prescribed physical wave base', () => {
  let before; const samples = [];
  const b = simulate({ ...BASIN_DEFAULTS, seed: 20261021, setting: 'compression', h: 40, overpressure: 0 }, s => {
    const indices = Array.from({ length: s.nx }, (_, i) => i).filter(i => i % 20 === 0);
    if (s.process === 'collapse') before = indices.map(i => structuredClone(s.columns[i]));
    if (s.process === 'erosion') samples.push({ step: s.step, before, after: indices.map(i => s.columns[i].reduce((sum, p) => sum + p.solid, 0)) });
  });
  assert.equal(b.budget.summary.closed, true); assert.ok(b.budget.summary.flux.eroded.total > 0);
  let positive = 0;
  for (const sample of samples) {
    const base = Math.max(0, b.historyPlan.forcing[sample.step].waterDepth - 30);
    for (const [i, column] of sample.before.entries()) {
      let z = 0, expected = 0, removed = 0;
      for (const p of column) {
        const cut = Math.max(0, Math.min(p.height, base - z));
        expected += p.solid * (1 - cut / p.height); removed += p.solid * cut / p.height; z += p.height;
      }
      near(sample.after[i], expected, 1e-7); if (removed > 1e-8) positive++;
    }
  }
  assert.ok(positive > 0);
});


test('normal vertical shear transports thin beds at fractional fault depths in either direction', () => {
  for (const dir of [-1, 1]) for (const h of [40, 20, 10]) {
    const nx = 9, end = 400, slope = 0.31;
    const depth = Float64Array.from({ length: nx }, (_, i) => 150.7 + (dir > 0 ? i : nx - 1 - i) * h * slope);
    const col = [emptyLayer(-1, 60), { ...bed(0, 0.15, 0.06, 1), burial: 500, loading: 300 }, bed(1, 4.2, 2.1, 0), emptyLayer(-2, end - 64.35)];
    const columns = Array.from({ length: nx }, () => structuredClone(col)), before = structuredClone(columns);
    const out = remapNormal(columns, depth, 2, dir, h, end, beds, true), dz = 2 * h * slope;
    assert.deepEqual(columns, before);
    componentsEqual(expectedInventory(inventory(columns, h), out.flux), inventory(out.columns, h));
    // Independently known boundary loss: two complete donor columns.
    componentsEqual(out.flux.outflow[dir > 0 ? 'right' : 'left'], inventory([col, col], h));
    near(out.areaError, 0);
    const middle = out.columns[4]; let z = 0, top;
    for (const p of middle) { if (p.bed === 0 && top === undefined) top = z; z += p.height; }
    near(top, 60 + dz); near(z, end);
    const thin = middle.find(p => p.bed === 0); near(thin.height, 0.15); near(thin.solid, 0.06);
    assert.equal(thin.burial, 500); assert.equal(thin.loading, 300);
    const same = remapNormal(columns, depth, 0, dir, h, end, beds);
    componentsEqual(inventory(columns, h), inventory(same.columns, h));
  }
});


test('normal cutoffs recover prescribed heave from continuous thin horizons on a planar fault', () => {
  for (const h of [40, 20, 10]) for (const dir of [-1, 1]) {
    const nx = 4000 / h + 1, end = 4500;
    const depth = Float64Array.from({ length: nx }, (_, i) => (dir > 0 ? i : nx - 1 - i) * h * 0.5);
    const col = [emptyLayer(-1, 100), bed(2, 900, 450), bed(1, 0.15, 0.06, 0), bed(0, 299.85, 150), emptyLayer(-2, 3200)];
    const columns = Array.from({ length: nx }, () => structuredClone(col));
    const moved = remapNormal(columns, depth, 3, dir, h, end, beds);
    const f = { dir, depth, x: Array.from({ length: nx }, (_, i) => -2000 + i * h), z: [...depth] };
    const b = { columns: moved.columns, nx, nz: Math.ceil(end / h), h, beds, faults: [f] };
    const c = cutoffs(b, f, 1); assert.ok(c);
    near(Math.abs(c.hw[0] - c.fw[0]), 3 * h, 1e-7);
    componentsEqual(expectedInventory(inventory(columns, h), moved.flux), inventory(moved.columns, h));
  }
});

test('normal shear counts fractional top outflow and bottom continuation independently', () => {
  const h = 20, end = 100;
  const columns = Array.from({ length: 4 }, () => [emptyLayer(-1, 0.75), bed(0, 4, 2), bed(1, 95.25, 47.625, 0)]);
  const depth = new Float64Array([130, 125, 120, 115]);
  const moved = remapNormal(columns, depth, 1, 1, h, end, beds);
  // Each of three retained donors moves up 5 m: 4 m bed 0 plus 0.25 m bed 1 exit.
  near(moved.flux.outflow.top.total, 3 * (2 + 0.125) * h);
  near(moved.flux.inflow.bottom.total, 3 * 2.5 * h);
  componentsEqual(moved.flux.outflow.right, inventory([columns[3]], h));
  componentsEqual(expectedInventory(inventory(columns, h), moved.flux), inventory(moved.columns, h));
  for (const c of moved.columns) near(c.reduce((s, p) => s + p.height, 0), end);
});
