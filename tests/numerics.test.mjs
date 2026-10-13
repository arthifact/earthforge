import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { unitAt, sequence, summarize, compare, extract, INTERVAL_METRICS } from '../validation/numerics/metrics.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const bundle = await build({ stdin: { contents: 'export * from "./src/basin.ts"; export * from "./src/sedimentBudget.ts";', resolveDir: root }, bundle: true, platform: 'node', format: 'esm', write: false });
const { simulate, BASIN_DEFAULTS, windowOf, layerVelocity, emptyInventory, emptyFluxes, inventoryOf, addInventory, addParcel, assessBudget, summarizeBudget, budgetTolerance, outsideCell, MATERIALS, COMPONENTS } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
const close = (a, b, tol = 1e-8) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);
const grains = (bed, height, fraction, carbonate = false, h = 20) => { const r = emptyInventory(); addParcel(r, bed, height, fraction, carbonate, h); return r; };
const event = (before, after, flux = emptyFluxes(), process = 'normal-slip') => ({ step: 0, process, fault: null, before, after, flux, ...assessBudget(before, after, flux) });

test('grain inventory has physical area units and excludes basement, water, and pores', () => {
  const q = inventoryOf({ grid: Int32Array.of(-1, -2, 0, 1, 0), solid: Float64Array.of(0, 0, 10, 6, 4), sandFraction: Float64Array.of(0, 0, 0.25, 0, 0.75), beds: [{ carbonate: false }, { carbonate: true }], h: 20 });
  assert.equal(q.total, 400); assert.equal(q.sand, 110); assert.equal(q.shale, 170); assert.equal(q.carbonate, 120);
  assert.deepEqual(q.byBed, [280, 120]); assert.deepEqual(q.byBedComponents.sand, [110, 0]);
  assert.deepEqual(q.byBedComponents.carbonate, [0, 120]);
});

test('known deposition, erosion, and each boundary produce the correct retained grains', () => {
  const before = grains(0, 10, 0.25), flux = emptyFluxes();
  flux.deposited = grains(1, 4, 0, true); flux.eroded = grains(0, 1, 0.25);
  // Four distinct faces, a total influx of 8 m and outflux of 4 m of clastic solid height.
  for (const side of ['left', 'right', 'top', 'bottom']) { flux.inflow[side] = grains(0, 2, 0.25); flux.outflow[side] = grains(0, 1, 0.25); }
  const after = inventoryOf({ grid: Int32Array.of(0, 1), solid: Float64Array.of(13, 4), sandFraction: Float64Array.of(0.25, 0), beds: [{ carbonate: false }, { carbonate: true }], h: 20 });
  assert.equal(after.total, 340); assert.equal(after.sand, 65); assert.equal(after.shale, 195); assert.equal(after.carbonate, 80);
  assert.equal(assessBudget(before, after, flux).closed, true);
});

test('compaction changes pore volume without changing grains or their constituents', () => {
  const beds = [{ carbonate: false }];
  const before = inventoryOf({ grid: Int32Array.of(0, 0), solid: Float64Array.of(5, 10), sandFraction: Float64Array.of(0.2, 0.8), beds, h: 20 });
  const after = inventoryOf({ grid: Int32Array.of(-1, 0), solid: Float64Array.of(0, 15), sandFraction: Float64Array.of(0, 0.6), beds, h: 20 });
  assert.equal(assessBudget(before, after, emptyFluxes()).closed, true);
});

test('all four faces are counted, interior cells excluded, corner parcels counted once', () => {
  assert.equal(outsideCell(-1, 0, 4, 5), 'left'); assert.equal(outsideCell(4, 0, 4, 5), 'right');
  assert.equal(outsideCell(2, -1, 4, 5), 'top'); assert.equal(outsideCell(2, 5, 4, 5), 'bottom');
  assert.equal(outsideCell(3, 4, 4, 5), null); assert.equal(outsideCell(-1, -1, 4, 5), 'left');
  assert.equal(outsideCell(4, 5, 4, 5), 'right');
});

test('lost or duplicated sediment is a failure, never an inferred open-boundary flux', () => {
  const before = grains(0, 10, 0.25);
  for (const height of [9, 11]) { const r = assessBudget(before, grains(0, height, 0.25), emptyFluxes()); assert.equal(r.closed, false); assert.equal(Math.abs(r.residual.total), 20); }
  const repair = emptyFluxes(); repair.repairAdded = grains(0, 1, 0.25);
  assert.equal(assessBudget(before, grains(0, 11, 0.25), repair).closed, false, 'artificial filling is disclosed but not geological input');
});

