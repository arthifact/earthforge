import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const moduleOf = async (contents) => {
  const result = await build({ stdin: { contents, resolveDir: root }, bundle: true, platform: 'node', format: 'esm', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`);
};
const { BASIN_DEFAULTS, simulate, windowOf } = await moduleOf('export * from "./src/basin.ts";');

test('worker transfers final and replay composition without aliasing or losing history', async () => {
  const replies = [];
  globalThis.self = { postMessage: (reply, transfer) => replies.push(structuredClone(reply, { transfer })) };
  try {
    await moduleOf('import "./src/worker.ts";');
    const options = { ...BASIN_DEFAULTS, seed: 765184, setting: 'compression', overpressure: 1 };
    await self.onmessage({ data: { id: 1, kind: 'section', options, history: true } });
    assert.deepEqual(replies.map(r => r.kind), ['preview', 'history']);
    const section = replies[0].section, frames = replies[1].frames;
    assert.ok(frames.length > 3);
    const b = simulate({ ...options, record: true });
    assert.deepEqual(section.budget, b.budget.summary);
    const carried = b.faults.filter(f => f.trace);
    assert.ok(carried.length > 0, 'the fixture includes cut passive faults');
    const expectedLines = b.faults.flatMap(f => f.trace ? f.trace.map(([a,c]) => ({x:[a[0],c[0]],z:[a[1],c[1]]})) : [{x:f.x,z:f.z}]);
    assert.deepEqual(section.now.faults, expectedLines, 'actual branches reach the overlay without fabricated connectors');
    assert.deepEqual(frames.at(-1).faults, section.now.faults, 'replay retains the same cut geometry');
    const snapshotTrace = b.snapshots.at(-1).faults.find(f => f.trace).trace;
    const savedX = snapshotTrace[0][0][0];carried[0].trace[0][0][0] += 100;
    assert.equal(snapshotTrace[0][0][0], savedX, 'snapshot endpoints do not alias current geometry');
    assert.equal(section.budget.closed, true, 'conservative thrust budget reaches the UI');
    for (const index of [0, frames.length - 1]) {
      const expected = windowOf(b, b.snapshots[index]);
      assert.deepEqual(frames[index].velocity, expected.velocity);
      for (let n = 0; n < expected.beds.length; n++) {
        const bed = expected.beds[n];
        const litho = bed < 0 ? bed : b.beds[bed].carbonate ? -3 : expected.sandFraction[n];
        assert.equal(frames[index].litho[n], litho);
      }
    }
    assert.deepEqual(frames.at(-1).velocity, section.now.velocity);
    assert.deepEqual(frames.at(-1).litho, section.now.litho);
    assert.notDeepEqual(frames[0].litho, frames.at(-1).litho);
  } finally { delete globalThis.self; }
});
