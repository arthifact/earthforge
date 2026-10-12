// The Earth Forge page: one section large (with its history to replay, velocity or lithology, and velocity with
// depth), the settings beside it, a gallery of six seeds, and the checks. Sections are simulated in a pool of
// workers (in parallel, off the page's thread); the checks in a worker of their own.

import { BASIN_DEFAULTS, type BasinOptions } from "./basin";
import { hamilton1979, hamilton1985, type Verification } from "./basinVerify";
import { checkRows } from "./checks";
import type { Reply, Request, Section } from "./protocol";
import { ACCENT, INK, lithologyLegend, paintGrid, paintProfile, paintSection, paintVelocityBand, paletteCss, PROFILE_COLUMNS, VRANGE, type Look } from "./render";

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
      this.running.set(job.req.id, job); (w as Worker & { job?: number }).job = job.req.id;
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
const cores = navigator.hardwareConcurrency || 4;
const sections = new Pool(Math.max(2, Math.min(6, cores - 1))), checker = new Pool(1);

// ---------------------------------------------------------------- page

const LOGO = `<svg class="mark" viewBox="0 0 40 40" aria-hidden="true"><rect x="0.5" y="0.5" width="39" height="39" fill="none" stroke="currentColor"/><path d="M1 12 L19 12 M1 20 L17 20 M1 28 L15 28 M21 17 L39 16 M19 25 L39 24 M17 33 L39 32" stroke="currentColor" fill="none"/><path d="M25 1 L13 39" stroke="#a4462a" stroke-width="1.6" fill="none"/></svg>`;
const select = (id: string, label: string, options: [string, string][]) => `<label class="field"><span class="eyebrow">${label}</span><select id="${id}">${options.map(([v, t]) => `<option value="${v}">${t}</option>`).join("")}</select></label>`;

