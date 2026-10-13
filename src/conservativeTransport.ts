/** Conservative categorical remapping. Retained rock cells are indivisible
 * parcels, each placed once in a distinct hanging-wall cell; no rescaling or
 * cross-bed mixing. Sparse minimum-cost matching minimizes squared distance to
 * the flow targets, first within two cells of each rounded target, then three if needed.
 * The selected radius is reported; failure at three cells throws.
 * An infeasible local assignment throws without mutating the caller's state.
 */
export interface TransportParcel { source: number; i: number; k: number; targetI?: number; targetK?: number }
export interface TransportAssignment { destination: Int32Array; displaced: number; maxOffsetCells: number; radius: 2 | 3 }
const stencils = new Map<number, [number, number][]>();
for (const radius of [2, 3]) {
  const offsets: [number, number][] = [];
  for (let dk = -radius; dk <= radius; dk++) for (let di = -radius; di <= radius; di++) if (di * di + dk * dk <= radius * radius) offsets.push([di, dk]);
  offsets.sort((a, b) => a[0] ** 2 + a[1] ** 2 - b[0] ** 2 - b[1] ** 2 || a[1] - b[1] || a[0] - b[0]);
  stencils.set(radius, offsets);
}
class PlacementError extends Error {}

export function assignTransport(nx: number, nz: number, allowed: Uint8Array, parcels: TransportParcel[]): TransportAssignment {
  try { return solveTransport(nx, nz, allowed, parcels, 2); }
  catch (error) {
    if (!(error instanceof PlacementError)) throw error;
    return solveTransport(nx, nz, allowed, parcels, 3);
  }
}
function solveTransport(nx: number, nz: number, allowed: Uint8Array, parcels: TransportParcel[], radius: 2 | 3): TransportAssignment {
  if (!Number.isInteger(nx) || !Number.isInteger(nz) || nx < 1 || nz < 1 || allowed.length !== nx * nz) throw Error('Invalid transport grid');
  const owner = new Int32Array(allowed.length).fill(-1), destination = new Int32Array(parcels.length).fill(-1);
  const pending: number[] = [], u = new Float64Array(parcels.length), v = new Float64Array(allowed.length);
  const cost = (p: number, i: number, k: number) => {
    const point = parcels[p]; return (i - (point.targetI ?? point.i)) ** 2 + (k - (point.targetK ?? point.k)) ** 2;
  };
  for (let p = 0; p < parcels.length; p++) {
    const { i, k, targetI = i, targetK = k } = parcels[p];
    if (!Number.isInteger(i) || !Number.isInteger(k) || i < 0 || i >= nx || k < 0 || k >= nz) throw Error('Boundary parcels must be accounted before local transport');
    if (!Number.isFinite(targetI) || !Number.isFinite(targetK) || Math.abs(targetI - i) > 0.500000001 || Math.abs(targetK - k) > 0.500000001) throw Error('Invalid rounded transport target');
    const n = k * nx + i;
    if (allowed[n] && owner[n] < 0) { owner[n] = p; destination[p] = n; }
    else if (allowed[n] && cost(p, i, k) < cost(owner[n], i, k)) {
      pending.push(owner[n]); destination[owner[n]] = -1; owner[n] = p; destination[p] = n;
    } else pending.push(p);
  }
  // Exact nearest targets are an optimal partial matching. Maintain feasible
  // dual potentials for shortest augmenting paths (nonnegative reduced costs).
  for (let p = 0; p < parcels.length; p++) if (destination[p] >= 0) u[p] = cost(p, parcels[p].i, parcels[p].k);
  const seenP = new Int32Array(parcels.length), seenN = new Int32Array(allowed.length), doneN = new Int32Array(allowed.length);
  const distP = new Float64Array(parcels.length), distN = new Float64Array(allowed.length), parent = new Int32Array(allowed.length);
  let stamp = 0;
  for (const root of pending) {
    stamp++;
    const touchedP = [root], touchedN: number[] = [], heap: [number, number][] = [];
    const push = (n: number, d: number) => {
      let j = heap.length; heap.push([n, d]);
      while (j > 0) { const p = (j - 1) >> 1; if (heap[p][1] <= d) break; heap[j] = heap[p]; j = p; }
      heap[j] = [n, d];
    };
    const pop = () => {
      const first = heap[0], last = heap.pop()!;
      if (heap.length) {
        let j = 0;
        while (2 * j + 1 < heap.length) { let c = 2 * j + 1; if (c + 1 < heap.length && heap[c + 1][1] < heap[c][1]) c++; if (heap[c][1] >= last[1]) break; heap[j] = heap[c]; j = c; }
        heap[j] = last;
      }
      return first;
    };
    const relax = (p: number) => {
      const target = parcels[p];
      for (const [di, dk] of stencils.get(radius)!) {
        const i = target.i + di, k = target.k + dk;
        if (i < 0 || i >= nx || k < 0 || k >= nz) continue;
        const n = k * nx + i;
        if (!allowed[n] || doneN[n] === stamp) continue;
        const reduced = cost(p, i, k) - u[p] - v[n];
        if (reduced < -1e-7) throw Error('Invalid transport matching potential');
        const d = distP[p] + Math.max(0, reduced);
        if (seenN[n] !== stamp || d < distN[n] - 1e-12) {
          if (seenN[n] !== stamp) { seenN[n] = stamp; touchedN.push(n); }
          distN[n] = d; parent[n] = p; push(n, d);
        }
      }
    };
    seenP[root] = stamp; distP[root] = 0; relax(root);
    let end = -1, shortest = 0;
    while (heap.length) {
      const [n, d] = pop();
      if (doneN[n] === stamp || d > distN[n] + 1e-12) continue;
      doneN[n] = stamp;
      if (owner[n] < 0) { end = n; shortest = d; break; }
      const p = owner[n];
      if (seenP[p] !== stamp) { seenP[p] = stamp; distP[p] = d; touchedP.push(p); relax(p); }
    }
    if (end < 0) throw new PlacementError(`Conservative thrust transport cannot place parcel ${root} within ${radius} cells; no sediment was discarded`);
    for (const p of touchedP) u[p] += Math.max(0, shortest - distP[p]);
    for (const n of touchedN) v[n] -= Math.max(0, shortest - distN[n]);
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
