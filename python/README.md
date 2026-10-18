# Earth Forge research API — 0.2.0a1

Generate reproducible geological-history velocity models using the same Rust
physics core as the Earth Forge app. Python orchestrates experiments and exports;
it does not implement a second simulation engine. This is a local research alpha.
Independent field accuracy and superiority over other generators are unestablished.

## Install

A platform wheel built by `scripts/build-research-wheel.py` includes the native
engine. Install that wheel with `python -m pip install /path/to/the.whl`, then run
`earthforge doctor`. Python 3.10+ and NumPy 2.x are required; neither Rust nor
Node is required to use a bundled wheel. Each wheel targets its build platform;
it is not a universal native binary.

For source development, from the repository root:

```sh
cargo build --locked --release
python -m pip install -e ./python
earthforge doctor
```

The engine is resolved from an explicit `--engine`/`Engine(path=...)`, then
`EARTHFORGE_ENGINE`, a bundled binary, `earthforge-engine` on PATH, or this
source checkout's release build. The `earthforge` command is the Python client;
the native binary accepts one JSON request on stdin.

Earth Forge uses the [MIT license](LICENSE). Bundled wheels include the project
license and third-party notices; dependencies retain their respective licenses.
Research citation authorship remains to be finalized. Nothing is uploaded by
these commands.

## Generate and export

```python
from earthforge import Engine, Grid, Parameters, load_dataset

engine = Engine()
history = engine.build_history(
    "rift-v1", seed=1001,
    parameters=Parameters(slip_scale=1.2, facies_shift_m=200),
)
# A 320 × 320 × 2,000 m research crop at 10 m spacing, endpoints included.
grid = Grid(33, 33, 201, 10, 10, 10, (4800, 4800, 500))
engine.export_dataset(history, grid, "rift-model")
volume = load_dataset("rift-model")  # Read-only, disk-backed arrays.
volume.save_npz("rift-model.npz")
volume.save_vti("rift-model.vti")    # ParaView/VTK ImageData and JSON sidecar.
```

```sh
earthforge scenarios
earthforge generate --scenario rift-v1 --seed 1001 \
  --shape 33 33 201 --spacing 10 10 10 --origin 4800 4800 500 \
  --out rift-model --npz rift-model.npz --vti rift-model.vti
earthforge inspect rift-model
```

`rift-v1`, `reverse-fault-v1` and `erosion-reburial-v1` are versioned families
of the supported detailed recipe, not three independent physics engines. The
reverse-fault recipe is not a balanced fold-and-thrust model. Erosion, pressure
and fault motion are prescribed; compaction is vertical and drained. Faults
bend along strike, not in dip. There is no stress equilibrium, fluid-flow,
salt-dynamics or field-calibrated uncertainty solver.

The default 33 × 33 × 161 output is a coarse, 10 × 10 × 3 km preview. It is
not a 10 m field-scale volume. A 10 m output crop is also distinct from a
10 m material subdivision. Material refinement is `material_step` and requires
a convergence study; output refinement never changes the physical history.

## Array and coordinate contract

All spatial inputs are Cartesian metres with **z positive down**. No geographic
CRS is inferred. `Grid(nx, ny, nz, dx, dy, dz, origin)` specifies nodal samples,
including both endpoints. NumPy arrays have shape **(nz, ny, nx)**, C order,
with x varying fastest. VTI uses this same ordering and world coordinates.

Exports retain Rust's binary64 samples. Bed labels are int32; validity is uint8.
Fields include velocity (m/s), sand/grain fractions, porosity, maximum burial,
maximum effective-loading depth (m), bed identity, encoded lithology, surface
and basement. `valid_material == 1` identifies sediment/carbonate. State values
outside material are placeholders; derived porosity is NaN there. `lithology`
uses sand fraction for clastics and -1/-2/-3 for water/basement/carbonate;
`sand_fraction` is the separate carried composition value.

NPZ files contain ordinary non-object NumPy arrays and Unicode JSON metadata;
load with `allow_pickle=False`. NPY datasets support memory mapping. VTI contains
3D point fields; the 2D surface/basement arrays remain in NPZ/NPY. Standalone tiles retain their exact global coordinates in NPZ; VTI
rejects a re-based tile if its affine coordinates would change through rounding.
Export the assembled parent grid as VTI in that case. Metadata records
source history, scenario/seed/parameters, units, grid, stage, engine binary hash,
runtime, physical assumptions and per-array fingerprints.

## Large volumes and resume

```sh
earthforge generate --history exported-from-app.json --out reproduced
# Repeat an interrupted job with the exact same configuration:
earthforge generate --history exported-from-app.json --out reproduced --resume
```

The browser JSON's source, stage and grid are preserved unless grid options are
explicitly supplied. Other history records use the requested/default grid.
Source histories can be sampled on new grids without creating different geology.

