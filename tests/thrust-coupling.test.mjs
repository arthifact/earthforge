import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const bundle=await build({stdin:{contents:'export * from "./src/faultTrace.ts"; export * from "./src/strata.ts"; export * from "./src/basin.ts"; export * from "./src/sedimentBudget.ts";',resolveDir:root},bundle:true,platform:'node',format:'esm',write:false});
const {packColumn,emptyLayer,inventoryOf,compactColumn,simulate,BASIN_DEFAULTS,thrustPoints,traceFromDepth,projectTrace,transportTrace,flowLine,flowMove,domainOf}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
const near=(a,b,t=1e-8)=>assert.ok(Math.abs(a-b)<=t,`${a} != ${b} (tolerance ${t})`);
const bed=(height,solid=height*.4)=>({bed:0,height,solid,fraction:.37,burial:900,loading:500,offsetX:3.7,offsetZ:0});
const overlap=(lo,hi,a,b)=>Math.max(0,Math.min(hi,b)-Math.max(lo,a));

test('packing allocation gaps leaves physical markers and material centroids fixed',()=>{
 for(const gap of [.0001,7.3,40]){
  const column=[emptyLayer(-1,10),bed(5),emptyLayer(-1,gap),bed(20),emptyLayer(-2,100)];
  const before=structuredClone(column),r=packColumn(column,(lo,hi)=>overlap(lo,hi,15,15+gap));
  for(const d of [0,10,12.5,15,15+gap/2,15+gap,35+gap,200])near(r.mapPhysicalDepth(d),d);
  near(r.mapDepth(12.5),12.5+gap);
  let top=0;
  for(const p of r.column){if(p.bed===0&&p.height===5)near(top+p.height/2+p.offsetZ,12.5);top+=p.height;}
  assert.deepEqual(column,before);
  assert.deepEqual(inventoryOf({columns:[r.column],beds:[{carbonate:false}],h:20}),inventoryOf({columns:[column],beds:[{carbonate:false}],h:20}));
  assert.equal(r.column.find(p=>p.bed===0).burial,900);assert.equal(r.column.find(p=>p.bed===0).loading,500);
 }
});

test('real gaps still move geometry, including markers inside a partially numerical gap',()=>{
 const c=[emptyLayer(-1,10),bed(5),emptyLayer(-1,10),bed(20),emptyLayer(-2,100)];
 const r=packColumn(c,(lo,hi)=>overlap(lo,hi,15,19));
 for(const [z,expected] of [[12,18],[15,21],[17,23],[19,25],[22,25],[25,25],[30,30]])near(r.mapPhysicalDepth(z),expected);
 const physical=packColumn(c);for(const z of [0,12,17,22,25,40])near(physical.mapPhysicalDepth(z),physical.mapDepth(z));
 near(r.column[0].height+2.5+r.column[1].offsetZ,18.5);
});

test('numerical flags in surface water or occupied rock do not cancel real gap closure',()=>{
 const c=[emptyLayer(-1,10),bed(5),emptyLayer(-1,3),bed(20),emptyLayer(-2,100)];
 const r=packColumn(c,(lo,hi)=>overlap(lo,hi,0,10)+overlap(lo,hi,25,35));
 near(r.mapPhysicalDepth(12),15);near(r.mapPhysicalDepth(16),18);near(r.mapPhysicalDepth(30),30);
});

test('fault markers still follow independently known pore-volume compaction after packing',()=>{
 const c=[emptyLayer(-1,10),bed(10,2),emptyLayer(-1,7),bed(20,8),emptyLayer(-2,100)];
 const packed=packColumn(c,(lo,hi)=>overlap(lo,hi,20,27));
 const compacted=compactColumn(packed.column,[{carbonate:false}],null,{porosity:()=>.5,effectiveDepth:d=>Math.max(0,d)});
 near(compacted.mapDepth(17),27,1e-8);near(compacted.mapDepth(27),31,1e-8);near(compacted.mapDepth(47),47,1e-8);
 near(compacted.column.find(p=>p.bed===0).height,4,1e-8);near(packed.mapPhysicalDepth(15),15);
});

