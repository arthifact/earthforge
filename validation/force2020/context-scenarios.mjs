#!/usr/bin/env node
// Pre-registered, development-only test of burial-state context (area versus
// lithostratigraphic group) with unchanged coefficients; see context-plan.json.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { loadPhysics, parseWindows, groupMetrics, bootstrapMean, breakdown, pairedDifference } from './calibrate.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const BIN = 20;

/** 1 m slowness quadrature of the unchanged law under a burial-state offset. */
export function windowVelocity(physics, f, depthMid, delta) {
  let slowness = 0;
  for (let m = 0; m < BIN; m++) {
    const d = depthMid - BIN / 2 + m + 0.5;
    let v;
    if (delta >= 0) v = physics.rockVelocity(f, d, false, null, { maxBurial: d + delta, maxEffectiveDepth: d + delta });
    else { const de = Math.max(0, d + delta); v = physics.rockVelocity(f, de, false, null, { maxBurial: d, maxEffectiveDepth: de }); }
    slowness += 1 / v;
  }
  return BIN / slowness;
}

const fractionOf = (row) => (row.facies_code === 30000 ? 1 : 0);
const unitKey = (row, key) => (key === 'all' ? 'all' : String(row[key]));

/** Offsets per unit for each key; delta(row) is their sum. */
export const offsetOf = (offsets, keys, row) => keys.reduce((s, k) => s + (offsets[k][unitKey(row, k)] ?? 0), 0);

/** Minimize a 1-D function on [lo, hi]: coarse scan, then golden-section refinement. */
export function minimize1d(f, lo, hi, points = 25, iterations = 40) {
  let best = lo, bestValue = Infinity;
  const values = [];
  for (let i = 0; i < points; i++) { const x = lo + (hi - lo) * i / (points - 1); const v = f(x); values.push(v); if (v < bestValue) { bestValue = v; best = x; } }
  const k = values.indexOf(bestValue), step = (hi - lo) / (points - 1);
  let a = Math.max(lo, best - step), b = Math.min(hi, best + step);
  const g = (Math.sqrt(5) - 1) / 2;
  let x1 = b - g * (b - a), x2 = a + g * (b - a), f1 = f(x1), f2 = f(x2);
  for (let i = 0; i < iterations; i++) {
    if (f1 < f2) { b = x2; x2 = x1; f2 = f1; x1 = b - g * (b - a); f1 = f(x1); } else { a = x1; x1 = x2; f1 = f2; x2 = a + g * (b - a); f2 = f(x2); }
  }
  const x = f1 < f2 ? x1 : x2, v = Math.min(f1, f2);
  return v < bestValue ? { x, value: v } : { x: best, value: bestValue };
}

/** Fit offsets on training rows; equal parent weight; units absent from training stay at zero. */
export function fitOffsets(physics, plan, keys, rows, sweeps = 4) {
  const wellCount = new Map();
  for (const r of rows) wellCount.set(r.group, (wellCount.get(r.group) ?? 0) + 1);
  const nWells = wellCount.size, weight = rows.map((r) => 1 / wellCount.get(r.group) / nWells);
  const offsets = Object.fromEntries(keys.map((k) => [k, {}]));
  const [lo, hi] = plan.burial_state_offset.bounds_m;
  const passes = keys.length > 1 ? sweeps : 1;
  for (let sweep = 0; sweep < passes; sweep++) {
    for (const key of keys) {
      const byUnit = new Map();
      rows.forEach((r, i) => { const u = unitKey(r, key); if (!byUnit.has(u)) byUnit.set(u, []); byUnit.get(u).push(i); });
      for (const [unit, idx] of byUnit) {
        const others = keys.filter((k) => k !== key);
        const base = idx.map((i) => offsetOf(offsets, others, rows[i]));
        const f = (delta) => { let s = 0; for (let j = 0; j < idx.length; j++) { const r = rows[idx[j]]; const e = windowVelocity(physics, fractionOf(r), r.depth_m, base[j] + delta) - r.observed_m_s; s += weight[idx[j]] * e * e; } return s; };
        offsets[key][unit] = minimize1d(f, lo, hi).x;
      }
    }
  }
  return offsets;
}

