// A 2D basin simulator (lab/basin_simulator.md): a section built forward in
// time, step by step (each step 0.5-2 Myr), on a grid wider and deeper than
// the 9.2 x 3 km window, in one of two tectonic settings.
// Extension: regional subsidence with gentle folds (after rifting, decaying
// with the lithosphere's thermal time constant, 62.8 Myr: McKenzie 1978);
// slip on listric normal growth faults, basinward ones younger and each one's
// slip rate rising to a peak and falling (Thorsen 1963), whose hanging walls
// deform by vertical shear (Verrall 1981) and roll over into the fault.
// Compression: a layered section shortened by thrusts that ramp up from a
// basal detachment to an upper flat or to the sea floor, one at a time toward
// the foreland, older ones carried on younger ones (piggyback); hanging walls
// move by fault-parallel flow (dip domains bounded by the bisectors of the
// fault bends), which folds them over the ramps (fault-bend folds: the
// backlimb dips as the ramp, Suppe 1983); foreland subsidence deepening toward
// the thrusts. Both: erosion above wave base; deposition that fills the space
// down to a base level (growth strata, thicker in normal-fault hanging walls,
// thinning onto thrust anticlines); mechanical compaction: beds thin as they
// are buried, keeping their solid grains while porosity follows Sclater and
// Christie (1980), and faults move with the compacting rock (which flattens
// them: Xiao and Suppe 1989). Each unit is split into beds whose sand fraction
// varies along the section. Velocity comes from rock physics at each rock's
// deepest burial so far (compaction is not undone by uplift or erosion, the
// basis of exhumation estimates from sonic logs: Japsen): porosity from the
// same curves, velocity from the soft-sand model (Dvorkin and Nur 1996: a
// Hertz-Mindlin grain pack under effective pressure, Gassmann for the brine)
// cementing into Raymer, Hunt and Gardner (1980) with burial; quartz, clay and
// calcite mineral moduli; optional undercompaction under an overpressure top;
// crystalline basement below, water above. Seeded: one seed, one section.

import { DEPTH, GNX, GNZ, H, WIDTH } from "./window";

/** The simulated domain: this far beyond the window on each side, and this deep (m). */
const MARGIN = 2000, ZMAX = 4500;
export const WATER = -1, BASEMENT = -2;
/** Thermal time constant of the lithosphere (McKenzie 1978), Myr. */
export const THERMAL_TAU = 62.8;

export type Setting = "extension" | "compression";
export const SETTINGS: Setting[] = ["extension", "compression"];
export interface BasinOptions {
  seed: number;
  /** Grid spacing of the simulation (m): 20 for the gallery, 10 for a section to record waves on. */
  h: number;
  /** Tectonic setting; "any" draws one per seed (half each). */
  setting: Setting | "any";
  /** Range of the number of growth faults (extension) and of thrusts (compression). */
  faults: [number, number]; thrusts: [number, number];
  /** Probability of an overpressured interval; of a carbonate unit (per unit). */
  overpressure: number; carbonate: number;
  /** Mechanical compaction: beds thin as they are buried (off only for the kinematics tests). */
  compaction: boolean;
  /** Keep the state after every step (for the history replay). */
  record: boolean;
  /** For tests: no low sea level (so no erosion) and no folds; in compression also no tilt (uniform subsidence). */
  quiet?: boolean;
}
export const BASIN_DEFAULTS: BasinOptions = { seed: 1, h: 20, setting: "any", faults: [2, 4], thrusts: [1, 3], overpressure: 0.35, carbonate: 0.1, compaction: true, record: false };

/** The setting a seed gets under "any" (its own random stream, so the section's stream is the same as when chosen directly). */
export const settingOf = (o: Pick<BasinOptions, "seed" | "setting">): Setting => o.setting !== "any" ? o.setting : mulberry32(o.seed * 7919 + 101)() < 0.5 ? "extension" : "compression";

export type Phase = "pre-rift" | "syn-rift" | "post-rift" | "pre-thrust" | "syn-thrust" | "post-thrust";
const PHASES: Record<Setting, [Phase, Phase, Phase]> = { extension: ["pre-rift", "syn-rift", "post-rift"], compression: ["pre-thrust", "syn-thrust", "post-thrust"] };
/** A bed: its unit (= the step it was deposited in), phase and sand fraction along the section f(x) = a + b tanh((x - c) / d), clamped to [0, 1]; or a carbonate. */
export interface Bed { unit: number; phase: Phase; a: number; b: number; c: number; d: number; carbonate: boolean }
/**
 * A fault: its depth per grid column (NaN where it is not defined), and the same as a polyline sorted by x for drawing
 * and measuring; dip at the top (a thrust: its ramp), detachment depth, active steps, and its displacement so far and
 * per step (heave for a normal fault, slip along the fault for a thrust). A normal fault is defined from its top column
 * (top end first for dir 1, last for dir -1) toward its hanging wall and carries the fraction of a cell to its next
 * slip. A thrust is defined across the grid: lower flat, ramp, then an upper flat or the sea floor; it dips toward the
 * hinterland (dir = -transport); bends are the columns of its lower and upper bends, and per dip domain (lower flat,
 * ramp, upper flat) it carries the rounding of the hanging wall's whole-cell moves (m, x and z).
 */
