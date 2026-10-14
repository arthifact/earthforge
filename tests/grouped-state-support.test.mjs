import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(process.env.EARTHFORGE_SOURCE ?? fileURLToPath(new URL('..', import.meta.url)));
const { build } = createRequire(resolve(root, 'package.json'))('esbuild');
const bundle = await build({ entryPoints: [resolve(root, 'src/basinVerify.ts')], bundle: true, platform: 'node', format: 'esm', write: false });
const { samePhysicalState, invalidStateCells } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
const layer = changes => ({ bed: 0, height: 1, solid: .625, fraction: .25, burial: 2, loading: 1, offsetX: .25, offsetZ: -.5, ...changes });
function state(part) {
  return {
    grid: new Int32Array([0]), solid: new Float64Array([.625]), burial: new Float32Array([2]),
    sandFraction: new Float64Array([.25]), effectiveBurial: new Float32Array([1]),
    beds: [{ carbonate: false }], h: 10, columns: [[part]], setting: 'compression', dt: 1,
    overpressure: null, basementVelocity: 5000, faults: [],
  };
}

test('physical-state equality compares exact support values across clones and equivalent expansion arrays', () => {
  const tiny = 2 ** -60, a = state(layer({ lengths: [1, tiny] })), clone = structuredClone(a);
  assert(samePhysicalState(a, clone));
  const equivalent = state(layer({ lengths: [.5, .5, tiny] }));
  assert(samePhysicalState(a, equivalent)); assert(samePhysicalState(equivalent, a));
  assert(samePhysicalState(state(layer({})), state(layer({ lengths: [1] }))));
  assert(samePhysicalState(state(layer({ lengths: [1] })), state(layer({}))));
  assert.deepEqual(a, clone);
});

test('physical-state equality detects sub-ULP support differences and compares parcel keys symmetrically', () => {
  const tiny = 2 ** -60, a = state(layer({ lengths: [1, tiny] }));
  for (const other of [state(layer({})), state(layer({ lengths: [1, 2 * tiny] }))]) {
    assert(!samePhysicalState(a, other)); assert(!samePhysicalState(other, a));
  }
  const extra = state({ ...layer({ lengths: [1, tiny] }), unexpectedPhysicalMetadata: 1 });
  assert(!samePhysicalState(a, extra)); assert(!samePhysicalState(extra, a));
  for (const key of ['height', 'solid', 'fraction', 'burial', 'loading', 'offsetX', 'offsetZ']) {
    const other = structuredClone(a); other.columns[0][0][key] += .125;
    assert(!samePhysicalState(a, other));
  }
});

test('state validation checks finite positive exact support and its rounded height projection', () => {
  for (const lengths of [undefined, [1], [1, 2 ** -60], [.5, .5]]) {
    const p = layer(lengths === undefined ? {} : { lengths });
    assert.equal(invalidStateCells(state(p)), 0);
  }
  assert.equal(invalidStateCells(state(layer({ height: 1 + 2 ** -52, lengths: [1, 2 ** -53, 2 ** -107] }))), 0);
  assert.equal(invalidStateCells(state(layer({ height: 1, lengths: [1, 2 ** -53, 2 ** -107] }))), 1);
  for (const lengths of [[], [0], [-1, 2], [Infinity], [NaN], [1, 1], [.5], [Number.MAX_VALUE, Number.MAX_VALUE]]) {
    const s = state(layer({ lengths })), before = structuredClone(s);
    assert.equal(invalidStateCells(s), 1); assert.deepEqual(s, before);
  }
});
