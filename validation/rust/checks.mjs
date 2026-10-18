// Existing acceptance gates, evaluated against the native Rust engine.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {spawnSync} from 'node:child_process';
import {writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const bundle=await build({stdin:{contents:'export {BASIN_DEFAULTS} from "./src/basin.ts"; export {verify} from "./src/basinVerify.ts"; export {checkRows} from "./src/checks.ts"; export {decodeRustBasin} from "./src/rustEngine.ts";',resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const {BASIN_DEFAULTS,verify,checkRows,decodeRustBasin}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
const engine=process.env.EARTHFORGE_NATIVE_ENGINE??'target/release/earthforge';
const run=options=>{
 const p=spawnSync(engine,[],{input:JSON.stringify({kind:'basin',options}),encoding:'utf8',maxBuffer:512*1024*1024});
 if(p.status!==0)throw Error(p.stderr||`Native exit ${p.status}`);
 const result=JSON.parse(p.stdout);if(!result.ok)throw Error(result.error);return decodeRustBasin(result.value);
};
let calls=0;
const result=await verify(BASIN_DEFAULTS,765184,2,message=>{if(++calls%6===0)console.log(message)},run);
const rows=checkRows(result);
writeFileSync(process.env.EARTHFORGE_CHECKS_OUT??'validation/rust/checks-results.json',JSON.stringify({runtime:process.version,native_sha256:createHash('sha256').update(readFileSync(engine)).digest('hex'),result,rows},null,2)+'\n');
for(const row of rows)console.log(JSON.stringify(row));
const required=rows.filter(row=>['Numerical benchmarks','Sediment conservation','Physics'].includes(row.group));
assert.ok(required.length>0);
assert.ok(required.every(row=>row.status!=='fail'),JSON.stringify(required.filter(row=>row.status==='fail')));
