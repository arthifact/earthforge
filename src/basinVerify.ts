// Checks of the basin simulator against published values (lab/basin_simulator.md),
// measured on many simulated sections: velocity with depth below the sea floor
// against Hamilton's marine-sediment fits; growth-fault expansion index
// (Thorsen 1963) for units deposited before and during each fault's activity;
// whether displacement at the fault cutoffs grows for older units; fault dips near the top after all
// deformation; slip, sedimentation and subsidence rates; and the physics checks
// (rock kept by each slip, no trapped water, the same seed giving the same
// section). Known-answer tests: normal-fault heave; thrust kinematics against
// the fault-parallel flow applied at once, and the backlimb dip against the
// ramp dip (Suppe 1983); compaction against the decompaction equation.
// Nothing here is used by the simulator.

import { BASEMENT, COMPACTION, DOMAIN, domainOf, faultDepth, flowLine, flowMove, simulate, thrustPoints, WATER, windowOf, type Basin, type BasinOptions, type Fault } from "./basin";
import { DEPTH, WIDTH } from "./window";

export interface Verification {
  sections: number;
  /** Sections per setting. */
  settings: { extension: number; compression: number };
  /** Velocity below the sea floor: depths (m) and the 10th, 50th and 90th percentiles (m/s) over all columns of all sections. */
  velocity: { depth: number[]; p10: number[]; p50: number[]; p90: number[] };
  /** Expansion index (hanging-wall / footwall thickness near the fault) of units deposited before a fault's first slip and during its activity. */
  expansion: { before: number[]; during: number[] };
  /** Faults (of those measured) where, for older units: the chord between the unit's two cutoffs grows; the heave between them grows (all units; the kinematics conserves heave); the throw grows (units deposited while the fault slipped). */
  throwGrows: { faults: number; growing: number }; heaveGrows: { faults: number; growing: number }; growthThrow: { faults: number; growing: number };
  /** Faults failing the heave check, by the first that applies: crossed by another fault anywhere in the simulated grid, top within 1 km of a window side, nested (its top inside another fault's hanging wall; added after looking at the failures), antithetic (dipping west), other. */
  heaveFailures: { crossed: number; edge: number; nested: number; antithetic: number; other: number };
  /** Normal-fault dip (degrees) between the sea floor and 1 km below it, on the final traces. */
  dips: number[];
  /** Rates (mm/yr): normal-fault slip along the dip, sedimentation (thickest per step), mean subsidence per step. */
  rates: { slip: number[]; sedimentation: number[]; subsidence: number[] };
  /** Physics: largest relative rock change in a slip; trapped water cells; the first seed simulated twice gives the same grid. */
  physics: { area: number; trapped: number; deterministic: boolean };
  /** Known-answer test (one fault, no erosion, no folds, no compaction), on the 20 m grid and again on a 10 m grid: units whose measured heave is within 40 m of the heave applied after their deposition; mean and largest error (m). */
  kinematics: { units: number; within: number; worst: number; mean: number; fine: { units: number; within: number; worst: number; mean: number } };
  /**
   * Known-answer test of compaction (no faults, no erosion, no overpressure): the solid in each bed against what was
   * deposited (largest relative difference); and each bed's thickness in every tenth column against the thickness the
   * decompaction equation gives for its solid at its depth: runs measured, within one cell, mean and largest error (m).
   */
  compaction: { beds: number; worstSolid: number; runs: number; within: number; mean: number; worst: number };
  /**
   * Known-answer tests of a thrust (one thrust, no erosion, uniform subsidence, no compaction), 20 m and 10 m grids:
   * hanging-wall cells of pre-thrust beds (2 cells from a bed boundary and from the fault) holding the bed the
   * fault-parallel flow applied at once puts there; backlimb dips (pre-thrust unit tops over the ramp, moved there from
   * the lower flat) minus the ramp dip (degrees); the largest rock change in a slip.
   */
  thrust: { cells: number; matched: number; fine: { cells: number; matched: number }; dips: number[]; area: number };
  /** Compression sections: total thrust slip per section (km); fraction of window columns with a velocity inversion (a drop of 300 m/s below a faster rock above, within the sediments), per setting. */
  compression: { slip: number[]; inversions: { extension: number[]; compression: number[] } };
}