export interface Fault {
  kind: "normal" | "thrust";
  dir: 1 | -1; depth: Float64Array; top: number; x: number[]; z: number[]; dip: number; detachment: number; start: number; end: number; heave: number; heaves: number[]; remainder: number;
  thrust?: { transport: 1 | -1; bends: [number, number]; emergent: boolean; upper: number; carry: [number, number][] };
}
export interface StepLog { step: number; phase: Phase; text: string; subsidence: number; deposited: number; shift: number }
export interface Snapshot { step: number; grid: Int32Array; burial: Float32Array; faults: { dir: 1 | -1; x: number[]; z: number[] }[] }
export interface Basin {
  options: BasinOptions; setting: Setting; nx: number; nz: number; h: number;
  /** Bed index per cell (z rows of x), WATER or BASEMENT. */
  grid: Int32Array;
  /** Per cell: solid grains (m of the cell's height), and the deepest burial below the sea floor so far (m). */
  solid: Float64Array; burial: Float32Array;
  beds: Bed[]; faults: Fault[]; log: StepLog[]; snapshots: Snapshot[];
  /** Solid deposited per bed (sum over its cells, m). */
  deposited: number[];
  /** The grid at the end of the first phase (before any faulting), and that phase's number of steps. */
  pre: Int32Array; preSteps: number;
  /** Duration of a step (Myr). */
  dt: number;
  basementVelocity: number;
  /** Overpressure top below the sea floor (m), or null. */
  overpressure: number | null;
  /** trapped: water cells found below the sea floor; area: largest relative change of hanging-wall rock in one slip (both kinematics keep area). */
  checks: { trapped: number; area: number; steps: number; seconds: number };
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Depth of a normal fault at x (interpolated along its polyline; flat beyond its deep end), or NaN on the footwall side beyond its top. */
export function faultDepth(f: { dir: 1 | -1; x: number[]; z: number[] }, x: number): number {
  const n = f.x.length, top = f.dir > 0 ? 0 : n - 1;
  if (f.dir * (x - f.x[top]) < 0) return NaN;
  if (x <= f.x[0]) return f.z[0];
  if (x >= f.x[n - 1]) return f.z[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (f.x[m] <= x) lo = m; else hi = m; }
  const t = (x - f.x[lo]) / (f.x[hi] - f.x[lo] || 1);
  return f.z[lo] + t * (f.z[hi] - f.z[lo]);
}

// Fault-parallel flow over a polyline fault (points in transport order, z down). Above segment j a point keeps its
// distance delta from the segment's line and moves parallel to it; the dip domains are bounded by the bisectors of
// the bends, on which the distance to both segments is the same, so a point crosses into the next domain at the same
// delta: flow lines are the fault's parallel curves, and moving every point the same distance along them keeps area.
type V = [number, number];
export interface FlowLine { P: V[]; t: V[]; n: V[]; b: V[]; m: V[] }
const unit = (v: V): V => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
const dot = (a: V, c: V) => a[0] * c[0] + a[1] * c[1];
export function flowLine(P: V[]): FlowLine {
  const t: V[] = [], n: V[] = [], b: V[] = [[0, 0]], m: V[] = [[0, 0]];
  for (let j = 0; j + 1 < P.length; j++) {
    const tj = unit([P[j + 1][0] - P[j][0], P[j + 1][1] - P[j][1]]);
    // The normal pointing up (z decreasing), into the hanging wall.
    t.push(tj); n.push(tj[0] >= 0 ? [tj[1], -tj[0]] : [-tj[1], tj[0]]);
  }
  for (let j = 1; j < t.length; j++) { b.push(unit([n[j - 1][0] + n[j][0], n[j - 1][1] + n[j][1]])); m.push(unit([t[j - 1][0] + t[j][0], t[j - 1][1] + t[j][1]])); }
  return { P, t, n, b, m };
}
/** The dip domain of a point: how many bend bisectors it lies beyond. */
export function domainOf(F: FlowLine, x: number, z: number) {
  let j = 0;
  for (let k = 1; k < F.t.length; k++) { if ((x - F.P[k][0]) * F.m[k][0] + (z - F.P[k][1]) * F.m[k][1] > 0) j = k; else break; }
  return j;
}
/** A hanging-wall point moved a distance s along its flow line (s < 0: backward). */
export function flowMove(F: FlowLine, x: number, z: number, s: number): V {
  let j = domainOf(F, x, z);
  const q: V = [x - F.P[j][0], z - F.P[j][1]], delta = dot(q, F.n[j]), last = F.t.length - 1;
  let u = dot(q, F.t[j]), left = s;
  const start = (d: number) => d === 0 ? -Infinity : dot(F.b[d], F.t[d]) * delta / dot(F.b[d], F.n[d]);
  const end = (d: number) => d === last ? Infinity : dot([F.P[d + 1][0] - F.P[d][0], F.P[d + 1][1] - F.P[d][1]], F.t[d]) + dot(F.b[d + 1], F.t[d]) * delta / dot(F.b[d + 1], F.n[d]);
  for (let guard = 0; guard < 16; guard++) {
    if (left >= 0) { const e = end(j); if (u + left <= e) { u += left; break; } left -= Math.max(0, e - u); j++; u = start(j); }
    else { const st = start(j); if (u + left >= st) { u += left; break; } left += Math.max(0, u - st); j--; u = end(j); }
  }
  return [F.P[j][0] + F.t[j][0] * u + F.n[j][0] * delta, F.P[j][1] + F.t[j][1] * u + F.n[j][1] * delta];
}
/** A thrust's flow polyline from its depth per column: the hinterland edge, the lower and upper bends, the foreland edge. */
export function thrustPoints(b: { nx: number; h: number }, f: Fault): V[] {
  const th = f.thrust!, X = (i: number) => -MARGIN + i * b.h, back = th.transport > 0 ? 0 : b.nx - 1, front = th.transport > 0 ? b.nx - 1 : 0;
  // A ramp that reaches the grid's edge has no upper flat inside it.
  return [back, th.bends[0], th.bends[1], front].filter((i, j, a) => j === 0 || i !== a[j - 1]).map((i) => [X(i), f.depth[i]] as V);
}

/** Depth used for compaction: below an overpressure top, shale-rich beds compact a quarter as fast (disequilibrium compaction). */
export const effectiveDepth = (f: number, d: number, carbonate: boolean, overpressure: number | null) =>
  overpressure !== null && !carbonate && f < 0.4 && d > overpressure ? overpressure + 0.25 * (d - overpressure) : Math.max(0, d);
/** Porosity at an (effective) depth: Sclater and Christie's sand and shale curves mixed by sand fraction, or chalk. */
export const porosity = (f: number, de: number, carbonate: boolean) => {
  const curve = (c: { phi0: number; L: number }) => c.phi0 * Math.exp(-de / c.L);
  return carbonate ? curve(COMPACTION.chalk) : f * curve(COMPACTION.sand) + (1 - f) * curve(COMPACTION.shale);
};

export function simulate(options: BasinOptions): Basin {
  const t0 = performance.now(), o = options, rng = mulberry32(o.seed * 2654435761 + 12345), setting = settingOf(o), names = PHASES[setting];
  const u = (a: number, b: number) => a + (b - a) * rng(), int = (a: number, b: number) => Math.floor(u(a, b + 1));
  const h = o.h, nx = Math.round((WIDTH + 2 * MARGIN) / h) + 1, nz = Math.round(ZMAX / h) + 1, X = (i: number) => -MARGIN + i * h;
  const col = (x: number) => Math.min(nx - 1, Math.max(0, Math.round((x + MARGIN) / h)));
  let grid = new Int32Array(nx * nz), solid = new Float64Array(nx * nz), burial = new Float32Array(nx * nz);
  const wd0 = u(30, 150), dt = u(0.5, 2);
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) grid[k * nx + i] = k * h < wd0 ? WATER : BASEMENT;
  const beds: Bed[] = [], deposited: number[] = [], faults: Fault[] = [], log: StepLog[] = [], snapshots: Snapshot[] = [];
  let areaError = 0, pre = grid.slice();