Exports use globally indexed tiles: every coordinate is computed as
`original_origin + global_index * spacing`. Re-basing tile origins can introduce
rounding differences at interfaces; this implementation preserves the original
coordinates exactly. Native requests stay below ray/point budgets. Tiles flush
before their completion fingerprints are committed. Resume verifies the model,
grid, engine, tile plan and completed arrays; it refuses modified results.
OS locks prevent concurrent writers and release automatically after crashes.

Array storage is checked before writing (default limit 2 GiB; override explicitly
with `--max-output-gib`). Tiling bounds request memory, not total compute or
storage. Whole field-scale f64 exports can require tens of GiB. NPZ compression
and VTI encoding add work/storage and are not included in geological timings.

## Ensembles and explicit uncertainty

```python
from earthforge import EnsemblePlan, run_ensemble

plan = EnsemblePlan(
    scenario="rift-v1", count=8, seed=1001,
    priors={"slip_scale": [0.7, 1.4], "sediment_supply_scale": [0.8, 1.2]},
    options={"steps": 12, "faults": 2},
)
result = run_ensemble(engine, plan, grid, "rift-study")
# Resume checks completed outputs and retries failed/incomplete members.
result = run_ensemble(engine, plan, grid, "rift-study", resume=True)
```

Use `earthforge ensemble examples/research/rift-study.json --out study` from
the checkout for a small example. Candidates and their uniform parameter draws
are frozen in `ensemble.json`; the versioned 53-bit counter sampler is independent
of NumPy RNG versions. Recipe seeds are separately hashed across the full nonzero
32-bit range, with collisions rejected; consecutive xorshift recipe seeds would
otherwise give correlated early recipe parameters. All jobs are sequential by default; each native request
can use Rayon. `--threads` controls native threading. Failed members are retained
in the report and cause a nonzero CLI status; they are not silently discarded.

## Wells and horizon conditioning

```python
from earthforge import condition_histories

observations = [
    {"id": "well-1", "kind": "velocity", "x": 5000, "y": 5000,
     "z": 1200, "value": 2500, "sigma": 150},
    {"id": "contact-1", "kind": "horizon", "x": 5000, "y": 5000,
     "bed": 20, "side": "top", "value": 1400, "sigma": 100},
]
weighted = condition_histories(engine, histories, observations)
print(weighted["weights"], weighted["effectiveSampleSize"])
```

Observation kinds are `velocity`, `surface`, `basement` and `horizon`. Queries
use the continuous model, not display voxels. `sigma` is a caller-specified
combined observation/model-discrepancy standard deviation; errors are assumed
independent Gaussian. Well-log correlation is not estimated automatically.
Horizon `bed` is a generated bed index, not a universal formation name.
Alternatively, `unit` selects a depositional-cycle index and merges adjacent
sub-beds of that cycle; this aligns packages across seeds with different sub-bed
counts. Supply exactly one selector. Map real formation names/ages explicitly.
All contiguous occurrences are reported, shallowest first. Supply `occurrence`
to identify a branch, or omit it to use a **normalized equal-weight Gaussian
mixture** over all occurrences. Missing contacts receive zero likelihood.

Weights apply to the supplied finite candidate library and its stated prior.
They do not establish calibrated credible intervals, geological identifiability,
or real-data inversion success. Small effective sample size calls for better
candidate coverage. All-zero likelihoods are reported explicitly. Surface-shot
first-arrival conditioning and a general inverse solver are future work.

## Paired seismic data

```python
from earthforge import acoustic_shot

shot = acoustic_shot(engine, volume, source=(4900, 4900, 600),
    receivers=[(5000, 4900, 600)], frequency_hz=6,
    duration_seconds=0.4, sponge_cells=8)
shot.save_npz("paired-shot.npz")
```

The existing Rust solver supports genuine 3D shots and 2D when `ny == 1`.
CFL, dominant-wavelength and work limits remain enforced. Choose acquisition
within your sampled volume. Paired NPZ stores velocity, receiver-major traces,
times, source/receiver coordinates and solver/source provenance. Trace amplitudes
are source-normalized, not calibrated pressure. The solver is constant-density,
isotropic acoustics, with an absorbing sponge, no free surface or PML; it does
not model elasticity, attenuation or anisotropy.

## Verification

```sh
cargo test --locked --release
python -m unittest discover -s python/tests -v
```

Tests cover independent analytical layers, native point ownership, exact tiled
fields, all bed-contact occurrences, NumPy and VTK roundtrips, interrupted jobs,
tamper detection, job locks, failure recovery, analytic likelihood/weight/ESS
checks and paired seismic artifacts. Installing `vtk==9.5.2` enables the separate
external-reader test. Cross-platform CI configuration is included; local results
do not imply that unrun OS jobs passed. See `validation/research-release/` for
the saved evidence and comparison protocol.
