import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const bundle = await build({ stdin: { contents: 'export * from "./src/basin.ts"; export * from "./src/conservativeTransport.ts"; export * from "./src/strata.ts"; export * from "./src/sedimentBudget.ts";', resolveDir: root }, bundle: true, platform: 'node', format: 'esm', write: false });
const { assignTransport, remapThrust, emptyLayer, rasterize, columnsFromRaster, sliceColumn, inventoryOf, assessBudget } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
const near = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const twoPackets = () => [
  { source: 0, height: 1, weight: 1, i: 0, k: 0, targetI: .2 },
  { source: 1, height: 1, weight: .1, i: 0, k: 0, targetI: .1 },
];

test('allocation minimizes integrated occupied-rock displacement rather than equal packet counts', () => {
  const allowed = Uint8Array.of(1, 1), capacity = Float64Array.of(1, 1), packets = twoPackets();
  const weighted = assignTransport(2, 1, allowed, packets, capacity);
  const equalPackets = assignTransport(2, 1, allowed, packets.map(({ weight, ...p }) => p), capacity);
  assert.deepEqual([...weighted.destination], [0, 1]);
  assert.deepEqual([...equalPackets.destination], [1, 0]);
  // Independent two-choice area integral: a full packet at x=.2 and a
  // tenth-full packet at x=.1 compete for storage positions 0 and 1.
  const areaCost = assignment => packets.reduce((sum, p, j) => sum + p.weight * (assignment.destination[j] - p.targetI) ** 2, 0);
  near(areaCost(weighted), .121); near(areaCost(equalPackets), .641);
  assert.deepEqual([...assignTransport(2, 1, allowed, packets.toReversed(), capacity).destination], [1, 0]);
});

test('optional weights default to one and invalid weights are rejected without mutation', () => {
  const allowed = Uint8Array.of(1, 0, 1, 0, 1), capacity = Float64Array.of(1, 0, .5, 0, 1);
  const packets = [{ source: 0, height: .5, i: 2, k: 0 }, { source: 1, height: 1, i: 0, k: 0 }, { source: 2, height: .5, i: 0, k: 0 }];
  const copy = structuredClone({ allowed, capacity, packets });
  assert.deepEqual(assignTransport(5, 1, allowed, packets, capacity), assignTransport(5, 1, allowed, packets.map(p => ({ ...p, weight: 1 })), capacity));
  for (const weight of [0, -1, Infinity, -Infinity, NaN]) {
    assert.throws(() => assignTransport(5, 1, allowed, [{ ...packets[0], weight }], capacity), /weight/);
  }
  assert.deepEqual({ allowed, capacity, packets }, copy);
});

test('weighted matching agrees with exhaustive capacity-constrained assignments on small grids', () => {
  let seed = 246813579, feasible = 0, infeasible = 0, fallback = 0;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const heights = [.2, .5, .7, 1], weights = [1, .1, .001, 1e-6, 1e-12, 1e-16];
  for (let trial = 0; trial < 300; trial++) {
    const nx = 3, nz = 3, allowed = Uint8Array.from({ length: 9 }, () => random() > .15 ? 1 : 0);
    const capacity = Float64Array.from({ length: 9 }, () => heights[Math.floor(random() * heights.length)]);
    const packets = Array.from({ length: 4 }, (_, source) => {
      const i = Math.floor(random() * nx), k = Math.floor(random() * nz);
      return { source, i, k, targetI: i + .98 * (random() - .5), targetK: k + .98 * (random() - .5), height: heights[Math.floor(random() * heights.length)], weight: weights[Math.floor(random() * weights.length)] };
    });
    const copy = structuredClone({ allowed, capacity, packets });
    let best = Infinity, radius = 2;
    // Enumerate complete injective assignments; this shares no greedy matching,
    // dual potentials, or augmenting-path logic with the implementation.
    const enumerate = (p, used, cost) => {
      if (p === packets.length) { best = Math.min(best, cost); return; }
      const q = packets[p];
      for (let n = 0; n < 9; n++) {
        const i = n % nx, k = Math.floor(n / nx);
        if (!allowed[n] || used.has(n) || q.height > capacity[n] + 1e-8 || (i - q.i) ** 2 + (k - q.k) ** 2 > radius ** 2) continue;
        used.add(n);
        enumerate(p + 1, used, cost + q.weight * ((i - q.targetI) ** 2 + (k - q.targetK) ** 2));
        used.delete(n);
      }
    };
    enumerate(0, new Set(), 0);
    if (!Number.isFinite(best)) { radius = 3; enumerate(0, new Set(), 0); }
    if (!Number.isFinite(best)) {
      assert.throws(() => assignTransport(nx, nz, allowed, packets, capacity), /cannot place/);
      infeasible++;
    } else {
      const result = assignTransport(nx, nz, allowed, packets, capacity);
      assert.equal(result.radius, radius); assert.equal(new Set(result.destination).size, packets.length);
      const actual = packets.reduce((sum, p, j) => {
        const n = result.destination[j], i = n % nx, k = Math.floor(n / nx);
        assert.ok(allowed[n] && p.height <= capacity[n] + 1e-8);
        assert.ok((i - p.i) ** 2 + (k - p.k) ** 2 <= radius ** 2);
        return sum + p.weight * ((i - p.targetI) ** 2 + (k - p.targetK) ** 2);
      }, 0);
      near(actual, best, 1e-10); feasible++; fallback += Number(radius === 3);
      const plain = packets.map(({ weight, ...p }) => p);
      assert.deepEqual(assignTransport(nx, nz, allowed, plain, capacity), assignTransport(nx, nz, allowed, plain.map(p => ({ ...p, weight: 1 })), capacity));
    }
    assert.deepEqual({ allowed, capacity, packets }, copy);
  }
  assert.ok(feasible > 150 && infeasible > 10 && fallback > 0);
});