  // The plan of each setting (counts of steps per phase, faults, subsidence).
  let nPre: number, nSyn: number, nPost: number, subsidence: (stage: number, k: number) => (x: number) => number;
  const xn = (x: number) => x / WIDTH - 0.5;
  type NormalPlan = { x: number; dir: 1 | -1; start: number; end: number; dip: number; detachment: number; heaves: number[] };
  type ThrustPlan = { x1: number; transport: 1 | -1; dip: number; start: number; end: number; slips: number[]; emergent: boolean; zdFrac: number; zuFrac: number };
  let plan: NormalPlan[] = [], thrustPlan: ThrustPlan[] = [], shoreline = (k: number) => 0 * k;
  if (setting === "extension") {
    nPre = int(2, 4); nSyn = int(8, 16); nPost = int(3, 8);
    // Growth faults: traces spread over the window (at least 900 m apart), most dipping basinward (+x), basinward ones
    // younger; dips 45-70 degrees at the top; each one's heave per step rises to a peak and falls over its active steps.
    const nF = int(o.faults[0], o.faults[1]), xs: number[] = [];
    for (let tries = 0; xs.length < nF && tries < 500; tries++) { const x = u(0.08 * WIDTH, 0.92 * WIDTH); if (xs.every((y) => Math.abs(y - x) > 900)) xs.push(x); }
    xs.sort((a, b) => a - b);
    plan = xs.map((x, r) => {
      const start = nPre + Math.min(nSyn - 2, Math.floor((r / Math.max(1, xs.length)) * 0.6 * nSyn) + int(0, 1));
      const end = Math.min(nPre + nSyn - 1, start + int(Math.round(0.4 * nSyn), nSyn)), n = end - start + 1, mean = u(25, 80);
      const shape = Array.from({ length: n }, (_, j) => Math.sin(Math.PI * (j + 0.5) / n)), sum = shape.reduce((a, b) => a + b, 0);
      return { x, dir: (rng() < 0.75 ? 1 : -1) as 1 | -1, start, end, dip: u(45, 70) * Math.PI / 180, detachment: u(2500, 5000), heaves: shape.map((s) => mean * n * s / sum * u(0.8, 1.2)) };
    });
    // Subsidence per step (m); after rifting it decays with the thermal time constant.
    const p0 = { s0: u(150, 350), tilt: u(-0.3, 0.3) }, p1 = { s0: u(80, 220), tilt: u(0, 0.8), fold: u(0, 40) * (o.quiet ? 0 : 1), lambda: u(3000, 9000), phase: u(0, 2 * Math.PI) };
    const p2 = { s0: u(60, 160), tilt: u(0, 0.5), fold: u(0, 25) * (o.quiet ? 0 : 1), lambda: u(4000, 10000), phase: u(0, 2 * Math.PI), shore: u(0.1, 0.4) * WIDTH, advance: u(200, 700) };
    subsidence = (stage, k) => stage === 0 ? (x) => p0.s0 * (1 + p0.tilt * xn(x))
      : stage === 1 ? (x) => p1.s0 * (1 + p1.tilt * xn(x)) + p1.fold * Math.sin(2 * Math.PI * x / p1.lambda + p1.phase)
        : (x) => p2.s0 * Math.exp(-k * dt / THERMAL_TAU) * (1 + p2.tilt * xn(x)) + p2.fold * Math.sin(2 * Math.PI * x / p2.lambda + p2.phase);
    shoreline = (k) => p2.shore + k * p2.advance;
  } else {
    // Thrusts: ramps from a basal detachment near the base of the sediments, at least 2 km apart along the transport
    // direction (drawn per section) and active one at a time from the hinterland toward the foreland; ramps dip 18-32
    // degrees (Andersonian thrusts near 30); half reach the sea floor, half end on an upper flat (a higher detachment);
    // each slips 0.6-2.4 km over its steps, the rate rising and falling.
    const transport: 1 | -1 = rng() < 0.5 ? 1 : -1, nT = int(o.thrusts[0], o.thrusts[1]);
    nPre = int(4, 8); nSyn = int(Math.max(6, 2 * nT), 12); nPost = int(2, 5);
    const xis: number[] = [];
    for (let tries = 0; xis.length < nT && tries < 500; tries++) { const xi = u(-0.1 * WIDTH, 0.55 * WIDTH); if (xis.every((y) => Math.abs(y - xi) > 2000)) xis.push(xi); }
    xis.sort((a, b) => a - b);
    const per = Math.floor(nSyn / Math.max(1, xis.length)), extra = nSyn - per * Math.max(1, xis.length);
    let at = nPre;
    thrustPlan = xis.map((xi, r) => {
      const n = per + (r < extra ? 1 : 0), start = at, end = at + n - 1; at += n;
      const total = u(600, 2400), shape = Array.from({ length: n }, (_, j) => Math.sin(Math.PI * (j + 0.5) / n)), sum = shape.reduce((a, b) => a + b, 0);
      return { x1: transport > 0 ? xi : WIDTH - xi, transport, dip: u(18, 32) * Math.PI / 180, start, end, slips: shape.map((s) => total * s / sum), emergent: rng() < 0.5, zdFrac: u(0.6, 0.92), zuFrac: u(0.3, 0.55) };
    });
    // Subsidence per step (m): a passive margin before, then a foreland basin deepening toward the thrusts (the hinterland).
    const p0 = { s0: u(120, 300), tilt: o.quiet ? 0 : u(-0.2, 0.2) }, p1 = { s0: u(60, 200), tilt: o.quiet ? 0 : u(0, 0.8) }, p2 = { s0: u(30, 120), tilt: o.quiet ? 0 : u(0, 0.4) };
    subsidence = (stage) => { const p = [p0, p1, p2][stage]; return stage === 0 ? (x) => p.s0 * (1 + p.tilt * xn(x)) : (x) => p.s0 * (1 - transport * p.tilt * xn(x)); };
  }
  const total = nPre + nSyn + nPost;
  const basinSlope = u(0, 150), basementVelocity = u(4800, 5500), overpressure = rng() < o.overpressure ? u(1500, 2500) : null;
  const residual = new Float64Array(nx);

