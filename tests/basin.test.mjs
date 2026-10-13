import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

// Exercise the same TypeScript simulator and checks used by the worker, without a browser.
const bundle = await build({
  stdin: {
    contents: 'export * from "./src/basin.ts"; export * from "./src/basinVerify.ts"; export * from "./src/checks.ts";',
    resolveDir: fileURLToPath(new URL("..", import.meta.url)),
  },
  bundle: true, platform: "node", format: "esm", write: false,
});
const { BASIN_DEFAULTS, DOMAIN, simulate, verify, checkRows, measureFault,
  flowLine, flowMove, porosity, compactedThickness, rockVelocity, windowOf,
  medianVelocityAt, invalidStateCells, samePhysicalState, sand, setDebugSlip, effectiveDepth, advanceHistory, rockState, remapCompactedMaterial } =
  await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`);

let benchmark;
const reference = () => benchmark ??= verify({ ...BASIN_DEFAULTS, faults: [1, 2] }, 765183, 20);

test("original known-answer tolerances and the reported seed 765183 batch", async () => {
  const result = await reference();
  const rows = checkRows(result);
  // All original tolerances and the full grain budget must now pass.
  const failures = rows.filter((row) => row.status === "fail");
  assert.deepEqual(failures, [], JSON.stringify(failures, null, 2));
  assert.ok(result.kinematics.units >= 120, "retain the measurable coarse-grid horizons");
  assert.equal(result.kinematics.within, result.kinematics.units);
  assert.ok(result.kinematics.worst <= 40);
  assert.ok(result.compaction.runs > 14000, "retain the resolved beds");
  assert.ok(result.compaction.within >= 0.95 * result.compaction.runs);
  assert.ok(Math.abs(result.compaction.mean) <= 5);
  assert.ok(result.compaction.meanAbs <= 5);
  assert.ok(Math.abs(result.compaction.fine.meanAbs - result.compaction.meanAbs) < 1e-6, "continuous vertical compaction is independent of the display grid");
  assert.ok(result.kinematics.fine.mean < result.kinematics.mean);
  assert.ok(result.compaction.worstSolid < 1e-8);
  assert.ok(result.expansion.during.length > 50, "retain a substantial growth sample");
  assert.equal(result.physics.invalidCells, 0);
  assert.equal(result.physics.invalidVelocity, 0);
  assert.equal(result.physics.repeated, 2, "repeat both represented settings");
  assert.ok(result.velocity.sections.every((n) => n <= result.sections));
});

test("solid fits each cell, no trapped water, and deterministic deformation across settings", () => {
  for (const [seed, setting, h, overpressure, carbonate] of [
    [910003, "extension", 20, 0, 0.1], // formerly >60 m of solid in one 20 m cell
    [765183, "extension", 20, 0.35, 0.1],
    [765188, "extension", 10, 1, 0.3],
    [12345, "extension", 20, 1, 1],
    [765184, "compression", 20, 0.35, 0.1],
    [12346, "compression", 10, 1, 0.3],
  ]) {
    const options = { ...BASIN_DEFAULTS, seed, setting, h, overpressure, carbonate };
    const b = simulate(options);
    assert.equal(invalidStateCells(b), 0, `seed ${seed}`);
    for (let n = 0; n < b.grid.length; n++) {
      assert.ok(Number.isFinite(b.solid[n]) && b.solid[n] >= -1e-9 && b.solid[n] <= h + 1e-9,
        `seed ${seed}, cell ${n}: ${b.solid[n]} m solid in ${h} m`);
      if (b.grid[n] < 0) assert.equal(b.solid[n], 0);
    }
    assert.equal(b.checks.trapped, 0, `seed ${seed}`);
    assert.ok(b.checks.area < 0.02, `seed ${seed}: slip area error ${b.checks.area}`);
    const again = simulate(options);
    assert.deepEqual(again.grid, b.grid);
    assert.deepEqual(again.solid, b.solid);
    assert.deepEqual(again.burial, b.burial);
    assert.deepEqual(again.faults, b.faults);
    assert.ok(samePhysicalState(b, again));
  }
});

// Horizontal units on either side of a planar fault: the true thicknesses are known independently.
// At 250 m beyond the hanging-wall top cutoff, the fault still cuts the unit's lower part.
function thicknessFixture(dir, hwThickness, nx = 401) {
  const h = 20, nz = 161, grid = new Int32Array(nx * nz);
  const x = (i) => -DOMAIN.margin + i * h;
  const depth = Float64Array.from({ length: nx }, (_, i) => {
    const distance = dir === 1 ? x(i) : 4000 - x(i);
    return distance < 0 ? NaN : distance / 2;
  });
  const f = { kind: "normal", dir, depth, x: [], z: [] };
  for (let i = 0; i < nx; i++) {
    if (Number.isFinite(depth[i])) { f.x.push(x(i)); f.z.push(depth[i]); }
    for (let k = 0; k < nz; k++) {
      const z = k * h, hw = Number.isFinite(depth[i]) && z < depth[i];
      const top = hw ? 1200 : 1000, bottom = top + (hw ? hwThickness : 400);
      grid[k * nx + i] = z < top ? 2 : z < bottom ? 1 : 0;
    }
  }
  return { nx, nz, h, grid, beds: [{ unit: 0 }, { unit: 1 }, { unit: 2 }], faults: [f] };
}

test("expansion uses whole units, in both fault directions, without inventing growth", () => {
  for (const dir of [1, -1]) for (const thickness of [400, 600, 800]) {
    const b = thicknessFixture(dir, thickness);
    const row = measureFault(b, b.faults[0]).find((r) => r.unit === 1);
    assert.ok(row, "the cutoffs remain measurable");
    assert.equal(row.ei, thickness / 400);
  }
});

test("unavailable intact intervals have no expansion measurement", () => {
  const b = thicknessFixture(1, 800, 260); // domain ends before the complete hanging-wall interval
  const row = measureFault(b, b.faults[0]).find((r) => r.unit === 1);
  assert.ok(row, "keep the independent cutoff measurement");
  assert.ok(Number.isNaN(row.ei));

  const crossed = thicknessFixture(1, 800);
  crossed.faults.push({ ...crossed.faults[0], depth: new Float64Array(crossed.nx).fill(1500) });
  assert.ok(Number.isNaN(measureFault(crossed, crossed.faults[0]).find((r) => r.unit === 1).ei));
});

const near = (actual, expected, tolerance = 1e-8) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected} (tolerance ${tolerance})`);

