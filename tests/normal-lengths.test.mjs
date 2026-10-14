import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = process.env.EARTHFORGE_SOURCE ?? fileURLToPath(new URL('..', import.meta.url));
const bundle = await build({ stdin: { contents: 'export * from "./src/normalTransport.ts"; export {emptyLayer} from "./src/strata.ts";', resolveDir: root }, bundle: true, platform: 'node', format: 'esm', write: false });
const { remapNormal, emptyLayer } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
const rock = (bed, height) => ({ bed, height, solid: height / 2, fraction: .25, burial: 130, loading: 95, offsetX: 3, offsetZ: -7 });
// Independent fixed-unit binary64 oracle. It does not import production length helpers.
function units(value) {
  assert(Number.isFinite(value) && value >= 0);
  const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, value);
  const bits = view.getBigUint64(0), exponent = Number((bits >> 52n) & 2047n), fraction = bits & ((1n << 52n) - 1n);
  return exponent ? ((1n << 52n) + fraction) << BigInt(exponent - 1) : fraction;
}
const bulk = column => column.reduce((sum, p) => sum + (p.lengths ?? [p.height]).reduce((s, x) => s + units(x), 0n), 0n);
const grains = (columns, bed) => columns.flat().filter(p => p.bed === bed).reduce((sum, p) => sum + p.solid, 0);
const near = (a, b, tolerance = 1e-11) => assert(Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b)), `${a} != ${b}`);
const beds = [{ carbonate: false }];

test('normal shear retains a distinct sub-ULP bed and its exact support in either direction', () => {
  for (const h of [40, 20, 10]) for (const dir of [-1, 1]) for (const cells of [0, 1]) {
    const end = 2 * h, tiny = 2 ** -60, remainder = 2 ** -40;
    const column = [emptyLayer(-1, h / 4), rock(0, tiny), emptyLayer(-2, end - h / 4 - remainder), emptyLayer(-2, remainder - tiny)];
    assert.equal(bulk(column), units(end));
    const columns = Array.from({ length: 5 }, () => structuredClone(column)), before = structuredClone(columns);
    const depth = new Float64Array(5).fill(1.25 * h);
    const out = remapNormal(columns, depth, cells, dir, h, end, beds, true);
    assert.deepEqual(columns, before);
    assert.equal(grains(out.columns, 0), (5 - cells) * tiny / 2);
    for (let i = 0; i < 5; i++) {
      assert.equal(bulk(out.columns[i]), units(end));
      const source = i - dir * cells;
      const parts = out.columns[i].filter(p => p.bed === 0);
      assert.equal(parts.length, source >= 0 && source < 5 ? 1 : 0);
      for (const p of parts) { assert.equal(p.height, tiny); assert.equal(p.solid, tiny / 2); for (const key of ['fraction', 'burial', 'loading', 'offsetX', 'offsetZ']) assert.equal(p[key], column[1][key]); }
    }
    assert.equal(out.transfers.filter(t => t.moved.bed === 0).length, 5 - cells);
    assert.equal(out.flux.outflow[dir > 0 ? 'right' : 'left'].byBed[0] ?? 0, cells * h * tiny / 2);
  }
});

test('fractional fault-depth complements fill the exact domain without inventing grains', () => {
  for (const h of [40, 20, 10]) for (const dir of [-1, 1]) {
    const end = 2 * h, columns = Array.from({ length: 5 }, () => [emptyLayer(-1, h / 4), rock(0, end - h / 4)]);
    const depth = Float64Array.from({ length: 5 }, (_, i) => 1.25 * h + i * .2), before = structuredClone(columns);
    const out = remapNormal(columns, depth, 1, dir, h, end, beds, true);
    for (const column of out.columns) assert.equal(bulk(column), units(end));
    const incoming = Object.values(out.flux.inflow).reduce((s, q) => s + q.total, 0), outgoing = Object.values(out.flux.outflow).reduce((s, q) => s + q.total, 0);
    near(h * grains(out.columns, 0), h * grains(columns, 0) + incoming - outgoing);
    for (const t of out.transfers) for (const key of ['bed', 'fraction', 'burial', 'loading', 'offsetX', 'offsetZ']) assert.equal(t.moved[key], t.source[key]);
    assert.deepEqual(columns, before);
  }
});

test('partial top outflow and bottom continuation share the exact normal-fault cut', () => {
  for (const h of [40, 20, 10]) {
    const end = 2 * h, columns = [[rock(0, end)], [rock(0, end)]];
    const sourceDepth = end + .2, targetDepth = end - .1;
    const out = remapNormal(columns, Float64Array.of(sourceDepth, targetDepth), 1, 1, h, end, beds, true);
    for (const column of out.columns) assert.equal(bulk(column), units(end));
    near(out.flux.outflow.top.total, (sourceDepth - targetDepth) * .5 * h);
    near(out.flux.inflow.bottom.total, (sourceDepth - end) * .5 * h);
    near(out.flux.outflow.right.total, targetDepth * .5 * h);
    near(h * grains(out.columns, 0), h * grains(columns, 0) + out.flux.inflow.bottom.total - out.flux.outflow.top.total - out.flux.outflow.right.total);
  }
});