export function start(root: HTMLElement) {
  root.innerHTML = `
  <a class="skip" href="#simulator">Skip to the simulator</a>
  <div class="shell">
    <header class="site-header">
      <a class="wordmark" href="#top" aria-label="Earth Forge, top">${LOGO}<span>Earth Forge<span class="dot">.</span></span></a>
      <nav class="main-nav" aria-label="Sections"><a href="#simulator">Simulator</a><a href="#gallery">Gallery</a><a href="#checks">Checks</a><a href="https://github.com/arthifact/earthforge/blob/main/docs/verification-log.md">Log ↗</a></nav>
      <a class="header-link mono" href="https://github.com/arthifact/earthforge">GitHub <span aria-hidden="true">↗</span></a>
    </header>
    <main id="top">
      <section class="intro">
        <p class="eyebrow">01 / Simulator</p>
        <h1>Earth Forge<span class="dot">.</span></h1>
        <p class="lede">Subsurface velocity models built from geological history. The ground subsides, faults slip, highs erode, sediment fills the space and compacts, and rock physics turns that history into velocity. Every model is checked against the literature and against tests with exact answers.</p>
        <p class="status mono">Now: sedimentary basins, stretched (growth faults) or squeezed (thrusts). Next: a history of stages, salt, the near surface, volcanics.</p>
      </section>

      <section id="simulator" class="workbench" aria-label="Simulator">
        <div class="stage">
          <div class="stage-top">
            <p class="eyebrow" id="title">–</p>
            <div class="segmented" role="group" aria-label="Show">
              <button type="button" data-view="velocity" aria-pressed="true">Velocity</button><button type="button" data-view="lithology" aria-pressed="false">Lithology</button>
            </div>
          </div>
          <figure class="figure"><canvas id="section" aria-label="The simulated section"></canvas><span class="busy" id="busy">Simulating</span></figure>
          <div class="under">
            <div class="legend" id="legend"></div>
            <div class="toggles">
              <label><input type="checkbox" id="showBoundaries" checked> Boundaries</label>
              <label><input type="checkbox" id="showFaults" checked> Faults</label>
              <label><input type="checkbox" id="showRainbow"> Rainbow</label>
            </div>
          </div>
          <div class="timeline">
            <button type="button" class="btn" id="play" aria-label="Replay the history">Replay</button>
            <input type="range" id="step" min="0" max="0" value="0" aria-label="Step of the history">
            <span class="mono" id="stepLabel"></span>
          </div>
          <p class="log" id="log" aria-live="polite"></p>
        </div>
        <aside class="controls" aria-label="Settings">
          <div class="field">
            <span class="eyebrow">Seed</span>
            <div class="seed"><button type="button" class="step-btn" id="seedDown" aria-label="Previous seed">−</button><input id="seed" type="number" min="1" step="1" inputmode="numeric" aria-label="Seed"><button type="button" class="step-btn" id="seedUp" aria-label="Next seed">+</button><button type="button" class="btn ghost" id="random">Random</button></div>
          </div>
          ${select("setting", "Setting", [["any", "Any: drawn per seed"], ["extension", "Extension: growth faults"], ["compression", "Compression: thrusts"]])}
          ${select("faults", "Growth faults", [["2,4", "2–4"], ["1,2", "1–2"], ["4,7", "4–7"], ["0,0", "None"]])}
          ${select("thrusts", "Thrusts", [["1,3", "1–3"], ["1,1", "1"], ["2,4", "2–4"], ["0,0", "None"]])}
          ${select("compaction", "Compaction of beds", [["on", "On"], ["off", "Off"]])}
          ${select("overpressure", "Overpressure", [["0.35", "In a third of sections"], ["0", "Never"], ["1", "Always"]])}
          ${select("carbonate", "Carbonate units", [["0.1", "Rare"], ["0", "None"], ["0.3", "Common"]])}
          <dl class="facts" id="facts"></dl>
        </aside>
        <div class="profile">
          <p class="eyebrow">Velocity with depth</p>
          <canvas id="profile" aria-label="Velocity with depth in three columns"></canvas>
          <p class="key mono">${PROFILE_COLUMNS.map(([x, c]) => `<span><i style="background:${c}"></i>${x / 1000} km</span>`).join("")}<span class="unit">depth in km, velocity in km/s</span></p>
        </div>
      </section>

      <section id="gallery" class="block" aria-label="Gallery">
        <div class="section-heading">
          <div><p class="eyebrow">02 / Gallery</p><h2>Six seeds, same settings</h2></div>
          <div class="actions mono"><button type="button" class="text-link" id="prev">← Previous six</button><button type="button" class="text-link" id="next">Next six →</button></div>
        </div>
        <div class="gallery" id="cards"></div>
      </section>

      <section id="checks" class="block" aria-label="Checks">
        <div class="section-heading">
          <div><p class="eyebrow">03 / Checks</p><h2>Against the literature and against known answers</h2></div>
        </div>
        <p class="lede small">Many sections are simulated with the settings above and measured: velocity with depth against Hamilton's marine-sediment fits, growth-fault geometry, dips and rates. Tests with an exact answer check the kinematics and the compaction. The rules were written before each run (<a href="https://github.com/arthifact/earthforge/blob/main/docs/verification-log.md">the log</a>).</p>
        <div class="run">
          ${select("count", "Sections", [["20", "20"], ["40", "40"], ["100", "100"]])}
          <button type="button" class="btn" id="runChecks">Run the checks</button>
          <span class="mono progress" id="progress" aria-live="polite"></span>
        </div>
        <div class="results" id="results" hidden>
          <div class="band"><p class="eyebrow">Velocity below the sea floor</p><canvas id="bandChart" aria-label="Simulated velocity with depth against Hamilton's fits"></canvas>
            <p class="key mono"><span><i class="swatch-band"></i>simulated 10–90%</span><span><i style="background:${ACCENT}"></i>median</span><span><i style="background:${INK}"></i>Hamilton 1979</span><span><i class="dash"></i>Hamilton 1985</span></p></div>
          <div class="rows" id="rows"></div>
        </div>
      </section>

      <section id="reference" class="block" aria-label="Reference" hidden>
        <div class="section-heading"><div><p class="eyebrow">04 / Reference</p><h2>Marmousi, for comparison by eye</h2></div></div>
        <figure class="figure"><canvas id="marmousi"></canvas></figure>
        <p class="note">The simulator's rules were written from basin geology, not from this section.</p>
      </section>
    </main>
    <footer class="site-footer">
      <div><a href="https://arthifact.com/">Gabriel I. Alonso</a></div>
      <div class="footer-links"><a href="https://github.com/arthifact/earthforge">GitHub ↗</a><a href="https://github.com/arthifact/earthforge/blob/main/docs/verification-log.md">Verification log ↗</a><span class="mono">Earth Forge</span></div>
    </footer>
  </div>`;

  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const canvas = $<HTMLCanvasElement>("section"), profile = $<HTMLCanvasElement>("profile"), slider = $<HTMLInputElement>("step");
  const seedInput = $<HTMLInputElement>("seed"), cards = $("cards");
  const fields = ["setting", "faults", "thrusts", "compaction", "overpressure", "carbonate"].map((id) => $<HTMLSelectElement>(id));

  // State, kept in the address (so a view can be shared).
  const hash = new URLSearchParams(location.hash.slice(1));
  let seed = Math.max(1, Number(hash.get("seed")) || 1), first = Math.max(1, Number(hash.get("first")) || seed);
  for (const s of fields) { const v = hash.get(s.id); if (v && [...s.options].some((o) => o.value === v)) s.value = v; }
  const look: Look = { view: hash.get("view") === "lithology" ? "lithology" : "velocity", palette: "earth", boundaries: true, faults: true };
  let current: Section | null = null, step = 0, playing = false, generation = 0;

  const options = (s: number): BasinOptions => {
    const [fa, fb] = $<HTMLSelectElement>("faults").value.split(",").map(Number), [ta, tb] = $<HTMLSelectElement>("thrusts").value.split(",").map(Number);
    return { ...BASIN_DEFAULTS, seed: s, setting: $<HTMLSelectElement>("setting").value as BasinOptions["setting"], faults: [fa, fb], thrusts: [ta, tb], compaction: $<HTMLSelectElement>("compaction").value === "on", overpressure: Number($<HTMLSelectElement>("overpressure").value), carbonate: Number($<HTMLSelectElement>("carbonate").value) };
  };
  const remember = () => {
    const p = new URLSearchParams({ seed: String(seed), first: String(first), view: look.view });
    for (const s of fields) if (s.value !== s.options[0].value) p.set(s.id, s.value);
    history.replaceState(null, "", `#${p}`);
  };

  // ------------------------------------------------------------ drawing
  const frame = () => current ? (current.history.length && step < current.history.length - 1 ? current.history[step] : current.now) : null;
  function draw() {
    const f = frame();
    if (!f || !current) return;
    paintSection(canvas, f, look, current.unitOfBed);
    paintProfile(profile, f);
    const steps = current.log.length, at = current.history.length ? step : steps - 1, last = steps - 1, entry = current.log[at];
    $("stepLabel").textContent = `${String(at + 1).padStart(2, "0")} / ${steps} · ${entry.phase}`;
    $("log").textContent = entry ? `${at === last ? "Today. " : ""}Step ${at + 1}: ${entry.text}.` : "";
  }
  function drawLegend() {
    $("legend").innerHTML = look.view === "velocity"
      ? `<span class="mono">${VRANGE[0] / 1000}</span><i class="ramp" style="background:${paletteCss(look.palette)}"></i><span class="mono">${VRANGE[1] / 1000} km/s</span>`
      : lithologyLegend.map(([name, color]) => `<span class="swatch mono"><i style="background:${color}"></i>${name}</span>`).join("");
  }
  function drawFacts(s: Section) {
    const phases = [...new Set(s.log.map((l) => l.phase))].map((p) => `${s.log.filter((l) => l.phase === p).length} ${p}`).join(", ");
    const fault = (f: Section["faults"][number], n: number) => f.kind === "normal"
      ? `${n + 1}. dips ${f.dir > 0 ? "east" : "west"}, heave ${f.heave.toFixed(0)} m`
      : `${n + 1}. ramp ${(f.dip * 180 / Math.PI).toFixed(0)}°, moving ${f.transport > 0 ? "east" : "west"}, slip ${(f.heave / 1000).toFixed(1)} km, ${f.emergent ? "reaches the sea floor" : "blind"}`;
    const row = (k: string, v: string) => `<div><dt class="eyebrow">${k}</dt><dd>${v}</dd></div>`;
    $("facts").innerHTML = [
      row("Setting", s.setting + (s.options.setting === "any" ? " (drawn)" : "")),
      row("History", `${s.log.length} steps of ${s.dt.toFixed(1)} Myr: ${phases}`),
      row("Beds", `${new Set(s.unitOfBed).size} units, ${s.unitOfBed.length} beds`),
      row(s.setting === "extension" ? "Growth faults" : "Thrusts", s.faults.length ? s.faults.map(fault).join("<br>") : "none"),
      row("Overpressure", s.overpressure !== null ? `below ${s.overpressure.toFixed(0)} m` : "none"),
      row("Basement", `${s.basementVelocity.toFixed(0)} m/s`),
      row("Simulated in", `${(1000 * s.checks.seconds).toFixed(0)} ms`),
    ].join("");
    $("title").textContent = `Seed ${s.seed} · ${s.setting}`;
  }

  // ------------------------------------------------------------ simulation
  async function open(s: number, scroll = false) {
    seed = s; seedInput.value = String(s); remember(); stopPlaying();
    const mine = ++generation;
    $("busy").classList.add("on");
    try {
      // The section shows as soon as it is simulated; its history (one frame per step) follows.
      const preview = (sec: Section) => {
        if (mine !== generation) return;
        current = sec; step = 0; slider.max = "0"; slider.value = "0"; slider.disabled = true;
        drawFacts(sec); draw();
        for (const c of cards.children) c.classList.toggle("selected", Number((c as HTMLElement).dataset.seed) === s);
        if (scroll) $("simulator").scrollIntoView({ behavior: "smooth", block: "start" });
        $("busy").classList.remove("on");
      };
      sections.clear("main");
      const r = await sections.run({ kind: "section", options: options(s), history: true }, { group: "main", first: true, onPreview: preview });
      if (mine !== generation || r.kind !== "history" || !current) return;
      current.history = r.frames; step = Math.max(0, r.frames.length - 1);
      slider.max = String(step); slider.value = String(step); slider.disabled = false;
      draw();
    } catch (e) { if ((e as Error).message !== "stale") $("log").textContent = `Could not simulate: ${(e as Error).message}`; }
    finally { if (mine === generation) $("busy").classList.remove("on"); }
  }
  let galleryGeneration = 0;
  function gallery() {
    const mine = ++galleryGeneration;
    sections.clear("gallery");
    cards.innerHTML = Array.from({ length: 6 }, (_, k) => `
      <article class="card${first + k === seed ? " selected" : ""}" data-seed="${first + k}">
        <button type="button" class="thumb" aria-label="Open seed ${first + k}"><canvas></canvas></button>
        <p class="eyebrow"><span>Seed ${first + k}</span><span class="kind"></span></p>
        <h3 class="card-title">&nbsp;</h3><p class="card-note">&nbsp;</p>
      </article>`).join("");
    [...cards.children].forEach((card, k) => {
      const s = first + k, el = card as HTMLElement;
      el.querySelector("button")!.addEventListener("click", () => void open(s, true));
      sections.run({ kind: "section", options: options(s), history: false }, { group: "gallery" }).then((r) => {
        if (mine !== galleryGeneration || r.kind !== "section") return;
        const sec = r.section, n = sec.faults.length;
        el.classList.add("ready");
        (el as HTMLElement & { section?: Section }).section = sec;
        paintSection(el.querySelector("canvas")!, sec.now, { ...look, faults: true }, sec.unitOfBed);
        el.querySelector(".kind")!.textContent = sec.setting;
        el.querySelector(".card-title")!.textContent = sec.setting === "extension" ? `${n} growth fault${n === 1 ? "" : "s"}` : `${n} thrust${n === 1 ? "" : "s"}, ${(sec.faults.reduce((a, f) => a + f.heave, 0) / 1000).toFixed(1)} km of slip`;
        el.querySelector(".card-note")!.textContent = `${sec.log.length} steps, ${sec.unitOfBed.length} beds${sec.overpressure !== null ? ", overpressured" : ""}`;
      }).catch(() => undefined);
    });
  }
  const redrawCards = () => { for (const c of cards.children) { const sec = (c as HTMLElement & { section?: Section }).section; if (sec) paintSection(c.querySelector("canvas")!, sec.now, { ...look, faults: true }, sec.unitOfBed); } };

  // ------------------------------------------------------------ history
  function stopPlaying() { playing = false; $("play").textContent = "Replay"; }
  async function play() {
    if (!current || playing) { stopPlaying(); return; }
    playing = true; $("play").textContent = "Stop";
    for (step = 0; playing && current && step < current.history.length; step++) {
      slider.value = String(step); draw();
      await new Promise((r) => setTimeout(r, 260));
    }
    if (current) { step = Math.min(step, current.history.length - 1); slider.value = String(step); }
    stopPlaying(); draw();
  }

  // ------------------------------------------------------------ checks
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
  let shown: Verification | null = null;
  function showChecks(r: Verification) {
    shown = r;
    $("results").hidden = false;
    paintVelocityBand($<HTMLCanvasElement>("bandChart"), r.velocity, [{ f: (d) => hamilton1979(d / 1000), to: 1000, color: INK, dash: false }, { f: (d) => hamilton1985(d / 1000), to: 1000, color: INK, dash: true }]);
    const rows = checkRows(r);
    let group = "";
    $("rows").innerHTML = rows.map((row) => {
      const head = row.group !== group ? `<h3 class="group eyebrow">${(group = row.group)}</h3>` : "";
      return `${head}<div class="row ${row.status}"><div class="what"><p class="name">${row.name}</p><p class="note">${row.note}</p></div><p class="value mono">${row.value}</p><p class="verdict mono"><span>${row.status === "pass" ? "Pass" : row.status === "fail" ? "Fails" : "Record"}</span>${row.verdict}</p></div>`;
    }).join("");
  }

  // ------------------------------------------------------------ wiring
  document.querySelectorAll<HTMLButtonElement>(".segmented button").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.view === look.view));
    b.addEventListener("click", () => {
      look.view = b.dataset.view as Look["view"]; remember();
      document.querySelectorAll(".segmented button").forEach((o) => o.setAttribute("aria-pressed", String(o === b)));
      drawLegend(); draw(); redrawCards();
    });
  });
  $<HTMLInputElement>("showBoundaries").addEventListener("change", (e) => { look.boundaries = (e.target as HTMLInputElement).checked; draw(); redrawCards(); });
  $<HTMLInputElement>("showFaults").addEventListener("change", (e) => { look.faults = (e.target as HTMLInputElement).checked; draw(); });
  $<HTMLInputElement>("showRainbow").addEventListener("change", (e) => { look.palette = (e.target as HTMLInputElement).checked ? "rainbow" : "earth"; drawLegend(); draw(); redrawCards(); });
  slider.addEventListener("input", () => { stopPlaying(); step = Number(slider.value); draw(); });
  $("play").addEventListener("click", () => void play());
  // The large section is asked for first, so it never waits behind the gallery.
  const go = (s: number) => { const v = Math.max(1, Math.round(s) || 1); void open(v); if (v < first || v >= first + 6) { first = v; gallery(); } };
  seedInput.addEventListener("change", () => go(Number(seedInput.value)));
  $("seedDown").addEventListener("click", () => go(seed - 1));
  $("seedUp").addEventListener("click", () => go(seed + 1));
  $("random").addEventListener("click", () => go(1 + Math.floor(Math.random() * 999999)));
  $("prev").addEventListener("click", () => { first = Math.max(1, first - 6); remember(); gallery(); });
  $("next").addEventListener("click", () => { first += 6; remember(); gallery(); });
  let timer = 0;
  for (const s of fields) s.addEventListener("change", () => { clearTimeout(timer); timer = window.setTimeout(() => { remember(); void open(seed); gallery(); }, 60); });
  $("runChecks").addEventListener("click", () => void runChecks());
  let resizeTimer = 0;
  new ResizeObserver(() => { cancelAnimationFrame(resizeTimer); resizeTimer = requestAnimationFrame(() => { draw(); redrawCards(); if (shown) showChecks(shown); }); }).observe(document.querySelector(".shell")!);
  addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || !current) return;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") { stopPlaying(); step = Math.max(0, Math.min(current.history.length - 1, step + (e.key === "ArrowLeft" ? -1 : 1))); slider.value = String(step); draw(); }
  });

  seedInput.value = String(seed);
  drawLegend();
  void open(seed);
  gallery();
  // The reference, if its file is there (a 461 x 151 float32 grid at 20 m).
  fetch("/reference/marmousi_truth20.f32").then(async (r) => {
    const type = r.headers.get("content-type") ?? "";
    if (!r.ok || type.includes("html")) return;
    const v = new Float32Array(await r.arrayBuffer());
    if (v.length !== 461 * 151) return;
    $("reference").hidden = false;
    paintGrid($<HTMLCanvasElement>("marmousi"), v, 461, 151, look.palette);
  }).catch(() => undefined);
}