test("thrust transport matches analytical straight ramps and a flat-to-ramp bend", () => {
  for (const dir of [-1, 1]) for (const degrees of [18, 25, 32]) {
    const angle = degrees * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
    const straight = flowLine([[0, 0], [dir * 5000 * cos, -5000 * sin]]);
    for (const slip of [-2000, 0, 2000]) {
      const moved = flowMove(straight, dir * 1000, -1500, slip);
      near(moved[0], dir * (1000 + slip * cos));
      near(moved[1], -1500 - slip * sin);
    }
    // At the bend's bisector, a point 200 m above the flat reaches
    // x = -200 tan(angle/2). The remaining path is parallel to the ramp.
    const bent = flowLine([[-dir * 5000, 0], [0, 0], [dir * 5000 * cos, -5000 * sin]]);
    const xb = -200 * Math.tan(angle / 2), remaining = 1500 - (1000 + xb);
    const moved = flowMove(bent, -dir * 1000, -200, 1500);
    near(moved[0], dir * (xb + remaining * cos));
    near(moved[1], -200 - remaining * sin);
    const back = flowMove(bent, ...moved, -1500);
    near(back[0], -dir * 1000); near(back[1], -200);
    // Independent local area: determinant of the deformed unit square is 1,
    // including points transported from the flat across the bend.
    const p = flowMove(bent, -dir * 1000 + 1, -200, 1500);
    const q = flowMove(bent, -dir * 1000, -199, 1500);
    near((p[0] - moved[0]) * (q[1] - moved[1]) - (p[1] - moved[1]) * (q[0] - moved[0]), 1);
  }
});

