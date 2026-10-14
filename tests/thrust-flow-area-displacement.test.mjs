import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const bundle = await build({ stdin: { contents: 'export * from "./src/basin.ts"; export * from "./src/strata.ts"; export * from "./src/sedimentBudget.ts";', resolveDir: root }, bundle: true, platform: 'node', format: 'esm', write: false });
const { flowLine, flowMove, flowDisplacement, flowAreaDisplacement, remapThrust, emptyLayer, rasterize, cellLayers, inventoryOf, assessBudget } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
const flowAreaAverage = (F, s, width) => {
  const displacement = flowAreaDisplacement(F, s, width);
  return (x, top, height) => { const d = displacement(x, top, height); return [x + d[0], top + height / 2 + d[1]]; };
};
const near = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const pointNear = (a, b, tolerance = 1e-9) => a.forEach((v, i) => near(v, b[i], tolerance));
const points = [[-2000, 700], [-1600, 700], [-1400, 500], [400, 500]];

// Independent geometry: integrate positive remaining slip over a rectangle
// using a closed-form cubic corner formula for its 45-degree bend crossing.
function knownMoment(top, height, x = -1700, slip = 62, width = 40) {
  const t = Math.tan(Math.PI / 8);
  const cube = (x, z) => Math.max(0, slip + x + 1600 + (700 - z) * t) ** 3;
  const volume = (cube(x + width / 2, top) - cube(x - width / 2, top) - cube(x + width / 2, top + height) + cube(x - width / 2, top + height)) / (6 * t);
  const remaining = volume / (width * height);
  return [x + slip - (1 - 1 / Math.SQRT2) * remaining, top + height / 2 - remaining / Math.SQRT2];
}

test('rectangular flow moments integrate a partially crossed bend instead of moving only its midpoint', () => {
  const F = flowLine(points), average = flowAreaAverage(F, 62, 40), expected = knownMoment(600, 20);
  pointNear(average(-1700, 600, 20), expected);
  const midpoint = flowMove(F, -1700, 610, 62);
  assert.ok(Math.hypot(midpoint[0] - expected[0], midpoint[1] - expected[1]) > .5);
  for (const pieces of [2, 7, 13]) {
    const sum = [0, 0];
    for (let j = 0; j < pieces; j++) {
      const p = flowAreaAverage(F, 62, 40 / pieces)(-1720 + (j + .5) * 40 / pieces, 600, 20);
      sum[0] += p[0] / pieces; sum[1] += p[1] / pieces;
    }
    pointNear(sum, expected);
  }
  for (const pieces of [2, 7, 13]) {
    const sum = [0, 0];
    for (let j = 0; j < pieces; j++) {
      const p = average(-1700, 600 + j * 20 / pieces, 20 / pieces);
      sum[0] += p[0] / pieces; sum[1] += p[1] / pieces;
    }
    pointNear(sum, expected);
  }
});

test('flow moments cover initial and final bend crossings, reverse slip, and mirrored geometry', () => {
  for (const x of [-1700, -1590, -1450]) for (const slip of [-700, -22, 300, 700]) {
    const top = 100, height = 200, F = flowLine(points), actual = flowAreaAverage(F, slip, 40)(x, top, height);
    const mirrored = flowAreaAverage(flowLine(points.map(([x, z]) => [-x, z])), slip, 40)(-x, top, height);
    pointNear(actual, [-mirrored[0], mirrored[1]]);
    // A separate dense quadrature uses only the established point-flow map.
    const n = 200, independent = [0, 0];
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const p = flowMove(F, x - 20 + (i + .5) * 40 / n, top + (j + .5) * height / n, slip);
      independent[0] += p[0] / (n * n); independent[1] += p[1] / (n * n);
    }
    pointNear(actual, independent, 1e-3);
  }
});

test('flow integration retains tiny positive intervals and rejects nonfinite inputs', () => {
  const F = flowLine(points);
  for (const height of [20, 1e-4, 1e-12, Number.MIN_VALUE]) {
    pointNear(flowAreaAverage(F, -700, 40)(-1900, 100, height), [-2600, 100 + height / 2]);
    pointNear(flowAreaAverage(F, 0, 40)(-1660, 600, height), [-1660, 600 + height / 2]);
  }
  // At vanishing height the rectangle becomes a horizontal interval.
  // A quadratic endpoint integral gives the independent crossing limit.
  const t = Math.tan(Math.PI / 8), remaining = x => Math.max(0, 52 + x + 1600 + 90 * t);
  const mean = (remaining(-1680) ** 2 - remaining(-1700) ** 2) / 40;
  for (const height of [1e-100, 1e-300, Number.MIN_VALUE]) {
    pointNear(flowAreaDisplacement(F, 52, 20)(-1690, 610, height), [52 - (1 - 1 / Math.SQRT2) * mean, -mean / Math.SQRT2]);
  }
  for (const width of [0, -1, Infinity, -Infinity, NaN]) assert.throws(() => flowAreaDisplacement(F, 22, width), /width/);
  assert.throws(() => flowAreaDisplacement(F, 22, 40)(0, 1e308, 1e308), /extent/);
  const average = flowAreaAverage(F, 62, 40);
  for (const height of [0, -1, Infinity, -Infinity, NaN]) assert.throws(() => average(-1700, 600, height), /interval/);
  for (const value of [Infinity, -Infinity, NaN]) {
    assert.throws(() => average(value, 600, 20), /interval/);
    assert.throws(() => average(-1660, value, 20), /interval/);
    assert.throws(() => flowAreaAverage(F, value, 40)(-1660, 600, 20), /integration/);
  }
});