export const percentile = (v: number[], p: number) => { if (!v.length) return NaN; const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]; };

/** Hamilton (1979) turbidites, km/s at D km below the sea floor (fit to about 1 km); Hamilton (1985) DSDP terrigenous. */
export const hamilton1979 = (d: number) => 1000 * (1.511 + 1.304 * d - 0.741 * d * d + 0.257 * d * d * d);
export const hamilton1985 = (d: number) => 1000 * (1.510 + 1.019 * d);

/** Units (thickness, top depth) in an internal column. */
function unitIn(b: Basin, i: number, unit: number) {
  let top = -1, n = 0;
  for (let k = 0; k < b.nz; k++) { const c = b.grid[k * b.nx + i]; if (c >= 0 && b.beds[c].unit === unit) { if (top < 0) top = k * b.h; n++; } }
  return { thickness: n * b.h, top };
}
const column = (b: Basin, x: number) => Math.round((x + DOMAIN.margin) / b.h);

/**
 * A unit's top cutoffs on a fault, from column scans, refined the way horizons are tied to a fault: on each side the
 * unit's top is followed in the columns where it is intact (its depth minus the fault's, d(x), is positive), and d is
 * extended linearly from the last two such columns to where it reaches 0, so the cutoff is good to well under a cell
 * even where bed and fault meet at a low angle. Scanning from the footwall side, the hanging-wall side is the first
 * columns holding the unit above the fault (its top's height above the fault grows away from the cutoff); the footwall
 * side is where the unit's top below the fault stops being intact. Null if either side is missing or a cutoff lies
 * within 300 m of the grid's bottom (deeper units leave the grid there and cannot be measured).
 */
export function cutoffs(b: Basin, f: Fault, unit: number) {
  const cols = Array.from({ length: b.nx }, (_, k) => (f.dir > 0 ? k : b.nx - 1 - k)), X = (i: number) => -DOMAIN.margin + i * b.h;
  const unitTop = (i: number, below: number) => { for (let k = 0; k < b.nz; k++) { if (k * b.h < below) continue; const c = b.grid[k * b.nx + i]; if (c >= 0 && b.beds[c].unit === unit) return k * b.h; } return NaN; };
  // Footwall: d = top below the fault - fault depth, positive while intact.
  let fw: [number, number] | null = null;
  const fwRun: [number, number][] = [];
  for (const i of cols) {
    const x = X(i), zf = faultDepth(f, x), top = unitTop(i, Number.isFinite(zf) ? zf : -1);
    if (!Number.isFinite(top)) { if (fwRun.length) break; continue; }
    if (!Number.isFinite(zf)) { fwRun.length = 0; continue; }
    const d = top - zf;
    if (d > b.h) { fwRun.push([x, d]); continue; }
    if (fwRun.length) {
      const [x1, d1] = fwRun[fwRun.length - 1], [x0, d0] = fwRun.length > 1 ? fwRun[fwRun.length - 2] : [x1 - f.dir * b.h, d1 + 1];
      const slope = (d1 - d0) / (x1 - x0), xc = slope !== 0 ? x1 - d1 / slope : x;
      const xcut = f.dir * (xc - x1) >= 0 && f.dir * (x - xc) >= 0 ? xc : x;
      fw = [xcut, faultDepth(f, xcut)];
    }
    break;
  }
  // Hanging wall: the first columns holding the unit above the fault; d = fault depth - the unit's top there.
  let hw: [number, number] | null = null;
  const hwRun: [number, number][] = [];
  for (const i of cols) {
    const x = X(i), zf = faultDepth(f, x);
    if (!Number.isFinite(zf)) continue;
    let top = NaN;
    for (let k = 0; k * b.h < zf && k < b.nz; k++) { const c = b.grid[k * b.nx + i]; if (c >= 0 && b.beds[c].unit === unit) { top = k * b.h; break; } }
    if (!Number.isFinite(top)) { if (hwRun.length) break; continue; }
    hwRun.push([x, zf - top]);
    if (hwRun.length === 3) break;
  }
  if (hwRun.length) {
    const [x0, d0] = hwRun[0], [x1, d1] = hwRun.length > 1 ? hwRun[hwRun.length - 1] : [x0 + f.dir * b.h, d0 + 1];
    const slope = (d1 - d0) / (x1 - x0), xc = slope !== 0 ? x0 - d0 / slope : x0;
    const xcut = f.dir * (x0 - xc) >= 0 && f.dir * (x0 - xc) <= 2 * b.h ? xc : x0;
    hw = [xcut, faultDepth(f, xcut)];
  }
  if (!hw || !fw || !Number.isFinite(hw[1]) || !Number.isFinite(fw[1])) return null;
  if (Math.max(hw[1], fw[1]) > DOMAIN.depth - 300) return null;
  return { hw, fw };
}

