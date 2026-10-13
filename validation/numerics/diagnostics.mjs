// Synthetic-only diagnostics. These helpers do not change the simulator or its
// frozen refinement metric. Counterfactual velocities are explanatory, not fits.
export function columnAt(b, x) {
  const i = Math.round((x + 2000) / b.h);
  if (i < 0 || i >= b.nx || Math.abs(i * b.h - 2000 - x) > 1e-6) throw Error('Profile is not on this grid');
  let floor = b.nz;
  for (let k = 0; k < b.nz; k++) if (b.grid[k * b.nx + i] !== -1) { floor = k; break; }
  const runs = [];
  for (let k = floor; k < b.nz;) {
    const bed = b.grid[k * b.nx + i], start = k, cells = [];
    while (k < b.nz && b.grid[k * b.nx + i] === bed) {
      const n = k * b.nx + i;
      if (bed >= 0) cells.push({ depth: (k - floor + 0.5) * b.h, solid: b.solid[n],
        fraction: b.sandFraction[n], carbonate: b.beds[bed].carbonate,
        burial: b.burial[n], loading: b.effectiveBurial[n] });
      k++;
    }
    runs.push({ bed, unit: bed >= 0 ? b.beds[bed].unit : null, start, end: k, cells });
  }
  return { x, h: b.h, floor_m: floor * b.h, runs };
}

/** Whole-column quantities, including material outside the comparison window.
 * Zero for an absent unit makes event increments telescope through appearance,
 * erosion and transport. This is not a material-following trajectory. */
export const ADDITIVE = ['solid_m', 'sand_m', 'carbonate_m', 'thickness_m', 'burial_moment_m2', 'loading_moment_m2'];
export function totalsByUnit(column) {
  const result = new Map();
  for (const run of column.runs) {
    if (run.bed < 0) continue;
    let r = result.get(run.unit);
    if (!r) result.set(run.unit, r = Object.fromEntries(ADDITIVE.map(k => [k, 0])));
    r.thickness_m += (run.end - run.start) * column.h;
    for (const c of run.cells) {
      r.solid_m += c.solid; r.sand_m += c.solid * c.fraction;
      r.carbonate_m += c.carbonate ? c.solid : 0;
      r.burial_moment_m2 += c.solid * c.burial; r.loading_moment_m2 += c.solid * c.loading;
    }
  }
  return result;
}

/** Independent bracketed solution of the simulator's per-run midpoint volume
 * equation, using the realized overburden. Its unique root lies between solid
 * volume and the volume at zero midpoint depth. No grid rounding or one-cell
 * minimum is used in the root. The old thickness caps irreversible expansion. */
export function continuousThickness(cells, depth, overpressure, porosity, effectiveDepth) {
  if (!cells.length || !cells.every(c => c.solid >= 0 && Number.isFinite(c.solid))) throw Error('Invalid solid profile');
  const rhs = T => cells.reduce((s, c) => s + c.solid / (1 - porosity(c.fraction,
    Math.max(c.loading, effectiveDepth(depth + T / 2, overpressure)), c.carbonate)), 0);
  let lo = cells.reduce((s, c) => s + c.solid, 0), hi = rhs(0);
  if (!Number.isFinite(hi) || hi < lo) throw Error('Invalid compaction bracket');
  for (let j = 0; j < 70; j++) { const m = (lo + hi) / 2; if (m < rhs(m)) lo = m; else hi = m; }
  const thickness = (lo + hi) / 2;
  return { thickness_m: thickness, equation_residual_m: thickness - rhs(thickness) };
}

export function compactionRows(before, after, overpressure, porosity, effectiveDepth) {
  if (before.runs.length !== after.runs.length) throw Error('Compaction changed run count');
  return before.runs.flatMap((run, j) => {
    const dest = after.runs[j];
    if (run.bed !== dest.bed) throw Error('Compaction changed bed order');
    if (run.bed < 0) return [];
    const depth = dest.start * after.h - after.floor_m;
    const root = continuousThickness(run.cells, depth, overpressure, porosity, effectiveDepth);
    const old = (run.end - run.start) * before.h, actual = (dest.end - dest.start) * after.h;
    const desired = Math.min(old, root.thickness_m);
    const solid = run.cells.reduce((s, c) => s + c.solid, 0);
    const afterSolid = dest.cells.reduce((s, c) => s + c.solid, 0);
    return [{ x: before.x, unit: run.unit, bed: run.bed, before_cells: run.end - run.start,
      after_cells: dest.end - dest.start, solid_m: solid, grain_change_m: afterSolid - solid,
      overburden_m: depth, desired_m: desired, realized_m: actual,
      bracketed_root_rounded_cells: Math.min(run.end - run.start, Math.max(1, Math.ceil(solid / after.h), Math.round(root.thickness_m / after.h))),
      thickness_excess_m: actual - desired, minimum_cell_limited: root.thickness_m < after.h,
      ...root }];
  });
}

/** Exact three-group Shapley decomposition of a scalar response. All 8 hybrid
 * states are evaluated; averaging marginal effects over all orders avoids
 * attributing an interaction arbitrarily to the last substituted variable. */
export function decompose3(evaluate) {
  const values = Array.from({ length: 8 }, (_, mask) => evaluate(mask));
  if (!values.every(Number.isFinite)) throw Error('Nonfinite counterfactual');
  const contributions = [0, 1, 2].map(j => {
    let sum = 0;
    for (let mask = 0; mask < 8; mask++) if (!(mask & (1 << j))) {
      const count = ((mask & 1) !== 0) + ((mask & 2) !== 0) + ((mask & 4) !== 0);
      sum += (count === 1 ? 1 / 6 : 1 / 3) * (values[mask | (1 << j)] - values[mask]);
    }
    return sum;
  });
  const delta = values[7] - values[0];
  return { values, delta, contributions, residual: delta - contributions.reduce((a, b) => a + b, 0) };
}

/** Compare velocities over normalized interval thickness, integrating the union
 * of both grids' cell boundaries exactly. Groups: present depth; composition
 * and carbonate identity (including their vertical proportions); burial/loading
 * memory. Absolute thickness affects the state but cancels in harmonic velocity.
 * Hybrid states are diagnostic substitutions, not alternative basin histories. */
export function velocityAttribution(a, b, overpressure, rockVelocity) {
  if (!a.length || !b.length) throw Error('Cannot attribute an empty interval');
  const cuts = [...new Set([0, 1, ...a.map((_, j) => j / a.length), ...b.map((_, j) => j / b.length)])].sort((x, y) => x - y);
  const spans = cuts.slice(1).map((end, j) => {
    const mid = (cuts[j] + end) / 2;
    return { w: end - cuts[j], a: a[Math.min(a.length - 1, Math.floor(mid * a.length))], b: b[Math.min(b.length - 1, Math.floor(mid * b.length))] };
  });
  const result = decompose3(mask => 1 / spans.reduce((time, s) => {
    const depth = mask & 1 ? s.b : s.a, material = mask & 2 ? s.b : s.a, memory = mask & 4 ? s.b : s.a;
    const v = rockVelocity(material.fraction, depth.depth, material.carbonate, overpressure,
      { maxBurial: memory.burial, maxEffectiveDepth: memory.loading });
    return time + s.w / v;
  }, 0));
  return { ...result, groups: { present_depth: result.contributions[0], composition: result.contributions[1], memory: result.contributions[2] } };
}

export const noncontracting = r => r.classification.endsWith('noncontracting') || r.classification === 'new-change';
