/** Exact-capacity fallback for an infeasible indivisible transport assignment.
 * It keeps the existing2/3-cell parent-target stencil and quantized squared
 * displacement objective per unit volume. Source material remains distinct;
 * vertical slicing and child-flow reconstruction are separate operations. */
import { exactLengthScale } from './exactLength';
export interface CapacityParcel {
    source: number;
    height?: number;
    weight?: number;
    materialHeights?: number[];
    i: number;
    k: number;
    targetI?: number;
    targetK?: number;
}
export interface CapacityShare {
    parcel: number;
    destination: number;
    height: number;
    /** Exact positive expansion of this one allocated volume, when needed. */
    lengths?: number[];
}
class PackingError extends Error {
}
export function assignCapacityTransport(nx: number, nz: number, allowed: Uint8Array, parcels: CapacityParcel[], capacity: Float64Array) {
    try {
        return solve(nx, nz, allowed, parcels, capacity, 2);
    }
    catch (error) {
        if (!(error instanceof PackingError))
            throw error;
        return solve(nx, nz, allowed, parcels, capacity, 3);
    }
}
function solve(nx: number, nz: number, allowed: Uint8Array, parcels: CapacityParcel[], capacity: Float64Array, radius: 2 | 3) {
    if (!Number.isInteger(nx) || !Number.isInteger(nz) || nx < 1 || nz < 1 || allowed.length !== nx * nz || capacity.length !== nx * nz || capacity.some(c => !Number.isFinite(c) || c < 0))
        throw Error('Invalid capacity grid');
    if (parcels.some(p => !(p.height === undefined || p.height > 0 && Number.isFinite(p.height)) ||
        !(p.weight === undefined || p.weight > 0 && Number.isFinite(p.weight)) ||
        p.materialHeights !== undefined && (!p.materialHeights.length || p.materialHeights.some(h => !(h > 0) || !Number.isFinite(h)))))
        throw Error('Invalid capacity parcel');
    const offsets: [
        number,
        number
    ][] = [];
    for (let dk = -radius; dk <= radius; dk++)
        for (let di = -radius; di <= radius; di++)
            if (di * di + dk * dk <= radius * radius)
                offsets.push([di, dk]);
    offsets.sort((a, b) => a[0] ** 2 + a[1] ** 2 - b[0] ** 2 - b[1] ** 2 || a[1] - b[1] || a[0] - b[0]);
    const maxWeight = parcels.reduce((m, p) => Math.max(m, (p.weight ?? 1) / (p.height ?? 1)), 0);
    const logDensity = parcels.map(p => Math.log(p.weight ?? 1) - Math.log(p.height ?? 1));
    const maxLogDensity = logDensity.reduce((a, b) => Math.max(a, b), -Infinity);
    // Per-parcel weight and target once; the quantized cost is an exact integer Number, converted to the
    // same BigInt as before and cached per parcel so repeated relaxations of one arc allocate nothing.
    const weightOf = parcels.map((q, p) => maxWeight >= 2 ** -1022 && Number.isFinite(maxWeight) ? (q.weight ?? 1) / (q.height ?? 1) / maxWeight : Math.exp(logDensity[p] - maxLogDensity));
    const targetI = parcels.map(q => q.targetI ?? q.i), targetK = parcels.map(q => q.targetK ?? q.k);
    const costCache = parcels.map(() => new Map<number, bigint>());
    const cost = (p: number, i: number, k: number) => {
        const quantized = Math.round(weightOf[p] * ((i - targetI[p]) ** 2 + (k - targetK[p]) ** 2) / 1e-12);
        const cached = costCache[p].get(quantized);
        if (cached !== undefined)
            return cached;
        const value = BigInt(quantized);
        costCache[p].set(quantized, value);
        return value;
    };
    const { units, chunks, number } = exactLengthScale([...parcels.flatMap(p => p.materialHeights ?? [p.height ?? 1]), ...capacity]);
    const min = (a: bigint, b: bigint) => a < b ? a : b;
    const offsetI = Int32Array.from(offsets, o => o[0]), offsetK = Int32Array.from(offsets, o => o[1]);
    const sourceUnits = parcels.map(p => (p.materialHeights ?? [p.height ?? 1]).reduce((s, h) => s + units(h), 0n));
    const remaining = sourceUnits.slice(), free = Array.from(capacity, (c, n) => allowed[n] ? units(c) : 0n);
    const owners = Array.from({ length: allowed.length }, () => new Map<number, bigint>()), u = parcels.map(() => 0n), v = Array<bigint>(allowed.length).fill(0n);
    const nearest = new Map<number, number[]>();
    for (let p = 0; p < parcels.length; p++) {
        const q = parcels[p], tx = q.targetI ?? q.i, tz = q.targetK ?? q.k;
        if (!(remaining[p] > 0n) || !((q.weight ?? 1) > 0) || !Number.isFinite(q.weight ?? 1))
            throw Error('Invalid source capacity/weight');
        if (!Number.isInteger(q.i) || !Number.isInteger(q.k) || q.i < 0 || q.i >= nx || q.k < 0 || q.k >= nz || !Number.isFinite(tx) || !Number.isFinite(tz) || Math.abs(q.i - tx) > .500000001 || Math.abs(q.k - tz) > .500000001)
            throw Error('Invalid rounded transport target');
        const i = Math.max(0, Math.min(nx - 1, Math.round(tx))), k = Math.max(0, Math.min(nz - 1, Math.round(tz))), n = k * nx + i;
        if (allowed[n] && free[n] > 0n) {
            let group = nearest.get(n);
            if (!group)
                nearest.set(n, group = []);
            group.push(p);
        }
    }
    for (const [n, group] of nearest) {
        group.sort((a, b) => { const ca = cost(a, n % nx, Math.floor(n / nx)), cb = cost(b, n % nx, Math.floor(n / nx)); return ca < cb ? -1 : ca > cb ? 1 : a - b; });
        for (const p of group) {
            const f = min(remaining[p], free[n]);
            if (!(f > 0n))
                break;
            owners[n].set(p, f);
            remaining[p] -= f;
            free[n] -= f;
            u[p] = cost(p, n % nx, Math.floor(n / nx));
        }
    }
    const seenP = new Int32Array(parcels.length), seenN = new Int32Array(allowed.length), doneN = new Int32Array(allowed.length);
    const distP = parcels.map(() => 0n), distN = Array<bigint>(allowed.length).fill(0n), parentP = new Int32Array(parcels.length), parentN = new Int32Array(allowed.length);
    let stamp = 0, augmentations = 0;
    for (let root = 0; root < parcels.length; root++)
        while (remaining[root] > 0n) {
            stamp++;
            augmentations++;
            // A binary heap ordered by distance then cell, kept in two parallel arrays so that
            // no tuple is allocated per push; the order and tie-breaking are unchanged.
            const touchedP = [root], touchedN: number[] = [], heapN: number[] = [], heapD: bigint[] = [];
            const precedes = (nA: number, dA: bigint, nB: number, dB: bigint) => dA < dB || (dA === dB && nA < nB);
            const push = (n: number, d: bigint) => { let j = heapN.length; heapN.push(n); heapD.push(d); while (j > 0) {
                const p = (j - 1) >> 1;
                if (!precedes(n, d, heapN[p], heapD[p]))
                    break;
                heapN[j] = heapN[p]; heapD[j] = heapD[p];
                j = p;
            } heapN[j] = n; heapD[j] = d; };
            let poppedN = -1, poppedD = 0n;
            const pop = () => { poppedN = heapN[0]; poppedD = heapD[0]; const lastN = heapN.pop()!, lastD = heapD.pop()!; if (heapN.length) {
                let j = 0;
                while (2 * j + 1 < heapN.length) {
                    let c = 2 * j + 1;
                    if (c + 1 < heapN.length && precedes(heapN[c + 1], heapD[c + 1], heapN[c], heapD[c]))
                        c++;
                    if (!precedes(heapN[c], heapD[c], lastN, lastD))
                        break;
                    heapN[j] = heapN[c]; heapD[j] = heapD[c];
                    j = c;
                }
                heapN[j] = lastN; heapD[j] = lastD;
            } };
            const relax = (p: number) => {
                const q = parcels[p];
                for (let o = 0; o < offsetI.length; o++) {
                    const i = q.i + offsetI[o], k = q.k + offsetK[o];
                    if (i < 0 || i >= nx || k < 0 || k >= nz)
                        continue;
                    const n = k * nx + i;
                    if (!allowed[n] || doneN[n] === stamp || !(capacity[n] > 0))
                        continue;
                    const reduced = cost(p, i, k) - u[p] - v[n];
                    if (reduced < 0n)
                        throw Error('Invalid capacity-flow potential');
                    const d = distP[p] + reduced;
                    if (seenN[n] !== stamp || d < distN[n]) {
                        if (seenN[n] !== stamp) {
                            seenN[n] = stamp;
                            touchedN.push(n);
                        }
                        distN[n] = d;
                        parentN[n] = p;
                        push(n, d);
                    }
                }
            };
            seenP[root] = stamp;
            distP[root] = 0n;
            parentP[root] = -1;
            relax(root);
            let end = -1, shortest = 0n;
            while (heapN.length) {
                pop();
                const n = poppedN, d = poppedD;
                if (doneN[n] === stamp || d > distN[n])
                    continue;
                doneN[n] = stamp;
                if (free[n] > 0n) {
                    end = n;
                    shortest = d;
                    break;
                }
                for (const [p, f] of owners[n])
                    if (f > 0n && seenP[p] !== stamp) {
                        const reverse = u[p] + v[n] - cost(p, n % nx, Math.floor(n / nx));
                        if (reverse !== 0n)
                            throw Error('Non-tight capacity-flow edge');
                        seenP[p] = stamp;
                        distP[p] = d;
                        parentP[p] = n;
                        touchedP.push(p);
                        relax(p);
                    }
            }
            if (end < 0)
                throw new PackingError(`Capacity flow cannot place source ${root} within ${radius} cells (${remaining[root]} height remains)`);
            let amount = min(remaining[root], free[end]);
            for (let n = end;;) {
                const p = parentN[n], old = parentP[p];
                if (old < 0)
                    break;
                amount = min(amount, owners[old].get(p)!);
                n = old;
            }
            if (!(amount > 0n))
                throw Error('Nonpositive capacity-flow augmentation');
            for (const p of touchedP)
                u[p] += shortest > distP[p] ? shortest - distP[p] : 0n;
            for (const n of touchedN)
                v[n] -= shortest > distN[n] ? shortest - distN[n] : 0n;
            remaining[root] -= amount;
            free[end] -= amount;
            for (let n = end;;) {
                const p = parentN[n], old = parentP[p];
                owners[n].set(p, (owners[n].get(p) ?? 0n) + amount);
                if (old < 0)
                    break;
                const before = owners[old].get(p)!;
                if (amount === before)
                    owners[old].delete(p);
                else
                    owners[old].set(p, before - amount);
                n = old;
            }
        }
    const shares: CapacityShare[] = [], sourceSum = Array<bigint>(parcels.length).fill(0n), destinationSum = Array<bigint>(allowed.length).fill(0n);
    let maxOffsetCells = 0, splitSources = 0;
    const counts = new Int32Array(parcels.length);
    for (let n = 0; n < owners.length; n++)
        for (const [p, height] of owners[n])
            if (height > 0n) {
                const lengths = chunks(height);
                shares.push({ parcel: p, destination: n, height: number(height),
                    ...(lengths.length > 1 ? { lengths } : {}) });
                sourceSum[p] += height;
                destinationSum[n] += height;
                counts[p]++;
                maxOffsetCells = Math.max(maxOffsetCells, Math.hypot(n % nx - parcels[p].i, Math.floor(n / nx) - parcels[p].k));
            }
    for (let p = 0; p < parcels.length; p++) {
        if (sourceSum[p] !== sourceUnits[p])
            throw Error('Source capacity-flow balance failure');
        if (counts[p] > 1)
            splitSources++;
    }
    for (let n = 0; n < owners.length; n++)
        if (destinationSum[n] > units(capacity[n]))
            throw Error('Destination capacity-flow balance failure');
    return { shares, radius, maxOffsetCells, splitSources, augmentations };
}