test('isolated thrusts acquire no artificial bend displacement when allocation gaps close on 40/20/10 m grids',()=>{
 for(const seed of [920001,920006])for(const h of [40,20,10]){
  let previous,collapses=0,maxShift=0;
  const b=simulate({...BASIN_DEFAULTS,seed,h,setting:'compression',thrusts:[1,1],quiet:true,compaction:false,overpressure:0},s=>{
   if(!s.faults.length)return;
   const f=s.faults[0],points=thrustPoints(s,f);
   if(s.process==='collapse'&&previous?.process==='thrust-slip'){
    for(let j=0;j<points.length;j++){maxShift=Math.max(maxShift,Math.abs(points[j][1]-previous.points[j][1]));near(points[j][1],previous.points[j][1],1e-7);}collapses++;
   }
   previous={step:s.step,process:s.process,points};
  });
  assert.ok(collapses>=3,`seed ${seed}, h ${h}: ${collapses} slips checked`);
  assert.equal(b.budget.summary.closed,true);assert.equal(b.budget.summary.flux.repairAdded.total,0);assert.ok(maxShift<1e-7);
 }
});


test('subcell passive translations retain cumulative physical distance in both directions',()=>{
 for(const h of [40,20,10])for(const dir of [-1,1]){
  let segments=[[[0,100],[1000,300]]];
  for(let k=0;k<25;k++)segments=transportTrace(segments,[],()=>1000,(x,z)=>[x+dir*1.3,z-0.7],()=>"flat");
  near(segments[0][0][0],dir*32.5);near(segments[0][0][1],82.5);
  const depth=projectTrace(segments,101,h,0);
  for(let i=0;i<depth.length;i++)if(i*h>40&&i*h<960)near(depth[i],100+.2*(i*h-dir*32.5)-17.5);
 }
});

test('cut branches remain separate, and both contribute where a column intersects both',()=>{
 // z=x crosses a horizontal fault at z=500. Move its hanging wall 120 m
 // right along that flat: [0,500] becomes [120,620], overlapping the footwall.
 for(const h of [40,20,10]){
  const depth=Float64Array.from({length:1000/h+1},(_,i)=>i*h);
  const original=traceFromDepth(depth,h,0),copy=structuredClone(original);
  const moved=transportTrace(original,[],()=>500,(x,z)=>[x+120,z],()=>"flat");
  assert.deepEqual(original,copy);
  const projected=projectTrace(moved,depth.length,h,0);
  near(projected[560/h],(440+560)/2); // moving branch z=x-120, fixed branch z=x
  near(projected[400/h],280);near(projected[800/h],800);
  // Projecting once must not destroy either branch before the next slip.
  const twice=transportTrace(moved,[],()=>500,(x,z)=>[x+120,z],()=>"flat");
  near(projectTrace(twice,depth.length,h,0)[600/h],(360+600)/2);
  assert.ok(Number.isNaN(projected[0]),'the open side vacated by the moving branch is not invented');
 }
});

test('projection counts shared vertices once regardless of segment subdivision or orientation',()=>{
 const a=[[[0,10],[100,30]],[[0,70],[100,70]]];
 const b=[[[0,10],[50,20]],[[50,20],[100,30]],[[100,70],[50,70]],[[50,70],[0,70]]];
 assert.deepEqual(projectTrace(a,11,10,0),projectTrace(b,11,10,0));near(projectTrace(b,11,10,0)[5],45);
});

test('bend-crossing passive traces match independent analytical 45-degree flow at every grid',()=>{
 const P=[[-2000,700],[-1600,700],[-1400,500],[-800,500]],F=flowLine(P),slip=370;
 const input=[[[-2100,400],[-1750,400]]];
 const moved=transportTrace(input,P.map(p=>p[0]),()=>1000,(x,z)=>flowMove(F,x,z,slip),(x,z)=>`${domainOf(F,x,z)}:${domainOf(F,...flowMove(F,x,z,slip))}`);
 // Initially all markers are on the lower flat. Their common 300 m normal
 // offset gives these two independent bend coordinates; the ramp is 45°.
 const xb=-1600-300*Math.tan(Math.PI/8),xe=xb+200;
 for(const h of [40,20,10]){
  const sampled=projectTrace(moved,121,h);
  let n=0;for(let i=0;i<sampled.length;i++)if(Number.isFinite(sampled[i])){
   const x=-2000+i*h,z=x<xb?400:x<xe?400-(x-xb):200;
   near(sampled[i],z,1e-6);n++;
  }assert.ok(n>=5);
 }

});