test("porosity end members and the independent integral conserve prescribed solid", () => {
  for (const [f, carbonate, phi0, length] of [[0, false, 0.63, 1960], [1, false, 0.49, 3700], [0, true, 0.70, 1410]]) {
    near(porosity(f, 0, carbonate), phi0);
    near(porosity(f, length, carbonate), phi0 / Math.E);
    for (const depth of [0, 1000, 4000]) for (const thickness of [20, 200, 800]) {
      // Supply known thickness; evaluate the closed-form solid integral independently.
      const solid = thickness - phi0 * length * Math.exp(-depth / length) * (1 - Math.exp(-thickness / length));
      near(compactedThickness(solid, depth, f, carbonate), thickness);
    }
  }
});

test("displayed velocity preserves composition and loading history within 5 m/s", () => {
  const h = 20, nx = 661, nz = 226, grid = new Int32Array(nx * nz), burial = new Float32Array(nx * nz);
  const sandFraction = new Float64Array(nx * nz), effectiveBurial = new Float32Array(nx * nz);
  // Deliberately different depositional functions: the window must use carried material.
  const beds = [{ a: 0.9, b: 0, c: 0, d: 1, carbonate: false }];
  for (const overpressure of [null, 1805]) for (const carbonate of [false, true]) for (const offset of [0, 4007]) {
    beds[0].carbonate = carbonate;
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
      const n = k * nx + i, depth = (k + 0.5) * h;
      sandFraction[n] = Math.max(0, Math.min(1, (i - 100) / 460));
      burial[n] = depth + offset; effectiveBurial[n] = effectiveDepth(depth + offset, overpressure);
    }
    const b = { nx, nz, h, grid, burial, sandFraction, effectiveBurial, beds, overpressure };
    const w = windowOf(b);
    let worst = 0;
    for (let k = 0; k < w.nz; k++) for (let i = 0; i < w.nx; i++) {
      const n = k * nx + i + 100;
      const expected = rockVelocity(i / 460, (k + 0.5) * h, carbonate, overpressure,
        { maxBurial: burial[n], maxEffectiveDepth: effectiveBurial[n] });
      worst = Math.max(worst, Math.abs(w.velocity[k * w.nx + i] - expected));
      near(w.sandFraction[k * w.nx + i], i / 460, 1e-7);
    }
    assert.ok(worst <= 5, `${worst} m/s; pressure ${overpressure}, carbonate ${carbonate}, offset ${offset}`);
  }
});

// The pressure profile is a prescribed field, not a facies classifier. Expected
// pressures below are computed directly from the declared density/gradient assumptions.
test("pressure is continuous across facies and the overpressure top", () => {
  near(effectiveDepth(1000, 1500), 1000);
  near(effectiveDepth(3000, 1500), 1875);
  for (const carbonate of [false, true]) for (const f of [0, 0.2, 0.399999, 0.400001, 0.8, 1]) {
    near(rockState(f, 3000, carbonate, 1500).effectivePressure, (1950 - 1030) * 9.81 * 1875);
  }
  for (const depth of [100, 2000, 3000, 6000]) {
    const jump = Math.abs(rockVelocity(0.399999, depth, false, 1500) - rockVelocity(0.400001, depth, false, 1500));
    assert.ok(jump < 0.01, `${jump} m/s jump at depth ${depth}`);
  }
  for (const f of [0, 0.4, 1]) assert.ok(Math.abs(rockVelocity(f, 1500 - 1e-5, false, 1500) - rockVelocity(f, 1500 + 1e-5, false, 1500)) < 0.001);
});

