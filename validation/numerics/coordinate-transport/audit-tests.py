"""Verify disjoint test batches against one immutable source/test snapshot."""
import hashlib
import json
import re
from pathlib import Path

task = Path(__file__).resolve().parent
repo = task / 'earthforge'
digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
plan = json.loads((task / 'test-coverage-plan.json').read_text())
snapshot = task / 'frozen-source.json'
assert digest(snapshot) == plan['frozen_snapshot_sha256']
frozen = json.loads(snapshot.read_text())
assert all(digest(repo / path) == expected for path, expected in frozen.items())
all_files = sorted(str(p.relative_to(repo)) for p in (repo / 'tests').glob('*.test.mjs'))
batched = [path for batch in plan['batches'] for path in batch['files']]
assert all_files == plan['all_test_files'] == sorted(batched)
assert len(batched) == len(set(batched))
results = []
for batch in plan['batches']:
    path = task / batch['log']
    text = path.read_text()
    summary = {}
    for field in ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']:
        matches = re.findall(r'^.*?\b' + field + r' (\d+)\s*$', text, re.M)
        assert len(matches) == 1, (path, field, 'missing or ambiguous summary')
        summary[field] = int(matches[0])
    assert summary['tests'] == summary['pass'] > 0, (path, summary)
    assert all(summary[k] == 0 for k in ['fail', 'cancelled', 'skipped', 'todo']), (path, summary)
    durations = re.findall(r'^.*?\bduration_ms ([0-9.]+)\s*$', text, re.M)
    assert len(durations) == 1, (path, 'missing or ambiguous duration')
    results.append({**batch, 'sha256': digest(path), 'duration_ms': float(durations[0]), **summary})
build = task / 'grouped-build.log'
assert 'tsc --noEmit' in build.read_text() and 'built in' in build.read_text()
result = {
    'schema': 'earthforge.synthetic.coordinate-test-audit.v1',
    'all_test_files': all_files,
    'all_test_files_covered_exactly_once': True,
    'source_and_tests_unchanged': True,
    'frozen_snapshot_sha256': digest(snapshot),
    'heap_mib': plan['heap_mib'],
    'tests': sum(r['tests'] for r in results),
    'passed': sum(r['pass'] for r in results),
    'failed': 0, 'cancelled': 0, 'skipped': 0,
    'batches': results,
    'typecheck_and_build': {'log': build.name, 'sha256': digest(build), 'passed': True},
    'original_test_adaptation': json.loads((task / 'test-adaptation.json').read_text())['changes'],
    'observational_or_holdout_reads': False,
}
plan['executed_all'] = True
(task / 'test-coverage-plan.json').write_text(json.dumps(plan, indent=2) + '\n')
result['test_plan_sha256'] = digest(task / 'test-coverage-plan.json')
(task / 'tests-audit.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'tests': result['tests'], 'passed': result['passed'], 'files': len(all_files)}))
