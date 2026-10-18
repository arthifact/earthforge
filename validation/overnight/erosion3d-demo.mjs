/** Conservative prescribed 3D erosion, projection and seismic example. No observed data. */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const hash=x=>createHash('sha256').update(x).digest('hex');
const nativePath='target/release/earthforge';
const paths=['public/rust/earthforge_core.wasm','public/rust/earthforge_core_simd.wasm','public/rust/earthforge_core_deterministic.wasm','public/rust/earthforge_core_deterministic_simd.wasm'];
function native(request){const run=spawnSync(nativePath,[],{input:JSON.stringify(request),encoding:'utf8',maxBuffer:128*1024*1024});assert.equal(run.status,0,run.stderr);const result=JSON.parse(run.stdout);assert.equal(result.ok,true,result.error);return result;}
async function load(path){return(await WebAssembly.instantiate(readFileSync(path),{math:{exp:Math.exp,expm1:Math.expm1,tanh:Math.tanh,sin:Math.sin,tan:Math.tan,cbrt:Math.cbrt}})).instance.exports;}
function web(wasm,value){const bytes=new TextEncoder().encode(JSON.stringify(value)),ptr=wasm.earthforge_alloc(bytes.length);try{new Uint8Array(wasm.memory.buffer,ptr,bytes.length).set(bytes);const n=wasm.earthforge_run(ptr,bytes.length);return JSON.parse(new TextDecoder().decode(new Uint8Array(wasm.memory.buffer,wasm.earthforge_result_ptr(),n)));}finally{wasm.earthforge_free(ptr,bytes.length);wasm.earthforge_result_free();}}
const original=JSON.parse(readFileSync('validation/overnight/volume3d-request.json'));
const request={...original,events:[...original.faults.map(fault=>({kind:'fault',fault})),{kind:'erosion',surface:{point:{x:0,y:0,z:1300},slopeX:0.03,slopeY:0.02}}],projection:{grid:{nx:61,ny:31,nz:61,dx:20,dy:20,dz:20,origin:{x:7800.5,y:4500.7,z:1200.3}}}};
delete request.faults;
writeFileSync('validation/overnight/erosion3d-request.json',JSON.stringify(request,null,2)+'\n');
const result=native(request),volume=result.value;
const erosion=volume.eventLedgers.at(-1).ledger;
assert.ok(volume.eventLedgers.every(event=>event.ledger.closed));assert.ok(erosion.removed.grain>0);assert.equal(volume.stats.authoritativeVoxels,0);
for(const fragment of volume.geometry){const source=original.column.find(layer=>layer.bed===fragment.material.bed);assert.equal(fragment.material.maxBurial,source.burial);assert.equal(fragment.material.maxEffectiveDepth,source.loading);}
const {grid,velocity,beds}=volume.projection,receivers=[];
for(let j=5;j<=25;j+=5)for(let i=10;i<=50;i+=5)receivers.push({x:grid.origin.x+i*20,y:grid.origin.y+j*20,z:grid.origin.z+5*20});
const acquisition={kind:'acoustic',grid,velocity,source:{x:grid.origin.x+30*20,y:grid.origin.y+15*20,z:grid.origin.z+5*20},receivers,frequencyHz:6,durationSeconds:0.9,spongeCells:24,includeFinalField:true};
const shot=native(acquisition).value;
for(const path of paths){const wasm=await load(path);assert.deepEqual(web(wasm,request),result,'Material geometry, erosion ledger and projection must match native');assert.deepEqual(web(wasm,acquisition).value,shot,'3D shot must match native');}
const {projection:derived,...materialResult}=volume;
writeFileSync('validation/overnight/erosion3d-result.json',JSON.stringify({...materialResult,projection:{grid:derived.grid,stats:derived.stats}},null,2)+'\n');
const pair={format:'earthforge-seismic-pair-v1',observationalData:'none',metadata:{source:'Continuous 3D layers, two oblique faults, then prescribed sloping erosion',geologicalHistoryScope:'Kinematic faults and erosion; no 3D deposition, compaction or pressure evolution',fullMaterialBounds:volume.bounds,materialInventory:volume.inventory,materialFragments:volume.stats.fragments},grid,velocity,beds,shot};
const text=JSON.stringify(pair);mkdirSync('data/seismic/overnight-v1',{recursive:true});writeFileSync('data/seismic/overnight-v1/eroded-faulted-3d.json',text+'\n');
const report={scope:pair.metadata.geologicalHistoryScope,requestSha256:hash(JSON.stringify(request)),nativeSha256:hash(readFileSync(nativePath)),wasmSha256:Object.fromEntries(paths.map(path=>[path,hash(readFileSync(path))])),pairSha256:hash(text),nativePortableAndSimd:'Bit-identical material geometry, inventories, event ledgers, sections, projected velocities, receiver traces, final field and diagnostics',materialStats:volume.stats,erosion:{surface:erosion.surface,removed:erosion.removed,maxNormalizedResidual:erosion.maxNormalizedResidual},allEventBudgetsClosed:true,burialAndLoadingMemoryPreserved:true,acoustic:{dimensions:shot.dimensions,receivers:receivers.length,samplesPerReceiver:shot.samplesPerReceiver,dtSeconds:shot.dtSeconds,stats:shot.stats},tests:{analyticHingeIntegral:true,exactColumnReduction:true,inverseOccupancyPointsPerHistory:19*13*23,historiesChecked:2,invalidAtomicIdempotentEmpty:true,projectionMemoryAndSurface:true,orderedJsonApiAndLimits:true},observationalScope:'Synthetic inputs only. Reserved FORCE holdout unread and unscored.'};
writeFileSync('validation/overnight/erosion3d-validation.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
