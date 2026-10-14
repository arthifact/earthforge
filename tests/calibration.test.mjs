import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { loadPhysics, parseWindows, applyParameters, makeProfile, predictRow, groupMetrics, nelderMead, fitSet, snapshot, restore, currentValues, bootstrapMean } from '../validation/force2020/calibrate.mjs';

const plan = JSON.parse(await readFile(new URL('../validation/force2020/calibration-plan.json', import.meta.url), 'utf8'));
const benchmark = JSON.parse(await readFile(new URL('../validation/force2020/benchmark-plan.json', import.meta.url), 'utf8'));
const physics = await loadPhysics();

test('Nelder-Mead finds a known minimum inside the unit cube', () => {
  const r = nelderMead((u) => (u[0] - 0.3) ** 2 + 3 * (u[1] - 0.7) ** 2 + 1, [0.5, 0.5]);
  assert.ok(Math.abs(r.x[0] - 0.3) < 1e-4 && Math.abs(r.x[1] - 0.7) < 1e-4, JSON.stringify(r));
  assert.ok(Math.abs(r.value - 1) < 1e-8);
});

test('parameter overrides reach the live coefficients and are restored exactly', () => {
  const saved = snapshot(physics), before = currentValues(physics, plan);
  const over = applyParameters(physics, plan, { shale_L: 2500, cement_from: 1200, cement_width: 300, pressure_top: 1800 });
  assert.equal(physics.COMPACTION.shale.L, 2500); assert.equal(physics.ROCK.cementFrom, 1200); assert.equal(physics.ROCK.cementTo, 1500); assert.equal(over, 1800);
  restore(physics, saved);
  assert.deepEqual(currentValues(physics, plan), before);
});

test('untuned profile equals the exporter semantics: 1 m slowness quadrature of rockVelocity', () => {
  const profile = makeProfile(physics, benchmark, null);
  let slowness = 0;
  for (let m = 0; m < 20; m++) { const d = 1000 + m + 0.5; slowness += 1 / physics.rockVelocity(0, d, false, null, { maxBurial: d, maxEffectiveDepth: d }); }
  assert.ok(Math.abs(profile['65000'][50] - 20 / slowness) < 1e-9);
  assert.equal(profile['30000'].length, 150);
});

test('metrics give equal weight to each parent group, not to each window', () => {
  const rows = [
    { group: 'a', well: 'a', observed_m_s: 2000 }, { group: 'a', well: 'a', observed_m_s: 2000 }, { group: 'a', well: 'a', observed_m_s: 2000 },
    { group: 'b', well: 'b', observed_m_s: 2000 },
  ];
  const m = groupMetrics(rows, [2010, 2010, 2010, 1960]);
  assert.ok(Math.abs(m.bias_m_s - (10 - 40) / 2) < 1e-12); assert.ok(Math.abs(m.mae_m_s - 25) < 1e-12);
  assert.ok(Math.abs(m.rmse_m_s - Math.sqrt((100 + 1600) / 2)) < 1e-12); assert.equal(m.groups, 2);
});

test('bootstrap is deterministic and brackets the mean', () => {
  const values = [1, 2, 3, 4, 5, 6, 7, 8];
  const a = bootstrapMean(values, { repeats: 500, seed: 7, interval_percent: [2.5, 97.5] }), b = bootstrapMean(values, { repeats: 500, seed: 7, interval_percent: [2.5, 97.5] });
  assert.deepEqual(a, b); assert.ok(a[0] < 4.5 && a[1] > 4.5);
});

test('fitting recovers known compaction coefficients from noise-free synthetic windows', () => {
  const saved = snapshot(physics), defaults = currentValues(physics, plan);
  const truth = { shale_phi0: 0.58, shale_L: 2400, sand_phi0: 0.45, sand_L: 3000 };
  applyParameters(physics, plan, truth);
  const profile = makeProfile(physics, benchmark, null);
  restore(physics, saved);
  const rows = [];
  for (let g = 0; g < 6; g++) for (let bin = 20 + g * 3; bin < 150; bin += 7) for (const code of [65000, 30000]) {
    if (code === 30000 && bin % 2) continue;
    rows.push({ group: `w${g}`, well: `w${g}`, bin, depth_m: bin * 20 + 10, facies_code: code, observed_m_s: profile[String(code)][bin] });
  }
  const fit = fitSet(physics, plan, benchmark, plan.sets.A_compaction, rows);
  assert.ok(fit.objective < 1, `objective ${fit.objective}`);
  assert.ok(Math.abs(fit.values.shale_phi0 - truth.shale_phi0) < 0.01, JSON.stringify(fit.values));
  assert.ok(Math.abs(fit.values.shale_L / truth.shale_L - 1) < 0.03, JSON.stringify(fit.values));
  assert.ok(Math.abs(fit.values.sand_L / truth.sand_L - 1) < 0.05, JSON.stringify(fit.values));
  assert.deepEqual(currentValues(physics, plan), defaults);
  assert.equal(physics.COMPACTION.shale.L, saved.COMPACTION.shale.L);
});

test('window parser keeps numeric fields numeric and labels as text', () => {
  const rows = parseWindows('bin,depth_m,facies_code,observed_m_s,well,group,present_hydrostatic\r\n21,430.0,65000,1879.7,15/9-15,15/9-15,1841.9\r\n');
  assert.equal(rows[0].bin, 21); assert.equal(rows[0].facies_code, 65000); assert.equal(rows[0].well, '15/9-15'); assert.ok(Math.abs(rows[0].observed_m_s - 1879.7) < 1e-12);
  assert.ok(Math.abs(rows[0].present_hydrostatic - 1841.9) < 1e-12, 'Windows line endings from the Python writer must not corrupt the last column');
  assert.equal(predictRow({ 65000: [0, 1, 2] }, { facies_code: 65000, bin: 2 }), 2);
});
