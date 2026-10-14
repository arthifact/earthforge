// Read-only paired analysis of the frozen synthetic numerical studies.
// Waits must happen outside this script. It refuses an incomplete candidate.
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
// Usage: node compare-study.mjs CANDIDATE_STUDY CURRENT_STUDY PRIOR_STUDY OUTPUT_DIRECTORY
const [candidate,currentStudy,priorStudy,outDirectory,outputPrefix=""]=process.argv.slice(2);
assert(candidate&&currentStudy&&priorStudy&&outDirectory,'Provide candidate/current/prior synthetic study directories and an existing output directory');
const here=resolve(outDirectory),candidateRepo=resolve(candidate,'../../..');
const baselines={current:currentStudy,prior:priorStudy};
const metricPath=resolve(candidateRepo,'validation/numerics/metrics.mjs');
const {compare,summarize}=await import(pathToFileURL(metricPath));
const json=async p=>JSON.parse(await readFile(p,'utf8')),hash=v=>createHash('sha256').update(v).digest('hex');
const plan=await json(resolve(candidateRepo,'validation/numerics/plan.json')),planHash=hash(await readFile(resolve(candidateRepo,'validation/numerics/plan.json')));
const metricHash=hash(await readFile(metricPath));
const metrics=['thickness_m','vertical_travel_time_s','effective_velocity_m_s','fault_depth_m'];
const key=r=>`${r.key}|${r.metric}`,rms=q=>Math.sqrt(q.reduce((s,n)=>s+n*n,0)/q.length);
async function loadStudy(root){
 const names=await readdir(root),expected=plan.cases.flatMap(c=>plan.grids_m.map(h=>`${c.name}-${h}m-budget.json`));
 assert(expected.every(p=>names.includes(p)),'All36 expected budget files must exist before report');
 assert(names.includes('summary.json'),'Study summary is not complete');
 const summary=await json(resolve(root,'summary.json'));
 assert.equal(summary.plan_sha256,planHash);assert.equal(summary.source_sha256['validation/numerics/metrics.mjs'],metricHash);
 assert.deepEqual(summary.grids_m,plan.grids_m);assert.deepEqual(summary.cases.map(c=>c.id),plan.cases.map(c=>c.name));
 const detail={};for(const c of summary.cases){const d=await json(resolve(root,`${c.id}-matched.json`));const budgets=[];for(const h of plan.grids_m){const b=await json(resolve(root,`${c.id}-${h}m-budget.json`));assert.equal(b.history_hash,d.history_hash);assert.equal(b.options.h,h);assert(b.summary.closed);assert.equal(b.summary.failedEvents,0);assert.equal(b.summary.flux.repairAdded.total,0);budgets.push({h,options:b.options,history_hash:b.history_hash,entries:b.entries.length,closed:b.summary.closed,repair_added:b.summary.flux.repairAdded.total});}const recomputed=compare(d.samples,budgets.map(b=>b.history_hash));for(const name of ['coverage','fieldCoverage','series','metrics'])assert.deepEqual(d[name],recomputed[name],`Stored ${c.id}/${name} differs from unchanged metric code`);assert.deepEqual(c.metrics,d.metrics);detail[c.id]={...d,budgets};}
 return{root,summary,detail};
}
const cand=await loadStudy(candidate);
for(const [label,path]of Object.entries(baselines)){
 const old=await loadStudy(path),beforeSeries=[],afterSeries=[],cases=[];let coverageBefore=0,coverageAfter=0,sharedTotal=0;
 for(const spec of plan.cases){const id=spec.name,a=old.detail[id],b=cand.detail[id];assert.equal(a.history_hash,b.history_hash);assert.deepEqual(a.budgets.map(q=>q.options),b.budgets.map(q=>q.options));const am=new Map(a.series.map(r=>[key(r),r])),bm=new Map(b.series.map(r=>[key(r),r]));const seriesBefore=[],seriesAfter=[],regressionRows={};
  for(const[k,r]of am)if(bm.has(k)){const s=bm.get(k);seriesBefore.push({...r,case:id});seriesAfter.push({...s,case:id});}
  beforeSeries.push(...seriesBefore);afterSeries.push(...seriesAfter);
  const ca=new Map(a.coverage.map(r=>[r.key,r])),cb=new Map(b.coverage.map(r=>[r.key,r]));const shared=[...ca.keys()].filter(k=>ca.get(k).included&&cb.get(k)?.included);const lost=[...ca.keys()].filter(k=>ca.get(k).included&&!cb.get(k)?.included).map(k=>({key:k,before:ca.get(k),after:cb.get(k)}));const gained=[...cb.keys()].filter(k=>cb.get(k).included&&!ca.get(k)?.included).map(k=>({key:k,before:ca.get(k),after:cb.get(k)}));
  const fcA=new Map(a.fieldCoverage.map(r=>[r.key,r])),fcB=new Map(b.fieldCoverage.map(r=>[r.key,r]));const fieldsLost=[...fcA.keys()].filter(k=>fcA.get(k).included&&!fcB.get(k)?.included).map(k=>({key:k,before:fcA.get(k),after:fcB.get(k)}));const fieldsGained=[...fcB.keys()].filter(k=>fcB.get(k).included&&!fcA.get(k)?.included).map(k=>({key:k,before:fcA.get(k),after:fcB.get(k)}));
  const paired=Object.fromEntries(metrics.map(m=>{const aa=seriesBefore.filter(r=>r.metric===m),bb=seriesAfter.filter(r=>r.metric===m);return[m,{before:summarize(aa),after:summarize(bb)}];}));
  for(const m of metrics)regressionRows[m]=seriesBefore.filter(r=>r.metric===m).map(r=>{const s=bm.get(key(r));return{key:r.key,before:r.values,after:s.values,before_fine:r.fine,after_fine:s.fine,before_coarse:r.coarse,after_coarse:s.coarse,change_fine_squared:s.fine*s.fine-r.fine*r.fine,change_coarse_squared:s.coarse*s.coarse-r.coarse*r.coarse};}).sort((a,b)=>b.change_fine_squared-a.change_fine_squared).slice(0,5);
  const floors=plan.grids_m.map((h,j)=>{const aa=new Map(a.samples[j].fields.filter(r=>r.metric==='seafloor_m').map(r=>[r.key,r.value])),bb=b.samples[j].fields.filter(r=>r.metric==='seafloor_m').map(r=>({key:r.key,before_m:aa.get(r.key),after_m:r.value,change_m:r.value-aa.get(r.key)}));return{h,change_rms_m:rms(bb.map(r=>r.change_m)),maximum_absolute_change_m:Math.max(...bb.map(r=>Math.abs(r.change_m))),profiles:bb};});
  const beforeCount=a.coverage.filter(c=>c.included).length,afterCount=b.coverage.filter(c=>c.included).length;coverageBefore+=beforeCount;coverageAfter+=afterCount;sharedTotal+=shared.length;
  cases.push({id,history_sha256:a.history_hash,coverage:{candidates:a.coverage.length,before_matched:beforeCount,after_matched:afterCount,shared_intervals:shared.length,lost,gained,fields_lost:fieldsLost,fields_gained:fieldsGained},paired_metrics:paired,exclusive_cohort_metrics:{lost_before:Object.fromEntries(metrics.map(m=>[m,summarize(a.series.filter(r=>r.metric===m&&lost.some(c=>c.key===r.key)))])),gained_after:Object.fromEntries(metrics.map(m=>[m,summarize(b.series.filter(r=>r.metric===m&&gained.some(c=>c.key===r.key)))]))},whole_cohort_metrics:{before:a.metrics,after:b.metrics},largest_fine_regression_rows:regressionRows,absolute_seafloor_changes:floors});
 }
 const aggregate=(ids)=>Object.fromEntries(metrics.map(m=>[m,{before:summarize(beforeSeries.filter(r=>r.metric===m&&(!ids||ids.has(r.case)))),after:summarize(afterSeries.filter(r=>r.metric===m&&(!ids||ids.has(r.case))))}]));
 const affected=new Set(plan.cases.filter(c=>c.setting==='compression').map(c=>c.name));const allPairs=aggregate();const changes=cases.flatMap(c=>metrics.flatMap(m=>['coarse','fine'].flatMap(scale=>{const a=c.paired_metrics[m].before[`${scale}_rms`],b=c.paired_metrics[m].after[`${scale}_rms`];return b>a+1e-10?[{case:c.id,metric:m,scale,before:a,after:b,percent_change:a?100*(b/a-1):null}]:[];})));
 const unchanged=cases.filter(c=>JSON.stringify(old.detail[c.id].samples)===JSON.stringify(cand.detail[c.id].samples)).map(c=>c.id);
 const report={version:1,baseline:label,before:path,after:candidate,observational_data:'none; synthetic numerical studies only',plan_sha256:planHash,unchanged_metrics_sha256:metricHash,source_sha256:{before:old.summary.source_sha256,after:cand.summary.source_sha256},metric_and_eligibility_verification:'Recomputed every stored series/coverage/metric directly from samples using unchanged metrics.mjs; exact equality verified.',coverage:{candidates:cases.reduce((n,c)=>n+c.coverage.candidates,0),before_matched:coverageBefore,after_matched:coverageAfter,shared_intervals:sharedTotal},paired_metrics:allPairs,compression_only_paired_metrics:aggregate(affected),whole_cohort_metrics:{before:old.summary.metrics,after:cand.summary.metrics},unchanged_cases:unchanged,case_scale_rms_regressions:changes,display_regression_threshold_native_units:1e-10,cases,allocation_surface_offsets:'Not stored by the frozen comparison. Absolute seafloor values are provided; physical-vs-storage offsets require separate diagnostics.'};
 const allMetricCases=plan.cases.map(spec=>{
  const id=spec.name,a=old.detail[id],b=cand.detail[id],am=new Map(a.series.map(r=>[key(r),r])),bm=new Map(b.series.map(r=>[key(r),r]));
  const shared=[...am.keys()].filter(k=>bm.has(k));const names=[...new Set([...a.series,...b.series].map(r=>r.metric))].sort();
  return {case:id,metrics:names.map(metric=>{
   const aa=shared.map(k=>am.get(k)).filter(r=>r.metric===metric),bb=shared.map(k=>bm.get(k)).filter(r=>r.metric===metric),before=summarize(aa),after=summarize(bb);
   return {metric,shared_n:aa.length,before_whole_n:a.series.filter(r=>r.metric===metric).length,after_whole_n:b.series.filter(r=>r.metric===metric).length,before,after};
  })};
 });
 const allMetricIncreases=allMetricCases.flatMap(c=>c.metrics.flatMap(q=>['coarse','fine'].flatMap(scale=>{
  const a=q.before[`${scale}_rms`],b=q.after[`${scale}_rms`];return b>a+1e-10?[{case:c.case,metric:q.metric,scale,n:q.shared_n,before:a,after:b,absolute_increase:b-a,percent_increase:a?100*(b/a-1):null,headline_metric:metrics.includes(q.metric)}]:[];
 })));
 const budgetIdentity=[];
 for(const spec of plan.cases.filter(c=>c.setting!=='compression'))for(const h of plan.grids_m){
  const name=`${spec.name}-${h}m-budget.json`,a=await readFile(resolve(path,name)),b=await readFile(resolve(candidate,name));let parsedEqual=true;try{assert.deepEqual(JSON.parse(a),JSON.parse(b));}catch{parsedEqual=false;}
  budgetIdentity.push({case:spec.name,h,file:name,byte_equal:a.equals(b),parsed_equal:parsedEqual,before_sha256:hash(a),after_sha256:hash(b)});
 }
 const expandedReport={baseline:label,plan_sha256:planHash,unchanged_metrics_sha256:metricHash,cohort:'Per-case identical shared key and metric; every recorded series metric included, native units retained',display_increase_threshold_native_units:1e-10,all_recorded_metric_names:[...new Set(allMetricCases.flatMap(c=>c.metrics.map(q=>q.metric)))].sort(),increase_counts:{all:allMetricIncreases.length,headline:allMetricIncreases.filter(r=>r.headline_metric).length,other:allMetricIncreases.filter(r=>!r.headline_metric).length},all_case_scale_rms_increases:allMetricIncreases,cases:allMetricCases,noncompression_budget_identity:{expected_files:21,checked_files:budgetIdentity.length,byte_equal:budgetIdentity.filter(r=>r.byte_equal).length,parsed_equal:budgetIdentity.filter(r=>r.parsed_equal).length,files:budgetIdentity}};
 await writeFile(resolve(here,`${outputPrefix}candidate-vs-${label}-all-metrics-audit.json`),JSON.stringify(expandedReport,null,2)+'\n');
 console.log(JSON.stringify({baseline:label,expanded_increases:expandedReport.increase_counts,unchanged_budget_files:expandedReport.noncompression_budget_identity.parsed_equal}));
 assert.equal(budgetIdentity.length,21);assert(budgetIdentity.every(r=>r.parsed_equal),'Unaffected budget differs; inspect expanded audit');
 const out=resolve(here,`${outputPrefix}candidate-vs-${label}-report.json`);await writeFile(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({baseline:label,coverage:report.coverage,paired:allPairs,regressions:changes,unchanged_cases:unchanged,output:out},null,2));
}


