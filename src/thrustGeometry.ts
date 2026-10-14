/** Physical thrust bends. Surface intersections are solved on the piecewise
 * linear column surface, rather than chosen at the first grid point beyond it. */
export type Point = [number, number];
export function thrustGeometry(x1: number, transport: 1 | -1, dip: number, zd: number, zu: number,
  xs: number[], floor: (x: number) => number, emergent: boolean): Point[] {
  const back = transport > 0 ? xs[0] : xs.at(-1)!, front = transport > 0 ? xs.at(-1)! : xs[0];
  const ramp = (x: number) => zd - transport * (x - x1) * Math.tan(dip);
  const ahead = xs.filter(x => transport * (x - x1) > 0).sort((a, b) => transport * (a - b));
  const intersection = (upper: (x: number) => number) => {
    let a = x1, da = ramp(a) - upper(a);
    if (da <= 0) return a;
    for (const x of ahead) {
      const d = ramp(x) - upper(x);
      if (d <= 0) return a + (x - a) * da / (da - d);
      a = x; da = d;
    }
    return front;
  };
  let upper = (_x: number) => zu;
  if (emergent) {
    const a = intersection(floor), za = floor(a), zf = floor(front);
    const chord = (x: number) => za + (zf - za) * (x - a) / (front - a || 1);
    // Both floor and chord are linear between knots; their maximum difference
    // is at a knot. Include the exact intersection and both open-edge values.
    const lower = Math.max(0, ...xs.filter(x => transport * (x - a) >= 0).map(x => floor(x) - chord(x)));
    upper = (x: number) => chord(x) + lower;
  }
  const x2 = intersection(upper), z2 = Math.max(ramp(x2), upper(x2));
  const points: Point[] = [[back, zd], [x1, zd], [x2, z2], [front, Math.max(ramp(front), upper(front))]];
  return points.filter((p, j) => j === 0 || p[0] !== points[j - 1][0]);
}

/** Sample a column field at a physical position without snapping its marker. */
export function sampleColumns(x: number, h: number, nx: number, value: (i: number) => number, margin = 2000) {
  const q = Math.max(0, Math.min(nx - 1, (x + margin) / h)), i = Math.floor(q), j = Math.min(nx - 1, i + 1);
  return value(i) + (q - i) * (value(j) - value(i));
}

export interface Marker { point: Point; oldDepth: number; nextDepth: number }
export const markersOf = (points: Point[]): Marker[] => points.map(point => ({ point, oldDepth: point[1], nextDepth: 0 }));
/** Apply a vertical deformation at the two columns bracketing each marker.
 * Keep its old depth until both contributions are known. */
export function mapMarkerColumn(markers: Marker[], i: number, h: number, nx: number, map: (z: number) => number, margin = 2000) {
  for (const m of markers) {
    const q = Math.max(0, Math.min(nx - 1, (m.point[0] + margin) / h));
    const weight = Math.max(0, 1 - Math.abs(q - i));
    if (weight) m.nextDepth += weight * map(m.oldDepth);
  }
}
