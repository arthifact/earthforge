import { append, emptyLayer, portion, sliceColumn, type Column } from './strata';

/** Translate a storage column and account for its open vertical faces.
 * Each rock parcel follows the prescribed displacement at its retained physical
 * x. The difference from the storage-column shift stays in its vertical offset.
 * Boundary selection remains in storage coordinates, as in the column model.
 */
export function subsideColumn(column: Column, x: number, end: number,
  displacement: (x: number) => number, shift = displacement(x)) {
  if (!column.length || !Number.isFinite(x) || !(end > 0) || !Number.isFinite(end) || !Number.isFinite(shift))
    throw Error('Invalid subsidence column or displacement');
  const old = column.map(p => {
    if (p.bed === -1 || p.offsetX === 0) return p;
    const physicalShift = displacement(x + p.offsetX);
    if (!Number.isFinite(physicalShift)) throw Error('Invalid physical subsidence displacement');
    return { ...p, offsetZ: p.offsetZ + (physicalShift - shift) };
  });
  const next: Column = [], outflowTop: Column = [], outflowBottom: Column = [], inflowBottom: Column = [];
  if (shift >= 0) {
    outflowBottom.push(...sliceColumn(old, [end, -Math.min(shift, end)], end));
    append(next, emptyLayer(-1, Math.min(shift, end)));
    for (const p of sliceColumn(old, 0, [end, -Math.min(shift, end)])) append(next, p);
  } else {
    outflowTop.push(...sliceColumn(old, 0, Math.min(-shift, end)));
    for (const p of sliceColumn(old, Math.min(-shift, end), end)) append(next, p);
    const donor = portion(old.at(-1)!, Math.min(-shift, end));
    inflowBottom.push(donor); append(next, donor);
  }
  return { column: next, outflowTop, outflowBottom, inflowBottom };
}
