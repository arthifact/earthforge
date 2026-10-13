#!/usr/bin/env node
// Exploratory mechanism probe: turn off compaction in the two frozen no-fault
// controls. This deliberately changes physics and is NOT a proposed fix or a
// replacement refinement score. Compare only triples shared by both variants.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { extract, compare, summarize } from './metrics.mjs';
const root = fileURLToPath(new URL('../..', import.meta.url));
const [outArg, ...extra] = process.argv.slice(2);
if (extra.length || outArg?.startsWith('-')) throw Error('Usage: compaction-ablation.mjs [output-directory]');
const out = resolve(outArg ?? resolve(root, 'data/numerics/compaction-ablation'));
if (out.split(/[\\/]/).some(p => /force|holdout/i.test(p))) throw Error('Outputs must not target observations');
const hash = value => createHash('sha256').update(value).digest('hex');
const read = async p => JSON.parse(await readFile(resolve(root, p), 'utf8'));
const planBytes = await readFile(resolve(root, 'validation/numerics/plan.json')), plan = JSON.parse(planBytes);
const baseline = await read('data/numerics/conservative-thrust/summary.json');
// These archived probes describe the old whole-cell mechanism. Refuse a
// different simulator: comparing a new ablation to an old control is invalid.
for (const file of ['src/basin.ts', 'src/conservativeTransport.ts', 'src/sedimentBudget.ts', 'src/window.ts', 'validation/numerics/metrics.mjs']) {
  assert.equal(hash(await readFile(resolve(root, file))), baseline.source_sha256[file],
    `Historical probe requires the conservative-thrust source revision (${file} differs). Read the saved results or prepare a fresh control and probe at the same revision.`);
}

assert.equal(hash(planBytes), baseline.plan_sha256);
const bundle = await build({ entryPoints: [resolve(root, 'src/basin.ts')], bundle: true, platform: 'node', format: 'esm', write: false });
const { simulate, BASIN_DEFAULTS, windowOf, layerVelocity } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
const result = { version: 1, exploratory: true, plan_sha256: hash(planBytes), intervention: 'compaction=false in the two no-fault compaction controls only',
  caveat: 'A different physical model, not a remedy or an accuracy improvement. Same-cohort comparisons are still selected by eligibility in both variants.',
  observational_data: 'none', source_sha256: {}, cases: [] };
for (const f of ['src/basin.ts', 'src/conservativeTransport.ts', 'src/sedimentBudget.ts', 'src/window.ts', 'validation/numerics/metrics.mjs', 'validation/numerics/compaction-ablation.mjs']) result.source_sha256[f] = hash(await readFile(resolve(root, f)));
await mkdir(out, { recursive: true });
for (const id of ['compaction-a', 'compaction-b']) {
  const { name, ...options } = plan.cases.find(c => c.name === id);
  assert.deepEqual(options.faults, [0, 0]); assert.equal(options.quiet, true);
  const old = await read(`data/numerics/conservative-thrust/${id}-matched.json`), samples = [], histories = [], budgets = [];
  for (const h of plan.grids_m) {
    const b = simulate({ ...BASIN_DEFAULTS, ...options, h, record: false, compaction: false });
    histories.push(hash(JSON.stringify(b.historyPlan))); assert.equal(histories.at(-1), old.history_hash);
    assert.equal(b.budget.summary.closed, true); budgets.push({ h, closed: true, events: b.budget.entries.length });
    samples.push(extract(b, plan, windowOf, layerVelocity));
  }
  const off = compare(samples, histories), oldMap = new Map(old.series.map(r => [`${r.key}|${r.metric}`, r]));
  const pairs = off.series.filter(r => oldMap.has(`${r.key}|${r.metric}`)).map(r => [oldMap.get(`${r.key}|${r.metric}`), r]);
  const metrics = Object.fromEntries(Object.keys(off.metrics).map(metric => [metric, {
    original: summarize(pairs.filter(p => p[0].metric === metric).map(p => p[0])),
    compaction_off: summarize(pairs.filter(p => p[1].metric === metric).map(p => p[1])) }]));
  result.cases.push({ id, history_hash: old.history_hash, budgets, original_matched: old.metrics.thickness_m.n,
    ablation_matched: off.metrics.thickness_m.n, common_matched: metrics.thickness_m.original.n, metrics });
  await writeFile(resolve(out, `${id}-matched.json`), JSON.stringify({ id, samples, ...off }, null, 2) + '\n');
  console.log(`${id}: ${metrics.thickness_m.original.n} shared triples; velocity fine RMS ${metrics.effective_velocity_m_s.original.fine_rms.toFixed(2)} -> ${metrics.effective_velocity_m_s.compaction_off.fine_rms.toFixed(2)} m/s with compaction disabled (different physics).`);
}
await writeFile(resolve(out, 'summary.json'), JSON.stringify(result, null, 2) + '\n');
