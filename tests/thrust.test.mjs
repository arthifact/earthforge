import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const bundle = await build({ stdin: { contents: 'export * from "./src/basin.ts"; export * from "./src/conservativeTransport.ts"; export * from "./src/sedimentBudget.ts";', resolveDir: root }, bundle: true, platform: 'node', format: 'esm', write: false });
const { remapThrust, remapCompactedMaterial, assignTransport, inventoryOf, assessBudget, BASIN_DEFAULTS, simulate } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
const fields = ['grid', 'solid', 'sandFraction', 'burial', 'effectiveBurial'];
const near = (a, b, t = 1e-9) => assert.ok(Math.abs(a - b) <= t, `${a} != ${b}`);
function empty(nx, nz, h = 10) {
  return { nx, nz, h, grid: new Int32Array(nx * nz).fill(-1), solid: new Float64Array(nx * nz), sandFraction: new Float64Array(nx * nz), burial: new Float32Array(nx * nz), effectiveBurial: new Float32Array(nx * nz), beds: [{ carbonate: false }, { carbonate: true }] };
}
function put(b, i, k, bed = 0) {
  const n = k * b.nx + i;
  b.grid[n] = bed; b.solid[n] = b.h * (0.2 + ((i + k) % 6) / 10); b.sandFraction[n] = bed === 1 ? 0 : (i % 7) / 7;
  b.burial[n] = n + 500; b.effectiveBurial[n] = n / 2 + 200;
}
function checkStep(b, P, s, carry = [0, 0, 0]) {
  const snapshot = structuredClone(b), m = remapThrust(b, P, s, carry, true);
  assert.deepEqual(b, snapshot, 'operator leaves source arrays and bed definitions untouched');
  assert.equal(assessBudget(inventoryOf(b), inventoryOf({ ...b, ...m }), m.flux).closed, true);
  assert.ok(m.placement.maxOffsetCells <= 2);
  assert.equal(m.from.reduce((n, src) => n + Number(src >= 0), 0), m.placement.parcels, "provenance covers every moved parcel");
  for (let n = 0; n < m.from.length; n++) if (m.from[n] >= 0) for (const key of fields) assert.equal(m[key][n], b[key][m.from[n]], key);
  return m;
}

test('local matching resolves collisions without duplication or rescaling', () => {
  const mask = new Uint8Array(25).fill(1), p = Array.from({ length: 8 }, (_, source) => ({ source, i: 2, k: 2 }));
  const a = assignTransport(5, 5, mask, p);
  assert.equal(new Set(a.destination).size, p.length); assert.ok(a.maxOffsetCells <= 2);
  assert.deepEqual(assignTransport(5, 5, mask, p), a, 'deterministic tie breaking');
});
test('augmenting paths can relocate an occupant instead of stranding a constrained parcel', () => {
  const mask = Uint8Array.of(1, 0, 1, 0, 1);
  const p = [{ source: 0, i: 2, k: 0 }, { source: 1, i: 0, k: 0 }, { source: 2, i: 0, k: 0 }];
  const a = assignTransport(5, 1, mask, p);
  assert.deepEqual([...a.destination], [4, 0, 2]);
});
test('an impossible local packing fails explicitly and leaves inputs untouched', () => {
  const mask = Uint8Array.of(1, 0, 0, 0, 0, 0, 1), old = mask.slice();
  const p = [{ source: 0, i: 0, k: 0 }, { source: 1, i: 0, k: 0 }], copy = structuredClone(p);
  assert.throws(() => assignTransport(7, 1, mask, p), /cannot place parcel/);
  assert.deepEqual(mask, old); assert.deepEqual(p, copy);
  assert.throws(() => assignTransport(7, 1, mask, [{ source: 0, i: -1, k: 0 }]), /Boundary parcels/);
});

test('zero slip is identity, including memory and fractional carry', () => {
  const b = empty(20, 15); for (let i = 0; i < 20; i++) for (let k = 2; k < 10; k++) put(b, i, k, k % 2);
  const carry = [4, -5, 0], m = checkStep(b, [[-2000, 100], [-1810, 100]], 0, carry);
  for (const key of fields) assert.deepEqual(m[key], b[key]); assert.deepEqual(m.carry, carry);
});

