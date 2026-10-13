#!/usr/bin/env node
// Reads enumerated simulator sources, frozen synthetic plans and synthetic results
// only. This runner never imports or opens observational data.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { extract, summarize } from './metrics.mjs';
import { columnAt, totalsByUnit, ADDITIVE, compactionRows, velocityAttribution, noncontracting } from './diagnostics.mjs';
const root = fileURLToPath(new URL('../..', import.meta.url));
const [outArg, onlyCase, ...extra] = process.argv.slice(2);
if (extra.length || outArg?.startsWith('-')) throw Error('Usage: diagnose.mjs [output-directory] [planned-case-name]');
const out = resolve(outArg ?? resolve(root, 'data/numerics/convergence-diagnostics'));
if (out.split(/[\\/]/).some(p => /force|holdout/i.test(p))) throw Error('Outputs must not target observations');
const read = async name => JSON.parse(await readFile(resolve(root, name), 'utf8'));
const hash = value => createHash('sha256').update(value).digest('hex');
const planBytes = await readFile(resolve(root, 'validation/numerics/plan.json'));
const plan = JSON.parse(planBytes), diagnosticsPlan = await read('validation/numerics/diagnostics-plan.json');
const baseline = await read('data/numerics/conservative-thrust/summary.json');
// These archived probes describe the old whole-cell mechanism. Refuse a
// different simulator: comparing a new ablation to an old control is invalid.
for (const file of ['src/basin.ts', 'src/conservativeTransport.ts', 'src/sedimentBudget.ts', 'src/window.ts', 'validation/numerics/metrics.mjs']) {
  assert.equal(hash(await readFile(resolve(root, file))), baseline.source_sha256[file],
    `Historical probe requires the conservative-thrust source revision (${file} differs). Read the saved results or prepare a fresh control and probe at the same revision.`);
}

assert.equal(hash(planBytes), baseline.plan_sha256, 'Frozen plan changed');
if (onlyCase && !plan.cases.some(c => c.name === onlyCase)) throw Error('Case is not in the frozen plan');
await mkdir(out, { recursive: true });
const files = ['src/basin.ts', 'src/conservativeTransport.ts', 'src/sedimentBudget.ts', 'src/window.ts',
  'validation/numerics/metrics.mjs', 'validation/numerics/diagnostics.mjs', 'validation/numerics/diagnose.mjs', 'validation/numerics/diagnostics-plan.json'];
const sourceHashes = Object.fromEntries(await Promise.all(files.map(async f => [f, hash(await readFile(resolve(root, f)))])));
const bundle = await build({ entryPoints: [resolve(root, 'src/basin.ts')], bundle: true, platform: 'node', format: 'esm', write: false });
const { simulate, BASIN_DEFAULTS, windowOf, layerVelocity, porosity, effectiveDepth, rockVelocity } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
const result = { version: 1, exploratory: true, plan_sha256: hash(planBytes), source_sha256: sourceHashes,
  baseline_source_sha256: baseline.source_sha256, runtime: process.version, observational_data: 'none', cases: [] };
