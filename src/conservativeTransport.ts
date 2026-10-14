/** Edge costs are rounded at 1e-12 of the maximum parcel weight; BigInt duals
 * give an exact optimum for that quantized objective with deterministic node ties.
 * Within the selected stencil, the raw objective gap is at most N*q*maxWeight,
 * apart from floating cost-evaluation roundoff. Tiny weights retain their parcels
 * even when their costs quantize to zero. Quantization boundaries and changes in
 * source order can still change a tied solution.
 *
 * Conservative categorical remapping. Retained hanging-wall packets are indivisible
 * parcels, each placed once in a distinct hanging-wall cell; no rescaling or
 * cross-bed mixing. Optional heights restrict destinations by their capacity.
 * Optional positive weights scale each parcel's squared placement distance.
 * Sparse minimum-cost matching minimizes quantized weighted squared distance to
 * the flow targets, first within two cells of each rounded target, then three if needed.
 * The selected radius is reported; failure at three cells throws.
 * An infeasible local assignment throws without mutating the caller's state.
 */
export interface TransportParcel { source: number; height?: number; weight?: number; i: number; k: number; targetI?: number; targetK?: number }
export interface TransportAssignment { destination: Int32Array; displaced: number; maxOffsetCells: number; radius: 2 | 3 }
const stencils = new Map<number, [number, number][]>();
for (const radius of [2, 3]) {
  const offsets: [number, number][] = [];
  for (let dk = -radius; dk <= radius; dk++) for (let di = -radius; di <= radius; di++) if (di * di + dk * dk <= radius * radius) offsets.push([di, dk]);
  offsets.sort((a, b) => a[0] ** 2 + a[1] ** 2 - b[0] ** 2 - b[1] ** 2 || a[1] - b[1] || a[0] - b[0]);
  stencils.set(radius, offsets);
}
export class PlacementError extends Error {}

export function assignTransport(nx: number, nz: number, allowed: Uint8Array, parcels: TransportParcel[], capacity?: Float64Array): TransportAssignment {
  try { return solveTransport(nx, nz, allowed, parcels, 2, capacity); }
  catch (error) {
    if (!(error instanceof PlacementError)) throw error;
    return solveTransport(nx, nz, allowed, parcels, 3, capacity);
  }
}
class OverflowError extends Error {}
/** Exact integer arithmetic in Numbers while every stored value stays within 2^51, so sums of three
 * terms are exact; the first value beyond that bound falls back to the BigInt solver, which gives
 * the same answer. Decisions, tie-breaking and the result are identical in both paths. */
