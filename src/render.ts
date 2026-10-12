// Drawing: the section with its axes (distance and depth in km), linked velocity profiles with their own axes,
// thumbnails without axes, and the checks' velocity chart. Canvases are drawn at their layout size times the
// screen's pixel ratio.

import type { Frame } from "./protocol";
import { DEPTH, WIDTH } from "./window";

export const INK = "#252722", ACCENT = "#4c6246", RUST = "#a4462a", LINE = "#deded4", MUTED = "#64675e", PAPER = "#faf9f6";
export const VRANGE: [number, number] = [1500, 5600];
/** Depth over distance of the window at true scale. */
export const TRUE_RATIO = DEPTH / WIDTH;
type RGB = [number, number, number];

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
function ramp(stops: string[]) {
  const c = stops.map(hex);
  return (t: number): RGB => {
    const s = Math.min(1, Math.max(0, t)) * (c.length - 1), i = Math.min(c.length - 2, Math.floor(s)), f = s - i;
    return [c[i][0] + (c[i + 1][0] - c[i][0]) * f, c[i][1] + (c[i + 1][1] - c[i][1]) * f, c[i][2] + (c[i + 1][2] - c[i][2]) * f];
  };
}
/** Velocity: an earth ramp of steadily rising lightness (dark blue, teal, green, olive, ochre, sand); or turbo. */
const earth = ramp(["#0b1d4f", "#123f62", "#1b5b66", "#2f7064", "#57804f", "#88903c", "#b99a3e", "#dba65a", "#ebc488", "#f4e2bd"]);
function turbo(t: number): RGB {
  const x = Math.min(1, Math.max(0, t)), c = (a: number[]) => 255 * Math.min(1, Math.max(0, a.reduceRight((acc, k) => acc * x + k, 0)));
  return [c([0.13572138, 4.6153926, -42.66032258, 132.13108234, -152.94239396, 59.28637943]),
    c([0.09140261, 2.19418839, 4.84296658, -14.18503333, 4.27729857, 2.82956604]),
    c([0.1066733, 12.64194608, -60.58204836, 110.36276771, -89.90310912, 27.34824973])];
}
/** Lithology: shale grey-green to silt to sand, carbonate pale blue, basement warm grey, water pale. */
const clastic = ramp(["#7f8a73", "#a9a886", "#d8cb96", "#ecdca6"]);
const WATER_RGB = hex("#dfe7e4"), BASEMENT_RGB = hex("#6b625a"), CARBONATE_RGB = hex("#a9c4c7");

export type View = "velocity" | "lithology";
export type Palette = "earth" | "turbo";
export const velocityColor = (v: number, palette: Palette): RGB => (palette === "earth" ? earth : turbo)((v - VRANGE[0]) / (VRANGE[1] - VRANGE[0]));
export const paletteCss = (palette: Palette) => `linear-gradient(90deg, ${Array.from({ length: 11 }, (_, k) => { const [r, g, b] = (palette === "earth" ? earth : turbo)(k / 10); return `rgb(${r | 0},${g | 0},${b | 0})`; }).join(", ")})`;
export const lithologyLegend: [string, string][] = [["Shale", "#7f8a73"], ["Silt", "#a9a886"], ["Sand", "#ecdca6"], ["Carbonate", "#a9c4c7"], ["Basement", "#6b625a"], ["Water", "#dfe7e4"]];

