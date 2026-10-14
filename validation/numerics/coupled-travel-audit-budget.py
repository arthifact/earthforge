import json,sys,math
from pathlib import Path
root=Path(__file__).parent
assert len(sys.argv)==3,'Usage: python audit-budget.py SYNTHETIC_STUDY OUTPUT_JSON'
study=Path(sys.argv[1]);out=Path(sys.argv[2])
plan=json.loads((study.resolve().parents[2]/'validation/numerics/plan.json').read_text())
summary=json.loads((study/'summary.json').read_text())
paths=[study/f"{c['name']}-{h}m-budget.json" for c in plan['cases'] for h in plan['grids_m']]
assert all(p.is_file() for p in paths)
materials=['sand','shale','carbonate'];components=['total']+materials;sides=['left','right','top','bottom']
count=0;max_abs=0;max_norm=0;failures=[];events=0;by_process={};runs=[]
def coordinates(inventories):
 out=[(k,) for k in components]
 n=max(len(q.get('byBed',[])) for q in inventories);out += [('byBed',j) for j in range(n)]
 for k in materials:
  n=max(len(q.get('byBedComponents',{}).get(k,[])) for q in inventories);out += [('byBedComponents',k,j) for j in range(n)]
 return out
def value(q,path):
 for k in path:
  if isinstance(k,int):q=q[k] if len(q)>k else 0
  else:q=q.get(k,0)
 return 0 if q is None else q
for p in paths:
 b=json.loads(p.read_text());assert b['summary']['closed'] and b['summary']['failedEvents']==0
 prev=b['summary']['initial'];runmax=0
 for e in b['entries']:
  assert e['before']==prev;prev=e['after'];assert e['closed'];events+=1;by_process[e['process']]=by_process.get(e['process'],0)+1
  flux=e['flux'];signed=[(flux['deposited'],1),(flux['eroded'],-1)]
  for s in sides:signed += [(flux['inflow'][s],1),(flux['outflow'][s],-1)]
  inventories=[e['before'],e['after'],e['residual'],flux['repairAdded']]+[q for q,s in signed]
  for key in coordinates(inventories):
   count+=1;before=value(e['before'],key);after=value(e['after'],key);expected=before
   for q,sign in signed:expected+=sign*value(q,key)
   residual=after-expected;scale=max(abs(before),abs(expected),abs(after));tol=1e-6+1e-10*scale;norm=abs(residual)/tol
   assert abs(residual-value(e['residual'],key))<1e-12
   assert value(flux['repairAdded'],key)==0
   max_abs=max(max_abs,abs(residual));max_norm=max(max_norm,norm);runmax=max(runmax,norm)
   if not math.isfinite(residual) or abs(residual)>tol:failures.append({'run':p.name,'step':e['step'],'process':e['process'],'component':key,'residual':residual,'tolerance':tol})
 assert prev==b['summary']['final'];runs.append({'id':b['id'],'h':b['options']['h'],'events':len(b['entries']),'worst_residual_fraction_of_tolerance':runmax})
result={'schema':'earthforge.independent-synthetic-budget-audit.v1','observational_data':'None; only frozen numerical plan, summary, and 36 synthetic budget files read.','plan_sha256':summary['plan_sha256'],'source_sha256':summary['source_sha256'],'runs':len(paths),'events':events,'scalar_balances_checked':count,'failed_scalar_balances':len(failures),'repair_added_m2':0,'tolerance':{'absolute_m2':1e-6,'relative':1e-10},'maximum_absolute_scalar_residual_m2':max_abs,'worst_residual_fraction_of_tolerance':max_norm,'by_process_events':by_process,'run_checks':runs,'failures':failures}
assert not failures
out.write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items() if k not in ['source_sha256','run_checks','by_process_events']}))