// A single shared cohort across the pre-weighting, weighted baseline, and candidate revisions.
const tripleLabels=['prior_unweighted','current_weighted','candidate'];
const tripleStudies=[await loadStudy(baselines.prior),await loadStudy(baselines.current),cand];
const allTravel=tripleLabels.map(()=>[]),tripleCases=[];
for(const id of plan.cases.map(c=>c.name)){
 const maps=tripleStudies.map(s=>new Map(s.detail[id].series.map(r=>[key(r),r])));
 const keys=[...maps[0].keys()].filter(k=>maps.every(m=>m.has(k)));
 for(let j=0;j<3;j++)allTravel[j].push(...keys.map(k=>maps[j].get(k)).filter(r=>r.metric==='vertical_travel_time_s'));
 if(!['coupled-compression-a','thrust-b'].includes(id))continue;
 const tripleMetrics=Object.fromEntries(metrics.map(metric=>[metric,Object.fromEntries(tripleLabels.map((label,j)=>[label,summarize(keys.map(k=>maps[j].get(k)).filter(r=>r.metric===metric))]))]));
 tripleCases.push({case:id,coverage:tripleStudies.map((s,j)=>({label:tripleLabels[j],eligible_intervals:s.detail[id].coverage.filter(c=>c.included).length})),shared_intervals:keys.filter(k=>k.endsWith('|thickness_m')).length,shared_profiles:keys.filter(k=>k.endsWith('|vertical_travel_time_s')).length,paired_metrics:tripleMetrics});
}
const tripleReport={observational_data:'none; synthetic numerical studies only',cohort:'Identical intersection of key and metric across all three revisions; existing eligibility unchanged',plan_sha256:planHash,metrics_sha256:metricHash,roots:Object.fromEntries(tripleLabels.map((label,j)=>[label,tripleStudies[j].root])),all_common_travel_metrics:Object.fromEntries(tripleLabels.map((label,j)=>[label,summarize(allTravel[j])])),cases:tripleCases};
await writeFile(resolve(here,`${outputPrefix}three-way-recovery-report.json`),JSON.stringify(tripleReport,null,2)+'\n');
console.log(JSON.stringify({three_way:tripleReport}));
