import { layerLengths, withLayerLengths, type Column, type Layer } from './strata';
import type { CapacityShare } from './capacityTransport';
import { exactLengthScale } from './exactLength';
export interface CapacitySlice {
    parcel: number;
    destination: number;
    sourcePart: number;
    sourceLocalTop: number;
    part: Layer;
}
/** Contiguous vertical cuts, never proportional mixtures. Exact binary lengths
 * decide every cut; local floating positions are used only for flow moments.
 * A nonrepresentable difference stays one physical slice with an exact length
 * expansion. Its numerical residual never gets a separate constitutive history.
 */
export function sliceCapacityShares(parcels: {
    parts: Column;
}[], shares: CapacityShare[], nx: number): CapacitySlice[] {
    const out: CapacitySlice[] = [], byParcel: CapacityShare[][] = parcels.map(() => []);
    for (const q of shares)
        byParcel[q.parcel].push(q);
    for (let parcel = 0; parcel < parcels.length; parcel++) {
        const parts = parcels[parcel].parts;
        const group = byParcel[parcel].sort((a, b) => Math.floor(a.destination / nx) - Math.floor(b.destination / nx) || a.destination % nx - b.destination % nx);
        const { units, chunks, number } = exactLengthScale([...parts.flatMap(p => [...layerLengths(p)]), ...group.flatMap(q => q.lengths ?? [q.height])]);
        const shareUnits = (q: CapacityShare) => (q.lengths ?? [q.height]).reduce((sum, h) => sum + units(h), 0n);
        const lengths = parts.map(p => layerLengths(p).reduce((sum, h) => sum + units(h), 0n)), total = lengths.reduce((s, n) => s + n, 0n);
        if (group.reduce((s, p) => s + shareUnits(p), 0n) !== total)
            throw Error('Capacity slices do not exhaust exact source height');
        const pieceGroups: CapacitySlice[][] = parts.map(() => []);
        let sourcePart = 0, consumed = 0n, preceding = 0n;
        for (const share of group) {
            let remaining = shareUnits(share);
            while (remaining > 0n) {
                const available = lengths[sourcePart] - consumed, take = remaining < available ? remaining : available;
                if (!(take > 0n))
                    throw Error('Nonpositive capacity slice');
                const piece = { parcel, destination: share.destination, sourcePart,
                    sourceLocalTop: number(preceding + consumed),
                    part: { ...withLayerLengths(parts[sourcePart], chunks(take)), solid: 0 } };
                pieceGroups[sourcePart].push(piece);
                out.push(piece);
                consumed += take;
                remaining -= take;
                if (consumed === lengths[sourcePart]) {
                    preceding += consumed;
                    consumed = 0n;
                    sourcePart++;
                }
            }
        }
        // Resolve grain arithmetic in ascending slice size. Tiny real slices receive
        // their grain share before the largest slice takes the floating residual.
        for (let j = 0; j < parts.length; j++) {
            const p = parts[j], pieces = [...pieceGroups[j]].sort((a, b) => a.part.height - b.part.height);
            let remaining = p.solid;
            for (let k = 0; k < pieces.length; k++) {
                const q = pieces[k].part;
                q.solid = k + 1 === pieces.length ? remaining : p.solid * (q.height / p.height);
                if (!(q.solid >= 0) || !Number.isFinite(q.solid))
                    throw Error('Invalid sliced grain amount');
                remaining -= q.solid;
            }
        }
    }
    return out;
}
