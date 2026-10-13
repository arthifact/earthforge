# Sediment conservation and grid refinement — 2026-10-12

> Historical baseline. The subsequent [conservative thrust repair](conservative-thrust-transport.md)
> closes all 36 runs of this unchanged plan. The measurements below describe the
> earlier nonconservative version and are retained for comparison.

The full grain-volume budget is now active in every simulation. In the fixed
12-case study at 40, 20 and 10 m, all **21 extension runs** close to floating-point
tolerance. All **15 compression runs** fail the stricter budget: **135 thrust
slip events** create or lose grains. The other **4,359 process events** close.
This exposes an existing limitation; the diagnostic changes do not make thrust
transport conservative.

Grid refinement reduces pooled differences, but does not establish an accurate
or uniformly converged solution. The same 1,417 unit/location triples are used
for both grid pairs. The RMS interval-velocity difference decreases from
**91.92 to 36.99 m/s** and thickness from **43.01 to 24.34 m**. These are differences
between resolutions, not errors against observations or against known truth.

No observational log data were read or changed. Both FORCE development and
holdout arrays were absent from the isolated numerical-study workspace. The
existing 94/24 split, comparison results and model coefficients are unchanged.
The previous development comparison remains historical evidence for its recorded
source version; it was not rerun for this instrumentation-only change.

## What the budget measures

The conserved quantity is sediment grain volume: m² in this section, equivalent
to m³ per metre perpendicular to it. Water, pore fluid and crystalline basement
are excluded. This is not a fluid, density-in-kg, chemical-reaction or basement
mass budget. Sand, shale (the nonsand clastic end member), carbonate, every bed's
total, and every material within every bed are tracked independently.

For each operation and time step:

```
residual = retained_after − (retained_before + deposition − erosion
                            + left/right/top/bottom inflow
                            − left/right/top/bottom outflow)
```

Retained grains are counted by a fresh whole-grid scan. Deposition and erosion
count actual parcels when added/removed. Subsidence and fault transport count
outgoing source parcels before mutation and incoming parcels from prescribed
edge continuation. Within a thrust dip domain, departure uses the same carried
whole-column translation as the operator; across a bend it uses an independent
forward trace and nearest-cell rounding. Corners count once (horizontal side
first). Unmatched interior grains are never relabelled as boundary flux.

Compaction, overhang collapse and burial-memory updates have zero geological
source/sink. The final trapped-water fill, if invoked, is disclosed separately
as `repairAdded` and remains an error in the physical budget. No artificial
renormalization is performed.

The acceptance rule, fixed before the study, is **1e-6 m² + 1e-10 × inventory
scale**, independently per event, bed and constituent. Scale is the largest
absolute before/expected/after inventory for that quantity. Every event must
close; cancellation at later steps cannot rescue a failure. Reports retain
signed cumulative residuals, sums of absolute event residuals, worst events,
per-process totals, per-step totals and all four faces.

The old <2% raster-area screen is preserved and labelled separately. It can
pass when this stricter grain budget fails. The app now exposes conservation
status for the final section and a failing grain-budget row in Checks.

## Conservation results

Net unaccounted grain volume (m²; positive means creation, negative means loss):

| Compression case | 40 m | 20 m | 10 m |
|---|---:|---:|---:|
| thrust-a | -2,538.1 | -1,035.6 | -2,737.6 |
| thrust-b | +28,057.3 | +7,120.7 | -7,428.6 |
| coupled-compression-a | +9,580.7 | -2,570.7 | -825.6 |
| coupled-compression-b | +12,125.2 | -6,286.8 | -400.5 |
| coupled-compression-c | -20,955.2 | -1,320.5 | +2,082.4 |

All extension net residuals are within roundoff. The largest absolute net
compression residual relative to cumulative deposited grain volume is 0.355%
(thrust-b, 40 m). That denominator describes scale, not the closure tolerance.
Absolute event residuals expose much more error than the net values: summed
across cases they are 172,603.2 / 74,531.5 / 51,572.6 m² at 40 / 20 / 10 m.
The worst single event/bed/component residual is 12,654.1 m². Error reduction
is not universal: coupled-compression-c has larger summed absolute event error
at 10 m than at 20 m. The raw ledgers retain the individual bed/material changes.

## Refinement method and coverage

The frozen `validation/numerics/plan.json` defines 12 cases: two compaction
controls, two normal-fault controls, two thrust controls, and three coupled
cases per setting, including pressure and carbonate variants. They are fixed
development cases, not a statistically representative ensemble. Nothing was
selected using holdout observations and no parameters or tolerances were fitted.
The same seed and options are used at each spacing. Fingerprints of generated
bed definitions, prescribed fault histories, physical constants and forcing
sampled at fixed physical locations must match before comparing outputs.
The generated forcing fingerprints match for all 12 histories.

Profiles are fixed at x = 400, 1200, …, 9200 m within the common 0–3000 m depth
window. Unit identity is the deposition step, not pixel location or a nearest
boundary match. A unit must have one contiguous interval, contain at least two
cells, lie inside the depth window, and be clear of a fault cut by one local
cell. “Complete” here means these geometric criteria; it does not prove that
a unit has never been eroded. All three grids must qualify. Multiple intervals,
missing units, one-cell units, window boundaries and fault cuts remain in the
coverage ledger. Metrics are not recalculated on different cohorts for the two
pairs.

