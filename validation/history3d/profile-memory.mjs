import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import os from 'node:os';
const hash=x=>createHash('sha256').update(x).digest('hex');
const engine='target/release/earthforge',rows=[];
for(const name of ['two-fault-history','scaling-24-4']){
 const input=readFileSync('validation/history3d/requests/'+name+'.json'),trials=[];
 for(let i=-1;i<3;i++){
  const p=spawnSync('/usr/bin/time',['-l',engine],{input,encoding:'utf8',maxBuffer:128*1024*1024});assert.equal(p.status,0,p.stderr);const r=JSON.parse(p.stdout);assert.equal(r.ok,true,r.error);
  const rss=Number(p.stderr.match(/(\d+)\s+maximum resident set size/)?.[1]);assert.ok(rss>0);
  trials.push({warmup:i<0,peakRssBytes:rss,responseBytes:Buffer.byteLength(p.stdout),physicalHash:hash(JSON.stringify({slices:r.value.slices,rays:r.value.rays,projection:r.value.projection,points:r.value.points})),stats:r.value.stats});
 }
 const values=trials.filter(t=>!t.warmup).map(t=>t.peakRssBytes).sort((a,b)=>a-b);rows.push({case:name,medianPeakRssBytes:values[1],trials});
}
writeFileSync('validation/history3d/memory-results.json',JSON.stringify({cpu:os.cpus()[0].model,nativeSha256:hash(readFileSync(engine)),method:'Fresh native process pertrial;1warmup3measurements. macOS /usr/bin/time-l peakRSSinbytes includes CLI, material evaluation, projectedsections, JSONserialization; parentNodeexcluded. No concurrent builds or simulations. NoenergyorSOTAclaim.',rows},null,2)+'\n');console.log(JSON.stringify(rows.map(({case:fixture,medianPeakRssBytes})=>({fixture,medianPeakRssBytes}))));
