/** Full legacy regression suite, including synthetic calibration fixtures.
 * Audited imports read source/plan files; dataset-loading CLIs are main-guarded.
 * This runner does not execute the observational calibration/holdout workflows.
 */
import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,readdirSync,openSync,closeSync} from 'node:fs';
import {createHash} from 'node:crypto';
const prefix=process.env.EARTHFORGE_LEGACY_PREFIX??'validation/overnight/legacy-tests';
const files=readdirSync('tests').filter(f=>f.endsWith('.test.mjs')).sort().map(f=>'tests/'+f);
const hashes=Object.fromEntries(files.map(f=>[f,createHash('sha256').update(readFileSync(f)).digest('hex')]));
const wasmHash=createHash('sha256').update(readFileSync('public/rust/earthforge_core.wasm')).digest('hex');
const moduleSha256=Object.fromEntries(readdirSync('public/rust').filter(name=>name.endsWith('.wasm')).sort().map(name=>[name,createHash('sha256').update(readFileSync('public/rust/'+name)).digest('hex')]));
const output=openSync(prefix+'.log','w');
const started=Date.now();
const child=spawn(process.execPath,['--test','--test-concurrency=2',...files],{stdio:['ignore',output,output],detached:true});
writeFileSync(prefix+'-process.json',JSON.stringify({parentPid:process.pid,testRunnerPid:child.pid,startedAt:new Date(started).toISOString(),files:files.length})+'\n');
console.log(`Running all ${files.length} legacy test files, concurrency 2; detailed output saved to ${prefix}.log`);
const timeout=setTimeout(()=>{process.kill(-child.pid,'SIGTERM');},3*60*60*1000);
child.on('exit',(code,signal)=>{
 clearTimeout(timeout);closeSync(output);
 const log=readFileSync(prefix+'.log','utf8');
 const metric=name=>{const m=log.match(new RegExp('(?:#|ℹ) '+name+' (\\d+)'));return m?Number(m[1]):null;};
 const report={runtime:process.version,command:'node --test --test-concurrency=2 tests/*.test.mjs',files,sourceSha256:hashes,wasmSha256:wasmHash,moduleSha256,exitCode:code,signal,completed:code!==null,passed:code===0,tests:metric('tests'),pass:metric('pass'),fail:metric('fail'),elapsedSeconds:(Date.now()-started)/1000,observationalScope:'Only source files, plans and synthetic test fixtures; audited observational main functions are not invoked. Reserved FORCE data are not read or scored.'};
 writeFileSync(prefix+'-results.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));process.exitCode=code??1;
});
