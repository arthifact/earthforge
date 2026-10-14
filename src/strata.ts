/** Continuous material columns. The raster is a projection, never the inventory.
 * A layer may be arbitrarily thinner than an output cell. All pieces retain
 * their depositional identity, grains, composition and irreversible memories. */
export interface Layer {
  bed: number; height: number; solid: number; fraction: number;
  burial: number; loading: number; offsetX: number; offsetZ: number;
  /** Complete exact interval expansion of this ONE physical parcel, when its
   * span is not a single Number. height is the Number-valued projection. */
  lengths?: readonly number[];
}
export type Column = Layer[];
export interface ColumnPhysics {
  porosity: (fraction: number, depth: number, carbonate: boolean) => number;
  effectiveDepth: (depth: number, pressure: number | null) => number;
}
/** Maximum midpoint material quadrature length, not a minimum bed thickness.
 * Fixed in physical units across display grids; transport may split it further. */
export const MATERIAL_QUADRATURE_M = 10;
export const emptyLayer = (bed: number, height: number): Layer => ({ bed, height, solid: 0, fraction: 0, burial: 0, loading: 0, offsetX: 0, offsetZ: 0 });
export const portion = (p: Layer, height: number): Layer => portionByLengths(p, [height]);
import { exactLengthScale as lengthScale, exactLengthScaleAt, exponentWith, type LengthScale } from './exactLength';

/** The exact scale spanned by these columns and extra lengths, found without expanding any arrays. */
export function columnScale(columns: readonly Column[], extra: readonly number[] = []): LengthScale {
  let exponent = 0;
  for (const column of columns) for (const p of column) {
    if (p.lengths) for (const h of p.lengths) exponent = exponentWith(h, exponent);
    else exponent = exponentWith(p.height, exponent);
  }
  for (const x of extra) exponent = exponentWith(x, exponent);
  return exactLengthScaleAt(exponent);
}
/** One parcel's exact length under a scale, summed in expansion order, without expanding its lengths. */
export function layerUnits(p: Layer, scale: LengthScale): bigint {
  if (!p.lengths) return scale.units(p.height);
  let n = 0n; for (const h of p.lengths) n += scale.units(h); return n;
}
/** A parcel with a new Number-valued height and no expansion: the same result as
 * withLayerLengths(p, [height]), whose single chunk is the height itself. */
export function withHeight(p: Layer, height: number): Layer {
  if (!(height >= 0) || !Number.isFinite(height) || (height === 0 && p.solid !== 0)) throw Error('Invalid grouped material extent');
  const { lengths: _dropped, ...rest } = p; return { ...rest, height };
}

/** Exact topology uses the complete expansion; physical constitutive laws use
 * the single parcel and its Number-valued height. Never treat binary residuals
 * as independent material quadrature samples. */
export const layerLengths = (p: Layer): readonly number[] => p.lengths ?? [p.height];
export function withLayerLengths(p: Layer, lengths: readonly number[]): Layer {
  const scale = lengthScale(lengths); let units = 0n; for (const h of lengths) units += scale.units(h);
  const pieces = scale.chunks(units), height = scale.number(units);
  if (!Number.isFinite(height) || (height === 0 && p.solid !== 0)) throw Error('Invalid grouped material extent');
  // Built without `delete`, which would turn every parcel into a slow dictionary object.
  const { lengths: _dropped, ...rest } = p, out: Layer = { ...rest, height };
  if (pieces.length > 1) out.lengths = pieces;
  return out;
}
export function portionByLengths(p: Layer, lengths: readonly number[]): Layer {
  const out = withLayerLengths({ ...p, solid: 0 }, lengths);
  out.solid = out.height ? p.solid * (out.height / p.height) : 0;
  return out;
}

