/** Wait for isolated wave timing to finish, then rerun the unchanged physical plan. */
import {existsSync,readFileSync,writeFileSync,copyFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
while(true){if(existsSync('validation/overnight/final-profile-benchmark-status.json')&&JSON.parse(readFileSync('validation/overnight/final-profile-benchmark-status.json')).stage==='complete')break;await new Promise(resolve=>setTimeout(resolve,2000));}
const env={...process.env,EARTHFORGE_NATIVE_ENGINE:resolve('../engine-candidates/final-native')};
const out='data/numerics/final-sine-fix-v1';
let run=spawnSync(process.execPath,['validation/rust/numerics.mjs',out],{env,stdio:'inherit'});assert.equal(run.status,0);
copyFileSync(out+'/summary.json','validation/overnight/final-numerics-results.json');
const before=JSON.parse(readFileSync('validation/overnight/allocation-numerics-results.json')),after=JSON.parse(readFileSync('validation/overnight/final-numerics-results.json'));
const equivalent={samePlan:before.plan_sha256===after.plan_sha256,sameCases:JSON.stringify(before.cases)===JSON.stringify(after.cases),sameMetrics:JSON.stringify(before.metrics)===JSON.stringify(after.metrics),beforeBudget:before.budget,afterBudget:after.budget,note:'Sine evaluation corrected without changing any physical coefficient, frozen plan, eligibility rule or tolerance. Preserve both datasets even if numerical metrics change; report differences honestly.'};
writeFileSync('validation/overnight/final-numerics-equivalence.json',JSON.stringify(equivalent,null,2)+'\n');assert.equal(equivalent.samePlan,true);
run=spawnSync(process.execPath,['validation/rust/checks.mjs'],{env:{...env,EARTHFORGE_CHECKS_OUT:'validation/overnight/final-acceptance-results.json'},stdio:'inherit'});assert.equal(run.status,0);