test('offsetting constituent and bed changes cannot hide behind a closed total', () => {
  const before = addInventory(grains(0, 10, 0.2), grains(1, 10, 0.8));
  const after = addInventory(grains(0, 10, 0.8), grains(1, 10, 0.2));
  const r = assessBudget(before, after, emptyFluxes());
  assert.equal(r.residual.total, 0); close(r.residual.sand, 0); close(r.residual.shale, 0);
  assert.deepEqual(r.residual.byBed, [0, 0]); assert.equal(r.closed, false, 'material balance is checked within each bed too');
  assert.equal(r.residual.byBedComponents.sand[0], 120);
  const exchanged = assessBudget(grains(0, 10, 0.5), grains(1, 10, 0.5), emptyFluxes());
  assert.equal(exchanged.residual.total, 0); assert.equal(exchanged.closed, false);
});

test('event errors that later cancel still fail the cumulative budget', () => {
  const a = grains(0, 10, 0.5), b = grains(0, 11, 0.5);
  const s = summarizeBudget([event(a, b), event(b, a)], a, a);
  assert.equal(s.residual.total, 0); assert.equal(s.failedEvents, 2); assert.equal(s.closed, false);
  assert.equal(s.absoluteEventResidual.total, 40); assert.equal(s.byProcess['normal-slip'].absoluteResidual.total, 40);
});

test('closure tolerance accepts only roundoff and rejects nonfinite inventories', () => {
  const a = grains(0, 10, 0.5), b = structuredClone(a);
  b.total += budgetTolerance(a.total) / 2;
  assert.equal(assessBudget(a, b, emptyFluxes()).closed, true);
  b.total = a.total + 2 * budgetTolerance(a.total);
  assert.equal(assessBudget(a, b, emptyFluxes()).closed, false);
  b.total = NaN; assert.equal(assessBudget(a, b, emptyFluxes()).closed, false);
});

test('actual 40/20/10 m normal and compaction histories close for every process and constituent', () => {
  for (const h of [40, 20, 10]) for (const faulted of [false, true]) {
    const b = simulate({ ...BASIN_DEFAULTS, seed: 910003, setting: 'extension', h, faults: faulted ? [2, 2] : [0, 0], carbonate: 0.3, overpressure: 1 });
    assert.equal(b.budget.summary.closed, true);
    assert.equal(b.budget.steps.length, b.log.length);
    assert.ok(b.budget.steps.every(s => s.summary.closed));
    assert.deepEqual(b.budget.summary.final, inventoryOf(b));
    for (let i = 1; i < b.budget.entries.length; i++) assert.deepEqual(b.budget.entries[i].before, b.budget.entries[i - 1].after);
    for (let bed = 0; bed < b.beds.length; bed++) close(b.budget.summary.flux.deposited.byBed[bed] ?? 0, b.deposited[bed] * h, budgetTolerance(b.deposited[bed] * h));
    assert.equal(b.budget.summary.flux.repairAdded.total, 0);
    assert.ok(b.budget.entries.some(e => e.process === 'erosion')); // Zero physical erosion is valid in a subsiding column.
  }
});

test('thrust remapping closes every grain budget independently of the old area screen', () => {
  const b = simulate({ ...BASIN_DEFAULTS, seed: 920001, setting: 'compression', thrusts: [1, 1], quiet: true, compaction: false, overpressure: 0 });
  assert.ok(b.checks.area < 0.02);
  assert.equal(b.budget.summary.closed, true);
  const failed = b.budget.entries.filter(e => !e.closed);
  assert.equal(failed.length, 0);
  assert.ok(b.checks.transport.length > 0);
  assert.ok(b.checks.transport.every(t => t.maxOffsetCells <= 2));
  assert.ok(b.budget.summary.absoluteEventResidual.total < 1e-3);
  assert.ok(Object.values(b.budget.summary.flux.inflow).some(i => i.total > 0), 'actual edge continuation is tracked');
});

