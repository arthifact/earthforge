import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import os from 'node:os';
import {wasmEngine} from './engine.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const physical=v=>hash(JSON.stringify({slices:v.slices,projection:v.projection,rays:v.rays,points:v.points}));
if(process.argv[2]==='--worker'){
 const [variant,name]=[JSON.parse(process.argv[3]),process.argv[4]];
 const request=JSON.parse(readFileSync('validation/history3d/requests/'+name+'.json'));
 const engine=variant.type==='wasm'?await wasmEngine(variant.path):null,trials=[];
 for(let i=-1;i<3;i++){
  const start=performance.now();let v;
  if(engine)v=engine.run(request);else{const p=spawnSync(variant.path,[],{input:JSON.stringify(request),encoding:'utf8',maxBuffer:128*1024*1024});if(p.status!==0)throw Error(p.stderr);const r=JSON.parse(p.stdout);if(!r.ok)throw Error(r.error);v=r.value;}
  const elapsedMs=performance.now()-start;trials.push({warmup:i<0,elapsedMs,physicalHash:physical(v),wasmMemoryBytes:engine?.memory(),stats:v.stats});
 }
 if(new Set(trials.map(t=>t.physicalHash)).size!==1)throw Error('Nonrepeatable physical output');
 process.stdout.write(JSON.stringify({case:name,variant:variant.name,setupMs:engine?.setupMs,medianMs:trials.filter(t=>!t.warmup).map(t=>t.elapsedMs).sort((a,b)=>a-b)[1],trials}));
}else{
 const tag=process.env.EARTHFORGE_HISTORY_BENCH_TAG??'reference';
 const folder=resolve('../history3d-engines');
 const variants=[{name:tag+'-native',type:'native',path:folder+'/'+tag+'-native'},{name:tag+'-research-simd',type:'wasm',path:folder+'/'+tag+'-research-simd.wasm'},{name:tag+'-preview-simd',type:'wasm',path:folder+'/'+tag+'-preview-simd.wasm'}];
 const hashes=Object.fromEntries(variants.map(v=>[v.name,hash(readFileSync(v.path))]));const rows=[];
 let index=0;
 for(const name of ['flat-history','oblique-fault-history','burial-erosion-reburial','two-fault-history']){
  for(const variant of index++%2?[...variants].reverse():variants){
   const p=spawnSync(process.execPath,[resolve('validation/history3d/benchmark-profiles.mjs'),'--worker',JSON.stringify(variant),name],{encoding:'utf8',maxBuffer:5*1024*1024});if(p.status!==0)throw Error(p.stderr);const row=JSON.parse(p.stdout);rows.push(row);console.log(JSON.stringify({case:name,variant:row.variant,medianMs:row.medianMs}));
   writeFileSync('validation/history3d/'+tag+'-profiles-benchmark.json',JSON.stringify({createdAt:new Date().toISOString(),cpu:os.cpus()[0].model,runtime:process.version,engineSha256:hashes,method:'Each engine/case in its own process, one warmup and3trials. Fixed alternating engine order. Includes request/result and JSON decoding; Wasm setup excluded and reported separately. Native CLI startup included. No concurrent builds, simulations or test jobs. Own-engine performance only.',rows},null,2)+'\n');
  }
  const matches=rows.filter(r=>r.case===name);if(new Set(matches.map(r=>r.trials[0].physicalHash)).size!==1)throw Error('Native/Wasm physical drift: '+name);
 }
 if(JSON.stringify(hashes)!==JSON.stringify(Object.fromEntries(variants.map(v=>[v.name,hash(readFileSync(v.path))]))))throw Error('Frozen engines changed');
}