function sameMaterial(a: Layer, b: Layer) {
  return a.bed === b.bed && a.fraction === b.fraction && a.burial === b.burial && a.loading === b.loading &&
    a.offsetX === b.offsetX && a.offsetZ === b.offsetZ && Math.abs(a.solid / a.height - b.solid / b.height) < 1e-13;
}
/** Sum grains to floating-point precision. Heights, unlike constitutive grain
 * values, also determine exact interval ownership and use a binary expansion. */
function grainSum(parts: readonly Layer[]) {
  let sum = 0, correction = 0;
  for (const p of parts) {
    const next = sum + p.solid;
    correction += Math.abs(sum) >= Math.abs(p.solid) ? (sum - next) + p.solid : (p.solid - next) + sum;
    sum = next;
  }
  return sum + correction;
}

export function append(to: Column, p: Layer) {
  if (p.height <= 0) return;
  let start = to.length;
  while (start > 0 && sameMaterial(to[start - 1], p)) start--;
  if (start === to.length) { to.push({ ...p }); return; }
  // Canonicalize the whole compatible run. Keeping every inexact addition as
  // another parcel makes harmless roundoff grow on each raster/rebuild cycle.
  // Never combine different identities, compositions, histories or offsets.
  const run = [...to.slice(start), p], totalSolid = grainSum(run);
  if (!(totalSolid >= 0) || !Number.isFinite(totalSolid)) throw Error('Invalid canonical material aggregate');
  const combined = withLayerLengths({ ...p, solid: totalSolid }, run.flatMap(q => layerLengths(q)));
  to.splice(start, to.length - start, combined);
}
/** A boundary can be a finite Number or a signed expansion of finite
 * Numbers. Expansions preserve complements such as [end, -shift] exactly;
 * they do not change the Number-valued physical coordinate convention. */
export function sliceColumn(column: Column, lo: number | readonly number[], hi: number | readonly number[]): Column {
  const lows = typeof lo === 'number' ? [lo] : lo, highs = typeof hi === 'number' ? [hi] : hi;
  if ([...lows, ...highs].some(x => !Number.isFinite(x))) throw Error('Invalid column slice bounds');
  const out: Column = [];
  const scale = columnScale([column], [...lows.map(Math.abs), ...highs.map(Math.abs)]);
  const boundary = (terms: readonly number[]) => terms.reduce((n, x) => n + (x < 0 ? -scale.units(-x) : scale.units(x)), 0n);
  const rawLower = boundary(lows), upper = boundary(highs), lower = rawLower > 0n ? rawLower : 0n;
  if (upper <= lower) return out;
  let start = 0n;
  for (const p of column) {
    const length = layerUnits(p, scale), end = start + length;
    const a = start > lower ? start : lower, b = end < upper ? end : upper;
    if (b > a) {
      if (b - a === length) append(out, p);
      else append(out, portionByLengths(p, scale.chunks(b - a)));
    }
    start = end; if (start >= upper) break;
  }
  return out;
}
export function surface(column: Column) {
  let z = 0; for (const p of column) { if (p.bed !== -1) break; z += p.height; } return z;
}
export function packColumn(column: Column, numericalBelow: (lo: number, hi: number) => number = () => 0) {
  const scale = columnScale([column]), lengths = column.map(p => layerUnits(p, scale));
  const firstRock = column.findIndex(p => p.bed !== -1);
  let z = lengths.reduce((s, n) => s + n, 0n), numerical = 0, gapUnits = 0n, surfaceUnits = 0n;
  const reversed: Layer[] = [], water: [number, number][] = [];
  for (let j = column.length - 1; j >= 0; j--) {
    const p = column[j], lo = z - lengths[j];
    if (p.bed === -1) {
      if (firstRock >= 0 && j > firstRock) {
        gapUnits += lengths[j];
        const a = scale.number(lo), b = scale.number(z); water.push([a, b]); numerical += numericalBelow(a, b);
      } else surfaceUnits += lengths[j];
    } else reversed.push({ ...p, offsetZ: p.offsetZ - numerical });
    z = lo;
  }
  const out: Column = [];
  if (surfaceUnits + gapUnits > 0n) append(out, withLayerLengths(emptyLayer(-1, 0), scale.chunks(surfaceUnits + gapUnits)));
  for (let j = reversed.length - 1; j >= 0; j--) append(out, reversed[j]);
  const mapDepth = (d: number) => d + water.reduce((s, [lo, hi]) => s + Math.max(0, hi - Math.max(lo, d)), 0);
  const mapPhysicalDepth = (d: number) => mapDepth(d) - water.reduce((s, [lo, hi]) =>
    s + (hi > d ? numericalBelow(Math.max(lo, d), hi) : 0), 0);
  return { column: out, gaps: scale.number(gapUnits), mapDepth, mapPhysicalDepth };
}

