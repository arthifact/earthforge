// Earth Forge as one screen: the section as large as the window allows (with distance and depth axes, a velocity
// log on the same depth axis, a readout under the pointer, and its history to replay), the settings in a side panel,
// and How to use, Gallery, Checks and About in dialogs. Sections are simulated in a pool of workers (in parallel, off
// the page's thread); the checks in a worker of their own.

import { BASIN_DEFAULTS, type BasinOptions } from "./basin";
import { hamilton1979, hamilton1985, type Verification } from "./basinVerify";
import { checkRows } from "./checks";
import type { Frame, Reply, Request, Section } from "./protocol";
import { ACCENT, INK, lithologyLegend, LOG_COLUMNS, paintLog, paintSection, paintVelocityBand, paletteCss, SECTION_PAD, TRUE_RATIO, VRANGE, type Look, type Placement } from "./render";
import { DEPTH, WIDTH } from "./window";

// ---------------------------------------------------------------- workers

type NoId<T> = T extends unknown ? Omit<T, "id"> : never;
type Job = { group: string; req: Request; resolve: (r: Reply) => void; reject: (e: Error) => void; onProgress?: (t: string) => void; onPreview?: (s: Section) => void };
class Pool {
  private idle: Worker[] = [];
  private queue: Job[] = [];
  private running = new Map<number, Job>();
  private id = 1;
  constructor(size: number) {
    for (let k = 0; k < size; k++) {
      const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
      w.onmessage = (e: MessageEvent<Reply>) => this.reply(w, e.data);
      this.idle.push(w);
    }
  }
  run(req: NoId<Request>, opts: { group?: string; first?: boolean; onProgress?: (t: string) => void; onPreview?: (s: Section) => void } = {}): Promise<Reply> {
    return new Promise((resolve, reject) => {
      const job: Job = { group: opts.group ?? "", req: { ...req, id: this.id++ } as Request, resolve, reject, onProgress: opts.onProgress, onPreview: opts.onPreview };
      if (opts.first) this.queue.unshift(job); else this.queue.push(job);
      this.pump();
    });
  }
  /** Drop a group's jobs not yet started (a newer request replaces them). */
  clear(group: string) {
    const keep: Job[] = [];
    for (const j of this.queue) if (j.group === group) j.reject(new Error("stale")); else keep.push(j);
    this.queue = keep;
  }
  private pump() {
    while (this.idle.length && this.queue.length) {
      const w = this.idle.pop()!, job = this.queue.shift()!;
      this.running.set(job.req.id, job);
      w.postMessage(job.req);
    }
  }
  private reply(w: Worker, r: Reply) {
    const job = this.running.get(r.id);
    if (!job) return;
    if (r.kind === "progress") { job.onProgress?.(r.text); return; }
    if (r.kind === "preview") { job.onPreview?.(r.section); return; }
    this.running.delete(r.id); this.idle.push(w);
    if (r.kind === "error") job.reject(new Error(r.message)); else job.resolve(r);
    this.pump();
  }
}
const sections = new Pool(Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 1))), checker = new Pool(1);

// ---------------------------------------------------------------- markup

const LOGO = `<svg class="mark" viewBox="0 0 40 40" aria-hidden="true"><rect x="0.5" y="0.5" width="39" height="39" fill="none" stroke="currentColor"/><path d="M1 12 L19 12 M1 20 L17 20 M1 28 L15 28 M21 17 L39 16 M19 25 L39 24 M17 33 L39 32" stroke="currentColor" fill="none"/><path d="M25 1 L13 39" stroke="#a4462a" stroke-width="1.6" fill="none"/></svg>`;
const select = (id: string, label: string, options: [string, string][], wide = false) =>
  `<label class="field${wide ? " wide" : ""}"><span class="lbl">${label}</span><select id="${id}">${options.map(([v, t]) => `<option value="${v}">${t}</option>`).join("")}</select></label>`;
const dialog = (id: string, title: string, body: string, wide = false) =>
  `<dialog id="${id}" class="modal${wide ? " wide" : ""}" aria-labelledby="${id}-title"><div class="modal-in"><header class="modal-head"><h2 id="${id}-title">${title}</h2><button type="button" class="close" data-close aria-label="Close">×</button></header><div class="modal-body">${body}</div></div></dialog>`;

