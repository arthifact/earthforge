import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(process.env.EARTHFORGE_SOURCE??fileURLToPath(new URL('..',import.meta.url)));
const {build}=createRequire(resolve(root,'package.json'))('esbuild');
const bundled=await build({entryPoints:[resolve(root,'src/strata.ts')],bundle:true,platform:'node',format:'esm',write:false});
const {sliceColumn,emptyLayer,rasterize}=await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`);
const layer=height=>({bed:0,height,solid:height*.625,fraction:.375,burial:200,loading:150,offsetX:17,offsetZ:-3});
function units(x){const v=new DataView(new ArrayBuffer(8));v.setFloat64(0,x);const b=v.getBigUint64(0),e=Number(b>>52n&2047n),m=b&((1n<<52n)-1n);return e?(m+(1n<<52n))<<BigInt(e-1):m;}
const bulk=parts=>parts.flatMap(p=>p.lengths??[p.height]).reduce((n,h)=>n+units(h),0n),grains=parts=>parts.reduce((n,p)=>n+p.solid,0);
const near=(a,b)=>assert(Math.abs(a-b)<=128*Number.EPSILON*Math.max(Number.MIN_VALUE,Math.abs(a),Math.abs(b)));

test('signed slice boundaries retain exact linear complements and their grain ledger',()=>{
 for(const end of[40,20,10,4560])for(const shift of[.1,78.76709211370142,2**-60]){
  const amount=Math.min(end,shift),input=[layer(end)],before=structuredClone(input);
  const retained=sliceColumn(input,0,[end,-amount]),outside=sliceColumn(input,[end,-amount],end);
  assert.equal(bulk(retained),units(end)-units(amount));assert.equal(bulk(outside),units(amount));
  assert.equal(bulk([...retained,...outside]),bulk(input));near(grains(retained)+grains(outside),grains(input));assert.deepEqual(input,before);
  const next=[emptyLayer(-1,amount),...retained];assert.equal(bulk(next),units(end));
  // A full domain ending in sediment must succeed without any inert padding.
  const projected=rasterize([next],1,end);assert.deepEqual(projected.domainAdjustments,[]);assert.equal(projected.bottomOutside.size,0);
 }
});

test('signed slice bounds handle zero, domain endpoints, negative clipping and sub-ULP intervals',()=>{
 const input=[layer(10),{...layer(10),bed:1}],saved=structuredClone(input),tiny=2**-60;
 assert.deepEqual(sliceColumn(input,[],[20,10,-10]),input);
 assert.deepEqual(sliceColumn(input,[10,-10],20),input);
 assert.deepEqual(sliceColumn(input,[-20,10],[10,-20]),[]);
 assert.deepEqual(sliceColumn(input,[-20,10],[20]),input);
 assert.deepEqual(sliceColumn(input,[20],[40,-20]),[]);
 assert.equal(bulk(sliceColumn(input,[10,-10],[10,-10,tiny])),units(tiny));
 assert.equal(bulk(sliceColumn(input,[20,-tiny],20)),units(tiny));
 assert.equal(sliceColumn(input,[20,-tiny],20)[0].bed,1);
 for(const value of[NaN,Infinity,-Infinity])for(const bounds of[[[value],20],[0,[value]]])assert.throws(()=>sliceColumn(input,...bounds),/Invalid column slice bounds/);
 assert.deepEqual(input,saved);
});
