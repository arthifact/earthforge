/** Compare a native wave-kernel candidate with the saved canonical f64 shots. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const engine=process.env.EARTHFORGE_NATIVE_ENGINE??'target/release/earthforge',rows=[];
for(const name of ['basin-extension-765184','basin-compression-20261014','layered-3d','faulted-3d']) {
 const pair=JSON.parse(readFileSync(`data/seismic/overnight-v1/${name}.json`)),shot=pair.shot;
 const request={kind:'acoustic',grid:pair.grid,velocity:pair.velocity,source:shot.source,receivers:shot.receivers,frequencyHz:shot.frequencyHz,dtSeconds:shot.dtSeconds,sourceDelaySeconds:shot.sourceDelaySeconds,durationSeconds:(shot.samplesPerReceiver-.5)*shot.dtSeconds,spongeCells:shot.spongeCells,includeFinalField:true};
 const run=spawnSync(engine,[],{input:JSON.stringify(request),encoding:'utf8',maxBuffer:128*1024*1024});assert.equal(run.status,0,run.stderr);const result=JSON.parse(run.stdout);assert.equal(result.ok,true,result.error);assert.deepEqual(result.value,shot);
 rows.push({name,dimensions:shot.dimensions,samples:shot.samplesPerReceiver*shot.receivers.length,bitIdentical:true});console.log(JSON.stringify(rows.at(-1)));
}
writeFileSync(process.env.EARTHFORGE_VARIANT_OUT??'validation/overnight/native-kernel-candidate-validation.json',JSON.stringify({nativeSha256:createHash('sha256').update(readFileSync(engine)).digest('hex'),scope:'Strict equality of native receiver traces, final fields and diagnostics with four saved canonical acoustic examples. No performance claim.',rows},null,2)+'\n');