test('horizontal translations match exact cell transport in both directions and count edge influx/outflux', () => {
  for (const dir of [1, -1]) {
    const b = empty(12, 10); for (let i = 0; i < 12; i++) for (let k = 2; k < 6; k++) put(b, i, k, k % 2);
    b.grid.fill(-2, 6 * 12); // immobile footwall
    const P = dir > 0 ? [[-2000, 60], [-1890, 60]] : [[-1890, 60], [-2000, 60]];
    const m = checkStep(b, P, 20);
    assert.equal(m.placement.displaced, 0);
    let incoming = 0, outgoing = 0;
    for (let i = 0; i < 12; i++) for (let k = 0; k < 10; k++) {
      const n = k * 12 + i, src = k < 6 ? k * 12 + Math.max(0, Math.min(11, i - 2 * dir)) : n;
      for (const key of fields) assert.equal(m[key][n], b[key][src]);
      if (k < 6 && (i - 2 * dir < 0 || i - 2 * dir >= 12)) incoming += b.solid[src] * 10;
      if (k < 6 && (i + 2 * dir < 0 || i + 2 * dir >= 12)) outgoing += b.solid[n] * 10;
    }
    near(m.flux.inflow[dir > 0 ? 'left' : 'right'].total, incoming);
    near(m.flux.outflow[dir > 0 ? 'right' : 'left'].total, outgoing);
  }
});

test('analytic 45-degree ramp transports a closed packet exactly and preserves the footwall', () => {
  const b = empty(20, 20); put(b, 4, 5); put(b, 8, 3, 1); put(b, 18, 15);
  const m = checkStep(b, [[-2000, 190], [-1810, 0]], Math.SQRT2 * 10);
  for (const [i, k] of [[4, 5], [8, 3]]) for (const key of fields) assert.equal(m[key][(k - 1) * b.nx + i + 1], b[key][k * b.nx + i]);
  for (const key of fields) assert.equal(m[key][15 * 20 + 18], b[key][15 * 20 + 18]);
  assert.equal(m.placement.displaced, 0); assert.equal(m.flux.deposited.total, 0);
  assert.equal(Object.values(m.flux.outflow).reduce((a, f) => a + f.total, 0), 0);
});

test('top/bottom and corner outflows count the geometrically departing parcels exactly once', () => {
  for (const down of [false, true]) {
    const b = empty(12, 12);
    const P = down ? [[-2000, 40], [-1890, 150]] : [[-2000, 160], [-1890, 50]];
    const k = down ? 11 : 0, i = down ? 9 : 3;
    put(b, i, k); put(b, 11, k, 1); put(b, 5, 3);
    const m = checkStep(b, P, Math.SQRT2 * 10);
    near(m.flux.outflow[down ? 'bottom' : 'top'].total, b.solid[k * 12 + i] * 10);
    near(m.flux.outflow.right.total, b.solid[k * 12 + 11] * 10);
    near(Object.values(m.flux.outflow).reduce((a, f) => a + f.total, 0), (b.solid[k * 12 + i] + b.solid[k * 12 + 11]) * 10);
  }
});

test('fractional increments retain exactly the prescribed cumulative horizontal translation', () => {
  let b = empty(30, 10), carry = [0]; for (let i = 0; i < 30; i++) for (let k = 2; k < 6; k++) put(b, i, k, k % 2);
  const initial = structuredClone(b), P = [[-2000, 60], [-1710, 60]];
  for (let t = 0; t < 20; t++) { const m = checkStep(b, P, 1.5, carry); carry = m.carry; b = { ...b, ...m }; }
  const once = checkStep(initial, P, 30);
  for (const key of fields) assert.deepEqual(b[key], once[key]); near(carry[0], 0);
});

