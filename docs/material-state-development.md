# Composition transport and pressure/burial repair — 2026-10-12

The simulator now carries deposited composition with the material and separates
current effective pressure from irreversible compaction and burial memory.
The FORCE primary development result remains **309.477 m/s MAE**, versus
348.236 m/s for the depth-only baseline. No coefficients were fitted and no
holdout logs were opened or changed.

## Physical state and transport

Each sediment cell carries sand volume fraction, maximum geometric burial,
and maximum effective loading (expressed as equivalent hydrostatic depth).
Subsidence, normal-fault slip, thrust slip, overhang closure and the final
trapped-cell repair copy all three fields with the same source material.
Deposition initializes them; erosion and water creation clear them.

Compaction transfers constituent sand volume in ordered solid-volume coordinates,
retaining the loading/burial maxima of contributing parcels. It neither evaluates
composition at the destination x coordinate nor averages an entire bed into one
facies. Snapshots retain their own material fields. Both displayed velocity and
lithology use those fields, including during history replay.

At finite resolution, parcels merged into one cell share conservative maxima;
subcell loading distributions are not preserved exactly. This is not a complete
sediment/mineral budget through every open boundary. Thrust remapping still has
the existing discretization and boundary limitations.

## Pressure and history assumptions

The former composition gate at sand fraction 0.4 is removed. The optional
pressure scenario is now a common prescribed depth profile for all sediment
lithologies, including carbonates:

- above the pressure top, effective loading depth equals present burial;
- below it, effective loading depth is `top + 0.25 × (depth − top)`;
- current effective pressure is `(1950 − 1030) × 9.81 × effective_depth` Pa,
  retaining the existing 10 kPa numerical floor;
- porosity uses the maximum effective loading recorded by the material;
- the cementation blend uses maximum geometric burial, retaining the existing
  1.5–2.5 km transition and its coefficients.

The distinction between present pressure and loading history is supported by
pressure-dependent granular-rock physics and irreversible compaction frameworks:
[Hertz–Mindlin model discussion](https://doi.org/10.3389/feart.2021.805742),
[Strata manual, section 4.7](https://www.jsg.utexas.edu/flemings/files/Strata_Manual1.pdf).
Neither source validates this prescribed 25% gradient or the cementation proxy.
There is no permeability, fluid-flow, thermal or cement-reaction solver here.
Small elastic porosity rebound is not represented. The existing brine/isotropy,
fixed overburden density, mineral coefficients and velocity bounds remain.

A diagnostic at 3 km burial and a 1.5 km pressure top previously jumped
856.083 m/s between sand fractions 0.399999 and 0.400001. It now changes by
0.000909 m/s. This tests removal of the artificial composition discontinuity;
it is not a field-accuracy score.

Velocity sampling uses the material cell centre. Normally loaded material can
use the 2D lookup; states carrying excess past loading or burial use the direct
formula, because a depth/composition table cannot represent independent history.

## Development comparison

The existing plan, frozen split, QA masks, 20 m support, well weighting, baseline,
and bootstrap are unchanged. The cohort is still 442 windows from 44 development
wells, with 389 shale and 53 sandstone windows. Source hashes and the new exporter
semantics are recorded in `validation/force2020/material-state-results.json`.

| Scenario | Original MAE, m/s | Revised MAE, m/s |
| --- | ---: | ---: |
| Present burial = maximum burial, hydrostatic | 309.477 | 309.477 |
| Maximum burial +500 m | 423.152 | 409.900 |
| Maximum burial +1000 m | 705.635 | 692.844 |
| Overpressure below 1500 m | 362.726 | 328.639 |
| Less-pure facies | 323.580 | 323.580 |
| Depth-only baseline | 348.236 | 348.236 |

The exporter now passes observed present depth for stress and historical maximum
burial/loading separately in the uplift scenarios. Previously it passed the
historical depth as though the rock remained there. The overpressure scenario
also changes because pressure applies to all sediment lithologies and cementation
is no longer driven by a pressure-reduced depth. These are corrected scenario
assumptions, not tuned or selected alternatives. Lower sensitivity-scenario errors
do not establish that any scenario is the true history of these wells.

The primary bias remains −40.758 m/s and RMSE 407.803 m/s. Its paired MAE difference
from the baseline remains −38.758 m/s, with the same 95% parent-resampling interval
[−83.018, +1.108] m/s. The original uncertainty and selection limitations still
apply. Composition transport is not tested by this conditional well-log comparison;
it needs generated-section validation in addition to the transport regressions.

The run used an isolated workspace with only a development-data link, no holdout
directory, and an audit hook rejecting any holdout log path. The comparison loader
now also rejects non-development membership and paths escaping the development
root before log access. The access audit records 71 development logs read, including
wells yielding no accepted intervals. The original comparison, profiles, figures,
plan and split are preserved. Original simulator source is available at Git commit
`ee9dc04b9b9d9c9a8c9b2d27196e919631244ee9`.

## Verification

**19 JavaScript tests and 13 Python tests pass.** The production build and strict
TypeScript check pass. Existing numerical tolerances were not relaxed.

New coverage includes constituent-volume conservation during compaction, source
composition and both histories across normal/thrust slips, pressure continuity,
burial–uplift–reburial and pressure changes, replay isolation, worker buffer
transfer, FORCE uplift-scenario wiring, and explicit holdout/path rejection.
State bounds and determinism now check composition and effective-loading memory.
The window/direct-formula sweep retains its 5 m/s tolerance and includes independent
history, carbonates, both pressure modes and depths beyond the table.

The supplied seed/state tests and transport diagnostics passed, but this repair
does not close the complete conservation/convergence and external-validation work
listed in the scientific audit.

## Reproduce the revised development run

Use Python 3.11+ with `validation/force2020/requirements.txt` (numpy 2.3.5,
openpyxl 3.1.5). This run used Python 3.12.14 and Node 24.18.0.

```sh
npm test
npm run build
python -m unittest discover -s validation/force2020 -p 'test_*.py' -v
node validation/force2020/model-profiles.mjs \
  data/force2020/model-profiles-material-state.json
python validation/force2020/compare.py \
  --downloads /path/to/original/downloads \
  --profiles data/force2020/model-profiles-material-state.json \
  --output data/force2020/comparison-material-state
```

The build in the isolated workspace used `npm run build -- --configLoader native`
to avoid writing a temporary configuration bundle into its linked dependency folder.
No raw-log reimport is needed. The `.npz` inputs are read-only development inputs.
The original default profile filename remains supported for existing workflows;
use the explicit paths above to retain the first run's artifacts.
