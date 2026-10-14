#!/usr/bin/env node
// Independent analytical fixtures and the retired cbaa6f1 snapping rules.
// Synthetic geometry only. No observational arrays or partition metadata.
import {build} from 'esbuild';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../..',import.meta.url));
const sourceFiles=['src/normalGeometry.ts','validation/numerics/fault-geometry-evidence.mjs'];
const hash=b=>createHash('sha256').update(b).digest('hex');
const bundle=await build({stdin:{contents:'export * from "./src/normalGeometry.ts";',resolveDir:root},bundle:true,platform:'node',format:'esm',write:false});
const {normalDepth,extendNormal}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
const origin=217.35,dip=1.03,detachment=3200,subsidence=[1.7,8.3,21.4,64.2,0,31.9,7.1,111.3,3.7],normal=[];
for(const h of [40,20,10]) for(const dir of [-1,1]) {
 const nx=4000/h+1,old=new Float64Array(nx).fill(NaN),current=normalDepth(nx,h,origin,dir,dip,detachment);
 let oldTop=Math.round((origin+2000)/h),total=0;
 for(let i=oldTop;i>=0&&i<nx;i+=dir) old[i]=detachment*(1-Math.exp(-Math.abs(i-oldTop)*h*Math.tan(dip)/detachment));
 const steps=[];
 for(const d of subsidence) {
  total+=d;
  for(let i=0;i<nx;i++){if(Number.isFinite(old[i]))old[i]+=d;if(Number.isFinite(current.depth[i]))current.depth[i]+=d;}
  const top=oldTop,z=old[top];
  for(let j=1;;j++) {const i=top-dir*j;if(i<0||i>=nx||z-(j-1)*h*Math.tan(dip)<=0)break;old[i]=Math.max(0,z-j*h*Math.tan(dip));oldTop=i;if(old[i]===0||i===0||i===nx-1)break;}
  current.top=extendNormal(current.depth,current.top,dir,h,dip);
  const expected=origin-dir*total/Math.tan(dip),before=-2000+oldTop*h-dir*old[oldTop]/Math.tan(dip),after=-2000+current.top*h-dir*current.depth[current.top]/Math.tan(dip);
  steps.push({subsidence_total_m:total,expected_x_m:expected,before_x_m:before,after_x_m:after,before_error_m:before-expected,after_error_m:after-expected});
 }
 normal.push({h,dir,steps});
}
const result={version:1,observational_data:'none',baseline_revision:'cbaa6f14b1d185d0563dac49ce41010d0c7c6668',source_sha256:Object.fromEntries(await Promise.all(sourceFiles.map(async p=>[p,hash(await readFile(resolve(root,p)))]))),normal_fixture:{origin_m:origin,dip_radians:dip,detachment_m:detachment,subsidence_m:subsidence,runs:normal}};
await writeFile(resolve(root,'validation/numerics/fault-geometry-evidence.json'),JSON.stringify(result,null,2)+'\n');
console.log('Saved independent geometry evidence; maximum normal-tip error before/after (m):',Math.max(...normal.flatMap(r=>r.steps.map(s=>Math.abs(s.before_error_m)))) ,Math.max(...normal.flatMap(r=>r.steps.map(s=>Math.abs(s.after_error_m)))));
