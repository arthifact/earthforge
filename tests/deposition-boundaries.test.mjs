import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = resolve(process.env.EARTHFORGE_SOURCE ?? fileURLToPath(new URL('..', import.meta.url)));
const { build } = createRequire(resolve(root, 'package.json'))('esbuild');
const basin = readFileSync(resolve(root, 'src/basin.ts'), 'utf8');
// Execute the production deposition block with prescribed synthetic inputs.
// Its ambient forcing and grain-ledger functions are supplied by this harness;
// interval ownership and deposition are the production code under test.
const start = basin.indexOf('      const zTop = surface(columns[i]), zBase = wd');
const finalLine = '      columns[i] = next;';
const last = basin.indexOf(finalLine, start);
assert(start >= 0 && last > start, 'The production deposition block must be located explicitly');
const code = `
import {surface,append,emptyLayer,sliceColumn,depositedLayer,rasterize,columnsFromRaster,packColumn,withLayerLengths,layerLengths} from ${JSON.stringify(resolve(root, 'src/strata.ts'))};
import {exactLengthScale} from ${JSON.stringify(resolve(root, 'src/exactLength.ts'))};
export {rasterize,columnsFromRaster,packColumn};
export function deposit(column,h,nBeds,drape) {
  const columns=[column],i=0,X=()=>0,WIDTH=12000,nz=2,wd=0,fill=0,basinSlope=0,WATER=-1,first=0;
  const beds=Array.from({length:nBeds},()=>({carbonate:false})),sand=()=>.25,overpressure=null;
  const physics={porosity:()=>.375,effectiveDepth:d=>d},deposited=Array(nBeds).fill(0);
  const depositionFlux={deposited:[]},materialFlux=(dst,parts)=>dst.push(...parts);
  let thickest=0;
${basin.slice(start, last + finalLine.length)}
  return {column:columns[0],flux:depositionFlux.deposited,deposited};
}`;
const bundle = await build({ stdin: { contents: code, loader: 'ts', resolveDir: root }, bundle: true, platform: 'node', format: 'esm', write: false });
const m = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);

// Independent binary64 integer oracle: all lengths share the subnormal unit.
function units(x) {
  assert(x >= 0 && Number.isFinite(x));
  const v = new DataView(new ArrayBuffer(8)); v.setFloat64(0, x);
  const bits = v.getBigUint64(0), exponent = Number(bits >> 52n & 2047n), mantissa = bits & ((1n << 52n) - 1n);
  return exponent ? (mantissa + (1n << 52n)) << BigInt(exponent - 1) : mantissa;
}
const bulk = parts => parts.flatMap(p => p.lengths ?? [p.height]).reduce((n, h) => n + units(h), 0n);
const grain = parts => parts.reduce((n, p) => n + p.solid, 0);
const near = (a, b) => assert(Math.abs(a - b) <= 128 * Number.EPSILON * Math.max(Math.abs(a), Math.abs(b), Number.MIN_VALUE));
const empty = (bed, height) => ({ bed, height, solid: 0, fraction: 0, burial: 0, loading: 0, offsetX: 0, offsetZ: 0 });
const oldBed = height => ({ bed: 99, height, solid: height * .625, fraction: .125, burial: 75, loading: 50, offsetX: 1.5, offsetZ: -.75 });

test('deposition preserves exact old-water boundaries and a thin distinct bed through full-domain projection', () => {
  for (const h of [40, 20, 10]) for (const tiny of [2 ** -40, 2 ** -60]) for (const nBeds of [2, 3, 5, 6]) {
    const delta = 2 ** -30;
    const input = [empty(-1, h - delta), empty(-1, delta - tiny), oldBed(tiny), empty(-2, h)];
    const original = structuredClone(input), drape = .55 * h, out = m.deposit(input, h, nBeds, drape);
    const retained = out.column.filter(p => p.bed === 99), admitted = out.column.filter(p => p.bed >= 0 && p.bed !== 99);
    assert.deepEqual(input, original);
    assert.equal(bulk(out.column), units(2 * h));
    assert.equal(bulk(retained), units(tiny)); near(grain(retained), tiny * .625);
    for (const p of retained) for (const field of ['fraction', 'burial', 'loading', 'offsetX', 'offsetZ']) assert.equal(p[field], oldBed(tiny)[field]);

    const storedSurface = (h - delta) + (delta - tiny), newTop = Math.max(0, storedSurface - drape);
    const oldTopExact = units(h) - units(tiny), newTopExact = units(newTop);
    assert.equal(bulk(admitted), oldTopExact - newTopExact);
    near(grain(admitted), grain(out.flux));
    const bounds = Array.from({ length: nBeds + 1 }, (_, j) => {
      const q = units(Math.max(0, storedSurface - drape + j * drape / nBeds));
      return q < newTopExact ? newTopExact : q > oldTopExact ? oldTopExact : q;
    });
    bounds[0] = newTopExact; bounds[nBeds] = oldTopExact;
    for (let j = 0; j < nBeds; j++) {
      const parts = admitted.filter(p => p.bed === j);
      assert.equal(bulk(parts), bounds[j + 1] - bounds[j]);
      near(grain(parts), out.deposited[j]);
    }

    const raster = m.rasterize([out.column], 2, h);
    assert.equal(raster.domainAdjustments.length, 0); assert.equal(raster.bottomOutside.size, 0);
    const rebuilt = m.packColumn(m.columnsFromRaster(raster, 1, 2, h)[0]).column;
    assert.equal(bulk(rebuilt), units(2 * h));
    assert.equal(bulk(rebuilt.filter(p => p.bed === 99)), units(tiny));
    near(grain(rebuilt.filter(p => p.bed === 99)), tiny * .625);
  }
});