const zeros = () => Object.fromEntries(ADDITIVE.map(k => [k, 0]));
const allRows = [];
for (const spec of plan.cases.filter(c => !onlyCase || c.name === onlyCase)) {
  const { name: id, ...overrides } = spec;
  const old = await read(`data/numerics/conservative-thrust/${id}-matched.json`);
  const targets = diagnosticsPlan.targets.filter(t => t.case === id).map(t => t.key);
  const finalColumns = [], perGrid = [];
  for (const [gj, h] of plan.grids_m.entries()) {
    let previous = new Map(), beforeCompaction;
    const changes = new Map(), traces = [], compactionTrace = [];
    const compaction = { run_events: 0, one_cell_events: 0, minimum_cell_limited_events: 0,
      root_rounding_disagreements: 0, max_grain_change_m: 0, max_root_residual_m: 0, max_thickness_excess_m: 0, last_step: [] };
    const deposition = { column_events: 0, zero_cell_events: 0, underresolved_events: 0, missing_bed_appearances: 0, selected: [] };
    let lastCompactionStep = -1, events = 0;
    const options = { ...BASIN_DEFAULTS, ...overrides, h, record: false };
    const b = simulate(options, state => {
      events++;
      const columns = plan.profile_x_m.map(x => columnAt(state, x));
      const current = new Map(columns.flatMap(c => [...totalsByUnit(c)].map(([unit, totals]) => [`unit:${unit}:${c.x}`, totals])));
      for (const key of new Set([...previous.keys(), ...current.keys()])) {
        const a = previous.get(key) ?? zeros(), c = current.get(key) ?? zeros();
        if (!changes.has(key)) changes.set(key, {});
        const byProcess = changes.get(key), delta = byProcess[state.process] ??= zeros();
        for (const metric of ADDITIVE) delta[metric] += c[metric] - a[metric];
      }
      for (const key of targets) {
        const [, unitText, xText] = key.split(':'), unit = Number(unitText), x = Number(xText);
        const column = columns.find(c => c.x === x), runs = column.runs.filter(r => r.unit === unit);
        traces.push({ step: state.step, process: state.process, fault: state.fault, key,
          floor_m: column.floor_m, top_m: runs.length ? runs[0].start * h : null,
          beds: runs.map(r => ({ bed: r.bed, cells: r.end - r.start })), ...(current.get(key) ?? zeros()) });
      }
      if (state.process === 'compaction') {
        if (!beforeCompaction) throw Error('Missing pre-compaction deposition observation');
        if (lastCompactionStep !== state.step) { compaction.last_step = []; lastCompactionStep = state.step; }
        for (const [j, column] of columns.entries()) for (const r of compactionRows(beforeCompaction[j], column, state.overpressure, porosity, effectiveDepth)) {
          compaction.run_events++; compaction.one_cell_events += r.after_cells === 1;
          compaction.minimum_cell_limited_events += r.minimum_cell_limited;
          compaction.root_rounding_disagreements += r.after_cells !== r.bracketed_root_rounded_cells;
          compaction.max_grain_change_m = Math.max(compaction.max_grain_change_m, Math.abs(r.grain_change_m));
          compaction.max_root_residual_m = Math.max(compaction.max_root_residual_m, Math.abs(r.equation_residual_m));
          compaction.max_thickness_excess_m = Math.max(compaction.max_thickness_excess_m, r.thickness_excess_m);
          compaction.last_step.push(r);
          if (targets.includes(`unit:${r.unit}:${r.x}`)) compactionTrace.push({ step: state.step, ...r });
        }
      }
      if (state.process === 'deposition') {
        beforeCompaction = columns;
        const declared = state.beds.filter(bed => bed.unit === state.step).length;
        for (const column of columns) {
          const runs = column.runs.filter(r => r.unit === state.step);
          const count = runs.reduce((s, r) => s + r.end - r.start, 0);
          deposition.column_events++; deposition.zero_cell_events += count === 0;
          deposition.underresolved_events += count > 0 && count < declared;
          deposition.missing_bed_appearances += declared - runs.length;
          if (targets.includes(`unit:${state.step}:${column.x}`)) deposition.selected.push({ step: state.step, x: column.x, declared_beds: declared, represented_beds: runs.length, deposited_cells: count });
        }
      }
      previous = current;
    });
    const sample = extract(b, plan, windowOf, layerVelocity);
    assert.deepEqual(sample, old.samples[gj], `${id}/${h}: diagnostic observer changed the frozen metrics or coverage`);
    assert.equal(hash(JSON.stringify(b.historyPlan)), old.history_hash);
    assert.equal(b.budget.summary.closed, true);
    const oldGrid = baseline.cases.find(c => c.id === id).grids[gj];
    for (const key of ['total', 'sand', 'shale', 'carbonate']) assert.equal(b.budget.summary.final[key], oldGrid.final[key]);
    for (const [key, final] of previous) for (const metric of ADDITIVE) {
      const sum = Object.values(changes.get(key)).reduce((s, p) => s + p[metric], 0);
      assert.ok(Math.abs(sum - final[metric]) <= 1e-7 + 1e-12 * Math.abs(final[metric]), 'Event attribution does not telescope');
    }
    const columns = plan.profile_x_m.map(x => columnAt(b, x));
    finalColumns.push({ columns, overpressure: b.overpressure, faults: b.faults.map(f => plan.profile_x_m.map(x => f.depth[Math.round((x + 2000) / h)])) });
    const detail = `${id}-${h}m-diagnostics.json`;
    await writeFile(resolve(out, detail), JSON.stringify({ id, h, options, history_hash: old.history_hash, events,
      grain_budget_closed: true, frozen_sample_exact: true, compaction, deposition,
      changes_by_unit_and_process: Object.fromEntries(changes), selected_traces: traces,
      selected_compaction: compactionTrace, final_columns: columns }, null, 2) + '\n');
    perGrid.push({ h, events, grain_budget_closed: true, frozen_sample_exact: true, detail_file: detail,
      deposition: Object.fromEntries(Object.entries(deposition).filter(([key]) => key !== 'selected')),
      compaction: Object.fromEntries(Object.entries(compaction).filter(([key]) => key !== 'last_step')) });
    console.log(`${id}, ${h} m: exact frozen metrics; budget closed; ${compaction.minimum_cell_limited_events}/${compaction.run_events} compaction run-events need less than one cell`);
  }
  const rows = [];
  for (const r of old.series.filter(r => r.metric === 'effective_velocity_m_s')) {
    const [, unitText, xText] = r.key.split(':'), unit = Number(unitText), x = Number(xText);
    const cells = finalColumns.map((f, gj) => {
      const column = f.columns.find(c => c.x === x), span = old.samples[gj].intervals.find(s => s.key === r.key).spans[0];
      return column.runs.filter(run => run.unit === unit && run.start >= span[0] && run.end <= span[1]).flatMap(run => run.cells);
    });
    assert.ok(cells.every(c => c.length > 0));
    const coarse = velocityAttribution(cells[0], cells[1], finalColumns[0].overpressure, rockVelocity);
    const fine = velocityAttribution(cells[1], cells[2], finalColumns[0].overpressure, rockVelocity);
    const direct = [coarse.values[0], coarse.values[7], fine.values[7]];
    const tableDifference = r.values.map((v, j) => v - direct[j]);
    const spans = old.samples.map((s, j) => s.intervals.find(s => s.key === r.key).spans[0].map(k => k * plan.grids_m[j]));
    const distances = finalColumns.map((f, j) => {
      const depths = f.faults.map(a => a[plan.profile_x_m.indexOf(x)]).filter(Number.isFinite);
      return depths.length ? Math.min(...depths.map(z => Math.max(spans[j][0] - z, z - spans[j][1], 0))) : null;
    });
    rows.push({ case: id, ...r, noncontracting: noncontracting(r), cells: cells.map(c => c.length),
      carbonate_fraction: cells.map(c => c.filter(a => a.carbonate).length / c.length),
      lateral_domain_margin_m: Math.min(x + 2000, 11200 - x), vertical_fault_gap_m: distances,
      direct_velocities_m_s: direct, lookup_minus_direct_m_s: tableDifference,
      attribution_40_to_20: coarse, attribution_20_to_10: fine });
  }
  await writeFile(resolve(out, `${id}-attribution.json`), JSON.stringify(rows, null, 2) + '\n');
  allRows.push(...rows);
  result.cases.push({ id, targets, grids: perGrid, matched: rows.length,
    noncontracting: rows.filter(r => r.noncontracting).length, velocity: summarize(rows), attribution_file: `${id}-attribution.json` });
}
const summaryOf = rows => ({ ...summarize(rows), fine_sse: rows.reduce((s, r) => s + r.fine ** 2, 0),
  noncontracting: rows.filter(r => r.noncontracting).length,
  fine_bands_m_s: { under10: rows.filter(r => Math.abs(r.fine) < 10).length,
    from10to50: rows.filter(r => Math.abs(r.fine) >= 10 && Math.abs(r.fine) <= 50).length,
    over50: rows.filter(r => Math.abs(r.fine) > 50).length, over100: rows.filter(r => Math.abs(r.fine) > 100).length },
  // Absolute contribution sums describe state substitutions, not explained variance.
  substitution_absolute_sum_m_s: Object.fromEntries(['present_depth', 'composition', 'memory'].map(g => [g,
    rows.reduce((s, r) => s + Math.abs(r.attribution_20_to_10.groups[g]), 0)])) });
result.summary = { all: summaryOf(allRows), noncontracting: summaryOf(allRows.filter(r => r.noncontracting)),
  by_family: Object.fromEntries(['compaction-', 'normal-', 'thrust-', 'coupled-extension-', 'coupled-compression-']
    .map(prefix => [prefix, summaryOf(allRows.filter(r => r.case.startsWith(prefix)))])),
  max_lookup_difference_m_s: Math.max(...allRows.flatMap(r => r.lookup_minus_direct_m_s.map(Math.abs))),
  max_substitution_residual_m_s: Math.max(...allRows.flatMap(r => [Math.abs(r.attribution_40_to_20.residual), Math.abs(r.attribution_20_to_10.residual)])),
  worst_noncontracting: allRows.filter(r => r.noncontracting).sort((a, b) => Math.abs(b.fine) - Math.abs(a.fine)).slice(0, 20) };
await writeFile(resolve(out, 'summary.json'), JSON.stringify(result, null, 2) + '\n');
console.log(`Saved ${result.cases.length} cases. Diagnosis reproduces the baseline; it is not a new accuracy pass.`);
