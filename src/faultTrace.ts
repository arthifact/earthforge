/** A passive fault may be cut into separate branches by a younger fault.
 * Keep physical line segments; averaging column samples is only a projection,
 * never the state transported by the next slip. */
export type TracePoint = [number, number];
export type TraceSegment = [TracePoint, TracePoint];
export function traceFromDepth(depth: Float64Array, h: number, margin = 2000): TraceSegment[] {
  const segments: TraceSegment[] = [];
  for (let i = 0; i + 1 < depth.length; i++) if (Number.isFinite(depth[i]) && Number.isFinite(depth[i + 1]))
    segments.push([[-margin + i * h, depth[i]], [-margin + (i + 1) * h, depth[i + 1]]]);
  return segments;
}
/** Compatibility depth: mean of distinct branch intersections at each column.
 * Shared vertices count once; missing branches remain undefined. */
export function projectTrace(segments: TraceSegment[], nx: number, h: number, margin = 2000) {
  const hits: number[][] = Array.from({ length: nx }, () => []);
  for (const [a, b] of segments) {
    const lo = Math.min(a[0], b[0]), hi = Math.max(a[0], b[0]);
    const first = Math.max(0, Math.ceil((lo + margin - 1e-8) / h)), last = Math.min(nx - 1, Math.floor((hi + margin + 1e-8) / h));
    for (let i = first; i <= last; i++) {
      const t = hi - lo < 1e-10 ? 0.5 : Math.max(0, Math.min(1, (-margin + i * h - a[0]) / (b[0] - a[0])));
      const z = a[1] + t * (b[1] - a[1]);
      if (!hits[i].some(v => Math.abs(v - z) < 1e-7)) hits[i].push(z);
    }
  }
  return Float64Array.from(hits, a => a.length ? a.reduce((s, z) => s + z, 0) / a.length : NaN);
}
/** Split at the active fault before moving the hanging wall. The two sides of
 * a cut retain separate endpoints. A piecewise-affine flow is subdivided at its
 * region changes to an absolute geometric tolerance, independent of cell size. */
export function transportTrace(segments: TraceSegment[], cutKnots: readonly number[], cutDepth: (x: number) => number,
  move: (x: number, z: number) => TracePoint, region: (x: number, z: number) => string) {
  const result: TraceSegment[] = [];
  const point = (a: TracePoint, b: TracePoint, t: number): TracePoint => [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  const advect = (a: TracePoint, b: TracePoint, level = 0) => {
    const c = point(a, b, .5), ma = move(...a), mb = move(...b), mc = move(...c);
    const error = Math.hypot(mc[0] - (ma[0] + mb[0]) / 2, mc[1] - (ma[1] + mb[1]) / 2);
    if (error < 1e-8 && region(...a) === region(...b) && region(...a) === region(...c) || Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-8) {
      result.push([ma, mb]); return;
    }
    if (level >= 40) throw Error('Passive fault flow failed to resolve a bend; trace was not discarded');
    advect(a, c, level + 1); advect(c, b, level + 1);
  };
  for (const [a, b] of segments) {
    const breaks = [0, 1];
    if (a[0] !== b[0]) for (const x of cutKnots) { const t = (x - a[0]) / (b[0] - a[0]); if (t > 0 && t < 1) breaks.push(t); }
    breaks.sort((a, b) => a - b);
    for (let j = 0; j + 1 < breaks.length; j++) {
      const p = point(a, b, breaks[j]), q = point(a, b, breaks[j + 1]);
      const dp = p[1] - cutDepth(p[0]), dq = q[1] - cutDepth(q[0]);
      const portions: TraceSegment[] = dp * dq < 0 ? [[p, point(p, q, dp / (dp - dq))], [point(p, q, dp / (dp - dq)), q]] : [[p, q]];
      for (const [u, v] of portions) {
        const m = point(u, v, .5);
        if (m[1] < cutDepth(m[0]) - 1e-9) advect(u, v);
        else result.push([[...u], [...v]]);
      }
    }
  }
  return result;
}
