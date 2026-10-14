import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const bundled = await build({ stdin: { contents: 'export * from "./src/subsidence.ts"; export {emptyLayer} from "./src/strata.ts";', resolveDir: root }, bundle: true, platform: 'node', format: 'esm', write: false });
const { subsideColumn, emptyLayer } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`);
const near = (a, b, tolerance = 1e-10) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const rock = (bed, height, offsetX = 0, offsetZ = 0) => ({ bed, height, solid: .5 * height, fraction: bed ? .8 : .25, burial: 80 + bed, loading: 40 + bed, offsetX, offsetZ });
const inventory = column => column.reduce((a, p) => {
  if (p.bed >= 0) { a[0] += p.solid; a[1] += p.solid * p.fraction; a[2] += p.solid * (1 - p.fraction); }
  return a;
}, [0, 0, 0]);
const physical = column => {
  let top = 0; const result = [];
  for (const p of column) { if (p.bed >= 0) result.push({ p, center: top + p.height / 2 + p.offsetZ }); top += p.height; }
  return result;
};

test('subsidence applies affine forcing at each transported rock position on all three grids', () => {
  for (const h of [40, 20, 10]) for (const slope of [-.5, 0, .5]) for (const offsetX of [-h, 0, h]) {
    const x = 2 * h, forcing = x => 40 + slope * x;
    const p = rock(0, 8, offsetX, 7), input = [emptyLayer(-1, 100), p, emptyLayer(-2, 292)], copy = structuredClone(input);
    const out = subsideColumn(input, x, 400, forcing), moved = physical(out.column)[0];
    near(moved.center, 104 + 7 + forcing(x + offsetX));
    for (const key of ['bed', 'height', 'solid', 'fraction', 'burial', 'loading', 'offsetX']) assert.equal(moved.p[key], p[key]);
    assert.deepEqual(input, copy);
    assert.deepEqual(inventory(out.outflowTop), [0, 0, 0]); assert.deepEqual(inventory(out.outflowBottom), [0, 0, 0]);
    near(out.column.reduce((s, p) => s + p.height, 0), 400);
  }
});

test('the same physical bed follows the same sinking under different storage allocations', () => {
  for (const h of [40, 20, 10]) for (const gaugeX of [-h, 0, h]) for (const gaugeZ of [-h, 0, h]) {
    const physicalX = 200, x = physicalX + gaugeX, forcing = x => 20 + .125 * x;
    const input = [emptyLayer(-1, 100 + gaugeZ), rock(0, .0625, -gaugeX, 7 - gaugeZ), emptyLayer(-2, 400 - 100 - gaugeZ - .0625)];
    const out = subsideColumn(input, x, 400, forcing), moved = physical(out.column)[0];
    near(moved.center, 100 + .0625 / 2 + 7 + forcing(physicalX));
    assert.equal(moved.p.height, .0625); assert.equal(moved.p.solid, .03125);
  }
});

test('each constituent samples its own position without changing composition or irreversible memory', () => {
  const forcing = x => 10 + .2 * x, x = 50;
  const input = [emptyLayer(-1, 100), rock(0, 12, -17, 9), rock(1, 23, 31, -4), emptyLayer(-2, 265)];
  const before = physical(input), out = subsideColumn(input, x, 400, forcing), after = physical(out.column);
  assert.equal(before.length, after.length);
  for (let j = 0; j < before.length; j++) {
    near(after[j].center, before[j].center + forcing(x + before[j].p.offsetX));
    for (const key of ['bed', 'height', 'solid', 'fraction', 'burial', 'loading', 'offsetX']) assert.equal(after[j].p[key], before[j].p[key]);
  }
});

test('uniform subsidence and zero lateral offsets retain the ordinary column translation', () => {
  for (const offsetX of [0, 27, -43]) {
    const p = rock(0, 20, offsetX, -13), input = [emptyLayer(-1, 100), p, emptyLayer(-2, 280)];
    const out = subsideColumn(input, 50, 400, () => 25);
    assert.deepEqual(physical(out.column)[0].p, p);
    near(physical(out.column)[0].center, 100 + 10 - 13 + 25);
  }
  const input = [emptyLayer(-1, 100), rock(0, 20), emptyLayer(-2, 280)];
  assert.deepEqual(subsideColumn(input, 50, 400, x => 5 + x / 5).column,
    subsideColumn(input, 50, 400, () => 15).column);
});

test('sinking and uplift account for actual partial grain transfers at storage boundaries', () => {
  const input = [emptyLayer(-1, 10), rock(0, 20, 17, -3), rock(1, 70, -11, 4)];
  for (const shift of [15, -15, 125, -125]) {
    const out = subsideColumn(input, 50, 100, () => shift), before = inventory(input), after = inventory(out.column);
    const top = inventory(out.outflowTop), bottom = inventory(out.outflowBottom), incoming = inventory(out.inflowBottom);
    for (let j = 0; j < 3; j++) near(after[j], before[j] + incoming[j] - top[j] - bottom[j]);
    near(out.column.reduce((s, p) => s + p.height, 0), 100);
    if (shift === 15) { near(bottom[0], 7.5); near(top[0], 0); near(incoming[0], 0); }
    if (shift === -15) { near(top[0], 2.5); near(bottom[0], 0); near(incoming[0], 7.5); }
  }
});

test('invalid forcing rejects without changing caller material', () => {
  const input = [emptyLayer(-1, 100), rock(0, 20, 17, 3), emptyLayer(-2, 280)], copy = structuredClone(input);
  for (const x of [NaN, Infinity]) assert.throws(() => subsideColumn(input, x, 400, () => 1), /Invalid/);
  for (const end of [0, -1, Infinity]) assert.throws(() => subsideColumn(input, 0, end, () => 1), /Invalid/);
  assert.throws(() => subsideColumn(input, 0, 400, () => NaN), /Invalid/);
  assert.throws(() => subsideColumn(input, 0, 400, x => x === 0 ? 1 : Infinity), /Invalid physical/);
  assert.deepEqual(input, copy);
});
