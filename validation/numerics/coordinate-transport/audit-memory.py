"""Audit the isolated fixed-source C10 resource check without changing the study."""
from pathlib import Path
import hashlib
import json

task=Path(__file__).resolve().parent
screen=task.parent/'coarse-travel-transport/grouped-c10-4096'
digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
read=lambda p:json.loads(p.read_text())
manifest=read(screen/'grouped-source-hashes.json')
frozen=read(task/'frozen-source.json')
assert len(manifest)==20
assert all(frozen[p]==h and digest(screen/'grouped'/p)==h for p,h in manifest.items())
for name in ['validation/numerics/plan.json','validation/numerics/metrics.mjs']:
    assert digest(Path('/Users/torus/Desktop/Research/earthforge')/name)==frozen[name]
receipt=read(screen/'launch-receipt.json')
assert receipt['exit_code']==0 and receipt['session_id']==11917
assert receipt['argv']==['node','--max-old-space-size=4096','work/coarse-travel-transport/grouped-c10-4096/coordinate-grouped-pilot.mjs','coupled-compression-c','10']
assert receipt['launched_after_test_session_43309_exit_0']
assert receipt['test_audit_sha256']==digest(task/'tests-audit.json')
lines=[json.loads(line) for line in (screen/'run.log').read_text().splitlines() if line.startswith('{')]
assert len(lines)==1
run=lines[0]
assert run['id']=='coupled-compression-c' and run['h']==10 and run['closed'] is True
assert run['parts']==718285 and not run['fallbacks']
assert run['history']=='9b7be4934356709818bd62fcd2138e7e766e08dbf89cf3f53d9a954a6eee9c5b'
prefix='coordinate-grouped-coupled-compression-c-10-'
samples_equal=(screen/(prefix+'sample.json')).read_bytes()==(screen.parent/(prefix+'sample.json')).read_bytes()
budget_equal=(screen/(prefix+'budget.json')).read_bytes()==(screen.parent/(prefix+'budget.json')).read_bytes()
assert samples_equal and budget_equal
budget=read(screen/(prefix+'budget.json'))
formal=read(task/'earthforge/data/numerics/coordinate-transport-repair/coupled-compression-c-10m-budget.json')
assert all(formal[key]==value for key,value in budget.items())
result={'schema':'earthforge.synthetic.c10-resource-check.v1','passed':True,'requested_old_space_limit_mib':4096,
        'single_grid_in_fresh_process':True,'concurrent_simulation_test_runs':False,'run':run,
        'source_manifest_sha256':digest(screen/'grouped-source-hashes.json'),'source_files_verified':len(manifest),
        'all_samples_byte_identical_to_8192_mib_screen':samples_equal,
        'all_budgets_byte_identical_to_8192_mib_screen':budget_equal,
        'budget_identical_to_formal_36_case_study':True,
        'evidence_sha256':{name:digest(screen/name) for name in ['launch-receipt.json','run.log','coordinate-grouped-pilot.mjs','grouped-source-hashes.json',prefix+'sample.json',prefix+'budget.json']},
        'limitations':['A single synthetic C10 run, not a full-suite-at-4096MiB guarantee.','RSS is total resident process memory, not JavaScript old-space usage.','No controlled speed comparison or browser responsiveness claim.'],
        'holdout_or_observational_reads':False}
(task/'memory-audit.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