function fixture(h = 20) {
  const nx = 1, nz = 20, grid = new Int32Array(nz).fill(-2);
  grid.fill(-1, 0, 2); grid.fill(1, 2, 4); grid.fill(0, 4, 8);
  return { nx, nz, h, grid, beds: [{ unit: 0 }, { unit: 1 }], faults: [], solid: Float64Array.from(grid, c => c >= 0 ? 10 : 0), sandFraction: Float64Array.from(grid, c => c >= 0 ? 0.25 : 0), burial: new Float32Array(nz).fill(200), effectiveBurial: new Float32Array(nz).fill(150) };
}
test('matched unit metrics use grain-weighted composition and travel-time velocity', () => {
  const b = fixture(); b.solid[4] = 5; b.sandFraction[4] = 1;
  const r = unitAt(b, -2000, 0, (_i, k) => k < 6 ? 2000 : 4000, [0, 400]);
  assert.equal(r.status, 'matched'); assert.equal(r.metrics.top_m, 80); assert.equal(r.metrics.thickness_m, 80);
  close(r.metrics.solid_height_m, 35); close(r.metrics.sand_fraction, 12.5 / 35); close(r.metrics.effective_velocity_m_s, 80 / (40 / 2000 + 40 / 4000));
});

test('missing, unresolved, fragmented, boundary and fault-cut units remain explicit exclusions', () => {
  let b = fixture(); assert.equal(unitAt(b, -2000, 99, () => 2000, [0, 400]).status, 'absent');
  b.grid.fill(-2, 5, 8); assert.equal(unitAt(b, -2000, 0, () => 2000, [0, 400]).status, 'one-cell');
  b = fixture(); b.grid[6] = -2; assert.equal(unitAt(b, -2000, 0, () => 2000, [0, 400]).status, 'fragmented');
  b = fixture(); assert.equal(unitAt(b, -2000, 0, () => 2000, [80, 400]).status, 'window-boundary');
  b.faults = [{ depth: [100] }]; assert.equal(unitAt(b, -2000, 0, () => 2000, [0, 400]).status, 'fault-cut');
});

test('paired refinement uses exactly the same unit cohort for both grid pairs', () => {
  const samples = [40, 20, 10].map((h, j) => ({ h, fields: [], intervals: ['a', 'b'].map(key => ({ key, status: key === 'b' && j === 0 ? 'one-cell' : 'matched', spans: [[2, 5]], metrics: Object.fromEntries(INTERVAL_METRICS.map(m => [m, [4, 2, 1][j]])) })) }));
  const c = compare(samples, ['same', 'same', 'same']);
  assert.equal(c.coverage.length, 2); assert.equal(c.coverage[1].included, false);
  assert.equal(c.metrics.thickness_m.n, 1); assert.equal(c.metrics.thickness_m.coarse_rms, 2); assert.equal(c.metrics.thickness_m.fine_rms, 1);
  assert.throws(() => compare(samples, ['same', 'different', 'same']), /histories differ/);
  assert.throws(() => compare(samples.toReversed(), ['same', 'same', 'same']), /ordered/);
});

test('refinement classifications distinguish monotonic, oscillatory, divergent and stable triples', () => {
  assert.equal(sequence([4, 2, 1]).classification, 'monotonic-contracting');
  assert.equal(sequence([4, 1, 2]).classification, 'oscillatory-contracting');
  assert.equal(sequence([4, 2, -1]).classification, 'monotonic-noncontracting');
  assert.equal(sequence([1, 1, 1]).classification, 'stable'); assert.equal(sequence([2, 1, 1]).classification, 'settled');
  assert.equal(sequence([1, 1, 2]).classification, 'new-change');
  assert.equal(summarize([]).ratio, null); assert.throws(() => sequence([NaN, 2, 1]), /finite/);
  close(summarize([sequence([4, 2, 1])]).ratio, 0.5);
});

test('real refinement histories match before rounding and field profiles retain the common physical support', async () => {
  const plan = JSON.parse(await readFile(new URL('../validation/numerics/plan.json', import.meta.url)));
  const samples = [], hashes = [];
  for (const h of [40, 20, 10]) {
    const b = simulate({ ...BASIN_DEFAULTS, h, seed: 910001, setting: 'extension', faults: [0, 0], quiet: true, overpressure: 0 });
    samples.push(extract(b, plan, windowOf, layerVelocity)); hashes.push(createHash('sha256').update(JSON.stringify(b.historyPlan)).digest('hex'));
    const w = windowOf(b, b, h), x = plan.profile_x_m[0], i = Math.round(x / h);
    let known = 0; for (let k = 0; k < 3000 / h; k++) known += h / w.velocity[k * w.nx + i];
    close(samples.at(-1).fields.find(f => f.key === `time:${x}`).value, known);
  }
  const c = compare(samples, hashes);
  assert.equal(c.metrics.vertical_travel_time_s.n, 12); assert.ok(c.metrics.thickness_m.n > 50);
});
