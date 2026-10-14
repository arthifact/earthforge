/** Sediment grain-volume accounting in m² (m³ per metre out of section).
 * Water, pore fluid and crystalline basement are excluded. Every raster cell has
 * full width h, including endpoint cells; domain dimensions are reported explicitly.
 * Fluxes are counted at process/boundary events independently of inventory scans.
 */
export const COMPONENTS = ["total", "sand", "shale", "carbonate"] as const;
export const SIDES = ["left", "right", "top", "bottom"] as const;
export const MATERIALS = ["sand", "shale", "carbonate"] as const;
export type Component = typeof COMPONENTS[number];
export type Side = typeof SIDES[number];
export type Process = "subsidence" | "normal-slip" | "thrust-slip" | "collapse" | "erosion" | "deposition" | "compaction" | "burial-memory" | "repair";
export interface Inventory { total: number; sand: number; shale: number; carbonate: number; byBed: number[]; byBedComponents: Record<typeof MATERIALS[number], number[]> }
import type { Column } from "./strata";
export interface SedimentState { grid: Int32Array; solid: Float64Array; sandFraction: Float64Array; beds: { carbonate: boolean }[]; h: number; columns?: Column[]; subcells?: Map<number, Column> }
export const emptyInventory = (): Inventory => ({ total: 0, sand: 0, shale: 0, carbonate: 0, byBed: [], byBedComponents: { sand: [], shale: [], carbonate: [] } });
/** Add one actual sediment parcel. Fraction is sand/clastic solid volume, not pore volume. */
export function addParcel(to: Inventory, bed: number, solidHeight: number, fraction: number, carbonate: boolean, width: number) {
  if (bed < 0) return;
  const volume = solidHeight * width;
  to.total += volume;
  to.byBed[bed] = (to.byBed[bed] ?? 0) + volume;
  // Same operations in the same order as the component loop, without a temporary per parcel.
  const sand = carbonate ? 0 : volume * fraction, shale = carbonate ? 0 : volume * (1 - fraction), carb = carbonate ? volume : 0;
  const parts = to.byBedComponents;
  to.sand += sand; parts.sand[bed] = (parts.sand[bed] ?? 0) + sand;
  to.shale += shale; parts.shale[bed] = (parts.shale[bed] ?? 0) + shale;
  to.carbonate += carb; parts.carbonate[bed] = (parts.carbonate[bed] ?? 0) + carb;
}
export function addInventory(to: Inventory, from: Inventory, scale = 1) {
  for (const key of COMPONENTS) to[key] += scale * from[key];
  for (let i = 0; i < from.byBed.length; i++) to.byBed[i] = (to.byBed[i] ?? 0) + scale * (from.byBed[i] ?? 0);
  for (const key of MATERIALS) for (let i = 0; i < from.byBedComponents[key].length; i++) {
    to.byBedComponents[key][i] = (to.byBedComponents[key][i] ?? 0) + scale * (from.byBedComponents[key][i] ?? 0);
  }
  return to;
}
export function inventoryOf(state: SedimentState): Inventory {
  const result = emptyInventory();
  if (state.columns) {
    for (const column of state.columns) for (const p of column) if (p.bed >= 0) addParcel(result, p.bed, p.solid, p.fraction, state.beds[p.bed].carbonate, state.h);
    return result;
  }
  // Independent whole-grid scan. Never derive retained solid from the flux ledger.
  for (let n = 0; n < state.grid.length; n++) {
    const parts = state.subcells?.get(n);
    if (parts) { for (const p of parts) if (p.bed >= 0) addParcel(result, p.bed, p.solid, p.fraction, state.beds[p.bed].carbonate, state.h); continue; }
    const bed = state.grid[n];
    if (bed >= 0) addParcel(result, bed, state.solid[n], state.sandFraction[n], state.beds[bed].carbonate, state.h);
  }
  return result;
}
export interface Fluxes {
  deposited: Inventory; eroded: Inventory;
  inflow: Record<Side, Inventory>; outflow: Record<Side, Inventory>;
  /** Artificial filling is disclosed, never treated as geological deposition/inflow. */
  repairAdded: Inventory;
}
export const emptyFluxes = (): Fluxes => ({ deposited: emptyInventory(), eroded: emptyInventory(), repairAdded: emptyInventory(),
  inflow: { left: emptyInventory(), right: emptyInventory(), top: emptyInventory(), bottom: emptyInventory() },
  outflow: { left: emptyInventory(), right: emptyInventory(), top: emptyInventory(), bottom: emptyInventory() } });
