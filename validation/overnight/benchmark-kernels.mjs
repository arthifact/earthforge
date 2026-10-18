/** Isolated end-to-end wave-kernel candidates; waits for the regression suite. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {cpus,totalmem,loadavg} from 'node:os';
import {resolve} from 'node:path';
const folder=process.env.EARTHFORGE_CANDIDATES??'/Users/torus/Documents/Codex/2026-10-17/wah/work/engine-candidates';
const hash=x=>createHash('sha256').update(x).digest('hex');
const median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
const variants=process.env.EARTHFORGE_BENCHMARK_VARIANTS?JSON.parse(process.env.EARTHFORGE_BENCHMARK_VARIANTS):[{name:'baseline-native',type:'native',path:folder+'/baseline-native'},{name:'reduction-native',type:'native',path:folder+'/reduction-native'},{name:'baseline-scalar',type:'wasm',path:folder+'/baseline-scalar.wasm'},{name:'reduction-scalar',type:'wasm',path:folder+'/reduction-scalar.wasm'},{name:'baseline-simd',type:'wasm',path:folder+'/baseline-simd.wasm'},{name:'reduction-simd',type:'wasm',path:folder+'/reduction-simd.wasm'}];
if(process.argv[2]==='--worker') {
 const variant=JSON.parse(process.argv[3]),name=process.argv[4];
 const pair=JSON.parse(readFileSync(`data/seismic/overnight-v1/${name}.json`)),shot=pair.shot;
 const request={kind:'acoustic',grid:pair.grid,velocity:pair.velocity,source:shot.source,receivers:shot.receivers,frequencyHz:shot.frequencyHz,dtSeconds:shot.dtSeconds,sourceDelaySeconds:shot.sourceDelaySeconds,durationSeconds:(shot.samplesPerReceiver-.5)*shot.dtSeconds,spongeCells:shot.spongeCells,includeFinalField:true};
 const text=JSON.stringify(request),bytes=new TextEncoder().encode(text),expected=hash(JSON.stringify(shot));
 let wasm;
 if(variant.type==='wasm')wasm=(await WebAssembly.instantiate(readFileSync(variant.path),{math:{exp:Math.exp,expm1:Math.expm1,tanh:Math.tanh,sin:Math.sin,tan:Math.tan,cbrt:Math.cbrt}})).instance.exports;
 const trials=[];
 for(let i=-1;i<3;i++) {
  const start=performance.now();let result;
  if(variant.type==='native') {
   const run=spawnSync(variant.path,[],{input:text,encoding:'utf8',maxBuffer:128*1024*1024,env:{...process.env,...variant.env}});assert.equal(run.status,0,run.stderr);result=JSON.parse(run.stdout);
  } else {
   const ptr=wasm.earthforge_alloc(bytes.length);
   try {new Uint8Array(wasm.memory.buffer,ptr,bytes.length).set(bytes);const length=wasm.earthforge_run(ptr,bytes.length);result=JSON.parse(new TextDecoder().decode(new Uint8Array(wasm.memory.buffer,wasm.earthforge_result_ptr(),length)));}
   finally {wasm.earthforge_free(ptr,bytes.length);wasm.earthforge_result_free();}
  }
  const elapsedMs=performance.now()-start;assert.equal(result.ok,true,result.error);
  const outputHash=hash(JSON.stringify(result.value));assert.equal(outputHash,expected,'Candidate differs from canonical physical output');
  trials.push({iteration:i,warmup:i<0,elapsedMs,outputHash,wasmMemoryBytes:wasm?.memory.buffer.byteLength});
 }
 process.stdout.write(JSON.stringify({case:name,variant:variant.name,environment:variant.env??{},trials,medianMs:median(trials.filter(t=>!t.warmup).map(t=>t.elapsedMs))}));
} else {
 const outputPrefix=process.env.EARTHFORGE_BENCHMARK_PREFIX??'validation/overnight/kernel-benchmark';
 const statusPath=outputPrefix+'-status.json';
 const status=(stage,extra={})=>writeFileSync(statusPath,JSON.stringify({stage,at:new Date().toISOString(),...extra},null,2)+'\n');
 const deadline=Date.parse('2026-10-17T12:45:00Z');
 console.log('Waiting for the legacy regression to finish before measuring candidate performance.');status('waiting-for-legacy');
 while(true) {
  if(existsSync('validation/overnight/legacy-tests-results.json')) {
   const legacy=JSON.parse(readFileSync('validation/overnight/legacy-tests-results.json'));
   if(!legacy.passed){status('requires-legacy-review',{exitCode:legacy.exitCode,signal:legacy.signal});throw Error('Review the legacy regression before benchmarking');}
   break;
  }
  if(Date.now()>deadline){status('deadline-before-legacy-completed');throw Error('Legacy regression did not complete in the benchmark window');}
  await new Promise(resolve=>setTimeout(resolve,15000));
 }
 // Let completed test workers and compiler services settle before warmups.
 status('settling');await new Promise(resolve=>setTimeout(resolve,30000));
 const hashes=Object.fromEntries(variants.map(v=>[v.name,hash(readFileSync(v.path))]));
 const rows=[];let index=0;status('measuring');
 for(const name of (process.env.EARTHFORGE_BENCHMARK_CASES??'basin-extension-765184,basin-compression-20261014,layered-3d,faulted-3d').split(',')) {
  const order=index%2?[...variants].reverse():variants;index++;
  for(const variant of order) {
   const run=spawnSync(process.execPath,[resolve('validation/overnight/benchmark-kernels.mjs'),'--worker',JSON.stringify(variant),name],{encoding:'utf8',maxBuffer:5*1024*1024});
   assert.equal(run.status,0,run.stderr);const row=JSON.parse(run.stdout);rows.push(row);
   console.log(JSON.stringify({case:name,variant:variant.name,medianMs:row.medianMs}));
   writeFileSync(outputPrefix+'-results.json',JSON.stringify({runtime:{node:process.version,v8:process.versions.v8,platform:process.platform,arch:process.arch,cpu:cpus()[0].model,ramBytes:totalmem(),loadAverage:loadavg()},engineSha256:hashes,method:'Each variant/case in a separate process after the legacy test runner exits; 30 second settling period, one warmup and three measured trials. Fixed alternating variant order. Includes request/response and decoding, excludes Wasm setup. Native starts a fresh CLI each trial. All outputs match canonical f64 examples. Local experiment, not a SOTA speed comparison.',rows},null,2)+'\n');
  }
 }
 assert.deepEqual(hashes,Object.fromEntries(variants.map(v=>[v.name,hash(readFileSync(v.path))])),'Frozen candidate changed during benchmarking');
 status('complete',{measurements:rows.length});
}
