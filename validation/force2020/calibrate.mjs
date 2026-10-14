#!/usr/bin/env node
// Pre-registered, development-only calibration of the velocity law's coefficients.
// Uses the actual simulator functions; see calibration-plan.json for every rule.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

export async function loadPhysics() {
  const bundle = await build({
    stdin: { contents: 'export {rockVelocity, effectiveDepth, COMPACTION, ROCK} from "./src/basin.ts";', resolveDir: root },
    bundle: true, platform: 'node', format: 'esm', write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
}

export function parseWindows(text) {
  const lines = text.replace(/\r/g, '').trim().split('\n');
  const head = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    const row = {};
    head.forEach((k, i) => { row[k] = cells[i]; });
    for (const k of ['bin', 'facies_code', 'sample_count']) row[k] = parseInt(row[k], 10);
    const text = ['well', 'group', 'constant_sonic', 'bin', 'facies_code', 'sample_count', 'quadrant', 'block', 'group_unit', 'formation_unit', 'group_top_in_window', 'formation_top_in_window'];
    for (const k of head) if (!text.includes(k)) row[k] = parseFloat(row[k]);
    return row;
  });
}

/** Read the current coefficient values the plan's parameters point at. */
export function currentValues(physics, plan) {
  const out = {};
  for (const [name, p] of Object.entries(plan.parameters)) {
    if (p.scenario) { out[name] = null; continue; }
    let node = physics;
    for (const key of p.path) node = node[key];
    out[name] = node;
  }
  return out;
}

/** Override coefficients in memory for one candidate; returns the scenario overpressure top. */
export function applyParameters(physics, plan, values) {
  let overpressure = null;
  // Base paths first, then derived ("plus") paths, so cementTo sees the new cementFrom.
  const entries = Object.entries(values).sort(([a], [b]) => (plan.parameters[a].plus ? 1 : 0) - (plan.parameters[b].plus ? 1 : 0));
  for (const [name, value] of entries) {
    const p = plan.parameters[name];
    if (p.scenario === 'overpressure') { overpressure = value; continue; }
    let node = physics;
    for (const key of p.path.slice(0, -1)) node = node[key];
    node[p.path[p.path.length - 1]] = p.plus ? values[p.plus] + value : value;
  }
  return overpressure;
}

/** Per-facies 20 m bin velocities with 1 m slowness quadrature, as model-profiles.mjs. */
export function makeProfile(physics, benchmark, overpressure) {
  const profile = {};
  const nBins = benchmark.depth_max_m / benchmark.bin_width_m;
  for (const [code, facies] of Object.entries(benchmark.facies)) {
    const f = facies.sand_fraction, bins = new Float64Array(nBins);
    for (let bin = 0; bin < nBins; bin++) {
      let slowness = 0;
      for (let m = 0; m < benchmark.bin_width_m; m++) {
        const depth = bin * benchmark.bin_width_m + m + 0.5;
        const history = { maxBurial: depth, maxEffectiveDepth: physics.effectiveDepth(depth, overpressure) };
        slowness += 1 / physics.rockVelocity(f, depth, false, overpressure, history);
      }
      bins[bin] = benchmark.bin_width_m / slowness;
    }
    profile[code] = bins;
  }
  return profile;
}

export const predictRow = (profile, row) => profile[String(row.facies_code)][row.bin];

/** Equal weight per parent group; returns {bias, mae, rmse, perGroup}. */
export function groupMetrics(rows, predicted) {
  const errors = new Map();
  rows.forEach((r, i) => {
    const e = predicted[i] - r.observed_m_s;
    if (!Number.isFinite(e)) throw new Error('missing prediction');
    if (!errors.has(r.group)) errors.set(r.group, []);
    errors.get(r.group).push(e);
  });
  const groups = [...errors.keys()].sort();
  const stat = groups.map((g) => { const e = errors.get(g); return [mean(e), mean(e.map(Math.abs)), mean(e.map((x) => x * x))]; });
  return { windows: rows.length, groups: groups.length, wells: new Set(rows.map((r) => r.well)).size,
    bias_m_s: mean(stat.map((s) => s[0])), mae_m_s: mean(stat.map((s) => s[1])), rmse_m_s: Math.sqrt(mean(stat.map((s) => s[2]))),
    perGroup: Object.fromEntries(groups.map((g, i) => [g, stat[i]])) };
}
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;