/**
 * Per fault and unit: the top cutoffs (column scans, extended into the fault), and the unit's thickness in a column 250 m beyond each cutoff
 * into its side. The expansion index is hanging wall over footwall thickness; heave, throw and the chord are the
 * horizontal, vertical and straight-line distances between the cutoffs.
 */
export function measureFault(b: Basin, f: Fault) {
  const out: { unit: number; ei: number; displacement: number; heave: number; throw: number }[] = [];
  for (const unit of new Set(b.beds.map((x) => x.unit))) {
    const c = cutoffs(b, f, unit);
    if (!c) continue;
    const j = (x: number, s: 1 | -1) => column(b, x + s * f.dir * 250), jh = j(c.hw[0], 1), jf = j(c.fw[0], -1);
    if (jh < 0 || jh >= b.nx || jf < 0 || jf >= b.nx) continue;
    const hwT = unitIn(b, jh, unit).thickness, fwT = unitIn(b, jf, unit).thickness;
    if (fwT < 2 * b.h || hwT < 2 * b.h) continue;
    out.push({ unit, ei: hwT / fwT, displacement: Math.hypot(c.hw[0] - c.fw[0], c.hw[1] - c.fw[1]), heave: Math.abs(c.hw[0] - c.fw[0]), throw: c.hw[1] - c.fw[1] });
  }
  return out;
}

/** Whether two fault traces cross anywhere in the simulated grid (the window plus its margins, to its full depth). */
function crosses(f: { x: number[]; z: number[] }, g: { x: number[]; z: number[] }) {
  const inside = (x: number, z: number) => x >= -DOMAIN.margin && x <= WIDTH + DOMAIN.margin && z >= 0 && z <= DOMAIN.depth;
  const step = (n: number) => Math.max(1, Math.floor(n / 150));
  for (let i = 0; i + step(f.x.length) < f.x.length; i += step(f.x.length)) {
    const i2 = i + step(f.x.length), ax = f.x[i], az = f.z[i], bx = f.x[i2], bz = f.z[i2];
    if (!inside(ax, az) && !inside(bx, bz)) continue;
    for (let j = 0; j + step(g.x.length) < g.x.length; j += step(g.x.length)) {
      const j2 = j + step(g.x.length), cx = g.x[j], cz = g.z[j], dx = g.x[j2], dz = g.z[j2];
      const den = (bx - ax) * (dz - cz) - (bz - az) * (dx - cx);
      if (Math.abs(den) < 1e-9) continue;
      const t = ((cx - ax) * (dz - cz) - (cz - az) * (dx - cx)) / den, s = ((cx - ax) * (bz - az) - (cz - az) * (bx - ax)) / den;
      if (t >= 0 && t <= 1 && s >= 0 && s <= 1) return true;
    }
  }
  return false;
}

/**
 * The thickness a bed of solid S (m) has with its top d below the sea floor, from the decompaction equation:
 * the integral of (1 - porosity) over the bed equals S, porosity from the simulator's curves (no overpressure).
 */
