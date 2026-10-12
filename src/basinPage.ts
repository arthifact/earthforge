// The basin simulator's gallery (docs/verification-log.md): a batch of
// sections from random seeds, each simulated forward in time in an extensional
// or a compressional setting (subsidence, growth faults or thrusts, erosion,
// deposition, compaction); open one to replay its history step by step, see
// its beds and faults, and its velocity with depth.
// Marmousi is shown for comparison by eye when its file is present.
// A verification panel measures many sections against published values.

import "./style.css";
import { BASIN_DEFAULTS, BASEMENT, COMPACTION, simulate, THERMAL_TAU, WATER, windowOf, type Basin, type BasinOptions } from "./basin";
import { hamilton1979, hamilton1985, percentile, verify, type Verification } from "./basinVerify";
import { button, element } from "./ui";
import { DEPTH, GNX, GNZ, WIDTH } from "./window";

function turbo(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t)), c = (a: number[]) => Math.min(1, Math.max(0, a.reduceRight((acc, k) => acc * x + k, 0)));
  return [c([0.13572138, 4.6153926, -42.66032258, 132.13108234, -152.94239396, 59.28637943]),
    c([0.09140261, 2.19418839, 4.84296658, -14.18503333, 4.27729857, 2.82956604]),
    c([0.1066733, 12.64194608, -60.58204836, 110.36276771, -89.90310912, 27.34824973])];
}
const TERRAIN = [[0.965, 0.925, 0.851], [0.925, 0.827, 0.678], [0.831, 0.659, 0.486], [0.663, 0.557, 0.455], [0.482, 0.506, 0.537], [0.310, 0.365, 0.431]];
function terrain(t: number): [number, number, number] {
  const s = Math.min(1, Math.max(0, t)) * 5, i = Math.min(4, Math.floor(s)), f = s - i, g = f * f * (3 - 2 * f), a = TERRAIN[i], b = TERRAIN[i + 1];
  return [a[0] + (b[0] - a[0]) * g, a[1] + (b[1] - a[1]) * g, a[2] + (b[2] - a[2]) * g];
}
const VRANGE: [number, number] = [1500, 5500];