/** Objective: equal-parent-weighted MSE (the fit target; MAE is reported). */
export function objective(rows, predicted) { return groupMetrics(rows, predicted).rmse_m_s ** 2; }

/** Deterministic parent-unit bootstrap of a per-group statistic array. */
export function bootstrapMean(values, { repeats, seed, interval_percent }) {
  const rng = mulberry32(seed), n = values.length, draws = new Float64Array(repeats);
  for (let r = 0; r < repeats; r++) { let s = 0; for (let i = 0; i < n; i++) s += values[Math.floor(rng() * n)]; draws[r] = s / n; }
  const sorted = Array.from(draws).sort((a, b) => a - b);
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p / 100 * (sorted.length - 1))))];
  return interval_percent.map(at);
}
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

/** Nelder-Mead on the unit cube with a quadratic penalty outside it; two restarts from the best point. */
export function nelderMead(f, x0, { step = 0.15, maxIter = 800, tol = 1e-9, restarts = 2 } = {}) {
  const n = x0.length;
  let best = x0.slice(), bestValue = f(best), evaluations = 1;
  for (let round = 0; round <= restarts; round++) {
    let simplex = [best.slice()];
    for (let i = 0; i < n; i++) { const x = best.slice(); x[i] += (x[i] + step <= 1 ? step : -step) / (round + 1); simplex.push(x); }
    let values = simplex.map((x, i) => (i === 0 ? bestValue : f(x))); evaluations += n;
    for (let it = 0; it < maxIter; it++) {
      const order = values.map((v, i) => i).sort((a, b) => values[a] - values[b]);
      simplex = order.map((i) => simplex[i]); values = order.map((i) => values[i]);
      const size = Math.max(...simplex.slice(1).map((x) => Math.max(...x.map((v, j) => Math.abs(v - simplex[0][j])))));
      if (values[n] - values[0] <= tol * (Math.abs(values[0]) + 1e-12) && size < 1e-7) break;
      const c = new Array(n).fill(0);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += simplex[i][j] / n;
      const toward = (t) => c.map((cj, j) => cj + t * (simplex[n][j] - cj));
      const xr = toward(-1), fr = f(xr); evaluations++;
      if (fr < values[0]) {
        const xe = toward(-2), fe = f(xe); evaluations++;
        if (fe < fr) { simplex[n] = xe; values[n] = fe; } else { simplex[n] = xr; values[n] = fr; }
      } else if (fr < values[n - 1]) { simplex[n] = xr; values[n] = fr; } else {
        const xc = fr < values[n] ? toward(-0.5) : toward(0.5), fc = f(xc); evaluations++;
        if (fc < Math.min(fr, values[n])) { simplex[n] = xc; values[n] = fc; } else {
          for (let i = 1; i <= n; i++) { simplex[i] = simplex[i].map((v, j) => simplex[0][j] + 0.5 * (v - simplex[0][j])); values[i] = f(simplex[i]); evaluations++; }
        }
      }
    }
    const k = values.indexOf(Math.min(...values));
    if (values[k] < bestValue) { bestValue = values[k]; best = simplex[k].slice(); }
  }
  return { x: best, value: bestValue, evaluations };
}

/** Fit one parameter set on the given rows; returns named values and in-sample objective. */
export function fitSet(physics, plan, benchmark, names, rows) {
  const params = names.map((n) => plan.parameters[n]);
  const toValues = (u) => Object.fromEntries(names.map((n, i) => [n, params[i].bounds[0] + Math.min(1, Math.max(0, u[i])) * (params[i].bounds[1] - params[i].bounds[0])]));
  const penalty = (u) => 1e8 * u.reduce((s, v) => s + (v < 0 ? v * v : v > 1 ? (v - 1) ** 2 : 0), 0);
  const saved = snapshot(physics);
  const f = (u) => {
    const values = toValues(u);
    const overpressure = applyParameters(physics, plan, values);
    const profile = makeProfile(physics, benchmark, overpressure);
    return objective(rows, rows.map((r) => predictRow(profile, r))) + penalty(u);
  };
  const u0 = names.map((n, i) => (params[i].default - params[i].bounds[0]) / (params[i].bounds[1] - params[i].bounds[0]));
  const result = nelderMead(f, u0);
  const values = toValues(result.x);
  const overpressure = applyParameters(physics, plan, values);
  const profile = makeProfile(physics, benchmark, overpressure);
  restore(physics, saved);
  return { values, profile, objective: result.value, evaluations: result.evaluations };
}

