import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(process.env.EARTHFORGE_SOURCE??fileURLToPath(new URL('..',import.meta.url))),{build}=createRequire(resolve(root,'package.json'))('esbuild');
const bundled=await build({entryPoints:[resolve(root,'src/strata.ts')],bundle:true,platform:'node',format:'esm',write:false});
const {withLayerLengths,layerLengths,portionByLengths,portion,append,emptyLayer,rasterize,columnsFromRaster,packColumn,sliceColumn,compactColumn,depositedLayer}=await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`);
function units(x){const v=new DataView(new ArrayBuffer(8));v.setFloat64(0,x);const b=v.getBigUint64(0),e=Number(b>>52n&2047n),m=b&((1n<<52n)-1n);return e?(m+(1n<<52n))<<BigInt(e-1):m;}
const span=p=>(p.lengths??[p.height]).reduce((n,h)=>n+units(h),0n),bulk=ps=>ps.reduce((n,p)=>n+span(p),0n),near=(a,b)=>assert(Math.abs(a-b)<=128*Number.EPSILON*Math.max(Number.MIN_VALUE,Math.abs(a),Math.abs(b)));
const layer=(height,bed=0)=>({bed,height,solid:height*.625,fraction:.375,burial:20,loading:10,offsetX:.75,offsetZ:-.25});

test('one material parcel carries a complete exact expansion without introducing extra quadrature samples',()=>{
 const p=layer(10),saved=structuredClone(p),q=withLayerLengths(p,[10,2**-60]);
 assert.equal(q.height,10);assert.equal(q.solid,p.solid);assert.equal(span(q),units(10)+units(2**-60));assert.deepEqual(p,saved);assert.equal(layerLengths(q),q.lengths);
 const reset=portion(q,3);assert.equal(reset.height,3);assert.equal(reset.lengths,undefined);near(reset.solid,p.solid*3/10);
 const cut=portionByLengths(q,[1,2**-60]);assert.equal(span(cut),units(1)+units(2**-60));near(cut.solid,p.solid/10);
 assert.equal(withLayerLengths(emptyLayer(-1,0),[]).height,0);assert.throws(()=>withLayerLengths(p,[]),/Invalid grouped material extent/);assert.deepEqual(portionByLengths(p,[]),{...p,height:0,solid:0});
 for(const a of[[-1],[NaN],[Infinity]])assert.throws(()=>withLayerLengths(p,a));
});

test('same-state binary pieces canonicalize to one physical layer while thin identities stay separate',()=>{
 const input=Array.from({length:6960},(_,j)=>layer([Math.PI,.1,1/3,2**-30,2**-60][j%5])),out=[];
 for(const p of input)append(out,p);assert.equal(out.length,1);assert.equal(bulk(out),bulk(input));near(out[0].solid,input.reduce((n,p)=>n+p.solid,0));
 const tiny=layer(2**-60,1);append(out,tiny);append(out,layer(1));assert.equal(out.length,3);assert.deepEqual(out[1],tiny);
});

test('identity compaction visits a grouped physical parcel once and retains exact material support',()=>{
 const tiny=2**-60,delta=2**-30,p=withLayerLengths({...layer(10),solid:5,burial:0,loading:0},[10,tiny]);
 const column=[emptyLayer(-1,10),p,emptyLayer(-2,20-delta),emptyLayer(-2,delta-tiny)];let calls=0;
 const result=compactColumn(column,[{carbonate:false}],null,{porosity:()=>{calls++;return .5;},effectiveDepth:d=>d}).column;
 assert.equal(calls,1);assert.equal(result.filter(p=>p.bed===0).length,1);assert.equal(bulk(result),bulk(column));assert.equal(span(result.find(p=>p.bed===0)),span(p));
});

test('100 grouped material round trips retain tiny boundary ownership and bounded physical layer counts',()=>{
 for(const h of[40,20,10])for(const tiny of[2**-40,2**-60]){
  const delta=2**-30,source=[emptyLayer(-1,h-delta),emptyLayer(-1,delta-tiny),layer(tiny),emptyLayer(-2,h)],saved=structuredClone(source);
  let c=source;for(let j=0;j<100;j++){
   const r=rasterize([c],2,h);assert.equal([...r.subcells].filter(([_n,ps])=>ps.some(p=>p.bed===0)).length,1);assert(r.subcells.get(0).some(p=>p.bed===0));
   c=columnsFromRaster(r,1,2,h)[0];c=packColumn(c).column;c=sliceColumn(c,0,2*h);assert.equal(bulk(c),bulk(source));assert.equal(span(c.find(p=>p.bed===0)),units(tiny));assert(c.length<=3);
  }assert.deepEqual(source,saved);
 }
});

test('deposition uses one layer per physical quadrature bin even for exact residual spans',()=>{
 const physics={porosity:()=>.25,effectiveDepth:d=>d};
 for(const h of[22,43,40,20,10])for(const tiny of[0,2**-60]){
  const out=depositedLayer(0,[h,tiny],.25,false,0,null,physics);assert.equal(out.length,Math.ceil((h+tiny)/10));assert.equal(bulk(out),units(h)+units(tiny));near(out.reduce((n,p)=>n+p.solid,0),.75*(h+tiny));
 }
});
