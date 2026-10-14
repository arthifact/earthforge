import { build } from '/Users/torus/Desktop/Research/earthforge/node_modules/esbuild/lib/main.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { extract, compare } from '/Users/torus/Desktop/Research/earthforge/validation/numerics/metrics.mjs';
const root='/Users/torus/Desktop/Research/earthforge/', folder=new URL('./',import.meta.url).pathname, variant='coordinate-grouped';
const id=process.argv[2]??'coupled-compression-a', grids=process.argv.slice(3).map(Number);if(!grids.length)grids.push(40,20,10);
const hash=x=>createHash('sha256').update(x).digest('hex');
const manifest=JSON.parse(readFileSync(folder+'grouped-source-hashes.json'));
const verifySource=()=>{for(const [p,h]of Object.entries(manifest))if(hash(readFileSync(folder+'grouped/'+p))!==h)throw Error('Source changed during pilot: '+p);};verifySource();
const bundle=await build({entryPoints:[folder+'grouped/src/basin.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {simulate,BASIN_DEFAULTS,windowOf,layerVelocity}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].contents).toString('base64'));
const plan=JSON.parse(readFileSync(root+'validation/numerics/plan.json')),spec=plan.cases.find(x=>x.name===id),samples=[],histories=[];
if(!spec)throw Error('Unknown frozen case');
for(const h of grids){verifySource();const t=performance.now();try{
  const b=simulate({...BASIN_DEFAULTS,...spec,h,record:false}),sample=extract(b,plan,windowOf,layerVelocity);verifySource();samples.push(sample);histories.push(hash(JSON.stringify(b.historyPlan)));
  writeFileSync(folder+variant+'-'+id+'-'+h+'-sample.json',JSON.stringify(sample));
  writeFileSync(folder+variant+'-'+id+'-'+h+'-budget.json',JSON.stringify({...b.budget,transport:b.checks.transport}));
  console.log(JSON.stringify({variant,id,h,seconds:(performance.now()-t)/1000,closed:b.budget.summary.closed,max_rss_kib:process.resourceUsage().maxRSS,rss_at_completion:process.memoryUsage().rss,fallbacks:b.checks.transport.filter(t=>t.fallback),history:histories.at(-1),parts:b.columns.reduce((n,c)=>n+c.length,0),groupedParts:b.columns.reduce((n,c)=>n+c.filter(p=>p.lengths).length,0),lengthTerms:b.columns.reduce((n,c)=>n+c.reduce((s,p)=>s+(p.lengths?.length??1),0),0)}));
}catch(error){console.log(JSON.stringify({variant,id,h,error:error.message}));process.exitCode=1;break;}}
if(samples.length===3){const result=compare(samples,histories);writeFileSync(folder+variant+'-'+id+'-comparison.json',JSON.stringify(result));console.log(JSON.stringify({variant,id,metrics:result.metrics}));}