test('constituent thrust moments preserve physical positions across storage shifts and arbitrary material partitions', () => {
  const h = 40, nx = 61, nz = 30, storageX = -1720, physicalX = -1700, physicalTop = 600, bedHeight = 20;
  for (const shift of [0, 10]) for (const pieces of [1, 2, 7]) {
    const columns = Array.from({ length: nx }, (_, i) => {
      const x = -2000 + i * h, fault = x <= -1600 ? 700 : x >= -1400 ? 500 : 700 - (x + 1600);
      return [emptyLayer(-1, fault), emptyLayer(-2, nz * h - fault)];
    });
    const i = (storageX + 2000) / h, k = 15, n = k * nx + i;
    const bed = { bed: 0, height: bedHeight, solid: 8, fraction: .4, burial: 90, loading: 70, offsetX: physicalX - storageX, offsetZ: -shift };
    columns[i] = [emptyLayer(-1, physicalTop + shift), bed, emptyLayer(-1, 700 - physicalTop - shift - bedHeight), emptyLayer(-2, nz * h - 700)];
    const state = { ...rasterize(columns, nz, h), nx, nz, h, beds: [{ carbonate: false }] };
    // Passive burial tags prevent identical geometric pieces from coalescing.
    // Kinematics must not depend on those tags, and each history must survive.
    state.subcells.set(n, [...(shift ? [emptyLayer(-1, shift)] : []), ...Array.from({ length: pieces }, (_, tag) => ({ ...bed, height: bedHeight / pieces, solid: 8 / pieces, burial: 90 + tag })), emptyLayer(-1, h - shift - bedHeight)]);
    const before = structuredClone(state), result = remapThrust(state, points, 62, [0, 0, 0], true);
    assert.deepEqual(state, before);
    assert.equal(assessBudget(inventoryOf(state), inventoryOf({ ...state, ...result }), result.flux).closed, true);
    const tags = Array.from({ length: pieces }, () => ({ solid: 0, x: 0, z: 0 }));
    for (let n = 0; n < nx * nz; n++) {
      let z = Math.floor(n / nx) * h;
      for (const p of cellLayers(result, n, h)) {
        if (p.bed === 0) {
          const sum = tags[p.burial - 90]; assert.ok(sum);
          near(p.fraction, .4); near(p.loading, 70);
          sum.solid += p.solid; sum.x += p.solid * (-2000 + n % nx * h + p.offsetX); sum.z += p.solid * (z + p.height / 2 + p.offsetZ);
        }
        z += p.height;
      }
    }
    tags.forEach((sum, j) => {
      near(sum.solid, 8 / pieces);
      pointNear([sum.x / sum.solid, sum.z / sum.solid], knownMoment(600 + j * 20 / pieces, 20 / pieces));
    });
    const total = tags.reduce((a, p) => ({ solid: a.solid + p.solid, x: a.x + p.x, z: a.z + p.z }), { solid: 0, x: 0, z: 0 });
    pointNear([total.x / total.solid, total.z / total.solid], knownMoment(600, 20));
  }
});


test('trajectory displacement retains small straight slips and reverses exactly through bends', () => {
  const large = flowLine([[1e12, 1e12], [1e12 + 10000, 1e12]]);
  for (const slip of [-.1, 0, .1]) assert.deepEqual(flowDisplacement(large, 1e12 + 123, 1e12 - 100, slip), [slip, 0]);
  const F = flowLine(points);
  for (const x of [-1900, -1660, -1450]) for (const z of [100, 400]) for (const slip of [-700, -22, 22, 700]) {
    const displacement = flowDisplacement(F, x, z, slip), endpoint = flowMove(F, x, z, slip);
    pointNear([x + displacement[0], z + displacement[1]], endpoint);
    const reverse = flowDisplacement(F, x + displacement[0], z + displacement[1], -slip);
    pointNear(reverse, displacement.map(v => -v));
  }
});
