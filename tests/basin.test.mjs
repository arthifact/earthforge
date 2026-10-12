import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

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
  medianVelocityAt, invalidStateCells, samePhysicalState } =
  await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`);

let benchmark;
const reference = () => benchmark ??= verify({ ...BASIN_DEFAULTS, faults: [1, 2] }, 765183, 20);

test("original known-answer tolerances and the reported seed 765183 batch", async () => {
  const result = await reference();
  const rows = checkRows(result);
  const failures = rows.filter((row) => row.status === "fail");
  assert.deepEqual(failures, [], JSON.stringify(failures, null, 2));
  assert.ok(result.kinematics.units >= 120, "retain the measurable coarse-grid horizons");
  assert.equal(result.kinematics.within, result.kinematics.units);
  assert.ok(result.kinematics.worst <= 40);
  assert.ok(result.compaction.runs > 14000, "retain the resolved beds");
  assert.ok(result.compaction.within >= 0.95 * result.compaction.runs);
  assert.ok(Math.abs(result.compaction.mean) <= 5);
  assert.ok(result.compaction.meanAbs <= 5);
  assert.ok(result.compaction.fine.meanAbs < result.compaction.meanAbs);
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

test("displayed velocity lookup stays within 5 m/s of rock physics, including overpressure boundaries", () => {
  const h = 20, nx = 661, nz = 226, grid = new Int32Array(nx * nz), burial = new Float32Array(nx * nz);
  // Sweep sand fractions across the overpressure threshold and depths between table nodes.
  const beds = Array.from({ length: nx }, (_, i) => ({ a: (i - 100) / 460, b: 0, c: 0, d: 1, carbonate: false }));
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) { grid[k * nx + i] = i; burial[k * nx + i] = k * h + 7; }
  for (const overpressure of [null, 1805]) for (const carbonate of [false, true]) for (const offset of [7, 4007]) {
    beds.forEach((bed) => { bed.carbonate = carbonate; });
    for (let k = 0; k < nz; k++) burial.fill(k * h + offset, k * nx, (k + 1) * nx);
    const b = { nx, nz, h, grid, burial, beds, overpressure };
    const w = windowOf(b);
    let worst = 0, location = "";
    for (let k = 0; k < w.nz; k++) for (let i = 0; i < w.nx; i++) {
      const expected = rockVelocity(i / 460, k * h + offset, carbonate, overpressure);
      const error = Math.abs(w.velocity[k * w.nx + i] - expected);
      if (error > worst) { worst = error; location = `sand ${i / 460}, depth ${k * h + offset}, overpressure ${overpressure}, carbonate ${carbonate}`; }
    }
    assert.ok(worst <= 5, `${worst} m/s at ${location}`);
  }
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
  const good = { h: 20, grid: new Int32Array([-1, -2, 0]), solid: new Float64Array([0, 0, 10]), burial: new Float32Array([0, 0, 500]), beds: [{}], faults: [] };
  assert.equal(invalidStateCells(good), 0);
  for (const mutate of [
    (b) => { b.solid[2] = 20.1; }, (b) => { b.solid[0] = 1; }, (b) => { b.solid[2] = NaN; },
    (b) => { b.burial[2] = -1; }, (b) => { b.burial[2] = Infinity; }, (b) => { b.grid[2] = 1; },
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
    assert.ok(windowOf(b).velocity.every((v) => Number.isFinite(v) && v >= 1500 && v <= 5600), label);
  }
  assert.equal(cases, 16);
});
