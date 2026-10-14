/** Continuous normal-fault shear. Integer-column heave is unchanged; exact
 * represented lengths partition the moving column and its boundary fluxes. */
import { append, emptyLayer, layerLengths, portionByLengths, withLayerLengths, type Column, type Layer } from './strata';
import { exactLengthScale } from './exactLength';
import { addParcel, emptyFluxes, type Inventory } from './sedimentBudget';
export interface NormalTransfer { source: Layer; moved: Layer; sourceColumn: number; destinationColumn: number }
type LengthScale = ReturnType<typeof exactLengthScale>;
const min = (...values: bigint[]) => values.reduce((a, b) => a < b ? a : b);
const max = (...values: bigint[]) => values.reduce((a, b) => a > b ? a : b);
const scaleFor = (columns: Column[], coordinates: number[]) => exactLengthScale([
  ...columns.flatMap(column => column.flatMap(p => [...layerLengths(p)])), ...coordinates.map(Math.abs),
]);

/** Keep source associations for diagnostic transfers, including partial cuts. */
function cut(column: Column, lower: bigint, upper: bigint, scale: LengthScale,
  visit?: (source: Layer, moved: Layer) => void): Column {
  const result: Column = []; let top = 0n;
  for (const source of column) {
    const length = layerLengths(source).reduce((sum, height) => sum + scale.units(height), 0n), bottom = top + length;
    const take = min(bottom, upper) - max(top, lower, 0n);
    if (take > 0n) {
      const parts = take === length ? [{ ...source }] : [portionByLengths(source, scale.chunks(take))];
      for (const moved of parts) { append(result, moved); visit?.(source, moved); }
    }
    top = bottom; if (top >= upper) break;
  }
  return result;
}

export function remapNormal(columns: Column[], depth: Float64Array, cells: number, dir: 1 | -1,
  h: number, end: number, beds: { carbonate: boolean }[], trace = false) {
  const nx = columns.length, flux = emptyFluxes(), transfers: NormalTransfer[] = [];
  let rockIn = 0, rockOut = 0;
  const signed = (scale: LengthScale, x: number) => x < 0 ? -scale.units(-x) : scale.units(x);
  const flow = (to: Inventory, parts: Column, incoming: boolean) => {
    for (const p of parts) {
      if (p.bed >= 0) addParcel(to, p.bed, p.solid, p.fraction, beds[p.bed].carbonate, h);
      if (p.bed !== -1) { if (incoming) rockIn += p.height; else rockOut += p.height; }
    }
  };
  // Forward flux tally uses precisely the same physical cut as reconstruction.
  for (let i = 0; i < nx; i++) {
    if (!Number.isFinite(depth[i])) continue;
    const dest = i + dir * cells;
    const targetDepth = dest >= 0 && dest < nx ? depth[dest] : depth[i];
    if (!Number.isFinite(targetDepth)) throw Error('Normal transport has an undefined interior destination');
    const scale = scaleFor([columns[i]], [end, depth[i], targetDepth]);
    const domain = scale.units(end), sourceDepth = signed(scale, depth[i]);
    const hi = max(0n, min(domain, sourceDepth));
    if (dest < 0 || dest >= nx) {
      flow(flux.outflow[dest < 0 ? 'left' : 'right'], cut(columns[i], 0n, hi, scale), false);
      continue;
    }
    const dz = signed(scale, targetDepth) - sourceDepth;
    flow(flux.outflow.top, cut(columns[i], 0n, min(hi, max(0n, -dz)), scale), false);
    flow(flux.outflow.bottom, cut(columns[i], max(0n, domain - dz), hi, scale), false);
  }
  const next = columns.map((old, i) => {
    if (!Number.isFinite(depth[i])) return old;
    const source = i - dir * cells, zs = source >= 0 && source < nx ? depth[source] : NaN;
    const donor = Number.isFinite(zs) ? columns[source] : [];
    const scale = scaleFor([old, donor], [end, depth[i], ...(Number.isFinite(zs) ? [zs] : [])]);
    const domain = scale.units(end), destinationDepth = signed(scale, depth[i]);
    const hi = max(0n, min(domain, destinationDepth)), out: Column = [];
    const water = (length: bigint) => { if (length > 0n) append(out, withLayerLengths(emptyLayer(-1, 1), scale.chunks(length))); };
    if (!Number.isFinite(zs)) water(hi);
    else {
      const sourceDepth = signed(scale, zs), dz = destinationDepth - sourceDepth;
      water(min(hi, max(0n, dz)));
      const lower = max(0n, -dz), upper = min(domain, sourceDepth, hi - dz);
      const visit = (p: Layer, moved: Layer) => {
        if (trace && p.bed >= 0) transfers.push({ source: p, moved, sourceColumn: source, destinationColumn: i });
      };
      for (const p of cut(donor, lower, upper, scale, visit)) append(out, p);
      const incoming = max(0n, min(sourceDepth, hi - dz) - max(domain, lower));
      if (incoming > 0n) {
        const p = donor.at(-1)!;
        const moved = portionByLengths(p, scale.chunks(incoming));
        append(out, moved); flow(flux.inflow.bottom, [moved], true); visit(p, moved);
      }
    }
    for (const p of cut(old, hi, domain, scale)) append(out, p);
    return out;
  });
  const rock = (cs: Column[]) => cs.reduce((sum, c) => sum + c.reduce((s, p) => s + (p.bed === -1 ? 0 : p.height), 0), 0);
  const before = rock(columns), after = rock(next);
  return { columns: next, flux, transfers, areaError: before ? Math.abs(after - before - rockIn + rockOut) / before : 0 };
}
