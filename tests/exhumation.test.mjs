import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const bundle = await build({ stdin: { contents: 'export * from "./src/basin.ts";', resolveDir: root }, bundle: true, platform: 'node', format: 'esm', write: false });
const { simulate, BASIN_DEFAULTS, exhumationOf, windowOf, rockVelocity, effectiveDepth, WATER, BASEMENT } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);

const digest = (b) => { let s = 0; for (let i = 0; i < b.grid.length; i++) s = (s * 31 + b.grid[i] + Math.round(b.solid[i] * 1e6)) % 1e12; return `${b.log.length}:${s}:${b.beds.length}`; };
// Sections take tens of seconds; each distinct option set is simulated once and shared by the tests.
const cache = new Map();
const sim = (o) => { const key = JSON.stringify(o); if (!cache.has(key)) cache.set(key, simulate(o)); return cache.get(key); };
const exhumed = (setting) => sim({ ...BASIN_DEFAULTS, seed: 20261014, setting, exhumation: 1 });

test('exhumation draws from its own stream: probability 0 and an absent option reproduce the same section', () => {
  const base = { ...BASIN_DEFAULTS, seed: 765184, setting: 'extension' };
  const { exhumation, ...without } = base;
  assert.equal(exhumationOf({ seed: 765184, exhumation: 0 }), null);
  assert.equal(exhumationOf({ seed: 765184 }), null);
  assert.equal(digest(sim(base)), digest(sim(without)));
  const always = exhumationOf({ seed: 765184, exhumation: 1 });
  assert.ok(always && always.steps >= 2 && always.steps <= 4 && always.amount >= 300 && always.amount <= 1500 && Math.abs(always.tilt) <= 0.6, JSON.stringify(always));
  assert.deepEqual(exhumationOf({ seed: 765184, exhumation: 1 }), always, 'deterministic per seed');
});

test('an exhumed section is uplifted, eroded, reburied, keeps grain budgets closed and retains burial memory', () => {
  for (const setting of ['extension', 'compression']) {
    const b = exhumed(setting), e = b.historyPlan.exhumation;
    assert.ok(e, 'episode recorded in the physical history');
    assert.equal(b.log.length, b.historyPlan.phases.reduce((a, n) => a + n, 0));
    const uplifted = b.log.filter((l) => l.subsidence < 0);
    assert.equal(uplifted.length, e.steps, `${setting}: one uplift step per episode step`);
    assert.ok(uplifted.every((l, i) => l.step === e.start + i && /uplifted/.test(l.text)));
    assert.ok(Math.abs(uplifted.reduce((s, l) => s + l.subsidence, 0) + e.amount) < 1e-6 * e.amount + 1, 'uplift sums to the episode amount at the section centre');
    // Rock lifted above sea level or wave base is eroded; the ledger books it as erosion, never as a boundary outflow.
    const during = b.budget.entries.filter((en) => en.step >= e.start && en.step < e.start + e.steps);
    const erodedDuring = during.reduce((s, en) => s + en.flux.eroded.total, 0), topOutflow = during.reduce((s, en) => s + en.flux.outflow.top.total, 0);
    assert.ok(erodedDuring > 0, `${setting}: exhumation erodes rock`);
    assert.equal(topOutflow, 0, `${setting}: no rock leaves through the top face during uplift`);
    assert.equal(b.log.length, e.start + e.steps + 1, 'the episode follows the post-tectonic steps and one reburial step ends the history');
    assert.ok(b.log.slice(e.start + e.steps).every((l) => l.subsidence > 0 && l.deposited > 0), 'subsidence and deposition resume after the episode');
    assert.ok(b.budget.summary.closed, `${setting}: grain budget closes through uplift and erosion: ${JSON.stringify(b.budget.summary.byProcess)}`);
    assert.equal(b.checks.trapped, 0);
    // Memory: in the window, some sediment now sits shallower than its maximum burial by a few hundred metres.
    let excess = 0, cells = 0;
    for (let i = 0; i < b.nx; i++) {
      let depth = 0;
      for (const p of b.columns[i]) {
        if (p.bed >= 0) { excess = Math.max(excess, p.burial - (depth + p.height / 2)); cells++; }
        depth += p.height;
      }
    }
    assert.ok(cells > 0 && excess > 200, `${setting}: maximum burial exceeds present depth by ${excess.toFixed(0)} m`);
  }
});

test('retained memory makes exhumed rock faster than freshly buried rock at the same depth, through the window velocity', () => {
  const b = exhumed('extension'), w = windowOf(b);
  let checked = 0;
  for (let i = 0; i < b.nx; i++) {
    let depth = 0;
    for (const p of b.columns[i]) {
      const mid = depth + p.height / 2;
      if (p.bed >= 0 && !b.beds[p.bed].carbonate && p.burial > mid + 300 && mid > 300 && p.height > 1) {
        const fresh = rockVelocity(p.fraction, mid, false, b.overpressure, { maxBurial: mid, maxEffectiveDepth: effectiveDepth(mid, b.overpressure) });
        const remembered = rockVelocity(p.fraction, mid, false, b.overpressure, { maxBurial: p.burial, maxEffectiveDepth: p.loading });
        assert.ok(remembered > fresh, `exhumed parcel at ${mid.toFixed(0)} m (max burial ${p.burial.toFixed(0)} m) must be faster than fresh rock`);
        checked++;
      }
      depth += p.height;
    }
  }
  assert.ok(checked > 0, 'found exhumed parcels to check');
  assert.ok(w.velocity.every((v) => v >= 1500 && v <= 5600), 'window velocities stay in bounds');
  assert.equal(w.velocity.length, w.nx * w.nz);
});

test('the uplift is tilted across the section and recorded in the forcing with negative subsidence', () => {
  const b = exhumed('compression'), e = b.historyPlan.exhumation, f = b.historyPlan.forcing[e.start];
  assert.ok(f.subsidence.every((s) => s < 0), 'every column rises during an uplift step');
  const left = f.subsidence[0], right = f.subsidence.at(-1);
  assert.ok(Math.sign(right - left) === -Math.sign(e.tilt) || e.tilt === 0, 'the side the tilt points to rises more');
  assert.ok(b.budget.summary.closed);
});