/** Solve each material parcel's implicit midpoint volume equation with a
 * bracket, preserving grains and loading memory. No cell-count rounding. */
export function compactColumn(column: Column, beds: { carbonate: boolean }[], pressure: number | null, physics: ColumnPhysics) {
  const floor = surface(column), rock = column.filter(p => p.bed !== -1);
  const next: Column = [], oldEdges = [floor], newEdges = [0]; let depth = 0;
  for (const p of rock) {
    const q = { ...p };
    if (p.bed >= 0) {
      const volume = (t: number) => p.solid / (1 - physics.porosity(p.fraction,
        Math.max(p.loading, physics.effectiveDepth(depth + t / 2, pressure)), beds[p.bed].carbonate));
      let lo = p.solid, hi = p.height;
      // Existing grain density encodes irreversible volume. Unloading cannot
      // expand it even if a discretized constitutive root is slightly larger.
      if (volume(hi) < hi) {
        for (let j = 0; j < 36; j++) { const m = (lo + hi) / 2; if (m < volume(m)) lo = m; else hi = m; }
        q.height = (lo + hi) / 2;
      }
      const d = depth + q.height / 2;
      q.burial = Math.max(p.burial, d); q.loading = Math.max(p.loading, physics.effectiveDepth(d, pressure));
      // offsetZ translates the whole parcel from storage to physical space.
      // Bottom-anchored shortening acts on its height, not this translation:
      // G(z + offset) = F(z) + offset for physical G and storage F.
      // The spread above preserves it even when compaction is an identity.
    }
    // q is already a fresh copy; when it carried an expansion, drop it the way withLayerLengths(q, [height]) would.
    next.push(q.lengths && q.height !== p.height ? withHeight(q, q.height) : q); depth += q.height;
    oldEdges.push(oldEdges.at(-1)! + p.height); newEdges.push(depth);
  }
  // Even an identity compaction must retain a positive bed immediately before
  // a grid boundary: rounded total-minus-rock depth can swallow its water
  // prefix residual. Exact lengths decide support; coordinate maps use Numbers.
  const scale = columnScale([column, next]);
  const exactTotal = (parts: Column) => { let n = 0n; for (const p of parts) n += layerUnits(p, scale); return n; };
  const topUnits = exactTotal(column) - exactTotal(next);
  if (topUnits < 0n) throw Error('Compacted material exceeds column extent');
  const top = scale.number(topUnits), out: Column = [];
  if (topUnits > 0n) append(out, withLayerLengths(emptyLayer(-1, 0), scale.chunks(topUnits)));
  for (const p of next) append(out, p);
  const mapDepth = (z: number) => {
    if (z < floor) return z + top - floor;
    let lo = 0, hi = rock.length;
    while (lo + 1 < hi) { const mid = (lo + hi) >> 1; if (oldEdges[mid] <= z) lo = mid; else hi = mid; }
    const j = Math.min(rock.length - 1, lo);
    return j < 0 ? z : top + newEdges[j] + (z - oldEdges[j]) * next[j].height / rock[j].height;
  };
  return { column: out, mapDepth };
}

