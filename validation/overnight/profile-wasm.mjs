import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const path=process.argv[2]??'target/wasm32-unknown-unknown/release/earthforge_core.wasm';
const count=Number(process.argv[3]??3),h=Number(process.argv[4]??40),output=process.argv[5]??'validation/overnight/profile-new-results.json';
const binary=readFileSync(path),module=await WebAssembly.compile(binary);
const wasm=(await WebAssembly.instantiate(module,{math:{exp:Math.exp,expm1:Math.expm1,tanh:Math.tanh,sin:Math.sin,tan:Math.tan,cbrt:Math.cbrt}})).exports;
const bytes=new TextEncoder().encode(JSON.stringify({kind:'section',options:{seed:20261014,setting:'compression',h,record:false}}));
const rows=[];
for(let i=0;i<count;i++){
 const start=performance.now(),ptr=wasm.earthforge_alloc(bytes.length);new Uint8Array(wasm.memory.buffer,ptr,bytes.length).set(bytes);
 const length=wasm.earthforge_run(ptr,bytes.length),ran=performance.now();
 const result=JSON.parse(new TextDecoder().decode(new Uint8Array(wasm.memory.buffer,wasm.earthforge_result_ptr(),length)));
 const ended=performance.now();wasm.earthforge_free(ptr,bytes.length);wasm.earthforge_result_free();
 assert.equal(result.ok,true);assert.equal(result.value.budget.closed,true);
 const state_hash=createHash('sha256').update(JSON.stringify({now:result.value.now,budget:result.value.budget})).digest('hex');
 rows.push({iteration:i,engine_ms:ran-start,decode_ms:ended-ran,response_bytes:length,memory_bytes:wasm.memory.buffer.byteLength,state_hash});
 console.log(JSON.stringify(rows.at(-1)));
}
writeFileSync(output,JSON.stringify({runtime:process.version,wasm_sha256:createHash('sha256').update(binary).digest('hex'),options:{seed:20261014,setting:'compression',h,record:false},rows},null,2)+'\n');
