"""Read only audit for the frozen synthetic coordinate/transport experiment."""
import hashlib
import json
import sys
from pathlib import Path

repo, study, snapshot, baseline, output = map(Path, sys.argv[1:])

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def read(path):
    return json.loads(path.read_text())

frozen = read(snapshot)
assert all(digest(repo / p) == h for p, h in frozen.items()), 'Frozen experiment changed'
summary = read(study / 'summary.json')
plan = read(repo / 'validation/numerics/plan.json')
assert summary['plan_sha256'] == digest(repo / 'validation/numerics/plan.json')
for path, expected in summary['source_sha256'].items():
    assert digest(repo / path) == expected, path

contract = ['validation/numerics/plan.json', 'validation/numerics/metrics.mjs']
for path in contract:
    assert digest(repo / path) == digest(baseline / path), path
runner_path = 'validation/numerics/run.mjs'
before, after = (baseline / runner_path).read_text(), (repo / runner_path).read_text()
before_line = next(x for x in before.splitlines() if x.startswith('const sourceFiles ='))
after_line = before_line.replace("'src/conservativeTransport.ts',", "'src/conservativeTransport.ts', 'src/capacityTransport.ts', 'src/capacitySlices.ts', 'src/exactLength.ts', 'src/subsidence.ts',")
assert after == before.replace(before_line, after_line), 'Runner changed beyond provenance file list'

source_paths = sorted(p for p in frozen if p.startswith('src/'))
changed = [p for p in source_paths if not (baseline / p).exists() or digest(baseline / p) != frozen[p]]
assert changed == sorted(['src/basin.ts', 'src/conservativeTransport.ts', 'src/strata.ts',
    'src/capacityTransport.ts', 'src/capacitySlices.ts', 'src/exactLength.ts', 'src/subsidence.ts',
    'src/normalTransport.ts', 'src/basinVerify.ts']), changed
original_manifest = read(snapshot.parent / 'original-files.json')
assert all(digest(baseline / p) == h for p, h in original_manifest.items()), 'Original files changed during work'
adapted_test = 'tests/fractional-thrust.test.mjs'
adaptation = read(snapshot.parent / 'test-adaptation.json')
assert adaptation['original_fractional_test_sha256'] == original_manifest[adapted_test]
assert digest(repo / adapted_test) == adaptation['adapted_fractional_test_sha256']
for path in original_manifest:
    if path.startswith('tests/') and path != adapted_test:
        assert digest(repo / path) == original_manifest[path], 'An existing test changed: ' + path

expected_names = sorted(['summary.json', 'series.json'] + [f"{c['name']}-matched.json" for c in plan['cases']] +
    [f"{c['name']}-{h}m-budget.json" for c in plan['cases'] for h in plan['grids_m']])
names = sorted(p.name for p in study.iterdir() if p.suffix == '.json')
assert names == expected_names and len(names) == 50
result = {
    'schema': 'earthforge.synthetic.coordinate-source-audit.v1',
    'observational_arrays_read': False, 'synthetic_only': True,
    'frozen_snapshot_sha256': digest(snapshot), 'frozen_files_verified': len(frozen),
    'source_snapshot_unchanged': True, 'production_source_sha256': {p: frozen[p] for p in source_paths},
    'changed_production_sources': changed, 'original_files_unchanged': len(original_manifest),
    'existing_tests_unchanged_except': [adapted_test],
    'test_adaptation_sha256': digest(snapshot.parent / 'test-adaptation.json'),
    'test_adaptation': adaptation['changes'], 'unchanged_contract_files': contract,
    'runner_change': 'Only sourceFiles provenance list expanded; all simulation and measurement code identical.',
    'raw_json_sha256': {p: digest(study / p) for p in names},
    'source_checks_recorded_by_study': summary['source_sha256'],
    'audit_runner_sha256': digest(Path(__file__)),
}
output.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'verified_files': len(frozen), 'raw_results': len(names), 'changed_sources': changed}))
