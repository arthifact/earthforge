import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const bundle=await build({stdin:{contents:"export * from './src/capacityTransport.ts';export * from './src/capacitySlices.ts';export * from './src/exactLength.ts';export {layerLengths,withLayerLengths} from './src/strata.ts';export {assignTransport,PlacementError} from './src/conservativeTransport.ts';",resolveDir:root},bundle:true,platform:'node',format:'esm',write:false});
const {assignCapacityTransport,sliceCapacityShares,exactLengthScale,layerLengths,withLayerLengths,assignTransport,PlacementError}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].contents).toString('base64'));

test('fractional capacity resolves a feasible material flow with no indivisible matching',()=>{
 const parcels=[{source:0,i:0,k:0,targetI:.1,height:.8,weight:.8},{source:1,i:0,k:0,targetI:.2,height:.6,weight:.6}];
 const capacity=new Float64Array([1,.4]), result=assignCapacityTransport(2,1,new Uint8Array([1,1]),parcels,capacity);
 assert.ok(result.splitSources>0);
 const {units}=exactLengthScale([...parcels.map(p=>p.height),...capacity,...result.shares.flatMap(p=>p.lengths??[p.height])]);
 for(let p=0;p<parcels.length;p++)assert.equal(result.shares.filter(s=>s.parcel===p).reduce((u,s)=>u+(s.lengths??[s.height]).reduce((v,h)=>v+units(h),0n),0n),units(parcels[p].height));
 for(let n=0;n<capacity.length;n++)assert.ok(result.shares.filter(s=>s.destination===n).reduce((u,s)=>u+(s.lengths??[s.height]).reduce((v,h)=>v+units(h),0n),0n)<=units(capacity[n]));
});

test('finite extreme density scales preserve the known displacement optimum',()=>{
 function solve(height,weight){const ps=[{source:0,i:0,k:0,targetI:.1,height,weight:.1*weight},{source:1,i:0,k:0,targetI:.2,height,weight}];return assignCapacityTransport(2,1,new Uint8Array([1,1]),ps,new Float64Array([height,height])).shares.map(s=>[s.parcel,s.destination,s.height/height]);}
 // Heavy packet ->0 and thin packet ->1 costs .121; opposite routing costs .641.
 const expected=[[1,0,1],[0,1,1]];
 for(const [height,weight] of [[1,1],[1e300,1e-300],[1e-300,1e300],[1e100,1e-100]])assert.deepEqual(solve(height,weight),expected);
});

test('subnormal nonzero density ratios retain relative weights under common rescaling',()=>{
 function solve(height,weight){const ps=[{source:0,i:0,k:0,targetI:.1,height,weight:.7*weight},{source:1,i:0,k:0,targetI:.2,height,weight}];return assignCapacityTransport(2,1,new Uint8Array([1,1]),ps,new Float64Array([height,height])).shares.map(s=>[s.parcel,s.destination,s.height/height]);}
 // True normalized densities .7 and1 have costs .607 vs .647. Rounding both
 // densities to5e-324 before normalization incorrectly reverses this optimum.
 assert.deepEqual(solve(1,1),[[1,0,1],[0,1,1]]);
 assert.deepEqual(solve(2e23,1e-300),solve(1,1));
});

test('quantized capacity objective agrees with exhaustive small two-dimensional optima',()=>{
 let seed=91387, feasible=0, infeasible=0;
 const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
 function oracle(cap,ps,cost,radius){let states=new Map([[cap.join(','),0n]]);for(let p=0;p<ps.length;p++)for(let u=0;u<ps[p].height;u++){const next=new Map();for(const[key,value]of states){const c=key.split(',').map(Number);for(let n=0;n<c.length;n++)if(c[n]>0&&Math.hypot(n%2-ps[p].i,Math.floor(n/2)-ps[p].k)<=radius){c[n]--;const k=c.join(','),v=value+cost(p,n);if(!next.has(k)||v<next.get(k))next.set(k,v);c[n]++;}}states=next;}return states.size?[...states.values()].reduce((a,b)=>a<b?a:b):null;}
 for(let t=0;t<300;t++){
  const cap=Array.from({length:4},()=>Math.floor(random()*3)),ps=Array.from({length:1+Math.floor(random()*4)},(_,source)=>{const targetI=random(),targetK=random();return{source,i:Math.round(targetI),k:Math.round(targetK),targetI,targetK,height:1+Math.floor(random()*3),weight:.1+random()*2};});
  const max=Math.max(...ps.map(p=>p.weight/p.height)),cost=(p,n)=>BigInt(Math.round((ps[p].weight/ps[p].height/max)*((n%2-ps[p].targetI)**2+(Math.floor(n/2)-ps[p].targetK)**2)/1e-12));
  const expected=oracle(cap,ps,cost,2);
  if(expected===null){assert.throws(()=>assignCapacityTransport(2,2,Uint8Array.from(cap,c=>Number(c>0)),ps,Float64Array.from(cap)),/cannot place source/);infeasible++;continue;}
  const got=assignCapacityTransport(2,2,Uint8Array.from(cap,c=>Number(c>0)),ps,Float64Array.from(cap));
  assert.equal(got.shares.reduce((sum,s)=>sum+BigInt(s.height)*cost(s.parcel,s.destination),0n),expected);feasible++;
 }
 assert.ok(feasible>50&&infeasible>50);
});

