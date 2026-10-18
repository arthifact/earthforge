/** Reproducible synthetic velocity/shot pairs. No observational input. */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='data/seismic/overnight-v1';mkdirSync(root,{recursive:true});
const nativePath=process.env.EARTHFORGE_NATIVE_ENGINE??'target/release/earthforge';
const wasmPath=process.env.EARTHFORGE_WASM_ENGINE??'target/wasm32-unknown-unknown/release/earthforge_core.wasm';
const hash=value=>createHash('sha256').update(value).digest('hex');
const binary=readFileSync(wasmPath),wasm=(await WebAssembly.instantiate(binary,{math:{exp:Math.exp,expm1:Math.expm1,tanh:Math.tanh,sin:Math.sin,tan:Math.tan,cbrt:Math.cbrt}})).instance.exports;
function native(request) {
 const process=spawnSync(nativePath,[],{input:JSON.stringify(request),encoding:'utf8',maxBuffer:256*1024*1024});assert.equal(process.status,0,process.stderr);
 const result=JSON.parse(process.stdout);assert.equal(result.ok,true,result.error);return result.value;
}
function web(request) {
 const bytes=new TextEncoder().encode(JSON.stringify(request)),pointer=wasm.earthforge_alloc(bytes.length);
 try {new Uint8Array(wasm.memory.buffer,pointer,bytes.length).set(bytes);const count=wasm.earthforge_run(pointer,bytes.length);const result=JSON.parse(new TextDecoder().decode(new Uint8Array(wasm.memory.buffer,wasm.earthforge_result_ptr(),count)));assert.equal(result.ok,true,result.error);return result.value;}
 finally {wasm.earthforge_free(pointer,bytes.length);wasm.earthforge_result_free();}
}
const rows=[];
function pair(name,request,metadata,labels=null,verifyWasm=true) {
 const start=performance.now(),shot=native(request),nativeMs=performance.now()-start;
 if(verifyWasm) {const comparison=web(request);assert.deepEqual(comparison,shot,'Native/Wasm shot, diagnostics and final field must be bit-identical');}
 assert.ok(shot.data.every(Number.isFinite));assert.ok(shot.stats.receiverPeak>0);
 const value={format:'earthforge-seismic-pair-v1',observationalData:'none',metadata,grid:request.grid,velocity:request.velocity,beds:labels,shot};
 const text=JSON.stringify(value),path=`${root}/${name}.json`;writeFileSync(path,text+'\n');
 const row={name,path,pairSha256:hash(text),velocitySha256:hash(JSON.stringify(request.velocity)),shotDataSha256:hash(JSON.stringify(shot.data)),nativeWasmBitIdentical:verifyWasm,dimensions:shot.dimensions,grid:shot.grid,receivers:shot.receivers.length,samplesPerReceiver:shot.samplesPerReceiver,dtSeconds:shot.dtSeconds,durationSeconds:(shot.samplesPerReceiver-1)*shot.dtSeconds,pointsPerDominantWavelength:shot.pointsPerDominantWavelength,stats:shot.stats,nativeSmokeMs:nativeMs};
 rows.push(row);console.log(JSON.stringify(row));
}
for(const fixture of [{seed:765184,setting:'extension'},{seed:20261014,setting:'compression'}]) {
 const section=native({kind:'section',options:{...fixture,h:40,record:false}});assert.equal(section.budget.closed,true);
 const {nx,nz,velocity,beds}=section.now;
 // Frame samples are 20 m cell centres. They become nodal values for the
 // acoustic grid; the first node is at (10,0,10) metres in the section frame.
 const grid={nx,ny:1,nz,dx:20,dy:1,dz:20,origin:{x:10,y:0,z:10}};
 const receivers=Array.from({length:Math.floor((nx-5)/2)+1},(_,j)=>({x:10+(2+2*j)*20,y:0,z:50}));
 pair(`basin-${fixture.setting}-${fixture.seed}`,{kind:'acoustic',grid,velocity,source:{x:10+Math.floor(nx/2)*20,y:0,z:50},receivers,frequencyHz:6,durationSeconds:3.2,spongeCells:32,includeFinalField:true},
  {source:'Earth Forge Rust geological-history section',...fixture,historySpacingM:40,velocityProjectionSpacingM:20,modelBudgetClosed:true,modelGrainFinal:section.budget.final.total,sourceUnits:'Unit Ricker q injected with inverse cell measure into m*p_tt - Laplacian(p) + 2*m*sigma*p_t = q; amplitudes are synthetic',boundary:'Sponge on all faces, no free surface'},beds);
}
const nx=41,ny=21,nz=41,h=20;
const velocity=Array.from({length:nx*ny*nz},(_,i)=>Math.floor(i/(nx*ny))<20?2000:3000);
const receivers=[];for(const y of [100,200,300])for(const x of [200,300,400,500,600])receivers.push({x,y,z:100});
pair('layered-3d',{kind:'acoustic',grid:{nx,ny,nz,dx:h,dy:h,dz:h,origin:{x:0,y:0,z:0}},velocity,source:{x:400,y:200,z:100},receivers,frequencyHz:6,durationSeconds:0.9,spongeCells:24,includeFinalField:true},
 {source:'Analytic two-layer synthetic 3D model',interfaceDepthM:400,upperVelocityMps:2000,lowerVelocityMps:3000,note:'Validates full 3D propagation and API; this model is not a full 3D geological history'});
writeFileSync('validation/overnight/seismic-pairs-summary.json',JSON.stringify({nativeSha256:hash(readFileSync(nativePath)),wasmSha256:hash(binary),runtime:process.version,model:'Constant-density isotropic acoustics, fourth-order space, second-order time; all active boundaries use a polynomial sponge',scope:'Two generated 2D basin velocity/shot pairs and one analytic 3D pair. No observational data, elastic waves, intrinsic attenuation, migration, field-amplitude calibration or cross-code validation. Smoke times are single measurements and not a performance comparison.',pairs:rows},null,2)+'\n');
