# Earth Forge

A sedimentary-basin simulator that generates candidate subsurface velocity
models from geological history. Earth Forge builds sections step by step,
then applies rock-physics relationships to the simulated burial history.
Numerical benchmarks and geological reference comparisons are included.
Accuracy against independent field data has not yet been established.

The aim is a generator anyone can set up for where they are:

- **A geologist** says "this kind of basin, this history, these facts".
- **A seismologist or tomographer** may know no geology at all, only a few
  surface shots.

The planned workflow will let users answer "don't know" and use observations
to narrow the range, for example by rejecting models whose first arrivals
do not match picked times. Conditioning on observations is not implemented
yet. The current output is a synthetic section with velocity, lithology,
labelled horizons and faults.

The intended uses are candidate priors for full-waveform inversion (FWI),
training data and synthetic test models. Suitability for any of these uses
needs validation in the target setting.

## Status (2026-10-12)

A browser page with a gallery of seeds, a step-by-step history replay and a
verification panel. The first family of geology is sedimentary basins, in two
tectonic settings, drawn per seed or chosen:

- **Extension:** listric normal growth faults. Basinward faults are younger,
  and each fault's slip rate rises and falls (Thorsen 1963). Hanging walls
  move by vertical shear (Verrall 1981). After rifting, thermal subsidence
  decays with a 62.8 Myr time constant (McKenzie 1978).
- **Compression:** thrusts ramp up from a basal detachment to an upper flat
  or to the sea floor. They form one at a time toward the foreland, with
  older thrusts carried on younger ones. Hanging walls move by fault-parallel
  flow, which makes fault-bend folds (Suppe 1983). The foreland basin deepens
  toward the thrusts.

Both settings share:

- erosion above wave base;
- deposition down to a base level, which makes growth strata;
- lateral facies changes;
- mechanical compaction: beds thin with burial, keep their solid grains, and
  flatten the faults (Sclater and Christie 1980; Xiao and Suppe 1989);
- transported rock composition, retained through faulting and compaction;
- separate present effective pressure, maximum effective loading for irreversible
  compaction, and maximum burial for the depth-based cementation proxy;
- the soft-sand rock-physics model (Dvorkin and Nur 1996), cementing into
  Raymer-Hunt-Gardner;
- optional prescribed overpressure shared across sediment lithologies, and carbonates.

[docs/verification-log.md](docs/verification-log.md) records every version.
It includes the original rules, failures, subsequent repairs and changes to
the checks. [docs/validation-audit.md](docs/validation-audit.md) describes what
the tests establish, their limitations, and the outstanding field validation.

[FORCE 2020 data intake](docs/force2020-intake.md) records the first observational
dataset audit and reserved validation wells. The importer and its separate
Python tests are documented in [the protocol](validation/force2020/protocol.md);
the large original and derived logs are not included in the repository.
The [first development comparison](docs/force2020-development.md) reports
untuned velocity errors and quality/depth checks; it does not yet validate
full basin histories or fault geometry.

The [material-state repair and development rerun](docs/material-state-development.md)
records composition transport, separate pressure/burial memory, new regression tests,
and the unchanged primary FORCE result. The pressure gradient and cementation law
remain explicit scenarios requiring field validation.

The [conservative thrust repair](docs/conservative-thrust-transport.md) closes
all 36 runs of the unchanged 40/20/10 m study, including the 15 compression runs
that failed the [original sediment budget](docs/sediment-conservation-convergence.md).
Every operation, bed and grain constituent is checked. Average grid differences
shrink with refinement, but local convergence remains mixed. Holdout logs remain
untouched.

The [local convergence diagnosis](docs/grid-convergence-diagnosis.md) identified
thin-bed loss and the one-cell compaction floor in that earlier revision.
The [thin-bed repair](docs/thin-bed-preservation.md) now retains continuous
material layers through deposition, compaction, erosion and fault transport.
Velocity uses their actual pore volume and includes thin beds through harmonic
averaging. On the same 1,205 unit/location triples, 20-to-10 m RMS velocity
differences fall from 35.20 to 4.40 m/s; all 4,494 operation budgets still close.
Local convergence and boundary sensitivity remain open questions. Neither the
observational development arrays nor the holdout were used for this repair.


