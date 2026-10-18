/** Fresh native processes; exact frozen requests, decoded-output hashes, no retained states. */
import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import os from 'node:os';
const engine=process.env.EARTHFORGE_HISTORY_ENGINE??'target/release/earthforge';
const out=process.env.EARTHFORGE_HISTORY_BENCH_OUT??'validation/history3d/baseline-benchmark.json';
const hash=x=>createHash('sha256').update(x).digest('hex');
const rows=[];
for(const name of ['flat-history','oblique-fault-history','burial-erosion-reburial','two-fault-history']){
 const request=readFileSync('validation/history3d/requests/'+name+'.json'),trials=[];
 for(let i=-1;i<3;i++){
  const start=performance.now(),p=spawnSync(engine,[],{input:request,maxBuffer:128*1024*1024});if(p.error)throw p.error;if(p.status!==0)throw Error(p.stderr.toString());
  const response=JSON.parse(p.stdout);if(!response.ok)throw Error(response.error);const elapsedMs=performance.now()-start,v=response.value;
  const physicalHash=hash(JSON.stringify({slices:v.slices,projection:v.projection,rays:v.rays,points:v.points}));
  trials.push({warmup:i<0,elapsedMs,physicalHash,responseBytes:p.stdout.length,stats:v.stats});
 }
 if(new Set(trials.map(t=>t.physicalHash)).size!==1)throw Error('Nonrepeatable output: '+name);
 const measured=trials.filter(t=>!t.warmup).map(t=>t.elapsedMs).sort((a,b)=>a-b);
 rows.push({case:name,requestSha256:hash(request),medianMs:measured[1],trials});
 console.log(JSON.stringify({case:name,medianMs:measured[1]}));
}
writeFileSync(out,JSON.stringify({createdAt:new Date().toISOString(),engine,engineSha256:hash(readFileSync(engine)),cpu:os.cpus()[0].model,runtime:process.version,method:'One warmup and three measured fresh native processes per frozen case; includes process startup, request/response and decoding. Cases do not retain previous physical states. Own-version comparisons only; no SOTA claim.',rows},null,2)+'\n');