export const predict = (physics, offsets, keys, rows) => rows.map((r) => windowVelocity(physics, fractionOf(r), r.depth_m, offsetOf(offsets, keys, r)));

export function crossValidate(physics, plan, keys, rows, foldKey, log = () => {}) {
  const folds = [...new Set(rows.map((r) => String(r[foldKey])))].sort();
  const predicted = new Array(rows.length).fill(NaN), fits = {};
  folds.forEach((held, k) => {
    const train = rows.filter((r) => String(r[foldKey]) !== held);
    const offsets = fitOffsets(physics, plan, keys, train);
    fits[held] = offsets;
    rows.forEach((r, i) => { if (String(r[foldKey]) === held) predicted[i] = windowVelocity(physics, fractionOf(r), r.depth_m, offsetOf(offsets, keys, r)); });
    log(`  ${foldKey} fold ${k + 1}/${folds.length} ${held}`);
  });
  return { predicted, fits };
}

function unitTable(rows, offsets, keys, fits) {
  const table = {};
  for (const key of keys) {
    table[key] = {};
    for (const [unit, delta] of Object.entries(offsets[key])) {
      const members = rows.filter((r) => unitKey(r, key) === unit);
      const folded = Object.values(fits).map((f) => f[key][unit]).filter((v) => v !== undefined);
      table[key][unit] = { offset_m: delta, windows: members.length, wells: new Set(members.map((r) => r.well)).size,
        fold_range_m: folded.length ? [Math.min(...folded), Math.max(...folded)] : null };
    }
  }
  return table;
}

function contextBreakdown(rows, predicted) {
  const by = (key) => { const out = {}; for (const u of [...new Set(rows.map((r) => String(r[key])))].sort()) { const idx = rows.map((r, i) => (String(r[key]) === u ? i : -1)).filter((i) => i >= 0); const m = groupMetrics(idx.map((i) => rows[i]), idx.map((i) => predicted[i])); delete m.perGroup; out[u] = m; } return out; };
  return { ...breakdown(rows, predicted), by_quadrant: by('quadrant'), by_group: by('group_unit') };
}