The [normal-fault geometry repair](docs/fault-grid-sensitivity.md) removes
accumulating grid snapping of growing fault tips. All 77 tests and 36 conservation
runs pass. Shared fault-depth RMS differences at 20-to-10 m change from
10.09 to 5.48 m; local convergence remains mixed.
No-fault and compression controls are unchanged; a broader thrust prototype was
rejected for numerical regressions. The holdout remains untouched.

The [thrust coupling repair](docs/thrust-coupling-repair.md) fixes artificial fault
displacement during gap packing and retains cut passive branches through later
slips, display and replay. All 93 tests and 36 budget runs pass. Fault geometry
converges better, while some travel-time and thickness differences remain worse
than the prior accepted baseline. The report preserves both comparisons and
coverage; the holdout remains untouched.

The [travel-time and thickness repair](docs/travel-thickness-repair.md) preserves
compaction displacement and separates moving and stationary material inside
fault-cut cells. Fine-grid travel-time RMS improves from 0.840 to 0.567 ms and
thickness RMS from 4.265 to 3.877 m on common samples. All coupled compression
cases improve on both measures; quiet thrust B and some coarse/fault-depth
metrics still regress. Eligibility changes remain explicit. All 103 tests pass.
All 36 conservation runs pass, and the holdout remains untouched.

The [isolated thrust B repair](docs/thrust-b-repair.md) weights transport allocation
by occupied rock volume. Its fine-grid thickness RMS improves from 2.156 to 0.459 m
and travel-time RMS from 0.198 to 0.131 ms. Historical recovery is partial; overall
fine-grid travel disagreement worsens 8.15%, with coupled tradeoffs documented. All 108 tests pass; all 36 conservation runs pass.
Physical histories and eligibility rules are unchanged; holdout untouched.

## Run

```sh
npm install
npm run dev      # http://localhost:5174
npm run test:numerics # frozen 40/20/10 m study; no observational data
npm run check    # type check
npm test         # analytical tests, state invariants, lookup accuracy and batch regressions
npm run build    # type check and production bundle
```

The page is a single full-screen tool:
- The section is always drawn at true scale, with distance and depth in km:
  velocity, lithology, or both stacked on one distance axis (the default).
  It is sized to fill the window.
- A velocity inspector starts with one movable profile, A. Use + Compare to add
  profiles B and C as needed, up to three, and remove either with its × button.
  Added profiles appear together using distinct colors and line styles. Depth
  and velocity axes include units; the full 1.5–5.6 km/s model range is visible.
  The keyboard-accessible depth slider or a vertical drag on a model's round
  inspection dot sets the shared depth for velocity and rock type. Dots enlarge
  slightly on hover. Hovering shows local values in
  the readout without changing that depth. Raw grid values are drawn
  as steps without smoothing. Sections start at the top of the workspace, with
  the inspector beside them on wide screens and below them on smaller screens.
  In Both view on wide screens, the inspector runs from the top image border to
  the bottom of the model stack, and keeps that same size when only Velocity or
  Lithology is shown. The graph takes all the space above compact
  controls. Profiles sit side by side in three short lines: letter and velocity,
  rock type, then the read-only position.
  In Both view, distance labels and A/B/C badges appear only on the top model;
  both models are named. The lower lithology model keeps aligned guides and its
  own depth ticks. The crosshair appears only over plot data, not axis margins.
  Drag the A/B/C labels on the model to move a profile horizontally. Clicking
  elsewhere never moves it. The square badges below the graph are a static legend.
  Locations snap to
  the 20 m grid; active profiles and positions are saved in the shared URL.
  Reset restores the original
  2.0, 4.6 and 7.2 km locations, which are simply starting samples across the
  section, not locations chosen for geological features.
- A slider replays the history.
- A slim side panel holds the settings and the section's facts.
- How to use, Gallery, Checks and About open as dialogs.
- Keys: R draws a new seed, G opens the gallery, ← → step through the
  history, and Space replays it.

Sections are simulated in a pool of web workers, in parallel and off the
page's thread; the final section appears before its replay frames are ready. The address keeps the seed and
the settings, so a view can be shared.

In **Checks**, *Run* simulates 20-100 sections and compares them
with the literature:

