// Matched-grid diagnostics. No observation files, calibration, or fitted tolerances.
export const INTERVAL_METRICS = ['top_m', 'thickness_m', 'solid_height_m', 'sand_fraction', 'porosity', 'maximum_burial_m', 'effective_loading_m', 'effective_velocity_m_s'];
export const FIELD_METRICS = ['vertical_travel_time_s', 'seafloor_m', 'fault_depth_m'];
export function sequence(values) {
  if (values.length !== 3 || !values.every(Number.isFinite)) throw Error('Expected three finite values at 40/20/10 m');
  const [a, b, c] = values, coarse = a - b, fine = b - c;
  const ratio = coarse === 0 ? null : Math.abs(fine / coarse);
  const classification = coarse === 0 && fine === 0 ? 'stable' : fine === 0 ? 'settled'
    : coarse === 0 ? 'new-change' : `${coarse * fine > 0 ? 'monotonic' : 'oscillatory'}-${ratio < 1 ? 'contracting' : 'noncontracting'}`;
  return { values, coarse, fine, ratio, classification };
}
export function summarize(rows) {
  const n = rows.length, classes = {};
  for (const row of rows) classes[row.classification] = (classes[row.classification] ?? 0) + 1;
  const norm = key => n ? Math.sqrt(rows.reduce((s, r) => s + r[key] ** 2, 0) / n) : null;
  const coarse = norm('coarse'), fine = norm('fine');
  return { n, coarse_rms: coarse, fine_rms: fine, ratio: coarse ? fine / coarse : null,
    coarse_mae: n ? rows.reduce((s, r) => s + Math.abs(r.coarse), 0) / n : null,
    fine_mae: n ? rows.reduce((s, r) => s + Math.abs(r.fine), 0) / n : null,
    coarse_max: n ? Math.max(...rows.map(r => Math.abs(r.coarse))) : null,
    fine_max: n ? Math.max(...rows.map(r => Math.abs(r.fine))) : null, classes };
}
/** A single contiguous interval of the same depositional unit at the same physical x.
 * "complete" means bounded within the window, resolved, and clear of a fault cut;
 * it does not assert that the unit has never been eroded.
 */
