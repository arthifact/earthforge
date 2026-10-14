/** Normal-fault geometry sampled at column coordinates. Retain one signed
 * sample above sea level at the shallow end: clamping it to zero discards the
 * fractional tip position and accumulates up to one column of drift per growth
 * step. Negative depths contain no hanging-wall material in the domain. */
export function normalDepth(nx: number, h: number, origin: number, dir: 1 | -1,
  dip: number, detachment: number, margin = 2000) {
  const q = (origin + margin) / h;
  const top = Math.max(0, Math.min(nx - 1, dir > 0 ? Math.floor(q) : Math.ceil(q)));
  const depth = new Float64Array(nx).fill(NaN), tan = Math.tan(dip);
  for (let i = top; i >= 0 && i < nx; i += dir) {
    const distance = dir * (-margin + i * h - origin);
    depth[i] = distance < 0 ? distance * tan : -detachment * Math.expm1(-distance * tan / detachment);
  }
  return { depth, top };
}

/** Extend along the prescribed shallow dip, preserving the zero crossing.
 * The final sample may be negative; it is a geometry guard, not sediment. */
export function extendNormal(depth: Float64Array, top: number, dir: 1 | -1, h: number, dip: number) {
  const z = depth[top], tan = Math.tan(dip);
  if (!(z > 0)) return top;
  let next = top;
  for (let j = 1; ; j++) {
    const i = top - dir * j;
    if (i < 0 || i >= depth.length) break;
    depth[i] = z - j * h * tan; next = i;
    if (depth[i] <= 0) break;
  }
  return next;
}
