// Synthetic audit only: no observational, development-reference, or holdout data.
// Run from any directory:
//   node validation/numerics/thrust-b-weighted-evidence.mjs --ablation-tests
// Optional: --output path/to/report.json. Production source is never modified.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
let output = join(directory, 'thrust-b-weighted-evidence.json'), ablationTests = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--ablation-tests') ablationTests = true;
  else if (args[i] === '--output' && args[i + 1]) output = resolve(args[++i]);
  else throw Error(`Unknown or incomplete argument: ${args[i]}`);
}
const sha = value => createHash('sha256').update(value).digest('hex');
const transportSource = readFileSync(join(root, 'src/conservativeTransport.ts'), 'utf8');
function replaceExactlyOnce(source, needle, replacement) {
  assert.equal(source.split(needle).length - 1, 1, `Expected exactly one ablation target: ${needle}`);
  return source.replace(needle, replacement);
}
// Change only the objective multiplier. Keep production validation, capacities,
// stencil, initialization, tie handling, and augmenting-path solver intact.
const unweightedSource = replaceExactlyOnce(transportSource, '(point.weight ?? 1) *', '1 *');
const ablationPlugin = {
  name: 'unit-weight-objective-only',
  setup(builder) {
    builder.onLoad({ filter: /[\\/]src[\\/]conservativeTransport\.ts$/ }, () => ({
      contents: unweightedSource, loader: 'ts', resolveDir: join(root, 'src'),
    }));
  },
};
const sourceHashes = {};
async function load(unweighted = false) {
  const bundle = await build({
    stdin: { contents: 'export * from "./src/basin.ts"; export * from "./src/conservativeTransport.ts"; export * from "./src/strata.ts"; export * from "./src/sedimentBudget.ts";', resolveDir: root },
    absWorkingDir: root, bundle: true, platform: 'node', format: 'esm', write: false,
    metafile: true, plugins: unweighted ? [ablationPlugin] : [],
  });
  if (!unweighted) for (const path of Object.keys(bundle.metafile.inputs).sort()) {
    if (path !== '<stdin>') sourceHashes[path] = sha(readFileSync(resolve(root, path)));
  }
  return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
}
const weighted = await load(), unitObjective = await load(true);
const allowedPair = Uint8Array.of(1, 1), pairCapacity = Float64Array.of(1, 1);
const pair = [
  { source: 0, height: 1, weight: 1, i: 0, k: 0, targetI: .2 },
  { source: 1, height: 1, weight: .1, i: 0, k: 0, targetI: .1 },
];
const areaCost = destination => pair.reduce((sum, p, j) => sum + p.weight * (destination[j] - p.targetI) ** 2, 0);
const weightedPair = weighted.assignTransport(2, 1, allowedPair, pair, pairCapacity);
const unitPair = unitObjective.assignTransport(2, 1, allowedPair, pair, pairCapacity);
assert.deepEqual([...weightedPair.destination], [0, 1]);
assert.deepEqual([...unitPair.destination], [1, 0]);
assert.ok(Math.abs(areaCost(weightedPair.destination) - .121) < 1e-14);
assert.ok(Math.abs(areaCost(unitPair.destination) - .641) < 1e-14);
for (const thinWeight of [.1, 1e-6, 1e-16]) for (const scale of [1e-9, 1, 1e9]) for (const reverse of [false, true]) {
  const packets = pair.map((p, i) => ({ ...p, weight: (i ? thinWeight : 1) * scale }));
  if (reverse) packets.reverse();
  assert.deepEqual([...weighted.assignTransport(2, 1, allowedPair, packets, pairCapacity).destination], reverse ? [1, 0] : [0, 1]);
}
for (const weight of [0, -1, Infinity, -Infinity, NaN]) {
  assert.throws(() => weighted.assignTransport(2, 1, allowedPair, [{ ...pair[0], weight }], pairCapacity), /weight/);
}

