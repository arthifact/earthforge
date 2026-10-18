// Fixed field-reconstruction cases through native and every shipped Wasm core.
import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import {wasmEngine} from '../history3d/engine.mjs';
const [folder,out]=process.argv.slice(2);
if(!folder||!out)throw Error('Pass a completed field run directory and fresh output JSON path');
const folds=JSON.parse(readFileSync(`${folder}/folds.json`));
const names=['earthforge_core.wasm','earthforge_core_simd.wasm','earthforge_core_deterministic.wasm','earthforge_core_deterministic_simd.wasm'];
const engines=await Promise.all(names.map(n=>wasmEngine(`public/rust/${n}`)));
const records=[];
for(const method of ['plane','adaptive']){
 const fold=folds.filter(f=>f.region==='35'&&f.design==='parent'&&f.method===method).sort((a,b)=>a.heldGroup.localeCompare(b.heldGroup))[0];
 const history=JSON.parse(readFileSync(`${folder}/${fold.history}`)),model=history.model,b=model.bounds.max,horizons=[],points=[];
 for(let y=0;y<5;y++)for(let x=0;x<5;x++){
  for(let unit=0;unit<4;unit++)horizons.push({x:b.x*x/4,y:b.y*y/4,unit});
  for(const z of [100,1000,2000,3000])points.push({x:b.x*x/4,y:b.y*y/4,z});
 }
 const request={kind:'history3d',model,query:{sectionsY:[],horizons,points}};
 const native=spawnSync('target/release/earthforge',[],{input:JSON.stringify(request),encoding:'utf8',env:{...process.env,RAYON_NUM_THREADS:'1'}});
 if(native.status!==0)throw Error(native.stderr);
 const parsed=JSON.parse(native.stdout);if(!parsed.ok)throw Error(parsed.error);
 const expected=parsed.value, modules=[];
 for(let i=0;i<names.length;i++){
  const actual=engines[i].run(request);
  if(!isDeepStrictEqual(actual.horizons,expected.horizons)||!isDeepStrictEqual(actual.points,expected.points))throw Error(`${names[i]} differs on ${method}`);
  modules.push({file:names[i],sha256:createHash('sha256').update(readFileSync(`public/rust/${names[i]}`)).digest('hex'),contactDepthsExact:true,pointMaterialsExact:true});
 }
 records.push({method,region:fold.region,heldParent:fold.heldGroup,modelSha256:history.modelSha256,horizonQueries:horizons.length,pointQueries:points.length,modules});
}
writeFileSync(out,JSON.stringify({schema:'earthforge-field-geometry-engine-parity-v1',cases:records,scope:'Two fixed reconstructed field-contact stacks at a 5x5 XY grid; numerical consistency, not field accuracy or browser UI validation.'},null,2)+'\n',{flag:'wx'});
console.log('Two field-fitted stacks: contact geometry and material points agree exactly across native and all four browser cores.');