const HELP = `
  <ol class="steps">
    <li><b>A section</b> is one seed: a 9.2 × 3 km cross-section simulated forward in time. <kbd>New</kbd> (or <kbd>R</kbd>) draws another; typing a seed brings back exactly the same section.</li>
    <li><b>Settings</b> choose the geology: <i>extension</i> (growth faults), <i>compression</i> (thrusts) or <i>any</i> (drawn per seed), how many faults, compaction, overpressure and carbonates. The section updates as you change them.</li>
    <li><b>View</b>: velocity or lithology (sand, silt, shale, carbonate, basement); bed boundaries; faults (rust). <i>Fit</i> fills the screen with a vertical exaggeration (shown as VE at the top); <i>True scale</i> is 1:1.</li>
    <li><b>History</b>: drag the slider, press <kbd>←</kbd> <kbd>→</kbd>, or <kbd>Space</kbd> to replay how the section formed, step by step (each step 0.5–2 Myr).</li>
    <li><b>Log</b>: velocity with depth at the three columns marked by triangles on the section, on the same depth axis. Point at the section to read distance, depth, velocity and lithology.</li>
    <li><b>Gallery</b> (<kbd>G</kbd>) shows twelve seeds with the same settings; click one to open it.</li>
    <li><b>Checks</b> simulate many sections and measure them against the literature and against tests with exact answers.</li>
    <li><b>Share</b>: the address keeps the seed, the settings and the view.</li>
  </ol>`;
const ABOUT = `
  <p>Earth Forge builds subsurface velocity models from geological history. Each step, the ground subsides, faults slip, highs above wave base erode, sediment fills the space down to a base level, and buried beds compact; rock physics turns porosity and burial into velocity. The aim is a prior for full-waveform inversion that knows what real geology looks like, and data for training and testing.</p>
  <p class="lbl">Now</p>
  <p>Sedimentary basins, stretched (listric growth faults, vertical shear) or squeezed (thrusts with fault-parallel flow, fault-bend folds). Compaction of bed thickness; velocity at each rock's deepest burial; soft-sand rock physics cementing with depth; overpressure; carbonates.</p>
  <p class="lbl">Next</p>
  <p>A history of stages (stretch, salt, sag, squeeze), salt, the near surface and basement for land, volcanics, carbonate platforms, channels; conditioning on what is known or measured (first arrivals, wells); a coverage test against public models.</p>
  <p class="lbl">Made by</p>
  <p><a href="https://arthifact.com/">Gabriel I. Alonso</a>. Code and every check, with its history: <a href="https://github.com/arthifact/earthforge">github.com/arthifact/earthforge</a>.</p>`;
const CHECKS = `
  <p class="intro">Simulates sections with the current settings and measures velocity with depth against Hamilton's marine-sediment fits, growth-fault geometry, dips and rates; tests with exact answers check the kinematics and the compaction. Rules were written before each run.</p>
  <div class="run">${select("count", "Sections", [["20", "20"], ["40", "40"], ["100", "100"]])}<button type="button" class="btn" id="runChecks">Run</button><span class="mono progress" id="progress" aria-live="polite"></span></div>
  <div class="results" id="results" hidden>
    <div class="band"><canvas id="bandChart" aria-label="Simulated velocity with depth against Hamilton's fits"></canvas>
      <p class="key mono"><span><i class="swatch-band"></i>simulated 10–90%</span><span><i style="background:${ACCENT}"></i>median</span><span><i style="background:${INK}"></i>Hamilton 1979</span><span><i class="dash"></i>Hamilton 1985</span><span class="unit">depth below the sea floor, km</span></p></div>
    <div class="rows" id="rows"></div>
  </div>`;