/** A deposited bed is divided only for physical midpoint quadrature. Clipping
 * at the top boundary and raster sampling never remove the rest of a thin bed. */
export function depositedLayer(bed: number, height: number | readonly number[], fraction: number, carbonate: boolean,
  topDepth: number, pressure: number | null, physics: ColumnPhysics): Column {
  const terms = typeof height === 'number' ? [height] : height;
  if (terms.some(x => !Number.isFinite(x))) throw Error('Invalid deposited thickness');
  const scale = lengthScale(terms.map(Math.abs));
  const total = terms.reduce((n, x) => n + (x < 0 ? -scale.units(-x) : scale.units(x)), 0n);
  if (total < 0n) throw Error('Invalid deposited thickness');
  const thickness = scale.number(total);
  if (!Number.isFinite(thickness)) throw Error('Invalid deposited thickness');
  const n = Math.ceil(thickness / MATERIAL_QUADRATURE_M), out: Column = [];
  for (let j = 0; j < n; j++) {
    // Midpoint constitutive samples retain the prescribed physical quadrature.
    // Exact bin boundaries only allocate the represented total length; all
    // binary chunks of one bin share its midpoint, composition and memories.
    const d = topDepth + (j + 0.5) * (thickness / n), loading = physics.effectiveDepth(d, pressure);
    const density = 1 - physics.porosity(fraction, loading, carbonate);
    const lo = total * BigInt(j) / BigInt(n), hi = total * BigInt(j + 1) / BigInt(n);
    const part = withLayerLengths({ bed, height: 0, solid: 0, fraction, burial: d, loading, offsetX: 0, offsetZ: 0 }, scale.chunks(hi - lo));
    part.solid = part.height * density; out.push(part);
  }
  return out;
}