function solveTransport(nx: number, nz: number, allowed: Uint8Array, parcels: TransportParcel[], radius: 2 | 3, capacity?: Float64Array): TransportAssignment {
  try { return solveTransportFast(nx, nz, allowed, parcels, radius, capacity); }
  catch (error) {
    if (!(error instanceof OverflowError)) throw error;
    return solveTransportExact(nx, nz, allowed, parcels, radius, capacity);
  }
}
const SAFE = 2 ** 51;
function solveTransportFast(nx: number, nz: number, allowed: Uint8Array, parcels: TransportParcel[], radius: 2 | 3, capacity?: Float64Array): TransportAssignment {
  if (!Number.isInteger(nx) || !Number.isInteger(nz) || nx < 1 || nz < 1 || allowed.length !== nx * nz) throw Error('Invalid transport grid');
  if (capacity && (capacity.length !== nx * nz || capacity.some(c => !Number.isFinite(c) || c < 0))) throw Error('Invalid destination capacity');
  if (parcels.some(p => p.height !== undefined && (!(p.height > 0) || !Number.isFinite(p.height)))) throw Error('Invalid parcel height');
  if (parcels.some(p => p.weight !== undefined && (!(p.weight > 0) || !Number.isFinite(p.weight)))) throw Error('Invalid parcel weight');
  const owner = new Int32Array(allowed.length).fill(-1), destination = new Int32Array(parcels.length).fill(-1);
  const pending: number[] = [], u = new Float64Array(parcels.length), v = new Float64Array(allowed.length);
  const maxWeight = parcels.reduce((m, p) => Math.max(m, p.weight ?? 1), 0) || 1;
  const quantum = 1e-12;
  const fits = (p: number, n: number) => !!allowed[n] && (!capacity || (parcels[p].height ?? 1) <= capacity[n]);
  const weightOf = parcels.map(point => (point.weight ?? 1) / maxWeight);
  const targetI = parcels.map(point => point.targetI ?? point.i), targetK = parcels.map(point => point.targetK ?? point.k);
  const bounded = (x: number) => { if (!(Math.abs(x) <= SAFE)) throw new OverflowError('transport integer beyond the safe Number range'); return x; };
  const cost = (p: number, i: number, k: number) => bounded(Math.round(weightOf[p] * ((i - targetI[p]) ** 2 + (k - targetK[p]) ** 2) / quantum));
  const stencil = stencils.get(radius)!, stencilI = Int32Array.from(stencil, o => o[0]), stencilK = Int32Array.from(stencil, o => o[1]);
  for (let p = 0; p < parcels.length; p++) {
    const { i, k, targetI: ti = i, targetK: tk = k } = parcels[p];
    if (!Number.isInteger(i) || !Number.isInteger(k) || i < 0 || i >= nx || k < 0 || k >= nz) throw Error('Boundary parcels must be accounted before local transport');
    if (!Number.isFinite(ti) || !Number.isFinite(tk) || Math.abs(ti - i) > 0.500000001 || Math.abs(tk - k) > 0.500000001) throw Error('Invalid rounded transport target');
    const nearestI = Math.max(0, Math.min(nx - 1, Math.round(ti))), nearestK = Math.max(0, Math.min(nz - 1, Math.round(tk)));
    const n = nearestK * nx + nearestI;
    if (fits(p, n) && owner[n] < 0) { owner[n] = p; destination[p] = n; }
    else if (fits(p, n) && cost(p, nearestI, nearestK) < cost(owner[n], nearestI, nearestK)) {
      pending.push(owner[n]); destination[owner[n]] = -1; owner[n] = p; destination[p] = n;
    } else pending.push(p);
  }
  for (let p = 0; p < parcels.length; p++) if (destination[p] >= 0) u[p] = cost(p, destination[p] % nx, Math.floor(destination[p] / nx));
  const seenP = new Int32Array(parcels.length), seenN = new Int32Array(allowed.length), doneN = new Int32Array(allowed.length);
  const distP = new Float64Array(parcels.length), distN = new Float64Array(allowed.length), parent = new Int32Array(allowed.length);
  let stamp = 0;
  for (const root of pending) {
    stamp++;
    const touchedP = [root], touchedN: number[] = [], heapN: number[] = [], heapD: number[] = [];
    const precedes = (nA: number, dA: number, nB: number, dB: number) => dA < dB || (dA === dB && nA < nB);
    const push = (n: number, d: number) => {
      let j = heapN.length; heapN.push(n); heapD.push(d);
      while (j > 0) { const q = (j - 1) >> 1; if (!precedes(n, d, heapN[q], heapD[q])) break; heapN[j] = heapN[q]; heapD[j] = heapD[q]; j = q; }
      heapN[j] = n; heapD[j] = d;
    };
    let poppedN = -1, poppedD = 0;
    const pop = () => {
      poppedN = heapN[0]; poppedD = heapD[0];
      const lastN = heapN.pop()!, lastD = heapD.pop()!;
      if (heapN.length) {
        let j = 0;
        while (2 * j + 1 < heapN.length) { let c = 2 * j + 1; if (c + 1 < heapN.length && precedes(heapN[c + 1], heapD[c + 1], heapN[c], heapD[c])) c++; if (!precedes(heapN[c], heapD[c], lastN, lastD)) break; heapN[j] = heapN[c]; heapD[j] = heapD[c]; j = c; }
        heapN[j] = lastN; heapD[j] = lastD;
      }
    };
    const relax = (p: number) => {
      const target = parcels[p];
      for (let o = 0; o < stencilI.length; o++) {
        const i = target.i + stencilI[o], k = target.k + stencilK[o];
        if (i < 0 || i >= nx || k < 0 || k >= nz) continue;
        const n = k * nx + i;
        if (!fits(p, n) || doneN[n] === stamp) continue;
        const reduced = bounded(cost(p, i, k) - u[p] - v[n]);
        if (reduced < 0) throw Error('Invalid transport matching potential');
        const d = bounded(distP[p] + reduced);
        if (seenN[n] !== stamp || d < distN[n]) {
          if (seenN[n] !== stamp) { seenN[n] = stamp; touchedN.push(n); }
          distN[n] = d; parent[n] = p; push(n, d);
        }
      }
    };
    seenP[root] = stamp; distP[root] = 0; relax(root);
    let end = -1, shortest = 0;
    while (heapN.length) {
      pop();
      const n = poppedN, d = poppedD;
      if (doneN[n] === stamp || d > distN[n]) continue;
      doneN[n] = stamp;
      if (owner[n] < 0) { end = n; shortest = d; break; }
      const p = owner[n];
      if (seenP[p] !== stamp) { seenP[p] = stamp; distP[p] = d; touchedP.push(p); relax(p); }
    }
    if (end < 0) throw new PlacementError(`Conservative thrust transport cannot place parcel ${root} within ${radius} cells; no sediment was discarded`);
    for (const p of touchedP) u[p] = bounded(u[p] + (shortest > distP[p] ? shortest - distP[p] : 0));
    for (const n of touchedN) v[n] = bounded(v[n] - (shortest > distN[n] ? shortest - distN[n] : 0));
    for (let n = end; n >= 0;) {
      const p = parent[n], old = destination[p]; owner[n] = p; destination[p] = n; n = old;
    }
  }
  let displaced = 0, maxOffsetCells = 0;
  for (let p = 0; p < parcels.length; p++) {
    const n = destination[p], { i, k } = parcels[p], d = Math.hypot(n % nx - i, Math.floor(n / nx) - k);
    displaced += Number(d > 0); maxOffsetCells = Math.max(maxOffsetCells, d);
  }
  return { destination, displaced, maxOffsetCells, radius };
}
function solveTransportExact(nx: number, nz: number, allowed: Uint8Array, parcels: TransportParcel[], radius: 2 | 3, capacity?: Float64Array): TransportAssignment {
  if (!Number.isInteger(nx) || !Number.isInteger(nz) || nx < 1 || nz < 1 || allowed.length !== nx * nz) throw Error('Invalid transport grid');
  if (capacity && (capacity.length !== nx * nz || capacity.some(c => !Number.isFinite(c) || c < 0))) throw Error('Invalid destination capacity');
  if (parcels.some(p => p.height !== undefined && (!(p.height > 0) || !Number.isFinite(p.height)))) throw Error('Invalid parcel height');
  if (parcels.some(p => p.weight !== undefined && (!(p.weight > 0) || !Number.isFinite(p.weight)))) throw Error('Invalid parcel weight');
  const owner = new Int32Array(allowed.length).fill(-1), destination = new Int32Array(parcels.length).fill(-1);
  const pending: number[] = [], u: bigint[] = Array(parcels.length).fill(0n), v: bigint[] = Array(allowed.length).fill(0n);
  // Relative scaling keeps common positive weight rescaling immaterial.
  const maxWeight = parcels.reduce((m, p) => Math.max(m, p.weight ?? 1), 0) || 1;
  const quantum = 1e-12;
  const fits = (p: number, n: number) => !!allowed[n] && (!capacity || (parcels[p].height ?? 1) <= capacity[n]);
  // One local edge is small enough to round safely as a Number. Path sums
  // and potentials use BigInt so large matchings cannot lose integer units.
  // Weights and targets are read once; each parcel caches the BigInt of every
  // quantized edge cost it meets, so repeated relaxations allocate nothing.
  const weightOf = parcels.map(point => (point.weight ?? 1) / maxWeight);
  const targetI = parcels.map(point => point.targetI ?? point.i), targetK = parcels.map(point => point.targetK ?? point.k);
  const costCache = parcels.map(() => new Map<number, bigint>());
  const cost = (p: number, i: number, k: number) => {
    const quantized = Math.round(weightOf[p] * ((i - targetI[p]) ** 2 + (k - targetK[p]) ** 2) / quantum);
    const cached = costCache[p].get(quantized);
    if (cached !== undefined) return cached;
    const value = BigInt(quantized);
    costCache[p].set(quantized, value);
    return value;
  };
  const stencil = stencils.get(radius)!, stencilI = Int32Array.from(stencil, o => o[0]), stencilK = Int32Array.from(stencil, o => o[1]);
  for (let p = 0; p < parcels.length; p++) {
    const { i, k, targetI = i, targetK = k } = parcels[p];
    if (!Number.isInteger(i) || !Number.isInteger(k) || i < 0 || i >= nx || k < 0 || k >= nz) throw Error('Boundary parcels must be accounted before local transport');
    if (!Number.isFinite(targetI) || !Number.isFinite(targetK) || Math.abs(targetI - i) > 0.500000001 || Math.abs(targetK - k) > 0.500000001) throw Error('Invalid rounded transport target');
    // The accepted half-cell tolerance can straddle a rounding boundary.
    // Initialize at the true nearest in-domain integer target so dual costs
    // are feasible, retaining the supplied i/k only as stencil centers.
    const nearestI = Math.max(0, Math.min(nx - 1, Math.round(targetI))), nearestK = Math.max(0, Math.min(nz - 1, Math.round(targetK)));
    const n = nearestK * nx + nearestI;
    if (fits(p, n) && owner[n] < 0) { owner[n] = p; destination[p] = n; }
    else if (fits(p, n) && cost(p, nearestI, nearestK) < cost(owner[n], nearestI, nearestK)) {
      pending.push(owner[n]); destination[owner[n]] = -1; owner[n] = p; destination[p] = n;
    } else pending.push(p);
  }
  // Exact nearest targets are an optimal partial matching. Maintain feasible
  // dual potentials for shortest augmenting paths (nonnegative reduced costs).
  for (let p = 0; p < parcels.length; p++) if (destination[p] >= 0) u[p] = cost(p, destination[p] % nx, Math.floor(destination[p] / nx));
  const seenP = new Int32Array(parcels.length), seenN = new Int32Array(allowed.length), doneN = new Int32Array(allowed.length);
  const distP: bigint[] = Array(parcels.length).fill(0n), distN: bigint[] = Array(allowed.length).fill(0n), parent = new Int32Array(allowed.length);
  let stamp = 0;
  for (const root of pending) {
    stamp++;
    // A binary heap ordered by distance then cell, in two parallel arrays so no
    // tuple is allocated per push; order and tie-breaking are unchanged.
    const touchedP = [root], touchedN: number[] = [], heapN: number[] = [], heapD: bigint[] = [];
    const precedes = (nA: number, dA: bigint, nB: number, dB: bigint) => dA < dB || (dA === dB && nA < nB);
    const push = (n: number, d: bigint) => {
      let j = heapN.length; heapN.push(n); heapD.push(d);
      while (j > 0) { const p = (j - 1) >> 1; if (!precedes(n, d, heapN[p], heapD[p])) break; heapN[j] = heapN[p]; heapD[j] = heapD[p]; j = p; }
      heapN[j] = n; heapD[j] = d;
    };
    let poppedN = -1, poppedD = 0n;
    const pop = () => {
      poppedN = heapN[0]; poppedD = heapD[0];
      const lastN = heapN.pop()!, lastD = heapD.pop()!;
      if (heapN.length) {
        let j = 0;
        while (2 * j + 1 < heapN.length) { let c = 2 * j + 1; if (c + 1 < heapN.length && precedes(heapN[c + 1], heapD[c + 1], heapN[c], heapD[c])) c++; if (!precedes(heapN[c], heapD[c], lastN, lastD)) break; heapN[j] = heapN[c]; heapD[j] = heapD[c]; j = c; }
        heapN[j] = lastN; heapD[j] = lastD;
      }
    };
    const relax = (p: number) => {
      const target = parcels[p];
      for (let o = 0; o < stencilI.length; o++) {
        const i = target.i + stencilI[o], k = target.k + stencilK[o];
        if (i < 0 || i >= nx || k < 0 || k >= nz) continue;
        const n = k * nx + i;
        if (!fits(p, n) || doneN[n] === stamp) continue;
        const reduced = cost(p, i, k) - u[p] - v[n];
        if (reduced < 0n) throw Error('Invalid transport matching potential');
        const d = distP[p] + reduced;
        if (seenN[n] !== stamp || d < distN[n]) {
          if (seenN[n] !== stamp) { seenN[n] = stamp; touchedN.push(n); }
          distN[n] = d; parent[n] = p; push(n, d);
        }
      }
    };
    seenP[root] = stamp; distP[root] = 0n; relax(root);
    let end = -1, shortest = 0n;
    while (heapN.length) {
      pop();
      const n = poppedN, d = poppedD;
      if (doneN[n] === stamp || d > distN[n]) continue;
      doneN[n] = stamp;
      if (owner[n] < 0) { end = n; shortest = d; break; }
      const p = owner[n];
      if (seenP[p] !== stamp) { seenP[p] = stamp; distP[p] = d; touchedP.push(p); relax(p); }
    }
    if (end < 0) throw new PlacementError(`Conservative thrust transport cannot place parcel ${root} within ${radius} cells; no sediment was discarded`);
    for (const p of touchedP) u[p] += shortest > distP[p] ? shortest - distP[p] : 0n;
    for (const n of touchedN) v[n] -= shortest > distN[n] ? shortest - distN[n] : 0n;
    for (let n = end; n >= 0;) {
      const p = parent[n], old = destination[p]; owner[n] = p; destination[p] = n; n = old;
    }
  }
  let displaced = 0, maxOffsetCells = 0;
  for (let p = 0; p < parcels.length; p++) {
    const n = destination[p], { i, k } = parcels[p], d = Math.hypot(n % nx - i, Math.floor(n / nx) - k);
    displaced += Number(d > 0); maxOffsetCells = Math.max(maxOffsetCells, d);
  }
  return { destination, displaced, maxOffsetCells, radius };
}