test('vertical capacity slices retain tiny distinct material and inherited state',()=>{
 const tiny=2**-60,layer=(bed,height)=>({bed,height,solid:.5*height,fraction:.25,burial:bed+10,loading:bed+7,offsetX:3,offsetZ:-2});
 const parts=[layer(0,1),layer(1,tiny),layer(2,1)],before=structuredClone(parts),shares=[{parcel:0,destination:0,height:1},{parcel:0,destination:1,height:tiny},{parcel:0,destination:2,height:1}];
 const slices=sliceCapacityShares([{parts}],shares,3);assert.deepEqual(parts,before);assert.equal(slices.length,3);
 const retained=slices.find(s=>s.part.bed===1);assert.deepEqual(retained.part,parts[1]);assert.equal(retained.destination,1);assert.equal(retained.sourceLocalTop,1);
 for(const s of slices)for(const key of ['fraction','burial','loading','offsetX','offsetZ'])assert.equal(s.part[key],parts[s.sourcePart][key]);
});

test('capacity assignment rejects nonfinite or nonpositive material inputs',()=>{
 const base={source:0,i:0,k:0,height:1,weight:1},go=p=>assignCapacityTransport(1,1,new Uint8Array([1]),[p],new Float64Array([1]));
 for(const field of ['height','weight'])for(const value of [0,-1,NaN,Infinity])assert.throws(()=>go({...base,[field]:value}),/Invalid capacity parcel/);
 for(const value of [[],[0],[NaN],[Infinity],[-1]])assert.throws(()=>go({...base,materialHeights:value}),/Invalid capacity parcel/);
});

test('one exact allocation arc stays one physical slice despite binary residuals',()=>{
 const tiny=2**-60;
 const layer=withLayerLengths({bed:7,height:1,solid:.6,fraction:.37,burial:123,loading:91,offsetX:-5,offsetZ:8},[1,.5,tiny]);
 const parcels=[{source:0,i:0,k:0,height:layer.height,weight:1,materialHeights:[...layerLengths(layer)]}];
 const before=structuredClone({layer,parcels});
 const result=assignCapacityTransport(2,1,Uint8Array.of(1,1),parcels,Float64Array.of(1.25,.75));
 assert.equal(result.shares.length,2,'one share per source/destination arc');
 assert.equal(result.shares.filter(s=>s.lengths).length,1,'one nonrepresentable residual stays metadata');
 const slices=sliceCapacityShares([{parts:[layer]}],result.shares,2);
 assert.equal(slices.length,2,'two actual spatial children, no residual child');
 const scale=exactLengthScale([...layerLengths(layer),...slices.flatMap(s=>[...layerLengths(s.part)])]);
 const bulk=ps=>ps.reduce((sum,p)=>sum+layerLengths(p).reduce((v,h)=>v+scale.units(h),0n),0n);
 assert.equal(bulk(slices.map(s=>s.part)),bulk([layer]));
 assert.equal(slices.reduce((s,p)=>s+p.part.solid,0),layer.solid);
 for(const q of slices)for(const key of ['bed','fraction','burial','loading','offsetX','offsetZ'])assert.equal(q.part[key],layer[key]);
 assert.equal(slices[1].sourceLocalTop,1.25);
 assert.deepEqual({layer,parcels},before);
 // With enough room, one original physical constituent remains one slice.
 const one=assignCapacityTransport(1,1,Uint8Array.of(1),parcels,Float64Array.of(2));
 assert.equal(one.shares.length,1);assert.deepEqual(one.shares[0].lengths,layer.lengths);
 const whole=sliceCapacityShares([{parts:[layer]}],one.shares,1);
 assert.equal(whole.length,1);assert.deepEqual(whole[0].part,layer);
});

test('indivisible matching rejects even one-ulp overcapacity in greedy and augmenting edges',()=>{
 const below=1-2**-53,full={source:0,i:0,k:0,height:1};
 const capacity=Float64Array.of(below,1),allowed=Uint8Array.of(1,1),before=structuredClone({capacity,allowed,full});
 assert.deepEqual([...assignTransport(2,1,allowed,[full],capacity).destination],[1]);
 assert.throws(()=>assignTransport(1,1,Uint8Array.of(1),[full],Float64Array.of(below)),PlacementError);
 assert.throws(()=>assignTransport(2,1,allowed,[full,{...full,source:1}],Float64Array.of(1,below)),PlacementError);
 for(const reverse of [false,true]){
  const ps=[{source:0,i:0,k:0,height:.5},{source:1,i:0,k:0,height:1}];if(reverse)ps.reverse();
  const result=assignTransport(2,1,allowed,ps,Float64Array.of(1,below));
  for(let j=0;j<ps.length;j++)assert.equal(result.destination[j],ps[j].source===1?0:1);
 }
 assert.deepEqual({capacity,allowed,full},before);
});
