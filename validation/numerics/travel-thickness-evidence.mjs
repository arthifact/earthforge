// Synthetic analytical evidence only. No observation files or splits are read.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../..',import.meta.url));
const source=await readFile(root+'/src/strata.ts','utf8');
const sha=s=>createHash('sha256').update(s).digest('hex');
const evidence={version:1,observational_data:'none',source_sha256:sha(source),offset_contract:'Physical interval equals stored interval translated by offsetZ; compaction shortens against the translated physical bottom.',variants:{}};
for(const mode of ['preserved','former-reset','rejected-strain']){
 const injected=mode==='preserved'?'':mode==='former-reset'?'if(p.bed>=0)q.offsetZ=0;':'if(p.bed>=0)q.offsetZ=p.offsetZ*q.height/p.height;';
 assert.equal(source.split('    next.push(q);').length,2);
 const code=source.replace('    next.push(q);',injected+'\n    next.push(q);');
 const bundle=await build({stdin:{contents:code,resolveDir:root+'/src',loader:'ts'},bundle:true,platform:'node',format:'esm',write:false});
 const {compactColumn,emptyLayer}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
 const rows=[];
 for(const h of [40,20,10])for(const shift of [-.7*h,0,1.3*h])for(const solid of [5,10]){
  const p={bed:0,height:20,solid,fraction:.37,burial:900,loading:500,offsetX:3.7,offsetZ:-shift};
  const before=[emptyLayer(-1,80+shift),p,{...emptyLayer(-2,100-shift),offsetZ:-shift}];
  const r=compactColumn(before,[{carbonate:false}],null,{porosity:()=>.5,effectiveDepth:d=>Math.max(0,d)}),q=r.column[1];
  const top=r.column[0].height+q.offsetZ,bottom=top+q.height,expected={top:100-2*solid,bottom:100};
  const error=Math.max(Math.abs(top-expected.top),Math.abs(bottom-expected.bottom));
  assert.equal(q.solid,solid);assert.equal(q.fraction,p.fraction);assert.equal(q.burial,p.burial);assert.equal(q.loading,p.loading);
  rows.push({h,storage_shift_m:shift,solid_height_m:solid,expected,actual:{top,bottom},max_position_error_m:error,passes:error<1e-8});
 }
 evidence.variants[mode]={passed:rows.filter(r=>r.passes).length,total:rows.length,max_position_error_m:Math.max(...rows.map(r=>r.max_position_error_m)),rows};
}
assert.equal(evidence.variants.preserved.passed,18);
assert.equal(evidence.variants['former-reset'].passed,6);
assert.equal(evidence.variants['rejected-strain'].passed,12);
await writeFile(root+'/validation/numerics/travel-thickness-evidence.json',JSON.stringify(evidence,null,2)+'\n');
console.log(Object.fromEntries(Object.entries(evidence.variants).map(([k,v])=>[k,{passed:v.passed,total:v.total,max_position_error_m:v.max_position_error_m}])));