export async function startBasin(root: HTMLElement) {
  root.innerHTML = "";
  const shell = element("div", "", "shell fwi2d"), header = element("header");
  header.append(element("h1", "Earth Forge"), element("p", "Subsurface sections built from geological history. Now: sedimentary basins, stretched or shortened (subsidence, growth faults or thrusts, erosion, deposition, compaction)."));
  const main = element("main"), center = element("div", "", "center"), panel = element("aside", "", "card panel fwi2d-panel");
  const stage = element("section", "", "card fwi2d-stage"), galleryCard = element("section", "", "card fwi2d-stage"), refCard = element("section", "", "card fwi2d-stage");
  const big = element("canvas"), profile = element("canvas"), title = element("h3", "Section");
  const toggles = element("div", "", "row wrap fwi2d-toggles");
  let showBeds = true, showFaults = true, contrast = true;
  const check = (label: string, value: boolean, set: (v: boolean) => void) => {
    const wrap = element("label", "", "note"), input = element("input"); input.type = "checkbox"; input.checked = value;
    input.onchange = () => { set(input.checked); drawBig(); drawGallery(); }; wrap.append(input, document.createTextNode(` ${label}`)); return wrap;
  };
  toggles.append(check("Bed and unit boundaries", true, (v) => (showBeds = v)), check("Faults", true, (v) => (showFaults = v)), check("High-contrast colours", true, (v) => (contrast = v)));
  const history = element("div", "", "row wrap fwi2d-toggles"), slider = element("input"), stepLabel = element("span", "", "note");
  Object.assign(slider, { type: "range", min: "0", max: "0", step: "1", value: "0" }); slider.style.width = "260px";
  const play = button("Replay history ▶", () => void replay());
  const historyWrap = element("label", "History: first step ", "note"); historyWrap.append(slider, document.createTextNode(" today"));
  history.append(historyWrap, stepLabel, play);
  const logLine = element("p", "", "note"), legend = element("div", "", "legend fwi2d-legend");
  profile.style.cssText = "width: 100%; aspect-ratio: 461 / 151; display: block; border-radius: 10px;";
  stage.append(title, big, toggles, history, logLine, legend, element("h3", "Velocity with depth (columns at 2, 4.6 and 7.2 km)"), profile);
  const gallery = element("div"); gallery.style.cssText = "display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px;";
  galleryCard.append(element("h3", "Gallery (click one to open it)"), gallery);
  const refs = element("div", "", "fwi2d-pair"), refA = element("canvas");
  const box = (t: string, c: HTMLCanvasElement) => { const d = element("div"); d.append(element("h3", t), c); return d; };
  refs.append(box("Marmousi (for comparison only; shown when public/reference/marmousi_truth20.f32 is present)", refA));
  refCard.append(refs, element("p", "The simulator's rules were written from basin geology, not from this section (docs/verification-log.md).", "note"));
  // Checks against the literature, on many sections.
  const verifyCard = element("section", "", "card fwi2d-stage"), vChart = element("canvas"), vTable = element("div", "", "stats"), vNote = element("p", "", "note");
  vChart.style.cssText = "width: 100%; aspect-ratio: 461 / 151; display: block; border-radius: 10px;";
  const countSel = element("select"); for (const n of [20, 40, 100]) { const op = element("option", `${n} sections`); op.value = String(n); countSel.append(op); } countSel.value = "40";
  const runVerify = button("Run the checks", () => void runChecks(), "button primary"), vRow = element("div", "", "row wrap"); vRow.append(countSel, runVerify);
  verifyCard.append(element("h3", "Checks against the literature (many sections, the settings on the right; growth-fault rows from extension sections only)"), vRow, vNote, element("h3", "Velocity below the sea floor: simulated 10-90% band and median; Hamilton's marine-sediment fits"), vChart, vTable,
    element("p", "Sources: Hamilton 1979 (JASA 65) and 1985 (JASA 78) marine-sediment velocity fits; Thorsen 1963 (expansion index); Anderson-Byerlee 60-65° and observed 30-60° normal-fault dips (Olive and Behn 2014), ~70° in British coal measures (Walsh and Watterson); fault slip rates 0.03-0.2 mm/yr in the mature North Sea rift, 1-7 in young fast rifts (Corinth); sedimentation <0.05 (starved North Sea hanging walls) to 0.03-0.3 (depocentres) to ~1 mm/yr (fed margins, Gulf of Lion); McKenzie 1978 (62.8 Myr); Sclater and Christie 1980; Xiao and Suppe 1989 (compaction flattens growth faults); Japsen (velocity records maximum burial); Suppe 1983 (fault-bend folding); Dahlstrom 1969 (balanced sections); Dvorkin and Nur 1996 (soft sand); Raymer, Hunt and Gardner 1980; Wood 1941. Details and links: docs/verification-log.md.", "note"));
  center.append(stage, galleryCard, verifyCard, refCard);

  const select = (label: string, options: [string, string][], value: string) => {
    const wrap = element("label", label), s = element("select");
    for (const [v, t] of options) { const o = element("option", t); o.value = v; s.append(o); }
    s.value = value; wrap.append(s); return { wrap, s };
  };
  const seedInput = element("input"); Object.assign(seedInput, { type: "number", min: "1", step: "1", value: "1" });
  const seedWrap = element("label", "Seed of the first section"); seedWrap.append(seedInput);
  const settingSel = select("Setting", [["any", "any: half stretched, half shortened (default)"], ["extension", "extension: growth faults"], ["compression", "compression: thrusts"]], "any");
  const faultSel = select("Growth faults (extension)", [["2,4", "2-4 (default)"], ["1,2", "1-2"], ["4,7", "4-7"], ["0,0", "none"]], "2,4");
  const thrustSel = select("Thrusts (compression)", [["1,3", "1-3 (default)"], ["1,1", "1"], ["2,4", "2-4"], ["0,0", "none"]], "1,3");
  const compactSel = select("Compaction of beds", [["on", "on: beds thin with burial (default)"], ["off", "off"]], "on");
  const opSel = select("Overpressure", [["0.35", "in about a third of sections (default)"], ["0", "never"], ["1", "always"]], "0.35");
  const carbSel = select("Carbonate units", [["0.1", "rare (default)"], ["0", "none"], ["0.3", "common"]], "0.1");
  const regen = button("Build this batch", () => build(), "button primary"), random = button("New random batch", () => { seedInput.value = String(1 + Math.floor(Math.random() * 1e6)); build(); });
  const buttons = element("div", "", "row wrap"); buttons.append(regen, random);
  const checks = element("p", "", "note"), stats = element("div", "", "stats");
  panel.append(element("h3", "Simulator"), seedWrap, settingSel.wrap, faultSel.wrap, thrustSel.wrap, compactSel.wrap, opSel.wrap, carbSel.wrap, buttons, checks, element("h3", "This section"), stats,
    element("p", "Each step: the basin subsides; active faults slip (normal-fault hanging walls roll over; thrust sheets ride up their ramps and fold); highs above wave base erode; sediment fills the space to the base level; buried beds compact. Velocity: rock physics at each rock's deepest burial (porosity is not regained on uplift); basement below.", "note"));
  main.append(center, panel); shell.append(header, main); root.append(shell);

  const options = (seed: number): BasinOptions => {
    const [a, b] = faultSel.s.value.split(",").map(Number), [c, d] = thrustSel.s.value.split(",").map(Number);
    return { ...BASIN_DEFAULTS, seed, setting: settingSel.s.value as BasinOptions["setting"], faults: [a, b], thrusts: [c, d], compaction: compactSel.s.value === "on", overpressure: Number(opSel.s.value), carbonate: Number(carbSel.s.value) };
  };
  let batch: { basin: Basin; view: ReturnType<typeof windowOf>; canvas: HTMLCanvasElement }[] = [];
  let open: { basin: Basin; step: number } | undefined, playing = false;

  const color = (v: number) => (contrast ? turbo : terrain)((v - VRANGE[0]) / (VRANGE[1] - VRANGE[0]));
  /** Velocity, with bed and unit boundaries darkened and faults in red. */
  function paint(canvas: HTMLCanvasElement, view: ReturnType<typeof windowOf>, b: Basin, faults: { x: number[]; z: number[] }[]) {
    const width = Math.max(200, Math.round(canvas.clientWidth * devicePixelRatio)), height = Math.round(width * GNZ / GNX);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const c = canvas.getContext("2d")!, image = new ImageData(view.nx, view.nz);
    for (let k = 0; k < view.nz; k++) for (let i = 0; i < view.nx; i++) {
      const n = k * view.nx + i, rgb = color(view.velocity[n]);
      let shade = 1;
      if (showBeds && k + 1 < view.nz) {
        const a = view.beds[n], below = view.beds[n + view.nx];
        if (a !== below && a >= 0 && below >= 0) shade = b.beds[a].unit !== b.beds[below].unit ? 0.55 : 0.85;
        else if (a !== below && (a === WATER || below === BASEMENT || a === BASEMENT)) shade = 0.55;
      }
      image.data.set([255 * rgb[0] * shade, 255 * rgb[1] * shade, 255 * rgb[2] * shade, 255], 4 * n);
    }
    const off = new OffscreenCanvas(view.nx, view.nz); off.getContext("2d")!.putImageData(image, 0, 0);
    c.imageSmoothingEnabled = true; c.drawImage(off, 0, 0, width, height);
    if (showFaults) {
      c.strokeStyle = "rgba(220,40,40,0.95)"; c.lineWidth = Math.max(1.5, 1.4 * devicePixelRatio); c.beginPath();
      // Only where the fault cuts rock (not through the water above the sea floor).
      // and has rock above it (a thrust's upper flat along the sea floor is drawn once a thrust sheet covers it).
      const rockAt = (i: number, k: number) => i < 0 || i >= view.nx || k < 0 || k >= view.nz || view.beds[k * view.nx + i] !== WATER;
      const inRock = (x: number, z: number) => {
        const i = Math.round(x / WIDTH * (view.nx - 1)), k = Math.round(z / DEPTH * (view.nz - 1));
        return rockAt(i, k) && rockAt(i, k - 1);
      };
      for (const f of faults) {
        let drawing = false;
        f.x.forEach((x, p) => {
          const X = x / WIDTH * width, Z = f.z[p] / DEPTH * height;
          if (!inRock(x, f.z[p])) { drawing = false; return; }
          if (drawing) c.lineTo(X, Z); else c.moveTo(X, Z);
          drawing = true;
        });
      }
      c.stroke();
    }
  }
  function drawGallery() { for (const g of batch) paint(g.canvas, g.view, g.basin, g.basin.faults); }

  function build() {
    const first = Math.max(1, Math.round(Number(seedInput.value) || 1));
    gallery.replaceChildren(); batch = [];
    for (let s = 0; s < 6; s++) {
      const basin = simulate(options(first + s)), view = windowOf(basin), canvas = element("canvas"), card = element("div");
      canvas.style.cursor = "pointer"; canvas.onclick = () => openSection(first + s);
      card.append(canvas, element("p", `Seed ${first + s}, ${basin.setting}: ${basin.faults.length} ${basin.setting === "extension" ? "growth faults" : "thrusts"}, ${basin.checks.steps} steps, ${basin.beds.length} beds${basin.overpressure !== null ? ", overpressure" : ""}`, "note"));
      gallery.append(card); batch.push({ basin, view, canvas });
    }
    requestAnimationFrame(() => { drawGallery(); openSection(first); });
  }

  function openSection(seed: number) {
    const basin = simulate({ ...options(seed), record: true });
    open = { basin, step: basin.snapshots.length - 1 };
    slider.max = String(basin.snapshots.length - 1); slider.value = slider.max;
    const v = windowOf(basin).velocity; let lo = Infinity, hi = -Infinity; for (const x of v) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
    checks.textContent = `Checks: ${basin.checks.trapped === 0 ? "no water trapped below the sea floor" : `${basin.checks.trapped} trapped water cells filled from above`}; velocity ${lo.toFixed(0)}-${hi.toFixed(0)} m/s (within 1500-5600); simulated in ${(1000 * basin.checks.seconds).toFixed(0)} ms. Same seed, same section.`;
    const units = new Set(basin.beds.map((b) => b.unit)).size;
    const row = (k: string, val: string, note = "") => { const d = element("div"); d.append(element("span", k), element("b", val)); if (note) d.append(element("em", note)); return d; };
    const phases = [...new Set(basin.log.map((l) => l.phase))].map((p) => `${basin.log.filter((l) => l.phase === p).length} ${p}`).join(", ");
    const faultText = (f: Basin["faults"][number], n: number) => f.kind === "normal" ? `${n + 1}: dips ${f.dir > 0 ? "east" : "west"}, heave ${f.heave.toFixed(0)} m`
      : `${n + 1}: ramp ${(f.dip * 180 / Math.PI).toFixed(0)}°, moving ${f.thrust!.transport > 0 ? "east" : "west"}, slip ${f.heave.toFixed(0)} m, ${f.thrust!.emergent ? "to the sea floor" : "blind (upper flat)"}`;
    stats.replaceChildren(
      row("Seed", String(seed)), row("Setting", basin.setting, basin.options.setting === "any" ? "drawn for this seed" : "chosen"), row("Steps", String(basin.checks.steps), phases),
      row("Units, beds", `${units}, ${basin.beds.length}`), row(basin.setting === "extension" ? "Growth faults" : "Thrusts", String(basin.faults.length), basin.faults.map(faultText).join("; ")),
      row("Overpressure", basin.overpressure !== null ? `below ${basin.overpressure.toFixed(0)} m` : "none", "under the sea floor"), row("Basement", `${basement(basin)} m/s`));
    drawBig();
  }
  const basement = (b: Basin) => b.basementVelocity.toFixed(0);

  function drawBig() {
    if (!open) return;
    const b = open.basin, snap = b.snapshots[open.step], view = windowOf(b, snap);
    paint(big, view, b, snap.faults);
    title.textContent = `Section, seed ${b.options.seed}${open.step < b.snapshots.length - 1 ? ` (after step ${open.step + 1} of ${b.snapshots.length})` : " (today)"}`;
    const entry = b.log[open.step];
    stepLabel.textContent = `step ${open.step + 1} / ${b.snapshots.length} · ${entry.phase}`;
    logLine.textContent = `Step ${open.step + 1} (${entry.phase}): ${entry.text}.`;
    const ramp = element("i", "", "ramp fwi2d-ramp");
    if (contrast) ramp.style.background = `linear-gradient(90deg, ${Array.from({ length: 9 }, (_, k) => `rgb(${turbo(k / 8).map((x) => Math.round(255 * x)).join(",")})`).join(", ")})`;
    legend.replaceChildren(element("span", `${VRANGE[0]} m/s`), ramp, element("span", `${VRANGE[1]} m/s`), element("span", "Unit boundaries dark, bed boundaries light, faults red; velocity at each rock's deepest burial up to that step", "note"));
    drawProfile(view);
  }
  function drawProfile(view: ReturnType<typeof windowOf>) {
    const width = Math.max(200, Math.round(profile.clientWidth * devicePixelRatio)), height = Math.round(width * GNZ / GNX);
    if (profile.width !== width || profile.height !== height) { profile.width = width; profile.height = height; }
    const c = profile.getContext("2d")!, pad = 8 * devicePixelRatio;
    c.fillStyle = "#f6efe3"; c.fillRect(0, 0, width, height);
    const X = (v: number) => pad + (width - 2 * pad) * (v - 1400) / (5600 - 1400), Y = (k: number) => pad + (height - 2 * pad) * k / (view.nz - 1);
    c.strokeStyle = "rgba(122,110,99,0.35)"; c.lineWidth = devicePixelRatio;
    for (let v = 2000; v < 5600; v += 1000) { c.beginPath(); c.moveTo(X(v), pad); c.lineTo(X(v), height - pad); c.stroke(); }
    ["#2a9db5", "#3b3530", "#ff7059"].forEach((col, j) => {
      const i = Math.round([2000, 4600, 7200][j] / WIDTH * (view.nx - 1));
      c.strokeStyle = col; c.lineWidth = 1.5 * devicePixelRatio; c.beginPath();
      for (let k = 0; k < view.nz; k++) { const v = view.velocity[k * view.nx + i]; if (k) c.lineTo(X(v), Y(k)); else c.moveTo(X(v), Y(k)); }
      c.stroke();
    });
    c.fillStyle = "#7a6e63"; c.font = `${11 * devicePixelRatio}px sans-serif`;
    c.fillText("1400-5600 m/s across (grid every 1000), 0-3 km down; blue 2 km, dark 4.6 km, coral 7.2 km", pad, height - pad);
  }
  slider.oninput = () => { if (open) { open.step = Number(slider.value); drawBig(); } };
  async function replay() {
    if (!open || playing) return;
    playing = true;
    for (let s = 0; s < open.basin.snapshots.length; s++) { open.step = s; slider.value = String(s); drawBig(); await new Promise((r) => setTimeout(r, 350)); }
    playing = false;
  }

  async function runChecks() {
    runVerify.disabled = true;
    const n = Number(countSel.value), first = Math.max(1, Math.round(Number(seedInput.value) || 1));
    const r = await verify(options(first), first, n, (done) => { vNote.textContent = `Simulating and measuring: ${done}`; });
    vNote.textContent = `${r.sections} sections from seed ${first}: ${r.settings.extension} extension, ${r.settings.compression} compression. The known-answer tests use their own seeds.`;
    drawVerification(r); runVerify.disabled = false;
  }
  function drawVerification(r: Verification) {
    // The velocity chart: depth down (0-3 km below the sea floor), velocity across.
    const width = Math.max(200, Math.round(vChart.clientWidth * devicePixelRatio)), height = Math.round(width * GNZ / GNX);
    vChart.width = width; vChart.height = height;
    const c = vChart.getContext("2d")!, pad = 8 * devicePixelRatio, X = (v: number) => pad + (width - 2 * pad) * (v - 1400) / (5600 - 1400), Y = (d: number) => pad + (height - 2 * pad) * d / DEPTH;
    c.fillStyle = "#f6efe3"; c.fillRect(0, 0, width, height);
    c.strokeStyle = "rgba(122,110,99,0.35)"; c.lineWidth = devicePixelRatio;
    for (let v = 2000; v < 5600; v += 1000) { c.beginPath(); c.moveTo(X(v), pad); c.lineTo(X(v), height - pad); c.stroke(); }
    const d = r.velocity.depth;
    c.fillStyle = "rgba(42,157,181,0.25)"; c.beginPath();
    d.forEach((z, k) => (k ? c.lineTo(X(r.velocity.p10[k]), Y(z)) : c.moveTo(X(r.velocity.p10[k]), Y(z))));
    for (let k = d.length - 1; k >= 0; k--) c.lineTo(X(r.velocity.p90[k]), Y(d[k]));
    c.fill();
    const line = (f: (z: number) => number, color: string, upto: number, dash = false) => {
      c.strokeStyle = color; c.lineWidth = 1.6 * devicePixelRatio; c.setLineDash(dash ? [5 * devicePixelRatio, 4 * devicePixelRatio] : []); c.beginPath();
      for (let z = 0; z <= upto; z += 25) { if (z) c.lineTo(X(f(z)), Y(z)); else c.moveTo(X(f(z)), Y(z)); }
      c.stroke(); c.setLineDash([]);
    };
    line((z) => { let k = Math.min(d.length - 1, Math.floor(z / 100)); return r.velocity.p50[k]; }, "#2a9db5", DEPTH - 50);
    line((z) => hamilton1979(z / 1000), "#ff7059", 1000);
    line((z) => hamilton1985(z / 1000), "#3b3530", 1000, true);
    c.fillStyle = "#7a6e63"; c.font = `${11 * devicePixelRatio}px sans-serif`;
    c.fillText("1400-5600 m/s across, 0-3 km below the sea floor down; blue: simulated median and 10-90%; coral: Hamilton 1979 turbidites; dashed: Hamilton 1985 DSDP terrigenous (both to 1 km)", pad, height - pad);
    // The table.
    const row = (k: string, v: string, note: string, verdict: string) => { const el = element("div"); el.append(element("span", k), element("b", v), element("em", `${note} · ${verdict}`)); return el; };
    const band = (v: number[], digits = 2) => v.length ? `${percentile(v, 0.5).toFixed(digits)} (${percentile(v, 0.1).toFixed(digits)}-${percentile(v, 0.9).toFixed(digits)})` : "none measured";
    const vAt = (z: number) => r.velocity.p50[Math.min(r.velocity.depth.length - 1, Math.floor(z / 100))];
    const near = (sim: number, ref: number) => { const e = (sim - ref) / ref; return `${e >= 0 ? "+" : ""}${(100 * e).toFixed(0)}% against Hamilton 1979`; };
    const within = (x: number, lo: number, hi: number) => (x >= lo && x <= hi ? "within" : x < lo ? "below" : "above");
    const eiD = percentile(r.expansion.during, 0.5), eiB = percentile(r.expansion.before, 0.5), slip = percentile(r.rates.slip, 0.5), sed = percentile(r.rates.sedimentation, 0.5), sub = percentile(r.rates.subsidence, 0.5);
    vTable.replaceChildren(
      row("Velocity 0.5 km below the sea floor", `${vAt(500).toFixed(0)} m/s`, `Hamilton 1979: ${hamilton1979(0.5).toFixed(0)}, 1985: ${hamilton1985(0.5).toFixed(0)} (deep-sea sediments)`, near(vAt(500), hamilton1979(0.5))),
      row("Velocity 1 km below the sea floor", `${vAt(1000).toFixed(0)} m/s`, `Hamilton 1979: ${hamilton1979(1).toFixed(0)}, 1985: ${hamilton1985(1).toFixed(0)}`, near(vAt(1000), hamilton1979(1))),
      row("Expansion index, units deposited while the fault slipped", band(r.expansion.during), `growth faults: above 1 (examples 1.0-1.5; a classic Gulf Coast fault 1.45)`, Number.isFinite(eiD) ? (eiD > 1.02 ? `${within(eiD, 1, 1.6)} the examples` : "no growth: wrong") : "not measured"),
      row("Expansion index, units deposited before the fault", band(r.expansion.before), "no growth expected: about 1", Number.isFinite(eiB) ? (Math.abs(eiB - 1) < 0.1 ? "as expected" : "off") : "not measured"),
      row("Chord between cutoffs grows for older units", `${r.throwGrows.growing} of ${r.throwGrows.faults} faults`, "not conserved on a listric fault under vertical shear (deeper cutoffs slide along flatter fault): kept for the record", r.throwGrows.faults ? (r.throwGrows.growing >= 0.7 * r.throwGrows.faults ? "mostly" : "often not (expected)") : "not measured"),
      row("Heave between cutoffs grows for older units", `${r.heaveGrows.growing} of ${r.heaveGrows.faults} faults`, "implementation check: vertical shear conserves heave, so near all faults", r.heaveGrows.faults ? (r.heaveGrows.growing >= 0.9 * r.heaveGrows.faults ? "as expected" : "too few: a bug or the measurement") : "not measured"),
      row("  the faults failing it", `${r.heaveFailures.crossed} crossed, ${r.heaveFailures.edge} at an edge, ${r.heaveFailures.nested} nested, ${r.heaveFailures.antithetic} antithetic, ${r.heaveFailures.other} other`, "crossed by another fault anywhere in the simulated grid; top within 1 km of a side; nested inside another fault's hanging wall (category added after looking at the failures); dipping west; none of these", r.heaveFailures.other === 0 ? "all explained" : r.heaveFailures.other <= 2 ? "nearly all explained" : "unexplained: look for a bug"),
      row("Known-answer test: one fault, no erosion, no folds, no compaction (20 m grid)", `${r.kinematics.within} of ${r.kinematics.units} units within 40 m`, `measured heave between each unit's cutoffs against the heave applied after it was deposited; mean error ${r.kinematics.mean.toFixed(1)} m, worst ${r.kinematics.worst.toFixed(0)} m`, r.kinematics.units && r.kinematics.within === r.kinematics.units ? "kinematics right" : "fails the 40 m rule"),
      row("  the same on a 10 m grid", `${r.kinematics.fine.within} of ${r.kinematics.fine.units} units within 40 m`, `mean error ${r.kinematics.fine.mean.toFixed(1)} m, worst ${r.kinematics.fine.worst.toFixed(0)} m; a rounding error roughly halves with the cell, a bug does not`, r.kinematics.fine.mean < 0.6 * r.kinematics.mean && r.kinematics.fine.worst < 0.6 * r.kinematics.worst ? "error halves with the grid: rounding, not a bug" : r.kinematics.worst === 0 ? "exact" : "does not shrink: look for a bug"),
      row("Known-answer test: compaction, solid kept in each bed", `${(100 * r.compaction.worstSolid).toExponential(1)}% worst, ${r.compaction.beds} beds`, "no faults or erosion: every bed keeps the solid grains it was deposited with", r.compaction.beds ? (r.compaction.worstSolid < 1e-8 ? "kept" : "LOST: a bug") : "not measured"),
      row("Known-answer test: compaction, bed thickness against the decompaction equation", `${r.compaction.within} of ${r.compaction.runs} beds within one cell (20 m)`, `each bed in every tenth column: its thickness against the one its solid has at its depth (Sclater and Christie curves); mean error ${r.compaction.mean.toFixed(1)} m, worst ${r.compaction.worst.toFixed(0)} m`, r.compaction.runs && r.compaction.within >= 0.95 * r.compaction.runs && Math.abs(r.compaction.mean) <= 5 ? "compaction right" : "fails the rule (95% within a cell, mean within 5 m)"),
      row("Known-answer test: thrust, rock against the flow applied at once (20 m grid)", r.thrust.cells ? `${(100 * r.thrust.matched / r.thrust.cells).toFixed(2)}% of ${r.thrust.cells} cells` : "none", "one thrust, no erosion, uniform subsidence, no compaction: hanging-wall cells of pre-thrust beds (2 cells from bed boundaries and the fault) hold the bed that fault-parallel flow by the total slip puts there", r.thrust.cells ? (r.thrust.matched >= 0.99 * r.thrust.cells ? "kinematics right" : "fails the 99% rule") : "not measured"),
      row("  the same on a 10 m grid", r.thrust.fine.cells ? `${(100 * r.thrust.fine.matched / r.thrust.fine.cells).toFixed(2)}% of ${r.thrust.fine.cells} cells` : "none", "a rounding error shrinks with the cell, a bug does not", r.thrust.fine.cells ? (r.thrust.fine.matched >= 0.99 * r.thrust.fine.cells ? "kinematics right" : "fails the 99% rule") : "not measured"),
      row("Known-answer test: thrust backlimb dip minus ramp dip", r.thrust.dips.length ? `${band(r.thrust.dips, 1)}°, ${r.thrust.dips.filter((d) => Math.abs(d) <= 2).length} of ${r.thrust.dips.length} units within 2°` : "none measured", "fault-bend folding (Suppe 1983): beds carried from the lower flat onto the ramp dip as the ramp", r.thrust.dips.length ? (r.thrust.dips.filter((d) => Math.abs(d) <= 2).length >= 0.9 * r.thrust.dips.length ? "as fault-bend folding" : "fails the rule (90% within 2°)") : "not measured"),
      row("Physics: rock kept by each thrust slip (known-answer runs)", `${(100 * r.thrust.area).toFixed(2)}% worst`, "fault-parallel flow keeps area (a balanced section: Dahlstrom 1969); counted with the rock entering at the hinterland edge and leaving above sea level or at the foreland edge", r.thrust.area < 0.02 ? "kept" : "LOST: a bug"),
      row("Throw grows with depth within growth units", `${r.growthThrow.growing} of ${r.growthThrow.faults} faults`, "the literature's growth-fault form (units deposited while the fault slipped)", r.growthThrow.faults ? (r.growthThrow.growing >= 0.7 * r.growthThrow.faults ? "mostly, as expected" : "often not") : "not measured"),
      row("Fault dip, sea floor to 1 km below", band(r.dips, 0) + "°", "Anderson-Byerlee 60-65°, most seismogenic normal faults 30-60°, coal measures ~70°", r.dips.length ? `${within(percentile(r.dips, 0.5), 30, 70)} 30-70°` : "not measured"),
      row("Fault slip rate", `${band(r.rates.slip, 3)} mm/yr`, "0.03-0.2 mature rifts (North Sea); 1-7 young fast rifts (Corinth)", Number.isFinite(slip) ? `${within(slip, 0.03, 7)} 0.03-7` : "not measured"),
      row("Sedimentation rate (thickest per step)", `${band(r.rates.sedimentation, 3)} mm/yr`, "<0.05 starved hanging walls; 0.03-0.3 depocentres; ~1 fed margins", Number.isFinite(sed) ? `${within(sed, 0.03, 1)} 0.03-1` : "not measured"),
      row("Subsidence rate (mean per step)", `${band(r.rates.subsidence, 3)} mm/yr`, "~0.01-0.13 mature margins; ~0.1-1 filled depocentres (Myr averages)", Number.isFinite(sub) ? `${within(sub, 0.01, 1)} 0.01-1` : "not measured"),
      row("Physics: rock kept by each slip (all sections)", `${(100 * r.physics.area).toFixed(2)}% worst`, "vertical shear and fault-parallel flow keep area; the grid's rounding only", r.physics.area < 0.02 ? "kept" : "LOST: a bug"),
      row("Physics: water cells trapped below the sea floor; same seed, same section", `${r.physics.trapped}; ${r.physics.deterministic ? "yes" : "NO"}`, "0 by construction; a few are cell rounding at fault scarps (filled)", !r.physics.deterministic ? "NOT deterministic: a bug" : r.physics.trapped === 0 ? "as expected" : r.physics.trapped <= 5 * r.sections ? "rounding only" : "too many: a bug"),
      row("Compression: total thrust slip per section", r.compression.slip.length ? `${band(r.compression.slip, 1)} km` : "no compression sections", "drawn: 0.6-2.4 km per thrust, 1-3 thrusts", "for the record"),
      row("Velocity inversions (share of window columns)", `extension ${band(r.compression.inversions.extension)}, compression ${band(r.compression.inversions.compression)}`, "a drop of 300 m/s below faster rock: thrust sheets carry deeper-buried, faster rock over younger rock; overpressure in both", "for the record"),
      row("Inputs taken from the literature (not tested here)", "porosity, velocity, thermal decay", `Sclater and Christie (shale ${COMPACTION.shale.phi0}, ${COMPACTION.shale.L} m; sand ${COMPACTION.sand.phi0}, ${COMPACTION.sand.L} m), also for the compaction of bed thickness (solid kept); velocity at each rock's deepest burial (Japsen); soft-sand model (Dvorkin and Nur 1996) cementing into Raymer-Hunt-Gardner; Wood; tau ${THERMAL_TAU} Myr; thrust ramps 18-32° (Andersonian thrusts near 30°)`, "by construction"),
    );
  }

  // The reference, a 461 x 151 float32 grid at 20 m (if present).
  for (const [name, canvas] of [["marmousi", refA]] as const) {
    try {
      const r = await fetch(`/reference/${name}_truth20.f32`);
      if (!r.ok) continue;
      const v = new Float32Array(await r.arrayBuffer()), width = Math.max(200, Math.round(canvas.clientWidth * devicePixelRatio)), height = Math.round(width * GNZ / GNX);
      canvas.width = width; canvas.height = height;
      const image = new ImageData(GNX, GNZ); for (let n = 0; n < GNX * GNZ; n++) { const rgb = color(v[n]); image.data.set([255 * rgb[0], 255 * rgb[1], 255 * rgb[2], 255], 4 * n); }
      const off = new OffscreenCanvas(GNX, GNZ); off.getContext("2d")!.putImageData(image, 0, 0); canvas.getContext("2d")!.drawImage(off, 0, 0, width, height);
    } catch { /* the references are optional */ }
  }
  new ResizeObserver(() => { drawBig(); drawGallery(); }).observe(big);
  build();
}
