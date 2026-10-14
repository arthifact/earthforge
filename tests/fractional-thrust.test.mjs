import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const bundle = await build({ stdin: { contents: 'export * from "./src/basin.ts"; export * from "./src/strata.ts"; export * from "./src/sedimentBudget.ts"; export * from "./src/conservativeTransport.ts";', resolveDir: root }, bundle: true, platform: 'node', format: 'esm', write: false });
const { emptyLayer, withLayerLengths, rasterize, cellLayers, sliceColumn, columnsFromRaster, packColumn, remapThrust, inventoryOf, assessBudget, assignTransport } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
const near = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const layer = (id, height) => ({ bed: id, height, solid: .4 * height, fraction: id / 11, burial: 500 + id, loading: 300 + id, offsetX: 0, offsetZ: 0 });
// Independent exact binary64 support oracle. Expansion coefficients describe
// one physical interval and must not be passed through a numeric near check.
function units(x) {
  const v = new DataView(new ArrayBuffer(8)); v.setFloat64(0, x);
  const bits = v.getBigUint64(0), exponent = Number(bits >> 52n & 2047n), mantissa = bits & ((1n << 52n) - 1n);
  return exponent ? (mantissa + (1n << 52n)) << BigInt(exponent - 1) : mantissa;
}
const support = p => (p.lengths ?? [p.height]).reduce((n, h) => n + units(h), 0n);
function exactSpan(parts) {
  let total = parts.reduce((n, x) => n + (x < 0 ? -units(-x) : units(x)), 0n);
  assert(total >= 0n); const lengths = [];
  while (total) {
    const shift = Math.max(0, total.toString(2).length - 53), mantissa = total >> BigInt(shift);
    lengths.push(Number(mantissa) * 2 ** (shift - 1074)); total -= mantissa << BigInt(shift);
  }
  return lengths;
}
const equalParts = (a, b) => {
  assert.equal(a.length, b.length);
  for (let j = 0; j < a.length; j++) {
    for (const key of ['bed', 'height', 'solid', 'fraction', 'burial', 'loading', 'offsetX', 'offsetZ']) near(a[j][key], b[j][key]);
    assert.equal(support(a[j]), support(b[j]), 'stationary footwall exact support is unchanged');
  }
};
const plane = (nx, h, depth, dir) => dir > 0 ? [[-2000, depth], [-2000 + (nx - 1) * h, depth]] : [[-2000 + (nx - 1) * h, depth], [-2000, depth]];

test('capacity matching relocates a small occupant for a constrained large parcel in either input order', () => {
  const allowed = Uint8Array.of(1, 1), capacity = Float64Array.of(1, .5);
  const parcels = [{ source: 0, height: .5, i: 0, k: 0 }, { source: 1, height: 1, i: 0, k: 0 }];
  assert.deepEqual([...assignTransport(2, 1, allowed, parcels, capacity).destination], [1, 0]);
  assert.deepEqual([...assignTransport(2, 1, allowed, [...parcels].reverse(), capacity).destination], [0, 1]);
  assert.throws(() => assignTransport(2, 1, allowed, parcels, Float64Array.of(1)), /capacity/);
  assert.throws(() => assignTransport(2, 1, allowed, parcels, Float64Array.of(1, NaN)), /capacity/);
  assert.throws(() => assignTransport(2, 1, allowed, [{ ...parcels[0], height: -1 }], capacity), /height/);
});

test('indivisible capacity infeasibility fails without changing inputs or inventing outflow', () => {
  const allowed = Uint8Array.of(1, 1), capacity = Float64Array.of(1, .4);
  const parcels = [{ source: 0, height: .8, i: 0, k: 0 }, { source: 1, height: .6, i: 0, k: 0 }], copy = structuredClone(parcels);
  // Total source height equals total capacity; nevertheless these indivisible
  // parcels cannot fit. The bounded operator must report this limitation.
  assert.throws(() => assignTransport(2, 1, allowed, parcels, capacity), /cannot place/);
  assert.deepEqual(parcels, copy); assert.deepEqual(capacity, Float64Array.of(1, .4));
});

