/** Exact physical regression and new research queries across native/all four Wasms. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {wasmEngine} from '../history3d/engine.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const nativePath='target/release/earthforge',beforePath=process.env.EARTHFORGE_FROZEN_NATIVE??'../research-release-engines/before-native';
const native=(r,p=nativePath)=>{const v=spawnSync(p,[],{input:JSON.stringify(r),maxBuffer:256*1024*1024});assert.equal(v.status,0,v.stderr.toString());const a=JSON.parse(v.stdout);assert.equal(a.ok,true,a.error);return a.value;};
const physical=v=>({projection:v.projection,points:v.points,rays:v.rays,slices:v.slices,planes:v.planes,horizons:v.horizons,sourceModel:v.sourceModel});
const wasmPaths=['earthforge_core.wasm','earthforge_core_simd.wasm','earthforge_core_deterministic.wasm','earthforge_core_deterministic_simd.wasm'].map(n=>'public/rust/'+n);
const engines=await Promise.all(wasmPaths.map(async path=>({path,engine:await wasmEngine(path)})));
const catalog=JSON.parse(readFileSync('python/src/earthforge/catalog.json')).scenarios,rows=[];
for(const scenario of catalog)for(const stage of [0,6,12]){
 const request={kind:'history3d',options:{...scenario.options,seed:1001,materialStep:10},includeModel:true,query:{stage,sectionsY:[],includeMaterial:true,grid:{nx:9,ny:7,nz:31,dx:10000/8,dy:10000/6,dz:100,origin:{x:0,y:0,z:0}},points:[{x:4567.13,y:5432.17,z:1234.19}]}};
 const before=native(request,beforePath),after=native(request);assert.deepEqual(physical(after),physical(before));
 for(const {path,engine}of engines)assert.deepEqual(physical(engine.run(request)),physical(after),path+' '+scenario.id+' '+stage);
 rows.push({scenario:scenario.id,stage,allFiveEnginesAndFrozenBaselineExact:true,physicalSha256:sha(JSON.stringify(physical(after)))});console.log(scenario.id+' '+stage+' exact');
}
const research={kind:'history3d',options:{geology:'detailed',steps:6,faults:2,seed:1001,exhumation:true,overpressure:true},includeModel:true,query:{sectionsY:[],grid:{nx:33,ny:29,nz:47,dx:10000/48,dy:10000/47,dz:3000/63,origin:{x:13.7,y:17.3,z:.1}},gridWindow:{start:[7,5,11],count:[11,9,23]},includeMaterial:true,includeState:true,horizons:[{x:5000,y:5000,bed:5},{x:3500,y:4000,bed:0}]}};
const r=native(research);for(const {path,engine}of engines)assert.deepEqual(physical(engine.run(research)),physical(r),path+' research windows/state/contacts');
const report={createdAt:new Date().toISOString(),runtime:process.version,hashes:{native:sha(readFileSync(nativePath)),beforeNative:sha(readFileSync(beforePath)),...Object.fromEntries(wasmPaths.map(p=>[p,sha(readFileSync(p))]))},legacyPhysicalRegression:rows,researchQueries:{allFiveEnginesExact:true,globallyIndexedWindows:true,materialState:true,allContactOccurrences:true,physicalSha256:sha(JSON.stringify(physical(r)))},scope:'Exact synthetic verification. Capability metadata intentionally updated; existing physical results unchanged. No matched competitor or field-accuracy claim.'};writeFileSync('validation/research-release/core-validation.json',JSON.stringify(report,null,2)+'\n');