export function start(root: HTMLElement) {
  root.innerHTML = `
  <div class="app">
    <header class="topbar">
      <a class="brand" href="./" aria-label="Earth Forge">${LOGO}<span>Earth Forge</span></a>
      <p class="crumb mono" id="title" aria-live="polite">–</p>
      <nav class="menu" aria-label="Menu">
        <button type="button" data-open="help">How to use</button><button type="button" data-open="gallery">Gallery</button><button type="button" data-open="checks">Checks</button><button type="button" data-open="about">About</button><a href="https://github.com/arthifact/earthforge" target="_blank" rel="noopener">GitHub ↗</a>
      </nav>
    </header>
    <main class="work">
      <section class="stage" aria-label="Section">
        <div class="plots" id="plots">
          <canvas id="section" aria-label="The simulated section"></canvas>
          <canvas id="log" aria-label="Velocity with depth at three columns"></canvas>
          <span class="busy" id="busy">Simulating</span>
        </div>
        <div class="under">
          <div class="legend" id="legend"></div>
          <p class="readout mono" id="readout">Point at the section to read values</p>
        </div>
        <div class="timeline">
          <button type="button" class="play" id="play" aria-label="Replay the history">▶</button>
          <input type="range" id="step" min="0" max="0" value="0" aria-label="Step of the history">
          <span class="mono" id="stepLabel"></span>
        </div>
        <p class="logline mono" id="logline" aria-live="polite"></p>
      </section>
      <aside class="side" aria-label="Settings">
        <section class="pane">
          <div class="seed"><label class="lbl" for="seed">Seed</label><input id="seed" type="number" min="1" step="1" inputmode="numeric"><button type="button" class="btn" id="random" title="Another seed (R)">New</button></div>
          <div class="grid2">
            ${select("setting", "Setting", [["any", "Any (drawn per seed)"], ["extension", "Extension: growth faults"], ["compression", "Compression: thrusts"]], true)}
            ${select("faults", "Growth faults", [["2,4", "2–4"], ["1,2", "1–2"], ["4,7", "4–7"], ["0,0", "None"]])}
            ${select("thrusts", "Thrusts", [["1,3", "1–3"], ["1,1", "1"], ["2,4", "2–4"], ["0,0", "None"]])}
            ${select("compaction", "Compaction", [["on", "On"], ["off", "Off"]])}
            ${select("overpressure", "Overpressure", [["0.35", "1 in 3"], ["0", "Never"], ["1", "Always"]])}
            ${select("carbonate", "Carbonates", [["0.1", "Rare"], ["0", "None"], ["0.3", "Common"]])}
          </div>
        </section>
        <section class="pane">
          <div class="segmented" role="group" aria-label="Show"><button type="button" data-view="velocity">Velocity</button><button type="button" data-view="lithology">Lithology</button></div>
          <div class="segmented" role="group" aria-label="Scale"><button type="button" data-scale="fit">Fit</button><button type="button" data-scale="true">True scale</button></div>
          <div class="toggles">
            <label><input type="checkbox" id="showBoundaries" checked> Boundaries</label>
            <label><input type="checkbox" id="showFaults" checked> Faults</label>
            <label><input type="checkbox" id="showTurbo"> Turbo</label>
          </div>
        </section>
        <section class="pane"><dl class="facts" id="facts"></dl></section>
      </aside>
    </main>
  </div>
  ${dialog("help", "How to use", HELP)}
  ${dialog("gallery", "Gallery", `<div class="gallery-bar mono"><button type="button" class="link" id="prev">← Previous</button><span id="range"></span><button type="button" class="link" id="next">Next →</button></div><div class="gallery" id="cards"></div>`, true)}
  ${dialog("checks", "Checks", CHECKS, true)}
  ${dialog("about", "About", ABOUT)}`;

  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const plots = $("plots"), canvas = $<HTMLCanvasElement>("section"), logCanvas = $<HTMLCanvasElement>("log"), slider = $<HTMLInputElement>("step");
  const seedInput = $<HTMLInputElement>("seed"), cards = $("cards");
  const fields = ["setting", "faults", "thrusts", "compaction", "overpressure", "carbonate"].map((id) => $<HTMLSelectElement>(id));

  // State, kept in the address (so a view can be shared). A first visit gets a random seed.
  const hash = new URLSearchParams(location.hash.slice(1));
  const randomSeed = () => 1 + Math.floor(Math.random() * 999999);
  let seed = Number(hash.get("seed")) > 0 ? Math.round(Number(hash.get("seed"))) : randomSeed(), first = Math.max(1, seed - (seed - 1) % 12);
  for (const s of fields) { const v = hash.get(s.id); if (v && [...s.options].some((o) => o.value === v)) s.value = v; }
  const look: Look = { view: hash.get("view") === "lithology" ? "lithology" : "velocity", palette: hash.get("colours") === "turbo" ? "turbo" : "earth", boundaries: true, faults: true };
  let scale: "fit" | "true" = hash.get("scale") === "true" ? "true" : "fit";
  let current: Section | null = null, step = 0, playing = false, generation = 0, placement: Placement | null = null, exaggeration = 1;

  const options = (s: number): BasinOptions => {
    const [fa, fb] = $<HTMLSelectElement>("faults").value.split(",").map(Number), [ta, tb] = $<HTMLSelectElement>("thrusts").value.split(",").map(Number);
    return { ...BASIN_DEFAULTS, seed: s, setting: $<HTMLSelectElement>("setting").value as BasinOptions["setting"], faults: [fa, fb], thrusts: [ta, tb], compaction: $<HTMLSelectElement>("compaction").value === "on", overpressure: Number($<HTMLSelectElement>("overpressure").value), carbonate: Number($<HTMLSelectElement>("carbonate").value) };
  };
  const remember = () => {
    const p = new URLSearchParams({ seed: String(seed) });
    if (look.view !== "velocity") p.set("view", look.view);
    if (scale !== "fit") p.set("scale", scale);
    if (look.palette !== "earth") p.set("colours", look.palette);
    for (const s of fields) if (s.value !== s.options[0].value) p.set(s.id, s.value);
    history.replaceState(null, "", `#${p}`);
  };

  // ------------------------------------------------------------ layout and drawing
  /** Size the section and the log to the space: Fit fills the height (vertical exaggeration 1-4), True keeps 1:1. */
  function layout() {
    const W = plots.clientWidth, narrow = W < 640, logW = narrow ? W : Math.round(Math.min(180, Math.max(110, W * 0.14))), gap = narrow ? 0 : 12;
    const secW = narrow ? W : W - logW - gap, pad = SECTION_PAD, iw = secW - pad.l - pad.r, trueH = iw * TRUE_RATIO;
    let ih = trueH;
    // Stacked layouts (tablets, phones) scroll, so Fit there is a fixed exaggeration rather than the screen's height.
    if (narrow) ih = scale === "true" ? trueH : 2 * trueH;
    else if (matchMedia("(max-width: 860px)").matches) ih = scale === "true" ? trueH : 1.6 * trueH;
    else if (scale === "fit") ih = Math.min(4 * trueH, Math.max(trueH, plots.clientHeight - pad.t - pad.b));
    else ih = Math.min(trueH, plots.clientHeight - pad.t - pad.b);
    const width = scale === "true" && !narrow ? ih / TRUE_RATIO + pad.l + pad.r : secW;
    canvas.style.width = `${width}px`; canvas.style.height = `${ih + pad.t + pad.b}px`;
    logCanvas.style.width = `${logW}px`; logCanvas.style.height = narrow ? "190px" : `${ih + pad.t + pad.b}px`;
    exaggeration = ih / ((width - pad.l - pad.r) * TRUE_RATIO);
  }
  const frame = (): Frame | null => current ? (current.history.length && step < current.history.length - 1 ? current.history[step] : current.now) : null;
  function draw() {
    const f = frame();
    if (!f || !current) return;
    layout();
    placement = paintSection(canvas, f, look, current.unitOfBed, { columns: LOG_COLUMNS });
    const narrow = plots.clientWidth < 640;
    paintLog(logCanvas, f, narrow ? 26 : placement.top, narrow ? 162 : placement.height);
    const steps = current.log.length, at = current.history.length ? step : steps - 1, entry = current.log[at];
    $("stepLabel").textContent = `${String(at + 1).padStart(2, "0")} / ${steps} · ${entry.phase}`;
    $("logline").textContent = `${at === steps - 1 ? "Today. " : ""}Step ${at + 1}: ${entry.text}.`;
    $("title").textContent = `Seed ${current.seed} · ${current.setting} · ${scale === "true" ? "true scale" : `VE ${exaggeration.toFixed(1)}×`}`;
  }
  function drawLegend() {
    $("legend").innerHTML = look.view === "velocity"
      ? `<span class="mono">${VRANGE[0] / 1000}</span><span class="ramp" style="background:${paletteCss(look.palette)}"></span><span class="mono">${VRANGE[1] / 1000} km/s</span>`
      : lithologyLegend.map(([name, color]) => `<span class="swatch mono"><i style="background:${color}"></i>${name}</span>`).join("");
  }
  function drawFacts(s: Section) {
    const phases = [...new Set(s.log.map((l) => l.phase))].map((p) => `${s.log.filter((l) => l.phase === p).length} ${p}`).join(", ");
    const fault = (f: Section["faults"][number], n: number) => f.kind === "normal"
      ? `${n + 1}: dips ${f.dir > 0 ? "E" : "W"}, heave ${f.heave.toFixed(0)} m`
      : `${n + 1}: ramp ${(f.dip * 180 / Math.PI).toFixed(0)}°, to the ${f.transport > 0 ? "E" : "W"}, slip ${(f.heave / 1000).toFixed(1)} km${f.emergent ? ", emergent" : ", blind"}`;
    const row = (k: string, v: string) => `<div><dt>${k}</dt><dd>${v}</dd></div>`;
    $("facts").innerHTML = [
      row("Setting", s.setting + (s.options.setting === "any" ? " (drawn)" : "")),
      row("History", `${s.log.length} steps × ${s.dt.toFixed(1)} Myr`),
      row("Phases", phases),
      row("Beds", `${s.unitOfBed.length} in ${new Set(s.unitOfBed).size} units`),
      row(s.setting === "extension" ? "Faults" : "Thrusts", s.faults.length ? s.faults.map(fault).join("<br>") : "none"),
      row("Overpressure", s.overpressure !== null ? `below ${s.overpressure.toFixed(0)} m` : "none"),
      row("Basement", `${s.basementVelocity.toFixed(0)} m/s`),
      row("Simulated", `${(1000 * s.checks.seconds).toFixed(0)} ms`),
    ].join("");
  }
  /** Distance, depth, velocity and lithology under the pointer. */
  function readout(e: PointerEvent) {
    const f = frame();
    if (!f || !placement || !current) return;
    const r = canvas.getBoundingClientRect(), px = e.clientX - r.left - placement.left, py = e.clientY - r.top - placement.top;
    if (px < 0 || py < 0 || px > placement.width || py > placement.height) { $("readout").textContent = "Point at the section to read values"; return; }
    const x = px / placement.width * WIDTH, z = py / placement.height * DEPTH, i = Math.round(x / WIDTH * (f.nx - 1)), k = Math.round(z / DEPTH * (f.nz - 1)), n = k * f.nx + i, l = f.litho[n];
    const unit = () => `unit ${current!.unitOfBed[f.beds[n]] + 1}`;
    const what = l === -1 ? "water" : l === -2 ? "basement" : l === -3 ? `carbonate · ${unit()}` : `sand ${l.toFixed(2)} · ${unit()}`;
    $("readout").textContent = `x ${(x / 1000).toFixed(2)} km   z ${(z / 1000).toFixed(2)} km   ${f.velocity[n].toFixed(0)} m/s   ${what}`;
  }

  // ------------------------------------------------------------ simulation
  async function open(s: number) {
    seed = s; seedInput.value = String(s); remember(); stopPlaying();
    const mine = ++generation;
    $("busy").classList.add("on");
    try {
      // The section shows as soon as it is simulated; its history (one frame per step) follows.
      const preview = (sec: Section) => {
        if (mine !== generation) return;
        current = sec; step = 0; slider.max = "0"; slider.value = "0"; slider.disabled = true;
        drawFacts(sec); draw();
        $("busy").classList.remove("on");
      };
      sections.clear("main");
      const r = await sections.run({ kind: "section", options: options(s), history: true }, { group: "main", first: true, onPreview: preview });
      if (mine !== generation || r.kind !== "history" || !current) return;
      current.history = r.frames; step = Math.max(0, r.frames.length - 1);
      slider.max = String(step); slider.value = String(step); slider.disabled = false;
      draw();
    } catch (e) { if ((e as Error).message !== "stale") $("logline").textContent = `Could not simulate: ${(e as Error).message}`; }
    finally { if (mine === generation) $("busy").classList.remove("on"); }
  }
  let galleryGeneration = 0;
  function gallery() {
    const mine = ++galleryGeneration;
    sections.clear("gallery");
    $("range").textContent = `seeds ${first}–${first + 11}`;
    cards.innerHTML = Array.from({ length: 12 }, (_, k) => `<button type="button" class="card${first + k === seed ? " selected" : ""}" data-seed="${first + k}"><canvas></canvas><span class="caption mono"><b>${first + k}</b><span class="kind"></span></span></button>`).join("");
    [...cards.children].forEach((card, k) => {
      const s = first + k, el = card as HTMLElement & { section?: Section };
      el.addEventListener("click", () => { $<HTMLDialogElement>("gallery").close(); void open(s); });
      sections.run({ kind: "section", options: options(s), history: false }, { group: "gallery" }).then((r) => {
        if (mine !== galleryGeneration || r.kind !== "section") return;
        const sec = r.section, n = sec.faults.length;
        el.section = sec; el.classList.add("ready");
        paintSection(el.querySelector("canvas")!, sec.now, look, sec.unitOfBed);
        el.querySelector(".kind")!.textContent = `${sec.setting} · ${n} ${sec.setting === "extension" ? "fault" : "thrust"}${n === 1 ? "" : "s"}`;
      }).catch(() => undefined);
    });
  }
  const redrawCards = () => { for (const c of cards.children) { const sec = (c as HTMLElement & { section?: Section }).section; if (sec) paintSection(c.querySelector("canvas")!, sec.now, look, sec.unitOfBed); } };

  // ------------------------------------------------------------ history
  function stopPlaying() { playing = false; $("play").textContent = "▶"; $("play").setAttribute("aria-label", "Replay the history"); }
  async function play() {
    if (!current || playing || !current.history.length) { stopPlaying(); return; }
    playing = true; $("play").textContent = "❚❚"; $("play").setAttribute("aria-label", "Stop");
    for (step = step >= current.history.length - 1 ? 0 : step; playing && current && step < current.history.length; step++) {
      slider.value = String(step); draw();
      await new Promise((r) => setTimeout(r, 260));
    }
    if (current) { step = Math.min(step, current.history.length - 1); slider.value = String(step); }
    stopPlaying(); draw();
  }

  // ------------------------------------------------------------ checks
  let shown: Verification | null = null;
  async function runChecks() {
    const button = $<HTMLButtonElement>("runChecks"), n = Number($<HTMLSelectElement>("count").value);
    button.disabled = true; $("progress").textContent = "Starting";
    try {
      const r = await checker.run({ kind: "verify", options: options(seed), first: seed, count: n }, { onProgress: (t) => { $("progress").textContent = t; } });
      if (r.kind !== "verify") return;
      showChecks(r.result);
      $("progress").textContent = `${r.result.sections} sections from seed ${seed}: ${r.result.settings.extension} extension, ${r.result.settings.compression} compression`;
    } catch (e) { $("progress").textContent = `Failed: ${(e as Error).message}`; }
    finally { button.disabled = false; }
  }
  function showChecks(r: Verification) {
    shown = r;
    $("results").hidden = false;
    paintVelocityBand($<HTMLCanvasElement>("bandChart"), r.velocity, [{ f: (d) => hamilton1979(d / 1000), to: 1000, color: INK, dash: false }, { f: (d) => hamilton1985(d / 1000), to: 1000, color: INK, dash: true }]);
    let group = "";
    $("rows").innerHTML = checkRows(r).map((row) => {
      const head = row.group !== group ? `<h3 class="group lbl">${(group = row.group)}</h3>` : "";
      return `${head}<div class="row ${row.status}"><div class="what"><p class="name">${row.name}</p><p class="note">${row.note}</p></div><p class="value mono">${row.value}</p><p class="verdict mono"><span>${row.status === "pass" ? "Pass" : row.status === "fail" ? "Fails" : "Record"}</span>${row.verdict}</p></div>`;
    }).join("");
  }

  // ------------------------------------------------------------ wiring
  const press = (attr: string, value: string) => document.querySelectorAll<HTMLButtonElement>(`[${attr}]`).forEach((b) => b.setAttribute("aria-pressed", String(b.getAttribute(attr) === value)));
  press("data-view", look.view); press("data-scale", scale);
  $<HTMLInputElement>("showTurbo").checked = look.palette === "turbo";
  document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((b) => b.addEventListener("click", () => { look.view = b.dataset.view as Look["view"]; press("data-view", look.view); remember(); drawLegend(); draw(); redrawCards(); }));
  document.querySelectorAll<HTMLButtonElement>("[data-scale]").forEach((b) => b.addEventListener("click", () => { scale = b.dataset.scale as typeof scale; press("data-scale", scale); remember(); draw(); }));
  $<HTMLInputElement>("showBoundaries").addEventListener("change", (e) => { look.boundaries = (e.target as HTMLInputElement).checked; draw(); redrawCards(); });
  $<HTMLInputElement>("showFaults").addEventListener("change", (e) => { look.faults = (e.target as HTMLInputElement).checked; draw(); redrawCards(); });
  $<HTMLInputElement>("showTurbo").addEventListener("change", (e) => { look.palette = (e.target as HTMLInputElement).checked ? "turbo" : "earth"; remember(); drawLegend(); draw(); redrawCards(); });
  slider.addEventListener("input", () => { stopPlaying(); step = Number(slider.value); draw(); });
  $("play").addEventListener("click", () => void play());
  canvas.addEventListener("pointermove", readout);
  canvas.addEventListener("pointerdown", readout);
  canvas.addEventListener("pointerleave", () => { $("readout").textContent = "Point at the section to read values"; });
  const go = (s: number) => void open(Math.max(1, Math.round(s) || 1));
  seedInput.addEventListener("change", () => go(Number(seedInput.value)));
  $("random").addEventListener("click", () => go(randomSeed()));
  let timer = 0;
  for (const s of fields) s.addEventListener("change", () => { clearTimeout(timer); timer = window.setTimeout(() => { remember(); void open(seed); if ($<HTMLDialogElement>("gallery").open) gallery(); }, 60); });
  $("runChecks").addEventListener("click", () => void runChecks());
  $("prev").addEventListener("click", () => { first = Math.max(1, first - 12); gallery(); });
  $("next").addEventListener("click", () => { first += 12; gallery(); });

  // Dialogs: open from the menu, close with ×, Escape or a click outside.
  const openDialog = (id: string) => {
    const d = $<HTMLDialogElement>(id);
    if (d.open) return;
    if (id === "gallery") { first = Math.max(1, seed - (seed - 1) % 12); gallery(); }
    d.showModal();
    if (id === "checks" && shown) requestAnimationFrame(() => showChecks(shown!));
  };
  document.querySelectorAll<HTMLButtonElement>("[data-open]").forEach((b) => b.addEventListener("click", () => openDialog(b.dataset.open!)));
  document.querySelectorAll<HTMLDialogElement>("dialog").forEach((d) => {
    d.addEventListener("click", (e) => { if (e.target === d || (e.target as HTMLElement).closest("[data-close]")) d.close(); });
  });

  addEventListener("keydown", (e) => {
    if (document.querySelector("dialog[open]") || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.metaKey || e.ctrlKey || e.altKey) return;
    if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && current?.history.length) { e.preventDefault(); stopPlaying(); step = Math.max(0, Math.min(current.history.length - 1, step + (e.key === "ArrowLeft" ? -1 : 1))); slider.value = String(step); draw(); }
    else if (e.key === " ") { e.preventDefault(); void play(); }
    else if (e.key === "r" || e.key === "R") go(randomSeed());
    else if (e.key === "g" || e.key === "G") openDialog("gallery");
    else if (e.key === "?") openDialog("help");
  });
  let frameRequest = 0;
  new ResizeObserver(() => { cancelAnimationFrame(frameRequest); frameRequest = requestAnimationFrame(() => { draw(); if (shown && $<HTMLDialogElement>("checks").open) showChecks(shown); }); }).observe(plots);

  seedInput.value = String(seed);
  drawLegend();
  void open(seed);
}
