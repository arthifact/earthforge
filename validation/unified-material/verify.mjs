/** Exact regression against the frozen pre-unification engine; no observations. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {wasmEngine} from '../history3d/engine.mjs';
const beforePath=process.env.EARTHFORGE_BEFORE_ENGINE??'../unified-physics-engines/before-native';
const afterPath=process.env.EARTHFORGE_NATIVE_ENGINE??'target/release/earthforge';
const sha=x=>createHash('sha256').update(x).digest('hex');
function run(path,request){const p=spawnSync(path,[],{input:JSON.stringify(request),encoding:'utf8',maxBuffer:768*1024*1024});assert.equal(p.status,0,p.stderr);const r=JSON.parse(p.stdout);assert.equal(r.ok,true,r.error);return r.value;}
function physical(v){if(v.checks)delete v.checks.seconds;if(v.section?.checks)delete v.section.checks.seconds;return v;}
const planBytes=readFileSync('validation/numerics/plan.json'),plan=JSON.parse(planBytes),cases=[];
for(const {name,...options} of plan.cases){
 for(const h of plan.grids_m){
  const request={kind:'basin',options:{...options,h,record:false}};
  const before=physical(run(beforePath,request)),after=physical(run(afterPath,request));
  assert.deepEqual(after,before,name+' '+h+'m whole 2D response');
  assert.equal(after.budget.summary.closed,true);
  cases.push({name,h,wholeResponseExactExceptDiagnosticSeconds:true,eventBudgets:after.budget.summary.events,physicalSha256:sha(JSON.stringify(after))});
  console.log(name+' '+h+'m exact');
 }
}
const replay=[];
for(const options of [{seed:765184,setting:'extension',overpressure:1},{seed:20261014,setting:'compression'},{seed:578933,setting:'extension',exhumation:1,overpressure:1}]){
 const request={kind:'section',detail:true,options:{...options,h:20,record:true}};
 const before=physical(run(beforePath,request)),after=physical(run(afterPath,request));
 assert.deepEqual(after,before,'recorded 2D history '+JSON.stringify(options));
 replay.push({options,allReplayAndCarriedMaterialExact:true,physicalSha256:sha(JSON.stringify(after))});
 console.log('recorded 2D history '+options.seed+' exact');
}
const wasm=[];
for(const name of ['earthforge_core.wasm','earthforge_core_simd.wasm','earthforge_core_deterministic.wasm','earthforge_core_deterministic_simd.wasm']){
 const path='public/rust/'+name,engine=await wasmEngine(path),rows=[];
 for(const options of [{seed:765184,setting:'extension',overpressure:1},{seed:20261014,setting:'compression',exhumation:1,carbonate:.3}]){
  const request={kind:'basin',options:{...options,h:40,record:false}},reference=physical(run(beforePath,request)),value=physical(engine.run(request));
  assert.deepEqual(value,reference,name+' whole 2D response');rows.push({options,wholeResponseExactExceptDiagnosticSeconds:true});
 }
 wasm.push({path,sha256:sha(readFileSync(path)),cases:rows});console.log(name+' 2D cases exact');
}
const report={createdAt:new Date().toISOString(),planSha256:sha(planBytes),beforeNativeSha256:sha(readFileSync(beforePath)),afterNativeSha256:sha(readFileSync(afterPath)),canonical2dRuns:cases,recorded2dHistories:replay,wasm,scope:'All physical f64 values, exact lengths, material memories, geometry, velocities and event budgets compared exactly to the pre-unification checkpoint. Only nondeterministic diagnostic checks.seconds excluded. Tests reuse neither new deposition nor new compaction to construct the baseline. No observational data or tolerance changes.'};
writeFileSync(process.env.EARTHFORGE_UNIFICATION_OUTPUT??'validation/unified-material/verification-results.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({canonical2dRuns:cases.length,recorded2dHistories:replay.length,wasmCases:wasm.reduce((n,r)=>n+r.cases.length,0),allExact:true}));
