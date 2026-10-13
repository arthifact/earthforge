#!/usr/bin/env node
// Derive compact evidence from saved synthetic operation traces. No simulation,
// observation access, calibration, or modification of the frozen metric.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { totalsByUnit, ADDITIVE } from './diagnostics.mjs';
const root = fileURLToPath(new URL('../..', import.meta.url));
const read = async p => JSON.parse(await readFile(resolve(root, p), 'utf8'));
const folder = 'data/numerics/convergence-diagnostics';
const summary = await read(`${folder}/summary.json`), ablation = await read('data/numerics/compaction-ablation/summary.json');
const baseline = await read('data/numerics/conservative-thrust/summary.json');
const hash = x => createHash('sha256').update(x).digest('hex');
for (const [path, digest] of Object.entries(summary.source_sha256)) assert.equal(hash(await readFile(resolve(root, path))), digest, `Changed diagnostic source: ${path}`);
assert.equal(summary.plan_sha256, ablation.plan_sha256);
const bundle = await build({ entryPoints: [resolve(root, 'src/basin.ts')], bundle: true, platform: 'node', format: 'esm', write: false });
const { porosity, effectiveDepth } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
const result = { version: 1, plan_sha256: summary.plan_sha256, observational_data: 'none',
  source_sha256: { ...summary.source_sha256, 'validation/numerics/diagnosis-evidence.mjs': hash(await readFile(fileURLToPath(import.meta.url))) },
  baseline_preserved: summary.cases.every(c => c.grids.every(g => g.frozen_sample_exact)),
  closed_runs: summary.cases.reduce((s, c) => s + c.grids.filter(g => g.grain_budget_closed).length, 0),
  budget_events: summary.cases.reduce((s, c) => s + c.grids.reduce((n, g) => n + g.events, 0), 0),
  all: summary.summary.all, noncontracting: summary.summary.noncontracting,
  max_lookup_difference_m_s: summary.summary.max_lookup_difference_m_s,
  max_substitution_residual_m_s: summary.summary.max_substitution_residual_m_s,
  by_family: {}, by_grid: [], examples: [], ablation: ablation.cases };
for (const [family, r] of Object.entries(summary.summary.by_family)) result.by_family[family] = {
  ...r, share_of_fine_squared_difference: r.fine_sse / summary.summary.all.fine_sse };
const details = new Map();
for (const c of summary.cases) for (const g of c.grids) {
  const d = await read(`${folder}/${g.detail_file}`); details.set(`${c.id}:${g.h}`, d);
  // Check the telescoping identity for vanished units as well as survivors.
  const final = new Map(d.final_columns.flatMap(col => [...totalsByUnit(col)].map(([unit, v]) => [`unit:${unit}:${col.x}`, v])));
  for (const [key, processes] of Object.entries(d.changes_by_unit_and_process)) for (const metric of ADDITIVE) {
    const sum = Object.values(processes).reduce((s, p) => s + p[metric], 0), expected = final.get(key)?.[metric] ?? 0;
    assert.ok(Math.abs(sum - expected) <= 1e-7 + 1e-12 * Math.abs(expected), `Event total mismatch: ${c.id}/${g.h}/${key}/${metric}`);
  }
}
for (const h of [40, 20, 10]) {
  const grids = summary.cases.map(c => c.grids.find(g => g.h === h));
  const total = (group, key) => grids.reduce((s, g) => s + g[group][key], 0);
  result.by_grid.push({ h, compaction_run_events: total('compaction', 'run_events'),
    minimum_cell_limited_events: total('compaction', 'minimum_cell_limited_events'),
    root_rounding_disagreements: total('compaction', 'root_rounding_disagreements'),
    deposition_column_events: total('deposition', 'column_events'),
    zero_cell_deposition_events: total('deposition', 'zero_cell_events'),
    underresolved_deposition_events: total('deposition', 'underresolved_events'),
    missing_depositional_bed_appearances: total('deposition', 'missing_bed_appearances') });
}
for (const { case: id, key } of (await read('validation/numerics/diagnostics-plan.json')).targets) {
  const [, unitText, xText] = key.split(':'), unit = Number(unitText), x = Number(xText);
  const original = await read(`data/numerics/conservative-thrust/${id}-matched.json`);
  const example = { case: id, key, grids: [] };
  for (const [j, h] of [40, 20, 10].entries()) {
    const d = details.get(`${id}:${h}`), column = d.final_columns.find(c => c.x === x), runs = column.runs.filter(r => r.unit === unit);
    const interval = original.samples[j].intervals.find(r => r.key === key), span = interval.spans[0];
    const cells = runs.filter(r => r.start >= span[0] && r.end <= span[1]).flatMap(r => r.cells);
    // The option is a probability, not the realized pressure top. These saved
    // traces do not retain that top, so report this additional porosity check
    // only for controls prescribed to be hydrostatic (probability zero).
    const hydrostatic = baseline.cases.find(c => c.id === id).grids[j].options.overpressure === 0;
    const meanPhi = hydrostatic ? cells.reduce((s, c) => s + porosity(c.fraction,
      Math.max(c.loading, effectiveDepth(c.depth, null)), c.carbonate), 0) / cells.length : null;
    const lastStep = Math.max(-1, ...d.selected_compaction.map(r => r.step));
    const last = d.selected_compaction.filter(r => r.step === lastStep && r.unit === unit && r.x === x);
    example.grids.push({ h, ...interval.metrics, raster_porosity: interval.metrics.porosity,
      rock_formula_mean_porosity: meanPhi, porosity_gap: meanPhi === null ? null : interval.metrics.porosity - meanPhi,
      final_bed_cells: runs.map(r => ({ bed: r.bed, cells: r.end - r.start })),
      last_compaction_desired_total_m: last.length ? last.reduce((s, r) => s + r.desired_m, 0) : null,
      last_compaction_minimum_cell_beds: last.filter(r => r.minimum_cell_limited).length,
      deposited: d.selected_traces.find(r => r.key === key && r.process === 'deposition' && r.step === unit),
      before_deposition: d.selected_traces.find(r => r.key === key && r.process === 'erosion' && r.step === unit),
      deposition_resolution: d.deposition.selected.find(r => r.step === unit && r.x === x),
      whole_column_changes_by_process: d.changes_by_unit_and_process[key] });
  }
  result.examples.push(example);
}
await writeFile(resolve(root, 'validation/numerics/convergence-diagnosis-evidence.json'), JSON.stringify(result, null, 2) + '\n');
console.log(`${result.closed_runs} unchanged, closed runs; ${result.budget_events} events; all column process totals telescope, including vanished units.`);