async function main() {
  const planText = await readFile(new URL('./context-plan.json', import.meta.url), 'utf8');
  const plan = JSON.parse(planText);
  const windowsPath = process.argv[2] || resolve(root, 'data/force2020/comparison/primary-windows-context.csv');
  const outDir = process.argv[3] || resolve(root, 'data/force2020/context');
  const windowsText = await readFile(windowsPath, 'utf8');
  const rows = parseWindows(windowsText);
  for (const k of ['group_unit', 'quadrant', 'block']) if (rows.some((r) => !r[k])) throw new Error(`window without ${k}`);
  const physics = await loadPhysics();
  // Self-check: a zero offset must reproduce the stored untuned predictions.
  const zero = rows.map((r) => windowVelocity(physics, fractionOf(r), r.depth_m, 0));
  const gap = Math.max(...rows.map((r, i) => Math.abs(zero[i] - r.present_hydrostatic)));
  if (!(gap <= 1e-6)) throw new Error(`zero offset differs from stored predictions by ${gap} m/s`);
  if (rows.some((r) => !Number.isFinite(r.baseline_loo))) throw new Error('stored baseline predictions are missing');
  const untunedCol = rows.map((r) => r.present_hydrostatic), baselineCol = rows.map((r) => r.baseline_loo);
  const strip = (m) => { const { perGroup, ...rest } = m; return rest; };
  const report = {
    plan_sha256: hash(planText), windows_sha256: hash(windowsText), simulator_source_sha256: hash(await readFile(resolve(root, 'src/basin.ts'))),
    windows: rows.length, wells: new Set(rows.map((r) => r.well)).size, quadrants: new Set(rows.map((r) => r.quadrant)).size, groups: new Set(rows.map((r) => r.group_unit)).size,
    untuned: { ...strip(groupMetrics(rows, untunedCol)), ...contextBreakdown(rows, untunedCol) },
    baseline_loo: { ...strip(groupMetrics(rows, baselineCol)), ...contextBreakdown(rows, baselineCol) }, models: {},
  };
  const perWindow = rows.map((r) => ({ well: r.well, group: r.group, quadrant: r.quadrant, block: r.block, group_unit: r.group_unit, bin: r.bin, depth_m: r.depth_m, facies_code: r.facies_code, observed_m_s: r.observed_m_s, present_hydrostatic: r.present_hydrostatic, baseline_loo: r.baseline_loo }));
  for (const [name, model] of Object.entries(plan.models)) {
    console.log(`${name}: ${model.keys.join(' + ')}`);
    const full = fitOffsets(physics, plan, model.keys, rows);
    const inSample = predict(physics, full, model.keys, rows);
    const byWell = crossValidate(physics, plan, model.keys, rows, 'group', (s) => process.stdout.write(s + '\n'));
    const byQuadrant = crossValidate(physics, plan, model.keys, rows, 'quadrant');
    const looMetrics = groupMetrics(rows, byWell.predicted);
    report.models[name] = {
      keys: model.keys, meaning: model.meaning, units: Object.values(full).reduce((s, o) => s + Object.keys(o).length, 0),
      offsets: unitTable(rows, full, model.keys, byWell.fits),
      in_sample: { ...strip(groupMetrics(rows, inSample)), ...contextBreakdown(rows, inSample) },
      leave_one_well_out: { ...strip(looMetrics), ...contextBreakdown(rows, byWell.predicted), mae_bootstrap_95_percent: bootstrapMean(Object.values(looMetrics.perGroup).map((s) => s[1]), plan.bootstrap) },
      leave_one_quadrant_out: { ...strip(groupMetrics(rows, byQuadrant.predicted)), ...contextBreakdown(rows, byQuadrant.predicted) },
      cv_minus_untuned_mae: pairedDifference(rows, byWell.predicted, untunedCol, plan.bootstrap),
      cv_minus_baseline_mae: pairedDifference(rows, byWell.predicted, baselineCol, plan.bootstrap),
    };
    perWindow.forEach((w, i) => { w[`${name}_loo_well`] = byWell.predicted[i]; w[`${name}_loo_quadrant`] = byQuadrant.predicted[i]; w[`${name}_in_sample`] = inSample[i]; });
    const m = report.models[name];
    console.log(`  LOO-well MAE ${m.leave_one_well_out.mae_m_s.toFixed(1)}  LOO-quadrant MAE ${m.leave_one_quadrant_out.mae_m_s.toFixed(1)}  in-sample ${m.in_sample.mae_m_s.toFixed(1)}  (untuned ${report.untuned.mae_m_s.toFixed(1)}, baseline ${report.baseline_loo.mae_m_s.toFixed(1)})`);
  }
  const ranked = Object.entries(report.models).sort(([, x], [, y]) => (x.leave_one_well_out.mae_m_s - y.leave_one_well_out.mae_m_s) || (x.units - y.units));
  let chosen = ranked[0];
  for (const c of ranked) if (c[1].units < chosen[1].units && c[1].leave_one_well_out.mae_m_s - ranked[0][1].leave_one_well_out.mae_m_s <= 5) chosen = c;
  const interval = chosen[1].cv_minus_untuned_mae.parent_bootstrap_95_percent_m_s;
  report.selection = { rule: plan.selection_rule, best_by_loo_well_mae: ranked[0][0], chosen: chosen[0], recorded_as_scenario: interval[1] < 0, cv_minus_untuned_interval_m_s: interval,
    note: interval[1] < 0 ? 'interval excludes zero; record the chosen model as a regional scenario table' : 'interval includes zero; record nothing' };
  await mkdir(outDir, { recursive: true });
  await writeFile(resolve(outDir, 'context.json'), JSON.stringify(report, null, 2) + '\n');
  const cols = Object.keys(perWindow[0]);
  await writeFile(resolve(outDir, 'context-windows.csv'), [cols.join(','), ...perWindow.map((w) => cols.map((c) => w[c]).join(','))].join('\n') + '\n');
  console.log(JSON.stringify(report.selection, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
