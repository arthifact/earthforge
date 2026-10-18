"""Reproduce the complete research workflow with an installed Earth Forge package."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys

import numpy as np

from earthforge import Engine, Grid, History, load_dataset, load_npz


def main():
    parser = argparse.ArgumentParser(__doc__)
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--require-bundled', action='store_true')
    parser.add_argument('--require-vtk', action='store_true')
    args = parser.parse_args()
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=False)
    examples = Path(__file__).resolve().parent
    engine = Engine()
    if args.require_bundled and '_bin' not in engine.path.parts:
        raise RuntimeError('Expected the installed wheel to use its bundled Rust engine')

    def cli(*arguments):
        result = subprocess.run([sys.executable, '-m', 'earthforge', '--engine', str(engine.path), *map(str, arguments)], capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError(f'Earth Forge command failed: {result.stderr}')
        return json.loads(result.stdout)

    # Build one physical history, then reproduce it through the installed CLI.
    history = engine.build_history('rift-v1', seed=1001, steps=6, faults=1)
    history_path = out/'history.json'
    history_path.write_text(json.dumps(history.to_record(), allow_nan=False)+'\n')
    grid = Grid(17, 17, 101, 10, 10, 10, (4900, 4900, 400))
    generate = ['generate', '--history', history_path, '--shape', *grid.counts,
                '--spacing', *grid.spacing, '--origin', *grid.origin,
                '--tile-rays', 128, '--out', out/'volume']
    cli(*generate, '--npz', out/'model.npz', '--vti', out/'model.vti')
    volume = load_dataset(out/'volume')
    inspection = cli('inspect', out/'volume')
    assert inspection['contentSha256'] == volume.content_digest()
    cli(*generate, '--resume')
    assert load_dataset(out/'volume').content_digest() == volume.content_digest()
    restored = load_npz(out/'model.npz')
    assert restored.content_digest() == volume.content_digest()
    assert volume.fields['velocity'].dtype == np.dtype('<f8')

    valid = volume.fields['valid_material'].astype(bool)
    assert np.any(valid)
    assert np.all(np.isfinite(volume.fields['velocity']))
    np.testing.assert_array_equal(volume.fields['porosity'][valid], 1-volume.fields['grain_fraction'][valid])
    material_indices = np.argwhere(valid)
    k, j, i = material_indices[len(material_indices)//2]
    coordinates = grid.coordinates()
    point = tuple(float(coordinates[a][n]) for a, n in zip('xyz', (i, j, k)))
    assert engine.points(history, [point])[0]['velocity'] == volume.fields['velocity'][k, j, i]

    # VTK is also the reader used by ParaView: verify layout and every 3D field.
    try:
        from vtkmodules.vtkIOXML import vtkXMLImageDataReader
        from vtkmodules.util.numpy_support import vtk_to_numpy
    except ImportError:
        if args.require_vtk:
            raise RuntimeError('Install vtk==9.5.2 for the required independent-reader check')
        vtk_result = 'not-installed'
    else:
        reader = vtkXMLImageDataReader()
        reader.SetFileName(str(out/'model.vti'))
        reader.Update()
        data = reader.GetOutput()
        assert reader.GetErrorCode() == 0
        assert data.GetDimensions() == grid.counts
        assert data.GetOrigin() == grid.origin and data.GetSpacing() == grid.spacing
        fields = []
        for name, array in volume.fields.items():
            if array.ndim == 3:
                np.testing.assert_array_equal(vtk_to_numpy(data.GetPointData().GetArray(name)).reshape(grid.shape), array)
                fields.append(name)
        vtk_result = {'allPointFieldsExact': fields}

    # Synthetic truth is intentionally in the finite library; this is a software check.
    cli('ensemble', examples/'rift-study.json', '--out', out/'study')
    cli('ensemble', examples/'rift-study.json', '--out', out/'study', '--resume')
    study = json.loads((out/'study/ensemble.json').read_text())
    assert study['state'] == 'complete' and study['failures'] == 0
    ids = [c['id'] for c in study['identity']['plan']['candidates']]
    histories = [History.load(out/'study'/name/'history.json') for name in ids]
    points = [(4950, 4950, 800), (5000, 5000, 1000), (5050, 5050, 1200)]
    predictions = engine.points(histories[0], points)
    observations = [dict(kind='velocity', id=str(n), x=p[0], y=p[1], z=p[2], value=v['velocity'], sigma=100)
                    for n, (p, v) in enumerate(zip(points, predictions))]
    obs = out/'synthetic-observations.json'
    obs.write_text(json.dumps({'schema':'earthforge-observations-v1', 'observations':observations})+'\n')
    cli('condition', obs, *[out/'study'/name/'history.json' for name in ids], '--out', out/'conditioning.json')
    weights = json.loads((out/'conditioning.json').read_text())
    assert abs(sum(weights['weights'])-1) < 1e-12
    assert weights['weights'][0] >= max(weights['weights'])-1e-14

    cli('shot', out/'volume', '--source', 4980, 4980, 600, '--receiver', 4990, 4980, 600,
        '--frequency', 6, '--duration', .4, '--sponge-cells', 4, '--out', out/'paired-shot.npz')
    with np.load(out/'paired-shot.npz', allow_pickle=False) as shot:
        np.testing.assert_array_equal(shot['velocity'], volume.fields['velocity'])
        assert shot['traces'].shape[0] == 1 and np.any(shot['traces'] != 0)
        shot_shape = list(shot['traces'].shape)

    # The captured browser request is independent of these newly generated recipes.
    artifact = json.loads((examples/'browser-export-908054.json').read_text())
    browser = engine.sample(History.from_record(artifact), Grid.from_dict(artifact['request']['query']['grid']))
    display = hashlib.sha256()
    for name, dtype in [('velocity','<f4'), ('beds','<i4'), ('lithology','<f4'), ('surface','<f4'), ('basement','<f4')]:
        display.update(browser.fields[name].astype(dtype).tobytes())
    assert display.hexdigest() == artifact['calculation']['displaySha256']

    report = {'schema':'earthforge-research-workflow-validation-v1', 'allChecksPassed':True,
              'usesBundledEngine':'_bin' in engine.path.parts, 'engineSha256':engine.sha256,
              'numpyVersion':np.__version__, 'grid':grid.to_dict(), 'arrayOrder':'z,y,x; x fastest; nodal; metres; z positive down',
              'contentSha256':volume.content_digest(), 'datasetResumeExact':True, 'npzRoundtripExact':True,
              'independentVTKReader':vtk_result, 'materialNodes':int(np.count_nonzero(valid)),
              'velocityRangeMetresPerSecond':[float(volume.fields['velocity'].min()),float(volume.fields['velocity'].max())],
              'sixMemberStudyAndResume':True, 'syntheticConditioningESS':weights['effectiveSampleSize'],
              'pairedShotShape':shot_shape, 'browserExportDisplaySha256':display.hexdigest(),
              'browserExportExactlyReproduced':True, 'observationalDataUsed':False,
              'scope':'Software interoperability and synthetic sanity checks; no independent field validity or calibrated posterior coverage claim.'}
    (out/'verification.json').write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
