import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
const bundled = await build({ stdin: { contents: 'export * from "./src/basin.ts";', resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', write: false });
const reference = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`);
const nativePath=process.env.EARTHFORGE_NATIVE_ENGINE??'target/release/earthforge';
const wasmPath=process.env.EARTHFORGE_WASM_ENGINE??'target/wasm32-unknown-unknown/release/earthforge_core.wasm';
const wasm = (await WebAssembly.instantiate(readFileSync(wasmPath), {math:{exp:Math.exp,expm1:Math.expm1,tanh:Math.tanh,sin:Math.sin,tan:Math.tan,cbrt:Math.cbrt}})).instance.exports;
function wasmRequest(value) {
 const bytes = new TextEncoder().encode(JSON.stringify(value)), ptr = wasm.earthforge_alloc(bytes.length);
 new Uint8Array(wasm.memory.buffer, ptr, bytes.length).set(bytes);
 let result;
 try { const length = wasm.earthforge_run(ptr, bytes.length); result = JSON.parse(new TextDecoder().decode(new Uint8Array(wasm.memory.buffer, wasm.earthforge_result_ptr(), length))); }
 finally { wasm.earthforge_free(ptr, bytes.length); wasm.earthforge_result_free(); }
 if (!result.ok) throw Error(result.error); return result.value;
}
function native(value) {
 const r=spawnSync(nativePath, [], {input:JSON.stringify(value), encoding:'utf8', maxBuffer:150*1024*1024});
 if(r.status!==0)throw Error(r.stderr || `Native exit ${r.status}`);
 const result=JSON.parse(r.stdout); if(!result.ok)throw Error(result.error);return result.value;
}
function difference(a,b){ if(a.length!==b.length)throw Error('Different array sizes');let max=0,squared=0,changed=0;for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);max=Math.max(max,d);squared+=d*d;changed+=Number(d!==0);}return {max,rms:Math.sqrt(squared/a.length),changed,count:a.length}; }
const physicsRows=[];
for(const f of [0,0.1,0.5,1])for(const depth of [0,1,100,1000,2000,4000])for(const carbonate of [false,true])for(const pressure of [null,1500])for(const history of [null,{maxBurial:4500,maxEffectiveDepth:2200},{maxBurial:1000,maxEffectiveDepth:600,bulkPorosity:0.2}])physicsRows.push({fraction:f,depth,carbonate,pressure,history});
const nativePhysics=native({kind:'physics',rows:physicsRows}), wasmPhysics=wasmRequest({kind:'physics',rows:physicsRows});
const expected=physicsRows.map(r=>reference.rockVelocity(r.fraction,r.depth,r.carbonate,r.pressure,r.history??undefined));
console.log(JSON.stringify({physicsNative:difference(expected,nativePhysics.map(r=>r.velocity)),physicsWasm:difference(expected,wasmPhysics.map(r=>r.velocity))}));
const results=[];
for(const fixture of [{seed:765184,setting:'extension'},{seed:20261014,setting:'compression'},{seed:765184,setting:'extension',exhumation:1}].filter(f=>!process.env.EARTHFORGE_COMPARE_ONLY||f.setting===process.env.EARTHFORGE_COMPARE_ONLY)){
 const options={...reference.BASIN_DEFAULTS,...fixture,h:Number(process.env.EARTHFORGE_COMPARE_H??100),record:false};
 let start=performance.now();const trace=[];const ts=reference.simulate(options,process.env.EARTHFORGE_SAVE_FIXTURE ? s=>trace.push({step:s.step,process:s.process,surfaces:s.columns.map(c=>{let z=0;for(const p of c){if(p.bed!==-1)break;z+=p.height;}return z;})}):undefined);const tsMs=performance.now()-start;const window=reference.windowOf(ts);
 start=performance.now();const rust=native({kind:'section',options,detail:true});const nativeMs=performance.now()-start;
 start=performance.now();const web=wasmRequest({kind:'section',options});const wasmMs=performance.now()-start;
 const row={fixture,spacing:options.h,tsMs,nativeMs,nativeKernelMs:rust.section.checks.seconds*1000,wasmMs,velocityNative:difference(window.velocity,rust.section.now.velocity),velocityWasm:difference(window.velocity,web.now.velocity),nativeVsWasm:difference(rust.section.now.velocity,web.now.velocity),labelsNative:difference(window.beds,rust.section.now.beds),labelsWasm:difference(window.beds,web.now.beds),initialWater:[ts.historyPlan.waterDepth,rust.historyPlan.waterDepth],phases:[ts.historyPlan.phases,rust.historyPlan.phases],beds:[ts.beds.length,rust.beds.length],faults:[ts.faults.length,rust.faults.length],budgetClosed:rust.section.budget.closed,grainDifference:rust.section.budget.final.total-ts.budget.summary.final.total};
 results.push(row);console.log(JSON.stringify(row));
 if(process.env.EARTHFORGE_SAVE_FIXTURE){writeFileSync('validation/rust/last-reference.json',JSON.stringify({columns:ts.columns,beds:ts.beds,history:ts.historyPlan,entries:ts.budget.entries,trace,faults:ts.faults,window}));writeFileSync('validation/rust/last-rust.json',JSON.stringify(rust));}
}
const hashes=Object.fromEntries([nativePath,wasmPath].map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')]));
const report={runtime:process.version,hashes,physicsNative:difference(expected,nativePhysics.map(r=>r.velocity)),physicsWasm:difference(expected,wasmPhysics.map(r=>r.velocity)),results};
writeFileSync(process.env.EARTHFORGE_COMPARE_OUT??`validation/rust/parity-${Number(process.env.EARTHFORGE_COMPARE_H??100)}m.json`,JSON.stringify(report,null,2)+'\n');
for(const r of results){assert.equal(r.budgetClosed,true);assert.equal(r.velocityNative.max,0,'Native velocity must match reference');assert.equal(r.labelsNative.max,0,'Native labels must match reference');assert.equal(r.grainDifference,0,'Native grain inventory must match reference');assert.equal(r.velocityWasm.max,0,'Wasm velocity must match the reference fixture');assert.equal(r.labelsWasm.max,0,'Wasm labels must match the reference fixture');}