test('closed packet crossing a bend conserves each parcel over many increments and follows analytical flow', () => {
  let b = empty(120, 80), carry = [0, 0, 0];
  const initial = [];
  for (let i = 18; i <= 24; i++) for (let k = 36; k <= 48; k++) { put(b, i, k, k % 2); initial.push({ x: -2000 + i * 10, z: k * 10, tag: b.burial[k * 120 + i] }); }
  const original = inventoryOf(b), P = [[-2000, 700], [-1600, 700], [-1400, 500], [-810, 500]], step = 13.7, count = 24;
  for (let t = 0; t < count; t++) {
    const m = checkStep(b, P, step, carry); carry = m.carry;
    assert.equal(Object.values(m.flux.inflow).reduce((a, f) => a + f.total, 0), 0);
    assert.equal(Object.values(m.flux.outflow).reduce((a, f) => a + f.total, 0), 0);
    b = { ...b, ...m };
  }
  const final = inventoryOf(b); for (const key of ['total', 'sand', 'shale', 'carbonate']) near(final[key], original[key], 1e-8);
  const positions = new Map(); for (let n = 0; n < b.grid.length; n++) if (b.grid[n] >= 0) positions.set(b.burial[n], [-2000 + n % 120 * 10, Math.floor(n / 120) * 10, b.offsetX[n], b.offsetZ[n]]);
  assert.equal(positions.size, initial.length);
  let sum = 0, worst = 0;
  for (const p of initial) {
    // Independent 45° flat/ramp/flat geometry: constant normal offset and exact arc lengths.
    const delta = 700 - p.z, xb = -1600 - delta * Math.tan(Math.PI / 8), remaining = step * count - (xb - p.x), rampLength = 200 * Math.SQRT2;
    const exact = remaining < 0 ? [p.x + step * count, p.z] : remaining <= rampLength ? [xb + remaining / Math.SQRT2, p.z - remaining / Math.SQRT2] : [-1400 - delta * Math.tan(Math.PI / 8) + remaining - rampLength, 500 - delta];
    const actual = positions.get(p.tag), error = Math.hypot(actual[0] - exact[0], actual[1] - exact[1]); sum += error ** 2; worst = Math.max(worst, error);
    near(actual[0] + actual[2], exact[0], 1e-7); near(actual[1] + actual[3], exact[1], 1e-7);
  }
  assert.ok(Math.sqrt(sum / initial.length) <= 20, `RMS displacement ${Math.sqrt(sum / initial.length)} m`);
  assert.ok(worst <= 40, `maximum displacement ${worst} m`);
});

test('minimum-cost matching agrees with exhaustive assignments on small irregular grids', () => {
  let seed = 78173;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let trial = 0; trial < 120; trial++) {
    const nx = 3, nz = 3, allowed = Uint8Array.from({ length: 9 }, () => random() > 0.3 ? 1 : 0);
    const parcels = Array.from({ length: 4 }, (_, source) => {
      const i = Math.floor(random() * 3), k = Math.floor(random() * 3);
      return { source, i, k, targetI: i + 0.98 * (random() - 0.5), targetK: k + 0.98 * (random() - 0.5) };
    });
    let best = Infinity, radius = 2;
    const enumerate = (p, used, sum) => {
      if (p === parcels.length) { best = Math.min(best, sum); return; }
      const a = parcels[p];
      for (let n = 0; n < 9; n++) {
        const i = n % 3, k = Math.floor(n / 3);
        if (!allowed[n] || used.has(n) || (i - a.i) ** 2 + (k - a.k) ** 2 > radius ** 2) continue;
        const distance = (i - a.targetI) ** 2 + (k - a.targetK) ** 2;
        used.add(n); enumerate(p + 1, used, sum + distance); used.delete(n);
      }
    };
    enumerate(0, new Set(), 0);
    if (!Number.isFinite(best)) { radius = 3; enumerate(0, new Set(), 0); }
    if (!Number.isFinite(best)) { assert.throws(() => assignTransport(nx, nz, allowed, parcels), /cannot place parcel/); continue; }
    const a = assignTransport(nx, nz, allowed, parcels);
    assert.equal(a.radius, radius);
    let actual = 0;
    for (let p = 0; p < parcels.length; p++) actual += (a.destination[p] % 3 - parcels[p].targetI) ** 2 + (Math.floor(a.destination[p] / 3) - parcels[p].targetK) ** 2;
    near(actual, best, 1e-8);
  }
});