export function snapshot(physics) { return { COMPACTION: structuredClone(physics.COMPACTION), ROCK: structuredClone(physics.ROCK) }; }
export function restore(physics, saved) { Object.assign(physics.COMPACTION.shale, saved.COMPACTION.shale); Object.assign(physics.COMPACTION.sand, saved.COMPACTION.sand); Object.assign(physics.ROCK, saved.ROCK); }

/** Leave-one-parent-out predictions for one set. */
export function crossValidate(physics, plan, benchmark, names, rows, log = () => {}) {
  const groups = [...new Set(rows.map((r) => r.group))].sort();
  const predicted = new Float64Array(rows.length).fill(NaN), fits = {};
  groups.forEach((held, k) => {
    const train = rows.filter((r) => r.group !== held);
    const fit = fitSet(physics, plan, benchmark, names, train);
    fits[held] = fit.values;
    rows.forEach((r, i) => { if (r.group === held) predicted[i] = predictRow(fit.profile, r); });
    log(`  fold ${k + 1}/${groups.length} ${held}: ${fit.evaluations} evaluations`);
  });
  return { predicted: Array.from(predicted), fits };
}

export function breakdown(rows, predicted) {
  const by = (key) => { const out = {}; for (const [label, select] of key) { const idx = rows.map((r, i) => (select(r) ? i : -1)).filter((i) => i >= 0); if (idx.length) { const m = groupMetrics(idx.map((i) => rows[i]), idx.map((i) => predicted[i])); delete m.perGroup; out[label] = m; } } return out; };
  return {
    by_facies: by([['Shale', (r) => r.facies_code === 65000], ['Sandstone', (r) => r.facies_code === 30000]]),
    by_depth: by([['0-1000m', (r) => r.depth_m < 1000], ['1000-2000m', (r) => r.depth_m >= 1000 && r.depth_m < 2000], ['2000-3000m', (r) => r.depth_m >= 2000]]),
  };
}

export function pairedDifference(rows, a, b, bootstrap) {
  const per = new Map();
  rows.forEach((r, i) => { if (!per.has(r.group)) per.set(r.group, []); per.get(r.group).push(Math.abs(a[i] - r.observed_m_s) - Math.abs(b[i] - r.observed_m_s)); });
  const values = [...per.keys()].sort().map((g) => mean(per.get(g)));
  return { mean_m_s: mean(values), parent_bootstrap_95_percent_m_s: bootstrapMean(values, bootstrap) };
}