export function unitAt(b, x, unit, velocityAt, window = [0, 3000]) {
  const i = Math.round((x + 2000) / b.h), [z0, z1] = window;
  if (i < 0 || i >= b.nx || Math.abs(-2000 + i * b.h - x) > 1e-6) throw Error('Profile must lie on every grid');
  if (b.columns) return continuousUnitAt(b, i, unit, velocityAt, window);
  const first = Math.ceil(z0 / b.h), last = Math.ceil(z1 / b.h), spans = [];
  let start = -1;
  for (let k = first; k <= last; k++) {
    const c = k < last ? b.grid[k * b.nx + i] : -1;
    const matches = c >= 0 && b.beds[c].unit === unit;
    if (matches && start < 0) start = k;
    if (!matches && start >= 0) { spans.push([start, k]); start = -1; }
  }
  if (!spans.length) return { status: 'absent', spans };
  if (spans.length !== 1) return { status: 'fragmented', spans };
  const [k0, k1] = spans[0];
  if (k0 === first || k1 === last) return { status: 'window-boundary', spans };
  if (k1 - k0 < 2) return { status: 'one-cell', spans };
  if (b.faults.some(f => Number.isFinite(f.depth[i]) && f.depth[i] >= k0 * b.h - b.h && f.depth[i] <= k1 * b.h + b.h)) return { status: 'fault-cut', spans };
  let solid = 0, sand = 0, burial = 0, effective = 0, travel = 0;
  for (let k = k0; k < k1; k++) {
    const n = k * b.nx + i, s = b.solid[n];
    solid += s; sand += s * b.sandFraction[n]; burial += s * b.burial[n]; effective += s * b.effectiveBurial[n];
    travel += b.h / velocityAt(i, k);
  }
  const thickness = (k1 - k0) * b.h;
  const metrics = { top_m: k0 * b.h, thickness_m: thickness, solid_height_m: solid,
    sand_fraction: solid ? sand / solid : 0, porosity: 1 - solid / thickness,
    maximum_burial_m: solid ? burial / solid : 0, effective_loading_m: solid ? effective / solid : 0,
    effective_velocity_m_s: thickness / travel };
  if (!Object.values(metrics).every(Number.isFinite)) return { status: 'invalid', spans };
  return { status: 'matched', spans, metrics };
}
function continuousUnitAt(b, i, unit, velocityAt, [z0, z1]) {
  const column = b.columns[i], selected = []; let z = 0, floor = 0, seenRock = false;
  for (const p of column) {
    if (!seenRock && p.bed !== -1) { floor = z; seenRock = true; }
    const end = z + p.height;
    if (p.bed >= 0 && b.beds[p.bed].unit === unit && end > z0 && z < z1) selected.push({ p, top: z, lo: Math.max(z, z0), hi: Math.min(end, z1) });
    z = end;
  }
  const spans = [];
  for (const s of selected) {
    const last = spans.at(-1);
    if (last && Math.abs(last[1] * b.h - s.lo) < 1e-7) last[1] = s.hi / b.h;
    else spans.push([s.lo / b.h, s.hi / b.h]);
  }
  if (!spans.length) return { status: 'absent', spans };
  if (spans.length !== 1) return { status: 'fragmented', spans };
  const top = spans[0][0] * b.h, bottom = spans[0][1] * b.h, thickness = bottom - top;
  if (Math.abs(top - z0) < 1e-7 || Math.abs(bottom - z1) < 1e-7) return { status: 'window-boundary', spans };
  if (thickness < 2 * b.h - 1e-7) return { status: 'one-cell', spans };
  if (b.faults.some(f => Number.isFinite(f.depth[i]) && f.depth[i] >= top - b.h && f.depth[i] <= bottom + b.h)) return { status: 'fault-cut', spans };
  let solid = 0, sand = 0, burial = 0, loading = 0, travel = 0;
  for (const { p, top, lo, hi } of selected) {
    const s = p.solid * (hi - lo) / p.height;
    solid += s; sand += s * p.fraction; burial += s * p.burial; loading += s * p.loading;
    travel += (hi - lo) / velocityAt(i, Math.floor(top / b.h), p, top, floor);
  }
  const metrics = { top_m: top, thickness_m: thickness, solid_height_m: solid, sand_fraction: solid ? sand / solid : 0,
    porosity: 1 - solid / thickness, maximum_burial_m: solid ? burial / solid : 0,
    effective_loading_m: solid ? loading / solid : 0, effective_velocity_m_s: thickness / travel };
  return Object.values(metrics).every(Number.isFinite) ? { status: 'matched', spans, metrics } : { status: 'invalid', spans };
}
export function extract(b, plan, windowOf, layerVelocity) {
  if (b.columns && !layerVelocity) throw Error("Continuous material extraction requires layerVelocity");
  const w = windowOf(b, b, b.h), velocityAt = (i, k, p, top, floor) => p ? layerVelocity(b, p, top, floor) : w.velocity[k * w.nx + i - Math.round(2000 / b.h)];
  const intervals = [], fields = [];
  for (const x of plan.profile_x_m) {
    const i = Math.round((x + 2000) / b.h), wi = Math.round(x / b.h);
    let time = 0;
    for (let k = 0; k * b.h < plan.comparison_window_m.z[1]; k++) time += b.h / w.velocity[k * w.nx + wi];
    fields.push({ key: `time:${x}`, metric: 'vertical_travel_time_s', value: time });
    fields.push({ key: `floor:${x}`, metric: 'seafloor_m', value: w.floor[wi] });
    b.faults.forEach((f, fault) => fields.push({ key: `fault:${fault}:${x}`, metric: 'fault_depth_m', value: Number.isFinite(f.depth[i]) ? f.depth[i] : null }));
    for (let unit = 0; unit < b.log.length; unit++) intervals.push({ key: `unit:${unit}:${x}`, unit, x, ...unitAt(b, x, unit, velocityAt, plan.comparison_window_m.z) });
  }
  return { h: b.h, intervals, fields };
}
export function compare(samples, historyHashes) {
  if (samples.length !== 3 || samples.some((s, j) => s.h !== [40, 20, 10][j])) throw Error('Expected ordered 40/20/10 m grids');
  if (historyHashes.length !== 3 || new Set(historyHashes).size !== 1) throw Error('Prescribed physical histories differ across grids');
  const intervalMaps = samples.map(s => new Map(s.intervals.map(r => [r.key, r])));
  const fieldMaps = samples.map(s => new Map(s.fields.map(r => [r.key, r])));
  const keys = [...new Set(samples.flatMap(s => s.intervals.map(r => r.key)))].sort();
  const series = [], coverage = [];
  for (const key of keys) {
    const triple = intervalMaps.map(m => m.get(key));
    const statuses = triple.map(r => r?.status ?? 'absent');
    const included = statuses.every(s => s === 'matched');
    coverage.push({ key, included, statuses, spans: triple.map(r => r?.spans ?? []) });
    if (included) for (const metric of INTERVAL_METRICS) series.push({ key, metric, ...sequence(triple.map(r => r.metrics[metric])) });
  }
  const fieldCoverage = [];
  for (const key of [...new Set(samples.flatMap(s => s.fields.map(r => r.key)))].sort()) {
    const triple = fieldMaps.map(m => m.get(key)), included = triple.every(r => r && Number.isFinite(r.value));
    fieldCoverage.push({ key, included, values: triple.map(r => r?.value ?? null) });
    if (included) series.push({ key, metric: triple[0].metric, ...sequence(triple.map(r => r.value)) });
  }
  return { history_hash: historyHashes[0], coverage, fieldCoverage, series,
    metrics: Object.fromEntries([...INTERVAL_METRICS, ...FIELD_METRICS].map(m => [m, summarize(series.filter(r => r.metric === m))])) };
}