There are **2,820 unit/location opportunities**, including **467 absent at all
three resolutions**. **1,417** qualify on all three grids (50.2% of all
opportunities; 60.2% of those appearing on at least one grid). Per-grid eligible
counts are 1,489 / 1,743 / 1,812, so the intersection deliberately does not use
all fine-grid measurements. Coverage limits every pooled interval result.
All 144 common vertical travel-time profiles are measured, including water
and basement, using integrated slowness. Fault-depth comparisons use the same
fault identity and profile and require a defined depth on all three grids;
197 locations qualify. Full status lists and individual triples are saved.

Thickness and porosity use actual geometric cells and retained solid. Composition
and burial/loading summaries are weighted by grain volume; interval velocity
is thickness divided by integrated travel time, not arithmetic mean velocity.

Full-domain budgets include all endpoint cells with full width h. Consequently,
computational widths are 13,240 / 13,220 / 13,210 m and depths are 4,560 / 4,520 /
4,510 m. The study reports these differences explicitly. Raw full-domain totals
are not used as convergence metrics. Boundary-discretization effects can still
influence the common window: this study does not isolate them from interior
truncation error or establish convergence at a fixed continuum boundary.

| Quantity | Matched triples | RMS 40→20 | RMS 20→10 | Fine/coarse ratio |
|---|---:|---:|---:|---:|
| Unit top (m) | 1417 | 124.7 | 52.64 | 0.422 |
| Unit thickness (m) | 1417 | 43.01 | 24.34 | 0.566 |
| Solid height (m) | 1417 | 24.11 | 13.17 | 0.546 |
| Sand fraction | 1417 | 0.05558 | 0.02434 | 0.438 |
| Geometric porosity | 1417 | 0.1264 | 0.08066 | 0.638 |
| Maximum burial (m) | 1417 | 111.2 | 48.33 | 0.435 |
| Maximum effective loading (m) | 1417 | 108.8 | 45.39 | 0.417 |
| Interval velocity (m/s) | 1417 | 91.92 | 36.99 | 0.402 |
| 0–3 km vertical travel time (ms) | 144 | 22.4 | 12.76 | 0.570 |
| Sea floor (m) | 144 | 49.19 | 34.47 | 0.701 |
| Fault depth (m) | 197 | 82.68 | 47.09 | 0.570 |

Of the 1,417 interval-velocity triples, 485 contract monotonically, 511 contract
with an oscillation, and 421 do not contract. The worst 20→10 m interval-velocity
difference is 276.74 m/s, despite the smaller pooled RMS. Per-case metrics,
maximum differences, MAE and classifications are included in the machine-readable
summary; global averaging must not be used to hide these tails.

No Richardson extrapolation, formal order or Grid Convergence Index is claimed.
The 10 m simulation is not an oracle. Three grids allow an asymptotic-range
assessment but do not themselves demonstrate it; discontinuities and oscillatory
sequences require care. See [NASA's spatial-convergence guidance](https://www.grc.nasa.gov/www/wind/valid/tutorial/spatconv.html).
These are self-convergence diagnostics alongside the existing independent
analytical tests, not new independent analytical error bounds for every scenario.

## Reproduce and inspect

```
npm test
npm run check
npm run build
npm run test:numerics
# Or save the complete ledgers elsewhere:
node validation/numerics/run.mjs /path/to/numerical-results
```

The command writes all results, then exits 1 if any grain budget fails. The current
implementation therefore fails this strict physical gate even when unit tests pass.
No numerical accuracy threshold is assigned to the refinement differences.

The numerical runner only reads the source modules and frozen plan. It has no
observational-data loader. Its default output is ignored `data/numerics/`.
The retained run is in `data/numerics/verified/`: per-case/per-grid complete
budgets, per-case samples and coverage, all matched series, and `summary.json`.
The compact tracked result is `validation/numerics/results.json`; detailed file
names are relative to the numerical output directory. Source and plan SHA-256
fingerprints and runtime version are recorded. Reproduction overwrites numerical
outputs only; observational-directory names are rejected.

`validation/numerics/instrumentation-neutrality.json` records an independent
before/after comparison on both settings at all three resolutions. Every physical
array, all recorded replay frames, beds, faults, deposition totals and physical
parameters are identical. Timing and new diagnostics are excluded.

The added tests use known grain volumes and deliberately corrupted states. They
cover all faces, corner counting, deposition/erosion, constituent and bed balance,
compaction, repair disclosure, cancellation, numerical tolerance, actual process
ledgers, refinement matching, rejected-feature coverage and trend classifications.
The worker test checks that the complete final budget reaches the UI. The old
numerical tolerances are unchanged; their test explicitly excludes the new budget
row, which has a separate regression requiring visible failure for current thrust
transport. Passing software tests therefore does not mean the physical thrust
budget passes.

## Next numerical repair

Replace nearest-cell thrust transport with a conservative remapping scheme that
preserves grains and constituents within each bed while retaining burial/loading
history. First establish independent closed/open-boundary transport fixtures,
then rerun this unchanged 12-case plan and require event-level closure. Continue
to report coverage and local convergence failures; add finer grids only after
resolving those causes. Keep observational validation reserved for after these
numerical defects are addressed.
