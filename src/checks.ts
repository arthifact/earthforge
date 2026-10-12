// The checks as rows: what was measured, against what (rule or literature), and whether it passes, fails, or is
// kept for the record. Original rules and subsequent changes are documented in docs/verification-log.md
// and docs/validation-audit.md; geological guides are screening criteria, not empirical validation.

import { COMPACTION, THERMAL_TAU } from "./basin";
import { hamilton1979, hamilton1985, medianVelocityAt, percentile, type Verification } from "./basinVerify";

export type Status = "pass" | "fail" | "info";
export interface Row { group: string; name: string; value: string; note: string; verdict: string; status: Status }

const band = (v: number[], digits = 2) => v.length ? `${percentile(v, 0.5).toFixed(digits)} (${percentile(v, 0.1).toFixed(digits)}–${percentile(v, 0.9).toFixed(digits)})` : "none measured";
const within = (x: number, lo: number, hi: number) => x >= lo && x <= hi;
const pct = (a: number, b: number) => b ? `${(100 * a / b).toFixed(2)}%` : "–";

export function checkRows(r: Verification): Row[] {
  const rows: Row[] = [];
  const add = (group: string, name: string, value: string, note: string, status: Status, verdict: string, samples = 1) => rows.push({ group, name, value, note, verdict: samples ? verdict : "not measured", status: samples ? status : "info" });
  const vAt = (z: number) => medianVelocityAt(r.velocity, z);
  const off = (sim: number, ref: number) => `${sim >= ref ? "+" : ""}${(100 * (sim - ref) / ref).toFixed(0)}%`;

  // Controlled numerical benchmarks.
  const k = r.kinematics, kf = k.fine;
  add("Numerical benchmarks", "Normal-fault heave, 20 m grid", `${k.within} of ${k.units} units within 40 m`, `one fault, no erosion, no folds, no compaction: heave between each unit's cutoffs against the heave applied after it was deposited; mean ${k.mean.toFixed(1)} m, worst ${k.worst.toFixed(0)} m`,
    k.units && k.within === k.units ? "pass" : "fail", k.units && k.within === k.units ? "within tolerance" : "fails the 40 m rule", k.units);
  const halves = kf.mean < 0.6 * k.mean && kf.worst < 0.6 * k.worst;
  add("Numerical benchmarks", "Normal-fault heave, 10 m grid", `${kf.within} of ${kf.units} units within 40 m`, `mean ${kf.mean.toFixed(1)} m, worst ${kf.worst.toFixed(0)} m; finer grid, same 40 m tolerance`,
    kf.units && kf.within === kf.units ? "pass" : "fail", kf.within === kf.units ? (halves ? "smaller error on the finer grid" : "passes") : "fails", kf.units);
  const c = r.compaction;
  add("Numerical benchmarks", "Compaction: solid kept in each bed", `${(100 * c.worstSolid).toExponential(1)}% worst, ${c.beds} beds`, "no faults or erosion: each bed away from the bottom boundary keeps its deposited solid", c.beds && c.worstSolid < 1e-8 ? "pass" : "fail", c.worstSolid < 1e-8 ? "kept" : "outside tolerance", c.beds);
  const cRule = (x: { runs: number; within: number; meanAbs: number }) => x.runs > 0 && x.within >= 0.95 * x.runs && x.meanAbs <= 5;
  const errors = (x: typeof c.fine) => `mean absolute error ${x.meanAbs.toFixed(1)} m, bias ${x.mean.toFixed(1)} m, worst ${x.worst.toFixed(0)} m; excluded ${x.oneCell} one-cell and ${x.deep} deep intervals`;
  add("Numerical benchmarks", "Compaction: bed thickness, 20 m grid", `${c.within} of ${c.runs} intervals within 20 m`, `beds sampled every 200 m against the integrated decompaction equation (Sclater and Christie curves); ${errors(c)}`,
    cRule(c) ? "pass" : "fail", cRule(c) ? "within tolerance" : "fails (95% within 20 m, mean absolute error ≤5 m)", c.runs);
  add("Numerical benchmarks", "Compaction: bed thickness, 10 m grid", `${c.fine.within} of ${c.fine.runs} intervals within 20 m`, `${errors(c.fine)}; finer grid, same tolerances`,
    cRule(c.fine) ? "pass" : "fail", cRule(c.fine) ? "within tolerance" : "fails", c.fine.runs);
  const t = r.thrust;
  add("Numerical benchmarks", "Thrust remapping consistency, 20 m grid", t.cells ? `${pct(t.matched, t.cells)} of ${t.cells} cells` : "none", "one thrust, no erosion, uniform subsidence, no compaction: back-traced pre-thrust cells; uses the same flow calculation as the simulator; an internal consistency check", t.cells && t.matched >= 0.99 * t.cells ? "pass" : "fail", t.matched >= 0.99 * t.cells ? "within tolerance" : "fails the 99% rule", t.cells);
  add("Numerical benchmarks", "Thrust remapping consistency, 10 m grid", t.fine.cells ? `${pct(t.fine.matched, t.fine.cells)} of ${t.fine.cells} cells` : "none", "finer grid, same 99% agreement rule", t.fine.cells && t.fine.matched >= 0.99 * t.fine.cells ? "pass" : "fail", t.fine.matched >= 0.99 * t.fine.cells ? "within tolerance" : "fails the 99% rule", t.fine.cells);
  const dipsOk = t.dips.filter((d) => Math.abs(d) <= 2).length;
  add("Numerical benchmarks", "Thrust backlimb dip minus ramp dip", t.dips.length ? `${band(t.dips, 1)}°, ${dipsOk} of ${t.dips.length} within 2°` : "none measured", "ideal flat-to-ramp geometry: pre-thrust beds transported onto the ramp should dip as the ramp; this alone does not validate a complete Suppe fold", t.dips.length && dipsOk >= 0.9 * t.dips.length ? "pass" : "fail", dipsOk >= 0.9 * t.dips.length ? "within tolerance" : "fails (90% within 2°)", t.dips.length);
  add("Numerical benchmarks", "Rock kept by each thrust slip (known-answer runs)", `${(100 * t.area).toFixed(2)}% worst`, "fault-parallel flow keeps area (a balanced section, Dahlstrom 1969), counting rock entering at the hinterland edge and leaving above sea level or at the foreland edge", t.area < 0.02 ? "pass" : "fail", t.area < 0.02 ? "within 2%" : "outside tolerance", t.cells + t.fine.cells);

  // Literature, on many sections.
  for (const d of [500, 1000]) {
    const value = vAt(d);
    add("Geological plausibility", `Velocity ${d / 1000} km below the sea floor`, Number.isFinite(value) ? `${value.toFixed(0)} m/s` : "none measured", `interpolated between 100 m bin medians; Hamilton 1979 ${hamilton1979(d / 1000).toFixed(0)}, 1985 ${hamilton1985(d / 1000).toFixed(0)} m/s (marine clastics); all simulated sediment types and represented settings are pooled`, "info", Number.isFinite(value) ? `${off(value, hamilton1979(d / 1000))} against Hamilton 1979` : "not measured");
  }
  const eiD = percentile(r.expansion.during, 0.5), eiB = percentile(r.expansion.before, 0.5);
  add("Geological plausibility", "Expansion index, units deposited while the fault slipped", band(r.expansion.during), `${r.expansion.during.length} complete unit pairs, sampled beyond fault-truncated intervals; growth faults: above 1 (examples 1.0–1.5; a classic Gulf Coast fault 1.45)`, Number.isFinite(eiD) ? (eiD > 1.02 ? "pass" : "fail") : "info", Number.isFinite(eiD) ? (eiD > 1.02 ? (within(eiD, 1, 1.6) ? "within the examples" : "above the examples") : "median does not exceed 1.02") : "not measured");
  add("Geological plausibility", "Expansion index, units deposited before the fault", band(r.expansion.before), `${r.expansion.before.length} complete unit pairs; no growth expected: about 1`, Number.isFinite(eiB) ? (Math.abs(eiB - 1) < 0.1 ? "pass" : "fail") : "info", Number.isFinite(eiB) ? (Math.abs(eiB - 1) < 0.1 ? "as expected" : "off") : "not measured");
  add("Geological plausibility", "Chord between cutoffs grows for older units", `${r.throwGrows.growing} of ${r.throwGrows.faults} faults`, "not conserved on a listric fault under vertical shear; kept for the record", "info", "for the record");
  const hg = r.heaveGrows, hf = r.heaveFailures;
  add("Geological plausibility", "Heave grows for older units", `${hg.growing} of ${hg.faults} faults`, `implementation check (vertical shear conserves heave); failing: ${hf.crossed} crossed by another fault, ${hf.edge} at an edge, ${hf.nested} nested, ${hf.antithetic} antithetic, ${hf.other} other`, hg.faults && hg.growing >= 0.9 * hg.faults ? "pass" : "fail", hg.growing >= 0.9 * hg.faults ? "as expected" : hf.other <= 2 ? "below 90%; nearly all explained" : "below 90%; unexplained", hg.faults);
  add("Geological plausibility", "Throw grows with depth within growth units", `${r.growthThrow.growing} of ${r.growthThrow.faults} faults`, "the literature's growth-fault form", r.growthThrow.faults ? (r.growthThrow.growing >= 0.7 * r.growthThrow.faults ? "pass" : "fail") : "info", r.growthThrow.growing >= 0.7 * r.growthThrow.faults ? "mostly, as expected" : "often not", r.growthThrow.faults);
  const dip = percentile(r.dips, 0.5);
  add("Geological plausibility", "Normal-fault dip, sea floor to 1 km below", `${band(r.dips, 0)}°`, "Anderson–Byerlee 60–65°; most seismogenic normal faults 30–60°; compaction flattens buried faults (Xiao and Suppe 1989)", r.dips.length ? (within(dip, 30, 70) ? "pass" : "fail") : "info", r.dips.length ? (within(dip, 30, 70) ? "within 30–70°" : "outside 30–70°") : "not measured");
  const rate = (v: number[], lo: number, hi: number, note: string, name: string) => { const m = percentile(v, 0.5); add("Geological plausibility", name, `${band(v, 3)} mm/yr`, `median-only screening; ${note}`, Number.isFinite(m) ? (within(m, lo, hi) ? "pass" : "fail") : "info", Number.isFinite(m) ? (within(m, lo, hi) ? `within ${lo}–${hi}` : `outside ${lo}–${hi}`) : "not measured"); };
  rate(r.rates.slip, 0.03, 7, "0.03–0.2 mature rifts (North Sea); 1–7 young fast rifts (Corinth)", "Normal-fault slip rate (initial-dip estimate)");
  rate(r.rates.sedimentation, 0.03, 1, "<0.05 starved hanging walls; 0.03–0.3 depocentres; ~1 fed margins", "Sedimentation rate (thickest deposit per step)");
  rate(r.rates.subsidence, 0.01, 1, "~0.01–0.13 mature margins; ~0.1–1 filled depocentres", "Subsidence rate (step means)");

  // Physics on every section.
  const p = r.physics;
  add("Physics", "Rock kept by each slip", `normal faults ${(100 * p.areaNormal).toFixed(2)}%, thrusts ${(100 * p.areaThrust).toFixed(2)}% worst`, `${p.slips} slips; grid-area balance including boundary flux; this is not a full sediment mass budget`, p.area < 0.02 ? "pass" : "fail", p.area < 0.02 ? "within 2%" : "outside tolerance", p.slips);
  add("Physics", "Overhangs collapsed; water left", `${p.collapsed.extension} + ${p.collapsed.compression} cells; ${p.trapped} left`, "water below rock is closed by dropping the rock above it; none may remain", p.trapped === 0 ? "pass" : "fail", p.trapped === 0 ? "as expected" : "trapped water remains", r.sections);
  add("Physics", "Physical cell bounds", `${p.invalidCells} invalid cells; ${p.invalidVelocity} invalid velocities`, "valid bed IDs; finite solid between 0 and cell height (zero in water/basement); finite nonnegative burial; finite displayed velocity within 1500–5600 m/s (a prescribed bound, not validation)", p.invalidCells === 0 && p.invalidVelocity === 0 ? "pass" : "fail", p.invalidCells === 0 && p.invalidVelocity === 0 ? "within bounds" : "invalid state", r.sections);
  add("Physics", "Repeatability of physical state", `${p.repeated} sections repeated`, "first seed in each represented setting: grid, solid, burial, beds, fault geometry and physical parameters", p.deterministic ? "pass" : "fail", p.deterministic ? "identical" : "state differs", p.repeated);
  add("For the record", "Total thrust slip per section", r.compression.slip.length ? `${band(r.compression.slip, 1)} km` : "no compression sections", "drawn: 0.6–2.4 km per thrust, 1–3 thrusts", "info", "for the record");
  add("For the record", "Velocity inversions (share of columns)", `extension ${band(r.compression.inversions.extension)}, compression ${band(r.compression.inversions.compression)}`, "velocity averaged over 200 m dropping 300 m/s below its highest value above", "info", "for the record");
  add("For the record", "Inputs taken from the literature", "porosity, rock physics, thermal decay", `Sclater and Christie (shale ${COMPACTION.shale.phi0}, ${COMPACTION.shale.L} m; sand ${COMPACTION.sand.phi0}, ${COMPACTION.sand.L} m), also for compaction of thickness; velocity at the deepest burial (Japsen); soft-sand model (Dvorkin and Nur 1996) cementing into Raymer–Hunt–Gardner; Wood; τ ${THERMAL_TAU} Myr; thrust ramps 18–32°`, "info", "by construction");
  return rows;
}
