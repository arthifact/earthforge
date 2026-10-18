/** Isolated-process timings. No engine retains another engine's model state. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir,cpus,totalmem} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const hash = x => createHash('sha256').update(x).digest('hex');
const nativePath=process.env.EARTHFORGE_NATIVE_ENGINE??'target/release/earthforge';
const wasmPath=process.env.EARTHFORGE_WASM_ENGINE??'target/wasm32-unknown-unknown/release/earthforge_core.wasm';
const median = values => [...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
if(process.argv[2]==='--worker') {
  const engine=process.argv[3],options=JSON.parse(process.argv[4]);
  let reference,wasm;
  if(engine==='typescript') reference=await import(pathToFileURL(process.env.EARTHFORGE_REFERENCE_BUNDLE));
  if(engine==='wasm') wasm=(await WebAssembly.instantiate(readFileSync(wasmPath),{math:{exp:Math.exp,expm1:Math.expm1,tanh:Math.tanh,sin:Math.sin,tan:Math.tan,cbrt:Math.cbrt}})).instance.exports;
  const rows=[];
  const count=Number(process.env.EARTHFORGE_BENCH_TRIALS??3);
  for(let iteration=-1;iteration<count;iteration++) {
    let now,budget,kernelMs=null;
    const start=performance.now();
    if(engine==='typescript') {
      const basin=reference.simulate({...reference.BASIN_DEFAULTS,...options});
      now=reference.windowOf(basin); budget=basin.budget.summary;
    } else if(engine==='native') {
      const run=spawnSync(nativePath,[],{input:JSON.stringify({kind:'section',options}),encoding:'utf8',maxBuffer:150*1024*1024});
      if(run.status!==0)throw Error(run.stderr||`Native exit ${run.status}`);
      const response=JSON.parse(run.stdout);assert.equal(response.ok,true,response.error);
      ({now,budget}=response.value);kernelMs=response.value.checks.seconds*1000;
    } else {
      const bytes=new TextEncoder().encode(JSON.stringify({kind:'section',options}));
      const pointer=wasm.earthforge_alloc(bytes.length);
      new Uint8Array(wasm.memory.buffer,pointer,bytes.length).set(bytes);
      try {
        const length=wasm.earthforge_run(pointer,bytes.length);
        const response=JSON.parse(new TextDecoder().decode(new Uint8Array(wasm.memory.buffer,wasm.earthforge_result_ptr(),length)));
        assert.equal(response.ok,true,response.error);({now,budget}=response.value);
      } finally {wasm.earthforge_free(pointer,bytes.length);wasm.earthforge_result_free();}
    }
    const elapsedMs=performance.now()-start;
    assert.equal(budget.closed,true);
    const stateHash=hash(JSON.stringify({velocity:Array.from(now.velocity),beds:Array.from(now.beds),grainFinal:budget.final.total}));
    const row={iteration,warmup:iteration<0,elapsedMs,kernelMs,stateHash};rows.push(row);
    process.stderr.write(JSON.stringify({engine,options,...row})+'\n');
  }
  process.stdout.write(JSON.stringify({engine,options,rows,medianMs:median(rows.filter(r=>!r.warmup).map(r=>r.elapsedMs)),memory:process.memoryUsage()}));
} else {
  const {build}=await import('esbuild');
  const scratch=mkdtempSync(join(tmpdir(),'earthforge-isolated-bench-'));
  const referencePath=join(scratch,'reference.mjs');
  await build({stdin:{contents:'export * from "./src/basin.ts";',resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',outfile:referencePath});
  const hashes={native:hash(readFileSync(nativePath)),wasm:hash(readFileSync(wasmPath)),reference:hash(readFileSync(referencePath))};
  const rows=[];
  try {
    for(const h of (process.env.EARTHFORGE_BENCH_SPACINGS??'40,20').split(',').map(Number)) {
      for(const fixture of [{seed:765184,setting:'extension'},{seed:20261014,setting:'compression'}]) {
        const options={...fixture,h,record:false};
        const order=rows.length%2===0?['typescript','native','wasm']:['wasm','typescript','native'];
        const engines=[];
        for(const engine of order) {
          const run=spawnSync(process.execPath,[resolve('validation/overnight/benchmark.mjs'),'--worker',engine,JSON.stringify(options)],{env:{...process.env,EARTHFORGE_REFERENCE_BUNDLE:referencePath},encoding:'utf8',maxBuffer:10*1024*1024,stdio:['ignore','pipe','inherit']});
          if(run.status!==0)throw Error(`${engine} worker exited ${run.status}`);
          engines.push(JSON.parse(run.stdout));
        }
        const stateHashes=new Set(engines.flatMap(e=>e.rows.map(r=>r.stateHash)));
        assert.equal(stateHashes.size,1,'Engines or repeated trials have different physical outputs');
        rows.push({options,engines});
        writeFileSync(process.env.EARTHFORGE_BENCH_OUT??'validation/overnight/isolated-benchmark-results.json',JSON.stringify({createdAt:new Date().toISOString(),runtime:{node:process.version,v8:process.versions.v8,platform:process.platform,arch:process.arch,cpu:cpus()[0].model,logicalCpus:cpus().length,ramBytes:totalmem()},method:'Each engine in a separate Node process, no concurrent simulation workers; one warmup and three measured trials by default. TS simulation plus display projection; native CLI process plus JSON request/response; Wasm request/response with module setup excluded. These are local end-to-end timings, not a cross-hardware SOTA comparison. Native CLI starts a fresh native process each trial. Fixture order fixed; engine order alternates.',hashes,rows},null,2)+'\n');
      }
    }
    assert.deepEqual(hashes,{native:hash(readFileSync(nativePath)),wasm:hash(readFileSync(wasmPath)),reference:hash(readFileSync(referencePath))},'Engine changed during benchmark');
  } finally {rmSync(scratch,{recursive:true,force:true});}
}
