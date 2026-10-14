import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(process.env.EARTHFORGE_SOURCE ?? fileURLToPath(new URL("..", import.meta.url)));
const { build } = createRequire(resolve(root, "package.json"))("esbuild");
const bundle = await build({
  entryPoints: [resolve(root, "src/strata.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false
});
const { rasterize, columnsFromRaster, packColumn, sliceColumn, emptyLayer, cellLayers } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`);
function exact(x) {
  assert(x >= 0 && Number.isFinite(x));
  const v = new DataView(new ArrayBuffer(8));
  v.setFloat64(0, x);
  const b = v.getBigUint64(0), e = Number(b >> 52n & 2047n), m = b & (1n << 52n) - 1n;
  return e ? m + (1n << 52n) << BigInt(e - 1) : m;
}
const exactSum = (a) => a.reduce((s, x) => s + exact(x), 0n), near = (a, b) => assert(Math.abs(a - b) <= 128 * Number.EPSILON * Math.max(Number.MIN_VALUE, Math.abs(a), Math.abs(b)), `${a} != ${b}`), amount = (c, bed) => c.filter((p) => p.bed === bed).reduce((s, p) => s + p.solid, 0);
const sediment = (height, bed = 0) => ({ bed, height, solid: height * 0.625, fraction: 0.375, burial: 123.456, loading: 87.654, offsetX: 0.75, offsetZ: -0.25 });
const cases = /* @__PURE__ */ new Map();
function record(kind, h, tiny, run) {
  if (!cases.has(kind)) cases.set(kind, []);
  cases.get(kind).push({ h, tiny, run });
}
function projectionConsistent(r, nx, nz, h) {
  for (let n = 0; n < nx * nz; n++) {
    const parts = cellLayers(r, n, h), solid = parts.reduce((s, p) => s + p.solid, 0), rock = parts.filter((p) => p.bed !== -1), volume = rock.reduce((s, p) => s + p.height, 0);
    near(r.solid[n], solid);
    if (solid) {
      near(r.sandFraction[n], parts.reduce((s, p) => s + p.solid * p.fraction, 0) / solid);
      assert.equal(r.burial[n], Math.fround(parts.reduce((s, p) => s + p.solid * p.burial, 0) / solid));
      assert.equal(r.effectiveBurial[n], Math.fround(parts.reduce((s, p) => s + p.solid * p.loading, 0) / solid));
    }
    if (volume) {
      near(r.offsetX[n], rock.reduce((s, p) => s + p.height * p.offsetX, 0) / volume);
      near(r.offsetZ[n], rock.reduce((s, p) => s + p.height * p.offsetZ, 0) / volume);
    }
    const labels = /* @__PURE__ */ new Map();
    for (const p of parts) labels.set(p.bed, (labels.get(p.bed) ?? 0) + p.height);
    const beds = [...labels].filter(([bed]) => bed >= 0), choice = (beds.length ? beds : [...labels]).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
    assert.equal(r.grid[n], choice);
  }
}
function pure(fn, value) {
  const saved = structuredClone(value), out = fn(value);
  assert.deepEqual(value, saved);
  return out;
}
function moment(column, bed) {
  let z = 0, total = 0;
  for (const p of column) {
    if (p.bed === bed) total += p.height * (z + p.height / 2 + p.offsetZ);
    z += p.height;
  }
  return total;
}
function lifecycle(input, h, nz, bed, expectedCell) {
  const original = structuredClone(input), grains = amount(input, bed), height = exactSum(input.filter((p) => p.bed === bed).flatMap((p) => p.lengths ?? [p.height])), initialMoment = moment(input, bed);
  let column = input, visits = [];
  for (let round = 0; round < 5; round++) {
    const raster = pure((c) => rasterize([c], nz, h), column);
    projectionConsistent(raster, 1, nz, h);
    const occupied = Array.from({ length: nz }, (_, n) => n).filter((n) => cellLayers(raster, n, h).some((p) => p.bed === bed));
    if (expectedCell !== void 0) assert.deepEqual(occupied, [expectedCell]);
    column = pure((r) => columnsFromRaster(r, 1, nz, h), raster)[0];
    near(amount(column, bed), grains);
    assert.equal(exactSum(column.filter((p) => p.bed === bed).flatMap((p) => p.lengths ?? [p.height])), height);
    column = pure((c) => packColumn(c), column).column;
    column = pure((c) => sliceColumn(c, 0, nz * h), column);
    near(amount(column, bed), grains);
    assert.equal(exactSum(column.filter((p) => p.bed === bed).flatMap((p) => p.lengths ?? [p.height])), height);
    for (const p of column.filter((p2) => p2.bed === bed)) for (const key of ["fraction", "burial", "loading", "offsetX", "offsetZ"]) assert.equal(p[key], original.find((q) => q.bed === bed)[key]);
    near(moment(column, bed), initialMoment);
    visits.push({ round, occupied, solid: amount(column, bed) });
  }
  assert.deepEqual(input, original);
  return { rounds: visits, exact_bed_bulk_preserved: true, grain_and_moment_preserved_to_roundoff: true, history_preserved: true, input_pure: true };
}
for (const h of [40, 20, 10]) for (const tiny of [2 ** -40, 2 ** -60]) {
  const delta = 2 ** -30;
  const middle = [emptyLayer(-1, h / 4), sediment(tiny), emptyLayer(-2, 3 * h / 4 - delta), emptyLayer(-2, delta - tiny)];
  assert.equal(exactSum(middle.flatMap((p) => p.lengths ?? [p.height])), exact(h));
  record("middle_distinct_bed_full_lifecycle", h, tiny, () => lifecycle(middle, h, 1, 0, 0));
  const inside = [emptyLayer(-1, h - delta), emptyLayer(-1, delta - tiny), sediment(tiny), emptyLayer(-2, h)];
  assert.equal(exactSum(inside.flatMap((p) => p.lengths ?? [p.height])), exact(2 * h));
  record("tiny_before_internal_boundary_lifecycle", h, tiny, () => lifecycle(inside, h, 2, 0, 0));
  const after = [emptyLayer(-1, h), sediment(tiny), emptyLayer(-2, h - delta), emptyLayer(-2, delta - tiny)];
  assert.equal(exactSum(after.flatMap((p) => p.lengths ?? [p.height])), exact(2 * h));
  record("tiny_after_internal_boundary_lifecycle", h, tiny, () => lifecycle(after, h, 2, 0, 1));
  const crossing = [emptyLayer(-1, h - delta), sediment(delta + tiny), emptyLayer(-2, h - delta), emptyLayer(-2, delta - tiny)];
  assert.equal(exactSum(crossing.flatMap((p) => p.lengths ?? [p.height])), exact(2 * h));
  record("source_bed_straddles_grid_boundary", h, tiny, () => {
    const r = pure((c) => rasterize([c], 2, h), crossing);
    projectionConsistent(r, 1, 2, h);
    assert.equal(exactSum(cellLayers(r, 0, h).filter((p) => p.bed === 0).flatMap((p) => p.lengths ?? [p.height])), exact(delta));
    assert.equal(exactSum(cellLayers(r, 1, h).filter((p) => p.bed === 0).flatMap((p) => p.lengths ?? [p.height])), exact(tiny));
    near(r.solid[0] + r.solid[1], amount(crossing, 0));
    return { lower_share: delta, upper_share: tiny, source_grains: amount(crossing, 0), projected_grains: r.solid[0] + r.solid[1] };
  });
  record("domain_projection_excludes_only_outside_material", h, tiny, () => {
    const retained = pure((c) => sliceColumn(c, 0, h), crossing), outside = pure((c) => sliceColumn(c, h, 2 * h), crossing);
    const r = pure((c) => rasterize([c], 1, h), crossing);
    assert.equal(exactSum(r.bottomOutside.get(0).filter((p) => p.bed === 0).flatMap((p) => p.lengths ?? [p.height])), exact(tiny));
    near(amount(r.bottomOutside.get(0), 0), amount(outside, 0));
    projectionConsistent(r, 1, 1, h);
    near(r.solid[0], delta * 0.625);
    assert.equal(exactSum(retained.filter((p) => p.bed === 0).flatMap((p) => p.lengths ?? [p.height])), exact(delta));
    assert.equal(exactSum(outside.filter((p) => p.bed === 0).flatMap((p) => p.lengths ?? [p.height])), exact(tiny));
    near(amount(retained, 0) + amount(outside, 0), amount(crossing, 0));
    return { retained_solid: amount(retained, 0), outside_solid: amount(outside, 0), grain_balance_closed: true, source_unchanged: true };
  });
  record("tiny_wholly_inside_domain_endpoint", h, tiny, () => {
    const c = pure((q) => sliceColumn(q, 0, h), inside);
    const r = pure((c2) => rasterize([c2], 1, h), inside);
    assert.equal(amount(r.bottomOutside.get(0), 0), 0);
    projectionConsistent(r, 1, 1, h);
    near(r.solid[0], tiny * 0.625);
    near(amount(c, 0), tiny * 0.625);
    return { retained_solid: amount(c, 0) };
  });
  record("tiny_wholly_outside_domain_endpoint", h, tiny, () => {
    const c = pure((q) => sliceColumn(q, 0, h), after), r = pure((c2) => rasterize([c2], 1, h), after);
    near(amount(r.bottomOutside.get(0), 0), tiny * 0.625);
    assert.equal(r.solid[0], 0);
    assert.equal(amount(c, 0), 0);
    return { retained_solid: 0 };
  });
}
for (const h of [40, 20, 10]) {
  for (const add of [true, false]) record("reported_inert_endpoint_adjustment", h, 2 ** -40, () => {
    const delta = 2 ** -40, c = [emptyLayer(-2, h + (add ? -delta : delta))], saved = structuredClone(c), r = rasterize([c], 1, h);
    assert.deepEqual(c, saved);
    assert.equal(r.domainAdjustments.length, 1);
    const q = r.domainAdjustments[0];
    assert.equal(q.column, 0);
    assert.equal(q.bed, -2);
    assert.equal(q.added, add);
    assert.equal(exactSum(q.lengths), exact(delta));
    assert.equal(r.solid[0], 0);
    assert.equal(exactSum(cellLayers(r, 0, h).flatMap((p) => p.lengths ?? [p.height])), exact(h));
    return { added: add, reported_lengths: q.lengths, input_pure: true };
  });
  record("reported_sub_ulp_inert_tail_removal", h, 2 ** -60, () => {
    const c = [emptyLayer(-1, h), emptyLayer(-2, 2 ** -60)], r = pure((c2) => rasterize([c2], 1, h), c);
    assert.equal(r.domainAdjustments.length, 1);
    assert.equal(r.domainAdjustments[0].added, false);
    assert.equal(exactSum(r.domainAdjustments[0].lengths), exact(2 ** -60));
    assert.equal(r.solid[0], 0);
    return { removed: 2 ** -60 };
  });
  for (const kind of ["positive_sediment_excess", "zero_grain_sediment_excess", "sediment_shortage", "large_inert_excess"]) record("invalid_endpoint_" + kind, h, 2 ** -60, () => {
    const c = kind === "positive_sediment_excess" ? [emptyLayer(-1, h), sediment(2 ** -60)] : kind === "zero_grain_sediment_excess" ? [emptyLayer(-1, h), emptyLayer(0, 2 ** -60)] : kind === "sediment_shortage" ? [sediment(h - 2 ** -40)] : [emptyLayer(-2, h + 2e-6)], saved = structuredClone(c);
    if (kind === "sediment_shortage") {
      assert.throws(() => rasterize([c], 1, h), /domain/);
      assert.deepEqual(c, saved);
      return { explicit_rejection: true, input_pure: true };
    }
    const r = rasterize([c], 1, h), outside = r.bottomOutside.get(0);
    assert(outside?.length > 0);
    assert.equal(r.domainAdjustments.length, 0);
    assert.equal(exactSum(cellLayers(r, 0, h).flatMap((p) => p.lengths ?? [p.height])) + exactSum(outside.flatMap((p) => p.lengths ?? [p.height])), exactSum(c.flatMap((p) => p.lengths ?? [p.height])));
    near(r.solid[0] + outside.reduce((s, p) => s + p.solid, 0), c.reduce((s, p) => s + p.solid, 0));
    assert.deepEqual(c, saved);
    return { explicit_outside_ledger: true, source_bulk_and_grains_accounted: true, input_pure: true };
  });
}
const names = {
  middle_distinct_bed_full_lifecycle: "distinct sub-ULP beds retain grains, histories and moments through repeated material round trips",
  tiny_before_internal_boundary_lifecycle: "a positive bed immediately before a grid boundary stays in its original cell",
  tiny_after_internal_boundary_lifecycle: "a positive bed immediately after a grid boundary stays in its original cell",
  source_bed_straddles_grid_boundary: "a source bed crossing a cell boundary retains both exact positive shares",
  domain_projection_excludes_only_outside_material: "cropped projection and outside ledger account for every source grain",
  tiny_wholly_inside_domain_endpoint: "a tiny bed inside the domain endpoint remains in the projection",
  tiny_wholly_outside_domain_endpoint: "a tiny bed outside the domain endpoint remains only in the outside ledger",
  reported_inert_endpoint_adjustment: "terminal inert extent roundoff is explicit, bounded and grain-free",
  reported_sub_ulp_inert_tail_removal: "a sub-ULP inert tail is recorded rather than silently discarded",
  invalid_endpoint_positive_sediment_excess: "positive sediment outside support is reported without inert adjustment",
  invalid_endpoint_zero_grain_sediment_excess: "sediment identity outside support is reported even with zero grains",
  invalid_endpoint_sediment_shortage: "a short column ending in sediment cannot be padded implicitly",
  invalid_endpoint_large_inert_excess: "inert excess beyond the roundoff gate remains explicit outside material"
};
for (const [kind, fixtures] of cases) test(names[kind], () => {
  for (const fixture of fixtures) {
    try {
      fixture.run();
    } catch (error) {
      error.message = `h=${fixture.h}, tiny=${fixture.tiny}: ${error.message}`;
      throw error;
    }
  }
});
assert.equal([...cases.values()].reduce((count, fixtures) => count + fixtures.length, 0), 63);
