import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { columnAt, totalsByUnit, continuousThickness, compactionRows, decompose3, velocityAttribution, noncontracting } from '../validation/numerics/diagnostics.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const bundle = await build({ entryPoints: [root + '/src/basin.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { simulate, BASIN_DEFAULTS, porosity, effectiveDepth, rockVelocity } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
const close = (a, b, t = 1e-8) => assert.ok(Math.abs(a - b) <= t, `${a} != ${b}`);
const cell = (extra = {}) => ({ depth: 600, solid: 10, fraction: 0.4, carbonate: false, burial: 800, loading: 700, ...extra });

test('diagnostic observer preserves all physical state, history and budgets and observes every event', () => {
  for (const setting of ['extension', 'compression']) {
    const options = { ...BASIN_DEFAULTS, setting, h: 40, seed: 910001, faults: [1, 1], thrusts: [1, 1] };
    const a = simulate(options), seen = [];
    const b = simulate(options, state => {
      const column = columnAt(state, 400);
      seen.push({ step: state.step, process: state.process, fault: state.fault, totals: [...totalsByUnit(column)] });
    });
    const physical = b => { const { checks, ...rest } = b; const { seconds, ...otherChecks } = checks; return { ...rest, checks: otherChecks }; };
    assert.deepEqual(physical(b), physical(a));
    assert.deepEqual(seen.map(({ step, process, fault }) => ({ step, process, fault })), b.budget.entries.map(({ step, process, fault }) => ({ step, process, fault })));
  }
});

test('continuous compaction root resolves a known constant-porosity layer below one cell', () => {
  const cells = [cell({ solid: 4 }), cell({ solid: 5 })];
  const r = continuousThickness(cells, 100, null, () => 0.25, d => d);
  close(r.thickness_m, 12); close(r.equation_residual_m, 0);
  const before = { x: 400, h: 20, floor_m: 100, runs: [{ bed: 0, unit: 0, start: 5, end: 7, cells }] };
  const after = { x: 400, h: 20, floor_m: 120, runs: [{ bed: 0, unit: 0, start: 6, end: 7, cells: [cell({ solid: 9 })] }] };
  const [q] = compactionRows(before, after, null, () => 0.25, d => d);
  assert.equal(q.minimum_cell_limited, true); close(q.thickness_excess_m, 8); close(q.grain_change_m, 0);
  const unloaded = continuousThickness([cell({ solid: 9, loading: 1500 })], 0, null, porosity, effectiveDepth);
  close(unloaded.thickness_m, 9 / (1 - porosity(0.4, 1500, false)));
  assert.throws(() => continuousThickness([], 0, null, porosity, effectiveDepth), /Invalid/);
});

test('continuous root is invariant to splitting identical source grains', () => {
  const a = continuousThickness([cell({ solid: 33, loading: 0 })], 800, 1000, porosity, effectiveDepth);
  const b = continuousThickness(Array.from({ length: 11 }, () => cell({ solid: 3, loading: 0 })), 800, 1000, porosity, effectiveDepth);
  close(a.thickness_m, b.thickness_m); close(a.equation_residual_m, 0);
});

test('three-group attribution preserves additive effects and divides interactions symmetrically', () => {
  const r = decompose3(mask => 100 + (mask & 1 ? 3 : 0) + (mask & 2 ? 6 : 0) + (mask & 4 ? -9 : 0) + ((mask & 3) === 3 ? 12 : 0));
  r.contributions.forEach((x, j) => close(x, [9, 12, -9][j])); close(r.residual, 0);
});

test('velocity attribution integrates unequal subdivisions exactly and recovers harmonic endpoints', () => {
  const a = [cell({ fraction: 0 }), cell({ fraction: 1 })];
  const b = [cell({ fraction: 0 }), cell({ fraction: 0 }), cell({ fraction: 1 }), cell({ fraction: 1 })];
  const law = f => 2000 + f * 2000;
  const equal = velocityAttribution(a, b, null, law);
  close(equal.values[0], 1 / (0.5 / 2000 + 0.5 / 4000)); close(equal.delta, 0);
  equal.contributions.forEach(c => close(c, 0));
  const shifted = velocityAttribution(a, [cell({ fraction: 1 }), cell({ fraction: 1 }), cell({ fraction: 1 })], null, law);
  close(shifted.values[7], 4000); close(shifted.groups.composition, shifted.delta);
  close(shifted.groups.memory, 0); close(shifted.groups.present_depth, 0);
  const real = velocityAttribution(a, b.map(c => ({ ...c, depth: 1300, burial: 1500, loading: 1400 })), 1000, rockVelocity);
  close(real.residual, 0); close(real.values[7], 1 / b.reduce((s, c) => s + 0.25 / rockVelocity(c.fraction, 1300, false, 1000, { maxBurial: 1500, maxEffectiveDepth: 1400 }), 0));
});

test('noncontracting classifications do not confuse tiny changes, stable or settled sequences', () => {
  for (const classification of ['monotonic-noncontracting', 'oscillatory-noncontracting', 'new-change']) assert.equal(noncontracting({ classification }), true);
  for (const classification of ['monotonic-contracting', 'oscillatory-contracting', 'stable', 'settled']) assert.equal(noncontracting({ classification }), false);
});