- velocity with depth (Hamilton 1979, 1985);
- growth-fault expansion index from complete units on each side of the fault;
- fault dips;
- slip, sedimentation and subsidence rates.

It also runs controlled numerical benchmarks, with fixed settings independent
of the selected field ensemble:

- normal-fault heave;
- thrust remapping against back-traced flow (an internal consistency check);
- backlimb dip against ramp dip;
- compaction against the decompaction equation;
- rock area conserved by every slip;
- full sediment grain-volume closure, per operation, bed and constituent.

The test suite independently checks analytical thrust translation and bend
geometry, porosity end members, the compaction integral, expansion measurements,
physical bounds and repeatability. The velocity lookup must agree with the
direct formula within 5 m/s in the tested sweep. Compaction reports absolute
error as well as signed bias, so opposite errors cannot cancel. Empty samples
are reported as unmeasured. Geological guides screen ensemble summaries; they
do not certify realism. The velocity band pools sediment cells and represents
simulated variation, not a confidence interval for a real site.

Optional comparison: put Marmousi as a 461 x 151 float32 grid (20 m, rows of
depth) at `public/reference/marmousi_truth20.f32`. Reference models are not
redistributed here.

## Roadmap

1. History as a timeline of stages (stretch, salt, sag, squeeze, and so on).
   Today's two settings become presets, and mixed histories such as basin
   inversion come for free.
2. More geology:
   - salt (bodies placed by shape, with sediments draped around them, and
     minibasins);
   - volcanic rock (sills, basalt flows);
   - carbonate platforms;
   - channels and slumps;
   - shallow gas;
   - for land anywhere: a near-surface layer (weathered rock, soil, glacial
     deposits) and crystalline basement with real structure.
3. A scenario panel: presets by geology type, easy facts with "don't know",
   and export of model ensembles.
4. Conditioning on data:
   - first-arrival traveltimes from surface shots, which also give the odds
     of each kind of geology;
   - well logs (velocity, formation tops);
   - interpreted horizons;
   - an existing tomography model.
5. A coverage test for each preset: can it reproduce public models and real
   logs (Marmousi, SEG/EAGE Overthrust and Salt, BP 2004, FORCE 2020 wells)?

Related work: Noddy and the Noddyverse (Jessell et al. 2022) generate
geological models from event histories, mostly hard-rock models with gravity
and magnetics. Earth Forge targets process physics and seismic velocity for
FWI.

The [constituent thrust-motion correction](docs/coupled-travel-repair.md) integrates each material constituent across fault bends and uses exact quantized matching. 117 distinct tests are verified across the initial full run and the successful targeted rerun; all 36 conservation runs close. Shared 20–10 m travel RMS changes from 0.613 to 0.514 ms; 40–20 m changes from 1.371 to 1.554 ms. Coupled A’s original upstream accommodation defect is largely recovered, but local and coarse-grid regressions remain. The report retains every regression and eligibility change. Holdout untouched.

The [FORCE coefficient calibration](docs/force2020-calibration.md) reproduces the
development benchmark from the original downloads (309.477 m/s MAE, unchanged by
the later transport repairs) and then refits the velocity law's global coefficients
under a pre-registered plan. No set is adopted: every set predicts held-out wells
worse than the untuned law (best leave-one-well-out MAE 324.4 m/s). Per-well
offsets of 278 m/s on average dominate the error and cluster by North Sea
quadrant, so the next step is burial and pressure context per well, not
coefficient tuning. The holdout remains unscored.

The [burial-state context test](docs/force2020-burial-context.md) attaches the
NPD lithostratigraphic group and location to each window and fits one burial-state
offset per unit with unchanged coefficients. Leave-one-well-out MAE falls to
266.4 m/s per quadrant and 273.1 m/s per group; only group offsets transfer to
an unseen quadrant (279.0 m/s). Hordaland shale fits 350 m under-loaded and
pre-Cenozoic units 400–700 m over-buried. The pre-registered interval against
the untuned law includes zero, so nothing is recorded as a scenario; the finding
sets a modelling target for the generator. The holdout remains unscored.

## Origin

This started inside Seismic Glade, a WebGPU FWI sandbox. The 9.2 x 3 km
window and the 1500-5600 m/s range come from its 2D FWI lab.
