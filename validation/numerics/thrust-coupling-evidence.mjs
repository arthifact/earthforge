#!/usr/bin/env node
// Synthetic mechanism controls only. No observation, partition or calibration input.
import {build} from 'esbuild';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../..',import.meta.url));
const files=['src/basin.ts','src/strata.ts','src/thrustGeometry.ts','src/faultTrace.ts','validation/numerics/thrust-coupling-evidence.mjs'];
const source_sha256=Object.fromEntries(await Promise.all(files.map(async p=>[p,createHash('sha256').update(await readFile(root+'/'+p)).digest('hex')])));
const bundle=await build({stdin:{contents:'export * from "./src/strata.ts"; export * from "./src/faultTrace.ts";',resolveDir:root},bundle:true,platform:'node',format:'esm',write:false});
const {packColumn,emptyLayer,transportTrace,projectTrace,traceFromDepth}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
const rock={bed:0,height:5,solid:2,fraction:.37,burial:900,loading:500,offsetX:0,offsetZ:0};
const gap_controls=[];
for(const gap of [.0001,7.3,40]){
 const c=[emptyLayer(-1,10),rock,emptyLayer(-1,gap),emptyLayer(-2,100)];
 const r=packColumn(c,(lo,hi)=>Math.max(0,Math.min(hi,15+gap)-Math.max(lo,15)));
 gap_controls.push({gap_m:gap,marker_depth_m:12.5,old_geometry_error_m:r.mapDepth(12.5)-12.5,new_geometry_error_m:r.mapPhysicalDepth(12.5)-12.5});
}
const branch_controls=[];
for(const h of [40,20,10]){
 const a=traceFromDepth(Float64Array.from({length:1000/h+1},(_,i)=>i*h),h,0);
 const one=transportTrace(a,[],()=>500,(x,z)=>[x+120,z],()=>"flat");
 const two=transportTrace(one,[],()=>500,(x,z)=>[x+120,z],()=>"flat");
 branch_controls.push({h,first_at_560_m:projectTrace(one,1000/h+1,h,0)[560/h],expected_first_m:500,second_at_600_m:projectTrace(two,1000/h+1,h,0)[600/h],expected_second_m:480});
}
const result={observational_data:'none',source_sha256,gap_controls,branch_controls,interpretation:'Known-answer mechanism tests, not geological accuracy or field calibration. Single-depth compatibility output is a mean of distinct branch intersections; physical segments remain separate.'};
await writeFile(root+'/validation/numerics/thrust-coupling-evidence.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