export function compactedThickness(S: number, d: number, f: number, carbonate: boolean) {
  const curves = carbonate ? [[1, COMPACTION.chalk]] as const : [[f, COMPACTION.sand], [1 - f, COMPACTION.shale]] as const;
  const solidIn = (T: number) => T - curves.reduce((a, [w, c]) => a + w * c.phi0 * c.L * Math.exp(-d / c.L) * (1 - Math.exp(-T / c.L)), 0);
  let lo = 0, hi = S / 0.25 + 1;
  for (let it = 0; it < 60; it++) { const m = 0.5 * (lo + hi); if (solidIn(m) < S) lo = m; else hi = m; }
  return 0.5 * (lo + hi);
}

/** The compaction known-answer test on one section (see Verification.compaction). */
function compactionCheck(b: Basin, tally: Verification["compaction"], errors: number[]) {
  const sum = new Float64Array(b.beds.length), deep = new Uint8Array(b.beds.length), floorCut = DOMAIN.depth - 300;
  for (let k = 0; k < b.nz; k++) for (let i = 0; i < b.nx; i++) { const n = k * b.nx + i, c = b.grid[n]; if (c >= 0) { sum[c] += b.solid[n]; if (k * b.h > floorCut) deep[c] = 1; } }
  b.deposited.forEach((dep, c) => { if (deep[c] || dep <= 0) return; tally.beds++; tally.worstSolid = Math.max(tally.worstSolid, Math.abs(sum[c] - dep) / dep); });
  for (let i = 0; i < b.nx; i += 10) {
    let kf = 0; while (kf < b.nz && b.grid[kf * b.nx + i] === WATER) kf++;
    for (let k = kf; k < b.nz;) {
      const c = b.grid[k * b.nx + i];
      if (c < 0) { k++; continue; }
      let k2 = k, S = 0; while (k2 < b.nz && b.grid[k2 * b.nx + i] === c) { S += b.solid[k2 * b.nx + i]; k2++; }
      if (k2 * b.h <= floorCut && k2 - k >= 2) {
        const bed = b.beds[c], x = -DOMAIN.margin + i * b.h, f = Math.min(1, Math.max(0, bed.a + bed.b * Math.tanh((x - bed.c) / bed.d)));
        const error = (k2 - k) * b.h - compactedThickness(S, (k - kf) * b.h, f, bed.carbonate);
        tally.runs++; errors.push(error); if (Math.abs(error) <= b.h) tally.within++; tally.worst = Math.max(tally.worst, Math.abs(error));
      }
      k = k2;
    }
  }
}

/**
 * The thrust known-answer tests on one section with one thrust (see Verification.thrust). With uniform subsidence and no
 * compaction the footwall and the fault keep their shape in a frame moving down with the subsidence, and fault-parallel
 * flow along fixed flow lines composes: slips s1 then s2 equal one slip s1 + s2. So each hanging-wall cell is traced
 * back, slip by slip (dropped if its rock was above sea level at a step, where the grid has none), to the grid at the
 * end of the pre-thrust phase.
 */
