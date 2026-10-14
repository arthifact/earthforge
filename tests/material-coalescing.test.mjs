import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(process.env.EARTHFORGE_SOURCE ?? fileURLToPath(new URL('..',import.meta.url)));
const {build}=createRequire(resolve(root,'package.json'))('esbuild');
const bundled=await build({entryPoints:[resolve(root,'src/strata.ts')],bundle:true,platform:'node',format:'esm',write:false});
const {append,rasterize,columnsFromRaster,packColumn,sliceColumn,compactColumn,emptyLayer}=await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`);
const layer=(height,bed=0)=>({bed,height,solid:height*.625,fraction:.375,burial:20,loading:10,offsetX:.75,offsetZ:-.25});
function units(x){const v=new DataView(new ArrayBuffer(8));v.setFloat64(0,x);const bits=v.getBigUint64(0),e=Number(bits>>52n&2047n),f=bits&((1n<<52n)-1n);return e?(f+(1n<<52n))<<BigInt(e-1):f;}
const bulk=parts=>parts.flatMap(p=>p.lengths??[p.height]).reduce((n,h)=>n+units(h),0n);
function accurateGrains(parts){let sum=0,c=0;for(const p of parts){const next=sum+p.solid;c+=Math.abs(sum)>=Math.abs(p.solid)?(sum-next)+p.solid:(p.solid-next)+sum;sum=next;}return sum+c;}
const near=(a,b)=>assert(Math.abs(a-b)<=256*Number.EPSILON*Math.max(Number.MIN_VALUE,Math.abs(a),Math.abs(b)),`${a} != ${b}`);
function chunkBound(total){let width=total.toString(2).length;while(total%2n===0n){total/=2n;width--;}return Math.ceil(width/53);}

test('compatible material runs have bounded exact-length representations without historical fragment growth',()=>{
 const heights=[Math.PI,.1,1/3,2**-30,2**-60];
 const input=Array.from({length:6960},(_,j)=>layer(heights[j%heights.length]));
 const saved=structuredClone(input),out=[];for(const p of input)append(out,p);
 assert.equal(bulk(out),bulk(input));assert.equal(out.length,1);assert(out.length<=chunkBound(bulk(input)));
 near(accurateGrains(out),accurateGrains(input));assert.deepEqual(input,saved);
 for(const p of out)for(const field of['bed','fraction','burial','loading','offsetX','offsetZ'])assert.equal(p[field],input[0][field]);
 // Reappending a canonical expansion must not grow or shift its intervals.
 const stable=[];for(const p of out)append(stable,p);assert.equal(stable.length,out.length);assert.equal(bulk(stable),bulk(out));near(accurateGrains(stable),accurateGrains(out));
});

test('tiny distinct beds, density, histories and translations remain distinct while compatible neighbors coalesce',()=>{
 for(const field of['bed','fraction','burial','loading','offsetX','offsetZ']){
  const a=layer(10),b={...layer(2**-60),[field]:a[field]+1},out=[];
  append(out,a);append(out,b);append(out,a);
  assert.equal(out.length,3);assert.deepEqual(out[1],b);assert.deepEqual(out[0],a);assert.deepEqual(out[2],a);
 }
 const out=[],a=layer(1),b={...layer(1),solid:.7};append(out,a);append(out,b);assert.deepEqual(out,[a,b]);
});

test('100 raster rebuild pack slice cycles retain a bounded representation with and without active compaction',()=>{
 const physics={porosity:(_f,d)=>.3*Math.exp(-d/1000),effectiveDepth:d=>d};
 const beds=[{carbonate:false},{carbonate:false}];
 for(const h of[40,20,10])for(const active of[false,true]){
  let column=[emptyLayer(-1,60),layer(10.125),{...layer(29.875),bed:1},emptyLayer(-2,60)];
  const original=structuredClone(column),grain=accurateGrains(column),counts=[];
  for(let round=0;round<100;round++){
   const r=rasterize([column],160/h,h);column=columnsFromRaster(r,1,160/h,h)[0];column=packColumn(column).column;column=sliceColumn(column,0,160);
   if(active)column=compactColumn(column,beds,null,physics).column;
   counts.push(column.length);near(accurateGrains(column),grain);assert(column.some(p=>p.bed===0)&&column.some(p=>p.bed===1));
   if(!active){assert.equal(bulk(column),bulk(original));for(const bed of[0,1])assert.equal(bulk(column.filter(p=>p.bed===bed)),bulk(original.filter(p=>p.bed===bed)));}
  }
  assert(Math.max(...counts)<=2*original.length);assert(counts.at(-1)<=counts[9]);
  if(active)assert(column.filter(p=>p.bed>=0).reduce((s,p)=>s+p.height,0)<40,'fixture must actually compact');
 }
});

test('nonfinite merged material aggregates fail explicitly',()=>{
 // Both densities remain finite and identical, while their combined grain
 // and height totals cannot be represented by the Number-valued physics API.
 const out=[];append(out,layer(Number.MAX_VALUE));assert.throws(()=>append(out,layer(Number.MAX_VALUE)),/Unrepresentable exact length chunk|Invalid canonical material aggregate/);
 const grains=[],p={...layer(1),solid:Number.MAX_VALUE};append(grains,p);assert.throws(()=>append(grains,p),/Invalid canonical material aggregate/);
});

// Independent exact-interval regression fixtures, shared with the external
// 100-cycle audit. Physical grain arithmetic is checked to floating precision.
{
const m = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`);
function exact(x){assert(x>=0&&Number.isFinite(x));const v=new DataView(new ArrayBuffer(8));v.setFloat64(0,x);const b=v.getBigUint64(0),e=Number(b>>52n&2047n),q=b&((1n<<52n)-1n);return e?(q+(1n<<52n))<<BigInt(e-1):q;}
const sum=a=>a.reduce((n,x)=>n+exact(x),0n),gcd=(a,b)=>b?gcd(b,a%b):a,near=(a,b)=>assert(Math.abs(a-b)<=256*Number.EPSILON*Math.max(Math.abs(a),Math.abs(b),Number.MIN_VALUE),`${a} != ${b}`);
function expand(u){const a=[];while(u){const shift=Math.max(0,u.toString(2).length-53),top=u>>BigInt(shift);a.push(Number(top)*2**(shift-1074));u-=top<<BigInt(shift);}return a;}
const empty=(bed,height)=>({bed,height,solid:0,fraction:0,burial:0,loading:0,offsetX:0,offsetZ:0}),bed=(height,id=0,changes={})=>({bed:id,height,solid:height*.625,fraction:.375,burial:1e6,loading:1e6,offsetX:.75,offsetZ:-.25,...changes});
const sameState=p=>[p.bed,p.fraction,p.burial,p.loading,p.offsetX,p.offsetZ,p.solid/p.height].join('|');
const grain=(c,id)=>c.filter(p=>p.bed===id).reduce((s,p)=>s+p.solid,0),bulk=(c,id)=>sum(c.filter(p=>p.bed===id).flatMap(p=>p.lengths??[p.height]));
const cycleCases=[];
function record(kind,h,tiny,run){cycleCases.push({kind,h,tiny,run});}
function run(input,h,nz,mode,locatedBed,expectedCell){const original=structuredClone(input),domain=exact(h)*BigInt(nz);assert.equal(sum(input.flatMap(p=>p.lengths??[p.height])),domain);let divisor=input.map(p=>exact(p.height)).reduce(gcd);divisor=gcd(divisor,exact(h));const chunks=Math.ceil((domain/divisor).toString(2).length/53),interfaces=1+input.slice(1).filter((p,j)=>sameState(p)!==sameState(input[j])).length,bound=chunks*(interfaces+nz-1);let col=input,maxParts=0,reference=null,maxGrainDelta=0;const originalGrains=new Map([...new Set(input.filter(p=>p.bed>=0).map(p=>p.bed))].map(id=>[id,grain(input,id)]));
 for(let iteration=0;iteration<100;iteration++){
  const before=structuredClone(col),r=m.rasterize([col],nz,h);assert.deepEqual(col,before);assert.equal(r.bottomOutside.size,0);
  for(let k=0;k<nz;k++)assert.equal(sum(m.cellLayers(r,k,h).flatMap(p=>p.lengths??[p.height])),exact(h),'Every cell must remain valid input to strict capacity allocation');
  if(locatedBed!==undefined){const where=Array.from({length:nz},(_,k)=>k).filter(k=>m.cellLayers(r,k,h).some(p=>p.bed===locatedBed));assert.deepEqual(where,[expectedCell]);}
  col=m.columnsFromRaster(r,1,nz,h)[0];col=m.packColumn(col).column;col=m.sliceColumn(col,0,nz*h);
  if(mode==='identity-compaction')col=m.compactColumn(col,[{carbonate:false}],null,{porosity:()=>.375,effectiveDepth:()=>0}).column;
  maxParts=Math.max(maxParts,col.length);assert(col.length<=bound,`Layer count ${col.length} exceeds analytical interfaces/intersections bound ${bound}`);
  assert.equal(sum(col.flatMap(p=>p.lengths??[p.height])),domain);for(const[id,value]of originalGrains){near(grain(col,id),value);maxGrainDelta=Math.max(maxGrainDelta,Math.abs(grain(col,id)-value));assert.equal(bulk(col,id),bulk(input,id));}
  const signature=JSON.stringify(col);if(reference!==null)assert.equal(signature,reference,'No-op material state should be idempotent after its first canonical cycle');reference=signature;
 }
 assert.deepEqual(input,original);return{cycles:100,initial_parts:input.length,interfaces,grid_intersections:nz-1,binary_chunks_bound:chunks,analytical_size_bound:bound,maximum_parts:maxParts,maximum_grain_delta:maxGrainDelta,idempotent:true,exact_cell_bulk_and_bed_bulk:true,input_pure:true};}
