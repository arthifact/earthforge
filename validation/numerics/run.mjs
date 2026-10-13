#!/usr/bin/env node
// Deliberately no observational-data imports. All paths read are enumerated here.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, relative } from 'node:path';
import { build } from 'esbuild';
import { extract, compare, summarize, INTERVAL_METRICS, FIELD_METRICS } from './metrics.mjs';
const root = fileURLToPath(new URL('../..', import.meta.url));
const args = process.argv.slice(2);
if (args.length > 1 || (args[0] && args[0].startsWith('-'))) throw Error('Usage: node validation/numerics/run.mjs [output-directory]');
const out = args[0] ? resolve(args[0]) : resolve(root, 'data/numerics');
// Avoid overwriting any observational dataset even through an explicitly supplied path.
if (out.split(/[\\/]/).some(p => /force|holdout/i.test(p))) throw Error('Numerical outputs must not target observational data');
await mkdir(out, { recursive: true });
const hash = x => createHash('sha256').update(x).digest('hex');
const planBytes = await readFile(resolve(root, 'validation/numerics/plan.json'));
const plan = JSON.parse(planBytes);
const sourceFiles = ['src/basin.ts', 'src/conservativeTransport.ts', 'src/strata.ts', 'src/normalTransport.ts', 'src/sedimentBudget.ts', 'src/window.ts', 'validation/numerics/metrics.mjs', 'validation/numerics/run.mjs'];
const hashes = Object.fromEntries(await Promise.all(sourceFiles.map(async p => [p, hash(await readFile(resolve(root, p)))])));
const bundle = await build({ entryPoints: [resolve(root, 'src/basin.ts')], bundle: true, platform: 'node', format: 'esm', write: false });
const { simulate, BASIN_DEFAULTS, windowOf, layerVelocity } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
const result = { version: 1, plan_sha256: hash(planBytes), source_sha256: hashes, runtime: process.version,
  observational_data: 'none; FORCE development and holdout not read', grids_m: plan.grids_m, cases: [], metrics: {} };
const allSeries = [];
for (const spec of plan.cases) {
  const { name: id, ...overrides } = spec;
  if (!id) throw Error("Each planned case must have a name");
  const samples = [], historyHashes = [], grids = [];
  for (const h of plan.grids_m) {
    const options = { ...BASIN_DEFAULTS, ...overrides, h, record: false };
    const b = simulate(options);
    const historyHash = hash(JSON.stringify(b.historyPlan));
    historyHashes.push(historyHash); samples.push(extract(b, plan, windowOf, layerVelocity));
    const detail = `${id}-${h}m-budget.json`;
    await writeFile(resolve(out, detail), JSON.stringify({ id, options, history_hash: historyHash, transport: b.checks.transport, ...b.budget }, null, 2) + '\n');
    const { byBed, byBedComponents, ...residual } = b.budget.summary.residual;
    const { summary } = b.budget;
    const scalar = a => Object.fromEntries(['total', 'sand', 'shale', 'carbonate'].map(k => [k, a[k]]));
    grids.push({ h, options, history_hash: historyHash, width_m: b.budget.width, depth_m: b.budget.depth,
      events: summary.events, failed_events: summary.failedEvents, closed: summary.closed,
      initial: scalar(summary.initial), final: scalar(summary.final), deposited: scalar(summary.flux.deposited), eroded: scalar(summary.flux.eroded),
      inflow: Object.fromEntries(Object.entries(summary.flux.inflow).map(([k, v]) => [k, scalar(v)])),
      outflow: Object.fromEntries(Object.entries(summary.flux.outflow).map(([k, v]) => [k, scalar(v)])),
      repair_added: scalar(summary.flux.repairAdded), residual, absolute_event_residual: scalar(summary.absoluteEventResidual),
      max_event_residual_m2: summary.maxEventResidual, max_normalized_event_residual: summary.maxNormalizedEventResidual,
      by_process: Object.fromEntries(Object.entries(summary.byProcess).map(([k, v]) => [k, { events: v.events, failed: v.failed, signed: scalar(v.signedResidual), absolute: scalar(v.absoluteResidual) }])),
      transport: { expanded_steps: b.checks.transport.filter(t => t.radius === 3).length, parcels: b.checks.transport.reduce((n, t) => n + t.parcels, 0), displaced: b.checks.transport.reduce((n, t) => n + t.displaced, 0), max_offset_cells: Math.max(0, ...b.checks.transport.map(t => t.maxOffsetCells)) },
      detail_file: detail });
    console.log(`${id}, ${h} m: ${summary.failedEvents}/${summary.events} budget events fail; residual ${summary.residual.total.toFixed(3)} m²`);
  }
  const comparison = compare(samples, historyHashes);
  const detail = `${id}-matched.json`;
  await writeFile(resolve(out, detail), JSON.stringify({ id, samples, ...comparison }, null, 2) + '\n');
  allSeries.push(...comparison.series.map(r => ({ case: id, ...r })));
  const reasons = [0, 1, 2].map(j => Object.fromEntries([...new Set(comparison.coverage.map(c => c.statuses[j]))].sort().map(status => [status, comparison.coverage.filter(c => c.statuses[j] === status).length])));
  result.cases.push({ id, grids, prescribed_history_identical: true, coverage: { candidates: comparison.coverage.length,
    matched: comparison.coverage.filter(c => c.included).length, reasons_by_grid: reasons,
    field_candidates: comparison.fieldCoverage.length, fields_matched: comparison.fieldCoverage.filter(c => c.included).length }, metrics: comparison.metrics, detail_file: detail });
}
result.metrics = Object.fromEntries([...INTERVAL_METRICS, ...FIELD_METRICS].map(m => [m, summarize(allSeries.filter(r => r.metric === m))]));
result.budget = { runs: result.cases.length * 3, closed_runs: result.cases.flatMap(c => c.grids).filter(g => g.closed).length,
  failed_events: result.cases.flatMap(c => c.grids).reduce((s, g) => s + g.failed_events, 0) };
await writeFile(resolve(out, 'summary.json'), JSON.stringify(result, null, 2) + '\n');
await writeFile(resolve(out, 'series.json'), JSON.stringify(allSeries, null, 2) + '\n');
console.log(`Saved ${relative(root, out)}; ${result.budget.closed_runs}/${result.budget.runs} runs close. Refinement is diagnostic, not an accuracy claim.`);

// A completed study is not a physical pass. Preserve results and fail the closure gate.
process.exitCode = result.budget.closed_runs === result.budget.runs ? 0 : 1;