  const top = (g: Int32Array, i: number) => { for (let k = 0; k < nz; k++) if (g[k * nx + i] !== WATER) return k; return nz; };
  /** A fault's trace for drawing and measuring: the columns where it is defined, in order of x, and its depth there. */
  const sync = (f: Fault) => {
    const xsList: number[] = [], zsList: number[] = [];
    for (let i = 0; i < nx; i++) if (Number.isFinite(f.depth[i])) { xsList.push(X(i)); zsList.push(f.depth[i]); }
    f.x = xsList; f.z = zsList;
  };
  const porosityAt = (c: number, i: number, d: number) => { const bed = beds[c], f = sand(bed, X(i)); return porosity(f, effectiveDepth(f, d, bed.carbonate, overpressure), bed.carbonate); };
  /** Columns moved down by s(x) (up if negative), in whole cells with the remainder carried; faults move with their columns. Returns the first column's shift. */
  const subside = (s: (x: number) => number) => {
    const shift = new Int32Array(nx), cg = new Int32Array(nz), cs = new Float64Array(nz), cb = new Float32Array(nz);
    for (let i = 0; i < nx; i++) {
      residual[i] += s(X(i)) / h; const d = Math.floor(residual[i]); residual[i] -= d; shift[i] = d;
      if (d === 0) continue;
      for (let k = 0; k < nz; k++) {
        const src = k - d, n = (src < 0 ? 0 : Math.min(nz - 1, src)) * nx + i;
        if (src < 0) { cg[k] = WATER; cs[k] = 0; cb[k] = 0; } else { cg[k] = grid[n]; cs[k] = solid[n]; cb[k] = burial[n]; }
      }
      for (let k = 0; k < nz; k++) { grid[k * nx + i] = cg[k]; solid[k * nx + i] = cs[k]; burial[k * nx + i] = cb[k]; }
    }
    for (const f of faults) { for (let i = 0; i < nx; i++) if (Number.isFinite(f.depth[i])) f.depth[i] += shift[i] * h; sync(f); }
    return shift[0];
  };
  /**
   * Other faults' points in a moving hanging wall (above the fault by more than half a cell) move to where the rock
   * goes; each trace is rebuilt column by column (two points landing in one column are averaged, gaps interpolated).
   * A normal fault's hanging-wall side reaches the domain edge (flat beyond its last point); a thrust's ends stay open.
   */
  const carry = (active: Fault, move: (x: number, z: number) => V | null) => {
    for (const g of faults) {
      if (g === active) continue;
      const sum = new Float64Array(nx), count = new Float64Array(nx);
      let movedAny = false;
      for (let i = 0; i < nx; i++) {
        const d = g.depth[i];
        if (!Number.isFinite(d)) continue;
        const zf = active.depth[i];
        let c = i, nd = d;
        if (Number.isFinite(zf) && d < zf - (active.kind === "thrust" ? h / 2 : 0)) {
          const p = move(X(i), d);
          if (!p) continue;
          c = Math.round((p[0] + MARGIN) / h); nd = p[1]; movedAny = true;
        }
        if (c >= 0 && c < nx) { sum[c] += nd; count[c]++; }
      }
      if (!movedAny) continue;
      const depth = new Float64Array(nx).fill(NaN);
      let first = -1, last = -1;
      for (let i = 0; i < nx; i++) if (count[i]) { depth[i] = sum[i] / count[i]; if (first < 0) first = i; last = i; }
      for (let i = first + 1; i < last; i++) if (!count[i]) {
        let a = i - 1; while (!count[a]) a--; let c2 = i + 1; while (!count[c2]) c2++;
        depth[i] = depth[a] + (depth[c2] - depth[a]) * (i - a) / (c2 - a);
      }
      if (g.kind === "normal") {
        if (g.dir > 0) { for (let i = last + 1; i < nx; i++) depth[i] = depth[last]; g.top = first; }
        else { for (let i = 0; i < first; i++) depth[i] = depth[first]; g.top = last; }
      }
      g.depth = depth; sync(g);
    }
  };
  /**
   * One slip increment (heave) on a normal fault: its hanging wall moves by vertical shear (x, z) -> (x + h, z +
   * z_f(x + h) - z_f(x)), which keeps every column's rock (area); the gap at the scarp opens as water; other faults in
   * the hanging wall move along. The fault is held as one depth per grid column, so the rock and the fault move by the
   * same cells and no cell can change sides by rounding. The hanging wall moves by whole cells; the fraction is carried
   * to the fault's next slip, so the heave applied (and recorded) adds up to the heave asked for. A hanging-wall cell
   * takes its rock from above the fault at its source column only. Checks that each hanging-wall column holds the rock
   * its source column held above the fault.
   */
  const slip = (f: Fault, asked: number) => {
    const carried = f.remainder + asked / h, cells = Math.round(carried), heave = cells * h;
    f.remainder = carried - cells;
    const next = grid.slice(), nextSolid = solid.slice(), nextBurial = burial.slice();
    let moved = 0, lost = 0;
    for (let i = 0; i < nx; i++) {
      const zf = f.depth[i];
      if (!Number.isFinite(zf)) continue;
      const is = i - f.dir * cells, zs = is >= 0 && is < nx ? f.depth[is] : NaN, gap = !Number.isFinite(zs), dz = gap ? 0 : zf - zs;
      // The last cell of the source column above the fault: a hanging-wall cell never takes footwall rock.
      const ksTop = gap ? -1 : Math.ceil(zs / h) - 1;
      let after = 0;
      for (let k = 0; k < nz; k++) {
        const z = k * h, n = k * nx + i;
        if (!(z < zf)) break;
        if (gap) { next[n] = WATER; nextSolid[n] = 0; nextBurial[n] = 0; continue; }
        const ks = Math.min(Math.round((z - dz) / h), ksTop);
        if (ks < 0) { next[n] = WATER; nextSolid[n] = 0; nextBurial[n] = 0; continue; }
        const src = Math.min(nz - 1, ks) * nx + is, c = grid[src];
        next[n] = c; nextSolid[n] = solid[src]; nextBurial[n] = burial[src]; if (c !== WATER) after++;
      }
      if (gap) continue;
      // The source column's rock above the fault, within what fits in the domain after moving down by dz.
      let before = 0;
      for (let k = 0; k < nz; k++) { const z = k * h; if (!(z < zs) || z + dz >= ZMAX) break; if (grid[k * nx + is] !== WATER) before++; }
      moved += before; lost += Math.abs(after - before);
    }
    if (moved > 0) areaError = Math.max(areaError, lost / moved);
    grid = next; solid = nextSolid; burial = nextBurial;
    carry(f, (x, d) => {
      const i = col(x), c = i + f.dir * cells, zn = c >= 0 && c < nx ? f.depth[c] : NaN;
      return [X(c), d + (Number.isFinite(zn) ? zn - f.depth[i] : 0)];
    });
    f.heave += heave; f.heaves.push(heave); sync(f);
  };
  /**
   * One slip increment on a thrust: its hanging wall (above the fault) moves a distance s along its flow lines
   * (fault-parallel flow); rock moved past the grid's top is lost, rock enters at the hinterland edge as the edge
   * column continued. Each domain moves by whole cells, its rounding carried to the next slip (so the rock does not
   * drift off the flow lines); a cell never takes footwall rock. Checks the hanging wall's rock: what it held, plus what
   * entered, minus what left.
   */
  const thrustSlip = (f: Fault, s: number) => {
    const th = f.thrust!, F = flowLine(thrustPoints({ nx, h }, f));
    const corr = F.t.map((t, j): V => {
      const c = th.carry[j], ex = s * t[0], ez = s * t[1], dx = Math.round((ex - c[0]) / h), dz = Math.round((ez - c[1]) / h);
      c[0] += dx * h - ex; c[1] += dz * h - ez;
      return [ex - dx * h, ez - dz * h];
    });
    const next = grid.slice(), nextSolid = solid.slice(), nextBurial = burial.slice(), xmax = X(nx - 1);
    let before = 0, after = 0, inflow = 0, lost = 0;
    for (let i = 0; i < nx; i++) {
      const zf = f.depth[i], x = X(i);
      for (let k = 0; k < nz && k * h < zf; k++) {
        const z = k * h, n = k * nx + i;
        if (grid[n] !== WATER) {
          before++;
          const [xa, za] = flowMove(F, x, z, s);
          if (za < -h / 2 || xa < -MARGIN - h / 2 || xa > xmax + h / 2) lost++;
        }
        const j = domainOf(F, x, z), [xb, zb] = flowMove(F, x, z, -s), xs = xb + corr[j][0], zs = zb + corr[j][1];
        let is = Math.round((xs + MARGIN) / h), outside = false;
        if (is < 0) { is = 0; outside = true; } else if (is >= nx) { is = nx - 1; outside = true; }
        const zfs = f.depth[is], ks = Math.min(Math.round(zs / h), Number.isFinite(zfs) ? Math.ceil(zfs / h) - 1 : nz - 1);
        if (ks < 0) { next[n] = WATER; nextSolid[n] = 0; nextBurial[n] = 0; continue; }
        const src = Math.min(nz - 1, ks) * nx + is;
        next[n] = grid[src]; nextSolid[n] = solid[src]; nextBurial[n] = burial[src];
        if (grid[src] !== WATER) { after++; if (outside) inflow++; }
      }
    }
    if (before > 0) areaError = Math.max(areaError, Math.abs(after - (before + inflow - lost)) / before);
    grid = next; solid = nextSolid; burial = nextBurial;
    carry(f, (x, z) => { const [xa, za] = flowMove(F, x, z, s), j = domainOf(F, xa, za); return [xa - corr[j][0], za - corr[j][1]]; });
    f.heave += s; f.heaves.push(s); sync(f);
  };
  /** A normal fault's trace from its top column (at sea level) down to its detachment (listric, exponential), one depth per column. */
  const createFault = (p: NormalPlan): Fault => {
    const top = col(p.x), tan = Math.tan(p.dip), depth = new Float64Array(nx).fill(NaN);
    for (let i = top; i >= 0 && i < nx; i += p.dir) { const s = Math.abs(i - top) * h; depth[i] = p.detachment * (1 - Math.exp(-s * tan / p.detachment)); }
    const f: Fault = { kind: "normal", dir: p.dir, x: [], z: [], depth, top, dip: p.dip, detachment: p.detachment, start: p.start, end: p.end, heave: 0, heaves: [], remainder: 0 };
    sync(f); return f;
  };
  /**
   * A thrust: a lower flat at a fraction of the sediment thickness above the basement (at the lower bend), a ramp at its
   * dip, then an upper flat at a fraction of the way up from the detachment to the sea floor, or the sea floor itself.
   */
  const createThrust = (p: ThrustPlan): Fault => {
    const i1 = Math.min(nx - 2, Math.max(1, col(p.x1))), kf = top(grid, i1);
    let kb = kf; while (kb < nz && grid[kb * nx + i1] !== BASEMENT) kb++;
    const floor = kf * h, zd = Math.min(ZMAX - 200, floor + p.zdFrac * (kb * h - floor)), zu = floor + p.zuFrac * (zd - floor), tan = Math.tan(p.dip);
    const depth = new Float64Array(nx), upper = (i: number) => p.emergent ? top(grid, i) * h : zu;
    let i2 = p.transport > 0 ? nx - 1 : 0;
    for (let j = 0; j < nx; j++) {
      const i = p.transport > 0 ? j : nx - 1 - j, xi = p.transport * (X(i) - X(i1)), ramp = zd - Math.max(0, xi) * tan;
      depth[i] = Math.max(ramp, upper(i));
      if (xi > 0 && ramp <= upper(i) && p.transport * (i2 - i) > 0) i2 = i;
    }
    const f: Fault = { kind: "thrust", dir: (-p.transport) as 1 | -1, x: [], z: [], depth, top: i2, dip: p.dip, detachment: zd, start: p.start, end: p.end, heave: 0, heaves: [], remainder: 0,
      thrust: { transport: p.transport, bends: [i1, i2], emergent: p.emergent, upper: p.emergent ? upper(i2) : zu, carry: [[0, 0], [0, 0], [0, 0]] } };
    sync(f); return f;
  };
  /** A growing normal fault reaches up to sea level again along its top dip, column by column (it cuts the newest sediment). */
  const extendUp = (f: Fault) => {
    const tan = Math.tan(f.dip), top = f.top, zt = f.depth[top];
    for (let j = 1; ; j++) {
      const i = top - f.dir * j;
      if (i < 0 || i >= nx || zt - (j - 1) * h * tan <= 0) break;
      f.depth[i] = Math.max(0, zt - j * h * tan);
      if (f.depth[i] === 0 || i === 0 || i === nx - 1) { f.top = i; break; }
      f.top = i;
    }
    sync(f);
  };
  /**
   * Mechanical compaction of every column, from the bottom up: a sediment cell holding solid s at porosity phi (at its
   * depth below the sea floor) fills s / (1 - phi) of its height h; the shortfall is summed up the column and each time
   * it reaches a whole cell, a cell is removed (its solid joins a neighbour of the same bed) and the column above moves
   * down one cell. Cells are never added, so compaction is not undone by uplift or erosion. A fault moves down with the
   * cells removed below it, so rock and faults stay on their sides.
   */
  const compact = () => {
    const removed: number[] = [];
    for (let i = 0; i < nx; i++) {
      const kf = top(grid, i);
      if (kf >= nz) continue;
      let shortfall = 0, w = nz - 1, below = WATER;
      removed.length = 0;
      for (let k = nz - 1; k >= kf; k--) {
        const n = k * nx + i, c = grid[n];
        if (c >= 0) {
          shortfall += h - solid[n] / (1 - porosityAt(c, i, (k - kf + 0.5) * h));
          if (shortfall >= h) {
            const merge = below === c ? (w + 1) * nx + i : k - 1 >= kf && grid[(k - 1) * nx + i] === c ? (k - 1) * nx + i : -1;
            if (merge >= 0) { solid[merge] += solid[n]; shortfall -= h; removed.push(k); continue; }
          }
        }
        if (w !== k) { const m = w * nx + i; grid[m] = c; solid[m] = solid[n]; burial[m] = burial[n]; }
        below = c; w--;
      }
      for (let k = kf; k <= w; k++) { const n = k * nx + i; grid[n] = WATER; solid[n] = 0; burial[n] = 0; }
      if (removed.length) for (const f of faults) {
        const zf = f.depth[i];
        if (!Number.isFinite(zf)) continue;
        let m = 0; for (const k of removed) if (k * h >= zf) m++;
        f.depth[i] += m * h;
      }
    }
    for (const f of faults) sync(f);
  };
  /** Each rock cell's deepest burial below the sea floor so far. */
  const bury = () => {
    for (let i = 0; i < nx; i++) {
      const kf = top(grid, i);
      for (let k = kf; k < nz; k++) { const n = k * nx + i; if (grid[n] >= 0) { const d = (k - kf + 0.5) * h; if (d > burial[n]) burial[n] = d; } }
    }
  };