const near = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const simulator = [];
for (const h of [40, 20, 10]) for (const dir of [-1, 1]) for (const [name, api] of [['unit-objective-ablation', unitObjective], ['production-weighted', weighted]]) {
  const nx = 7, nz = 10, beds = Array.from({ length: 3 }, () => ({ carbonate: false }));
  const layer = (bed, height, offsetX) => ({ bed, height, solid: .4 * height, fraction: .2 + .1 * bed, burial: 900 + bed, loading: 600 + bed, offsetX, offsetZ: 0 });
  const mirror = i => dir > 0 ? i : nx - 1 - i;
  const columns = Array.from({ length: nx }, () => [api.emptyLayer(-1, nz * h)]);
  columns[mirror(2)] = [api.emptyLayer(-1, 2 * h), layer(0, h, dir * 1.1 * h), api.emptyLayer(-1, 7 * h)];
  columns[mirror(4)] = [api.emptyLayer(-1, 2 * h), layer(1, .1 * h, -dir * h), api.emptyLayer(-1, 7.9 * h)];
  columns[3] = [api.emptyLayer(-1, 6 * h), layer(2, .5 * h, 0), api.emptyLayer(-1, 3.5 * h)];
  const state = { ...api.rasterize(columns, nz, h), nx, nz, h, beds }, copy = structuredClone(state);
  const endpoints = [[-2000, 5 * h], [-2000 + (nx - 1) * h, 5 * h]];
  const result = api.remapThrust(state, dir > 0 ? endpoints : endpoints.toReversed(), .1 * h, [0], true);
  assert.deepEqual(state, copy);
  assert.equal(api.assessBudget(api.inventoryOf(state), api.inventoryOf({ ...state, ...result }), result.flux).closed, true);
  const actual = api.columnsFromRaster(result, nx, nz, h);
  const fullDestination = actual.findIndex(column => column.some(p => p.bed === 0));
  const thinDestination = actual.findIndex(column => column.some(p => p.bed === 1));
  assert.equal(fullDestination, mirror(name === 'production-weighted' ? 3 : 4));
  assert.equal(thinDestination, mirror(name === 'production-weighted' ? 4 : 3));
  for (const id of [0, 1, 2]) near(actual.flat().filter(p => p.bed === id).reduce((sum, p) => sum + p.solid, 0), [.4 * h, .04 * h, .2 * h][id]);
  for (const p of actual.flat()) if (p.bed >= 0) {
    assert.equal(p.fraction, .2 + .1 * p.bed); assert.equal(p.burial, 900 + p.bed); assert.equal(p.loading, 600 + p.bed);
  }
  assert.deepEqual(api.sliceColumn(actual[3], 5 * h, nz * h), api.sliceColumn(columns[3], 5 * h, nz * h));
  for (const side of ['left', 'right', 'top', 'bottom']) {
    near(result.flux.inflow[side].total, 0); near(result.flux.outflow[side].total, 0);
  }
  simulator.push({ variant: name, grid_m: h, direction: dir, full_packet_destination: fullDestination,
    thin_water_packet_destination: thinDestination, grain_budget_closed: true,
    actual_constituent_provenance: true, footwall_retained: true, input_unchanged: true });
}

let seed = 246813579;
const initialSeed = seed, random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const weights = [1, .1, .001, 1e-6, 1e-12, 1e-16], heights = [.2, .5, .7, 1];
let feasible = 0, infeasible = 0, maxDifference = 0, defaultCases = 0;
const radiusCounts = { 2: 0, 3: 0 }, trials = 2000;
const answerOrError = (api, nx, nz, allowed, packets, capacity) => {
  try { return { answer: api.assignTransport(nx, nz, allowed, packets, capacity) }; }
  catch (error) { return { error: error.message }; }
};
for (let trial = 0; trial < trials; trial++) {
  const nx = 3, nz = 3, allowed = Uint8Array.from({ length: 9 }, () => random() > .15 ? 1 : 0);
  const capacity = Float64Array.from({ length: 9 }, () => heights[Math.floor(random() * heights.length)]);
  const packets = Array.from({ length: 4 }, (_, source) => {
    const i = Math.floor(random() * nx), k = Math.floor(random() * nz);
    return { source, i, k, targetI: i + .98 * (random() - .5), targetK: k + .98 * (random() - .5),
      height: heights[Math.floor(random() * heights.length)], weight: weights[Math.floor(random() * weights.length)] };
  });
  const copy = structuredClone({ packets, allowed, capacity });
  let best = Infinity, radius = 2;
  // Exhaustive enumeration does not share the solver's initialization, dual
  // potentials, heap, or augmenting-path algorithm.
  const enumerate = (p, used, cost) => {
    if (p === packets.length) { best = Math.min(best, cost); return; }
    const q = packets[p];
    for (let n = 0; n < nx * nz; n++) {
      const i = n % nx, k = Math.floor(n / nx);
      if (!allowed[n] || used.has(n) || q.height > capacity[n] + 1e-8 || (i - q.i) ** 2 + (k - q.k) ** 2 > radius ** 2) continue;
      used.add(n);
      enumerate(p + 1, used, cost + q.weight * ((i - q.targetI) ** 2 + (k - q.targetK) ** 2));
      used.delete(n);
    }
  };
  enumerate(0, new Set(), 0);
  if (!Number.isFinite(best)) { radius = 3; enumerate(0, new Set(), 0); }
  const result = answerOrError(weighted, nx, nz, allowed, packets, capacity);
  if (!Number.isFinite(best)) { assert.match(result.error ?? '', /cannot place/); infeasible++; }
  else {
    assert.equal(result.error, undefined, `trial ${trial}: ${result.error}`);
    const { answer } = result;
    assert.equal(answer.radius, radius); assert.equal(new Set(answer.destination).size, packets.length);
    const cost = packets.reduce((sum, p, j) => {
      const n = answer.destination[j], i = n % nx, k = Math.floor(n / nx);
      assert.ok(n >= 0 && n < nx * nz && allowed[n]);
      assert.ok(p.height <= capacity[n] + 1e-8);
      assert.ok((i - p.i) ** 2 + (k - p.k) ** 2 <= radius ** 2);
      return sum + p.weight * ((i - p.targetI) ** 2 + (k - p.targetK) ** 2);
    }, 0);
    const difference = Math.abs(cost - best);
    assert.ok(difference <= 1e-10, `trial ${trial}: ${cost} vs ${best}`);
    maxDifference = Math.max(maxDifference, difference); feasible++; radiusCounts[radius]++;
  }
  const plain = packets.map(({ weight, ...p }) => p);
  const unweighted = answerOrError(unitObjective, nx, nz, allowed, plain, capacity);
  const omitted = answerOrError(weighted, nx, nz, allowed, plain, capacity);
  const explicit = answerOrError(weighted, nx, nz, allowed, plain.map(p => ({ ...p, weight: 1 })), capacity);
  assert.deepEqual(omitted, unweighted); assert.deepEqual(explicit, unweighted); defaultCases++;
  assert.deepEqual({ packets, allowed, capacity }, copy);
}
assert.ok(feasible > 1000 && infeasible > 100 && radiusCounts[3] > 0);

