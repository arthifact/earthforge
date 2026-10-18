/** Fixed additional complexity cases, declared before measurements. */
import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import os from 'node:os';
const hash=x=>createHash('sha256').update(x).digest('hex');
const folder=resolve('../history3d-engines');
const variants=[{name:'culled-native',type:'native',path:folder+'/culled-native'},{name:'culled-research-simd',type:'wasm',path:folder+'/culled-research-simd.wasm'}];
const configs=[[6,1],[12,2],[18,3],[24,4]];
for(const [steps,faults]of configs)writeFileSync(`validation/history3d/requests/scaling-${steps}-${faults}.json`,JSON.stringify({kind:'history3d',options:{seed:20261014,steps,faults,compaction:true,materialStep:10},query:{nx:61,nz:81,sectionsY:[1000,5000,9000]}},null,2)+'\n');
const rows=[];
for(const [steps,faults]of configs){
 const name=`scaling-${steps}-${faults}`;
 for(const variant of variants){const p=spawnSync(process.execPath,[resolve('validation/history3d/benchmark-profiles.mjs'),'--worker',JSON.stringify(variant),name],{encoding:'utf8',maxBuffer:5*1024*1024});if(p.status!==0)throw Error(p.stderr);const row=JSON.parse(p.stdout);rows.push({...row,steps,faults});console.log(JSON.stringify({case:name,variant:row.variant,medianMs:row.medianMs}));}
 const pair=rows.slice(-2);if(pair[0].trials[0].physicalHash!==pair[1].trials[0].physicalHash)throw Error('Scaling case physical drift');
 writeFileSync('validation/history3d/scaling-benchmark.json',JSON.stringify({cpu:os.cpus()[0].model,runtime:process.version,engineSha256:Object.fromEntries(variants.map(v=>[v.name,hash(readFileSync(v.path))])),method:'Separateprocesses;1warmup3trials percomplexity/engine. Three61x81sections, materialStep10m, same10x10x6.2kmregion. Includes request/responseanddecoding; Wasmsetupseparate. NoGPU. Notfullvoxel-exportorseismicsurveytiming.',rows},null,2)+'\n');
}