  for (let step = 0; step < total; step++) {
    const stage = step < nPre ? 0 : step < nPre + nSyn ? 1 : 2, phase = names[stage], parts: string[] = [];
    const k = step - (stage === 0 ? 0 : stage === 1 ? nPre : nPre + nSyn);
    // 1. Subsidence.
    const s = subsidence(stage, k), shift = subside(s);
    const meanSubsidence = (s(0) + s(WIDTH / 2) + s(WIDTH)) / 3;
    parts.push(`subsided ${s(0).toFixed(0)}-${s(WIDTH).toFixed(0)} m`);
    // 2. Faults: new ones appear, active ones slip.
    if (setting === "extension") {
      for (const p of plan) if (p.start === step) { faults.push(createFault(p)); parts.push(`fault ${faults.length} appears at ${(p.x / 1000).toFixed(1)} km, dipping ${p.dir > 0 ? "east" : "west"} ${(p.dip * 180 / Math.PI).toFixed(0)}°`); }
      faults.forEach((f, n) => {
        if (step < f.start || step > f.end) return;
        extendUp(f);
        slip(f, plan[n].heaves[step - f.start]);
        parts.push(`fault ${n + 1} slips ${f.heaves[f.heaves.length - 1].toFixed(0)} m (heave ${f.heave.toFixed(0)} m so far)`);
      });
    } else {
      for (const p of thrustPlan) if (p.start === step) {
        const f = createThrust(p); faults.push(f);
        parts.push(`thrust ${faults.length} forms: ramp at ${(p.x1 / 1000).toFixed(1)} km dipping ${(p.dip * 180 / Math.PI).toFixed(0)}° from a detachment at ${(f.detachment / 1000).toFixed(1)} km ${p.emergent ? "to the sea floor" : `to an upper flat at ${(f.thrust!.upper / 1000).toFixed(1)} km`}, moving ${p.transport > 0 ? "east" : "west"}`);
      }
      faults.forEach((f, n) => {
        if (step < f.start || step > f.end) return;
        thrustSlip(f, thrustPlan[n].slips[step - f.start]);
        parts.push(`thrust ${n + 1} slips ${f.heaves[f.heaves.length - 1].toFixed(0)} m (${f.heave.toFixed(0)} m so far)`);
      });
    }
    // 3. Erosion above wave base; 4. deposition down to the base level.
    const lowstand = rng() < 0.2 && !o.quiet, wd = lowstand ? u(0, 40) : u(30, 300), waveBase = o.quiet ? 0 : wd - 30;
    let eroded = 0;
    if (waveBase > 0) for (let kk = 0; kk * h < waveBase; kk++) for (let i = 0; i < nx; i++) { const n = kk * nx + i; if (grid[n] !== WATER) { grid[n] = WATER; solid[n] = 0; burial[n] = 0; eroded++; } }
    const unit = step, nBeds = int(2, 6), fill = stage === 0 ? 1 : u(0.75, 1), drape = u(5, 20), first = beds.length;
    const carb = rng() < o.carbonate * (stage === 0 ? 1.5 : 0.6), a0 = u(0.15, 0.6);
    for (let b = 0; b < nBeds; b++) {
      const alt = (b % 2 ? 1 : -1) * u(0.05, stage === 1 ? 0.3 : 0.15);
      if (setting === "extension" && stage === 2) beds.push({ unit, phase, a: 0.45 + alt, b: -0.35, c: shoreline(k), d: u(800, 2000), carbonate: carb && b === 0 });
      else beds.push({ unit, phase, a: a0 + alt, b: stage === 1 ? u(-0.3, 0.3) : stage === 2 ? u(-0.2, 0.2) : 0, c: u(0, WIDTH), d: u(1500, 4000), carbonate: carb });
      deposited.push(0);
    }
    let thickest = 0;
    for (let i = 0; i < nx; i++) {
      const t = top(grid, i), zTop = t * h, zBase = wd + basinSlope * (X(i) / WIDTH);
      const thick = Math.max(0, zTop - zBase) * fill + drape, zNew = zTop - thick, kn = Math.max(0, Math.ceil(zNew / h));
      if (X(i) >= 0 && X(i) <= WIDTH) thickest = Math.max(thickest, thick);
      for (let kk = kn; kk < t; kk++) {
        const frac = (kk * h - zNew) / thick, id = first + Math.min(nBeds - 1, Math.max(0, Math.floor(frac * nBeds))), n = kk * nx + i, d = (kk - kn + 0.5) * h;
        grid[n] = id; solid[n] = h * (1 - porosityAt(id, i, d)); burial[n] = d; deposited[id] += solid[n];
      }
    }
    // 5. Compaction under the new load.
    if (o.compaction) compact();
    bury();
    parts.push(`${lowstand ? "low sea level, " : ""}${eroded ? `${(eroded * h * h / 1e6).toFixed(2)} km² eroded, ` : ""}up to ${thickest.toFixed(0)} m deposited (unit ${unit + 1}, ${nBeds} beds${carb ? ", carbonate" : ""})`);
    log.push({ step, phase, text: parts.join("; "), subsidence: meanSubsidence, deposited: thickest, shift });
    if (step === nPre - 1) pre = grid.slice();
    if (o.record) snapshots.push({ step, grid: grid.slice(), burial: burial.slice(), faults: faults.map((f) => ({ dir: f.dir, x: f.x.slice(), z: f.z.slice() })) });
  }
  // Check: no water below the sea floor in any column (filled from the cell above, counted).
  let trapped = 0;
  for (let i = 0; i < nx; i++) {
    let seen = false;
    for (let k = 0; k < nz; k++) {
      const n = k * nx + i, c = grid[n];
      if (c !== WATER) seen = true;
      else if (seen) { grid[n] = grid[n - nx]; solid[n] = solid[n - nx]; burial[n] = burial[n - nx]; trapped++; }
    }
  }
  return { options: o, setting, nx, nz, h, grid, solid, burial, beds, faults, log, snapshots, deposited, pre, preSteps: nPre, dt, basementVelocity, overpressure, checks: { trapped, area: areaError, steps: total, seconds: (performance.now() - t0) / 1000 } };
}