test("burial, uplift, repressurization and reburial separate irreversible memory from current stress", () => {
  let memory = { maxBurial: 0, maxEffectiveDepth: 0 };
  memory = advanceHistory(memory, 2000, null);
  const buried = rockState(0.5, 2000, false, null, memory);
  memory = advanceHistory(memory, 500, null);
  const uplifted = rockState(0.5, 500, false, null, memory);
  near(uplifted.porosity, buried.porosity);
  near(uplifted.cementFraction, buried.cementFraction);
  near(uplifted.effectivePressure, buried.effectivePressure / 4);
  assert.ok(rockVelocity(0.5, 500, false, null, memory) < rockVelocity(0.5, 2000, false, null, memory));
  const pressured = rockState(0.5, 2000, false, 1000, memory);
  near(pressured.porosity, buried.porosity, 1e-12);
  assert.ok(pressured.effectivePressure < buried.effectivePressure);
  assert.deepEqual(advanceHistory(memory, 1900, null), memory);
  memory = advanceHistory(memory, 2500, null);
  assert.ok(rockState(0.5, 2500, false, null, memory).porosity < buried.porosity);
  const undercompacted = rockState(0.5, 2000, false, 1000);
  assert.ok(undercompacted.porosity > buried.porosity);
  near(undercompacted.cementFraction, buried.cementFraction);
});

test("compaction transports sand by solid volume and retains parcel loading maxima", () => {
  const result = remapCompactedMaterial([2, 8], [0.2, 0.8], [3000, 1000], [2000, 700], [5, 5]);
  near(result.sandFraction[0], (2 * 0.2 + 3 * 0.8) / 5);
  near(result.sandFraction[1], 0.8);
  near(result.sandFraction[0] * 5 + result.sandFraction[1] * 5, 2 * 0.2 + 8 * 0.8);
  assert.deepEqual([...result.burial], [3000, 1000]);
  assert.deepEqual([...result.effectiveBurial], [2000, 700]);
  const unchanged = remapCompactedMaterial([2, 0, 8], [0.2, 0.3, 0.8], [3000, 0, 1000], [2000, 0, 700], [2, 8]);
  assert.deepEqual([...unchanged.sandFraction], [0.2, 0.8]);
  assert.throws(() => remapCompactedMaterial([2], [0.3], [1], [1], [3]), /more solid/);
  assert.throws(() => remapCompactedMaterial([2], [0.3], [1], [1], [1]), /discards/);
});

test("normal and thrust slips carry composition and both memories with each source parcel", () => {
  const counts = { normal: 0, thrust: 0 }, changedPosition = { normal: 0, thrust: 0 };
  try {
    setDebugSlip(info => {
      for (const { source, moved, sourceColumn, destinationColumn } of info.normalTransfers ?? []) {
        counts.normal++;
        for (const field of ["fraction", "burial", "loading"]) assert.equal(moved[field], source[field]);
        assert.ok(Math.abs(moved.solid / moved.height - source.solid / source.height) < 1e-12);
        if (sourceColumn !== destinationColumn) changedPosition.normal++;
      }
      for (let n = 0; n < info.from.length; n++) {
        const source = info.from[n];
        if (source < 0 || info.next[n] < 0) continue;
        counts[info.kind]++;
        for (const field of ["sandFraction", "burial", "effectiveBurial"]) {
          assert.equal(info.after[field][n], info.before[field][source], `${info.kind}: ${field}`);
        }
        if (source % info.nx !== n % info.nx) changedPosition[info.kind]++;
      }
    });
    for (const setting of ["extension", "compression"]) simulate({ ...BASIN_DEFAULTS, seed: 765184, setting, overpressure: 1 });
  } finally { setDebugSlip(null); }
  for (const kind of ["normal", "thrust"]) {
    assert.ok(counts[kind] > 1000); assert.ok(changedPosition[kind] > 1000);
  }
});