test('zero slip preserves cut-cell state and carry and always returns displacement arrays', () => {
  const nx = 3, nz = 10, h = 40, beds = [{ carbonate: false }];
  const columns = Array.from({ length: nx }, () => [emptyLayer(-1, 30), layer(0, 5), emptyLayer(-2, 365)]);
  const state = { ...rasterize(columns, nz, h), nx, nz, h, beds }, out = remapThrust(state, plane(nx, h, 25, 1), 0, [3]);
  for (const key of ['grid', 'solid', 'sandFraction', 'burial', 'effectiveBurial', 'offsetX', 'offsetZ', 'subcells']) assert.deepEqual(out[key], state[key]);
  assert.deepEqual(out.carry, [3]);
  const noOffsets = { ...state }; delete noOffsets.offsetX; delete noOffsets.offsetZ;
  const identity = remapThrust(noOffsets, plane(nx, h, 25, 1), 0, [3]);
  assert.ok(identity.offsetX instanceof Float64Array); assert.ok(identity.offsetZ instanceof Float64Array);
});

test('a bed below an off-grid fault stays stationary even when its raster cell crosses the fault', () => {
  for (const h of [40, 20, 10]) for (const dir of [-1, 1]) {
    const nx = 11, nz = 400 / h, beds = Array.from({ length: nx }, () => ({ carbonate: false }));
    const columns = Array.from({ length: nx }, (_, i) => [emptyLayer(-1, 30), layer(i, 5), emptyLayer(-2, 365)]);
    const state = { ...rasterize(columns, nz, h), nx, nz, h, beds }, copy = structuredClone(state);
    const out = remapThrust(state, plane(nx, h, 25, dir), h, [0]);
    assert.deepEqual(state, copy);
    assert.equal(assessBudget(inventoryOf(state), inventoryOf({ ...state, ...out }), out.flux).closed, true);
    for (let n = 0; n < nx * nz; n++) for (const p of cellLayers(out, n, h)) if (p.bed >= 0) assert.equal(p.bed, n % nx);
    for (const side of ['left', 'right', 'top', 'bottom']) near(out.flux.outflow[side].total, 0);
  }
});

test('mixed hanging-wall and footwall cells retain footwall state and count only moving grains at edges', () => {
  for (const h of [40, 20, 10]) for (const dir of [-1, 1]) {
    const nx = 11, nz = 400 / h, beds = Array.from({ length: nx }, () => ({ carbonate: false }));
    const columns = Array.from({ length: nx }, (_, i) => [emptyLayer(-1, 10), layer(i, 60), emptyLayer(-2, 330)]);
    const state = { ...rasterize(columns, nz, h), nx, nz, h, beds }, out = remapThrust(state, plane(nx, h, 25.7, dir), h, [0], true);
    assert.equal(assessBudget(inventoryOf(state), inventoryOf({ ...state, ...out }), out.flux).closed, true);
    for (let n = 0; n < nx * nz; n++) {
      const cut = Math.max(0, Math.min(h, 25.7 - Math.floor(n / nx) * h));
      equalParts(sliceColumn(cellLayers(out, n, h), cut, h), sliceColumn(cellLayers(state, n, h), cut, h));
    }
    near(out.flux.inflow[dir > 0 ? 'left' : 'right'].total, 15.7 * .4 * h);
    near(out.flux.outflow[dir > 0 ? 'right' : 'left'].total, 15.7 * .4 * h);
    assert.ok(out.transfers.length > 0);
    for (const { source, moved } of out.transfers) for (const key of ['bed', 'height', 'solid', 'fraction', 'burial', 'loading']) assert.equal(moved[key], source[key]);
  }
});

