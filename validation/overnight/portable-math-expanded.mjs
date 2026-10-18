/** Expanded exact Node/native/portable/SIMD math checks after sine-contraction correction. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const paths=['public/rust/earthforge_core_deterministic.wasm','public/rust/earthforge_core_deterministic_simd.wasm'];
const engines=await Promise.all(paths.map(async path=>{const bytes=readFileSync(path),module=await WebAssembly.compile(bytes);assert.deepEqual(WebAssembly.Module.imports(module),[]);return{path,sha256:createHash('sha256').update(bytes).digest('hex'),wasm:(await WebAssembly.instantiate(module,{})).exports};}));
const view=new DataView(new ArrayBuffer(8));const bits=x=>{view.setFloat64(0,x);return view.getBigUint64(0).toString(16).padStart(16,'0')};
function run(wasm,rows){const bytes=new TextEncoder().encode(JSON.stringify({kind:'math',rows})),ptr=wasm.earthforge_alloc(bytes.length);try{new Uint8Array(wasm.memory.buffer,ptr,bytes.length).set(bytes);const n=wasm.earthforge_run(ptr,bytes.length);const result=JSON.parse(new TextDecoder().decode(new Uint8Array(wasm.memory.buffer,wasm.earthforge_result_ptr(),n)));assert.equal(result.ok,true,result.error);return result.value;}finally{wasm.earthforge_free(ptr,bytes.length);wasm.earthforge_result_free();}}
let inputs=0,comparisons=0;const results=[];
for(const [name,min,max]of [['exp',-745,709],['expm1',-40,40],['tanh',-23,23],['sin',-100,100],['tan',-100,100],['cbrt',-1e29,1e29]]){
 const values=[-0,0,...Array.from({length:60000},(_,i)=>min+(max-min)*(i+0.12345)/60000)];
 for(const [order,arguments_]of [['forward',values],['reverse',values.toReversed()],['repeat',values]]){
  const rows=arguments_.map(x=>({function:name,bits:bits(x)})),expected=arguments_.map(x=>bits(Math[name](x)));
  if(order==='forward'){const native=spawnSync('target/release/earthforge',[],{input:JSON.stringify({kind:'math',rows}),encoding:'utf8',maxBuffer:16*1024*1024});assert.equal(native.status,0,native.stderr);assert.deepEqual(JSON.parse(native.stdout),{ok:true,value:expected});comparisons+=rows.length;}
  for(const engine of engines){assert.deepEqual(run(engine.wasm,rows),expected,`${name}/${order}/${engine.path}`);comparisons+=rows.length;}
  inputs+=rows.length;results.push({function:name,order,inputs:rows.length,bitIdentical:true});
 }
 console.log(name+': native/portable/SIMD all exact, forward/reverse/repeat');
}
writeFileSync('validation/overnight/portable-math-expanded-validation.json',JSON.stringify({runtime:process.version,v8:process.versions.v8,inputs,comparisons,passed:true,engines:engines.map(({path,sha256})=>({path,sha256})),sourceSha256:Object.fromEntries(['native_math.rs','math.rs'].map(name=>[name,createHash('sha256').update(readFileSync('crates/earthforge-core/src/'+name)).digest('hex')])),scope:'Expanded60002 inputs per function, three request orders, distinct signed zeros. Native hardware FMA and both Wasm forms must match Node24 Math exactly on every sampled input. No tolerance relaxation and no observational data. This establishes sampled compatibility, not a universal claim over all binary64 arguments.',results},null,2)+'\n');
