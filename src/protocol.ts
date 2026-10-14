// Messages between the page and the simulation workers.

import type { BasinOptions, Phase, Setting } from "./basin";
import type { BudgetSummary } from "./sedimentBudget";
import type { Verification } from "./basinVerify";

/** One state of the window (9.2 x 3 km at 20 m): velocity, bed index, lithology (sand fraction; -1 water, -2 basement, -3 carbonate), fault traces. */
export interface Frame {
  nx: number; nz: number;
  velocity: Float32Array; beds: Int32Array; litho: Float32Array;
  faults: { x: number[]; z: number[] }[];
}
export interface FaultInfo { kind: "normal" | "thrust"; dir: 1 | -1; dip: number; heave: number; emergent: boolean; transport: 1 | -1 }
export interface Section {
  seed: number; setting: Setting; options: BasinOptions;
  /** Unit of each bed (for unit boundaries). */
  unitOfBed: Int32Array;
  faults: FaultInfo[];
  log: { phase: Phase; text: string }[];
  overpressure: number | null; basementVelocity: number; dt: number;
  /** The exhumation episode (uplift in m over its steps, from its start step), if the seed has one. */
  exhumation: { start: number; steps: number; amount: number; tilt: number } | null;
  budget: BudgetSummary;
  checks: { trapped: number; collapsed: number; area: number; seconds: number };
  /** Today, and (if asked) after every step. */
  now: Frame; history: Frame[];
}

export type Request =
  | { id: number; kind: "section"; options: BasinOptions; history: boolean }
  | { id: number; kind: "verify"; options: BasinOptions; first: number; count: number };
export type Reply =
  | { id: number; kind: "section"; section: Section }
  /** A section asked with its history comes first without it (so it shows at once), then its history. */
  | { id: number; kind: "preview"; section: Section }
  | { id: number; kind: "history"; frames: Frame[] }
  | { id: number; kind: "progress"; text: string }
  | { id: number; kind: "verify"; result: Verification }
  | { id: number; kind: "error"; message: string };