async function main() {
  const planText = await readFile(new URL('./calibration-plan.json', import.meta.url), 'utf8');
  const benchmarkText = await readFile(new URL('./benchmark-plan.json', import.meta.url), 'utf8');
  const plan = JSON.parse(planText), benchmark = JSON.parse(benchmarkText);
  const windowsPath = process.argv[2] || resolve(root, 'data/force2020/comparison/primary-windows.csv');
  const outDir = process.argv[3] || resolve(root, 'data/force2020/calibration');
  const windowsText = await readFile(windowsPath, 'utf8');
  const rows = parseWindows(windowsText);
  const physics = await loadPhysics();
  const defaults = currentValues(physics, plan);

  // Self-check: the untuned profile must reproduce the stored present_hydrostatic column.
  const untuned = makeProfile(physics, benchmark, null);
  const maxGap = Math.max(...rows.map((r) => Math.abs(predictRow(untuned, r) - r.present_hydrostatic)));
  if (!(maxGap <= 1e-6)) throw new Error(`untuned profile differs from stored predictions by ${maxGap} m/s`);
  if (rows.some((r) => !Number.isFinite(r.baseline_loo))) throw new Error('stored baseline predictions are missing');
  const observedCol = rows.map((r) => r.present_hydrostatic), baselineCol = rows.map((r) => r.baseline_loo);
  const strip = (m) => { const { perGroup, ...rest } = m; return rest; };
  const report = {
    plan_sha256: hash(planText), benchmark_plan_sha256: hash(benchmarkText), windows_sha256: hash(windowsText),
    simulator_source_sha256: hash(await readFile(resolve(root, 'src/basin.ts'))),
    windows: rows.length, groups: new Set(rows.map((r) => r.group)).size, wells: new Set(rows.map((r) => r.well)).size,
    defaults, untuned: { ...strip(groupMetrics(rows, observedCol)), ...breakdown(rows, observedCol) },
    baseline_loo: { ...strip(groupMetrics(rows, baselineCol)), ...breakdown(rows, baselineCol) }, sets: {},
  };
  const perWindow = rows.map((r) => ({ well: r.well, group: r.group, bin: r.bin, depth_m: r.depth_m, facies_code: r.facies_code, observed_m_s: r.observed_m_s, present_hydrostatic: r.present_hydrostatic, baseline_loo: r.baseline_loo }));
  for (const [setName, names] of Object.entries(plan.sets)) {
    console.log(`${setName}: ${names.join(', ')}`);
    const full = fitSet(physics, plan, benchmark, names, rows);
    const inSample = rows.map((r) => predictRow(full.profile, r));
    const cv = crossValidate(physics, plan, benchmark, names, rows, (s) => process.stdout.write(s + '\n'));
    const fitted = Object.values(cv.fits);
    report.sets[setName] = {
      parameters: names, full_fit: full.values, full_fit_evaluations: full.evaluations,
      in_sample: { ...strip(groupMetrics(rows, inSample)), ...breakdown(rows, inSample) },
      leave_one_parent_out: { ...strip(groupMetrics(rows, cv.predicted)), ...breakdown(rows, cv.predicted),
        mae_bootstrap_95_percent: bootstrapMean(Object.values(groupMetrics(rows, cv.predicted).perGroup).map((s) => s[1]), plan.bootstrap) },
      cv_minus_untuned_mae: pairedDifference(rows, cv.predicted, observedCol, plan.bootstrap),
      cv_minus_baseline_mae: pairedDifference(rows, cv.predicted, baselineCol, plan.bootstrap),
      fold_coefficient_range: Object.fromEntries(names.map((n) => [n, [Math.min(...fitted.map((v) => v[n])), Math.max(...fitted.map((v) => v[n]))]])),
    };
    perWindow.forEach((w, i) => { w[`${setName}_loo`] = cv.predicted[i]; w[`${setName}_in_sample`] = inSample[i]; });
    const s = report.sets[setName];
    console.log(`  LOO MAE ${s.leave_one_parent_out.mae_m_s.toFixed(3)} (in-sample ${s.in_sample.mae_m_s.toFixed(3)}, untuned ${report.untuned.mae_m_s.toFixed(3)}, baseline ${report.baseline_loo.mae_m_s.toFixed(3)})`);
  }
  // Selection by the pre-registered rule.
  const ranked = Object.entries(report.sets).sort(([a, x], [b, y]) => (x.leave_one_parent_out.mae_m_s - y.leave_one_parent_out.mae_m_s) || (x.parameters.length - y.parameters.length));
  let chosen = ranked[0];
  for (const candidate of ranked) if (candidate[1].parameters.length < chosen[1].parameters.length && candidate[1].leave_one_parent_out.mae_m_s - ranked[0][1].leave_one_parent_out.mae_m_s <= 5) chosen = candidate;
  const interval = chosen[1].cv_minus_untuned_mae.parent_bootstrap_95_percent_m_s;
  report.selection = { rule: plan.selection_rule, best_by_loo_mae: ranked[0][0], chosen: chosen[0], adopted: interval[1] < 0, cv_minus_untuned_interval_m_s: interval,
    note: interval[1] < 0 ? 'interval excludes zero; adopt the chosen set' : 'interval includes zero; adopt nothing' };
  await mkdir(outDir, { recursive: true });
  await writeFile(resolve(outDir, 'calibration.json'), JSON.stringify(report, null, 2) + '\n');
  const cols = Object.keys(perWindow[0]);
  await writeFile(resolve(outDir, 'calibration-windows.csv'), [cols.join(','), ...perWindow.map((w) => cols.map((c) => w[c]).join(','))].join('\n') + '\n');
  console.log(JSON.stringify(report.selection, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