export function expectedInventory(before: Inventory, flux: Fluxes) {
  const expected = addInventory(emptyInventory(), before);
  addInventory(expected, flux.deposited); addInventory(expected, flux.eroded, -1);
  for (const side of SIDES) { addInventory(expected, flux.inflow[side]); addInventory(expected, flux.outflow[side], -1); }
  return expected;
}
/** Floating-point tolerance only; not an allowance for numerical sediment creation/loss. */
export const budgetTolerance = (scale: number) => 1e-6 + 1e-10 * Math.abs(scale);
export interface BudgetEntry { step: number; process: Process; fault: number | null; before: Inventory; after: Inventory; flux: Fluxes; residual: Inventory; closed: boolean; worstNormalizedResidual: number }
export function assessBudget(before: Inventory, after: Inventory, flux: Fluxes) {
  const expected = expectedInventory(before, flux), residual = addInventory(addInventory(emptyInventory(), after), expected, -1);
  let closed = true, worstNormalizedResidual = 0;
  for (const key of COMPONENTS) {
    const scale = Math.max(Math.abs(before[key]), Math.abs(expected[key]), Math.abs(after[key]));
    const error = Math.abs(residual[key]);
    closed &&= Number.isFinite(error) && error <= budgetTolerance(scale);
    worstNormalizedResidual = Math.max(worstNormalizedResidual, error / Math.max(1, scale));
  }
  for (let i = 0; i < residual.byBed.length; i++) {
    const scale = Math.max(Math.abs(before.byBed[i] ?? 0), Math.abs(expected.byBed[i] ?? 0), Math.abs(after.byBed[i] ?? 0));
    const error = Math.abs(residual.byBed[i] ?? 0);
    closed &&= Number.isFinite(error) && error <= budgetTolerance(scale);
    worstNormalizedResidual = Math.max(worstNormalizedResidual, error / Math.max(1, scale));
  }
  for (const key of MATERIALS) for (let i = 0; i < residual.byBedComponents[key].length; i++) {
    const scale = Math.max(Math.abs(before.byBedComponents[key][i] ?? 0), Math.abs(expected.byBedComponents[key][i] ?? 0), Math.abs(after.byBedComponents[key][i] ?? 0));
    const error = Math.abs(residual.byBedComponents[key][i] ?? 0);
    closed &&= Number.isFinite(error) && error <= budgetTolerance(scale);
    worstNormalizedResidual = Math.max(worstNormalizedResidual, error / Math.max(1, scale));
  }
  return { residual, closed, worstNormalizedResidual };
}
export interface BudgetSummary {
  events: number; failedEvents: number; closed: boolean; initial: Inventory; final: Inventory; flux: Fluxes; residual: Inventory;
  absoluteEventResidual: Inventory; maxEventResidual: number; maxNormalizedEventResidual: number;
  byProcess: Partial<Record<Process, { events: number; failed: number; signedResidual: Inventory; absoluteResidual: Inventory }>>;
}
export function summarizeBudget(entries: BudgetEntry[], initial: Inventory, final: Inventory): BudgetSummary {
  const flux = emptyFluxes(), absoluteEventResidual = emptyInventory();
  const byProcess: BudgetSummary["byProcess"] = {};
  let failedEvents = 0, maxEventResidual = 0, maxNormalizedEventResidual = 0;
  for (const entry of entries) {
    for (const key of ["deposited", "eroded", "repairAdded"] as const) addInventory(flux[key], entry.flux[key]);
    for (const side of SIDES) { addInventory(flux.inflow[side], entry.flux.inflow[side]); addInventory(flux.outflow[side], entry.flux.outflow[side]); }
    const absolute = { ...entry.residual, byBedComponents: { sand: entry.residual.byBedComponents.sand.map(Math.abs), shale: entry.residual.byBedComponents.shale.map(Math.abs), carbonate: entry.residual.byBedComponents.carbonate.map(Math.abs) }, byBed: entry.residual.byBed.map(v => Math.abs(v ?? 0)) };
    for (const key of COMPONENTS) absolute[key] = Math.abs(entry.residual[key]);
    addInventory(absoluteEventResidual, absolute);
    const p = byProcess[entry.process] ??= { events: 0, failed: 0, signedResidual: emptyInventory(), absoluteResidual: emptyInventory() };
    p.events++; p.failed += Number(!entry.closed); addInventory(p.signedResidual, entry.residual); addInventory(p.absoluteResidual, absolute);
    failedEvents += Number(!entry.closed);
    maxEventResidual = Math.max(maxEventResidual, ...COMPONENTS.map(k => absolute[k]), ...absolute.byBed.map(v => v ?? 0), ...MATERIALS.flatMap(k => absolute.byBedComponents[k].map(v => v ?? 0)));
    maxNormalizedEventResidual = Math.max(maxNormalizedEventResidual, entry.worstNormalizedResidual);
  }
  const assessed = assessBudget(initial, final, flux);
  return { events: entries.length, failedEvents, closed: failedEvents === 0 && assessed.closed, initial, final, flux, residual: assessed.residual,
    absoluteEventResidual, maxEventResidual, maxNormalizedEventResidual, byProcess };
}
/** Boundary classification for already-translated grid indices. Corners count once. */
export function outsideCell(i: number, k: number, nx: number, nz: number): Side | null {
  return i < 0 ? "left" : i >= nx ? "right" : k < 0 ? "top" : k >= nz ? "bottom" : null;
}
