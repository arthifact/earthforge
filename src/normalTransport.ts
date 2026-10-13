/** Exact vertical shear of continuous layers. Horizontal displacement retains
 * the existing integer-column heave/carry rule; vertical motion never rounds
 * a material contact to a raster row. */
import { append, emptyLayer, portion, sliceColumn, type Column, type Layer } from './strata';
import { addParcel, emptyFluxes, type Inventory } from './sedimentBudget';
export interface NormalTransfer { source: Layer; moved: Layer; sourceColumn: number; destinationColumn: number }
export function remapNormal(columns: Column[], depth: Float64Array, cells: number, dir: 1 | -1,
  h: number, end: number, beds: { carbonate: boolean }[], trace = false) {
  const nx = columns.length, flux = emptyFluxes(), transfers: NormalTransfer[] = [];
  let rockIn = 0, rockOut = 0;
  const clipped = (d: number) => Math.max(0, Math.min(end, d));
  const flow = (to: Inventory, parts: Column, incoming: boolean) => {
    for (const p of parts) {
      if (p.bed >= 0) addParcel(to, p.bed, p.solid, p.fraction, beds[p.bed].carbonate, h);
      if (p.bed !== -1) { if (incoming) rockIn += p.height; else rockOut += p.height; }
    }
  };
  // Forward source tally is independent of destination assembly.
  for (let i = 0; i < nx; i++) {
    if (!Number.isFinite(depth[i])) continue;
    const hi = clipped(depth[i]), dest = i + dir * cells;
    if (dest < 0 || dest >= nx) { flow(flux.outflow[dest < 0 ? 'left' : 'right'], sliceColumn(columns[i], 0, hi), false); continue; }
    if (!Number.isFinite(depth[dest])) throw Error('Normal transport has an undefined interior destination');
    const dz = depth[dest] - depth[i];
    flow(flux.outflow.top, sliceColumn(columns[i], 0, Math.min(hi, Math.max(0, -dz))), false);
    flow(flux.outflow.bottom, sliceColumn(columns[i], Math.max(0, end - dz), hi), false);
  }
  const next = columns.map((old, i) => {
    if (!Number.isFinite(depth[i])) return old;
    const hi = clipped(depth[i]), source = i - dir * cells, zs = source >= 0 && source < nx ? depth[source] : NaN;
    const out: Column = [];
    if (!Number.isFinite(zs)) append(out, emptyLayer(-1, hi));
    else {
      const dz = depth[i] - zs;
      append(out, emptyLayer(-1, Math.min(hi, Math.max(0, dz))));
      const lo = Math.max(0, -dz), upper = Math.min(end, zs, hi - dz);
      let z = 0;
      for (const p of columns[source]) {
        const overlap = Math.min(z + p.height, upper) - Math.max(z, lo);
        if (overlap > 0) {
          const moved = portion(p, overlap); append(out, moved);
          if (trace && p.bed >= 0) transfers.push({ source: p, moved, sourceColumn: source, destinationColumn: i });
        }
        z += p.height; if (z >= upper) break;
      }
      const incoming = Math.max(0, Math.min(zs, hi - dz) - Math.max(end, lo));
      if (incoming) {
        const p = columns[source].at(-1)!, moved = portion(p, incoming);
        append(out, moved); flow(flux.inflow.bottom, [moved], true);
        if (trace && p.bed >= 0) transfers.push({ source: p, moved, sourceColumn: source, destinationColumn: i });
      }
    }
    for (const p of sliceColumn(old, hi, end)) append(out, p);
    return out;
  });
  const rock = (cs: Column[]) => cs.reduce((sum, c) => sum + c.reduce((s, p) => s + (p.bed === -1 ? 0 : p.height), 0), 0);
  const before = rock(columns), after = rock(next);
  return { columns: next, flux, transfers, areaError: before ? Math.abs(after - before - rockIn + rockOut) / before : 0 };
}
