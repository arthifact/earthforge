import {layerLengths, withLayerLengths} from "./strata";
import { assignCapacityTransport } from './capacityTransport';
import { sliceCapacityShares } from './capacitySlices';
import { exactLengthScale } from './exactLength';
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
// varies along the section. Velocity combines current effective pressure with irreversible loading and burial
// memory (compaction is not undone by uplift or erosion, the
// basis of exhumation estimates from sonic logs: Japsen): porosity from the
// same curves, velocity from the soft-sand model (Dvorkin and Nur 1996: a
// Hertz-Mindlin grain pack under effective pressure, Gassmann for the brine)
// cementing into Raymer, Hunt and Gardner (1980) with burial; quartz, clay and
// calcite mineral moduli; optional undercompaction under an overpressure top;
// crystalline basement below, water above. Seeded: one seed, one section.

import { subsideColumn } from './subsidence';
import { append, cellLayers, columnScale, columnsFromRaster, layerUnits, compactColumn, depositedLayer, emptyLayer, packColumn, rasterize, sliceColumn, surface, type Column, type Layer } from "./strata";
import { remapNormal, type NormalTransfer } from "./normalTransport";
import { normalDepth, extendNormal } from "./normalGeometry";
import { traceFromDepth, projectTrace, transportTrace, type TraceSegment } from "./faultTrace";
import { thrustGeometry, sampleColumns, markersOf, mapMarkerColumn } from "./thrustGeometry";
import { assignTransport, PlacementError, type TransportParcel } from "./conservativeTransport";
import { addParcel, assessBudget, emptyFluxes, inventoryOf, outsideCell, summarizeBudget, type BudgetEntry, type BudgetSummary, type Fluxes, type Inventory, type Process } from "./sedimentBudget";
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
  /**
   * Probability of an exhumation episode at the end of the post-tectonic phase: the section is uplifted and eroded
   * over a few steps, then one step reburies it; beds keep their compaction and cementation memory. Drawn from its
   * own random stream, so 0 leaves every seed exactly as before.
   */
  exhumation: number;
  /** Mechanical compaction: beds thin as they are buried (off only for the kinematics tests). */
  compaction: boolean;
  /** Keep the state after every step (for the history replay). */
  record: boolean;
  /** For tests: no low sea level (so no erosion) and no folds; in compression also no tilt (uniform subsidence). */
  quiet?: boolean;
}
export const BASIN_DEFAULTS: BasinOptions = { seed: 1, h: 20, setting: "any", faults: [2, 4], thrusts: [1, 3], overpressure: 0.35, carbonate: 0.1, exhumation: 0, compaction: true, record: false };
/** An exhumation episode: uplift (m) spread over its steps after the post-tectonic phase's own steps, tilted across the section. */
export interface Exhumation { start: number; steps: number; amount: number; tilt: number }
/**
 * Whether and how a seed is exhumed. Its own random stream keeps every other draw of the section unchanged,
 * so a probability of 0 reproduces earlier seeds exactly; the start step is set by the caller's phase plan.
 */
export const exhumationOf = (o: Pick<BasinOptions, "seed" | "exhumation">): Omit<Exhumation, "start"> | null => {
  const p = o.exhumation ?? 0;
  if (!(p > 0)) return null;
  const r = mulberry32(o.seed * 48271 + 7), u = (a: number, b: number) => a + (b - a) * r();
  if (r() >= p) return null;
  return { steps: Math.floor(u(2, 5)), amount: u(300, 1500), tilt: u(0, 0.6) * (r() < 0.5 ? 1 : -1) };
};

/** The setting a seed gets under "any" (its own random stream, so the section's stream is the same as when chosen directly). */
export const settingOf = (o: Pick<BasinOptions, "seed" | "setting">): Setting => o.setting !== "any" ? o.setting : mulberry32(o.seed * 7919 + 101)() < 0.5 ? "extension" : "compression";

export type Phase = "pre-rift" | "syn-rift" | "post-rift" | "pre-thrust" | "syn-thrust" | "post-thrust";
const PHASES: Record<Setting, [Phase, Phase, Phase]> = { extension: ["pre-rift", "syn-rift", "post-rift"], compression: ["pre-thrust", "syn-thrust", "post-thrust"] };
/** A bed: its unit (= the step it was deposited in), phase and depositional sand fraction along the section f(x) = a + b tanh((x - c) / d), clamped to [0, 1]; or a carbonate. */
export interface Bed { unit: number; phase: Phase; a: number; b: number; c: number; d: number; carbonate: boolean }
/**
 * A fault: its depth per grid column (NaN where it is not defined), and the same as a polyline sorted by x for drawing
 * and measuring; dip at the top (a thrust: its ramp), detachment depth, active steps, and its displacement so far and
 * per step (heave for a normal fault, slip along the fault for a thrust). A normal fault is defined from its top column
 * (top end first for dir 1, last for dir -1) toward its hanging wall and carries the fraction of a cell to its next
 * slip. A thrust is defined across the grid: lower flat, ramp, then an upper flat or the sea floor; it dips toward the
 * hinterland (dir = -transport); bends are the columns of its lower and upper bends, and per dip domain (lower flat,
 * ramp, upper flat) it carries the rounding of the hanging wall's whole-column moves (m).
 */
export interface Fault {
  kind: "normal" | "thrust";
  dir: 1 | -1; depth: Float64Array; top: number; x: number[]; z: number[]; dip: number; detachment: number; start: number; end: number; heave: number; heaves: number[]; remainder: number;
  /** Physical branches of an inactive thrust after it is cut/carried. */
  trace?: TraceSegment[];
  thrust?: { transport: 1 | -1; bends: [number, number]; points?: V[]; emergent: boolean; upper: number; carry: number[] };
}
export interface StepLog { step: number; phase: Phase; text: string; subsidence: number; deposited: number; shift: number }
export interface RasterWindow { velocity: Float32Array; beds: Int32Array; sandFraction: Float32Array; nx: number; nz: number; floor: Float64Array }
export interface MaterialState {
  /** Authoritative continuous material; subcells are a conservative transport projection. */
  columns?: Column[]; subcells?: Map<number, Column>;
  /** Replay caches the 20 m viewing window without retaining all material objects. */
  view?: RasterWindow;
  grid: Int32Array;
  /** Raster grain-weighted sand fraction; constituent composition remains in columns/subcells. */
  sandFraction: Float64Array;
  /** Maximum geometric burial and maximum effective loading, in equivalent metres. */
  burial: Float32Array; effectiveBurial: Float32Array;
}
export interface Snapshot extends MaterialState { step: number; faults: { dir: 1 | -1; x: number[]; z: number[]; trace?: TraceSegment[] }[] }
/** Synchronous diagnostic view after a budgeted operation. Arrays and material
 * columns are borrowed: observers must not mutate them and must copy retained
 * values. Observers never draw random numbers or change the physical state. */
export interface SimulationObservation extends MaterialState {
  step: number; process: Process; fault: number | null;
  nx: number; nz: number; h: number; solid: Float64Array;
  beds: Bed[]; faults: Fault[]; overpressure: number | null;
}
export type SimulationObserver = (state: SimulationObservation) => void;
export interface PhysicalHistory {
  dt: number; phases: number[]; waterDepth: number; basinSlope: number; overpressure: number | null; basementVelocity: number;
  normalFaults: unknown[]; thrusts: unknown[]; beds: Bed[];
  /** The exhumation episode, if the seed has one. */
  exhumation: Exhumation | null;
  forcing: { step: number; waterDepth: number; fill: number; drape: number; subsidence: number[] }[];
}
export interface ThrustPlacementDiagnostics {
  parcels: number; displaced: number; maxOffsetCells: number; radius: 2 | 3;
  /** Capacity fallback is used only after the indivisible matching is infeasible. */
  fallback?: boolean;
  fallbackReason?: string | null;
  splitSources?: number;
  slicedConstituents?: number;
  /** Child physical centroid distance from the assigned cell center, in cells. */
  maxChildPhysicalToCellCenterCells?: number;
  /** Child physical centroid distance from its stored slice centroid, in cells. */
  maxChildStorageOffsetCells?: number;
}
export interface Basin extends MaterialState {
  options: BasinOptions; setting: Setting; nx: number; nz: number; h: number;
  /** Dominant sediment label per transport cell, WATER or BASEMENT; not a material inventory. */
  grid: Int32Array;
  /** Per cell: solid grains (m of the cell's height). */
  solid: Float64Array;
  beds: Bed[]; faults: Fault[]; log: StepLog[]; snapshots: Snapshot[];
  /** Physical forcing before raster rounding, for matching refinement studies. */
  historyPlan: PhysicalHistory;
  /** Full-domain grain-volume ledger; residuals are never repaired or reclassified as flux. */
  budget: { entries: BudgetEntry[]; summary: BudgetSummary; steps: { step: number; summary: BudgetSummary }[]; width: number; depth: number };
  /** Solid deposited per bed (sum over its material columns, m). */
  deposited: number[];
  /** The grid at the end of the first phase (before any faulting), and that phase's number of steps. */
  pre: Int32Array; preSteps: number;
  /** Duration of a step (Myr). */
  dt: number;
  basementVelocity: number;
  /** Overpressure top below the sea floor (m), or null. */
  overpressure: number | null;
  /** collapsed: water cells below rock closed after slips (overhangs at thrust fronts; rounding at scarps); trapped: water cells still found below the sea floor at the end; area: largest relative change of hanging-wall rock in one slip (both kinematics keep area), and that change for every slip. */
  checks: { collapsed: number; trapped: number; area: number; transport: (ThrustPlacementDiagnostics & { step: number; fault: number })[]; slips: { step: number; fault: number; kind: Fault["kind"]; error: number }[]; steps: number; seconds: number };
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
  for (let guard = 0; guard <= F.t.length; guard++) {
    if (left >= 0) { const e = end(j); if (u + left <= e) { u += left; break; } left -= Math.max(0, e - u); j++; u = start(j); }
    else { const st = start(j); if (u + left >= st) { u += left; break; } left += Math.max(0, u - st); j--; u = end(j); }
  }
  return [F.P[j][0] + F.t[j][0] * u + F.n[j][0] * delta, F.P[j][1] + F.t[j][1] * u + F.n[j][1] * delta];
}
/** Drawing paths preserve cut passive branches instead of bridging their gaps or
 * drawing a compatibility mean between overlapping branches. */
