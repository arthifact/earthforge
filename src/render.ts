// Drawing: sections (velocity or lithology, bed and unit boundaries, faults), velocity-depth profiles, and the
// checks' velocity chart, sized to each canvas's layout width at the screen's pixel ratio.

import type { Frame } from "./protocol";
import { DEPTH, WIDTH } from "./window";

export const INK = "#252722", ACCENT = "#4c6246", RUST = "#a4462a", LINE = "#deded4", MUTED = "#64675e", PAPER = "#faf9f6";
export const VRANGE: [number, number] = [1500, 5500];
export const SECTION_ASPECT = WIDTH / DEPTH;
type RGB = [number, number, number];

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
function ramp(stops: string[]) {
  const c = stops.map(hex);
  return (t: number): RGB => {
    const s = Math.min(1, Math.max(0, t)) * (c.length - 1), i = Math.min(c.length - 2, Math.floor(s)), f = s - i;
    return [c[i][0] + (c[i + 1][0] - c[i][0]) * f, c[i][1] + (c[i + 1][1] - c[i][1]) * f, c[i][2] + (c[i + 1][2] - c[i][2]) * f];
  };
}
/** Velocity: a perceptually ordered earth ramp (deep blue, teal, olive, ochre, salmon, pale pink), after Crameri's batlow; or a high-contrast rainbow (turbo). */
const earth = ramp(["#011959", "#0f3d5e", "#1c5a62", "#3c6d56", "#687b3e", "#9d892b", "#d29343", "#f8a17b", "#fdb7bc", "#faccfa"]);
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
export type Palette = "earth" | "rainbow";
export const velocityColor = (v: number, palette: Palette): RGB => (palette === "earth" ? earth : turbo)((v - VRANGE[0]) / (VRANGE[1] - VRANGE[0]));
export const paletteCss = (palette: Palette) => `linear-gradient(90deg, ${Array.from({ length: 11 }, (_, k) => { const [r, g, b] = (palette === "earth" ? earth : turbo)(k / 10); return `rgb(${r | 0},${g | 0},${b | 0})`; }).join(", ")})`;
export const lithologyLegend: [string, string][] = [["Shale", "#7f8a73"], ["Silt", "#a9a886"], ["Sand", "#ecdca6"], ["Carbonate", "#a9c4c7"], ["Basement", "#6b625a"], ["Water", "#dfe7e4"]];

/** Fit a canvas's backing store to its layout width (at the pixel ratio) and the given aspect; returns its context and size. */
export function fit(canvas: HTMLCanvasElement, aspect: number) {
  const dpr = Math.min(2, window.devicePixelRatio || 1), width = Math.max(120, Math.round(canvas.clientWidth * dpr)), height = Math.round(width / aspect);
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  return { c: canvas.getContext("2d")!, width, height, dpr };
}

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
/** A section on a canvas: the image scaled to the canvas, and the faults where they cut rock (with rock above them). */
export function paintSection(canvas: HTMLCanvasElement, f: Frame, look: Look, unitOfBed: Int32Array) {
  const { c, width, height, dpr } = fit(canvas, SECTION_ASPECT);
  c.imageSmoothingEnabled = true; c.imageSmoothingQuality = "high";
  c.drawImage(image(f, look.view, look.palette, look.boundaries, unitOfBed), 0, 0, width, height);
  if (!look.faults) return;
  const rock = (i: number, k: number) => i < 0 || i >= f.nx || k < 0 || k >= f.nz || f.beds[k * f.nx + i] !== -1;
  c.strokeStyle = RUST; c.lineWidth = Math.max(1.25, 1.4 * dpr); c.lineJoin = "round"; c.beginPath();
  for (const t of f.faults) {
    let drawing = false;
    for (let p = 0; p < t.x.length; p++) {
      const i = Math.round(t.x[p] / WIDTH * (f.nx - 1)), k = Math.round(t.z[p] / DEPTH * (f.nz - 1));
      if (!(rock(i, k) && rock(i, k - 1)) || t.x[p] < -40 || t.x[p] > WIDTH + 40) { drawing = false; continue; }
      const X = t.x[p] / WIDTH * width, Y = t.z[p] / DEPTH * height;
      if (drawing) c.lineTo(X, Y); else c.moveTo(X, Y);
      drawing = true;
    }
  }
  c.stroke();
}

