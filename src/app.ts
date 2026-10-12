// Earth Forge as one screen: the section at true scale and as large as the window allows (velocity, lithology, or
// both stacked on one distance axis; depth and distance axes in km, a linked velocity inspector, a readout
// under the pointer, and its history to replay), the settings in a side panel,
// and How to use, Gallery, Checks and About in dialogs. Sections are simulated in a pool of workers (in parallel, off
// the page's thread); the checks in a worker of their own.

import { BASIN_DEFAULTS, type BasinOptions } from "./basin";
import { hamilton1979, hamilton1985, type Verification } from "./basinVerify";
import { checkRows } from "./checks";
import type { Frame, Reply, Request, Section } from "./protocol";
import { ACCENT, INK, lithologyLegend, LOG_COLUMNS, LOG_LABELS, LOG_PAD, paintLog, paintSection, paintVelocityBand, paletteCss, profileMarkers, SECTION_PAD, TRUE_RATIO, VRANGE, type Look, type Placement, type LogView } from "./render";
import { DEPTH, H, WIDTH } from "./window";

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
    <li><b>View</b>: velocity, lithology (sand, silt, shale, carbonate, basement), or both stacked on the same distance axis; bed boundaries; faults (rust). Always at true scale (no vertical exaggeration).</li>
    <li><b>History</b>: drag the slider, press <kbd>←</kbd> <kbd>→</kbd>, or <kbd>Space</kbd> to replay how the section formed, step by step (each step 0.5–2 Myr).</li>
    <li><b>Velocity with depth</b>: start with one movable profile, A. Use <i>+ Compare</i> to add B and C, up to three profiles; remove a comparison with its × button. All added profiles appear together. Their starting positions simply span the section. Drag a letter on the model to move that profile horizontally. Drag a round dot up or down, or use the depth slider, to set the shared inspection depth. Clicking elsewhere leaves the profiles in place. <i>Reset positions</i> restores the starting positions. The compact legend shows each profile's velocity, rock type and position. Hovering over the section or graph reads local values without moving the inspection depth. Steps preserve the original grid values.</li>
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
  <p class="intro">Controlled tests check numerical correctness. Sections with your settings are screened against geological reference ranges; passing these guides does not establish accuracy at a real site. Validation against independent well logs and seismic data is still pending.</p>
  <div class="run">${select("count", "Sections", [["20", "20"], ["40", "40"], ["100", "100"]])}<button type="button" class="btn" id="runChecks">Run</button><span class="mono progress" id="progress" aria-live="polite"></span></div>
  <div class="results" id="results" hidden>
    <div class="band"><canvas id="bandChart" aria-label="Simulated velocity with depth against Hamilton's fits"></canvas>
      <p class="key mono"><span><i class="swatch-band"></i>simulated 10–90%</span><span><i style="background:${ACCENT}"></i>median</span><span><i style="background:${INK}"></i>Hamilton 1979</span><span><i class="dash"></i>Hamilton 1985</span><span class="unit">depth below the sea floor, km</span></p>
      <p class="note" id="bandCoverage"></p></div>
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
          <div class="panels"><canvas id="section" aria-label="The simulated section"></canvas><canvas id="section2" aria-label="The simulated section, lithology"></canvas></div>
          <section class="profile" id="profile" aria-labelledby="profileTitle">
            <canvas id="log" role="img" aria-label="Seismic velocity versus depth"></canvas>
            <div class="profile-controls">
              <div class="profile-depth"><label for="profileDepth">Depth</label><output id="profileDepthValue" for="profileDepth" class="mono" aria-live="off">1.50 km</output></div>
              <input type="range" id="profileDepth" min="0" max="${DEPTH}" step="20" value="1500" aria-label="Inspect profile depth">
              <div class="profile-head">
                <h2 id="profileTitle">Profiles</h2>
                <button type="button" class="link profile-add" id="addProfile" aria-label="Add comparison">+ Compare</button>
              </div>
              <div class="profile-rows" role="group" aria-label="Profile locations and velocities at the inspected depth">
                ${LOG_COLUMNS.map(([x, color], i) => `<div class="profile-row" data-profile-row="${i}" style="--profile-color:${color}"${i ? " hidden" : ""}>
                  <span class="profile-key" aria-label="Profile ${LOG_LABELS[i]}"><b>${LOG_LABELS[i]}</b><i class="trace-${i}" aria-hidden="true"></i></span>
                  <div class="profile-value"><output class="profile-velocity" id="profileVelocity${i}" aria-label="Velocity of profile ${LOG_LABELS[i]} in kilometres per second" aria-live="off">–</output><span aria-hidden="true">km/s</span></div>
                  ${i ? `<button type="button" class="profile-remove" data-remove-profile="${i}" aria-label="Remove profile ${LOG_LABELS[i]}" title="Remove profile ${LOG_LABELS[i]}">×</button>` : ""}
                  <span class="profile-material" id="profileMaterial${i}"></span>
                  <output class="profile-position" id="profilePosition${i}" aria-label="Position of profile ${LOG_LABELS[i]}" aria-live="off">Position ${(x / 1000).toFixed(2)} km</output>
                </div>`).join("")}
              </div>
            </div>
            <button type="button" class="link profile-reset" id="resetProfiles" disabled>Reset positions</button>
          </section>
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
        <div class="step-note" id="stepNote">
          <p class="logline mono" id="logline" aria-live="polite"></p>
          <button type="button" class="link step-details-toggle" id="stepDetailsToggle" aria-expanded="false" aria-controls="stepDetails" disabled>Details</button>
          <section class="step-details-panel" id="stepDetails" aria-label="Full step description" hidden>
            <button type="button" class="close" id="closeStepDetails" aria-label="Close step details">×</button>
            <p class="mono" id="stepDetailsText"></p>
          </section>
        </div>
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
          <div class="segmented" role="group" aria-label="Show"><button type="button" data-view="velocity">Velocity</button><button type="button" data-view="lithology">Lithology</button><button type="button" data-view="both">Both</button></div>
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
  const plots = $("plots"), canvas = $<HTMLCanvasElement>("section"), canvas2 = $<HTMLCanvasElement>("section2"), logCanvas = $<HTMLCanvasElement>("log"), slider = $<HTMLInputElement>("step");
  const profile = $("profile"), profileDepth = $<HTMLInputElement>("profileDepth");
  const stepNote = $("stepNote"), logline = $("logline"), stepDetails = $("stepDetails"), stepDetailsToggle = $<HTMLButtonElement>("stepDetailsToggle");
  const seedInput = $<HTMLInputElement>("seed"), cards = $("cards");
  const fields = ["setting", "faults", "thrusts", "compaction", "overpressure", "carbonate"].map((id) => $<HTMLSelectElement>(id));

  // State, kept in the address (so a view can be shared). A first visit gets a random seed.
  const hash = new URLSearchParams(location.hash.slice(1));
  const randomSeed = () => 1 + Math.floor(Math.random() * 999999);
  let seed = Number(hash.get("seed")) > 0 ? Math.round(Number(hash.get("seed"))) : randomSeed(), first = Math.max(1, seed - (seed - 1) % 12);
  for (const s of fields) { const v = hash.get(s.id); if (v && [...s.options].some((o) => o.value === v)) s.value = v; }
  const look: Look = { view: "velocity", palette: hash.get("colours") === "turbo" ? "turbo" : "earth", boundaries: true, faults: true };
  type Mode = "velocity" | "lithology" | "both";
  let mode: Mode = hash.get("view") === "velocity" || hash.get("view") === "lithology" ? hash.get("view") as Mode : "both";
  const topView = () => (mode === "lithology" ? "lithology" : "velocity") as Look["view"];
  let current: Section | null = null, step = 0, playing = false, generation = 0, placement: Placement | null = null;
  const savedProfiles = hash.get("profiles")?.split(",") ?? ["A"];
  const logView: LogView = { selected: 0, active: LOG_LABELS.flatMap((label, i) => i === 0 || savedProfiles.includes(label) ? [i] : []), depth: 1500 };
  const savedLocations = hash.get("locations")?.split(",").map(Number);
  const logColumns: [number, string][] = LOG_COLUMNS.map(([x, color], i) => [savedLocations?.length === 3 && Number.isFinite(savedLocations[i]) ? Math.round(Math.max(0, Math.min(WIDTH, savedLocations[i])) / H) * H : x, color]);
  const savedProfile = LOG_LABELS.indexOf(hash.get("profile") ?? "A");
  logView.selected = logView.active.includes(savedProfile) ? savedProfile : 0;
  let logPlacement: Placement | null = null;
  let hoveredDot: { canvas: HTMLCanvasElement; index: number } | null = null;

  const options = (s: number): BasinOptions => {
    const [fa, fb] = $<HTMLSelectElement>("faults").value.split(",").map(Number), [ta, tb] = $<HTMLSelectElement>("thrusts").value.split(",").map(Number);
    return { ...BASIN_DEFAULTS, seed: s, setting: $<HTMLSelectElement>("setting").value as BasinOptions["setting"], faults: [fa, fb], thrusts: [ta, tb], compaction: $<HTMLSelectElement>("compaction").value === "on", overpressure: Number($<HTMLSelectElement>("overpressure").value), carbonate: Number($<HTMLSelectElement>("carbonate").value) };
  };
  const remember = () => {
    const p = new URLSearchParams({ seed: String(seed) });
    if (mode !== "both") p.set("view", mode);
    if (look.palette !== "earth") p.set("colours", look.palette);
    if (logColumns.some(([x], i) => x !== LOG_COLUMNS[i][0])) p.set("locations", logColumns.map(([x]) => x).join(","));
    if (logView.selected !== 0) p.set("profile", LOG_LABELS[logView.selected]);
    if (logView.active.length > 1) p.set("profiles", logView.active.map((i) => LOG_LABELS[i]).join(","));
    for (const s of fields) if (s.value !== s.options[0].value) p.set(s.id, s.value);
    history.replaceState(null, "", `#${p}`);
  };

  // ------------------------------------------------------------ layout and drawing
  /**
   * Fit the inspector card to the visible model stack, with its controls below the graph.
   * Smaller layouts put the inspector underneath. The geological section always retains true scale.
   */
  function layout() {
    const W = plots.clientWidth, narrow = W < 900;
    plots.classList.toggle("profile-below", narrow);
    const pad = SECTION_PAD, ph = pad.t + pad.b, gapV = 10, logW = narrow ? W : 328;
    profile.style.width = `${logW}px`;
    let iw = W - (narrow ? 0 : logW + 20) - pad.l - pad.r;
    // Keep a fixed footer for Reset outside the card, including when it is invisible.
    const availableHeight = plots.clientHeight - parseFloat(getComputedStyle(plots).paddingBottom);
    // Fit against two models in every mode, so switching views never resizes the inspector.
    if (!narrow) iw = Math.min(iw, Math.max(200, (availableHeight - 2 * ph - gapV) / 2) / TRUE_RATIO);
    iw = Math.max(120, iw);
    const sectionHeight = iw * TRUE_RATIO + ph;
    const width = `${iw + pad.l + pad.r}px`, height = `${sectionHeight}px`;
    for (const c of [canvas, canvas2]) { c.style.width = width; c.style.height = height; }
    canvas2.hidden = mode !== "both";
    // The graph retains the full stack height, minus its compact controls, in every view.
    // Align the card with the top image border and the bottom of the model stack.
    const cardTop = narrow ? 0 : pad.t;
    profile.style.marginTop = `${cardTop}px`;
    profile.classList.toggle("fit-stack", !narrow);
    profile.style.height = !narrow ? `${2 * sectionHeight + gapV - cardTop}px` : "auto";
    logCanvas.style.width = "100%";
    logCanvas.style.height = `${(narrow ? 300 : iw * TRUE_RATIO) + LOG_PAD.t + LOG_PAD.b}px`;
  }
  const frame = (): Frame | null => current ? (current.history.length && step < current.history.length - 1 ? current.history[step] : current.now) : null;
  function draw() {
    const f = frame();
    if (!f || !current) return;
    layout();
    drawProfiles(f);
    const steps = current.log.length, at = current.history.length ? step : steps - 1, entry = current.log[at];
    $("stepLabel").textContent = `${String(at + 1).padStart(2, "0")} / ${steps} · ${entry.phase}`;
    drawStepNote(`${at === steps - 1 ? "Today. " : ""}Step ${at + 1}: ${entry.text}.`);
    $("title").textContent = `Seed ${current.seed} · ${current.setting} · true scale`;
  }
  const rockName = (l: number) => l === -1 ? "Water" : l === -2 ? "Basement" : l === -3 ? "Carbonate" : l < 0.33 ? "Shale-rich sediment" : l < 0.66 ? "Silty sediment" : "Sand-rich sediment";
  function drawProfileControls() {
    document.querySelectorAll<HTMLElement>("[data-profile-row]").forEach((row) => {
      const i = Number(row.dataset.profileRow);
      row.hidden = !logView.active.includes(i);
      const position = (logColumns[i][0] / 1000).toFixed(2);
      $(`profilePosition${i}`).textContent = `Position ${position} km`;
    });
    const add = $<HTMLButtonElement>("addProfile");
    add.disabled = logView.active.length === LOG_LABELS.length;
    $<HTMLButtonElement>("resetProfiles").disabled = !logColumns.some(([x], i) => logView.active.includes(i) && x !== LOG_COLUMNS[i][0]);
    profile.classList.toggle("comparing", logView.active.length > 1);
  }
  function drawProfiles(f: Frame) {
    if (!current) return;
    const axes = { columns: logColumns, ...logView };
    placement = paintSection(canvas, f, { ...look, view: topView() }, current.unitOfBed, { ...axes, title: mode === "both" ? "Velocity" : undefined, hoveredDot: hoveredDot?.canvas === canvas ? hoveredDot.index : undefined });
    if (mode === "both") paintSection(canvas2, f, { ...look, view: "lithology" }, current.unitOfBed, { ...axes, sharedDistance: true, hoveredDot: hoveredDot?.canvas === canvas2 ? hoveredDot.index : undefined });
    profileDepth.value = String(logView.depth);
    $("profileDepthValue").textContent = `${(logView.depth / 1000).toFixed(2)} km`;
    drawProfileControls();
    const k = Math.round(logView.depth / DEPTH * (f.nz - 1));
    const descriptions: string[] = [];
    logColumns.forEach(([x], i) => {
      if (!logView.active.includes(i)) return;
      const index = k * f.nx + Math.round(x / WIDTH * (f.nx - 1)), l = f.litho[index];
      const unit = f.beds[index] >= 0 ? ` · unit ${current!.unitOfBed[f.beds[index]] + 1}` : "";
      const material = `${rockName(l)}${unit}`;
      descriptions.push(`${LOG_LABELS[i]}: ${(f.velocity[index] / 1000).toFixed(2)} kilometres per second, ${material}`);
      $(`profileVelocity${i}`).textContent = (f.velocity[index] / 1000).toFixed(2);
      const materialLabel = $(`profileMaterial${i}`);
      materialLabel.textContent = `${l < 0 ? rockName(l) : l < 0.33 ? "Shale" : l < 0.66 ? "Silt" : "Sand"}${unit}`;
      materialLabel.title = material;
      materialLabel.setAttribute("aria-label", material);
    });
    profileDepth.setAttribute("aria-valuetext", `${(logView.depth / 1000).toFixed(2)} kilometres depth. ${descriptions.join("; ")}`);
    logCanvas.setAttribute("aria-label", `Seismic velocity versus depth, ${logView.active.length > 1 ? "profiles" : "profile"} ${logView.active.map((i) => LOG_LABELS[i]).join(", ")}. Depth increases downward from 0 to ${DEPTH / 1000} km; velocity increases to the right from ${VRANGE[0] / 1000} to ${VRANGE[1] / 1000} km/s.`);
    // Row visibility and text affect the graph's available height.
    logPlacement = paintLog(logCanvas, f, logView, logColumns);
  }
  function inspectDepth(depth: number) {
    const f = frame();
    if (!f) return;
    const dz = DEPTH / (f.nz - 1);
    const nextDepth = Math.round(Math.max(0, Math.min(DEPTH, depth)) / dz) * dz;
    if (nextDepth === logView.depth) return;
    logView.depth = nextDepth;
    drawProfiles(f);
  }
  function moveProfile(x: number) {
    const f = frame();
    if (!f || !Number.isFinite(x)) return;
    const dx = WIDTH / (f.nx - 1);
    logColumns[logView.selected][0] = Math.round(Math.max(0, Math.min(WIDTH, x)) / dx) * dx;
    drawProfiles(f);
  }
  function drawLegend() {
    const ramp = `<span class="mono">${VRANGE[0] / 1000}</span><span class="ramp" style="background:${paletteCss(look.palette)}"></span><span class="mono">${VRANGE[1] / 1000} km/s</span>`;
    const swatches = lithologyLegend.map(([name, color]) => `<span class="swatch mono"><i style="background:${color}"></i>${name}</span>`).join("");
    $("legend").innerHTML = mode === "velocity" ? ramp : mode === "lithology" ? swatches : `${ramp}<span class="sep"></span>${swatches}`;
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
    const r = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect(), px = e.clientX - r.left - placement.left, py = e.clientY - r.top - placement.top;
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
        paintSection(el.querySelector("canvas")!, sec.now, { ...look, view: topView() }, sec.unitOfBed);
        el.querySelector(".kind")!.textContent = `${sec.setting} · ${n} ${sec.setting === "extension" ? "fault" : "thrust"}${n === 1 ? "" : "s"}`;
      }).catch(() => undefined);
    });
  }
  const redrawCards = () => { for (const c of cards.children) { const sec = (c as HTMLElement & { section?: Section }).section; if (sec) paintSection(c.querySelector("canvas")!, sec.now, { ...look, view: topView() }, sec.unitOfBed); } };

  // ------------------------------------------------------------ history
  function closeStepDetails(restoreFocus = false) {
    stepDetails.hidden = true;
    stepDetailsToggle.setAttribute("aria-expanded", "false");
    if (restoreFocus) stepDetailsToggle.focus();
  }
  function drawStepNote(text: string) {
    if (logline.textContent !== text) {
      closeStepDetails();
      logline.textContent = text;
      $("stepDetailsText").textContent = text;
    }
    // The action keeps its space when hidden, so overflow checks cannot shift the layout.
    stepDetailsToggle.disabled = logline.scrollWidth <= logline.clientWidth;
    if (stepDetailsToggle.disabled) closeStepDetails();
  }
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
    const contributing = r.velocity.sections.filter((n) => n > 0);
    $("bandCoverage").textContent = `The band shows variation among simulated sediment cells, not a confidence interval. ${contributing.length ? `${Math.min(...contributing)}–${Math.max(...contributing)}` : "0"} sections contribute per populated depth bin; deeper bins may contain fewer sections. Both settings and all sediment types are pooled.`;
    let group = "";
    $("rows").innerHTML = checkRows(r).map((row) => {
      const head = row.group !== group ? `<h3 class="group lbl">${(group = row.group)}</h3>` : "";
      const guide = row.group === "Geological plausibility";
      const label = row.status === "pass" ? (guide ? "Within guide" : "Pass") : row.status === "fail" ? (guide ? "Review" : "Fails") : "Record";
      return `${head}<div class="row ${row.status}"><div class="what"><p class="name">${row.name}</p><p class="note">${row.note}</p></div><p class="value mono">${row.value}</p><p class="verdict mono"><span>${label}</span>${row.verdict}</p></div>`;
    }).join("");
  }

  // ------------------------------------------------------------ wiring
  const press = (attr: string, value: string) => document.querySelectorAll<HTMLButtonElement>(`[${attr}]`).forEach((b) => b.setAttribute("aria-pressed", String(b.getAttribute(attr) === value)));
  press("data-view", mode);
  $<HTMLInputElement>("showTurbo").checked = look.palette === "turbo";
  document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((b) => b.addEventListener("click", () => { mode = b.dataset.view as Mode; press("data-view", mode); remember(); drawLegend(); draw(); redrawCards(); }));
  $<HTMLInputElement>("showBoundaries").addEventListener("change", (e) => { look.boundaries = (e.target as HTMLInputElement).checked; draw(); redrawCards(); });
  $<HTMLInputElement>("showFaults").addEventListener("change", (e) => { look.faults = (e.target as HTMLInputElement).checked; draw(); redrawCards(); });
  $<HTMLInputElement>("showTurbo").addEventListener("change", (e) => { look.palette = (e.target as HTMLInputElement).checked ? "turbo" : "earth"; remember(); drawLegend(); draw(); redrawCards(); });
  slider.addEventListener("input", () => { stopPlaying(); step = Number(slider.value); draw(); });
  stepDetailsToggle.addEventListener("click", () => {
    if (!stepDetails.hidden) { closeStepDetails(); return; }
    stopPlaying();
    stepDetails.hidden = false;
    stepDetailsToggle.setAttribute("aria-expanded", "true");
  });
  $("closeStepDetails").addEventListener("click", () => closeStepDetails(true));
  document.addEventListener("pointerdown", (e) => {
    if (!stepDetails.hidden && !stepNote.contains(e.target as Node)) closeStepDetails();
  });
  $("addProfile").addEventListener("click", () => {
    const next = LOG_LABELS.findIndex((_, i) => !logView.active.includes(i));
    if (next < 0) return;
    logView.active = [...logView.active, next].sort();
    remember(); drawProfileControls(); const f = frame(); if (f) drawProfiles(f);
    if (logView.active.length === LOG_LABELS.length) profileDepth.focus();
  });
  document.querySelectorAll<HTMLButtonElement>("[data-remove-profile]").forEach((b) => b.addEventListener("click", () => {
    const index = Number(b.dataset.removeProfile);
    if (index === 0) return;
    logView.active = logView.active.filter((i) => i !== index);
    if (logView.selected === index) logView.selected = 0;
    remember(); drawProfileControls(); const f = frame(); if (f) drawProfiles(f);
    $("addProfile").focus();
  }));
  $("resetProfiles").addEventListener("click", () => {
    LOG_COLUMNS.forEach(([x], i) => { logColumns[i][0] = x; }); remember();
    const f = frame(); if (f) drawProfiles(f);
  });
  profileDepth.addEventListener("input", () => inspectDepth(Number(profileDepth.value)));
  const readLog = (e: PointerEvent) => {
    const f = frame();
    if (!logPlacement || !f) return;
    const r = logCanvas.getBoundingClientRect(), y = e.clientY - r.top - logPlacement.top, x = e.clientX - r.left - logPlacement.left;
    if (x < 0 || x > logPlacement.width || y < 0 || y > logPlacement.height) {
      logCanvas.style.cursor = "default";
      $("readout").textContent = "Point at the section to read values"; return;
    }
    logCanvas.style.cursor = "crosshair";
    const depth = y / logPlacement.height * DEPTH, k = Math.round(depth / DEPTH * (f.nz - 1));
    const values = logView.active.map((i) => {
      const column = Math.round(logColumns[i][0] / WIDTH * (f.nx - 1));
      return `${LOG_LABELS[i]} ${(f.velocity[k * f.nx + column] / 1000).toFixed(2)} km/s`;
    });
    $("readout").textContent = `z ${(depth / 1000).toFixed(2)} km   ${values.join("   ")}`;
  };
  logCanvas.addEventListener("pointermove", readLog);
  logCanvas.addEventListener("pointerleave", () => { logCanvas.style.cursor = "default"; $("readout").textContent = "Point at the section to read values"; });
  $("play").addEventListener("click", () => void play());
  function hoverDot(c: HTMLCanvasElement, index: number | undefined) {
    if (index === undefined ? hoveredDot === null : hoveredDot?.canvas === c && hoveredDot.index === index) return;
    hoveredDot = index === undefined ? null : { canvas: c, index };
    const f = frame(); if (f) drawProfiles(f);
  }
  for (const c of [canvas, canvas2]) {
    let drag: { pointer: number; kind: "position" | "depth"; offset: number } | null = null;
    const point = (e: PointerEvent) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const inPlot = (p: { x: number; y: number }) => placement && p.x >= placement.left && p.x <= placement.left + placement.width && p.y >= placement.top && p.y <= placement.top + placement.height;
    const hitMarker = (p: { x: number; y: number }) => placement && c === canvas ? profileMarkers(placement, logColumns, logView.active).find((m) => p.x >= m.left && p.x <= m.left + m.width && p.y >= m.top && p.y <= m.top + m.height) : undefined;
    const hitDot = (p: { x: number; y: number }) => {
      if (!placement || !inPlot(p)) return undefined;
      const y = placement.top + logView.depth / DEPTH * placement.height;
      // Prefer the visible (last drawn) dot when profiles coincide.
      return [...logView.active].reverse().find((i) => Math.hypot(p.x - placement!.left - logColumns[i][0] / WIDTH * placement!.width, p.y - y) <= 8);
    };
    const cursorAt = (p: { x: number; y: number }) => hitMarker(p) ? "grab" : hitDot(p) !== undefined ? "ns-resize" : inPlot(p) ? "crosshair" : "default";
    c.addEventListener("pointermove", (e) => {
      const p = point(e);
      if (drag && e.pointerId === drag.pointer && placement) {
        if (drag.kind === "depth") inspectDepth((p.y - placement.top) / placement.height * DEPTH + drag.offset);
        else moveProfile((p.x - placement.left) / placement.width * WIDTH + drag.offset);
      } else {
        c.style.cursor = cursorAt(p);
        hoverDot(c, hitMarker(p) ? undefined : hitDot(p));
        readout(e);
      }
    });
    c.addEventListener("pointerdown", (e) => {
      if (drag || !e.isPrimary || e.button !== 0 || !placement || !frame()) return;
      const p = point(e), marker = hitMarker(p), dot = marker ? undefined : hitDot(p);
      if (!marker && dot === undefined) return;
      stopPlaying();
      if (marker) {
        logView.selected = marker.index;
        drag = { pointer: e.pointerId, kind: "position", offset: logColumns[marker.index][0] - (p.x - placement.left) / placement.width * WIDTH };
        hoveredDot = null;
      } else {
        drag = { pointer: e.pointerId, kind: "depth", offset: logView.depth - (p.y - placement.top) / placement.height * DEPTH };
        hoveredDot = { canvas: c, index: dot! };
      }
      c.setPointerCapture(e.pointerId); c.style.cursor = marker ? "grabbing" : "ns-resize";
      drawProfiles(frame()!);
      e.preventDefault();
    });
    const endDrag = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.pointer) return;
      const p = point(e);
      drag = null; c.style.cursor = e.type === "pointerup" ? cursorAt(p) : "default";
      hoverDot(c, e.type === "pointerup" && !hitMarker(p) ? hitDot(p) : undefined);
      if (c.hasPointerCapture(e.pointerId)) c.releasePointerCapture(e.pointerId);
      remember();
    };
    c.addEventListener("pointerup", endDrag);
    c.addEventListener("pointercancel", endDrag);
    c.addEventListener("lostpointercapture", endDrag);
    c.addEventListener("pointerleave", () => { if (!drag) { c.style.cursor = "default"; hoverDot(c, undefined); } $("readout").textContent = "Point at the section to read values"; });
  }
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
    if (e.key === "Escape" && !stepDetails.hidden) { e.preventDefault(); closeStepDetails(true); return; }
    if (document.querySelector("dialog[open]") || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLButtonElement || e.metaKey || e.ctrlKey || e.altKey) return;
    if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && current?.history.length) { e.preventDefault(); stopPlaying(); step = Math.max(0, Math.min(current.history.length - 1, step + (e.key === "ArrowLeft" ? -1 : 1))); slider.value = String(step); draw(); }
    else if (e.key === " ") { e.preventDefault(); void play(); }
    else if (e.key === "r" || e.key === "R") go(randomSeed());
    else if (e.key === "g" || e.key === "G") openDialog("gallery");
    else if (e.key === "?") openDialog("help");
  });
  let frameRequest = 0;
  const resize = new ResizeObserver(() => { cancelAnimationFrame(frameRequest); frameRequest = requestAnimationFrame(() => { draw(); if (shown && $<HTMLDialogElement>("checks").open) showChecks(shown); }); });
  resize.observe(plots);

  seedInput.value = String(seed);
  drawProfileControls();
  drawLegend();
  void open(seed);
}