test("deposited composition survives subsidence and compaction and replay uses its own material state", () => {
  const b = simulate({ ...BASIN_DEFAULTS, seed: 765184, setting: "extension", faults: [0, 0], record: true, overpressure: 1 });
  for (let i = 0; i < b.nx; i++) for (const p of b.columns[i]) if (p.bed >= 0) {
    const bed = b.beds[p.bed], x = -DOMAIN.margin + i * b.h;
    near(p.fraction, bed.carbonate ? 0 : sand(bed, x), 1e-10);
  }
  const snapshot = b.snapshots[2], before = windowOf(b, snapshot);
  const original = snapshot.sandFraction.slice();
  b.sandFraction.fill(0.99); b.effectiveBurial.fill(6000); b.burial.fill(6500);
  for (const column of b.columns) for (const p of column) { p.fraction = 0.99; p.loading = 6000; p.burial = 6500; }
  assert.deepEqual(snapshot.sandFraction, original);
  assert.deepEqual(windowOf(b, snapshot).velocity, before.velocity);
  assert.deepEqual(windowOf(b, snapshot).sandFraction, before.sandFraction);
});

test("velocity reference comparisons use bin centers, with no extrapolation or missing-bin bridge", () => {
  const band = { depth: [50, 150, 250, 350, 450, 550, 650, 750, 850, 950, 1050], p50: [] };
  band.p50 = band.depth.map((z) => 1500 + z);
  near(medianVelocityAt(band, 500), 2000);
  near(medianVelocityAt(band, 1000), 2500);
  near(medianVelocityAt(band, 450), 1950);
  assert.ok(Number.isNaN(medianVelocityAt(band, 0)));
  assert.ok(Number.isNaN(medianVelocityAt(band, 1100)));
  band.p50[4] = NaN;
  assert.ok(Number.isNaN(medianVelocityAt(band, 500)));
});

test("checks detect corrupted state, even if the rock IDs are unchanged", () => {
  const good = { h: 20, grid: new Int32Array([-1, -2, 0]), solid: new Float64Array([0, 0, 10]), burial: new Float32Array([0, 0, 500]), sandFraction: new Float64Array([0, 0, 0.4]), effectiveBurial: new Float32Array([0, 0, 400]), beds: [{}], faults: [] };
  assert.equal(invalidStateCells(good), 0);
  for (const mutate of [
    (b) => { b.solid[2] = 20.1; }, (b) => { b.solid[0] = 1; }, (b) => { b.solid[2] = NaN; },
    (b) => { b.burial[2] = -1; }, (b) => { b.burial[2] = Infinity; }, (b) => { b.grid[2] = 1; },
    (b) => { b.sandFraction[2] = 1.01; }, (b) => { b.sandFraction[0] = 0.5; },
    (b) => { b.effectiveBurial[2] = 600; }, (b) => { b.effectiveBurial[1] = 20; },
  ]) {
    const bad = structuredClone(good); mutate(bad);
    assert.equal(invalidStateCells(bad), 1);
    assert.equal(samePhysicalState(good, bad), false);
  }
  const altered = structuredClone(good); altered.burial[2] = 600;
  assert.equal(samePhysicalState(good, altered), false, "valid but different burial must fail repeatability");
});

test("empty measurements cannot pass, and signed errors cannot cancel in the compaction rule", async () => {
  const r = structuredClone(await reference());
  r.compaction.mean = 0; r.compaction.meanAbs = 6;
  assert.equal(checkRows(r).find((row) => row.name === "Compaction: bed thickness, 20 m grid").status, "fail");
  r.kinematics.units = r.kinematics.fine.units = 0;
  r.compaction.beds = r.compaction.runs = r.compaction.fine.runs = 0;
  r.thrust.cells = r.thrust.fine.cells = 0; r.thrust.dips = [];
  r.heaveGrows.faults = r.growthThrow.faults = 0;
  r.physics.slips = r.physics.repeated = 0; r.sections = 0;
  for (const row of checkRows(r).filter((row) => row.group === "Numerical benchmarks" || row.group === "Physics" || row.name === "Heave grows for older units" || row.name === "Throw grows with depth within growth units")) {
    assert.equal(row.status, "info", `${row.name}: no samples must not pass or fail`);
    assert.equal(row.verdict, "not measured");
  }
});

