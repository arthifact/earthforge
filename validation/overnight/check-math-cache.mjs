/** Exact cache equivalence against the frozen uncached Rust module; also record expanded JS conformance without hiding mismatches. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const path=process.env.EARTHFORGE_WASM_ENGINE??'../engine-candidates/cached-math-simd.wasm',binary=readFileSync(path);
const module=await WebAssembly.compile(binary);assert.deepEqual(WebAssembly.Module.imports(module),[],'Scalar math must remain inside Rust');
const wasm=(await WebAssembly.instantiate(module,{})).exports;
const baselineBinary=readFileSync('../engine-candidates/pinned-math-simd.wasm');
const baseline=(await WebAssembly.instantiate(baselineBinary,{})).instance.exports;
const view=new DataView(new ArrayBuffer(8));const bits=x=>{view.setFloat64(0,x);return view.getBigUint64(0).toString(16).padStart(16,'0')};
function run(wasm,rows){const bytes=new TextEncoder().encode(JSON.stringify({kind:'math',rows})),ptr=wasm.earthforge_alloc(bytes.length);try{new Uint8Array(wasm.memory.buffer,ptr,bytes.length).set(bytes);const n=wasm.earthforge_run(ptr,bytes.length);return JSON.parse(new TextDecoder().decode(new Uint8Array(wasm.memory.buffer,wasm.earthforge_result_ptr(),n)));}finally{wasm.earthforge_free(ptr,bytes.length);wasm.earthforge_result_free();}}
const results=[];let samples=0;const expanded=[];
for(const [name,min,max]of [['exp',-745,709],['expm1',-40,40],['tanh',-23,23],['sin',-100,100],['tan',-100,100],['cbrt',-1e29,1e29]]){
 const values=[-0,0,...Array.from({length:60000},(_,i)=>min+(max-min)*(i+0.12345)/60000)];
 for(const [order,input]of [['forward',values],['reverse',values.toReversed()],['repeat',values]]) {
  const rows=input.map(x=>({function:name,bits:bits(x)})),result=run(wasm,rows),uncached=run(baseline,rows);assert.equal(result.ok,true,result.error);assert.equal(uncached.ok,true,uncached.error);
  assert.deepEqual(result,uncached,`${name}/${order}: cache must preserve frozen uncached values exactly`);
  if(order==='forward'){
   const nativeRun=spawnSync('../engine-candidates/baseline-native',[],{input:JSON.stringify({kind:'math',rows}),encoding:'utf8',maxBuffer:16*1024*1024});assert.equal(nativeRun.status,0,nativeRun.stderr);assert.deepEqual(result,JSON.parse(nativeRun.stdout),'Wasm software FMA must match native hardware FMA on expanded inputs');
   const mismatch=input.flatMap((x,i)=>result.value[i]===bits(Math[name](x))?[]:[{input:x,inputBits:bits(x),rustBits:result.value[i],nodeBits:bits(Math[name](x))}]);expanded.push({function:name,samples:input.length,mismatches:mismatch});
  }
  samples+=input.length;results.push({function:name,order,samples:input.length,bitIdentical:true});
 }
 console.log(name+' cache and native parity exact; Node differences: '+expanded.at(-1).mismatches.length);
}
writeFileSync('validation/overnight/math-cache-validation.json',JSON.stringify({runtime:process.version,v8:process.versions.v8,wasmSha256:createHash('sha256').update(binary).digest('hex'),hostImports:WebAssembly.Module.imports(module),cacheEntriesPerFunction:16384,maxLogicalCacheBytes:6*16384*16,samples,passed:true,scope:'Cached versus frozen uncached Rust outputs and native hardware FMA must be bit-identical, including distinct signed zeros. Each pass has more than3x cache capacity. Expanded Node conformance is recorded separately, including inherited scalar-port differences; existing120054-input and physical-fixture gates remain unchanged. No observational data.',results},null,2)+'\n');

writeFileSync('validation/overnight/expanded-math-conformance.json',JSON.stringify({runtime:process.version,v8:process.versions.v8,scope:'Expanded60002-input sweep per function, separate from the existing120054-input migration gate. Known scalar-port differences are inherited by native, uncached and cached Wasm alike; not introduced by caching. Preserve this report; do not claim universal JS bitwise conformance.',nodeCompatible:expanded.every(row=>row.mismatches.length===0),rows:expanded},null,2)+'\n');