function thrustCheck(b: Basin, tally: { cells: number; matched: number }, dips: number[] | null) {
  const f = b.faults[0];
  if (!f || f.kind !== "thrust") return;
  const h = b.h, X = (i: number) => -DOMAIN.margin + i * h;
  let acc = 0; const cum = b.log.map((l) => (acc += l.shift * h)), base = cum[b.preSteps - 1], shiftTotal = cum[cum.length - 1] - base;
  const F = flowLine(thrustPoints(b, f).map(([x, z]) => [x, z - shiftTotal] as [number, number])), total = f.heaves.reduce((a, c) => a + c, 0);
  const i0 = Math.round(DOMAIN.margin / h), i1 = Math.round((DOMAIN.margin + WIDTH) / h);
  for (let i = i0; i <= i1; i++) {
    const zf = f.depth[i];
    for (let k = 0; k < b.nz && k * h < zf - 2 * h; k++) {
      let x = X(i), z = k * h - shiftTotal, ok = true;
      for (let t = f.heaves.length - 1; t >= 0 && ok; t--) {
        const off = cum[f.start + t] - base;
        if (z + off < 0) ok = false;
        [x, z] = flowMove(F, x, z, -f.heaves[t]);
        if (z + off < 0) ok = false;
      }
      if (!ok) continue;
      const is = Math.min(b.nx - 1, Math.max(0, Math.round((x + DOMAIN.margin) / h))), ks = Math.round(z / h);
      if (ks < 2 || ks >= b.nz - 2) continue;
      const expected = b.pre[ks * b.nx + is];
      if (expected === WATER) continue;
      let clear = true; for (let d = -2; d <= 2; d++) if (b.pre[(ks + d) * b.nx + is] !== expected) clear = false;
      if (!clear) continue;
      tally.cells++; if (b.grid[k * b.nx + i] === expected) tally.matched++;
    }
  }
  if (!dips || F.t.length < 2) return;
  // Backlimb: each pre-thrust unit's top over the ramp (2 cells inside the ramp domain and above the fault) whose rock
  // came from the lower flat; a line fitted over at least 10 columns, against the ramp's dip.
  const ramp = Math.atan2(Math.abs(F.P[2][1] - F.P[1][1]), Math.abs(F.P[2][0] - F.P[1][0])) * 180 / Math.PI;
  const side = (j: number, x: number, z: number) => (x - F.P[j][0]) * F.m[j][0] + (z - F.P[j][1]) * F.m[j][1];
  for (let unit = 0; unit < b.preSteps; unit++) {
    const pts: [number, number][] = [];
    for (let i = 0; i < b.nx; i++) {
      let zt = NaN;
      for (let k = 0; k < b.nz && k * h < f.depth[i]; k++) { const c = b.grid[k * b.nx + i]; if (c >= 0 && b.beds[c].unit === unit) { zt = k * h; break; } }
      if (!Number.isFinite(zt)) continue;
      const x = X(i), z = zt - shiftTotal;
      if (side(1, x, z) < 2 * h || (F.t.length > 2 && side(2, x, z) > -2 * h)) continue;
      if ((x - F.P[1][0]) * F.n[1][0] + (z - F.P[1][1]) * F.n[1][1] < 2 * h) continue;
      const [xs, zs] = flowMove(F, x, z, -total);
      if (domainOf(F, xs, zs) !== 0 || side(1, xs, zs) > -2 * h) continue;
      pts.push([x, zt]);
    }
    if (pts.length < 10) continue;
    const mx = pts.reduce((a, p) => a + p[0], 0) / pts.length, mz = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    const slope = pts.reduce((a, p) => a + (p[0] - mx) * (p[1] - mz), 0) / pts.reduce((a, p) => a + (p[0] - mx) ** 2, 0);
    dips.push(Math.atan(Math.abs(slope)) * 180 / Math.PI - ramp);
  }
}

/** Fraction of the window's columns with a velocity inversion: within the sediments, a drop of 300 m/s below a faster rock above. */
function inversions(w: ReturnType<typeof windowOf>) {
  let n = 0;
  for (let i = 0; i < w.nx; i++) {
    let fastest = 0;
    for (let k = 0; k < w.nz; k++) {
      const c = w.beds[k * w.nx + i];
      if (c < 0) continue;
      const v = w.velocity[k * w.nx + i];
      if (v < fastest - 300) { n++; break; }
      fastest = Math.max(fastest, v);
    }
  }
  return n / w.nx;
}