/** Sand fraction of a bed at x. */
export const sand = (b: Bed, x: number) => Math.min(1, Math.max(0, b.a + b.b * Math.tanh((x - b.c) / b.d)));

/** Mineral and fluid moduli (Pa) and densities (kg/m^3): quartz, clay, calcite (as in rock-physics handbooks), brine. */
const QUARTZ = { K: 37e9, mu: 44e9, rho: 2650 }, CLAY = { K: 21e9, mu: 7e9, rho: 2580 }, CALCITE = { K: 70.8e9, mu: 30.3e9, rho: 2710 }, BRINE = { K: 2.4e9, rho: 1030 };
const VF = Math.sqrt(BRINE.K / BRINE.rho);
/** Porosity-depth (Sclater and Christie 1980): surface porosity and e-folding depth (m). Chalk's pair is the commonly quoted one (not confirmed). */
export const COMPACTION = { shale: { phi0: 0.63, L: 1960 }, sand: { phi0: 0.49, L: 3700 }, chalk: { phi0: 0.70, L: 1410 } };
/** Soft-sand model: coordination number, critical porosity of sand and shale, mean overburden density (kg/m^3), shale's quartz-silt share, cementation depths (m). */
export const ROCK = { coordination: 8.6, phicSand: 0.40, phicShale: 0.65, overburden: 1950, shaleQuartz: 0.4, cementFrom: 1500, cementTo: 2500 };