let testAblation = { run: false, reason: 'Pass --ablation-tests to exercise the unchanged permanent tests against the unit-cost bundle.' };
const testPath = join(root, 'tests/thrust-weighted-transport.test.mjs');
const testSource = readFileSync(testPath, 'utf8');
sourceHashes['tests/thrust-weighted-transport.test.mjs'] = sha(testSource);
if (ablationTests) {
  const temporary = mkdtempSync(join(directory, '.thrust-b-ablation-'));
  try {
    let contents = replaceExactlyOnce(testSource,
      "const root = fileURLToPath(new URL('..', import.meta.url));", `const root = ${JSON.stringify(root)};`);
    const plugin = `[{ name: 'unit-cost', setup(builder) { builder.onLoad({ filter: /[\\\\/]src[\\\\/]conservativeTransport\\.ts$/ }, () => ({ contents: ${JSON.stringify(unweightedSource)}, loader: 'ts', resolveDir: root + '/src' })); } }]`;
    contents = replaceExactlyOnce(contents, 'write: false });', `write: false, plugins: ${plugin} });`);
    const path = join(temporary, 'weighted-ablation.test.mjs');
    writeFileSync(path, contents);
    const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', path], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    assert.ifError(run.error);
    const lines = (run.stdout ?? '').split('\n');
    const failed = lines.filter(line => /^not ok \d+ - /.test(line)).map(line => line.replace(/^not ok \d+ - /, ''));
    const passed = lines.filter(line => /^ok \d+ - /.test(line)).map(line => line.replace(/^ok \d+ - /, ''));
    assert.equal(run.status, 1, `Expected regression-test failure from ablation; exit ${run.status}`);
    assert.ok(failed.includes('allocation minimizes integrated occupied-rock displacement rather than equal packet counts'));
    assert.ok(failed.includes('thrust allocation moves a mostly water packet instead of displacing full rock and preserves actual constituents'));
    assert.equal(failed.length, 4); assert.equal(passed.length, 1);
    testAblation = { run: true, changed_production_files: false, exact_replacement_count: 1,
      objective_multiplier: '1', test_file_sha256: sha(testSource), exit_code: run.status,
      failed_tests: failed, passed_tests: passed, expected_regressions_detected: true };
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
for (const [path, hash] of Object.entries(sourceHashes)) assert.equal(sha(readFileSync(resolve(root, path))), hash, `Source changed during audit: ${path}`);
const report = {
  status: 'passed', script_sha256: sha(readFileSync(fileURLToPath(import.meta.url))),
  source_sha256: sourceHashes,
  ablation: { description: 'Production code with only the squared-cost multiplier changed from (point.weight ?? 1) to 1.',
    exact_replacement_count: 1, transport_sha256: sha(unweightedSource), production_files_modified: false },
  seed: initialSeed, trials, feasible, infeasible, radius_counts: radiusCounts,
  max_absolute_optimal_cost_difference: maxDifference, absolute_cost_tolerance: 1e-10,
  default_weight_parity_cases: defaultCases, weights_tested: weights,
  simulator_collision: simulator,
  independent_two_packet_integrated_cost: { unit_objective_ablation: areaCost(unitPair.destination), production_weighted: areaCost(weightedPair.destination) },
  permanent_test_ablation: testAblation,
  limitations: [
    'The objective is occupied-rock bulk-area squared allocation displacement, not a physical advection error estimate.',
    'Weighting retains the existing capacity, stencil, and indivisible-packet restrictions; it does not prove global grid convergence.',
    'Tiny-weight ties use absolute objective tolerance 1e-10; their relative error can be large while total objective error is negligible.',
    'Default-weight parity compares the same production solver with a unit-cost ablation, not an independently loaded historical revision.',
    'This audit does not resolve independent material-centroid sampling or physical-fault-classification limitations.',
    'Only synthetic fixtures and implementation/test source were read; no observational or holdout files were read.',
  ],
};
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ status: report.status, trials, feasible, infeasible, max_absolute_optimal_cost_difference: maxDifference,
  default_weight_parity_cases: defaultCases, simulator_fixtures: simulator.length, permanent_test_ablation: testAblation, output }, null, 2));