/** Simulate sections from consecutive seeds and measure; yields to the page between sections. */
export async function verify(base: BasinOptions, first: number, count: number, onProgress?: (done: string) => void): Promise<Verification> {
  const depthStep = 100, depths = Array.from({ length: Math.floor(DEPTH / depthStep) }, (_, k) => (k + 0.5) * depthStep);
  const vbin = 20, vlo = 1400, nv = Math.ceil((5600 - vlo) / vbin) + 1, hist = depths.map(() => new Float64Array(nv));
  const res: Verification = { sections: count, settings: { extension: 0, compression: 0 }, velocity: { depth: depths, p10: [], p50: [], p90: [] }, expansion: { before: [], during: [] }, throwGrows: { faults: 0, growing: 0 }, heaveGrows: { faults: 0, growing: 0 }, growthThrow: { faults: 0, growing: 0 }, heaveFailures: { crossed: 0, edge: 0, nested: 0, antithetic: 0, other: 0 }, dips: [],
    rates: { slip: [], sedimentation: [], subsidence: [] }, physics: { area: 0, trapped: 0, deterministic: true },
    kinematics: { units: 0, within: 0, worst: 0, mean: 0, fine: { units: 0, within: 0, worst: 0, mean: 0 } },
    compaction: { beds: 0, worstSolid: 0, runs: 0, within: 0, mean: 0, worst: 0 },
    thrust: { cells: 0, matched: 0, fine: { cells: 0, matched: 0 }, dips: [], area: 0 },
    compression: { slip: [], inversions: { extension: [], compression: [] } } };
  const pause = () => new Promise((r) => setTimeout(r, 0));
  // The known-answer test: one fault, no erosion, no folds, no compaction; a unit deposited at step u carries the heave
  // of every later slip. On the 20 m grid, then on a 10 m grid: an error from the grid's rounding shrinks with the
  // cell, a bug does not.
  for (const [tally, h] of [[res.kinematics, 20], [res.kinematics.fine, 10]] as const) {
    let sum = 0;
    for (let s = 0; s < 12; s++) {
      onProgress?.(`known-answer test, normal fault, ${h} m grid: ${s + 1} / 12`);
      const b = simulate({ ...base, h, seed: 900001 + s, setting: "extension", faults: [1, 1], quiet: true, compaction: false, record: false }), f = b.faults[0];
      if (!f) continue;
      for (const r of measureFault(b, f)) {
        let expected = 0; f.heaves.forEach((hv, j) => { if (f.start + j > r.unit) expected += hv; });
        const error = Math.abs(r.heave - expected);
        tally.units++; sum += error; if (error <= 40) tally.within++; tally.worst = Math.max(tally.worst, error);
      }
      await pause();
    }
    tally.mean = tally.units ? sum / tally.units : NaN;
  }
  // Compaction: no faults, no erosion, no overpressure.
  const compactionErrors: number[] = [];
  for (let s = 0; s < 6; s++) {
    onProgress?.(`known-answer test, compaction: ${s + 1} / 6`);
    compactionCheck(simulate({ ...base, h: 20, seed: 910001 + s, setting: "extension", faults: [0, 0], quiet: true, compaction: true, overpressure: 0, record: false }), res.compaction, compactionErrors);
    await pause();
  }
  res.compaction.mean = compactionErrors.length ? compactionErrors.reduce((a, c) => a + c, 0) / compactionErrors.length : NaN;
  // Thrust: one thrust, no erosion, uniform subsidence, no compaction; 20 m and 10 m grids.
  for (const [tally, h] of [[res.thrust, 20], [res.thrust.fine, 10]] as const) {
    for (let s = 0; s < 12; s++) {
      onProgress?.(`known-answer test, thrust, ${h} m grid: ${s + 1} / 12`);
      const b = simulate({ ...base, h, seed: 920001 + s, setting: "compression", thrusts: [1, 1], quiet: true, compaction: false, overpressure: 0, record: false });
      thrustCheck(b, tally, h === 20 ? res.thrust.dips : null);
      res.thrust.area = Math.max(res.thrust.area, b.checks.area);
      await pause();
    }
  }
  for (let s = 0; s < count; s++) {
    const b = simulate({ ...base, seed: first + s, record: false }), w = windowOf(b);
    res.settings[b.setting]++;
    if (s === 0) { const again = simulate({ ...base, seed: first, record: false }); res.physics.deterministic = again.grid.every((x, i) => x === b.grid[i]); }
    res.physics.area = Math.max(res.physics.area, b.checks.area); res.physics.trapped += b.checks.trapped;
    res.compression.inversions[b.setting].push(inversions(w));
    if (b.setting === "compression") res.compression.slip.push(b.faults.reduce((a, f) => a + f.heave, 0) / 1000);
    // Velocity below the sea floor, sediments only (not basement or water).
    for (let i = 0; i < w.nx; i++) for (let k = 0; k < w.nz; k++) {
      const c = w.beds[k * w.nx + i], d = k * (DEPTH / (w.nz - 1)) - w.floor[i];
      if (c === WATER || c === BASEMENT || d < 0) continue;
      const bin = Math.floor(d / depthStep);
      if (bin < depths.length) hist[bin][Math.min(nv - 1, Math.max(0, Math.round((w.velocity[k * w.nx + i] - vlo) / vbin)))]++;
    }
    const normal = b.faults.filter((f) => f.kind === "normal");
    for (const f of normal) {
      const m = measureFault(b, f);
      for (const r of m) (r.unit < f.start ? res.expansion.before : r.unit <= f.end ? res.expansion.during : []).push(r.ei);
      // For older units (smaller index), within 40 m (two cells), for at least 80% of neighbouring pairs: the chord, the heave (all units), the throw (units deposited while the fault slipped).
      const grows = (list: typeof m, key: "displacement" | "heave" | "throw", tally: { faults: number; growing: number }) => {
        if (list.length < 3) return null;
        const sorted = [...list].sort((a, c) => a.unit - c.unit);
        let ok = 0; for (let j = 1; j < sorted.length; j++) if (sorted[j - 1][key] >= sorted[j][key] - 40) ok++;
        tally.faults++; const pass = ok >= 0.8 * (sorted.length - 1); if (pass) tally.growing++;
        return pass;
      };
      grows(m, "displacement", res.throwGrows); grows(m.filter((r) => r.unit >= f.start && r.unit <= f.end), "throw", res.growthThrow);
      if (grows(m, "heave", res.heaveGrows) === false) {
        const top = f.dir > 0 ? f.x[0] : f.x[f.x.length - 1];
        if (normal.some((g) => g !== f && crosses(f, g))) res.heaveFailures.crossed++;
        else if (top < 1000 || top > WIDTH - 1000) res.heaveFailures.edge++;
        else if (normal.some((g) => { if (g === f) return false; const z = f.z[f.dir > 0 ? 0 : f.z.length - 1], zg = faultDepth(g, top); return Number.isFinite(zg) && z < zg; })) res.heaveFailures.nested++;
        else if (f.dir < 0) res.heaveFailures.antithetic++;
        else res.heaveFailures.other++;
      }
      // Dip between the sea floor and 1 km below it (final trace).
      const at = (zt: number) => { for (let p = 0; p < f.x.length; p++) { const q = f.dir > 0 ? p : f.x.length - 1 - p; if (f.z[q] >= zt) return q; } return -1; };
      const floorAt = (x: number) => { const i = Math.round(x / WIDTH * (w.nx - 1)); return i >= 0 && i < w.nx ? w.floor[i] : NaN; };
      const top = f.dir > 0 ? 0 : f.x.length - 1, sf = floorAt(f.x[top]);
      if (Number.isFinite(sf)) { const a = at(sf), c = at(sf + 1000); if (a >= 0 && c >= 0 && a !== c) res.dips.push(Math.atan2(Math.abs(f.z[c] - f.z[a]), Math.abs(f.x[c] - f.x[a])) * 180 / Math.PI); }
      for (const hv of f.heaves) res.rates.slip.push(hv / Math.cos(f.dip) / b.dt / 1000);
    }
    for (const l of b.log) { res.rates.sedimentation.push(l.deposited / b.dt / 1000); res.rates.subsidence.push(l.subsidence / b.dt / 1000); }
    onProgress?.(`sections: ${s + 1} / ${count}`);
    await pause();
  }
  hist.forEach((hst) => {
    const total = hst.reduce((a, c) => a + c, 0), q = (p: number) => { let acc = 0; for (let j = 0; j < nv; j++) { acc += hst[j]; if (acc >= p * total) return vlo + j * vbin; } return NaN; };
    res.velocity.p10.push(total ? q(0.1) : NaN); res.velocity.p50.push(total ? q(0.5) : NaN); res.velocity.p90.push(total ? q(0.9) : NaN);
  });
  return res;
}