/**
 * Velocity from rock physics at burial depth d below the sea floor (the deepest so far). Porosity: Sclater and
 * Christie's exponentials, sand and shale curves mixed by the sand fraction (or chalk); undercompacted shale-rich beds
 * below an overpressure top keep a quarter of the further compaction (and of the effective stress). Mineral: quartz and
 * clay (shale is 60% clay, 40% quartz silt) by the Hill average, or calcite. Clastics: the soft-sand model (Dvorkin and
 * Nur 1996): a Hertz-Mindlin grain pack at critical porosity under the effective pressure (overburden 1950 kg/m^3,
 * hydrostatic pore pressure), the modified Hashin-Shtrikman lower bound to the mineral, frame stiffness falling linearly
 * to 0 over 0.15 porosity above critical (then Wood's suspension), Gassmann for the brine; blended smoothly into
 * Raymer-Hunt-Gardner (consolidated, cemented rock) between 1.5 and 2.5 km below the sea floor. Carbonate:
 * Raymer-Hunt-Gardner on calcite. 1500-5600 m/s.
 */
export function rockVelocity(f: number, d: number, carbonate: boolean, overpressure: number | null): number {
  const de = effectiveDepth(f, d, carbonate, overpressure), phi = porosity(f, de, carbonate);
  let K: number, mu: number, rho: number;
  if (carbonate) ({ K, mu, rho } = CALCITE);
  else {
    const q = f + ROCK.shaleQuartz * (1 - f), hill = (a: number, b: number) => 0.5 * (q * a + (1 - q) * b + 1 / (q / a + (1 - q) / b));
    K = hill(QUARTZ.K, CLAY.K); mu = hill(QUARTZ.mu, CLAY.mu); rho = q * QUARTZ.rho + (1 - q) * CLAY.rho;
  }
  const vm = Math.sqrt((K + 4 / 3 * mu) / rho), rhob = phi * BRINE.rho + (1 - phi) * rho;
  // Raymer-Hunt-Gardner (consolidated) below 37%, Wood above 47%, slowness interpolated between.
  const rhgAt = (p: number) => (1 - p) ** 2 * vm + p * VF;
  const woodAt = (p: number) => Math.sqrt(1 / (p / BRINE.K + (1 - p) / K) / (p * BRINE.rho + (1 - p) * rho));
  const rhg = phi <= 0.37 ? rhgAt(phi) : phi >= 0.47 ? woodAt(phi) : 1 / ((0.47 - phi) / 0.1 / rhgAt(0.37) + (phi - 0.37) / 0.1 / woodAt(0.47));
  if (carbonate) return Math.min(5600, Math.max(1500, rhg));
  // Soft sand: Hertz-Mindlin at critical porosity, P = (overburden - brine) g depth.
  const phic = ROCK.phicSand * f + ROCK.phicShale * (1 - f), n = ROCK.coordination, nu = (3 * K - 2 * mu) / (2 * (3 * K + mu));
  const P = Math.max(1e4, (ROCK.overburden - BRINE.rho) * 9.81 * de), a = n * n * (1 - phic) ** 2 * mu * mu * P / (Math.PI ** 2 * (1 - nu) ** 2);
  const Khm = Math.cbrt(a / 18), muHm = (5 - 4 * nu) / (10 - 5 * nu) * Math.cbrt(1.5 * a);
  let Kd: number, mud: number;
  if (phi <= phic) {
    const r = phi / phic, z = muHm / 6 * (9 * Khm + 8 * muHm) / (Khm + 2 * muHm);
    Kd = 1 / (r / (Khm + 4 / 3 * muHm) + (1 - r) / (K + 4 / 3 * muHm)) - 4 / 3 * muHm;
    mud = 1 / (r / (muHm + z) + (1 - r) / (mu + z)) - z;
  } else { const s = Math.max(0, 1 - (phi - phic) / 0.15); Kd = Khm * s; mud = muHm * s; }
  const Ksat = Kd + (1 - Kd / K) ** 2 / (phi / BRINE.K + (1 - phi) / K - Kd / (K * K));
  const soft = Math.sqrt((Ksat + 4 / 3 * mud) / rhob);
  // Cementation with burial: the soft-sand velocity blends into the consolidated one.
  const t = Math.min(1, Math.max(0, (de - ROCK.cementFrom) / (ROCK.cementTo - ROCK.cementFrom))), w = t * t * (3 - 2 * t);
  return Math.min(5600, Math.max(1500, (1 - w) * soft + w * Math.max(soft, rhg)));
}