test('arbitrarily small positive weights retain packets and common weight scaling preserves the physical choice', () => {
  const allowed = Uint8Array.of(1, 1), capacity = Float64Array.of(1, 1);
  for (const thinWeight of [.1, 1e-6, 1e-16]) for (const scale of [1e-9, 1, 1e9]) {
    const packets = twoPackets(); packets[1].weight = thinWeight;
    for (const p of packets) p.weight *= scale;
    const copy = structuredClone(packets), result = assignTransport(2, 1, allowed, packets, capacity);
    assert.deepEqual([...result.destination], [0, 1]);
    assert.equal(new Set(result.destination).size, packets.length);
    assert.deepEqual(packets, copy);
  }
});

test('thrust allocation moves a mostly water packet instead of displacing full rock and preserves actual constituents', () => {
  for (const h of [40, 20, 10]) for (const dir of [-1, 1]) {
    const nx = 7, nz = 10, beds = Array.from({ length: 3 }, () => ({ carbonate: false }));
    const layer = (bed, height, offsetX) => ({ bed, height, solid: .4 * height, fraction: .2 + .1 * bed, burial: 900 + bed, loading: 600 + bed, offsetX, offsetZ: 0 });
    const mirror = i => dir > 0 ? i : nx - 1 - i;
    const columns = Array.from({ length: nx }, () => [emptyLayer(-1, nz * h)]);
    columns[mirror(2)] = [emptyLayer(-1, 2 * h), layer(0, h, dir * 1.1 * h), emptyLayer(-1, 7 * h)];
    columns[mirror(4)] = [emptyLayer(-1, 2 * h), layer(1, .1 * h, -dir * h), emptyLayer(-1, 7.9 * h)];
    columns[3] = [emptyLayer(-1, 6 * h), layer(2, .5 * h, 0), emptyLayer(-1, 3.5 * h)];
    const state = { ...rasterize(columns, nz, h), nx, nz, h, beds }, copy = structuredClone(state);
    const endpoints = [[-2000, 5 * h], [-2000 + (nx - 1) * h, 5 * h]], fault = dir > 0 ? endpoints : endpoints.toReversed();
    const result = remapThrust(state, fault, .1 * h, [0], true), actual = columnsFromRaster(result, nx, nz, h);
    assert.deepEqual(state, copy);
    assert.equal(assessBudget(inventoryOf(state), inventoryOf({ ...state, ...result }), result.flux).closed, true);
    assert.equal(actual.findIndex(column => column.some(p => p.bed === 0)), mirror(3));
    assert.equal(actual.findIndex(column => column.some(p => p.bed === 1)), mirror(4));
    for (const id of [0, 1, 2]) near(actual.flat().filter(p => p.bed === id).reduce((sum, p) => sum + p.solid, 0), [.4 * h, .04 * h, .2 * h][id]);
    for (const p of actual.flat()) if (p.bed >= 0) {
      assert.equal(p.fraction, .2 + .1 * p.bed); assert.equal(p.burial, 900 + p.bed); assert.equal(p.loading, 600 + p.bed);
    }
    assert.deepEqual(sliceColumn(actual[3], 5 * h, nz * h), sliceColumn(columns[3], 5 * h, nz * h));
    for (const side of ['left', 'right', 'top', 'bottom']) {
      near(result.flux.inflow[side].total, 0); near(result.flux.outflow[side].total, 0);
    }
  }
});