export interface RasterMaterial {
  grid: Int32Array; solid: Float64Array; sandFraction: Float64Array;
  burial: Float32Array; effectiveBurial: Float32Array;
  offsetX?: Float64Array; offsetZ?: Float64Array; subcells?: Map<number, Column>;
}
export function cellLayers(state: RasterMaterial, n: number, h: number): Column {
  return state.subcells?.get(n) ?? [{ bed: state.grid[n], height: h, solid: state.solid[n], fraction: state.sandFraction[n],
    burial: state.burial[n], loading: state.effectiveBurial[n], offsetX: state.offsetX?.[n] ?? 0, offsetZ: state.offsetZ?.[n] ?? 0 }];
}
export function movedCellLayers(state: RasterMaterial, src: number, h: number, x: number, z: number) {
  const dx = x - (state.offsetX?.[src] ?? 0), dz = z - (state.offsetZ?.[src] ?? 0);
  return cellLayers(state, src, h).map(p => ({ ...p, offsetX: p.offsetX + dx, offsetZ: p.offsetZ + dz }));
}
export function rasterize(columns: Column[], nz: number, h: number) {
  const nx = columns.length, length = nx * nz;
  const grid = new Int32Array(length), solid = new Float64Array(length), sandFraction = new Float64Array(length),
    burial = new Float32Array(length), effectiveBurial = new Float32Array(length), offsetX = new Float64Array(length), offsetZ = new Float64Array(length), subcells = new Map<number, Column>();
  // A cropped projection reports its positive outside pieces without claiming
  // boundary flux. Full-domain refresh callers must reject outside sediment.
  // Only <=1e-6 m of terminal zero-grain water/basement can be an explicit
  // inert extent adjustment; never manufacture or trim a sediment fraction.
  const domainAdjustments: { column: number; bed: number; added: boolean; lengths: number[] }[] = [];
  const bottomOutside = new Map<number, Column>();
  for (let i = 0; i < nx; i++) {
    let column = columns[i];
    const scale = columnScale([column], [h, 1e-6]);
    const cell = scale.units(h), domain = cell * BigInt(nz); let total = 0n; for (const p of column) total += layerUnits(p, scale);
    if (total < domain) {
      const difference = domain - total;
      if (difference > scale.units(1e-6)) throw Error(`Column ${i} domain shortage exceeds inert roundoff gate`);
      const last = column.at(-1);
      if (!last || (last.bed !== -1 && last.bed !== -2) || last.solid !== 0) throw Error(`Column ${i} domain shortage cannot adjust sediment`);
      column = column.map(p => ({ ...p }));
      append(column, withLayerLengths({ ...last, solid: 0 }, scale.chunks(difference)));
      domainAdjustments.push({ column: i, bed: last.bed, added: true, lengths: scale.chunks(difference) });
    }
    const lengths = column.map(p => layerUnits(p, scale));
    let j = 0, consumed = 0n;
    for (let k = 0; k < nz; k++) {
      const n = k * nx + i, parts: Column = [];
      let available = cell;
      while (available > 0n) {
        while (j < column.length && consumed === lengths[j]) { j++; consumed = 0n; }
        if (j >= column.length) throw Error(`Column ${i} does not fill exact domain; shortage ${scale.number(available + BigInt(nz - k - 1) * cell)} m`);
        const remaining = lengths[j] - consumed, take = remaining < available ? remaining : available;
        if (!(take > 0n)) throw Error('Nonpositive raster slice');
        if (take === lengths[j]) append(parts, column[j]);
        else append(parts, portionByLengths(column[j], scale.chunks(take)));
        consumed += take; available -= take;
      }
      if (!parts.length) throw Error('Empty raster cell');
      const labels = new Map<number, number>(); let f = 0, b = 0, e = 0, volume = 0;
      for (const p of parts) {
        labels.set(p.bed, (labels.get(p.bed) ?? 0) + p.height);
        solid[n] += p.solid; f += p.solid * p.fraction; b += p.solid * p.burial; e += p.solid * p.loading;
        if (p.bed !== -1) { volume += p.height; offsetX[n] += p.height * p.offsetX; offsetZ[n] += p.height * p.offsetZ; }
      }
      // Any sediment marks the cell as occupied for conservative cell transport.
      // The label is for display/geometry only; budgets use every component.
      const sediment = [...labels].filter(([id]) => id >= 0);
      grid[n] = (sediment.length ? sediment : [...labels]).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
      if (solid[n]) { sandFraction[n] = f / solid[n]; burial[n] = b / solid[n]; effectiveBurial[n] = e / solid[n]; }
      if (volume) { offsetX[n] /= volume; offsetZ[n] /= volume; }
      // Preserve double precision memories even when one piece occupies a cell.
      if (parts.some(p => p.bed >= 0) || parts.length > 1) subcells.set(n, parts);
    }
    const outside: Column = [];
    if (j < column.length) {
      if (consumed < lengths[j]) append(outside, portionByLengths(column[j], scale.chunks(lengths[j] - consumed)));
      for (j++; j < column.length; j++) append(outside, column[j]);
    }
    if (outside.length) {
      let extent = 0n; for (const p of outside) extent += layerUnits(p, scale);
      if (extent <= scale.units(1e-6) && outside.every(p => (p.bed === -1 || p.bed === -2) && p.solid === 0)) {
        for (const p of outside) domainAdjustments.push({ column: i, bed: p.bed, added: false, lengths: [...layerLengths(p)] });
      } else bottomOutside.set(i, outside);
    }
  }
  return { grid, solid, sandFraction, burial, effectiveBurial, offsetX, offsetZ, subcells, domainAdjustments, bottomOutside };
}
export function columnsFromRaster(state: RasterMaterial, nx: number, nz: number, h: number): Column[] {
  return Array.from({ length: nx }, (_, i) => {
    const out: Column = [];
    for (let k = 0; k < nz; k++) for (const p of cellLayers(state, k * nx + i, h)) append(out, p);
    return out;
  });
}