export function faultLines(f: { x: number[]; z: number[]; trace?: TraceSegment[] }) {
  return f.trace ? f.trace.map(([a, b]) => ({ x: [a[0], b[0]], z: [a[1], b[1]] })) : [{ x: f.x.slice(), z: f.z.slice() }];
}
/** Active thrust controls in physical coordinates, with a legacy sampled fallback. */
export function thrustPoints(b: { nx: number; h: number }, f: Fault): V[] {
  if (f.thrust?.points) return f.thrust.points.map(p => [...p] as V);
  const th = f.thrust!, X = (i: number) => -MARGIN + i * b.h, back = th.transport > 0 ? 0 : b.nx - 1, front = th.transport > 0 ? b.nx - 1 : 0;
  // A ramp that reaches the grid's edge has no upper flat inside it.
  return [back, th.bends[0], th.bends[1], front].filter((i, j, a) => j === 0 || i !== a[j - 1]).map((i) => [X(i), f.depth[i]] as V);
}

/** Depth of a polyline (points in transport order) at x: interpolated along its segments. */
function polylineDepth(P: V[], x: number) {
  for (let j = 0; j + 1 < P.length; j++) {
    const [a, c] = [P[j], P[j + 1]], lo = Math.min(a[0], c[0]), hi = Math.max(a[0], c[0]);
    if (x >= lo && x <= hi) return hi === lo ? a[1] : a[1] + (c[1] - a[1]) * (x - a[0]) / (c[0] - a[0]);
  }
  return Math.abs(x - P[0][0]) < Math.abs(x - P[P.length - 1][0]) ? P[0][1] : P[P.length - 1][1];
}

/** Prescribed pore-pressure scenario, shared by all sediment lithologies. Below its top,
 * effective stress grows at 25% of the hydrostatic-loading gradient. This is an explicit
 * scenario, not a permeability/fluid-flow solver or a calibrated pressure prediction. */
export const effectiveDepth = (d: number, overpressure: number | null) => {
  const depth = Math.max(0, d);
  return overpressure !== null && depth > overpressure ? overpressure + 0.25 * (depth - overpressure) : depth;
};
export interface RockHistory { maxBurial: number; maxEffectiveDepth: number; bulkPorosity?: number }
/** Irreversible memory; unloading changes present stress without resetting these maxima. */
export const advanceHistory = (history: RockHistory, depth: number, overpressure: number | null): RockHistory => ({
  maxBurial: Math.max(history.maxBurial, depth, 0),
  maxEffectiveDepth: Math.max(history.maxEffectiveDepth, effectiveDepth(depth, overpressure)),
});

/** Remap an ordered bed in solid-volume coordinates. Each target cell receives the
 * sand carried by its source grains; loading maxima survive every contributing parcel.
 * This avoids both coordinate-based facies changes and mixing an entire bed uniformly. */
export function remapCompactedMaterial(solid: ArrayLike<number>, fraction: ArrayLike<number>, burial: ArrayLike<number>,
  loading: ArrayLike<number>, target: ArrayLike<number>, lateralOffset?: ArrayLike<number>) {
  const offsetX = new Float64Array(target.length);
  const sandFraction = new Float64Array(target.length), maxBurial = new Float32Array(target.length), effectiveBurial = new Float32Array(target.length);
  let source = 0, remaining = solid[0] ?? 0;
  for (let j = 0; j < target.length; j++) {
    let need = target[j], sandVolume = 0, lateralMoment = 0;
    while (need > 1e-12 && source < solid.length) {
      if (remaining <= 1e-12) { remaining = solid[++source] ?? 0; continue; }
      const take = Math.min(need, remaining);
      sandVolume += take * fraction[source];
      lateralMoment += take * (lateralOffset?.[source] ?? 0);
      maxBurial[j] = Math.max(maxBurial[j], burial[source]);
      effectiveBurial[j] = Math.max(effectiveBurial[j], loading[source]);
      need -= take; remaining -= take;
    }
    if (need > 1e-8) throw new Error("Compaction remap requests more solid than its source contains");
    offsetX[j] = target[j] > 0 ? lateralMoment / target[j] : 0;
    sandFraction[j] = target[j] > 0 ? Math.min(1, Math.max(0, sandVolume / target[j])) : 0;
  }
  let unused = remaining;
  for (let k = source + 1; k < solid.length; k++) unused += solid[k];
  if (unused > 1e-8) throw new Error("Compaction remap discards source solid");
  return { sandFraction, burial: maxBurial, effectiveBurial, offsetX };
}
/** Porosity at an (effective) depth: Sclater and Christie's sand and shale curves mixed by sand fraction, or chalk. */
export const porosity = (f: number, de: number, carbonate: boolean) => {
  // Written out (same operations, same order) rather than through an inner closure allocated per call.
  const { shale, sand, chalk } = COMPACTION;
  return carbonate ? chalk.phi0 * Math.exp(-de / chalk.L) : f * (sand.phi0 * Math.exp(-de / sand.L)) + (1 - f) * (shale.phi0 * Math.exp(-de / shale.L));
};

/** Debugging only: called after every normal/thrust slip with the grids before and after and how often each cell was taken. */
export let debugSlip: ((info: { kind: "normal" | "thrust"; before: MaterialState; after: MaterialState; step: number; fault: number; nx: number; nz: number; h: number; grid: Int32Array; next: Int32Array; used: Int32Array; from: Int32Array; depth: Float64Array; F?: FlowLine; s: number; corr: V[]; normalTransfers?: NormalTransfer[]; thrustTransfers?: ThrustTransfer[] }) => void) | null = null;
export const setDebugSlip = (f: typeof debugSlip) => { debugSlip = f; };

/** Displacement summed along the piecewise straight trajectory, without subtracting
 * two large absolute positions. */
export function flowDisplacement(F: FlowLine, x: number, z: number, s: number): V {
  let j = domainOf(F, x, z);
  const q: V = [x - F.P[j][0], z - F.P[j][1]], delta = dot(q, F.n[j]), last = F.t.length - 1;
  let u = dot(q, F.t[j]), left = s, dx = 0, dz = 0;
  const start = (d: number) => d === 0 ? -Infinity : dot(F.b[d], F.t[d]) * delta / dot(F.b[d], F.n[d]);
  const end = (d: number) => d === last ? Infinity : dot([F.P[d + 1][0] - F.P[d][0], F.P[d + 1][1] - F.P[d][1]], F.t[d]) + dot(F.b[d + 1], F.t[d]) * delta / dot(F.b[d + 1], F.n[d]);
  for (let guard = 0; guard <= F.t.length; guard++) {
    if (left >= 0) {
      const e = end(j), distance = u + left <= e ? left : Math.max(0, e - u);
      dx += distance * F.t[j][0]; dz += distance * F.t[j][1]; left -= distance;
      if (!left) return [dx, dz];
      j++; u = start(j);
    } else {
      const st = start(j), distance = u + left >= st ? left : -Math.max(0, u - st);
      dx += distance * F.t[j][0]; dz += distance * F.t[j][1]; left -= distance;
      if (!left) return [dx, dz];
      j--; u = end(j);
    }
  }
  throw Error('Flow displacement crossed too many domains');
}