test('a full ramp grid balances top/right outflow and prescribed clamped-edge continuation', () => {
  const b = empty(12, 12);
  for (let i = 0; i < 12; i++) for (let k = 0; k < 12; k++) put(b, i, k, k % 2);
  const m = checkStep(b, [[-2000, 300], [-1890, 190]], Math.SQRT2 * 10);
  let incomingLeft = 0, incomingBottom = 0, outRight = 0, outTop = 0;
  for (let i = 0; i < 12; i++) for (let k = 0; k < 12; k++) {
    // The existing boundary rule clamps the source column before its row offset:
    // at the left edge its vertical offset is zero; interior back-traces rise one row.
    const n = k * 12 + i, src = (i === 0 ? k : Math.min(11, k + 1)) * 12 + Math.max(0, i - 1);
    for (const key of fields) assert.equal(m[key][n], b[key][src]);
    if (i === 0) incomingLeft += b.solid[src] * 10;
    else if (k === 11) incomingBottom += b.solid[src] * 10;
    if (i === 11) outRight += b.solid[n] * 10;
    else if (k === 0) outTop += b.solid[n] * 10;
  }
  near(m.flux.inflow.left.total, incomingLeft); near(m.flux.inflow.bottom.total, incomingBottom);
  near(m.flux.outflow.right.total, outRight); near(m.flux.outflow.top.total, outTop);
  assert.equal(m.placement.displaced, 0);
});


test('zero slip preserves existing subcell positions without reallocating parcels', () => {
  const b = empty(20, 15); put(b, 5, 5); put(b, 7, 4, 1);
  b.offsetX = new Float64Array(300); b.offsetZ = new Float64Array(300);
  b.offsetX[105] = 13; b.offsetZ[105] = -7;
  const m = checkStep(b, [[-2000, 100], [-1810, 100]], 0, [3.5]);
  for (const key of [...fields, 'offsetX', 'offsetZ']) assert.deepEqual(m[key], b[key]);
});

test('compaction conserves the lateral grain moment while repacking a bed vertically', () => {
  const m = remapCompactedMaterial([2, 4], [0.25, 0.75], [100, 200], [80, 90], [3, 3], [10, -20]);
  near(m.offsetX[0], 0); near(m.offsetX[1], -20);
  near(3 * m.offsetX[0] + 3 * m.offsetX[1], 2 * 10 + 4 * -20);
});

test('many subcell ramp increments retain analytical continuous positions in either direction', () => {
  for (const degrees of [18, 25, 32]) for (const dir of [-1, 1]) {
    const angle = degrees * Math.PI / 180, dz = Math.tan(angle) * 990;
    const P = dir > 0 ? [[-2000, 1100], [-1010, 1100 - dz]] : [[-1010, 1100], [-2000, 1100 - dz]];
    let b = empty(100, 120), carry = [0]; put(b, 50, 35);
    const tag = b.burial[3550], x = -1500, z = 350, step = 1.3, count = 40;
    for (let j = 0; j < count; j++) { const m = checkStep(b, P, step, carry); carry = m.carry; b = { ...b, ...m }; }
    const n = b.burial.findIndex(v => v === tag);
    assert.ok(n >= 0);
    near(-2000 + n % 100 * 10 + b.offsetX[n], x + dir * step * count * Math.cos(angle), 1e-7);
    near(Math.floor(n / 100) * 10 + b.offsetZ[n], z - step * count * Math.sin(angle), 1e-7);
  }
});


test('crowding uses and reports a bounded third-cell stencil only when two cells cannot fit', () => {
  const mask = Uint8Array.of(1, 0, 0, 1), p = [{ source: 0, i: 0, k: 0 }, { source: 1, i: 0, k: 0 }];
  const a = assignTransport(4, 1, mask, p);
  assert.equal(a.radius, 3); assert.equal(a.maxOffsetCells, 3);
  assert.deepEqual([...a.destination].sort(), [0, 3]);
  assert.equal(assignTransport(4, 1, mask, [p[0]]).radius, 2);
});
