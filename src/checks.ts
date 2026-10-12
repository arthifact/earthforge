// The checks as rows: what was measured, against what (rule or literature), and whether it passes, fails, or is
// kept for the record. Rules are the ones written in docs/verification-log.md before each run.

import { COMPACTION, THERMAL_TAU } from "./basin";
import { hamilton1979, hamilton1985, percentile, type Verification } from "./basinVerify";

export type Status = "pass" | "fail" | "info";
export interface Row { group: string; name: string; value: string; note: string; verdict: string; status: Status }

const band = (v: number[], digits = 2) => v.length ? `${percentile(v, 0.5).toFixed(digits)} (${percentile(v, 0.1).toFixed(digits)}–${percentile(v, 0.9).toFixed(digits)})` : "none measured";
const within = (x: number, lo: number, hi: number) => x >= lo && x <= hi;
const pct = (a: number, b: number) => b ? `${(100 * a / b).toFixed(2)}%` : "–";

export function checkRows(r: Verification): Row[] {
  const rows: Row[] = [];
  const add = (group: string, name: string, value: string, note: string, status: Status, verdict: string) => rows.push({ group, name, value, note, verdict, status });
  const vAt = (z: number) => r.velocity.p50[Math.min(r.velocity.depth.length - 1, Math.floor(z / 100))];
  const off = (sim: number, ref: number) => `${sim >= ref ? "+" : ""}${(100 * (sim - ref) / ref).toFixed(0)}%`;

  // Known answers.
  const k = r.kinematics, kf = k.fine;
  add("Known answers", "Normal-fault heave, 20 m grid", `${k.within} of ${k.units} units within 40 m`, `one fault, no erosion, no folds, no compaction: heave between each unit's cutoffs against the heave applied after it was deposited; mean ${k.mean.toFixed(1)} m, worst ${k.worst.toFixed(0)} m`,
    k.units && k.within === k.units ? "pass" : "fail", k.units && k.within === k.units ? "kinematics right" : "fails the 40 m rule");
  const halves = kf.mean < 0.6 * k.mean && kf.worst < 0.6 * k.worst;
  add("Known answers", "Normal-fault heave, 10 m grid", `${kf.within} of ${kf.units} units within 40 m`, `mean ${kf.mean.toFixed(1)} m, worst ${kf.worst.toFixed(0)} m; a rounding error shrinks with the cell, a bug does not`,
    kf.units && kf.within === kf.units ? "pass" : "fail", kf.within === kf.units ? (halves ? "error halves with the cell: rounding" : "passes") : "fails");
  const c = r.compaction;
  add("Known answers", "Compaction: solid kept in each bed", `${(100 * c.worstSolid).toExponential(1)}% worst, ${c.beds} beds`, "no faults or erosion: every bed keeps the solid grains it was deposited with", c.beds && c.worstSolid < 1e-8 ? "pass" : "fail", c.worstSolid < 1e-8 ? "kept" : "lost: a bug");
  const cRule = (x: { runs: number; within: number; mean: number }) => x.runs > 0 && x.within >= 0.95 * x.runs && Math.abs(x.mean) <= 5;
  add("Known answers", "Compaction: bed thickness, 20 m grid", `${c.within} of ${c.runs} beds within 20 m`, `each bed every 200 m: its thickness against the decompaction equation for its solid at its depth (Sclater and Christie curves); mean ${c.mean.toFixed(1)} m, worst ${c.worst.toFixed(0)} m`,
    cRule(c) ? "pass" : "fail", cRule(c) ? "compaction right" : "fails (95% within 20 m, mean within 5 m)");
  add("Known answers", "Compaction: bed thickness, 10 m grid", `${c.fine.within} of ${c.fine.runs} beds within 20 m`, `mean ${c.fine.mean.toFixed(1)} m, worst ${c.fine.worst.toFixed(0)} m; at 20 m most beds are one cell thick`,
    cRule(c.fine) ? "pass" : "fail", cRule(c.fine) ? (cRule(c) ? "compaction right" : "passes: the 20 m failure is rounding") : "fails");
  const t = r.thrust;
  add("Known answers", "Thrust against the flow applied at once, 20 m grid", t.cells ? `${pct(t.matched, t.cells)} of ${t.cells} cells` : "none", "one thrust, no erosion, uniform subsidence, no compaction: hanging-wall cells of pre-thrust beds hold the bed that fault-parallel flow by the total slip puts there", t.cells && t.matched >= 0.99 * t.cells ? "pass" : "fail", t.matched >= 0.99 * t.cells ? "kinematics right" : "fails the 99% rule");
  add("Known answers", "Thrust against the flow applied at once, 10 m grid", t.fine.cells ? `${pct(t.fine.matched, t.fine.cells)} of ${t.fine.cells} cells` : "none", "a rounding error shrinks with the cell, a bug does not", t.fine.cells && t.fine.matched >= 0.99 * t.fine.cells ? "pass" : "fail", t.fine.matched >= 0.99 * t.fine.cells ? "kinematics right" : "fails the 99% rule");
  const dipsOk = t.dips.filter((d) => Math.abs(d) <= 2).length;
  add("Known answers", "Thrust backlimb dip minus ramp dip", t.dips.length ? `${band(t.dips, 1)}°, ${dipsOk} of ${t.dips.length} within 2°` : "none measured", "fault-bend folding (Suppe 1983): beds carried from the lower flat onto the ramp dip as the ramp", t.dips.length && dipsOk >= 0.9 * t.dips.length ? "pass" : "fail", dipsOk >= 0.9 * t.dips.length ? "as fault-bend folding" : "fails (90% within 2°)");
  add("Known answers", "Rock kept by each thrust slip (known-answer runs)", `${(100 * t.area).toFixed(2)}% worst`, "fault-parallel flow keeps area (a balanced section, Dahlstrom 1969), counting rock entering at the hinterland edge and leaving above sea level or at the foreland edge", t.area < 0.02 ? "pass" : "fail", t.area < 0.02 ? "kept" : "lost: a bug");

  // Literature, on many sections.
  add("Against the literature", "Velocity 0.5 km below the sea floor", `${vAt(500).toFixed(0)} m/s`, `Hamilton 1979 ${hamilton1979(0.5).toFixed(0)}, 1985 ${hamilton1985(0.5).toFixed(0)} (deep-sea sediments)`, "info", `${off(vAt(500), hamilton1979(0.5))} against Hamilton 1979`);
  add("Against the literature", "Velocity 1 km below the sea floor", `${vAt(1000).toFixed(0)} m/s`, `Hamilton 1979 ${hamilton1979(1).toFixed(0)}, 1985 ${hamilton1985(1).toFixed(0)}`, "info", `${off(vAt(1000), hamilton1979(1))} against Hamilton 1979`);
  const eiD = percentile(r.expansion.during, 0.5), eiB = percentile(r.expansion.before, 0.5);
  add("Against the literature", "Expansion index, units deposited while the fault slipped", band(r.expansion.during), "growth faults: above 1 (examples 1.0–1.5; a classic Gulf Coast fault 1.45)", Number.isFinite(eiD) ? (eiD > 1.02 ? "pass" : "fail") : "info", Number.isFinite(eiD) ? (eiD > 1.02 ? (within(eiD, 1, 1.6) ? "within the examples" : "above the examples") : "no growth: wrong") : "not measured");
  add("Against the literature", "Expansion index, units deposited before the fault", band(r.expansion.before), "no growth expected: about 1", Number.isFinite(eiB) ? (Math.abs(eiB - 1) < 0.1 ? "pass" : "fail") : "info", Number.isFinite(eiB) ? (Math.abs(eiB - 1) < 0.1 ? "as expected" : "off") : "not measured");
  add("Against the literature", "Chord between cutoffs grows for older units", `${r.throwGrows.growing} of ${r.throwGrows.faults} faults`, "not conserved on a listric fault under vertical shear; kept for the record", "info", "for the record");
  const hg = r.heaveGrows, hf = r.heaveFailures;
  add("Against the literature", "Heave grows for older units", `${hg.growing} of ${hg.faults} faults`, `implementation check (vertical shear conserves heave); failing: ${hf.crossed} crossed by another fault, ${hf.edge} at an edge, ${hf.nested} nested, ${hf.antithetic} antithetic, ${hf.other} other`, hg.faults && hg.growing >= 0.9 * hg.faults ? "pass" : "fail", hg.growing >= 0.9 * hg.faults ? "as expected" : hf.other <= 2 ? "below 90%; nearly all explained" : "below 90%; unexplained");
  add("Against the literature", "Throw grows with depth within growth units", `${r.growthThrow.growing} of ${r.growthThrow.faults} faults`, "the literature's growth-fault form", r.growthThrow.faults ? (r.growthThrow.growing >= 0.7 * r.growthThrow.faults ? "pass" : "fail") : "info", r.growthThrow.growing >= 0.7 * r.growthThrow.faults ? "mostly, as expected" : "often not");
  const dip = percentile(r.dips, 0.5);
  add("Against the literature", "Normal-fault dip, sea floor to 1 km below", `${band(r.dips, 0)}°`, "Anderson–Byerlee 60–65°; most seismogenic normal faults 30–60°; compaction flattens buried faults (Xiao and Suppe 1989)", r.dips.length ? (within(dip, 30, 70) ? "pass" : "fail") : "info", r.dips.length ? (within(dip, 30, 70) ? "within 30–70°" : "outside 30–70°") : "not measured");
  const rate = (v: number[], lo: number, hi: number, note: string, name: string) => { const m = percentile(v, 0.5); add("Against the literature", name, `${band(v, 3)} mm/yr`, note, Number.isFinite(m) ? (within(m, lo, hi) ? "pass" : "fail") : "info", Number.isFinite(m) ? (within(m, lo, hi) ? `within ${lo}–${hi}` : `outside ${lo}–${hi}`) : "not measured"); };
  rate(r.rates.slip, 0.03, 7, "0.03–0.2 mature rifts (North Sea); 1–7 young fast rifts (Corinth)", "Normal-fault slip rate");
  rate(r.rates.sedimentation, 0.03, 1, "<0.05 starved hanging walls; 0.03–0.3 depocentres; ~1 fed margins", "Sedimentation rate");
  rate(r.rates.subsidence, 0.01, 1, "~0.01–0.13 mature margins; ~0.1–1 filled depocentres", "Subsidence rate");

  // Physics on every section.
  const p = r.physics;
  add("Physics", "Rock kept by each slip", `normal faults ${(100 * p.areaNormal).toFixed(2)}%, thrusts ${(100 * p.areaThrust).toFixed(2)}% worst`, "vertical shear and fault-parallel flow keep area: the grid's rounding only", p.area < 0.02 ? "pass" : "fail", p.area < 0.02 ? "kept" : "lost: a bug");
  add("Physics", "Overhangs collapsed; water left; same seed, same section", `${p.collapsed.extension} + ${p.collapsed.compression} cells; ${p.trapped}; ${p.deterministic ? "yes" : "no"}`, "water below rock after a slip closes as the rock above drops into it (thrust fronts rolling over a lower sea floor; rounding at scarps); none may remain", p.deterministic && p.trapped === 0 ? "pass" : "fail", !p.deterministic ? "not deterministic: a bug" : p.trapped === 0 ? "as expected" : "water left: a bug");
  add("For the record", "Total thrust slip per section", r.compression.slip.length ? `${band(r.compression.slip, 1)} km` : "no compression sections", "drawn: 0.6–2.4 km per thrust, 1–3 thrusts", "info", "for the record");
  add("For the record", "Velocity inversions (share of columns)", `extension ${band(r.compression.inversions.extension)}, compression ${band(r.compression.inversions.compression)}`, "velocity averaged over 200 m dropping 300 m/s below its highest value above", "info", "for the record");
  add("For the record", "Inputs taken from the literature", "porosity, rock physics, thermal decay", `Sclater and Christie (shale ${COMPACTION.shale.phi0}, ${COMPACTION.shale.L} m; sand ${COMPACTION.sand.phi0}, ${COMPACTION.sand.L} m), also for compaction of thickness; velocity at the deepest burial (Japsen); soft-sand model (Dvorkin and Nur 1996) cementing into Raymer–Hunt–Gardner; Wood; τ ${THERMAL_TAU} Myr; thrust ramps 18–32°`, "info", "by construction");
  return rows;
}
