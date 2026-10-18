/** Connect continuous 3D geological supports to a derived grid and a full 3D shot. */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const hash=x=>createHash('sha256').update(x).digest('hex');
const nativePath='target/release/earthforge',wasmPath='target/wasm32-unknown-unknown/release/earthforge_core.wasm';
const wasmBinary=readFileSync(wasmPath);
const wasm=(await WebAssembly.instantiate(wasmBinary,{math:{exp:Math.exp,expm1:Math.expm1,tanh:Math.tanh,sin:Math.sin,tan:Math.tan,cbrt:Math.cbrt}})).instance.exports;
function native(request){const p=spawnSync(nativePath,[],{input:JSON.stringify(request),encoding:'utf8',maxBuffer:256*1024*1024});assert.equal(p.status,0,p.stderr);const result=JSON.parse(p.stdout);assert.equal(result.ok,true,result.error);return result.value;}
function web(request){const bytes=new TextEncoder().encode(JSON.stringify(request)),ptr=wasm.earthforge_alloc(bytes.length);try{new Uint8Array(wasm.memory.buffer,ptr,bytes.length).set(bytes);const count=wasm.earthforge_run(ptr,bytes.length);const result=JSON.parse(new TextDecoder().decode(new Uint8Array(wasm.memory.buffer,wasm.earthforge_result_ptr(),count)));assert.equal(result.ok,true,result.error);return result.value;}finally{wasm.earthforge_free(ptr,bytes.length);wasm.earthforge_result_free();}}
const request=JSON.parse(readFileSync('validation/overnight/volume3d-request.json'));
request.includeGeometry=false;request.sectionsY=[];
request.projection={grid:{nx:61,ny:31,nz:61,dx:20,dy:20,dz:20,origin:{x:7800.5,y:4500.7,z:300.3}}};
let start=performance.now();const volume=native(request),projectionMs=performance.now()-start;
assert.deepEqual(volume,web(request),'Native/Wasm material volume and derived velocity grid must match');
assert.ok(volume.ledgers.every(r=>r.closed));
const grid=volume.projection.grid,velocity=volume.projection.velocity;
const receivers=[];for(let j=5;j<=25;j+=5)for(let i=10;i<=50;i+=5)receivers.push({x:grid.origin.x+i*20,y:grid.origin.y+j*20,z:grid.origin.z+5*20});
const acquisition={kind:'acoustic',grid,velocity,source:{x:grid.origin.x+30*20,y:grid.origin.y+15*20,z:grid.origin.z+5*20},receivers,frequencyHz:6,durationSeconds:0.9,spongeCells:24,includeFinalField:true};
start=performance.now();const shot=native(acquisition),shotMs=performance.now()-start;
assert.deepEqual(shot,web(acquisition),'Native/Wasm full 3D geological shot must match');
const text=JSON.stringify({format:'earthforge-seismic-pair-v1',observationalData:'none',metadata:{source:'Continuous 3D stratified material volume after two inclined oblique faults',geologicalHistoryScope:'Prescribed fault kinematics; no full 3D history, compaction or pressure evolution',fullMaterialBounds:volume.bounds,materialInventory:volume.inventory,materialFragments:volume.stats.fragments},grid,velocity,beds:volume.projection.beds,shot});
mkdirSync('data/seismic/overnight-v1',{recursive:true});writeFileSync('data/seismic/overnight-v1/faulted-3d.json',text+'\n');
const report={sourceRequest:'validation/overnight/volume3d-request.json',requestSha256:hash(JSON.stringify(request)),nativeSha256:hash(readFileSync(nativePath)),wasmSha256:hash(wasmBinary),pairSha256:hash(text),physicalOutputNativeWasm:'bit-identical in material volume, projected grid, 3D receiver traces, final field and diagnostics',materialStats:volume.stats,projection:volume.projection.stats,grid,bedCounts:Object.fromEntries([...new Set(volume.projection.beds)].map(bed=>[bed,volume.projection.beds.filter(b=>b===bed).length])),acoustic:{dimensions:shot.dimensions,receivers:shot.receivers.length,samplesPerReceiver:shot.samplesPerReceiver,dtSeconds:shot.dtSeconds,pointsPerDominantWavelength:shot.pointsPerDominantWavelength,stats:shot.stats},smokeMs:{projection:projectionMs,shot:shotMs},timingNote:'Single local smoke times, include native process/boundary overhead; not a performance comparison',scope:'A cropped 3D velocity grid and a genuine 3D constant-density shot derived from the conservative planar-fault prototype. This is not a full 3D geological-history generator or field validation.'};
writeFileSync('validation/overnight/volume-seismic-results.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