/** Exact mean displacement of the h-wide rectangular material representation.
 * The flow is affine for each initial/final dip-domain pair. Clip only for
 * integration, then average each piece's displacement by its original area.
 * Unit-square coordinates retain arbitrarily thin positive material intervals.
 * Cut polygons are temporary; this does not retain a general material mesh. */
export function flowAreaDisplacement(F: FlowLine, s: number, width: number) {
  if (!Number.isFinite(s) || !(width > 0) || !Number.isFinite(width)) throw Error('Invalid flow integration width');
  const count = F.t.length, A = [0], C = [0], B = [0];
  for (let j = 1; j < count; j++) {
    const oldBeta = dot(F.b[j], F.t[j-1]) / dot(F.b[j], F.n[j-1]);
    const newBeta = dot(F.b[j], F.t[j]) / dot(F.b[j], F.n[j]);
    A[j] = A[j-1] + dot([F.P[j][0]-F.P[j-1][0], F.P[j][1]-F.P[j-1][1]], F.t[j-1]);
    C[j] = C[j-1] + oldBeta - newBeta; B[j] = newBeta + C[j];
  }
  const clip = (poly: V[], value: (p: V) => number): V[] => {
    if (!poly.length) return [];
    const out: V[] = []; let a = poly.at(-1)!, fa = value(a);
    for (const b of poly) {
      const fb = value(b);
      if ((fa >= 0) !== (fb >= 0)) { const t = fa/(fa-fb); out.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]); }
      if (fb >= 0) out.push(b);
      a=b; fa=fb;
    }
    return out;
  };
  const measure = (poly: V[]) => {
    if (poly.length < 3) return {area:0,x:0,z:0};
    const o=poly[0]; let area2=0, mx=0, mz=0;
    for(let j=1;j+1<poly.length;j++) {
      const ax=poly[j][0]-o[0],az=poly[j][1]-o[1],bx=poly[j+1][0]-o[0],bz=poly[j+1][1]-o[1],cross=ax*bz-az*bx;
      area2+=cross;mx+=cross*(ax+bx);mz+=cross*(az+bz);
    }
    return {area:Math.abs(area2)/2,x:o[0]+(area2?mx/(3*area2):0),z:o[1]+(area2?mz/(3*area2):0)};
  };
  return (x: number, top: number, height: number): V => {
    if (!(height>0) || !Number.isFinite(height) || !Number.isFinite(x) || !Number.isFinite(top)) throw Error('Invalid flow integration interval');
    if (!Number.isFinite(top+height) || !Number.isFinite(x-width/2) || !Number.isFinite(x+width/2)) throw Error('Invalid flow integration extent');
    const centerZ=top+height/2;
    if (s===0) return [0,0];
    if (count===1) return [s*F.t[0][0],s*F.t[0][1]];
    // Within a fixed source/destination domain pair the map is affine.
    const initial: V[]=[[-.5,0],[.5,0],[.5,1],[-.5,1]];
    const sourceDomain=domainOf(F,x,centerZ),center=flowMove(F,x,centerZ,s),targetDomain=domainOf(F,...center);
    if(initial.every(([dx,dz])=>domainOf(F,x+dx*width,top+dz*height)===sourceDomain && domainOf(F,...flowMove(F,x+dx*width,top+dz*height,s))===targetDomain))return sourceDomain===targetDomain ? [s*F.t[sourceDomain][0],s*F.t[sourceDomain][1]] : flowDisplacement(F,x,centerZ,s);
    let remaining=initial, area=0, mx=0, mz=0;
    for(let j=0;j<count && remaining.length;j++) {
      const side=(p:V)=>(x-F.P[j+1][0])*F.m[j+1][0]+(top-F.P[j+1][1])*F.m[j+1][1]+p[0]*width*F.m[j+1][0]+p[1]*height*F.m[j+1][1];
      const start=j===count-1?remaining:clip(remaining,p=>-side(p));
      if(j<count-1)remaining=clip(remaining,side);
      if(!start.length)continue;
      const delta0=(x-F.P[j][0])*F.n[j][0]+(top-F.P[j][1])*F.n[j][1];
      const distance0=(x-F.P[j][0])*F.t[j][0]+(top-F.P[j][1])*F.t[j][1]+A[j]+C[j]*delta0+s;
      let rest=start;
      for(let k=0;k<count && rest.length;k++) {
        const crossed=(p:V)=>distance0-A[k+1]-B[k+1]*delta0+p[0]*width*(F.t[j][0]+(C[j]-B[k+1])*F.n[j][0])+p[1]*height*(F.t[j][1]+(C[j]-B[k+1])*F.n[j][1]);
        const part=k===count-1?rest:clip(rest,p=>-crossed(p));
        if(k<count-1)rest=clip(rest,crossed);
        const q=measure(part);if(!(q.area>0))continue;
        const px=x+q.x*width,pz=top+q.z*height,moved=j===k ? [s*F.t[j][0],s*F.t[j][1]] : flowDisplacement(F,px,pz,s);
        area+=q.area;mx+=q.area*moved[0];mz+=q.area*moved[1];
      }
    }
    if(!(area>0))throw Error('Empty flow integration area');
    return [mx/area,mz/area];
  };
}

/** Cropped display projections may report outside material. Full material
 * refreshes must never discard a sediment identity or infer an unrecorded flux. */
function fullDomainRasterize(columns: Column[], nz: number, h: number) {
  const result = rasterize(columns, nz, h);
  for (const [i, parts] of result.bottomOutside) if (parts.some(p => p.bed >= 0))
    throw Error(`Full-domain projection would discard sediment from column ${i}`);
  return result;
}

export interface ThrustTransfer {
  source: Layer;
  moved: Layer;
  sourceCell: number;
  destinationCell: number;
  incoming: boolean;
  /** Constituent top within the original and assigned transport cells. */
  sourceLocalTop: number;
  destinationLocalTop: number;
}
/** One conservative thrust increment, pure with respect to state, geometry and carry.
 * Split each column's fault-cut cell at the represented fault depth. Only its
 * hanging-wall portion moves; its footwall constituents remain in place.
 * Moving packets retain grains and histories in distinct destinations when feasible.
 * Only an infeasible matching invokes exact-capacity vertical slicing in the same
 * parent-target stencil; each child retains its own integrated physical flow moment.
 * offsetX/Z retain continuous transport positions after allocation. This remains
 * a bounded discrete remap, not a general polygon-overlap transport scheme.
 */
