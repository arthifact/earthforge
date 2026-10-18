# Curved 3D faults and observation conditioning

The current source adds three versioned scenarios: `listric-rift-v1`,
`listric-reverse-v1` and `listric-reburial-v1`. The older scenarios and their
source histories remain unchanged. Both 2D sections and the 3D block query the
same new source model; display sampling does not change the physical history.

## Curved fault model

A listric fault flattens down dip. The new geometry also retains the existing
along-strike bend and supports oblique 3D slip. The Model panel exposes
flattening strength, bend length, reference dip and slip multiplier. Reference
dip is measured at the origin of the fault's curve, not everywhere on its
surface. Zero dip curvature reduces to the existing swept-fault geometry;
zero curvature and zero strike bend reduce to a planar fault.

For reference coordinates `r = (x - bend(y), y)`, let `s` measure horizontal
distance down dip and `m = |n_horizontal| / n_z`. The vertical shear is

```
h(s) = -m c (sqrt(L² + s²) - L)
H(x,y,z) = (r.x, r.y, z - h(s))
```

Here `0 <= c <= 0.95` controls flattening and positive `L` is the transition
length in metres. The curve's slope is `m(1 - c s/sqrt(L²+s²))`, positive and
bounded, decreasing down dip. The implementation rationalizes the square-root
difference to avoid cancellation near the curve origin.

Each horizontal/vertical shear and its inverse has determinant one. Conjugating
a tangential planar slip by `H` therefore gives an invertible moving-branch
map with determinant one. Tangential reference slip preserves fault side, so
the two half-spaces do not introduce gaps or overlapping material. Vertical
source rays remain vertical, allowing the existing exact interval evaluator to
carry bed identity, composition, solid fraction and material memories. Bounds
use a global Lipschitz limit on the extra vertical displacement; unsupported
pruning locations use both branches.

This is a **prescribed kinematic model**. It does not solve stresses, frictional
contact, force-driven fault propagation or balanced fold-and-thrust mechanics.
Compaction remains vertical, drained and quasistatic. The displayed window is
open to regional material continuation; local grain checks are not an exact
closed-window inventory.

The use of inverse, time-ordered fault operators is consistent with the broad
modeling framework discussed by [Grose et al. (2021)](https://gmd.copernicus.org/articles/14/6197/2021/).
Earth Forge's analytical shear map is its own restricted geometry, not an
implementation of LoopStructural's interpolated fault-frame method or a claim
of its geological coverage.

## Well and horizon constraints in the app

1. Choose a basin and history stage. Open **Data**.
2. Add well velocities or horizon/surface/basement depths. UI locations are in
   kilometres; imported JSON uses metres. Depth is positive down in a local
   Cartesian coordinate system; no geographic CRS is inferred.
3. Specify uncertainty, including measurement error and model discrepancy.
   Horizon episodes start at 1 in the UI and become zero-based `unit` indices
   in the API. A JSON observation can instead select a zero-based `bed`.
4. Compare an explicit grid of slip/subsidence or slip/curvature parameters.
   The browser supports up to 64 candidates and 128 observations. The current
   shared native conditioning request supports 64 candidates and 1024
   observations; larger native ensembles can score individual histories.
5. Inspect weights, effective sample size and predicted observations. **View**
   samples the chosen exact source history in the existing workspace. Changing
   the physical Model controls starts a new recipe; changing view/sampling
   retains the selected source and stage.
6. Export the study and the selected model. Export dialogs provide a JSON
   preview and download. A recipe URL alone does not preserve a conditioned
   source history. The selected model's `earthforge-block-v1` export can be
   reproduced by the existing Python `History.load` / CLI workflow.

Import either a JSON array or an object with `observations`, for example:

```json
{"observations": [
  {"id":"well-a","kind":"velocity","x":3500,"y":4200,"z":1500,"value":3000,"sigma":100},
  {"id":"horizon-a","kind":"horizon","x":3500,"y":4200,"unit":5,"side":"top","value":1300,"sigma":40}
]}
```

These are illustrative numbers, not field observations. The synthetic-example
button is explicitly labelled and generates observations from the displayed
basin solely to demonstrate the workflow. Imported constraints are validated;
unknown fields are rejected by Rust rather than silently interpreted.

Scoring runs in the same Rust module for Python and deterministic browser
Wasm. Each scalar observation uses an independent Gaussian likelihood. A
repeated horizon uses a normalized equal-weight mixture over all matching
contacts, unless an occurrence is selected. Missing horizons have zero
likelihood. Candidate priors are uniform on the explicit app parameter grid;
weights use stable log-space normalization. Small effective sample size calls
for more candidate coverage. None of this establishes calibrated posterior
coverage, independent field validity, or independence of dense well-log samples.

## Verification and realistic synthetic benchmarks

The protocol was recorded before implementation in
[`plan.json`](../validation/curved-conditioning/plan.json). It separates:

- Independent point-space occupancy and tangent-surface checks for intersecting
  curved faults, map inversion and finite-difference Jacobians; exact zero-curve
  reductions, zero-slip identity and pruned/unpruned comparisons.
- Frozen old-recipe regression against the previous executable and exact native
  / four-module Wasm comparisons on three curved scenario families, three
  seeds and two history stages.
- Fixed-point material refinement at 20, 10 and 5 m. Velocity RMS differences
  and bed-boundary disagreements are retained, including non-monotone outcomes.
- Off-grid synthetic conditioning: the generating slip, subsidence and curvature
  values are absent from the candidate grid. Prediction errors are evaluated at
  separate spatial points. This remains the same recipe family, not independent
  observed geology or a calibrated uncertainty test.
- Fresh native-process time and peak RSS for the coarse 3D block, a 10 × 10 m
  plane and nine-candidate conditioning. One warmup and three trials are kept;
  median and maximum are reported, not an unsupported p95 from three samples.

The **Measure** panel displays recorded reports separately from live browser
measurements. Full machine-readable evidence is in
[`verification.json`](../validation/curved-conditioning/verification.json) and
[`benchmark.json`](../validation/curved-conditioning/benchmark.json). The coarse
block and fine plane are different workloads. These results do not establish
10 m whole-basin throughput, energy efficiency or superiority over other codes.

Recorded on Apple M4 Pro with four native threads:

| Workload | Rift | Reverse | Reburial |
| --- | ---: | ---: | ---: |
| 49 × 49 × 241 block | 0.97 s | 0.69 s | 0.95 s |
| 1001 × 301 plane, 10 m spacing | 0.41 s | 0.30 s | 0.42 s |
| Nine-candidate conditioning | 21 ms | 16 ms | 22 ms |

These are medians of three fresh-process trials, including engine parsing,
evaluation, sampling/scoring and output serialization, excluding caller decoding
and source-recipe construction. Peak RSS and every trial are retained in the
report. Browser performance depends on the device and engine-loading cost;
these native timings are not browser guarantees.

Build native and all browser engines, then run:

```sh
EARTHFORGE_BEFORE=/path/to/frozen-pre-change-engine node validation/curved-conditioning/validate.mjs
node validation/curved-conditioning/benchmark.mjs
```

The verification script requires `EARTHFORGE_BEFORE` to point to a frozen
pre-change executable. The benchmark uses `/usr/bin/time` process accounting
on macOS/Linux and should run without competing simulation/build jobs.
Independent field validation remains a separate frozen-protocol milestone;
reserved FORCE holdout data and observational arrays were not read for this work.
