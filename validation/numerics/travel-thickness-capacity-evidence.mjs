// Independent exhaustive audit of the bounded capacity-constrained allocator.
// Reads only simulator source and installed build tooling; no observations.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const candidate = resolve(process.argv[2] ?? resolve(here, '../..'));
const destination = resolve(process.argv[3] ?? resolve(here, 'travel-thickness-capacity-evidence.json'));
const require = createRequire(resolve(candidate, 'package.json'));
const { build } = require('esbuild');
const source = resolve(candidate, 'src/conservativeTransport.ts');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceBytes = readFileSync(source);
const bundle = await build({ entryPoints: [source], bundle: true, platform: 'node', format: 'esm', write: false });
const { assignTransport } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);

const seed = 752361, trials = 1000, nx = 3, nz = 3, packetCount = 4;
const heights = [.2, .5, .7, 1], tolerance = 1e-8;
let state = seed;
const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32);
let feasible = 0, infeasible = 0, maximumCostDifference = 0;
const selectedRadius = { 2: 0, 3: 0 };

for (let trial = 0; trial < trials; trial++) {
  const allowed = Uint8Array.from({ length: nx * nz }, () => random() > .15 ? 1 : 0);
  const capacity = Float64Array.from({ length: nx * nz }, () => heights[Math.floor(random() * heights.length)]);
  const packets = Array.from({ length: packetCount }, (_, source) => {
    const i = Math.floor(random() * nx), k = Math.floor(random() * nz);
    return { source, i, k, targetI: i + .98 * (random() - .5), targetK: k + .98 * (random() - .5), height: heights[Math.floor(random() * heights.length)] };
  });
  const copy = structuredClone({ allowed, capacity, packets });
  let best = Infinity, radius = 2;
  // This enumerates complete injective assignments directly. It does not use
  // the implementation's greedy matching, dual potentials, or path search.
  const enumerate = (p, used, cost) => {
    if (p === packetCount) { best = Math.min(best, cost); return; }
    const packet = packets[p];
    for (let n = 0; n < nx * nz; n++) {
      const i = n % nx, k = Math.floor(n / nx);
      if (!allowed[n] || used.has(n) || packet.height > capacity[n] + tolerance ||
        (i - packet.i) ** 2 + (k - packet.k) ** 2 > radius ** 2) continue;
      used.add(n);
      enumerate(p + 1, used, cost + (i - packet.targetI) ** 2 + (k - packet.targetK) ** 2);
      used.delete(n);
    }
  };
  enumerate(0, new Set(), 0);
  if (!Number.isFinite(best)) { radius = 3; enumerate(0, new Set(), 0); }
  let result, error;
  try { result = assignTransport(nx, nz, allowed, packets, capacity); }
  catch (caught) { error = caught; }
  assert.deepEqual({ allowed, capacity, packets }, copy, `trial ${trial}: input mutation`);
  if (!Number.isFinite(best)) {
    assert.match(error?.message ?? '', /cannot place parcel/, `trial ${trial}: infeasible assignment was not rejected`);
    infeasible++;
    continue;
  }
  assert.ifError(error);
  assert.equal(result.radius, radius, `trial ${trial}: wrong fallback radius`);
  assert.equal(new Set(result.destination).size, packetCount, `trial ${trial}: repeated destination`);
  const cost = packets.reduce((sum, p, j) => {
    const n = result.destination[j], i = n % nx, k = Math.floor(n / nx);
    assert.ok(n >= 0 && n < nx * nz && allowed[n], `trial ${trial}: unavailable destination`);
    assert.ok(p.height <= capacity[n] + tolerance, `trial ${trial}: over-capacity destination`);
    assert.ok((i - p.i) ** 2 + (k - p.k) ** 2 <= radius ** 2, `trial ${trial}: unbounded displacement`);
    return sum + (i - p.targetI) ** 2 + (k - p.targetK) ** 2;
  }, 0);
  const difference = Math.abs(cost - best);
  maximumCostDifference = Math.max(maximumCostDifference, difference);
  assert.ok(difference <= tolerance, `trial ${trial}: non-optimal cost ${cost} instead of ${best}`);
  feasible++;
  selectedRadius[radius]++;
}
assert.equal(sha256(readFileSync(source)), sha256(sourceBytes), 'source changed during the audit');
const report = {
  schema_version: 1,
  status: 'passed',
  generated_at: new Date().toISOString(),
  source: { path: source, sha256: sha256(sourceBytes) },
  audit_source: { path: fileURLToPath(import.meta.url), sha256: sha256(readFileSync(fileURLToPath(import.meta.url))) },
  seed, generator: 'LCG: state=(1664525*state+1013904223) mod 2^32',
  trials, grid: { nx, nz }, packets_per_trial: packetCount,
  packet_heights_and_destination_capacities: heights,
  capacity_and_cost_tolerance: tolerance,
  feasible, infeasible, selected_radius: selectedRadius,
  maximum_absolute_cost_difference: maximumCostDifference,
  input_mutation_failures: 0, incorrect_infeasibility_failures: 0, invalid_assignment_failures: 0,
  limitations: [
    'Finite randomized small-grid audit, not a proof for all inputs or large grids.',
    'Checks optimality within the first feasible 2-cell or 3-cell stencil, not unrestricted-distance optimality.',
    'One indivisible packet per destination can reject physically feasible continuous transport even when total volume fits.',
    'A valid optimal assignment does not establish accuracy of thickness, travel time, or a continuous geometric projection.',
    'No observational development arrays, holdout arrays, or split files were read.'
  ]
};
writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ status: report.status, trials, feasible, infeasible, selectedRadius, maximumCostDifference, source_sha256: report.source.sha256, report: destination }));