const ratio = () => Math.min(2, window.devicePixelRatio || 1);
/** Size a canvas's backing store to its layout box at the pixel ratio. */
function box(canvas: HTMLCanvasElement) {
  const dpr = ratio(), width = Math.max(40, Math.round(canvas.clientWidth * dpr)), height = Math.max(20, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  return { c: canvas.getContext("2d")!, width, height, dpr };
}
const FONT = (dpr: number) => `${10 * dpr}px ui-monospace, SFMono-Regular, Consolas, monospace`;

const images = new WeakMap<Frame, Map<string, OffscreenCanvas>>();
/** The section as an image at its own resolution (cached per frame and look). */
function image(f: Frame, view: View, palette: Palette, boundaries: boolean, unitOfBed: Int32Array) {
  const key = `${view}/${palette}/${boundaries}`, cache = images.get(f) ?? new Map<string, OffscreenCanvas>();
  images.set(f, cache);
  const hit = cache.get(key);
  if (hit) return hit;
  const data = new ImageData(f.nx, f.nz);
  for (let k = 0; k < f.nz; k++) for (let i = 0; i < f.nx; i++) {
    const n = k * f.nx + i, l = f.litho[n];
    const rgb = view === "velocity" ? velocityColor(f.velocity[n], palette) : l === -1 ? WATER_RGB : l === -2 ? BASEMENT_RGB : l === -3 ? CARBONATE_RGB : clastic(l);
    let shade = 1;
    if (boundaries && k + 1 < f.nz) {
      const a = f.beds[n], b = f.beds[n + f.nx];
      if (a !== b && a >= 0 && b >= 0) shade = unitOfBed[a] !== unitOfBed[b] ? 0.72 : 0.93;
      else if (a !== b && (a === -1 || a === -2 || b === -2)) shade = 0.72;
    }
    data.data[4 * n] = rgb[0] * shade; data.data[4 * n + 1] = rgb[1] * shade; data.data[4 * n + 2] = rgb[2] * shade; data.data[4 * n + 3] = 255;
  }
  const off = new OffscreenCanvas(f.nx, f.nz);
  off.getContext("2d")!.putImageData(data, 0, 0);
  cache.set(key, off);
  return off;
}

export interface Look { view: View; palette: Palette; boundaries: boolean; faults: boolean }
/** Margins of the section plot around its image (layout px): the depth axis on the left, distance on top. */
export const SECTION_PAD = { l: 34, r: 1, t: 40, b: 1 };
/** Where the section's image sits in its canvas (layout px), for mapping a pointer to distance and depth. */
export interface Placement { left: number; top: number; width: number; height: number }
/** Keep draggable labels inside the section and stack them when locations coincide. */
export function profileMarkers(p: Placement, columns: [number, string][], active: readonly number[]) {
  const markers: (Placement & { index: number })[] = [];
  columns.forEach(([x], index) => {
    if (!active.includes(index)) return;
    const left = Math.max(p.left + 1, Math.min(p.left + p.width - 21, p.left + x / WIDTH * p.width - 10));
    let top = p.top + 5;
    while (markers.some((m) => Math.abs(m.left - left) < 22 && m.top === top)) top += 23;
    markers.push({ index, left, top, width: 20, height: 20 });
  });
  return markers;
}

/**
 * The section on a canvas, scaled to it, with the faults where they cut rock (with rock above them). With axes:
 * ticks every km of distance and every 0.5 km of depth, and markers where the log's columns are.
 */
export function paintSection(canvas: HTMLCanvasElement, f: Frame, look: Look, unitOfBed: Int32Array, axes?: { columns: [number, string][]; selected?: number; depth?: number; active: number[]; sharedDistance?: boolean; title?: string; hoveredDot?: number }): Placement {
  const { c, width, height, dpr } = box(canvas), p = axes ? SECTION_PAD : { l: 0, r: 0, t: 0, b: 0 };
  const L = p.l * dpr, T = p.t * dpr, iw = width - L - p.r * dpr, ih = height - T - p.b * dpr;
  c.clearRect(0, 0, width, height);
  c.imageSmoothingEnabled = true; c.imageSmoothingQuality = "high";
  c.drawImage(image(f, look.view, look.palette, look.boundaries, unitOfBed), L, T, iw, ih);
  if (look.faults) {
    const rock = (i: number, k: number) => i < 0 || i >= f.nx || k < 0 || k >= f.nz || f.beds[k * f.nx + i] !== -1;
    c.save(); c.beginPath(); c.rect(L, T, iw, ih); c.clip();
    c.strokeStyle = RUST; c.lineWidth = Math.max(1.2, 1.3 * dpr); c.lineJoin = "round"; c.beginPath();
    for (const t of f.faults) {
      let drawing = false;
      for (let q = 0; q < t.x.length; q++) {
        const i = Math.round(t.x[q] / WIDTH * (f.nx - 1)), k = Math.round(t.z[q] / DEPTH * (f.nz - 1));
        if (!(rock(i, k) && rock(i, k - 1))) { drawing = false; continue; }
        const X = L + t.x[q] / WIDTH * iw, Y = T + t.z[q] / DEPTH * ih;
        if (drawing) c.lineTo(X, Y); else c.moveTo(X, Y);
        drawing = true;
      }
    }
    c.stroke(); c.restore();
  }
  if (axes) {
    if (axes.depth !== undefined) {
      const Y = T + axes.depth / DEPTH * ih;
      c.save(); c.beginPath(); c.rect(L, T, iw, ih); c.clip();
      c.setLineDash([4 * dpr, 4 * dpr]); c.lineWidth = dpr;
      c.strokeStyle = "rgba(255,255,255,0.8)";
      c.beginPath(); c.moveTo(L, Y); c.lineTo(L + iw, Y); c.stroke();
      axes.columns.forEach(([x, color], index) => {
        if (!axes.active.includes(index)) return;
        const X = L + x / WIDTH * iw;
        c.beginPath(); c.moveTo(X, T); c.lineTo(X, T + ih); c.stroke();
        c.setLineDash([]); c.fillStyle = color; c.strokeStyle = PAPER; c.lineWidth = 2 * dpr;
        c.beginPath(); c.arc(X, Y, (axes.hoveredDot === index ? 5.5 : 4) * dpr, 0, 2 * Math.PI); c.fill(); c.stroke();
        c.setLineDash([4 * dpr, 4 * dpr]); c.strokeStyle = "rgba(255,255,255,0.8)"; c.lineWidth = dpr;
      });
      c.restore();
    }
    c.strokeStyle = INK; c.lineWidth = dpr; c.strokeRect(L - 0.5 * dpr, T - 0.5 * dpr, iw + dpr, ih + dpr);
    c.font = FONT(dpr); c.fillStyle = MUTED; c.strokeStyle = MUTED; c.textBaseline = "bottom";
    if (axes.sharedDistance) {
      c.textAlign = "left"; c.fillText("Lithology", L, T - 11 * dpr);
    } else {
      if (axes.title) { c.textAlign = "left"; c.fillText(axes.title, L, T - 28 * dpr); }
      for (let km = 0; km <= WIDTH / 1000; km++) {
        const X = L + km * 1000 / WIDTH * iw;
        c.beginPath(); c.moveTo(X, T - 4 * dpr); c.lineTo(X, T); c.stroke();
        c.textAlign = km === 0 ? "left" : "center"; c.fillText(km === 0 ? "0 km" : String(km), X, T - 11 * dpr);
      }
    }
    c.textAlign = "right"; c.textBaseline = "middle";
    for (let d = 0; d <= DEPTH; d += 500) {
      const Y = T + d / DEPTH * ih;
      c.beginPath(); c.moveTo(L - 4 * dpr, Y); c.lineTo(L, Y); c.stroke();
      c.fillText(d % 1000 === 0 ? String(d / 1000) : (d / 1000).toFixed(1), L - 7 * dpr, Math.min(Math.max(Y, T + 5 * dpr), T + ih - 5 * dpr));
    }
    const markers = axes.sharedDistance ? [] : profileMarkers({ left: p.l, top: p.t, width: iw / dpr, height: ih / dpr }, axes.columns, axes.active);
    for (const m of markers) {
      const index = m.index, [x, color] = axes.columns[index];
      const X = L + x / WIDTH * iw;
      c.fillStyle = color; c.beginPath(); c.moveTo(X - 4 * dpr, T - 8 * dpr); c.lineTo(X + 4 * dpr, T - 8 * dpr); c.lineTo(X, T - 2 * dpr); c.closePath(); c.fill();
      c.fillRect(m.left * dpr, m.top * dpr, m.width * dpr, m.height * dpr);
      if (index === axes.selected) { c.strokeStyle = PAPER; c.lineWidth = dpr; c.strokeRect(m.left * dpr, m.top * dpr, m.width * dpr, m.height * dpr); }
      c.fillStyle = "#fff"; c.textAlign = "center"; c.textBaseline = "middle";
      c.font = `bold ${10 * dpr}px ui-monospace, monospace`; c.fillText(LOG_LABELS[index], (m.left + m.width / 2) * dpr, (m.top + m.height / 2) * dpr);
    }
  }
  return { left: p.l, top: p.t, width: iw / dpr, height: ih / dpr };
}

/** Starting locations only; the app owns and edits its copy. */
export const LOG_COLUMNS: [number, string][] = [[2000, "#286b8c"], [4600, ACCENT], [7200, RUST]];
export const LOG_LABELS = ["A", "B", "C"];
// Space for the graph's velocity title and tick labels inside its card.
export const LOG_PAD = { l: 50, r: 18, t: SECTION_PAD.t, b: 12 };
export interface LogView { selected: number; active: number[]; depth: number }
/** Raw grid samples, with cell boundaries halfway between depth nodes; no smoothing or averaging. */
export function paintLog(canvas: HTMLCanvasElement, f: Frame, view: LogView, columns: [number, string][]): Placement {
  const { c, width, height, dpr } = box(canvas), T = LOG_PAD.t * dpr, ih = height - T - LOG_PAD.b * dpr, L = LOG_PAD.l * dpr, iw = width - L - LOG_PAD.r * dpr;
  const comparing = view.active.length > 1;
  c.clearRect(0, 0, width, height);
  const X = (v: number) => L + iw * (v - VRANGE[0]) / (VRANGE[1] - VRANGE[0]), Y = (d: number) => T + ih * d / DEPTH;
  c.font = FONT(dpr);
  c.fillStyle = MUTED; c.textAlign = "center"; c.textBaseline = "middle";
  c.fillText("Velocity (km/s)", width / 2, 13 * dpr);
  c.textBaseline = "bottom";
  c.strokeStyle = "#e9e9e2"; c.lineWidth = dpr;
  for (const v of [VRANGE[0], 2000, 3000, 4000, 5000, VRANGE[1]]) {
    c.beginPath(); c.moveTo(X(v), T); c.lineTo(X(v), T + ih); c.stroke();
    c.fillText(String(v / 1000), X(v), T - 6 * dpr);
  }
  c.textAlign = "right"; c.textBaseline = "middle";
  for (let d = 0; d <= DEPTH; d += 500) {
    c.beginPath(); c.moveTo(L, Y(d)); c.lineTo(L + iw, Y(d)); c.stroke();
    c.fillText((d / 1000).toFixed(1), L - 9 * dpr, Y(d));
  }
  c.save(); c.translate(14 * dpr, T + ih / 2); c.rotate(-Math.PI / 2);
  c.textAlign = "center"; c.fillText("Depth (km)", 0, 0); c.restore();
  c.strokeStyle = "#aeb1a6"; c.beginPath(); c.moveTo(L, T); c.lineTo(L, T + ih); c.lineTo(L + iw, T + ih); c.stroke();
  c.save(); c.beginPath(); c.rect(L, T, iw, ih); c.clip();
  columns.forEach(([x, color], index) => {
    if (!view.active.includes(index)) return;
    const i = Math.round(x / WIDTH * (f.nx - 1));
    c.strokeStyle = color; c.lineWidth = (comparing ? 1.6 : 2.2) * dpr; c.lineJoin = "round";
    c.setLineDash(comparing ? [[], [6 * dpr, 3 * dpr], [2 * dpr, 3 * dpr]][index] : []);
    c.beginPath(); c.moveTo(X(f.velocity[i]), Y(0));
    for (let k = 1; k < f.nz; k++) {
      const boundary = (k - 0.5) * DEPTH / (f.nz - 1);
      c.lineTo(X(f.velocity[(k - 1) * f.nx + i]), Y(boundary));
      c.lineTo(X(f.velocity[k * f.nx + i]), Y(boundary));
    }
    c.lineTo(X(f.velocity[(f.nz - 1) * f.nx + i]), Y(DEPTH));
    c.stroke();
  });
  c.setLineDash([3 * dpr, 3 * dpr]); c.strokeStyle = MUTED; c.lineWidth = dpr;
  c.beginPath(); c.moveTo(L, Y(view.depth)); c.lineTo(L + iw, Y(view.depth)); c.stroke();
  c.setLineDash([]);
  const k = Math.round(view.depth / DEPTH * (f.nz - 1));
  columns.forEach(([x, color], index) => {
    if (!view.active.includes(index)) return;
    const v = f.velocity[k * f.nx + Math.round(x / WIDTH * (f.nx - 1))];
    c.fillStyle = color; c.strokeStyle = "#fff"; c.lineWidth = 2 * dpr;
    c.beginPath(); c.arc(X(v), Y(view.depth), 4.5 * dpr, 0, 2 * Math.PI); c.fill(); c.stroke();
  });
  c.restore();
  return { left: LOG_PAD.l, top: LOG_PAD.t, width: iw / dpr, height: ih / dpr };
}

/** The checks' chart: simulated 10-90% band and median below the sea floor, and reference curves to their stated depth. */
export function paintVelocityBand(canvas: HTMLCanvasElement, band: { depth: number[]; p10: number[]; p50: number[]; p90: number[] }, refs: { f: (d: number) => number; to: number; color: string; dash: boolean }[]) {
  const { c, width, height, dpr } = box(canvas), L = 30 * dpr, R = 8 * dpr, T = 22 * dpr, B = 6 * dpr;
  c.clearRect(0, 0, width, height);
  const X = (v: number) => L + (width - L - R) * (v - 1400) / 4200, Y = (d: number) => T + (height - T - B) * d / DEPTH;
  c.font = FONT(dpr); c.fillStyle = MUTED; c.strokeStyle = LINE; c.lineWidth = dpr;
  for (let v = 2000; v <= 5000; v += 1000) { c.beginPath(); c.moveTo(X(v), T); c.lineTo(X(v), height - B); c.stroke(); c.textAlign = "center"; c.fillText(String(v / 1000), X(v), T - 8 * dpr); }
  for (let d = 0; d <= DEPTH; d += 1000) { c.beginPath(); c.moveTo(L, Y(d)); c.lineTo(width - R, Y(d)); c.stroke(); c.textAlign = "right"; c.fillText(String(d / 1000), L - 6 * dpr, Y(d) + 3 * dpr); }
  c.textAlign = "right"; c.fillText("km/s", width - R, T - 8 * dpr);
  // Missing depth bins are gaps, never an interpolated continuation of the ensemble.
  const valid = (k: number) => [band.depth[k], band.p10[k], band.p50[k], band.p90[k]].every(Number.isFinite);
  for (let start = 0; start < band.depth.length;) {
    if (!valid(start)) { start++; continue; }
    let end = start + 1; while (end < band.depth.length && valid(end)) end++;
    c.fillStyle = "rgba(76,98,70,0.16)"; c.beginPath();
    for (let k = start; k < end; k++) (k === start ? c.moveTo(X(band.p10[k]), Y(band.depth[k])) : c.lineTo(X(band.p10[k]), Y(band.depth[k])));
    for (let k = end - 1; k >= start; k--) c.lineTo(X(band.p90[k]), Y(band.depth[k]));
    c.closePath(); c.fill();
    c.strokeStyle = ACCENT; c.lineWidth = 1.6 * dpr; c.beginPath();
    for (let k = start; k < end; k++) (k === start ? c.moveTo(X(band.p50[k]), Y(band.depth[k])) : c.lineTo(X(band.p50[k]), Y(band.depth[k])));
    c.stroke(); start = end;
  }
  for (const r of refs) {
    c.strokeStyle = r.color; c.lineWidth = 1.4 * dpr; c.setLineDash(r.dash ? [5 * dpr, 4 * dpr] : []); c.beginPath();
    for (let d = 0; d <= r.to; d += 25) { if (d) c.lineTo(X(r.f(d)), Y(d)); else c.moveTo(X(r.f(d)), Y(d)); }
    c.stroke(); c.setLineDash([]);
  }
}
