/** Synthetic identity checks for 2D sections of the exported 3D history. */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {wasmEngine} from '../history3d/engine.mjs';
const catalog=JSON.parse(readFileSync('python/src/earthforge/catalog.json','utf8'));
const wasm=await wasmEngine('public/rust/earthforge_core.wasm');
function native(request){const p=spawnSync('target/release/earthforge',[],{input:JSON.stringify(request),encoding:'utf8',maxBuffer:32*1024*1024});assert.equal(p.status,0,p.stderr);const r=JSON.parse(p.stdout);assert.equal(r.ok,true,r.error);return r.value;}
const grid={nx:9,ny:9,nz:31,dx:1250,dy:1250,dz:100,origin:{x:0,y:0,z:0}},rows=[];
for(const scenario of catalog.scenarios)for(const stage of [0,6,12]){
 const request={kind:'history3d',includeModel:true,options:{...scenario.options,seed:1001,materialStep:10},query:{stage,sectionsY:[],includeMaterial:true,grid}},start=performance.now(),block=native(request);
 assert.ok(block.stats.evaluation.maxNormalizedGrainResidual<=1);
 const planes=['x','y','z'].map(axis=>({axis,position:axis==='z'?1500:5000,nu:9,nv:axis==='z'?9:31})),query={kind:'history3d',model:block.sourceModel,query:{stage,sectionsY:[],zMax:3000,planes}},slices=native(query),browser=wasm.run(query);
 assert.deepEqual(browser.planes,slices.planes);
 let matches=0;
 for(const plane of slices.planes)for(let j=0;j<plane.nv;j++)for(let i=0;i<plane.nu;i++){
  const [x,y,z]=plane.axis==='x'?[4,i,j]:plane.axis==='y'?[i,4,j]:[i,j,15],k=(z*9+y)*9+x,p=j*plane.nu+i;
  for(const field of ['velocity','beds','lithology']){assert.equal(plane[field][p],block.projection[field][k],`${scenario.id} ${stage} ${plane.axis} ${field}`);matches++;}
 }
 rows.push({scenario:scenario.id,stage,exactFieldComparisons:matches,nativeWasmPlanesExact:true,grainChecks:block.stats.evaluation.localEventsChecked,elapsedMs:performance.now()-start,modelSha256:createHash('sha256').update(JSON.stringify(block.sourceModel)).digest('hex')});
}
const report={schema:'earthforge-unified-workspace-verification-v1',createdAt:new Date().toISOString(),runtime:process.version,cases:rows,totalExactFieldComparisons:rows.reduce((s,r)=>s+r.exactFieldComparisons,0),scope:'Synthetic identity verification: all three plane orientations use the exported 3D source model and same stage, match intersecting block nodes exactly, and match the portable browser engine. No material laws or tolerances changed. Browser display encodes f32; physical comparisons here use engine f64. This does not establish independent field validity or arbitrary voxel resolution.'};writeFileSync('validation/unified-workspace/verification.json',JSON.stringify(report,null,2)+'\n');console.log(`All ${report.totalExactFieldComparisons} field comparisons exact across ${rows.length} scenario/stage cases.`);
