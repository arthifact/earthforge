// Primary reference: Node 24.18 / V8 13.6 scalar math. This is numerical
// compatibility evidence, not independent validation of geological laws.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const view=new DataView(new ArrayBuffer(8));
const bits=x=>{view.setFloat64(0,x);return view.getBigUint64(0).toString(16).padStart(16,'0')};
const number=x=>{view.setBigUint64(0,BigInt('0x'+x));return view.getFloat64(0)};
let seed=761234;const random=()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/2**32;};
const binary=readFileSync(process.env.EARTHFORGE_WASM_ENGINE??'target/wasm32-unknown-unknown/release/earthforge_core.wasm');
const wasm=(await WebAssembly.instantiate(binary,{math:{exp:Math.exp,expm1:Math.expm1,tanh:Math.tanh,sin:Math.sin,tan:Math.tan,cbrt:Math.cbrt}})).instance.exports;
function wasmRun(rows){const bytes=new TextEncoder().encode(JSON.stringify({kind:'math',rows})),ptr=wasm.earthforge_alloc(bytes.length);try{new Uint8Array(wasm.memory.buffer,ptr,bytes.length).set(bytes);const n=wasm.earthforge_run(ptr,bytes.length);return JSON.parse(new TextDecoder().decode(new Uint8Array(wasm.memory.buffer,wasm.earthforge_result_ptr(),n)));}finally{wasm.earthforge_free(ptr,bytes.length);wasm.earthforge_result_free();}}
const results=[];
for(const [fn,min,max]of[['exp',-745,709],['expm1',-40,40],['tanh',-23,23],['sin',-100,100],['tan',-100,100],['cbrt',-1e29,1e29]]){
 const args=[-0,0,Number.MIN_VALUE,-Number.MIN_VALUE,2**-1022,-(2**-1022),Infinity,-Infinity,NaN,...Array.from({length:20000},()=>min+(max-min)*random())];
 const rows=args.map(x=>({function:fn,bits:bits(x)}));
 const p=spawnSync('target/release/earthforge',[],{input:JSON.stringify({kind:'math',rows}),encoding:'utf8',maxBuffer:10*1024*1024});assert.equal(p.status,0);const native=JSON.parse(p.stdout),web=wasmRun(rows);assert.equal(native.ok,true);assert.equal(web.ok,true);
 const bad=(output)=>args.flatMap((x,i)=>{const expected=Math[fn](x),actual=number(output.value[i]);return Number.isNaN(expected)?(Number.isNaN(actual)?[]:[i]):Object.is(expected,actual)?[]:[i];});
 const row={function:fn,range:[min,max],samples:args.length,native_mismatches:bad(native),wasm_mismatches:bad(web)};results.push(row);console.log(JSON.stringify(row));
}
const report={runtime:process.version,v8:process.versions.v8,domain:'Random finite inputs in stated ranges plus signed zero, smallest subnormal, smallest normal, infinities and NaN. Trig range covers the basin generator; larger arguments use pinned libm and are outside this compatibility claim.',native_sha256:createHash('sha256').update(readFileSync('target/release/earthforge')).digest('hex'),wasm_sha256:createHash('sha256').update(binary).digest('hex'),results};
writeFileSync(process.env.EARTHFORGE_MATH_OUT??'validation/overnight/math-compatibility-results.json',JSON.stringify(report,null,2)+'\n');
assert.ok(results.every(r=>r.native_mismatches.length===0&&r.wasm_mismatches.length===0));