test('numerical cut-cell padding does not cancel an adjoining natural water gap', () => {
  const nx = 11, nz = 5, h = 20, beds = [{ carbonate: false }];
  const columns = Array.from({ length: nx }, (_, i) => i === 5
    ? [emptyLayer(-1, 20), { ...layer(0, 2), offsetZ: -11 }, emptyLayer(-1, 3), emptyLayer(-2, 75)]
    : [emptyLayer(-1, 25), emptyLayer(-2, 75)]);
  const state = { ...rasterize(columns, nz, h), nx, nz, h, beds }, out = remapThrust(state, plane(nx, h, 25, 1), 20, [0]);
  const column = columnsFromRaster(out, nx, nz, h)[6];
  const packed = packColumn(column, (lo, hi) => {
    let sum = 0;
    for (let k = 0; k < nz; k++) for (const [a, b] of out.numericalWater.get(k * nx + 6) ?? []) sum += Math.max(0, Math.min(hi, k * h + b) - Math.max(lo, k * h + a));
    return sum;
  });
  near(packed.mapDepth(1), 24); near(packed.mapPhysicalDepth(1), 4);
  near(packed.gaps, 23); assert.equal(assessBudget(inventoryOf(state), inventoryOf({ ...state, ...out }), out.flux).closed, true);
});

test('stationary footwall offsets cannot steer moving hanging-wall constituents across a flow bend', () => {
  for (const h of [40, 20, 10]) for (const dir of [-1, 1]) {
    const nx = 1200 / h + 1, nz = 960 / h, beds = [{ carbonate: false }, { carbonate: false }];
    const P = [[-2000, 700], [-1600, 700], [-1400, 500], [-800, 500]]
      .map(([x, z]) => [dir > 0 ? x : -2800 - x, z]);
    const depth = x => {
      for (let j = 0; j + 1 < P.length; j++) {
        const [a, b] = [P[j], P[j + 1]];
        if (x >= Math.min(a[0], b[0]) && x <= Math.max(a[0], b[0])) return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]);
      }
      throw Error('Fixture point outside fault');
    };
    const runs = [];
    for (const [offsetX, offsetZ] of [[87, -32], [500, -120], [-310, 160]]) {
      const columns = Array.from({ length: nx }, (_, i) => {
        const z = depth(-2000 + i * h);
        // Shared exact boundaries make the three represented intervals fill
        // the domain; independent rounded subtractions do not sum to 960 m.
        const column = [withLayerLengths(emptyLayer(-1, 0), exactSpan([z, -15.7])),
          { ...layer(0, 15.7), offsetX: .37, offsetZ: -.23 },
          withLayerLengths({ ...layer(1, 960 - z), offsetX, offsetZ }, exactSpan([960, -z]))];
        assert.equal(column.reduce((n, p) => n + support(p), 0n), units(960));
        assert.equal(support(column[0]) + support(column[1]), units(z));
        return column;
      });
      const state = { ...rasterize(columns, nz, h), nx, nz, h, beds }, copy = structuredClone(state);
      const out = remapThrust(state, P, 17.3, [0, 0, 0], true);
      assert.deepEqual(state, copy, 'all input constituents remain immutable');
      assert.equal(assessBudget(inventoryOf(state), inventoryOf({ ...state, ...out }), out.flux).closed, true);
      for (let n = 0; n < nx * nz; n++) {
        const cut = Math.max(0, Math.min(h, depth(-2000 + n % nx * h) - Math.floor(n / nx) * h));
        equalParts(sliceColumn(cellLayers(out, n, h), cut, h), sliceColumn(cellLayers(state, n, h), cut, h));
      }
      assert.ok(out.transfers.length > 0);
      assert.ok(out.transfers.every(t => t.source.bed === 0 && t.moved.bed === 0));
      runs.push(out);
    }
    for (const out of runs.slice(1)) {
      assert.deepEqual(out.flux, runs[0].flux);
      assert.deepEqual(out.transfers, runs[0].transfers, 'HW trajectories and constituent state are independent of FW offsets');
      assert.deepEqual(out.from, runs[0].from);
    }
  }
});
