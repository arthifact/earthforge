import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const bundle = await build({ entryPoints: [root + '/src/conservativeTransport.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { assignTransport, solveTransportFast, solveTransportExact, OverflowError } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);

// The Number and BigInt solvers are two copies of one algorithm. Any change made to only one of
// them must fail here: same destinations, same diagnostics, or the same error, on every problem.
const outcome = (solve, ...args) => {
  try { const r = solve(...args); return { destination: [...r.destination], displaced: r.displaced, maxOffsetCells: r.maxOffsetCells, radius: r.radius }; }
  catch (error) { return { error: `${error.constructor.name}: ${error.message}` }; }
};
function mulberry32(seed) {
  return () => { seed |= 0; seed = seed + 0x6d2b79f5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
/** A random local transport problem: holes, crowded cells, half-cell targets that tie, weights over
 * twelve decades, and optional heights against capacities that exclude some destinations. */
function problem(r) {
  const int = (a, b) => a + Math.floor(r() * (b - a + 1)), pick = (...xs) => xs[Math.floor(r() * xs.length)];
  const nx = int(1, 10), nz = int(1, 8), cells = nx * nz, open = 0.5 + 0.5 * r();
  const allowed = Uint8Array.from({ length: cells }, () => r() < open ? 1 : 0);
  const weights = pick('none', 'equal', 'wide', 'tiny'), heights = r() < 0.4;
  const capacity = heights ? Float64Array.from({ length: cells }, () => pick(0, 0.5, 1, r())) : undefined;
  const offset = () => pick(undefined, 0, 0.5, -0.5, r() - 0.5);
  const parcels = Array.from({ length: int(1, Math.ceil(cells * (0.3 + 0.8 * r()))) }, (_, source) => {
    const p = { source, i: int(0, nx - 1), k: int(0, nz - 1) }, di = offset(), dk = offset();
    if (di !== undefined) p.targetI = p.i + di;
    if (dk !== undefined) p.targetK = p.k + dk;
    if (weights === 'equal') p.weight = 2;
    if (weights === 'wide') p.weight = 10 ** (-12 * r());
    if (weights === 'tiny') p.weight = pick(1, 1e-300, 1e-13);
    if (heights) p.height = pick(0.5, 1, 0.01 + r());
    return p;
  });
  return { nx, nz, allowed, parcels, capacity };
}

test('the Number and BigInt transport solvers agree on random problems at both radii', () => {
  const r = mulberry32(20261016);
  let feasible = 0, infeasible = 0;
  for (let trial = 0; trial < 600; trial++) {
    const { nx, nz, allowed, parcels, capacity } = problem(r);
    for (const radius of [2, 3]) {
      const fast = outcome(solveTransportFast, nx, nz, allowed, parcels, radius, capacity);
      const exact = outcome(solveTransportExact, nx, nz, allowed, parcels, radius, capacity);
      assert.deepEqual(fast, exact, `trial ${trial}, radius ${radius}`);
      if (exact.error) { assert.match(exact.error, /^PlacementError/); infeasible++; } else feasible++;
    }
  }
  // Both outcomes must be exercised, or the comparison proves little.
  assert.ok(feasible > 300 && infeasible > 100, `feasible ${feasible}, infeasible ${infeasible}`);
});

// A full one-row corridor with an extra parcel at its left end and one free cell at its right end:
// every parcel shifts one cell right, so the augmenting path costs nx - 1 quantized units of 1e12
// and crosses the Number path's 2^51 bound (about 2251 units) between these two lengths.
const corridor = (nx) => ({ allowed: new Uint8Array(nx).fill(1), parcels: [{ source: 0, i: 0, k: 0 }, ...Array.from({ length: nx - 1 }, (_, i) => ({ source: i + 1, i, k: 0 }))] });

test('below the safe bound the Number path solves a long corridor exactly like the BigInt path', () => {
  const nx = 2200, { allowed, parcels } = corridor(nx);
  assert.deepEqual(outcome(solveTransportFast, nx, 1, allowed, parcels, 2), outcome(solveTransportExact, nx, 1, allowed, parcels, 2));
});

test('beyond the safe bound the Number path overflows and assignTransport returns the BigInt result', () => {
  const nx = 2300, { allowed, parcels } = corridor(nx);
  assert.throws(() => solveTransportFast(nx, 1, allowed, parcels, 2), OverflowError);
  const exact = outcome(solveTransportExact, nx, 1, allowed, parcels, 2);
  assert.deepEqual(outcome(assignTransport, nx, 1, allowed, parcels), exact);
  // Independent of either solver and of tie-breaking: the two parcels at cell 0 share cells 0 and 1,
  // and every other parcel moves exactly one cell right, the unique way to reach the free cell.
  assert.deepEqual(exact.destination.slice(0, 2).sort((a, b) => a - b), [0, 1]);
  for (let j = 2; j < nx; j++) assert.equal(exact.destination[j], parcels[j].i + 1);
  assert.equal(exact.displaced, nx - 1);
  assert.equal(exact.maxOffsetCells, 1);
});
