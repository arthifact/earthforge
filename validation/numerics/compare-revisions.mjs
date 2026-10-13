#!/usr/bin/env node
// Compare only saved synthetic numerical results, using the same cohort across revisions.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { summarize, INTERVAL_METRICS, FIELD_METRICS } from './metrics.mjs';
const [beforePath, afterPath, outputPath] = process.argv.slice(2);
if (!beforePath || !afterPath || !outputPath) throw Error('Usage: compare-revisions.mjs before-directory after-directory output.json');
const read = async (folder, name) => JSON.parse(await readFile(resolve(folder, name), 'utf8'));
const [before, after] = await Promise.all([read(beforePath, 'summary.json'), read(afterPath, 'summary.json')]);
if (before.plan_sha256 !== after.plan_sha256) throw Error('Refinement plans differ');
if (JSON.stringify(before.cases.map(c => c.id)) !== JSON.stringify(after.cases.map(c => c.id))) throw Error('Case identities differ');
const cases = [], oldRows = [], newRows = [];
for (let i = 0; i < before.cases.length; i++) {
  const a = before.cases[i], b = after.cases[i];
  if (JSON.stringify(a.grids.map(g => g.history_hash)) !== JSON.stringify(b.grids.map(g => g.history_hash))) throw Error(`Prescribed history changed: ${a.id}`);
  const [oldDetail, newDetail] = await Promise.all([read(beforePath, a.detail_file), read(afterPath, b.detail_file)]);
  const key = r => `${r.key}|${r.metric}`;
  const oldMap = new Map(oldDetail.series.map(r => [key(r), r]));
  const pairs = newDetail.series.filter(r => oldMap.has(key(r))).map(r => [oldMap.get(key(r)), r]);
  oldRows.push(...pairs.map(p => p[0])); newRows.push(...pairs.map(p => p[1]));
  cases.push({ id: a.id, before_matched: a.coverage.matched, after_matched: b.coverage.matched,
    shared_intervals: pairs.filter(p => p[0].metric === 'thickness_m').length,
    metrics: Object.fromEntries([...INTERVAL_METRICS, ...FIELD_METRICS].map(metric => [metric, {
      before: summarize(pairs.filter(p => p[0].metric === metric).map(p => p[0])),
      after: summarize(pairs.filter(p => p[1].metric === metric).map(p => p[1])) }])) });
}
const result = { plan_sha256: before.plan_sha256, before_source: before.source_sha256, after_source: after.source_sha256,
  cases, metrics: Object.fromEntries([...INTERVAL_METRICS, ...FIELD_METRICS].map(metric => [metric, {
    before: summarize(oldRows.filter(r => r.metric === metric)), after: summarize(newRows.filter(r => r.metric === metric)) }])) };
await writeFile(outputPath, JSON.stringify(result, null, 2) + '\n');
console.log(`${result.metrics.thickness_m.after.n} common unit/location triples across both revisions; all prescribed histories unchanged.`);
