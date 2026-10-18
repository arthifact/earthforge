import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const moduleOf = async contents => {
 const result=await build({stdin:{contents,resolveDir:root},bundle:true,platform:'node',format:'esm',write:false});
 return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`);
};
test('Rust worker transfers final and replay composition and propagates engine errors', async () => {
 const replies=[], previousFetch=globalThis.fetch;
 const wasm=await readFile(root+'/public/rust/earthforge_core_simd.wasm');
 globalThis.fetch=async url=>{assert.match(String(url),/rust\/earthforge_core_simd\.wasm$/);return new Response(wasm,{headers:{'content-type':'application/wasm'}})};
 globalThis.self={postMessage:(reply,transfer)=>replies.push(structuredClone(reply,{transfer}))};
 try {
  await moduleOf('import "./src/worker.ts";');
  const {BASIN_DEFAULTS}=await moduleOf('export {BASIN_DEFAULTS} from "./src/basin.ts";');
  const {simulateRust}=await moduleOf('export {simulateRust} from "./src/rustEngine.ts";');
  const options={...BASIN_DEFAULTS,seed:20261014,setting:'compression',h:100,overpressure:1};
  await self.onmessage({data:{id:1,kind:'section',options,history:true}});
  assert.deepEqual(replies.map(r=>r.kind),['preview','history']);
  const section=replies[0].section, frames=replies[1].frames;
  const expected=await simulateRust(options,true);
  assert.equal(section.engine,'rust-v1');
  assert.ok(frames.length>3);
  assert.equal(section.budget.closed,true);
  assert.deepEqual(section.budget,expected.budget);
  assert.deepEqual(section.now.velocity,expected.now.velocity);
  assert.deepEqual(section.now.faults,expected.now.faults);
  assert.deepEqual(frames.at(-1).velocity,section.now.velocity);
  assert.deepEqual(frames.at(-1).litho,section.now.litho);
  assert.deepEqual(frames.at(-1).faults,section.now.faults);
  assert.notDeepEqual(frames[0].litho,frames.at(-1).litho);
  assert.deepEqual(frames[0].velocity,expected.history[0].velocity);
  const saved=frames[0].velocity[0];section.now.velocity[0]+=100;
  assert.equal(frames[0].velocity[0],saved,'frames own their transferred buffers');
  await self.onmessage({data:{id:2,kind:'section',options:{...options,h:0},history:false}});
  assert.equal(replies.at(-1).kind,'error');assert.match(replies.at(-1).message,/Invalid simulation options/);
 } finally {globalThis.fetch=previousFetch;delete globalThis.self;}
});

test('Rust engine uses portable fallback and retries a failed initialization', async () => {
 const previousFetch=globalThis.fetch;
 const portable=await readFile(root+'/public/rust/earthforge_core_deterministic.wasm');
 const request={kind:'math',rows:[{function:'exp',bits:'0000000000000000'}]};
 try {
  for (const scenario of ['missing-simd','unsupported-simd']) {
   const fetched=[];
   globalThis.fetch=async url=>{
    const name=String(url).split('/').at(-1);fetched.push(name);
    if(name==='earthforge_core_deterministic_simd.wasm')return scenario==='missing-simd'?new Response('',{status:404}):new Response(new Uint8Array([0,1,2]));
    assert.equal(name,'earthforge_core_deterministic.wasm');return new Response(portable);
   };
   const {rustRequest}=await moduleOf(`export {rustRequest} from "./src/rustEngine.ts"; export const scenario="${scenario}";`);
   assert.deepEqual(await rustRequest(request),['3ff0000000000000']);
   assert.deepEqual(await rustRequest(request),['3ff0000000000000']);
   assert.deepEqual(fetched,['earthforge_core_deterministic_simd.wasm','earthforge_core_deterministic.wasm'],'successful module is cached');
  }
  let available=false;const fetched=[];
  globalThis.fetch=async url=>{fetched.push(String(url));return available?new Response(portable):new Response('',{status:503});};
  const {rustRequest}=await moduleOf('export {rustRequest} from "./src/rustEngine.ts"; export const scenario="retry";');
  await assert.rejects(rustRequest(request),error=>error instanceof AggregateError&&error.errors.length===2);
  available=true;
  assert.deepEqual(await rustRequest(request),['3ff0000000000000']);
  assert.equal(fetched.length,3,'failure does not poison later initialization');
 } finally {globalThis.fetch=previousFetch;}
});

test('Rust loader keeps preview and deterministic research modules separate', async () => {
 const previousFetch=globalThis.fetch,fetched=[];
 const fast=await readFile(root+'/public/rust/earthforge_core_simd.wasm');
 const research=await readFile(root+'/public/rust/earthforge_core_deterministic_simd.wasm');
 assert.equal(WebAssembly.Module.imports(await WebAssembly.compile(research)).length,0);
 globalThis.fetch=async url=>{const name=String(url).split('/').at(-1);fetched.push(name);assert.ok(['earthforge_core_simd.wasm','earthforge_core_deterministic_simd.wasm'].includes(name));return new Response(name.includes('deterministic')?research:fast);};
 try {
  const {rustRequest}=await moduleOf('export {rustRequest} from "./src/rustEngine.ts"; export const scenario="profiles";');
  assert.deepEqual(await rustRequest({kind:'math',rows:[{function:'exp',bits:'0000000000000000'}]}),['3ff0000000000000']);
  await assert.rejects(rustRequest({kind:'section',options:{h:0}},{preview:true}),/Invalid simulation options/);
  assert.deepEqual(await rustRequest({kind:'math',rows:[{function:'exp',bits:'0000000000000000'}]}),['3ff0000000000000']);
  assert.deepEqual(fetched,['earthforge_core_deterministic_simd.wasm','earthforge_core_simd.wasm']);
 } finally {globalThis.fetch=previousFetch;}
});