/**
 * The window (the 9.2 x 3 km section) sampled from a simulated state at spacing hw (m): velocity (at each
 * rock's deepest burial), bed index and sea floor depth per column.
 */
export function windowOf(b: Basin, state: { grid: Int32Array; burial: Float32Array } = b, hw = H): { velocity: Float32Array; beds: Int32Array; nx: number; nz: number; floor: Float64Array } {
  const grid = state.grid, nx = Math.round(WIDTH / hw) + 1, nz = Math.round(DEPTH / hw) + 1, velocity = new Float32Array(nx * nz), ids = new Int32Array(nx * nz), floorDepth = new Float64Array(nx);
  for (let i = 0; i < nx; i++) {
    const x = i * hw, gi = Math.min(b.nx - 1, Math.round((x + MARGIN) / b.h));
    let floor = b.nz;
    for (let k = 0; k < b.nz; k++) if (grid[k * b.nx + gi] !== WATER) { floor = k; break; }
    floorDepth[i] = floor * b.h;
    for (let k = 0; k < nz; k++) {
      const z = k * hw, gk = Math.min(b.nz - 1, Math.round(z / b.h)), n = gk * b.nx + gi, c = grid[n], d = z - floor * b.h;
      ids[k * nx + i] = c;
      velocity[k * nx + i] = c === WATER ? 1500 : c === BASEMENT ? Math.min(5600, b.basementVelocity + 0.1 * Math.max(0, d)) : rockVelocity(sand(b.beds[c], x), Math.max(state.burial[n], d), b.beds[c].carbonate, b.overpressure);
    }
  }
  return { velocity, beds: ids, nx, nz, floor: floorDepth };
}
/** The simulated domain's margin (m), for tools that read the internal grid. */
export const DOMAIN = { margin: MARGIN, depth: ZMAX, window: { nx: GNX, nz: GNZ } };
