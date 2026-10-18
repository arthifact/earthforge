/** Candidate check only: the default application artifact is left unchanged. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const baselinePath=process.env.EARTHFORGE_BASE_WASM??'public/rust/earthforge_core.wasm';
const candidatePath=process.env.EARTHFORGE_SIMD_WASM??'/Users/torus/Documents/Codex/2026-10-17/wah/work/earthforge-simd-target/wasm32-unknown-unknown/release/earthforge_core.wasm';
const hash=x=>createHash('sha256').update(x).digest('hex');
async function load(path){const bytes=readFileSync(path);assert.equal(WebAssembly.validate(bytes),true);return {bytes,exports:(await WebAssembly.instantiate(bytes,{math:{exp:Math.exp,expm1:Math.expm1,tanh:Math.tanh,sin:Math.sin,tan:Math.tan,cbrt:Math.cbrt}})).instance.exports};}
function run(wasm,request){const bytes=new TextEncoder().encode(JSON.stringify(request)),ptr=wasm.earthforge_alloc(bytes.length);try{new Uint8Array(wasm.memory.buffer,ptr,bytes.length).set(bytes);const count=wasm.earthforge_run(ptr,bytes.length);return JSON.parse(new TextDecoder().decode(new Uint8Array(wasm.memory.buffer,wasm.earthforge_result_ptr(),count)));}finally{wasm.earthforge_free(ptr,bytes.length);wasm.earthforge_result_free();}}
const baseline=await load(baselinePath),candidate=await load(candidatePath),rows=[];
for(const name of ['basin-extension-765184','basin-compression-20261014','layered-3d','faulted-3d']) {
 const pair=JSON.parse(readFileSync(`data/seismic/overnight-v1/${name}.json`)),shot=pair.shot;
 const request={kind:'acoustic',grid:pair.grid,velocity:pair.velocity,source:shot.source,receivers:shot.receivers,frequencyHz:shot.frequencyHz,dtSeconds:shot.dtSeconds,sourceDelaySeconds:shot.sourceDelaySeconds,durationSeconds:(shot.samplesPerReceiver-.5)*shot.dtSeconds,spongeCells:shot.spongeCells,includeFinalField:true};
 const result=run(candidate.exports,request);assert.equal(result.ok,true,result.error);assert.deepEqual(result.value,shot);
 rows.push({name,kind:'acoustic',dimensions:shot.dimensions,samples:shot.samplesPerReceiver*shot.receivers.length,bitIdentical:true});console.log(JSON.stringify(rows.at(-1)));
}
const volume=JSON.parse(readFileSync('validation/overnight/volume3d-request.json'));volume.projection={grid:{nx:21,ny:21,nz:14,dx:500,dy:500,dz:400,origin:{x:0,y:0,z:0}}};
const requests=[['volume-projection',volume],['extension',{kind:'section',options:{seed:765184,setting:'extension',h:100,record:false}}],['compression',{kind:'section',options:{seed:20261014,setting:'compression',h:100,record:false}}],['exhumed-extension',{kind:'section',options:{seed:765184,setting:'extension',h:100,exhumation:1,record:false}}]];
for(const [name,request]of requests){const expected=run(baseline.exports,request),actual=run(candidate.exports,request);assert.equal(actual.ok,true,actual.error);assert.deepEqual(actual,expected);rows.push({name,kind:request.kind,bitIdentical:true});console.log(JSON.stringify(rows.at(-1)));}
writeFileSync(process.env.EARTHFORGE_VARIANT_OUT??'validation/overnight/simd-candidate-validation.json',JSON.stringify({runtime:process.version,baselineSha256:hash(baseline.bytes),candidateSha256:hash(candidate.bytes),baselineBytes:baseline.bytes.length,candidateBytes:candidate.bytes.length,flags:process.env.EARTHFORGE_VARIANT_FLAGS??'-C target-feature=+simd128; relaxed SIMD and fast-math are not enabled',applicationDefaultChanged:false,scope:'Strict output equality on four acoustic pairs, one 3D material/projection example and three complete 2D histories. Correctness evidence only; no performance conclusion until isolated measurements on an otherwise idle machine.',rows},null,2)+'\n');
