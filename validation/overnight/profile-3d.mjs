/** Native process peak RSS for material, projection and wave stages, on macOS. */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {cpus,totalmem} from 'node:os';
assert.equal(process.platform,'darwin','This runner parses macOS /usr/bin/time -l; RSS units are bytes');
const engine=process.env.EARTHFORGE_NATIVE_ENGINE??'target/release/earthforge',hash=x=>createHash('sha256').update(x).digest('hex');
const initialEngineHash=hash(readFileSync(engine));
const base=JSON.parse(readFileSync('validation/overnight/volume3d-request.json'));base.includeGeometry=false;base.sectionsY=[];
const pair=JSON.parse(readFileSync('data/seismic/overnight-v1/faulted-3d.json'));
const projection={...base,projection:{grid:pair.grid}};
const wave={kind:'acoustic',grid:pair.grid,velocity:pair.velocity,source:pair.shot.source,receivers:pair.shot.receivers,frequencyHz:pair.shot.frequencyHz,sourceDelaySeconds:pair.shot.sourceDelaySeconds,durationSeconds:0.9,spongeCells:pair.shot.spongeCells,includeFinalField:true};
const rows=[];
for(const [stage,request]of[['material',base],['materialAndProjection',projection],['acoustic',wave]]) {
 const input=JSON.stringify(request),trials=[];
 for(let i=-1;i<3;i++) {
  const start=performance.now(),run=spawnSync('/usr/bin/time',['-l',engine],{input,encoding:'utf8',maxBuffer:256*1024*1024}),elapsedMs=performance.now()-start;
  assert.equal(run.status,0,run.stderr);const response=JSON.parse(run.stdout);assert.equal(response.ok,true,response.error);
  const rss=run.stderr.match(/(\d+)\s+maximum resident set size/);assert.ok(rss,run.stderr);
  const footprint=run.stderr.match(/(\d+)\s+peak memory footprint/);
  trials.push({iteration:i,warmup:i<0,wallMs:elapsedMs,peakRssBytes:Number(rss[1]),peakMemoryFootprintBytes:footprint?Number(footprint[1]):null,responseBytes:Buffer.byteLength(run.stdout),responseSha256:hash(run.stdout)});
 }
 assert.equal(new Set(trials.map(t=>t.responseSha256)).size,1);
 const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
 const measured=trials.filter(t=>!t.warmup);
 const row={stage,inputBytes:Buffer.byteLength(input),inputSha256:hash(input),medianPeakRssBytes:median(measured.map(t=>t.peakRssBytes)),medianWallMs:median(measured.map(t=>t.wallMs)),trials};rows.push(row);console.log(JSON.stringify(row));
}
assert.equal(hash(readFileSync(engine)),initialEngineHash,'Native engine changed during profiling');
const report={runtime:{node:process.version,platform:process.platform,arch:process.arch,cpu:cpus()[0].model,ramBytes:totalmem()},nativeSha256:hash(readFileSync(engine)),method:'Fresh native process per trial, one warmup then three measurements, macOS /usr/bin/time -l maximum RSS in bytes. Includes CLI, parsing, material/input state, output creation and serialization; does not include the parent Node process. Peak RSS is the measurement target. Wall times are diagnostic, may overlap compilation and are not a controlled timing study or a comparison against another research system.',logicalAcousticArrayBytes:pair.shot.stats.workingArrayBytes,physicalModel:{worldM:[10000,10000,6200],faults:2,fragments:40,derivedCropGrid:pair.grid},rows};
writeFileSync(process.env.EARTHFORGE_PROFILE_3D_OUT??'validation/overnight/profile-3d-results.json',JSON.stringify(report,null,2)+'\n');