for(const h of [40,20,10])for(const tiny of [2**-40,2**-60]){
 const d=2**-30,inside=[empty(-1,h-d),empty(-1,d-tiny),bed(tiny),empty(-2,h)],after=[empty(-1,h),bed(tiny),empty(-2,h-d),empty(-2,d-tiny)],middle=[empty(-1,h/4),bed(tiny),empty(-2,3*h/4-d),empty(-2,d-tiny)];
 for(const[location,col,nz,cell]of[['before-boundary',inside,2,0],['after-boundary',after,2,1],['middle',middle,1,0]])for(const mode of ['geometry-only','identity-compaction'])record(location+'-'+mode,h,tiny,()=>run(col,h,nz,mode,0,cell));
}
for(const h of [40,20,10]){
 const col=[empty(-1,h/4),bed(2*h),...Array.from({length:400},(_,j)=>bed(2**(-10-j%51)))];for(const height of expand(exact(4*h)-sum(col.flatMap(p=>p.lengths??[p.height]))))col.push(empty(-2,height));
 record('400-compatible-fragments-geometry-only',h,null,()=>run(col,h,4,'geometry-only'));
 record('400-compatible-fragments-identity-compaction',h,null,()=>run(col,h,4,'identity-compaction'));
 record('active-compaction-conserves-grains-and-known-volume',h,null,()=>{const initial=structuredClone(col),before=grain(col,0),projected=m.columnsFromRaster(m.rasterize([col],4,h),1,4,h)[0],out=m.compactColumn(projected,[{carbonate:false}],null,{porosity:()=>.25,effectiveDepth:()=>0}).column,actual=out.filter(p=>p.bed===0).reduce((s,p)=>s+p.height,0),expected=before/.75,solverBound=col.filter(p=>p.bed===0).reduce((s,p)=>s+p.height,0)*2**-35+512*Number.EPSILON*expected;assert(Math.abs(actual-expected)<=solverBound);near(grain(out,0),before);assert.deepEqual(col,initial);return{source_solid:before,output_solid:grain(out,0),expected_bulk:expected,actual_bulk:actual,bisection_and_roundoff_bound:solverBound,part_count:out.length};});
}

for (const [name, select] of [
 ['100 no-op cycles retain sub-ULP bed ownership including identity compaction', q => q.tiny !== null],
 ['canonical compatible runs stay within an interface-derived size bound for 100 cycles', q => q.kind.startsWith('400-compatible')],
 ['active constant-porosity compaction conserves grains and matches the analytical volume', q => q.kind.startsWith('active-compaction')],
]) test(name, () => {
 for (const fixture of cycleCases.filter(select)) {
  try { fixture.run(); }
  catch (error) { error.message = `${fixture.kind}, h=${fixture.h}, tiny=${fixture.tiny}: ${error.message}`; throw error; }
 }
});
assert.equal(cycleCases.length,45);
}
