/** Frozen cross-engine/replay/carried-state verification. Synthetic source paths only. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {wasmEngine} from './engine.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const nativePath=process.env.EARTHFORGE_NATIVE_ENGINE??'target/release/earthforge';
const native=(request,path=nativePath)=>{const p=spawnSync(path,[],{input:JSON.stringify(request),encoding:'utf8',maxBuffer:256*1024*1024});assert.equal(p.status,0,p.stderr);const r=JSON.parse(p.stdout);assert.equal(r.ok,true,r.error);return r.value;};
const physical=v=>({rays:v.rays,points:v.points,slices:v.slices,projection:v.projection});
const paths=['earthforge_core.wasm','earthforge_core_simd.wasm','earthforge_core_deterministic.wasm','earthforge_core_deterministic_simd.wasm'].map(n=>'public/rust/'+n);
const engines=await Promise.all(paths.map(async path=>({path,engine:await wasmEngine(path)})));
const cases=[];
for(const name of ['flat-history','oblique-fault-history','burial-erosion-reburial','two-fault-history']){
 const request=JSON.parse(readFileSync('validation/history3d/requests/'+name+'.json'));
 for(const stage of [0,3,6,9,12]){
  const points=[{x:3500.13,y:4300.31,z:0},{x:3500.13,y:4300.31,z:500},{x:3500.13,y:4300.31,z:1500},{x:8500.71,y:9500.17,z:2800}];
  request.query={stage,nx:3,nz:3,sectionsY:[],rays:[[100.137,250.317],[3500.13,4300.31],[8500.71,9500.17]],includeProfiles:true,points};
  const reference=native(request,'../history3d-engines/reference-native'),expected=physical(reference),value=native(request);
  assert.deepEqual(physical(value),expected,name+' native/reference carried state');
  for(const {path,engine}of engines)assert.deepEqual(physical(engine.run(request)),expected,name+' '+stage+' '+path);
  cases.push({name,stage,rayProfiles:3,pointSamples:points.length,allFiveCurrentEnginesAndReferenceExact:true,physicalSha256:hash(JSON.stringify(expected))});
 }
}
const grid={nx:11,ny:11,nz:11,dx:25,dy:25,dz:25,origin:{x:4800,y:4800,z:300}};
const request={kind:'history3d',options:{steps:12,faults:2},query:{sectionsY:[],grid}};
const volume=native(request);for(const {path,engine}of engines)assert.deepEqual(physical(engine.run(request)),physical(volume),'3Dhistory grid '+path);
const acquisition={kind:'acoustic',grid,velocity:volume.projection.velocity,source:{x:4950,y:4950,z:450},receivers:[{x:4975,y:4950,z:450}],frequencyHz:6,durationSeconds:.4,spongeCells:4,includeFinalField:true};
const shot=native(acquisition);assert.equal(shot.dimensions,3);assert.ok(shot.data.some(v=>v!==0));
for(const {path,engine}of engines)assert.deepEqual(engine.run(acquisition),shot,'3Dhistory shot '+path);
const oldShots=[];
for(const name of ['basin-extension-765184','basin-compression-20261014','layered-3d','faulted-3d']){
 const p=JSON.parse(readFileSync('data/seismic/overnight-v1/'+name+'.json')),s=p.shot;
 const request={kind:'acoustic',grid:p.grid,velocity:p.velocity,source:s.source,receivers:s.receivers,frequencyHz:s.frequencyHz,dtSeconds:s.dtSeconds,sourceDelaySeconds:s.sourceDelaySeconds,durationSeconds:(s.samplesPerReceiver-.5)*s.dtSeconds,spongeCells:s.spongeCells,includeFinalField:true};
 assert.deepEqual(native(request),s,name+' retained canonical shot');oldShots.push({name,exact:true});
}
const report={createdAt:new Date().toISOString(),runtime:process.version,nativePath,nativeSha256:hash(readFileSync(nativePath)),wasmSha256:Object.fromEntries(paths.map(p=>[p,hash(readFileSync(p))])),carriedStateReplayCases:cases,threeDimensionalHistoryGrid:{points:11**3,allCurrentEnginesExact:true},threeDimensionalHistoryShot:{receivers:1,samples:shot.samplesPerReceiver,allTracesAndFinalFieldsExact:true},oldCanonicalNativeShots:oldShots,scope:'Synthetic verification of the stated regional kinematic/vertical-compaction model. Allf64outputs compared exactly; no tolerance changes or observational data.'};
writeFileSync(process.env.EARTHFORGE_VALIDATION_OUTPUT??'validation/history3d/validation-results.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({replayCases:cases.length,carrierRaysCompared:cases.length*3,engines:5,historyGridExact:true,historyShotExact:true,oldCanonicalNativeShots:oldShots.length}));
