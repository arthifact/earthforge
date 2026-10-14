import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const bundle=await build({stdin:{contents:'export * from "./src/strata.ts";',resolveDir:root},bundle:true,platform:'node',format:'esm',write:false});
const {compactColumn,emptyLayer}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
const near=(a,b,t=1e-8)=>assert.ok(Math.abs(a-b)<=t,`${a} != ${b}`);
const physics={porosity:()=>.5,effectiveDepth:d=>Math.max(0,d)};
const layer=(height,solid,offsetZ)=>({bed:0,height,solid,fraction:.37,burial:900,loading:500,offsetX:3.7,offsetZ});
test('identity compaction preserves fractional physical positions in both directions',()=>{
 for(const h of [40,20,10])for(const offset of [-1.3*h,0,.35*h]){
  const column=[emptyLayer(-1,40),layer(20,10,offset),emptyLayer(-2,140)],before=structuredClone(column);
  const r=compactColumn(column,[{carbonate:false}],null,physics),p=r.column.find(p=>p.bed===0);
  near(p.height,20);near(p.offsetZ,offset);near(40+p.height/2+p.offsetZ,50+offset);
  for(const z of [0,40,50,60,200])near(r.mapDepth(z),z);
  assert.deepEqual(column,before);
 }
});
test('bottom-anchored compaction is invariant to the storage allocation of the same physical bed',()=>{
 for(const h of [40,20,10])for(const shift of [-.7*h,0,1.3*h]){
  // The reference bed occupies physical [80,100]. Move its storage interval
  // by shift and cancel that move with its whole-parcel offset.
  const column=[emptyLayer(-1,80+shift),layer(20,5,-shift),{...emptyLayer(-2,100-shift),offsetZ:-shift}];
  const r=compactColumn(column,[{carbonate:false}],null,physics),p=r.column.find(p=>p.bed===0);
  const storedTop=r.column[0].height;
  near(p.height,10);near(p.solid,5);near(p.offsetZ,-shift);
  near(storedTop+p.offsetZ,90);near(storedTop+p.height+p.offsetZ,100);
  near(storedTop+p.height/2+p.offsetZ,95);
  assert.equal(p.fraction,.37);assert.equal(p.burial,900);assert.equal(p.loading,500);assert.equal(p.offsetX,3.7);
  const again=compactColumn(r.column,[{carbonate:false}],null,physics);
  near(again.column[0].height+again.column[1].offsetZ,90);
  near(again.column[1].offsetZ,-shift);
 }
});

test('thin parcels retain allocation translations larger than their thickness beside a differently compacting bed',()=>{
 const c=[emptyLayer(-1,40),layer(.2,.05,27),{...layer(40,20,0),bed:1},emptyLayer(-2,100)];
 const r=compactColumn(c,[{carbonate:false},{carbonate:false}],null,physics),first=r.column.find(p=>p.bed===0),second=r.column.find(p=>p.bed===1);
 near(first.height,.1);near(first.offsetZ,27);near(second.height,40);near(second.offsetZ,0);
 near(r.column[0].height+first.height+first.offsetZ,40.2+27);
 for(const p of r.column.filter(p=>p.bed>=0)){near(p.solid,p.bed===0?.05:20);assert.equal(p.burial,900);assert.equal(p.loading,500);}
 assert.deepEqual(r.column.at(-1),c.at(-1));
});
