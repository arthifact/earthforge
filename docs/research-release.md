# Research alpha 0.2.0a1

Earth Forge now has a reproducible research workflow around its shared Rust
physics. This is a research alpha, not an independently field-validated or SOTA
release. The [Python guide](../python/README.md) is the practical entry point.

## Available now

- Three versioned scenario families: rift growth strata, reverse-fault growth
  strata, and erosion/reburial with prescribed pressure. The app and Python
  package use one catalog. These are supported recipe families, not a claim of
  broad geological coverage or three independently validated engines.
- An installable Python API and CLI. A local platform wheel bundles the native
  engine; its clean-environment check does not need Rust/Node at runtime.
- Explicit scenario parameters and uniform-prior finite ensembles. Source
  histories, seeds, draws, grids, engine identities and results are recorded.
  Failed jobs remain visible and resumable.
- Continuous-model well-velocity, surface, basement and horizon likelihoods.
  Horizon contacts can select a bed or depositional unit, with all repeated
  occurrences represented. The likelihood is an explicit Gaussian/mixture
  model, with caller-specified errors and effective sample size reported.
- Binary64 velocity/material-state output, standard NPZ, disk-backed NPY and
  VTK ImageData. Exports carry physical units, local coordinates, nodal layout,
  masks and provenance. The external VTK 9.5.2 reader verifies exported fields.
- Globally indexed tiled queries: exact coordinates/ownership match monolithic
  queries. Resume checks completed data and metadata and refuses mixed results.
- Paired velocity/shot-gather NPZ through the existing 2D/3D acoustic solver;
  its assumptions and CFL/dispersion/work checks remain explicit.

Python orchestrates calls and statistics; constitutive laws, deposition,
compaction, erosion, transport and acoustic propagation remain in Rust.
`material.rs`, `physics.rs`, `math.rs` and `acoustic.rs` are unchanged in this
release. The new core functionality is sampling windows, material-state output,
bed/unit contact queries and capability metadata.

## Verification and its limits

The release passes 85 Rust tests, 26 Python tests with the independent VTK
reader, ten focused worker/loader/view checks, native/Wasm Clippy, TypeScript
checking and production builds locally. Python 3.12 and 3.14 were exercised
locally; the latter omits the separately installed external VTK reader.
Historical checkpoint logs remain in `validation/research-release/`.