test("unseen seeds cover disabled processes and fixed tectonic settings", () => {
  for (const setting of ["extension", "compression"]) for (const compaction of [false, true]) {
    const b = simulate({ ...BASIN_DEFAULTS, seed: 20261012, setting, compaction, faults: [0, 0], thrusts: [0, 0], overpressure: 0, carbonate: 0 });
    assert.equal(b.faults.length, 0);
    assert.equal(b.checks.slips.length, 0);
    assert.equal(b.checks.trapped, 0);
    assert.equal(invalidStateCells(b), 0);
    assert.ok(windowOf(b).velocity.every((v) => Number.isFinite(v) && v >= 1500 && v <= 5600));
  }
});

test("both grids preserve physical bounds across compaction, pressure and carbonate extremes", () => {
  let cases = 0;
  for (const setting of ["extension", "compression"]) for (const h of [20, 10]) for (const compaction of [false, true]) for (const extreme of [false, true]) {
    const options = { ...BASIN_DEFAULTS, seed: 20261020 + cases++, setting, h, compaction, overpressure: extreme ? 1 : 0, carbonate: extreme ? 1 : 0 };
    const b = simulate(options), label = JSON.stringify(options);
    assert.equal(invalidStateCells(b), 0, label);
    assert.equal(b.checks.trapped, 0, label);
    assert.ok(b.checks.area < 0.02, label);
    assert.equal(b.budget.summary.closed, true, label);
    assert.ok(windowOf(b).velocity.every((v) => Number.isFinite(v) && v >= 1500 && v <= 5600), label);
  }
  assert.equal(cases, 16);
});


test("FORCE exporter keeps uplift in history and leaves the hydrostatic reference unchanged", async () => {
  const directory = await mkdtemp(join(tmpdir(), "earthforge-profiles-"));
  try {
    const destination = join(directory, "profiles.json");
    execFileSync(process.execPath, ["validation/force2020/model-profiles.mjs", destination], { cwd: fileURLToPath(new URL("..", import.meta.url)) });
    const result = JSON.parse(await readFile(destination, "utf8"));
    assert.equal(result.model_revision, "material-state-v2");
    for (const [code, fraction] of [["65000", 0], ["30000", 1]]) {
      // An uplifted, incompletely cemented bed must not retain the effective
      // pressure of its past depth. The old exporter made these identical.
      const bin = 40, depth = 810, profile = result.profiles.maximum_burial_plus_500m[code];
      assert.ok(profile[bin] < rockVelocity(fraction, depth + 500, false, null) - 10);
      for (const bin of [0, 40, 149]) {
        let slowness = 0;
        for (let m = 0; m < 20; m++) slowness += 1 / rockVelocity(fraction, bin * 20 + m + 0.5, false, null);
        near(result.profiles.present_hydrostatic[code][bin], 20 / slowness, 1e-9);
      }
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

// A passing legacy 2% raster-area screen must not hide a failed grain budget.
test("checks pass conservative thrust transport and still expose an injected grain failure", async () => {
  const result = await reference();
  assert.ok(result.physics.area < 0.02);
  assert.equal(result.sediment.failedEvents, 0);
  assert.equal(result.sediment.failedSections, 0);
  const rows = checkRows(result).filter(r => r.group === "Sediment conservation");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "pass");
  const corrupted = structuredClone(result);
  corrupted.sediment.failedEvents = 1; corrupted.sediment.failedSections = 1;
  assert.equal(checkRows(corrupted).find(r => r.group === "Sediment conservation").status, "fail");
});