/** Axes for velocity (1400-5600 m/s across) against depth (down), with light grid lines every 1000 m/s and 1 km. */
function axes(canvas: HTMLCanvasElement, maxDepth: number) {
  const { c, width, height, dpr } = fit(canvas, canvas.clientWidth > 560 ? 3.2 : 2.2), pad = { l: 34 * dpr, r: 10 * dpr, t: 18 * dpr, b: 10 * dpr };
  c.clearRect(0, 0, width, height);
  const X = (v: number) => pad.l + (width - pad.l - pad.r) * (v - 1400) / 4200, Y = (d: number) => pad.t + (height - pad.t - pad.b) * d / maxDepth;
  c.font = `${10 * dpr}px ui-monospace, SFMono-Regular, Consolas, monospace`; c.fillStyle = MUTED; c.strokeStyle = LINE; c.lineWidth = dpr;
  for (let v = 2000; v <= 5000; v += 1000) { c.beginPath(); c.moveTo(X(v), pad.t); c.lineTo(X(v), height - pad.b); c.stroke(); c.textAlign = "center"; c.fillText(`${v / 1000}`, X(v), pad.t - 6 * dpr); }
  for (let d = 0; d <= maxDepth; d += 1000) { c.beginPath(); c.moveTo(pad.l, Y(d)); c.lineTo(width - pad.r, Y(d)); c.stroke(); c.textAlign = "right"; c.fillText(`${d / 1000}`, pad.l - 6 * dpr, Y(d) + 3 * dpr); }
  c.textAlign = "left"; c.fillText("km/s", width - pad.r - 26 * dpr, pad.t - 6 * dpr);
  return { c, X, Y, dpr };
}
export const PROFILE_COLUMNS: [number, string][] = [[2000, ACCENT], [4600, INK], [7200, RUST]];
/** Velocity with depth in three columns of a frame. */
export function paintProfile(canvas: HTMLCanvasElement, f: Frame) {
  const { c, X, Y, dpr } = axes(canvas, DEPTH);
  for (const [x, color] of PROFILE_COLUMNS) {
    const i = Math.round(x / WIDTH * (f.nx - 1));
    c.strokeStyle = color; c.lineWidth = 1.5 * dpr; c.beginPath();
    for (let k = 0; k < f.nz; k++) { const v = f.velocity[k * f.nx + i], d = k * DEPTH / (f.nz - 1); if (k) c.lineTo(X(v), Y(d)); else c.moveTo(X(v), Y(d)); }
    c.stroke();
  }
}
/** The checks' chart: simulated 10-90% band and median below the sea floor, and reference curves (to their stated depth). */
export function paintVelocityBand(canvas: HTMLCanvasElement, band: { depth: number[]; p10: number[]; p50: number[]; p90: number[] }, refs: { f: (d: number) => number; to: number; color: string; dash: boolean }[]) {
  const { c, X, Y, dpr } = axes(canvas, DEPTH);
  c.fillStyle = "rgba(76,98,70,0.16)"; c.beginPath();
  band.depth.forEach((d, k) => (k ? c.lineTo(X(band.p10[k]), Y(d)) : c.moveTo(X(band.p10[k]), Y(d))));
  for (let k = band.depth.length - 1; k >= 0; k--) c.lineTo(X(band.p90[k]), Y(band.depth[k]));
  c.closePath(); c.fill();
  c.strokeStyle = ACCENT; c.lineWidth = 1.6 * dpr; c.beginPath();
  band.depth.forEach((d, k) => (k ? c.lineTo(X(band.p50[k]), Y(d)) : c.moveTo(X(band.p50[k]), Y(d))));
  c.stroke();
  for (const r of refs) {
    c.strokeStyle = r.color; c.lineWidth = 1.4 * dpr; c.setLineDash(r.dash ? [5 * dpr, 4 * dpr] : []); c.beginPath();
    for (let d = 0; d <= r.to; d += 25) { if (d) c.lineTo(X(r.f(d)), Y(d)); else c.moveTo(X(r.f(d)), Y(d)); }
    c.stroke(); c.setLineDash([]);
  }
}
/** A plain grid of Float32 velocities (the optional reference model). */
export function paintGrid(canvas: HTMLCanvasElement, v: Float32Array, nx: number, nz: number, palette: Palette) {
  const { c, width, height } = fit(canvas, (nx - 1) / (nz - 1)), data = new ImageData(nx, nz);
  for (let n = 0; n < nx * nz; n++) { const rgb = velocityColor(v[n], palette); data.data.set([rgb[0], rgb[1], rgb[2], 255], 4 * n); }
  const off = new OffscreenCanvas(nx, nz); off.getContext("2d")!.putImageData(data, 0, 0);
  c.imageSmoothingEnabled = true; c.drawImage(off, 0, 0, width, height);
}
