/** Read-only verification of the installed project against validated sources. */
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {spawnSync,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const actual=process.env.EARTHFORGE_ACTUAL_PROJECT??'/Users/torus/Desktop/Research/earthforge';
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const paths=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(p=>p&&(/^(src|crates|scripts|tests)\//.test(p)||['Cargo.toml','Cargo.lock','package.json','package-lock.json','tsconfig.json','vite.config.ts','.gitignore','index.html','3d.html','README.md'].includes(p)));
for(const p of paths)assert.equal(sha(p),sha(resolve(actual,p)),p+' installed source');
const wasm=readdirSync('public/rust').filter(p=>p.endsWith('.wasm')).map(p=>'public/rust/'+p);
for(const p of wasm)assert.equal(sha(p),sha(resolve(actual,p)),p+' installed build');
function run(path,request){const p=spawnSync(path,[],{input:JSON.stringify(request),encoding:'utf8',maxBuffer:256*1024*1024});assert.equal(p.status,0,p.stderr);const r=JSON.parse(p.stdout);assert.equal(r.ok,true,r.error);if(r.value.checks)delete r.value.checks.seconds;return r.value;}
const requests=[
 {kind:'basin',options:{seed:765184,setting:'extension',h:40,overpressure:1}},
 {kind:'basin',options:{seed:20261014,setting:'compression',h:40,exhumation:1}},
 {kind:'history3d',options:{seed:20261014,steps:12,faults:2,exhumation:true,overpressure:true},query:{nx:11,nz:21,sectionsY:[1000,5000,9000],rays:[[3500.13,4300.31]],includeProfiles:true}}
];
for(const r of requests)assert.deepEqual(run(resolve(actual,'target/release/earthforge'),r),run('target/release/earthforge',r),'installed '+r.kind+' physical response');
const report={createdAt:new Date().toISOString(),actualProject:actual,sourceFilesCompared:paths.length,allSourceBytesExact:true,wasmFilesCompared:wasm.length,allWasmBytesExact:true,installedNativeSha256:sha(resolve(actual,'target/release/earthforge')),developmentNativeSha256:sha('target/release/earthforge'),wholePhysicalResponsesExact:requests.map(r=>({kind:r.kind,options:r.options})),scope:'Installed source and all four Wasm modules compared byte for byte; representative complete native physical responses compared exactly except diagnostic elapsed seconds. Build/Rust/worker checks run separately.'};
writeFileSync('validation/unified-material/installed-results.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