export function remapThrust(state: MaterialState & Pick<Basin, "solid" | "nx" | "nz" | "h" | "beds"> & { offsetX?: Float64Array; offsetZ?: Float64Array }, P: V[], s: number, carry: readonly number[], recordSources = false) {
  if (!(state.h > 0) || !Number.isFinite(state.h) || !Number.isFinite(s) || P.length < 2 || P.some(p => !p.every(Number.isFinite)))
    throw Error('Invalid thrust geometry or slip');
  const { nx, nz, h, beds } = state, X = (i: number) => -2000 + i * h, F = flowLine(P);
  const averageFlow = flowAreaDisplacement(F, s, h);
  const depth = Float64Array.from({ length: nx }, (_, i) => polylineDepth(P, X(i)));
  const capacity = Float64Array.from({ length: nx * nz }, (_, n) => Math.max(0, Math.min(h, depth[n % nx] - Math.floor(n / nx) * h)));
  const allowed = Uint8Array.from(capacity, x => Number(x > 1e-10));
  const nextCarry = [...carry], D = F.t.map((t, j) => { const ex = s * t[0], dx = s === 0 ? 0 : Math.round((ex - (carry[j] ?? 0)) / h); nextCarry[j] = (carry[j] ?? 0) + dx * h - ex; return dx; });
  const corr = F.t.map((t, j): V => [s * t[0] - D[j] * h, 0]), flux = emptyFluxes(), from = new Int32Array(recordSources ? nx * nz : 0).fill(-1), used = new Int32Array(recordSources ? nx * nz : 0);
  const numericalWater = new Map<number, [number, number][]>();
  const transfers: ThrustTransfer[] = [];
  const parcels: (TransportParcel & {
    parts: Column;
    offsetX: number;
    offsetZ: number;
    incoming?: boolean;
    displacements?: (V | null)[];
  })[] = [], HW = new Map<number, Column>(), FW = new Map<number, Column>();
  const rock = (c: Column) => c.some(p => p.bed !== -1);
  const height = (c: Column) => {
    const scale = columnScale([c]); let sum = 0n; for (const p of c) sum += layerUnits(p, scale);
    return scale.number(sum);
  };
  const localTops = (c: Column) => {
    const scale = columnScale([c]); let preceding = 0n;
    return c.map(p => { const top = scale.number(preceding); preceding += layerUnits(p, scale); return top; });
  };
  // Integrate placement error over occupied rock, including basement. A thin
  // fragment must not count as much as a full rock cell; water has no rock volume.
  // Normalizing by h retains the unit cost for full cells on every grid.
  const rockWeight = (c: Column) => height(c.filter(p => p.bed !== -1)) / h;
  const fluxParts = (to: Inventory, c: Column) => {
    for (const p of c) if (p.bed >= 0) addParcel(to, p.bed, p.solid, p.fraction, beds[p.bed].carbonate, h);
  };
  // A stationary footwall must not influence the moving packet's flow position.
  const offsets = (c: Column): V => {
    let v = 0, x = 0, z = 0;
    for (const p of c) if (p.bed !== -1) {
      v += p.height; x += p.height * p.offsetX; z += p.height * p.offsetZ;
    }
    return v ? [x / v, z / v] : [0, 0];
  };
  for (let n = 0; n < nx * nz; n++)
    if (allowed[n]) {
      const cell = cellLayers(state, n, h);
      HW.set(n, sliceColumn(cell, 0, capacity[n]));
      FW.set(n, sliceColumn(cell, capacity[n], h));
    }
  let before = 0, inflow = 0, lost = 0;
  if (s === 0) {
    return { ...state, grid: state.grid.slice(), solid: state.solid.slice(), sandFraction: state.sandFraction.slice(), burial: state.burial.slice(), effectiveBurial: state.effectiveBurial.slice(), offsetX: state.offsetX?.slice() ?? new Float64Array(nx * nz), offsetZ: state.offsetZ?.slice() ?? new Float64Array(nx * nz), subcells: new Map([...state.subcells ?? []].map(([n, c]) => [n, c.map(p => ({ ...p }))])), depth, carry: [...carry], F, corr, from, used, flux, transfers, numericalWater, numericalVacancies: new Uint8Array(nx * nz), rock: { before: 0, after: 0, inflow: 0, outflow: 0 }, placement: { parcels: 0, displaced: 0, maxOffsetCells: 0, radius: 2 as const } };
  }
  for (const [n, parts] of HW) {
    if (!rock(parts))
      continue;
    before++;
    const [ox, oz] = offsets(parts), i = n % nx, k = Math.floor(n / nx);
    const sourceTops = localTops(parts); let volume = 0, meanX = 0, meanZ = 0;
    // Integrate each constituent at its own physical position. The mean controls
    // only packet allocation; each constituent keeps its individual flow moment.
    const displacements = parts.map((p, part) => {
      const top = sourceTops[part];
      if (p.bed === -1) return null;
      const displacement = averageFlow(X(i) + p.offsetX, k * h + top + p.offsetZ, p.height);
      volume += p.height;
      meanX += p.height * (p.offsetX + displacement[0]);
      meanZ += p.height * (p.offsetZ + displacement[1]);
      return displacement;
    });
    const ti = i+meanX/volume/h, tk = k+meanZ/volume/h, ia = Math.round(ti), ka = Math.round(tk), side = outsideCell(ia, ka, nx, nz);
    if (side) {
      fluxParts(flux.outflow[side], parts);
      lost++;
    }
    else
      parcels.push({ source: n, i: ia, k: ka, targetI: ti, targetK: tk, height: height(parts), weight: rockWeight(parts), parts, displacements, offsetX: ox, offsetZ: oz });
  }
  const topRow = (i: number) => Math.ceil(depth[i] / h) - 1;
  const rowOf = (j: number, i: number) => { const [a, b] = [P[j], P[j + 1]]; return Math.ceil((a[1] + (b[1] - a[1]) * (X(i) - a[0]) / ((b[0] - a[0]) || 1)) / h) - 1; };
  const expected = new Uint8Array(nx * nz);
  for (const [n] of HW) {
    const i = n % nx, k = Math.floor(n / nx), x = X(i), z = k * h, j = domainOf(F, x, z), [xb, zb] = flowMove(F, x, z, -s), within = domainOf(F, xb, zb) === j;
    const rawI = within ? i - D[j] : Math.round((xb + 2000) / h), is = Math.min(nx - 1, Math.max(0, rawI));
    const ks = Math.min(within ? k + rowOf(j, is) - rowOf(j, i) : Math.round(zb / h), topRow(is));
    if (ks < 0)
      continue;
    const side = outsideCell(rawI, ks, nx, nz), src = Math.min(nz - 1, ks) * nx + is, parts = HW.get(src) ?? [];
    if (!rock(parts))
      continue;
    expected[n] = 1;
    if (!side)
      continue;
    fluxParts(flux.inflow[side], parts);
    inflow++;
    const dx = -(nextCarry[j] ?? 0) / h, [ox, oz] = offsets(parts);
    parcels.push({ source: src, i, k, targetI: i + dx, targetK: k + dx * F.t[j][1] / F.t[j][0], height: height(parts), weight: rockWeight(parts), parts, offsetX: ox, offsetZ: oz, incoming: true });
  }
  let assignment: ReturnType<typeof assignTransport>;
  const assigned = new Map<number, Column>();
  let splitFallback: ReturnType<typeof assignCapacityTransport> | undefined;
  let fallbackReason: string | null = null, maxChildCentroidOffsetCells = 0, maxChildStorageOffsetCells = 0, slicedConstituents = 0;
  try { assignment = assignTransport(nx, nz, allowed, parcels, capacity); }
  catch (error) {
    if (!(error instanceof PlacementError)) throw error;
    fallbackReason = error.message;
    splitFallback = assignCapacityTransport(nx, nz, allowed, parcels.map(p => ({ ...p, materialHeights: p.parts.flatMap(q => [...layerLengths(q)]) })), capacity);
    assignment = { destination: new Int32Array(0), radius: splitFallback.radius,
      maxOffsetCells: splitFallback.maxOffsetCells,
      displaced: splitFallback.shares.filter(q => q.destination !== parcels[q.parcel].k * nx + parcels[q.parcel].i).length };
  }
  if (!splitFallback) {
  for (let p = 0; p < parcels.length; p++) {
    const src = parcels[p], n = assignment.destination[p], dx = ((src.targetI ?? src.i) - n % nx) * h - src.offsetX, dz = ((src.targetK ?? src.k) - Math.floor(n / nx)) * h - src.offsetZ;
    const sourceTops = localTops(src.parts);
    assigned.set(n, src.parts.map((p, part) => {
      const localTop = sourceTops[part];
      const displacement = src.displacements?.[part];
      // Incoming ghost packets retain the prescribed continuation rule. Natural
      // water within retained packets receives the packet's common translation.
      const moved = { ...p,
        offsetX: displacement ? p.offsetX + displacement[0] + (src.source % nx - n % nx) * h : p.offsetX + dx,
        offsetZ: displacement ? p.offsetZ + displacement[1] + (Math.floor(src.source / nx) - Math.floor(n / nx)) * h : p.offsetZ + dz,
      };
      if (recordSources && p.bed >= 0) transfers.push({ source: p, moved, sourceCell: src.source, destinationCell: n, incoming: !!src.incoming, sourceLocalTop: localTop, destinationLocalTop: localTop });
      return moved;
    }));
    if (recordSources) {
      from[n] = src.source;
      used[src.source]++;
    }
  }
  } else {
    const slices = sliceCapacityShares(parcels, splitFallback.shares, nx);
    slicedConstituents = slices.length;
    const grouped = new Map<number, { slice: typeof slices[number]; moved: Layer; center: number }[]>();
    for (const slice of slices) {
      const src = parcels[slice.parcel], p = slice.part, n = slice.destination;
      // A retained child is an actual vertical rectangle. Reintegrate its flow
      // over its own height at its original local position, not the parent mean.
      const displacement = !src.incoming && p.bed !== WATER
        ? averageFlow(X(src.source % nx) + p.offsetX, Math.floor(src.source / nx) * h + slice.sourceLocalTop + p.offsetZ, p.height)
        : null;
      const dx = ((src.targetI ?? src.i) - n % nx) * h - src.offsetX;
      const dz = ((src.targetK ?? src.k) - Math.floor(n / nx)) * h - src.offsetZ;
      const moved = { ...p,
        offsetX: displacement ? p.offsetX + displacement[0] + (src.source % nx - n % nx) * h : p.offsetX + dx,
        offsetZ: (displacement ? p.offsetZ + displacement[1] + (Math.floor(src.source / nx) - Math.floor(n / nx)) * h : p.offsetZ + dz) + slice.sourceLocalTop,
      };
      let group = grouped.get(n); if (!group) grouped.set(n, group = []);
      group.push({ slice, moved, center: moved.offsetZ + p.height / 2 });
    }
    for (const [n, group] of grouped) {
      // Only fallback destinations may contain multiple pieces. Their ordering
      // follows transported physical centers; footwall remains outside this set.
      group.sort((a, b) => a.center - b.center || a.slice.parcel - b.slice.parcel || a.slice.sourceLocalTop - b.slice.sourceLocalTop);
      const parts: Column = [], destinationTops = localTops(group.map(q => q.moved));
      for (const [index, { slice, moved, center }] of group.entries()) {
        const local = destinationTops[index];
        const src = parcels[slice.parcel], p = { ...moved, offsetZ: moved.offsetZ - local };
        if (recordSources && p.bed >= 0) transfers.push({ source: slice.part, moved: p,
          sourceCell: src.source, destinationCell: n, incoming: !!src.incoming,
          sourceLocalTop: slice.sourceLocalTop, destinationLocalTop: local });
        maxChildCentroidOffsetCells = Math.max(maxChildCentroidOffsetCells, Math.hypot(p.offsetX / h, (center - h / 2) / h));
        maxChildStorageOffsetCells = Math.max(maxChildStorageOffsetCells, Math.hypot(p.offsetX / h, p.offsetZ / h));
        parts.push(p);
        if (recordSources) { from[n] = src.source; used[src.source]++; }
      }
      assigned.set(n, parts);
    }
  }
  const subcells = new Map(state.subcells);
  for (const [n] of HW) {
    const moved = assigned.get(n), out: Column = [], usedHeight = moved ? height(moved) : 0;
    if (moved)
      for (const p of moved)
        append(out, p);
    const scale = columnScale([moved ?? []], [capacity[n]]);
    let usedUnits = 0n; for (const p of moved ?? []) usedUnits += layerUnits(p, scale);
    const freeUnits = scale.units(capacity[n]) - usedUnits;
    if (freeUnits < 0n) throw Error('Thrust reconstruction exceeds exact capacity');
    const gap = scale.number(freeUnits);
    if (freeUnits > 0n) append(out, withLayerLengths(emptyLayer(-1, 0), scale.chunks(freeUnits)));
    // Record only newly introduced allocation water, not natural water already
    // travelling inside a cut source parcel. Collapse must intersect this range.
    if (gap > 1e-10 && (moved || expected[n]))
      numericalWater.set(n, [[usedHeight, capacity[n]]]);
    for (const p of FW.get(n)!)
      append(out, p);
    subcells.set(n, out);
  }
  const columns = columnsFromRaster({ ...state, subcells }, nx, nz, h), out = fullDomainRasterize(columns, nz, h);
  return { ...out, depth, carry: nextCarry, F, corr, from, used, flux, transfers, numericalWater, numericalVacancies: Uint8Array.from({ length: nx * nz }, (_, n) => Number(numericalWater.has(n))), rock: { before, after: parcels.length, inflow, outflow: lost }, placement: { parcels: parcels.length, displaced: assignment.displaced, maxOffsetCells: assignment.maxOffsetCells, radius: assignment.radius, fallback: !!splitFallback, fallbackReason, splitSources: splitFallback?.splitSources ?? 0, slicedConstituents, maxChildPhysicalToCellCenterCells: maxChildCentroidOffsetCells, maxChildStorageOffsetCells } };
}

