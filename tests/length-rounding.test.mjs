import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(process.env.EARTHFORGE_SOURCE??fileURLToPath(new URL('..',import.meta.url))),{build}=createRequire(resolve(root,'package.json'))('esbuild');
const bundled=await build({entryPoints:[resolve(root,'src/exactLength.ts')],bundle:true,platform:'node',format:'esm',write:false});
const {exactLengthScale}=await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`);
function sum(values){const s=exactLengthScale(values);return s.number(values.reduce((n,x)=>n+s.units(x),0n));}

test('exact physical height projection rounds once with sticky bits and ties to even',()=>{
 assert.equal(sum([1,2**-53]),1);
 assert.equal(sum([1,2**-53,2**-107]),1+2**-52);
 assert.equal(sum([1+2**-52,2**-53]),1+2*2**-52);
 assert.equal(sum([2-2**-52,2**-53]),2);
 assert.equal(sum([1,2**-54,2**-54,2**-107]),1+2**-52);
});

test('exact projection preserves subnormal values and rejects nonfinite aggregate geometry',()=>{
 assert.equal(sum([Number.MIN_VALUE,Number.MIN_VALUE,Number.MIN_VALUE]),3*Number.MIN_VALUE);
 assert.equal(sum([2**-1022,Number.MIN_VALUE]),2**-1022+Number.MIN_VALUE);
 assert.equal(sum([Number.MAX_VALUE,2**969]),Number.MAX_VALUE);
 assert.throws(()=>sum([Number.MAX_VALUE,2**970]),/Unrepresentable exact length projection/);
 const s=exactLengthScale([]);assert.equal(s.number(0n),0);assert.throws(()=>s.number(-1n),/Negative exact length/);
});
