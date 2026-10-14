import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { loadPhysics, parseWindows } from '../validation/force2020/calibrate.mjs';
import { windowVelocity, minimize1d, fitOffsets, predict, offsetOf } from '../validation/force2020/context-scenarios.mjs';

const plan = JSON.parse(await readFile(new URL('../validation/force2020/context-plan.json', import.meta.url), 'utf8'));
const physics = await loadPhysics();

test('zero offset equals the exporter quadrature; exhumation speeds up, undercompaction slows down', () => {
  let slowness = 0;
  for (let m = 0; m < 20; m++) { const d = 1500 + m + 0.5; slowness += 1 / physics.rockVelocity(0, d, false, null, { maxBurial: d, maxEffectiveDepth: d }); }
  const v0 = windowVelocity(physics, 0, 1510, 0);
  assert.ok(Math.abs(v0 - 20 / slowness) < 1e-9);
  assert.ok(windowVelocity(physics, 0, 1510, 800) > v0 + 50);
  assert.ok(windowVelocity(physics, 0, 1510, -800) < v0 - 50);
  assert.ok(windowVelocity(physics, 1, 1510, -3000) >= 1500, 'floored effective depth stays inside the model cap');
});

test('negative offsets keep geometric burial at present depth so cementation is unchanged', () => {
  const d = 2200;
  const expected = physics.rockVelocity(0, d - 600, false, null, { maxBurial: d, maxEffectiveDepth: d - 600 });
  const shallowerRock = physics.rockVelocity(0, d - 600, false, null, { maxBurial: d - 600, maxEffectiveDepth: d - 600 });
  assert.notEqual(expected, shallowerRock, 'the cementation proxy must see the present burial');
  let slowness = 0;
  for (let m = 0; m < 20; m++) { const z = d - 10 + m + 0.5; slowness += 1 / physics.rockVelocity(0, z - 600, false, null, { maxBurial: z, maxEffectiveDepth: z - 600 }); }
  assert.ok(Math.abs(windowVelocity(physics, 0, d, -600) - 20 / slowness) < 1e-9);
});

test('1-D minimizer finds a known minimum inside the bounds', () => {
  const r = minimize1d((x) => (x - 437.5) ** 2 + 2, -2500, 3000);
  assert.ok(Math.abs(r.x - 437.5) < 0.05, `${r.x}`); assert.ok(Math.abs(r.value - 2) < 1e-6);
});

test('fitting recovers known per-unit offsets from noise-free synthetic windows, with equal well weight', () => {
  const truth = { quadrant: { 16: -500, 35: 900 } };
  const rows = [];
  for (const [q, wells] of [['16', ['16/1-1', '16/2-2']], ['35', ['35/1-1', '35/2-2', '35/3-3']]]) for (const [wi, well] of wells.entries()) for (let bin = 40 + wi * 10; bin < 140; bin += 12) {
    const code = bin % 3 ? 65000 : 30000, depth = bin * 20 + 10;
    rows.push({ well, group: well, quadrant: q, block: `${q}/1`, group_unit: 'X', bin, depth_m: depth, facies_code: code, observed_m_s: windowVelocity(physics, code === 30000 ? 1 : 0, depth, truth.quadrant[q]) });
  }
  const offsets = fitOffsets(physics, plan, ['quadrant'], rows);
  assert.ok(Math.abs(offsets.quadrant['16'] + 500) < 2, JSON.stringify(offsets));
  assert.ok(Math.abs(offsets.quadrant['35'] - 900) < 2, JSON.stringify(offsets));
  const predicted = predict(physics, offsets, ['quadrant'], rows);
  assert.ok(Math.max(...predicted.map((p, i) => Math.abs(p - rows[i].observed_m_s))) < 1);
  assert.equal(offsetOf(offsets, ['quadrant'], { quadrant: '99' }), 0, 'unseen units keep offset zero');
});

test('additive two-key fit separates area and unit contributions on synthetic data', () => {
  const rows = [];
  for (const q of ['16', '35']) for (const g of ['A', 'B']) for (const w of [1, 2]) for (let bin = 50; bin < 140; bin += 15) {
    const depth = bin * 20 + 10, delta = (q === '16' ? -300 : 400) + (g === 'A' ? 0 : 500);
    rows.push({ well: `${q}/${w}-${g}`, group: `${q}/${w}-${g}`, quadrant: q, block: `${q}/1`, group_unit: g, bin, depth_m: depth, facies_code: 65000, observed_m_s: windowVelocity(physics, 0, depth, delta) });
  }
  const offsets = fitOffsets(physics, plan, ['quadrant', 'group_unit'], rows);
  const predicted = predict(physics, offsets, ['quadrant', 'group_unit'], rows);
  assert.ok(Math.max(...predicted.map((p, i) => Math.abs(p - rows[i].observed_m_s))) < 3, JSON.stringify(offsets));
  assert.ok(Math.abs((offsets.quadrant['35'] - offsets.quadrant['16']) - 700) < 5, 'the area difference is identified');
  assert.ok(Math.abs((offsets.group_unit.B - offsets.group_unit.A) - 500) < 5, 'the unit difference is identified');
});

test('window parser keeps context labels as text', () => {
  const rows = parseWindows('bin,depth_m,facies_code,observed_m_s,well,group,present_hydrostatic,baseline_loo,group_unit,quadrant,block,lat\n21,430.0,65000,1879.7,15/9-15,15/9-15,1841.9,1900.1,NORDLAND GP.,15,15/9,58.3\n');
  assert.equal(rows[0].quadrant, '15'); assert.equal(rows[0].block, '15/9'); assert.equal(rows[0].group_unit, 'NORDLAND GP.'); assert.equal(rows[0].lat, 58.3);
});
