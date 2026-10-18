/** Assemble a compact handoff from completed checks; never run simulations or load observations. */
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const base='validation/overnight/';
const read=name=>JSON.parse(readFileSync(base+name));
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const rustCount=name=>[...readFileSync(base+name,'utf8').matchAll(/test result: ok\. (\d+) passed; 0 failed/g)].reduce((sum,m)=>sum+Number(m[1]),0);
const legacy=read('final-legacy-results.json');
assert.equal(legacy.passed,true);assert.equal(legacy.pass,202);assert.equal(legacy.fail,0);
assert.equal(rustCount('research-profile-rust-tests.log'),52);
assert.equal(rustCount('actual-project-rust-tests.log'),52);
const worker=readFileSync(base+'actual-project-worker-tests.log','utf8');
assert.match(worker,/tests 3/);assert.match(worker,/fail 0/);
const numerics=read('final-numerics-results.json'),equivalence=read('final-numerics-equivalence.json');
assert.deepEqual(numerics.budget,{runs:36,closed_runs:36,failed_events:0});
assert.ok(equivalence.samePlan&&equivalence.sameCases&&equivalence.sameMetrics);
const required=read('final-acceptance-results.json').rows.filter(r=>['Numerical benchmarks','Sediment conservation','Physics'].includes(r.group));
assert.equal(required.length,14);assert.ok(required.every(r=>r.status==='pass'));
const parity=read('final-parity-20m.json');assert.equal(parity.results.length,3);
for(const row of parity.results){for(const key of ['velocityNative','velocityWasm','nativeVsWasm','labelsNative','labelsWasm'])assert.equal(row[key].changed,0);assert.equal(row.grainDifference,0);assert.equal(row.budgetClosed,true);}
const browser=read('final-browser-validation.json');assert.equal(browser.pass,true);
assert.equal(browser.volume.nativeAndBrowserRawJsonEqual,true);
assert.equal(browser.acoustic.nativeTraceError.relativeL2,0);assert.equal(browser.acoustic.nativeFieldError.relativeL2,0);
const scalar=read('portable-math-expanded-validation.json');assert.equal(scalar.passed,true);assert.equal(scalar.comparisons,2520084);
const erosion=read('erosion3d-validation.json');assert.equal(erosion.allEventBudgetsClosed,true);
const devito=read('devito-comparison-summary.json');assert.equal(devito.allFiveMatchedPrecisionCasesPass,true);
const fidelity=read('final-source-fidelity.json');assert.ok(fidelity.allSourceIdentical&&fidelity.allWasmIdentical&&fidelity.allFivePairsIdentical);
for(const row of fidelity.rows)assert.equal(sha(row.path),row.developmentSha256,'Stale fidelity: '+row.path);
const performance=read('final-profile-benchmark-results.json').rows.map(({case:fixture,variant,medianMs})=>({fixture,variant,medianMs}));
const peakMemory=read('profile-3d-final-results.json');
const artifacts=JSON.parse(readFileSync('../../outputs/earthforge-artifact-manifest.json'));
const report={
 createdAt:new Date().toISOString(),status:'required checks passed; handoff ready',
 originalProject:'/Users/torus/Desktop/Research/earthforge',
 sourceCheckpoint:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
 simulationSourceCheckpoint:'971eda0e3cf255cdbdfe12f5f791ecc6300acac7',
 changes:['Rust native and browser simulation core, with TypeScript UI and retained reference engine','Continuous 3D material supports with oblique faults, prescribed planar erosion and closed constituent/per-bed grain budgets','Derived 3D velocities and constant-density 2D/3D acoustic propagation; five reproducible synthetic model/shot pairs','Exact-arithmetic allocation optimizations, SIMD wave rows and deterministic native plane parallelism','Fast page previews and deterministic research profiles with portable fallback'],
 validation:{rustTests:52,legacyTests:202,workerLoaderTestsIncludedInLegacy:3,legacyElapsedSeconds:legacy.elapsedSeconds,frozenNumericalRuns:36,passingEventBudgets:4494,requiredAcceptanceGates:14,unchangedFrozenCasesAndMetrics:true,exact20mMigrationFixtures:3,expandedScalarComparisons:scalar.comparisons,exactNativeBrowserResearchArrays:true,independentDevitoCases:5,maxDevitoMatchedPrecisionRelativeL2:devito.maxMatchedPrecisionRelativeL2,devitoDefaultPrecisionFailureRetained:true},
 actualProjectVerification:{sourceFiles:fidelity.sourceFiles,allSourceIdentical:true,allFourWasmIdentical:true,allFiveSyntheticPairsIdentical:true,rustTests:52,workerLoaderTests:3,productionBuildCompleted:true,nativeBinaryHashes:fidelity.native},
 performance:{hardware:'Apple M4 Pro',boundary:'Separate processes, one warmup and three measured trials. Wave requests include CLI/request/response/decoding; Wasm setup excluded. Cropped prototypes, not full-domain 10m simulations or energy measurements.',waveRequests:performance,peakMemory,scope:'Earth Forge version comparisons only; no measured advantage over SubsurfaceGen or another research system.'},
 archives:artifacts.archives.map(({name,bytes,sha256,verifiedReadback})=>({name,bytes,sha256,verifiedReadback})),
 nextMilestone:'Supported 3D deposition and conservative compaction with spatial burial/loading histories, independent crossline reduction and convergence gates, followed by frozen matched workloads and downstream evaluation.',
 limitations:['The main basin-history generator and UI still generate 2D sections','3D faults and erosion are prescribed kinematics; no force/stress solver, curved faults, 3D deposition/compaction or evolving spatial loading','Acoustics is constant-density isotropic pressure with a sponge, without elasticity, anisotropy, free surface or PML','Binary64 geometry and fragment growth need larger degeneracy/scale studies','Independent field accuracy and SOTA superiority are not established'],
 observationalScope:'Reserved FORCE holdout remains unread and unscored. No deployment, publication or external messages.',
 evidence:['final-source-fidelity.json','final-legacy-results.json','actual-project-rust-tests.log','actual-project-worker-tests.log','final-numerics-results.json','final-numerics-equivalence.json','final-acceptance-results.json','final-parity-20m.json','final-browser-validation.json','final-production-ui.json','portable-math-expanded-validation.json','devito-comparison-summary.json','next-milestone-plan.json']
};
writeFileSync(base+'morning-handoff.json',JSON.stringify(report,null,2)+'\n');
writeFileSync('../../outputs/earthforge-morning-handoff.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,rustTests:52,legacyTests:202,sourceFiles:fidelity.sourceFiles,archives:report.archives.length}));
