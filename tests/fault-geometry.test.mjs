import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const bundle=await build({stdin:{contents:'export * from "./src/normalGeometry.ts"; export * from "./src/thrustGeometry.ts"; export {thrustPoints,simulate,BASIN_DEFAULTS} from "./src/basin.ts"; export * from "./src/normalTransport.ts"; export * from "./src/strata.ts"; export * from "./src/sedimentBudget.ts";',resolveDir:root},bundle:true,platform:'node',format:'esm',write:false});
const {normalDepth,extendNormal,remapNormal,emptyLayer,inventoryOf,expectedInventory,thrustGeometry,sampleColumns,thrustPoints,markersOf,mapMarkerColumn,simulate,BASIN_DEFAULTS}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
const near=(a,b,tol=1e-8)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b}, tolerance ${tol}`);
const tip=(depth,top,dir,h,dip)=>-2000+top*h-dir*depth[top]/Math.tan(dip);

test('listric geometry samples the physical origin, including fractional-cell positions and both dips',()=>{
 for(const h of [40,20,10]) for(const dir of [-1,1]) for(const origin of [217.35,240,253.9]) {
  const dip=1.03,detachment=3200,nx=4000/h+1;
  const {depth,top}=normalDepth(nx,h,origin,dir,dip,detachment);
  near(tip(depth,top,dir,h,dip),origin);
  assert.ok(depth[top]<=1e-10 && depth[top]>-h*Math.tan(dip)-1e-10);
  for(const x of [-800,-400,0,400,800,1200]) {
   const i=(x+2000)/h,s=dir*(x-origin);
   if(s>=0) near(depth[i],detachment*(1-Math.exp(-s*Math.tan(dip)/detachment)));
   else if(i!==top) assert.ok(Number.isNaN(depth[i]));
  }
 }
});

test('repeated fault growth preserves the analytical zero crossing without accumulating a grid-cell drift',()=>{
 for(const h of [40,20,10]) for(const dir of [-1,1]) {
  const origin=217.35,dip=1.03,nx=4000/h+1;
  const f=normalDepth(nx,h,origin,dir,dip,3200);
  let subsided=0;
  for(const increment of [1.7,8.3,21.4,64.2,0,31.9,7.1,111.3,3.7]) {
   for(let i=0;i<nx;i++) if(Number.isFinite(f.depth[i])) f.depth[i]+=increment;
   subsided+=increment;
   const before=f.depth.slice(); f.top=extendNormal(f.depth,f.top,dir,h,dip);
   near(tip(f.depth,f.top,dir,h,dip),origin-dir*subsided/Math.tan(dip));
   for(let i=0;i<nx;i++) if(Number.isFinite(before[i])) near(f.depth[i],before[i]);
   assert.ok(f.depth[f.top]<=0);
  }
 }
});

test('growth stopping at either open side keeps its finite geometry and does not wrap to another column',()=>{
 for(const dir of [-1,1]) {
  const h=20,nx=21,dip=Math.PI/4,origin=dir>0?-1995:-1605;
  const f=normalDepth(nx,h,origin,dir,dip,3000);
  for(let i=0;i<nx;i++) if(Number.isFinite(f.depth[i])) f.depth[i]+=1000;
  const top=extendNormal(f.depth,f.top,dir,h,dip);
  assert.equal(top,dir>0?0:nx-1); assert.ok(f.depth[top]>0); assert.equal(f.depth.length,nx);
 }
});

test('signed tip guards carry no rock, preserve the footwall, and close independent sediment fluxes',()=>{
 for(const h of [40,20,10]) for(const dir of [-1,1]) {
  const nx=400/h+1,end=500,beds=[{carbonate:false}],origin=-1817.35;
  const {depth,top}=normalDepth(nx,h,origin,dir,Math.PI/4,1000);
  const p={bed:0,height:100,solid:40,fraction:0.37,burial:700,loading:500,offsetX:0,offsetZ:0};
  const columns=Array.from({length:nx},()=>[emptyLayer(-1,7.5),{...p},emptyLayer(-2,end-107.5)]);
  const before=structuredClone(columns),moved=remapNormal(columns,depth,2,dir,h,end,beds,true);
  assert.deepEqual(columns,before); assert.deepEqual(moved.columns[top],before[top]);
  const expected=expectedInventory(inventoryOf({columns,beds,h}),moved.flux),actual=inventoryOf({columns:moved.columns,beds,h});
  for(const key of ['total','sand','shale','carbonate']) near(actual[key],expected[key]);
  near(actual.byBed[0],expected.byBed[0]);
  for(const c of moved.columns) {near(c.reduce((s,p)=>s+p.height,0),end); for(const p of c.filter(p=>p.bed>=0)) {assert.equal(p.fraction,0.37);assert.equal(p.burial,700);assert.equal(p.loading,500);}}
  assert.equal(moved.flux.repairAdded.total,0);
 }
});

test('buried thrust bends retain prescribed positions and dip at every grid spacing',()=>{
 for(const h of [40,20,10]) for(const dir of [-1,1]) {
  const xs=Array.from({length:4000/h+1},(_,i)=>-2000+i*h),x1=-dir*523.7,dip=0.41,zd=1400,zu=510.3;
  const points=thrustGeometry(x1,dir,dip,zd,zu,xs,()=>100,false);
  near(points[1][0],x1);near(points[1][1],zd);
  near(points[2][0],x1+dir*(zd-zu)/Math.tan(dip));near(points[2][1],zu);
  near((points[1][1]-points[2][1])/Math.abs(points[2][0]-points[1][0]),Math.tan(dip));
  const f={thrust:{points,bends:[0,0],transport:dir}};
  assert.deepEqual(thrustPoints({nx:xs.length,h},f),points);
  const copy=thrustPoints({nx:xs.length,h},f);copy[1][0]=999;near(points[1][0],x1);
 }
});

test('emergent ramps meet an independently defined sloping surface at its exact intersection',()=>{
 for(const h of [40,20,10]) for(const dir of [-1,1]) {
  const xs=Array.from({length:6000/h+1},(_,i)=>-2000+i*h),x1=1000-dir*1100.7,dip=0.51,zd=1200;
  const floor=x=>210+dir*0.017*(x-x1);
  const x2=x1+dir*(zd-210)/(Math.tan(dip)+0.017);
  const points=thrustGeometry(x1,dir,dip,zd,450,xs,floor,true);
  near(points[2][0],x2);near(points[2][1],floor(x2));
  near(points.at(-1)[1],floor(points.at(-1)[0]));
 }
});

test('emergent upper flat clears a piecewise-linear floor bump without rounding the ramp intersection',()=>{
 for(const h of [40,20,10]) for(const dir of [-1,1]) {
  const xs=Array.from({length:8000/h+1},(_,i)=>-2000+i*h),x1=2000-dir*1800,dip=Math.PI/4;
  const u=x=>dir*(x-x1),floor=x=>100+Math.max(0,180-Math.abs(u(x)-3200)*0.45);
  const points=thrustGeometry(x1,dir,dip,1500,600,xs,floor,true);
  near(u(points[2][0]),1220);near(points[2][1],280);
  for(const x of xs.filter(x=>u(x)>=u(points[2][0]))) {
   const a=points[2],b=points[3],z=a[1]+(b[1]-a[1])*(x-a[0])/(b[0]-a[0]);
   assert.ok(z>=floor(x)-1e-8);
  }
 }
});

test('ramps that leave the open side omit an invented upper flat and keep the prescribed dip',()=>{
 for(const dir of [-1,1]) {
  const xs=Array.from({length:21},(_,i)=>-2000+i*20),x1=dir>0?-1907.3:-1692.7;
  const p=thrustGeometry(x1,dir,0.4,3000,200,xs,()=>100,false);
  assert.equal(p.length,3);near(p[2][1],3000-dir*(p[2][0]-x1)*Math.tan(0.4));
 }
});

test('physical marker sampling reproduces a known affine field without moving the marker',()=>{
 for(const h of [40,20,10]) {
  const nx=4000/h+1;
  for(const x of [-1973.5,-7.1,216.37,1989.2]) near(sampleColumns(x,h,nx,i=>34+0.21*(-2000+i*h)),34+0.21*x);
 }
});

test('burial deformation moves fractional thrust markers by the physical column map, with no in-place double update',()=>{
 for(const h of [40,20,10]) {
  const nx=4000/h+1,points=[[-2000,300],[-134.7,900],[761.3,500],[2000,700]],before=structuredClone(points);
  const markers=markersOf(points);
  for(let i=0;i<nx;i++) mapMarkerColumn(markers,i,h,nx,z=>0.73*z+21+0.019*(-2000+i*h));
  assert.deepEqual(points,before);
  for(const m of markers) {near(m.nextDepth,0.73*m.oldDepth+21+0.019*m.point[0]);near(m.point[0],before[markers.indexOf(m)][0]);}
 }
});

test('the simulator uses the exact normal origin before its first slip on all grids',()=>{
 for(const h of [40,20,10]) {
  let birth;
  const b=simulate({...BASIN_DEFAULTS,h,seed:900006,setting:'extension',faults:[1,1],quiet:true,compaction:false,overpressure:0},s=>{
   if(s.process==='normal-slip'&&!birth)birth={depth:s.faults[0].depth.slice(),dir:s.faults[0].dir};
  });
  assert.ok(birth);const plan=b.historyPlan.normalFaults[0];let measured=0;
  for(let i=0;i<b.nx;i+=11) {
   const d=plan.dir*(-2000+i*h-plan.x);if(d<0)continue;
   near(birth.depth[i],plan.detachment*(1-Math.exp(-d*Math.tan(plan.dip)/plan.detachment)));measured++;
  }
  assert.ok(measured>10);assert.equal(b.budget.summary.closed,true);
 }
});

test('the simulator creates physical thrust bends and retains their horizontal positions through vertical deformation',()=>{
 for(const h of [40,20,10]) {
  let birth,slips=0;
  const b=simulate({...BASIN_DEFAULTS,h,seed:920006,setting:'compression',thrusts:[1,1],quiet:true,compaction:false,overpressure:0},s=>{
   if(s.process==='thrust-slip') {slips++;if(!birth)birth=structuredClone(s.faults[0].thrust.points);}
  });
  assert.ok(birth&&slips>1);const p=b.historyPlan.thrusts[0];
  near(birth[1][0],p.x1);
  near(Math.atan((birth[1][1]-birth[2][1])/Math.abs(birth[2][0]-birth[1][0])),p.dip);
  assert.deepEqual(b.faults[0].thrust.points.map(p=>p[0]),birth.map(p=>p[0]));
  assert.equal(b.budget.summary.closed,true);
 }
});
