/** Coarse full-window output sampling of the same 10 m material history. */
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {wasmEngine} from './engine.mjs';
const request={kind:'history3d',options:{seed:20261014,steps:12,faults:2,compaction:true,materialStep:10},includeModel:true,query:{sectionsY:[],grid:{nx:33,ny:33,nz:65,dx:312.5,dy:312.5,dz:96.875,origin:{x:0,y:0,z:0}}}};
const nativePath=process.env.EARTHFORGE_NATIVE_ENGINE??'target/release/earthforge';
let start=performance.now();const p=spawnSync(nativePath,[],{input:JSON.stringify(request),encoding:'utf8',maxBuffer:256*1024*1024});assert.equal(p.status,0,p.stderr);const r=JSON.parse(p.stdout);assert.equal(r.ok,true,r.error);const nativeMs=performance.now()-start;
const wasmPath='public/rust/earthforge_core_deterministic_simd.wasm',engine=await wasmEngine(wasmPath);start=performance.now();const value=engine.run(request),wasmMs=performance.now()-start;
assert.deepEqual(value.projection,r.value.projection,'every full-window node must match exactly');
const sha=x=>createHash('sha256').update(x).digest('hex');
const report={createdAt:new Date().toISOString(),grid:request.query.grid,nodes:33*33*65,materialStep:10,nativePath,nativeSha256:sha(readFileSync(nativePath)),wasmSha256:sha(readFileSync(wasmPath)),allVelocityAndMaterialNodesExact:true,projectionSha256:sha(JSON.stringify(value.projection)),diagnosticTiming:{nativeMs,deterministicWasmMs:wasmMs,wasmSetupMs:engine.setupMs},scope:'One diagnostic trial, not a controlled benchmark. Coarse output sampling across the full 10x10x6.2km open observation window, independent of 10m material subdivision. This coarse grid is not validated for wave propagation.'};
writeFileSync('validation/history3d/full-window-results.json',JSON.stringify(report,null,2)+'\n');
if(process.env.EARTHFORGE_VOLUME_OUTPUT)writeFileSync(process.env.EARTHFORGE_VOLUME_OUTPUT,JSON.stringify({request,result:r.value})+'\n');
console.log(JSON.stringify(report));