The [release workflow](../.github/workflows/research.yml) checks Linux, macOS
and Windows with Python 3.10/3.12. On each platform Python 3.12 also installs
the bundled wheel and executes the complete research example outside the source
checkout with the independent VTK reader. The browser/reference regression
suite is a required deployment gate. The
[public Actions run](https://github.com/arthifact/earthforge/actions/workflows/research.yml)
and verification reports attached to the tagged release record the actual
results for that source revision; an unrun definition alone is not evidence.

Nine existing scenario/replay queries retain exact physical results against
the frozen previous native engine and all four new Wasm modules. New globally
indexed windows, material-state arrays and horizon queries also agree across
native and all four modules. Existing classic-recipe/acoustic validation remains
recorded in the earlier history/block-viewer checkpoints; its numerical laws
were not modified here. Those earlier checkpoint results are separate from the
full legacy TypeScript suite run by the public release workflow.

A frozen cohort tests six seeds in each of the three families on two grids:
36 cases total. Every local grain gate passes, and all legacy velocity, bed,
lithology, surface and basement values match the previous native engine exactly.
The output grids are a coarse 10 × 10 × 3 km window and a **320 × 320 × 2,000 m
crop at 10 m spacing**. Neither demonstrates 10 m full-field-scale throughput.

For the predeclared six-cycle/one-fault refinement cases, velocity RMS differences
on fixed output nodes shrink from approximately 0.70–0.79 m/s (20 → 10 m
material subdivision) to 0.39–0.45 m/s (10 → 5 m). Vertical two-way slowness
integral RMS differences shrink from 0.066–0.077 ms to 0.038–0.049 ms. All
results, including boundary disagreements, are retained. These are sampled
numerical diagnostics, not field errors, first-arrival predictions, certified
error bounds or a universal convergence proof. See
[the cohort](../validation/research-release/cohort-results.json).

Synthetic conditioning correctly weights a six-member library against data
generated from one of its members. Different spatial positions are checked
after weighting. The truth is deliberately in the library: this is a sanity
check, not independent geology/generalization, calibrated posterior coverage
or a field inversion result. No reserved FORCE holdout or observational arrays
were read or scored for this work.

## Measured research workflow

On this M4 Pro, fresh case processes use one warmup and three complete trials,
fixed seed 1001, twelve cycles/two faults, 10 m material subdivision and f64
outputs. A fresh 10 m crop takes approximately **0.42–0.47 s** to sample/decode/
pack, plus **0.25–0.27 s** to validate, fingerprint and compress NPZ. End-to-end
medians are **0.69–0.75 s**, including source construction. Those are the small
crop described above, not a full basin at 10 m or a complete seismic survey.

The coarse-window pipeline medians are 0.44–0.49 s. Native process and Python
peak RSS are separately recorded per fresh case; they are not simultaneous
total memory or energy measurements. Browser and previous viewer timings are
different workloads. The complete trials, repeated content hashes and timing
boundaries are in [pipeline measurements](../validation/research-release/pipeline-benchmark-results.json).

## SubsurfaceGen comparison

The published source archive was downloaded, hashed and inspected, then run
unmodified with PyTorch 2.14.1 on the same CPU, four threads and f64 output.
The executable control constructs the same flat four-layer carbonate reference
field on 33 × 33 × 220 and 65 × 65 × 220 nodal grids at 10 m spacing.
An independent analytical rock-law calculation checks every output value.

The original control exposed an internal float32 path in the default optional
surface taper: its maximum difference was 0.000217638 m/s, above the predeclared
1e-8 m/s precision gate. This tiny difference does not establish geological
inaccuracy. The original plan and failure are preserved. For the constant flat
task, the revised control explicitly disables both tapers through the published
API; the threshold and reference source remain unchanged. Both tools then
pass the same gate (SubsurfaceGen maximum error about 1.8e-12 m/s).

Scoped field-construction medians are 0.047/0.169 s for Earth Forge and
0.358/0.563 s for SubsurfaceGen at those two sizes. Earth Forge uses an explicit
material stack and evaluates its rock law through a fresh CLI request;
SubsurfaceGen executes four flat Deposit modules in-process. Setup/imports are
separate. This is a common-output control with different internal work, **not
a speed ranking for realistic basins or geological-history physics**. Faults,
salt, stochastic geology, smoothing, GPUs and seismic propagation are excluded.
See [all trials and scope differences](../validation/research-release/matched-control-results.json),
[the initial failure](../validation/research-release/matched-control-v1-failure.json)
and [the broader protocol](../validation/research-release/comparison-protocol.json).

## Remaining gates toward a public, leading research tool

1. **Independent geological validity:** freeze a field-validation protocol and
   baseline, then score untouched data and structure/velocity observations.
   Establish performance outside the development settings.
2. **Geological coverage:** add and verify curved-dip/listric faults, richer
   fold/thrust geometry, salt, channels, clinoforms and carbonate platforms.
   The current reverse-fault recipe is not a balanced fold-and-thrust solver.
3. **Stronger conditioning:** mapped formation/horizon constraints, correlated
   errors, adaptive candidate coverage and surface-shot first-arrival data.
   Finite-library Gaussian weighting alone does not solve these problems.
4. **Matched research comparisons:** complex common geological tasks, identical
   field-scale outputs, precision and hardware; quantify memory, cost, quality
   and downstream FWI/generalization on whole-model/geology holdouts.
5. **Independent use and distribution coverage:** finalized citation authors,
   broader platform/OS coverage for installers,
   independently reproduced experiments and outside researchers completing
   useful tasks without developer assistance.

The project now uses the MIT license; dependency notices remain in place.
The [web alpha](https://arthifact.github.io/earthforge/) is published on GitHub
Pages. No Python registry upload or messages to outside researchers were
performed. The tagged source, platform wheels, complete example and verification
reports are distributed through the
[alpha release](https://github.com/arthifact/earthforge/releases/tag/v0.2.0-alpha.1).
A SOTA claim requires the remaining comparative evidence; adding
features or passing internal tests alone cannot establish it.
