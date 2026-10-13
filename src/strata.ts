/** Continuous material columns. The raster is a projection, never the inventory.
 * A layer may be arbitrarily thinner than an output cell. All pieces retain
 * their depositional identity, grains, composition and irreversible memories. */
export interface Layer {
  bed: number; height: number; solid: number; fraction: number;
  burial: number; loading: number; offsetX: number; offsetZ: number;
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
export const portion = (p: Layer, height: number): Layer => ({ ...p, height, solid: p.solid * (height / p.height) });
export function append(to: Column, p: Layer) {
  if (p.height <= 0) return;
  const q = to.at(-1);
  // Merge only identical material states and density; never average histories
  // or lithologies in order to discard a thin layer.
  if (q && q.bed === p.bed && q.fraction === p.fraction && q.burial === p.burial && q.loading === p.loading &&
    q.offsetX === p.offsetX && q.offsetZ === p.offsetZ && Math.abs(q.solid / q.height - p.solid / p.height) < 1e-13) {
    q.height += p.height; q.solid += p.solid;
  } else to.push({ ...p });
}
export function sliceColumn(column: Column, lo: number, hi: number): Column {
  const out: Column = []; let z = 0;
  for (const p of column) {
    const end = z + p.height, overlap = Math.min(end, hi) - Math.max(z, lo);
    if (overlap > 0) append(out, portion(p, overlap));
    z = end; if (z >= hi) break;
  }
  return out;
}
export function surface(column: Column) {
  let z = 0; for (const p of column) { if (p.bed !== -1) break; z += p.height; } return z;
}
export function packColumn(column: Column, numericalBelow: (lo: number, hi: number) => number = () => 0) {
  let z = column.reduce((s, p) => s + p.height, 0), numerical = 0, gaps = 0;
  const reversed: Layer[] = [], water: [number, number][] = [];
  const floor = surface(column);
  for (let j = column.length - 1; j >= 0; j--) {
    const p = column[j], lo = z - p.height;
    if (p.bed === -1) {
      if (z > floor + 1e-8) { gaps += p.height; water.push([lo, z]); numerical += numericalBelow(lo, z); }
    } else reversed.push({ ...p, offsetZ: p.offsetZ - numerical });
    z = lo;
  }
  const out: Column = []; append(out, emptyLayer(-1, floor + gaps));
  for (let j = reversed.length - 1; j >= 0; j--) append(out, reversed[j]);
  return { column: out, gaps, mapDepth: (d: number) => d + water.reduce((s, [lo, hi]) => s + Math.max(0, hi - Math.max(lo, d)), 0) };
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
      q.offsetZ = 0;
    }
    next.push(q); depth += q.height;
    oldEdges.push(oldEdges.at(-1)! + p.height); newEdges.push(depth);
  }
  const total = column.reduce((s, p) => s + p.height, 0), top = total - depth;
  const out: Column = []; append(out, emptyLayer(-1, top)); for (const p of next) append(out, p);
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
export function depositedLayer(bed: number, height: number, fraction: number, carbonate: boolean,
  topDepth: number, pressure: number | null, physics: ColumnPhysics): Column {
  if (!(height >= 0) || !Number.isFinite(height)) throw Error('Invalid deposited thickness');
  const n = Math.ceil(height / MATERIAL_QUADRATURE_M), out: Column = [];
  for (let j = 0; j < n; j++) {
    const t = height / n, d = topDepth + (j + 0.5) * t, loading = physics.effectiveDepth(d, pressure);
    out.push({ bed, height: t, solid: t * (1 - physics.porosity(fraction, loading, carbonate)),
      fraction, burial: d, loading, offsetX: 0, offsetZ: 0 });
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
  for (let i = 0; i < nx; i++) {
    const column = columns[i]; let j = 0, start = 0;
    for (let k = 0; k < nz; k++) {
      const n = k * nx + i, parts: Column = []; let z = k * h;
      while (z < (k + 1) * h - 1e-9) {
        while (j < column.length && start + column[j].height <= z + 1e-10) { start += column[j].height; j++; }
        if (j >= column.length) {
          if ((k + 1) * h - z > 1e-6) throw Error('Column does not fill domain');
          break;
        }
        const end = Math.min((k + 1) * h, start + column[j].height);
        append(parts, portion(column[j], end - z)); z = end;
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
  }
  return { grid, solid, sandFraction, burial, effectiveBurial, offsetX, offsetZ, subcells };
}
export function columnsFromRaster(state: RasterMaterial, nx: number, nz: number, h: number): Column[] {
  return Array.from({ length: nx }, (_, i) => {
    const out: Column = [];
    for (let k = 0; k < nz; k++) for (const p of cellLayers(state, k * nx + i, h)) append(out, p);
    return out;
  });
}