export function simulate(options: BasinOptions, observe?: SimulationObserver): Basin {
  const t0 = performance.now(), o = options, rng = mulberry32(o.seed * 2654435761 + 12345), setting = settingOf(o), names = PHASES[setting];
  const u = (a: number, b: number) => a + (b - a) * rng(), int = (a: number, b: number) => Math.floor(u(a, b + 1));
  const h = o.h, nx = Math.round((WIDTH + 2 * MARGIN) / h) + 1, nz = Math.round(ZMAX / h) + 1, X = (i: number) => -MARGIN + i * h;
  const col = (x: number) => Math.min(nx - 1, Math.max(0, Math.round((x + MARGIN) / h)));
  let grid = new Int32Array(nx * nz), solid = new Float64Array(nx * nz), burial = new Float32Array(nx * nz);
  let sandFraction = new Float64Array(nx * nz), effectiveBurial = new Float32Array(nx * nz);
  // Subcell positions belong to the advected material, not to a grid location.
  // Subsidence carries them; compaction remaps the lateral grain moment and
  // reconstructs vertical positions. They never contribute to grain inventory.
  let offsetX = new Float64Array(nx * nz), offsetZ = new Float64Array(nx * nz);
  let numericalWater = new Map<number, [number, number][]>();
  const wd0 = u(30, 150), dt = u(0.5, 2);
  let columns: Column[] = Array.from({ length: nx }, () => [emptyLayer(WATER, wd0), emptyLayer(BASEMENT, nz * h - wd0)]);
  let subcells = new Map<number, Column>();
  const refresh = () => { ({ grid, solid, burial, sandFraction, effectiveBurial, offsetX, offsetZ, subcells } = fullDomainRasterize(columns, nz, h)); };
  const rebuild = () => { columns = columnsFromRaster({ grid, solid, burial, sandFraction, effectiveBurial, offsetX, offsetZ, subcells }, nx, nz, h); };
  refresh();
  const beds: Bed[] = [], deposited: number[] = [], faults: Fault[] = [], log: StepLog[] = [], snapshots: Snapshot[] = [];
  let areaError = 0, pre = grid.slice(), current = 0;
  const slips: Basin["checks"]["slips"] = [];
  const transport: Basin["checks"]["transport"] = [];
  const record = (f: Fault, error: number) => { areaError = Math.max(areaError, error); slips.push({ step: current, fault: faults.indexOf(f), kind: f.kind, error }); };

  const state = () => ({ grid, solid, sandFraction, beds, h, columns, subcells });
  const ledger: BudgetEntry[] = [];
  let previousInventory = inventoryOf(state());
  const initialInventory = previousInventory;
  const materialFlux = (to: Inventory, parts: Column) => { for (const p of parts) if (p.bed >= 0) addParcel(to, p.bed, p.solid, p.fraction, beds[p.bed].carbonate, h); };
  const account = (process: Process, flux: Fluxes = emptyFluxes(), fault: number | null = null) => {
    const after = inventoryOf(state());
    ledger.push({ step: current, process, fault, before: previousInventory, after, flux, ...assessBudget(previousInventory, after, flux) });
    previousInventory = after;
    if (observe) { refresh(); observe({ step: current, process, fault, nx, nz, h, grid, solid, sandFraction, burial, effectiveBurial, beds, faults, overpressure, columns, subcells }); }
  };

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
  // An exhumation episode comes late: its uplift steps follow the post-tectonic phase's own steps, and one step of
  // renewed subsidence and deposition then reburies the unconformity, so the section ends with net exhumation.
  const drawn = exhumationOf(o), episode: Exhumation | null = drawn ? { start: nPre + nSyn + nPost, ...drawn } : null;
  if (episode) nPost += episode.steps + 1;
  const total = nPre + nSyn + nPost;
  const basinSlope = u(0, 150), basementVelocity = u(4800, 5500), overpressure = rng() < o.overpressure ? u(1500, 2500) : null;
  const physics = { porosity, effectiveDepth };
  const historyPlan: PhysicalHistory = { dt, phases: [nPre, nSyn, nPost], waterDepth: wd0, basinSlope, overpressure, basementVelocity,
    normalFaults: plan, thrusts: thrustPlan, beds, exhumation: episode, forcing: [] };

  /** Compatibility column projection for measurements; drawing uses separate branches when present. */
  const sync = (f: Fault) => {
    if (f.trace) f.depth = projectTrace(f.trace, nx, h);
    const xsList: number[] = [], zsList: number[] = [];
    for (let i = 0; i < nx; i++) if (Number.isFinite(f.depth[i])) { xsList.push(X(i)); zsList.push(f.depth[i]); }
    f.x = xsList; f.z = zsList;
  };
  /** Exact vertical displacement and partial open-face clipping of columns. */
  const subside = (s: (x: number) => number) => {
    const flux = emptyFluxes(), shifts = Float64Array.from({ length: nx }, (_, i) => s(X(i)));
    for (let i = 0; i < nx; i++) {
      const moved = subsideColumn(columns[i], X(i), nz * h, s, shifts[i]);
      // Rock lifted above sea level is eroded (subaerially); only sinking columns have a true top-face outflow.
      materialFlux(shifts[i] < 0 ? flux.eroded : flux.outflow.top, moved.outflowTop);
      materialFlux(flux.outflow.bottom, moved.outflowBottom);
      materialFlux(flux.inflow.bottom, moved.inflowBottom);
      columns[i] = moved.column;
    }
    for (const f of faults) {
      for (let i = 0; i < nx; i++) if (Number.isFinite(f.depth[i])) f.depth[i] += shifts[i];
      for (const p of [...(f.thrust?.points ?? []), ...(f.trace?.flat() ?? [])]) p[1] += s(p[0]);
      sync(f);
    }
    account("subsidence", flux); return shifts[0] / h;
  };
  /**
   * Passive thrusts retain physical branches across cuts and flow bends. The legacy
   * normal-fault path remains column based, with duplicate depths averaged and gaps
   * interpolated; its hanging-wall side continues flat to the domain edge.
   */
  const carry = (active: Fault, move: (x: number, z: number) => V | null, thrustFlow?: { F: FlowLine; s: number }) => {
    for (const g of faults) {
      if (g === active) continue;
      if (thrustFlow && g.kind === "thrust") {
        const { F, s } = thrustFlow;
        const advect = (x: number, z: number) => flowMove(F, x, z, s);
        g.trace = transportTrace(g.trace ?? traceFromDepth(g.depth, h), F.P.map(p => p[0]), x => polylineDepth(F.P, x),
          advect, (x, z) => `${domainOf(F, x, z)}:${domainOf(F, ...advect(x, z))}`);
        // These branches are passive. Four original flow controls cannot describe
        // a fault cut by a younger thrust, and must never drive a later remap.
        delete g.thrust!.points;
        sync(g); continue;
      }
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
  /** Normal-fault vertical shear preserves continuous interfaces and grains.
   * Only horizontal heave is rounded to columns, with the fraction carried. */
  const slip = (f: Fault, asked: number) => {
    const carried = f.remainder + asked / h, cells = Math.round(carried), heave = cells * h;
    f.remainder = carried - cells;
    if (debugSlip) refresh();
    const before = { grid, sandFraction, burial, effectiveBurial };
    const moved = remapNormal(columns, f.depth, cells, f.dir, h, nz * h, beds, !!debugSlip);
    columns = moved.columns; record(f, moved.areaError);
    if (debugSlip) {
      refresh();
      debugSlip({ kind: "normal", before, after: { grid, sandFraction, burial, effectiveBurial },
        step: current, fault: faults.indexOf(f), nx, nz, h, grid: before.grid, next: grid,
        used: new Int32Array(0), from: new Int32Array(0), depth: f.depth.slice(), s: heave, corr: [], normalTransfers: moved.transfers });
    }
    carry(f, (x, d) => {
      const i = col(x), c = i + f.dir * cells, zn = c >= 0 && c < nx ? f.depth[c] : NaN;
      return [X(c), d + (Number.isFinite(zn) ? zn - f.depth[i] : 0)];
    });
    f.heave += heave; f.heaves.push(heave); sync(f);
    account("normal-slip", moved.flux, faults.indexOf(f));
  };
  /**
   * One slip increment on a thrust: its hanging wall (above the fault) moves a distance s along its flow lines
   * (fault-parallel flow); rock moved past the grid's top is lost, rock enters at the hinterland edge as the edge
   * column continued. Continuous parcel positions survive nearest-cell allocation;
   * every retained parcel occupies one distinct hanging-wall cell. Boundary continuation
   * retains its fractional phase. Footwall cells are immutable during this operation.
   */
  const thrustSlip = (f: Fault, s: number) => {
    if (f.trace) throw Error("Reactivation of a cut passive thrust requires an explicit new flow geometry");
    refresh();
    const moved = remapThrust({ grid, solid, burial, sandFraction, effectiveBurial, offsetX, offsetZ, subcells, nx, nz, h, beds }, thrustPoints({ nx, h }, f), s, f.thrust!.carry, !!debugSlip);
    const { F, corr, rock } = moved;
    if (rock.before > 0) record(f, Math.abs(rock.after - (rock.before + rock.inflow - rock.outflow)) / rock.before);
    debugSlip?.({ kind: "thrust", before: { grid, sandFraction, burial, effectiveBurial }, after: moved, step: current, fault: faults.indexOf(f), nx, nz, h, grid, next: moved.grid, used: moved.used, from: moved.from, depth: moved.depth.slice(), F, s, corr, thrustTransfers: moved.transfers });
    grid = moved.grid; solid = moved.solid; burial = moved.burial; sandFraction = moved.sandFraction; effectiveBurial = moved.effectiveBurial; offsetX = moved.offsetX; offsetZ = moved.offsetZ; numericalWater = moved.numericalWater; subcells = moved.subcells; rebuild();
    f.depth = moved.depth; f.thrust!.carry = moved.carry;
    transport.push({ step: current, fault: faults.indexOf(f), ...moved.placement });
    carry(f, (x, z) => { const [xa, za] = flowMove(F, x, z, s), j = domainOf(F, xa, za); return [xa - corr[j][0], za - corr[j][1]]; }, { F, s });
    f.heave += s; f.heaves.push(s); sync(f);
    account("thrust-slip", moved.flux, faults.indexOf(f));
  };
  /** A normal fault's trace from its top column (at sea level) down to its detachment (listric, exponential), one depth per column. */
  const createFault = (p: NormalPlan): Fault => {
    const { top, depth } = normalDepth(nx, h, p.x, p.dir, p.dip, p.detachment);
    const f: Fault = { kind: "normal", dir: p.dir, x: [], z: [], depth, top, dip: p.dip, detachment: p.detachment, start: p.start, end: p.end, heave: 0, heaves: [], remainder: 0 };
    sync(f); return f;
  };
  /**
   * A thrust: a lower flat at a fraction of the sediment thickness above the basement (at the lower bend), a ramp at its
   * dip, then an upper flat at a fraction of the way up from the detachment to the sea floor, or (emergent) a straight
   * flat along the sea floor ahead: the chord from where the ramp reaches the sea floor to the floor at the grid's
   * edge, lowered until no part of the floor lies below it (the sheet slides on it and scrapes the top sediments off
   * the bumps, leaving no water under the sheet).
   */
  const createThrust = (p: ThrustPlan): Fault => {
    const x1 = Math.max(X(1), Math.min(X(nx - 2), p.x1));
    const floorAt = (x: number) => sampleColumns(x, h, nx, i => surface(columns[i]));
    const floor = floorAt(x1), basement = sampleColumns(x1, h, nx, i => {
      let z = 0; for (const part of columns[i]) { if (part.bed === BASEMENT) break; z += part.height; } return z;
    });
    const zd = Math.min(ZMAX - 200, floor + p.zdFrac * (basement - floor)), zu = floor + p.zuFrac * (zd - floor);
    const points = thrustGeometry(x1, p.transport, p.dip, zd, zu, Array.from({ length: nx }, (_, i) => X(i)), floorAt, p.emergent);
    const depth = Float64Array.from({ length: nx }, (_, i) => polylineDepth(points, X(i)));
    const i1 = col(x1), i2 = col(points[2][0]);
    const f: Fault = { kind: "thrust", dir: (-p.transport) as 1 | -1, x: [], z: [], depth, top: i2, dip: p.dip, detachment: zd, start: p.start, end: p.end, heave: 0, heaves: [], remainder: 0,
      thrust: { transport: p.transport, bends: [i1, i2], points, emergent: p.emergent, upper: points[2][1], carry: [0, 0, 0] } };
    sync(f); return f;
  };
  /** A growing normal fault reaches up to sea level again along its top dip, column by column (it cuts the newest sediment). */
  const extendUp = (f: Fault) => {
    f.top = extendNormal(f.depth, f.top, f.dir, h, f.dip);
    sync(f);
  };
  /** Continuous pore-volume compaction, with material interfaces below h. */
  const thrustMarkers = () => faults.flatMap(f => markersOf([...(f.thrust?.points ?? []), ...(f.trace?.flat() ?? [])]));
  const compact = () => {
    const markers = thrustMarkers();
    for (let i = 0; i < nx; i++) {
      const result = compactColumn(columns[i], beds, overpressure, physics);
      columns[i] = result.column;
      mapMarkerColumn(markers, i, h, nx, result.mapDepth);
      for (const f of faults) if (Number.isFinite(f.depth[i])) f.depth[i] = result.mapDepth(f.depth[i]);
    }
    for (const m of markers) m.point[1] = m.nextDepth;
    for (const f of faults) sync(f);
  };
  let collapsed = 0;
  const collapse = () => {
    const markers = thrustMarkers();
    for (let i = 0; i < nx; i++) {
      const result = packColumn(columns[i], (lo, hi) => {
        let amount = 0;
        for (let k = Math.max(0, Math.floor(lo / h)); k < nz && k * h < hi; k++) for (const [a, b] of numericalWater.get(k * nx + i) ?? [])
          amount += Math.max(0, Math.min(hi, k * h + b) - Math.max(lo, k * h + a));
        return amount;
      });
      columns[i] = result.column; collapsed += result.gaps / h;
      mapMarkerColumn(markers, i, h, nx, result.mapPhysicalDepth);
      for (const f of faults) if (Number.isFinite(f.depth[i])) f.depth[i] = result.mapPhysicalDepth(f.depth[i]);
    }
    for (const m of markers) m.point[1] = m.nextDepth;
    numericalWater.clear(); for (const f of faults) sync(f);
  };
  const bury = () => {
    for (const column of columns) {
      let depth = -surface(column);
      for (const p of column) {
        const d = Math.max(0, depth + p.height / 2);
        if (p.bed >= 0) { p.burial = Math.max(p.burial, d); p.loading = Math.max(p.loading, effectiveDepth(d, overpressure)); }
        depth += p.height;
      }
    }
  };

  for (let step = 0; step < total; step++) {
    const stage = step < nPre ? 0 : step < nPre + nSyn ? 1 : 2, phase = names[stage], parts: string[] = [];
    current = step;
    const k0 = step - (stage === 0 ? 0 : stage === 1 ? nPre : nPre + nSyn);
    // 1. Subsidence; or, during an exhumation episode, uplift: the whole section rises (tilted), rock lifted above
    // wave base is eroded below, and the post-tectonic subsidence then continues where it left off.
    const uplift = episode && step >= episode.start && step < episode.start + episode.steps ? episode : null;
    const k = episode && step >= episode.start + episode.steps ? k0 - episode.steps : k0;
    const s = uplift ? (x: number) => -uplift.amount / uplift.steps * (1 + uplift.tilt * xn(x)) : subsidence(stage, k), shift = subside(s);
    const meanSubsidence = (s(0) + s(WIDTH / 2) + s(WIDTH)) / 3;
    parts.push(uplift ? `uplifted ${(-s(0)).toFixed(0)}-${(-s(WIDTH)).toFixed(0)} m (exhumation step ${k0 + 1} of ${uplift.steps})` : `subsided ${s(0).toFixed(0)}-${s(WIDTH).toFixed(0)} m`);
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
    collapse(); account("collapse");
    // 3. Erosion above wave base; 4. deposition down to the base level.
    // Uplift exposes the section: an exhumation step is always a lowstand. The draw is kept so the stream is unchanged.
    const lowDraw = rng() < 0.2, lowstand = (lowDraw || uplift !== null) && !o.quiet, wd = lowstand ? u(0, 40) : u(30, 300), waveBase = o.quiet ? 0 : wd - 30;
    let eroded = 0;
    const erosionFlux = emptyFluxes();
    if (waveBase > 0) for (let i = 0; i < nx; i++) {
      const removed = sliceColumn(columns[i], 0, waveBase);
      materialFlux(erosionFlux.eroded, removed); eroded += removed.reduce((n, p) => n + (p.bed === WATER ? 0 : p.height / h), 0);
      columns[i] = [emptyLayer(WATER, waveBase), ...sliceColumn(columns[i], waveBase, nz * h)];
    }
    account("erosion", erosionFlux);
    const unit = step, nBeds = int(2, 6), fill = stage === 0 ? 1 : u(0.75, 1), drape = u(5, 20), first = beds.length;
    const carb = rng() < o.carbonate * (stage === 0 ? 1.5 : 0.6), a0 = u(0.15, 0.6);
    for (let b = 0; b < nBeds; b++) {
      const alt = (b % 2 ? 1 : -1) * u(0.05, stage === 1 ? 0.3 : 0.15);
      if (setting === "extension" && stage === 2) beds.push({ unit, phase, a: 0.45 + alt, b: -0.35, c: shoreline(k), d: u(800, 2000), carbonate: carb && b === 0 });
      else beds.push({ unit, phase, a: a0 + alt, b: stage === 1 ? u(-0.3, 0.3) : stage === 2 ? u(-0.2, 0.2) : 0, c: u(0, WIDTH), d: u(1500, 4000), carbonate: carb });
      deposited.push(0);
    }
    const depositionFlux = emptyFluxes();
    historyPlan.forcing.push({ step, waterDepth: wd, fill, drape, subsidence: Array.from({ length: 34 }, (_, j) => s(-MARGIN + j * 400)) });
    let thickest = 0;
    for (let i = 0; i < nx; i++) {
      const zTop = surface(columns[i]), zBase = wd + basinSlope * (X(i) / WIDTH);
      const thick = Math.max(0, zTop - zBase) * fill + drape, zNew = zTop - thick;
      if (X(i) >= 0 && X(i) <= WIDTH) thickest = Math.max(thickest, thick);
      // The storage forcing remains Number-valued. Exact represented support
      // supplies shared bed boundaries and the complement containing old rock.
      const waterHeights: number[] = [];
      for (const p of columns[i]) { if (p.bed !== WATER) break; waterHeights.push(...layerLengths(p)); }
      const boundaries = Array.from({ length: nBeds + 1 }, (_, j) => Math.max(0, zNew + j * thick / nBeds));
      const span = exactLengthScale([...waterHeights, ...boundaries]);
      const oldTop = waterHeights.reduce((n, t) => n + span.units(t), 0n);
      const requestedTop = span.units(Math.max(0, zNew)), newTop = requestedTop < oldTop ? requestedTop : oldTop;
      const cuts = boundaries.map(z => { const u = span.units(z); return u < newTop ? newTop : u > oldTop ? oldTop : u; });
      cuts[0] = newTop; cuts[nBeds] = oldTop;
      const next: Column = [];
      if (newTop > 0n) append(next, withLayerLengths(emptyLayer(WATER, 0), span.chunks(newTop)));
      for (let j = 0; j < nBeds; j++) {
        const id = first + j, lo = cuts[j], hi = cuts[j + 1];
        if (hi <= lo) continue;
        const fraction = beds[id].carbonate ? 0 : sand(beds[id], X(i));
        const parts = depositedLayer(id, span.chunks(hi - lo), fraction, beds[id].carbonate, span.number(lo - newTop), overpressure, physics);
        for (const p of parts) { append(next, p); deposited[id] += p.solid; }
        materialFlux(depositionFlux.deposited, parts);
      }
      for (const p of sliceColumn(columns[i], waterHeights, nz * h)) append(next, p);
      columns[i] = next;
    }
    account("deposition", depositionFlux);
    // 5. Compaction under the new load.
    if (o.compaction) { compact(); account("compaction"); }
    bury(); account("burial-memory");
    parts.push(`${lowstand ? "low sea level, " : ""}${eroded ? `${(eroded * h * h / 1e6).toFixed(2)} km² eroded, ` : ""}up to ${thickest.toFixed(0)} m deposited (unit ${unit + 1}, ${nBeds} beds${carb ? ", carbonate" : ""})`);
    log.push({ step, phase, text: parts.join("; "), subsidence: meanSubsidence, deposited: thickest, shift });
    if (step === nPre - 1 || o.record) refresh();
    if (step === nPre - 1) pre = grid.slice();
    if (o.record) snapshots.push({ view: windowOf({ nx, nz, h, columns, beds, overpressure, basementVelocity } as Basin), step, grid: grid.slice(), burial: burial.slice(), sandFraction: sandFraction.slice(), effectiveBurial: effectiveBurial.slice(), faults: faults.map((f) => ({ dir: f.dir, x: f.x.slice(), z: f.z.slice(), ...(f.trace ? { trace: f.trace.map(([a, b]): TraceSegment => [[...a], [...b]]) } : {}) })) });
  }
  // Never silently fill a lost layer: count any remaining internal water.
  let trapped = 0;
  for (const column of columns) { let seen = false; for (const p of column) { if (p.bed !== WATER) seen = true; else if (seen && p.height > 1e-7) trapped++; } }
  const repairFlux = emptyFluxes();
  refresh();
  account("repair", repairFlux);
  const budget = { entries: ledger, summary: summarizeBudget(ledger, initialInventory, previousInventory), width: nx * h, depth: nz * h,
    steps: Array.from({ length: total }, (_, step) => { const entries = ledger.filter(e => e.step === step); return { step, summary: summarizeBudget(entries, entries[0].before, entries[entries.length - 1].after) }; }) };
  return { columns, subcells, budget, historyPlan, options: o, setting, nx, nz, h, grid, solid, burial, sandFraction, effectiveBurial, beds, faults, log, snapshots, deposited, pre, preSteps: nPre, dt, basementVelocity, overpressure, checks: { collapsed, trapped, area: areaError, transport, slips, steps: total, seconds: (performance.now() - t0) / 1000 } };
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
 * Velocity at present depth, with independent irreversible loading and burial memory.
 * Porosity uses maximum effective loading; Hertz-Mindlin contact stress uses current
 * effective pressure. The retained depth-based cementation proxy uses maximum geometric
 * burial (not pore pressure); it is not a time/temperature cementation model.
 * Mineral mixing, soft-sand/Gassmann and Raymer-Hunt-Gardner coefficients are unchanged.
 * Without explicit history the rock is assumed normally loaded at its present depth.
 */
export function rockState(f: number, depth: number, carbonate: boolean, overpressure: number | null, history?: RockHistory) {
  const de = effectiveDepth(depth, overpressure);
  const memory = advanceHistory(history ?? { maxBurial: 0, maxEffectiveDepth: 0 }, depth, overpressure);
  const t = Math.min(1, Math.max(0, (memory.maxBurial - ROCK.cementFrom) / (ROCK.cementTo - ROCK.cementFrom)));
  return { ...memory, effectivePressure: Math.max(1e4, (ROCK.overburden - BRINE.rho) * 9.81 * de),
    porosity: history?.bulkPorosity ?? porosity(f, memory.maxEffectiveDepth, carbonate), cementFraction: t * t * (3 - 2 * t) };
}
export function rockVelocity(f: number, d: number, carbonate: boolean, overpressure: number | null, history?: RockHistory): number {
  const state = rockState(f, d, carbonate, overpressure, history), phi = state.porosity;
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
  const P = state.effectivePressure, a = n * n * (1 - phic) ** 2 * mu * mu * P / (Math.PI ** 2 * (1 - nu) ** 2);
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
  const w = state.cementFraction;
  return Math.min(5600, Math.max(1500, (1 - w) * soft + w * Math.max(soft, rhg)));
}

/**
 * Velocity tabulated for one overpressure top: clastics by sand fraction (every 0.02) and burial (every 10 m to 6
 * km), carbonate by depth, interpolated linearly. Unloaded states use the direct formula.
 */
const TABLE_F = 50, TABLE_DZ = 10, TABLE_NZ = 601;
const tables = new Map<number | null, { clastic: Float32Array; carbonate: Float32Array }>();
function velocityTable(overpressure: number | null) {
  let t = tables.get(overpressure);
  if (t) return t;
  const clastic = new Float32Array((TABLE_F + 1) * TABLE_NZ), carbonate = new Float32Array(TABLE_NZ);
  for (let j = 0; j < TABLE_NZ; j++) {
    carbonate[j] = rockVelocity(0, j * TABLE_DZ, true, overpressure);
    for (let q = 0; q <= TABLE_F; q++) clastic[q * TABLE_NZ + j] = rockVelocity(q / TABLE_F, j * TABLE_DZ, false, overpressure);
  }
  if (tables.size > 32) tables.clear();
  t = { clastic, carbonate }; tables.set(overpressure, t);
  return t;
}
function tabled(t: { clastic: Float32Array; carbonate: Float32Array }, f: number, d: number, carbonate: boolean, overpressure: number | null) {
  // The table covers normally loaded material only; history-dependent states bypass it.
  if (d > (TABLE_NZ - 1) * TABLE_DZ) return rockVelocity(f, d, carbonate, overpressure);
  const s = Math.min(TABLE_NZ - 1.0001, Math.max(0, d / TABLE_DZ)), j = Math.floor(s), w = s - j;
  if (carbonate) return t.carbonate[j] + (t.carbonate[j + 1] - t.carbonate[j]) * w;
  const r = Math.min(TABLE_F - 0.0001, Math.max(0, f * TABLE_F)), q = Math.floor(r), v = r - q, a = q * TABLE_NZ + j, c = a + TABLE_NZ;
  const lo = t.clastic[a] + (t.clastic[a + 1] - t.clastic[a]) * w, hi = t.clastic[c] + (t.clastic[c + 1] - t.clastic[c]) * w;
  return lo + (hi - lo) * v;
}

/** Parcel velocity from its actual grain/pore volume, present stress and
 * irreversible loading/burial memory. */
export function layerVelocity(b: Pick<Basin, "beds" | "overpressure" | "basementVelocity">, p: Layer, top: number, floor: number) {
  if (p.bed === WATER) return 1500;
  if (p.bed === BASEMENT) return Math.min(5600, b.basementVelocity + 0.1 * Math.max(0, top + p.height / 2 - floor));
  return rockVelocity(p.fraction, Math.max(0, top + p.height / 2 - floor), b.beds[p.bed].carbonate, b.overpressure,
    { maxBurial: p.burial, maxEffectiveDepth: p.loading, bulkPorosity: Math.min(1, Math.max(0, 1 - p.solid / p.height)) });
}
/** Thickness-weighted slowness projection. Thin lithologies contribute even
 * when another bed owns the display label; the full column remains available. */
function columnWindow(b: Basin, columns: Column[], hw: number): RasterWindow {
  const nx = Math.round(WIDTH / hw) + 1, nz = Math.round(DEPTH / hw) + 1;
  const velocity = new Float32Array(nx * nz), ids = new Int32Array(nx * nz), fractions = new Float32Array(nx * nz), floor = new Float64Array(nx);
  for (let i = 0; i < nx; i++) {
    const column = columns[Math.min(b.nx - 1, Math.round((i * hw + MARGIN) / b.h))];
    floor[i] = surface(column); let j = 0, start = 0;
    for (let k = 0; k < nz; k++) {
      const lo = k * hw, hi = lo + hw, labels = new Map<number, number>();
      let time = 0, grains = 0, sandVolume = 0, used = 0, jj = j, z = start;
      while (jj < column.length && z < hi) {
        const p = column[jj], end = z + p.height, overlap = Math.max(0, Math.min(end, hi) - Math.max(z, lo));
        if (overlap > 0) {
          const v = p.bed === BASEMENT ? Math.min(5600, b.basementVelocity + 0.1 * Math.max(0, (Math.max(z, lo) + Math.min(end, hi)) / 2 - floor[i])) : layerVelocity(b, p, z, floor[i]);
          time += overlap / v; used += overlap;
          labels.set(p.bed, (labels.get(p.bed) ?? 0) + overlap);
          const s = p.solid * overlap / p.height; grains += s; sandVolume += s * p.fraction;
        }
        if (end > hi) break;
        z = end; jj++;
      }
      j = jj; start = z;
      const n = k * nx + i;
      if (!(used > 0)) throw Error('Window lies outside the material domain');
      velocity[n] = used / time; fractions[n] = grains ? sandVolume / grains : 0;
      ids[n] = [...labels].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
    }
  }
  return { velocity, beds: ids, sandFraction: fractions, nx, nz, floor };
}
export function windowOf(b: Basin, state: MaterialState = b, hw = H): RasterWindow {
  if (!(hw > 0) || !Number.isFinite(hw)) throw Error('Window spacing must be finite and positive');
  if (state.view) {
    // Replay deliberately stores a bounded-size projection, not all past
    // columns. Never silently reconstruct thin beds from its display labels.
    if (hw !== H) throw Error(`Replay snapshots are available at ${H} m only; resimulate to sample another spacing`);
    return { ...state.view, velocity: state.view.velocity.slice(), beds: state.view.beds.slice(), sandFraction: state.view.sandFraction.slice(), floor: state.view.floor.slice() };
  }
  if (state.columns) return columnWindow(b, state.columns, hw);
  const table = velocityTable(b.overpressure), grid = state.grid, nx = Math.round(WIDTH / hw) + 1, nz = Math.round(DEPTH / hw) + 1, velocity = new Float32Array(nx * nz), ids = new Int32Array(nx * nz), fractions = new Float32Array(nx * nz), floorDepth = new Float64Array(nx);
  for (let i = 0; i < nx; i++) {
    const x = i * hw, gi = Math.min(b.nx - 1, Math.round((x + MARGIN) / b.h));
    let floor = b.nz;
    for (let k = 0; k < b.nz; k++) if (grid[k * b.nx + gi] !== WATER) { floor = k; break; }
    floorDepth[i] = floor * b.h;
    for (let k = 0; k < nz; k++) {
      const z = k * hw, gk = Math.min(b.nz - 1, Math.round(z / b.h)), n = gk * b.nx + gi, c = grid[n], d = Math.max(0, (gk - floor + 0.5) * b.h);
      ids[k * nx + i] = c;
      fractions[k * nx + i] = state.sandFraction[n];
      const history = { maxBurial: state.burial[n], maxEffectiveDepth: state.effectiveBurial[n] };
      const loaded = history.maxBurial <= d + 0.001 && history.maxEffectiveDepth <= effectiveDepth(d, b.overpressure) + 0.001;
      velocity[k * nx + i] = c === WATER ? 1500 : c === BASEMENT ? Math.min(5600, b.basementVelocity + 0.1 * Math.max(0, z - floor * b.h))
        : loaded ? tabled(table, state.sandFraction[n], d, b.beds[c].carbonate, b.overpressure)
        : rockVelocity(state.sandFraction[n], d, b.beds[c].carbonate, b.overpressure, history);
    }
  }
  return { velocity, beds: ids, sandFraction: fractions, nx, nz, floor: floorDepth };
}
/** The simulated domain's margin (m), for tools that read the internal grid. */
export const DOMAIN = { margin: MARGIN, depth: ZMAX, window: { nx: GNX, nz: GNZ } };
