/** Check whether acoustic SIMD gains also hold for full exact-arithmetic histories. */
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {cpus,loadavg} from 'node:os';
const folder=process.env.EARTHFORGE_CANDIDATES??resolve('../engine-candidates');
const variants=(process.env.EARTHFORGE_SELECTION_VARIANTS??'row-scalar,row-simd').split(',');
const paths=Object.fromEntries(variants.map(v=>[v,folder+'/'+v+'.wasm']));
const hashes=Object.fromEntries(variants.map(v=>[v,createHash('sha256').update(readFileSync(paths[v])).digest('hex')]));
const rows=[];
for (const options of [{seed:765184,setting:'extension',h:40,record:false},{seed:20261014,setting:'compression',h:40,record:false}]) {
 for(const variant of (rows.length?variants.toReversed():variants)) {
  const run=spawnSync(process.execPath,['validation/overnight/benchmark.mjs','--worker','wasm',JSON.stringify(options)],{env:{...process.env,EARTHFORGE_WASM_ENGINE:paths[variant],EARTHFORGE_BENCH_TRIALS:'3'},encoding:'utf8',maxBuffer:5*1024*1024});
  assert.equal(run.status,0,run.stderr);const result=JSON.parse(run.stdout);rows.push({variant,...result});
  console.log(JSON.stringify({variant,options,medianMs:result.medianMs}));
  writeFileSync(process.env.EARTHFORGE_SELECTION_OUT??'validation/overnight/wasm-selection-benchmark-results.json',JSON.stringify({runtime:{node:process.version,v8:process.versions.v8,cpu:cpus()[0].model,loadAverage:loadavg()},method:'Separate fresh process per module/fixture, one warmup and three trials; no competing simulation or compilation. Request/response included; module setup excluded. Fixed alternating module order. Geological generation only, not acoustic propagation.',engineSha256:hashes,rows},null,2)+'\n');
 }
 const matches=rows.filter(x=>x.options.setting===options.setting).flatMap(x=>x.rows.map(t=>t.stateHash));assert.equal(new Set(matches).size,1);
}
assert.deepEqual(hashes,Object.fromEntries(variants.map(v=>[v,createHash('sha256').update(readFileSync(paths[v])).digest('hex')])));
