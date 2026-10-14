import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const bundle = await build({ entryPoints: [root + '/src/conservativeTransport.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { assignTransport } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
const quantum = 1e-12;

function checkAgainstEnumeration(nx, nz, allowed, parcels, capacity) {
  const before = structuredClone({ allowed, parcels, capacity }), maxWeight = Math.max(...parcels.map(p => p.weight ?? 1));
  const distance = (p, n) => (n % nx - (p.targetI ?? p.i)) ** 2 + (Math.floor(n / nx) - (p.targetK ?? p.k)) ** 2;
  const raw = (p, n) => (p.weight ?? 1) * distance(p, n);
  // This is the specified edge objective. Exhaustive enumeration shares no
  // greedy matching, dual potentials, heap, or augmenting-path implementation.
  const integer = (p, n) => BigInt(Math.round(((p.weight ?? 1) / maxWeight) * distance(p, n) / quantum));
  let bestRaw = Infinity, bestInteger = null, radius = 2;
  const visit = (j, used, cost, integerCost) => {
    if (j === parcels.length) { bestRaw = Math.min(bestRaw, cost); if (bestInteger === null || integerCost < bestInteger) bestInteger = integerCost; return; }
    const p = parcels[j];
    for (let n = 0; n < nx * nz; n++) {
      if (!allowed[n] || used.has(n) || (capacity && (p.height ?? 1) > capacity[n] + 1e-8) || (n % nx - p.i) ** 2 + (Math.floor(n / nx) - p.k) ** 2 > radius ** 2) continue;
      used.add(n); visit(j + 1, used, cost + raw(p, n), integerCost + integer(p, n)); used.delete(n);
    }
  };
  visit(0, new Set(), 0, 0n);
  if (bestInteger === null) { radius = 3; visit(0, new Set(), 0, 0n); }
  if (bestInteger === null) {
    assert.throws(() => assignTransport(nx, nz, allowed, parcels, capacity), /cannot place/);
    assert.deepEqual({ allowed, parcels, capacity }, before); return { feasible: false };
  }
  const result = assignTransport(nx, nz, allowed, parcels, capacity);
  assert.equal(result.radius, radius); assert.equal(new Set(result.destination).size, parcels.length);
  let actualRaw = 0, actualInteger = 0n;
  for (let j = 0; j < parcels.length; j++) {
    const p = parcels[j], n = result.destination[j];
    assert.ok(allowed[n]); assert.ok(!capacity || (p.height ?? 1) <= capacity[n] + 1e-8);
    assert.ok((n % nx - p.i) ** 2 + (Math.floor(n / nx) - p.k) ** 2 <= radius ** 2);
    actualRaw += raw(p, n); actualInteger += integer(p, n);
  }
  assert.equal(actualInteger, bestInteger);
  // Rounding each edge by at most q/2 gives N*q for the difference between
  // the chosen and raw optimal assignments, plus floating-point arithmetic.
  assert.ok(actualRaw - bestRaw <= parcels.length * quantum * maxWeight + 1e-14 * maxWeight);
  assert.deepEqual({ allowed, parcels, capacity }, before);
  return { feasible: true, radius, result };
}

test('quantized matching is exactly optimal with capacity limits and retains the raw objective bound', () => {
  let seed = 663415, feasible = 0, infeasible = 0, fallback = 0;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const heights = [.2, .5, .7, 1], weights = [1, .1, .001, 1e-6, 1e-12, 1e-16, 1e-100, 1e-300];
  for (let trial = 0; trial < 500; trial++) {
    const nx = 3, nz = 3, allowed = Uint8Array.from({ length: 9 }, () => Number(random() > .15));
    const capacity = Float64Array.from({ length: 9 }, () => heights[Math.floor(random() * heights.length)]);
    const parcels = Array.from({ length: 4 }, (_, source) => {
      const i = Math.floor(random() * nx), k = Math.floor(random() * nz);
      return { source, i, k, targetI: i + .98 * (random() - .5), targetK: k + .98 * (random() - .5), height: heights[Math.floor(random() * heights.length)], weight: weights[Math.floor(random() * weights.length)] };
    });
    const r = checkAgainstEnumeration(nx, nz, allowed, parcels, capacity);
    if (r.feasible) { feasible++; fallback += Number(r.radius === 3); } else infeasible++;
  }
  assert.ok(feasible > 300 && infeasible > 50 && fallback > 0);
});

test('one-ulp target differences away from quantization boundaries do not swap material owners', () => {
  for (const delta of [-(2 ** -55), 0, 2 ** -55]) {
    const parcels = [{ source: 0, i: 0, k: 0, targetI: .2 }, { source: 1, i: 0, k: 0, targetI: .2 + delta }];
    const result = checkAgainstEnumeration(2, 1, Uint8Array.of(1, 1), parcels);
    assert.deepEqual([...result.result.destination], [0, 1]);
  }
  // A bin boundary is deliberately not claimed to be perturbation-invariant.
  // Both sides must still solve their own quantized problem exactly.
  const boundary = Math.sqrt((40000000000 + .5) * quantum);
  for (const delta of [-(2 ** -52), 0, 2 ** -52]) {
    checkAgainstEnumeration(2, 1, Uint8Array.of(1, 1), [{ source: 0, i: 0, k: 0, targetI: boundary }, { source: 1, i: 0, k: 0, targetI: boundary + delta }]);
  }
});

test('common weight scales preserve the physical choice and arbitrarily small parcels remain assigned', () => {
  for (const scale of [1e-100, 1e-9, 1, 1e9, 1e100]) for (const order of [false, true]) {
    const parcels = [{ source: 0, i: 0, k: 0, targetI: .2, weight: scale }, { source: 1, i: 0, k: 0, targetI: .1, weight: .1 * scale }];
    if (order) parcels.reverse();
    const result = checkAgainstEnumeration(2, 1, Uint8Array.of(1, 1), parcels).result;
    for (let j = 0; j < parcels.length; j++) assert.equal(result.destination[j], parcels[j].source);
  }
  for (const tiny of [1e-16, 1e-100, 1e-300, Number.MIN_VALUE]) {
    const parcels = [{ source: 0, i: 0, k: 0, weight: 1 }, { source: 1, i: 0, k: 0, weight: tiny, height: .1 }];
    const result = checkAgainstEnumeration(2, 1, Uint8Array.of(1, 1), parcels, Float64Array.of(1, 1)).result;
    assert.equal(result.destination.length, 2); assert.equal(new Set(result.destination).size, 2);
  }
});

test('half-cell validation slack initializes feasible duals at the actual nearest destination', () => {
  for (const coordinate of ['targetI', 'targetK']) for (const target of [.5 - 5e-10, .5, .5 + 5e-10]) {
    const nx = coordinate === 'targetI' ? 3 : 1, nz = coordinate === 'targetK' ? 3 : 1;
    const result = checkAgainstEnumeration(nx, nz, Uint8Array.of(1, 1, 1), [{ source: 0, i: 0, k: 0, [coordinate]: target }]).result;
    if (target > .5) assert.equal(result.destination[0], 1);
    checkAgainstEnumeration(nx, nz, Uint8Array.of(1, 1, 1), [{ source: 0, i: 0, k: 0, [coordinate]: target }, { source: 1, i: 0, k: 0, [coordinate]: .4 }]);
  }
  // The true nearest integer can be just outside the domain while the supplied
  // rounded center remains valid under the documented half-cell tolerance.
  checkAgainstEnumeration(2, 1, Uint8Array.of(1, 1), [{ source: 0, i: 0, k: 0, targetI: -.5000000005 }, { source: 1, i: 0, k: 0, targetI: .2 }]);
});
