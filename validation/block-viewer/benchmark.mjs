/** Fixed whole-volume queries, measured serially; display size never changes material physics. */
import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import os from 'node:os';
import {wasmEngine} from '../history3d/engine.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const native='target/release/earthforge',wasm='public/rust/earthforge_core_deterministic_simd.wasm';
const definitions=[['quick',33,161,12,2],['standard',49,241,12,2],['fine',65,481,12,2],['long-history-quick',33,161,24,4]];
if(process.argv[2]==='--child'){
 const [name,n,nz,steps,faults]=definitions[Number(process.argv[3])],kind=process.argv[4];
 const request={kind:'history3d',includeModel:true,options:{seed:908054,steps,faults,geology:'detailed',setting:'extension',compaction:true,exhumation:false,overpressure:false,materialStep:10},query:{sectionsY:[],includeMaterial:true,grid:{nx:n,ny:n,nz,dx:10000/(n-1),dy:10000/(n-1),dz:3000/(nz-1),origin:{x:0,y:0,z:0}}}};
 const engine=kind==='wasm'?await wasmEngine(wasm):null,trials=[];
 for(let i=-1;i<3;i++){
  const start=performance.now();let value;
  if(engine)value=engine.run(request);else{const p=spawnSync(native,[],{input:JSON.stringify(request),maxBuffer:512*1024*1024});if(p.status!==0)throw Error(p.stderr.toString());const r=JSON.parse(p.stdout);if(!r.ok)throw Error(r.error);value=r.value;}
  const elapsedMs=performance.now()-start;
  trials.push({warmup:i<0,elapsedMs,physicalSha256:sha(JSON.stringify(value.projection)),stats:value.stats,wasmLinearMemoryBytes:engine?.memory()??null});
 }
 if(new Set(trials.map(t=>t.physicalSha256)).size!==1)throw Error('Nonrepeatable output');
 const measured=trials.slice(1).map(t=>t.elapsedMs).sort((a,b)=>a-b);
 console.log(JSON.stringify({name,kind,nx:n,ny:n,nz,steps,faults,samples:n*n*nz,request,medianMs:measured[1],setupMs:engine?.setupMs??null,trials}));
}else{
 const rows=[];
 for(let i=0;i<definitions.length;i++)for(const kind of ['native','wasm']){
  const p=spawnSync(process.execPath,[import.meta.filename,'--child',String(i),kind],{encoding:'utf8',maxBuffer:8*1024*1024});if(p.status!==0)throw Error(p.stderr);const row=JSON.parse(p.stdout);rows.push(row);writeFileSync('validation/block-viewer/benchmark-progress.json',JSON.stringify(rows,null,2)+'\n');console.log(JSON.stringify({name:row.name,kind,medianMs:row.medianMs}));
 }
 for(let i=0;i<rows.length;i+=2)if(rows[i].trials[0].physicalSha256!==rows[i+1].trials[0].physicalSha256)throw Error('Native/Wasm field mismatch');
 writeFileSync('validation/block-viewer/benchmark-results.json',JSON.stringify({createdAt:new Date().toISOString(),cpu:os.cpus()[0].model,runtime:process.version,hashes:{native:sha(readFileSync(native)),wasm:sha(readFileSync(wasm))},method:'Serial isolated case/engine child processes, one warmup and three measured complete query trials. Native trials use fresh CLI processes; Wasm trials reuse the compiled module within the case. Timings include result decoding, exclude hash computation. Wasm setup reported separately. Full sampled volume, fixed 10 m material subdivision. Linear memory is not process RSS. No energy measurement or real-time physical evolution claim.',rows},null,2)+'\n');
}
