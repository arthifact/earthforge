# Local grid-convergence diagnosis — 2026-10-12

The largest remaining grid sensitivity is associated with **thin-bed deposition
and compaction, and the resulting differences in later deposition and burial**.
The one-cell minimum for each surviving named bed is a demonstrated numerical
constraint. Conservation is sound in the tested histories, but a closed grain
budget does not ensure that the geometric volume and rock-physics porosity agree.

This is a diagnostic follow-up, not a physics repair or an accuracy improvement.
All **36/36** standard 40/20/10 m runs reproduce the conservative-thrust baseline's
extracted samples and coverage exactly, retain the same physical-history hashes,
and close all **4,494** budget events. The original 1,381 matched triples, 2,820
opportunities and 411 noncontracting velocity triples are unchanged. No metric,
eligibility rule, coefficient or conservation tolerance was adjusted. Development
and holdout observational arrays were neither read nor changed.

## What drives the discrepancies

| Case family | Matched triples | RMS velocity difference, 20→10 m | Share of pooled squared difference |
|---|---:|---:|---:|
| No-fault compaction controls | 330 | 47.84 m/s | 39.98% |
| Normal-fault controls, compaction off | 289 | 8.71 m/s | 1.16% |
| Thrust controls, compaction off | 175 | 10.27 m/s | 0.98% |
| Coupled extension | 343 | 49.10 m/s | 43.78% |
| Coupled compression | 244 | 33.04 m/s | 14.10% |

Cases with compaction enabled contain 97.86% of the pooled squared fine-grid
velocity difference. This is an association across different cases, not a causal
percentage attributed to the compaction operator. The controlled intervention
below supplies stronger evidence for the two no-fault histories.

Of the 411 noncontracting triples, 104 have a fine-grid change below 10 m/s,
209 are between 10 and 50 m/s inclusive, and 98 exceed 50 m/s; 24 exceed 100 m/s.
These are descriptive bins, not new acceptance tolerances. A high refinement
ratio can reflect a near-zero coarse-grid difference, so the ratio alone is a
poor way to prioritize repairs.

### A bed cannot shrink below one cell

In `compaction-a`, unit 5 at x=8,400 m, essentially identical grain inventories
are spread over six carbonate beds:

| Quantity | 40 m | 20 m | 10 m |
|---|---:|---:|---:|
| Grain height in the unit | 85.525 m | 85.521 m | 85.520 m |
| Final thickness | 240 m | 120 m | 120 m |
| Cells per named bed | 1 | 1 | 2 |
| Continuous thickness from the final compaction diagnostic | 116.86 m | 114.56 m | 112.02 m |
| Porosity implied by grains / raster volume | 0.644 | 0.287 | 0.287 |
| Mean porosity used by the rock formula | 0.267 | 0.271 | 0.245 |
| Interval velocity | 3,846.69 m/s | 3,819.85 m/s | 4,024.08 m/s |

At 40 m, six separately labelled beds cannot occupy less than 240 m. Each bed's
continuous solution would occupy only about 17–21 m, so the minimum cell count
blocks the required compaction. The continuous diagnostic solves the existing
per-bed midpoint equation at each grid's realized overburden and respects the
existing no-expansion cap; it is not a grid-independent exact basin solution.

The porosity mismatch exposes a consequential limitation: the geometry can
retain excess pore volume while velocity is evaluated from the constitutive
porosity implied by loading history. Simply changing the velocity to match the
raster volume would substitute another error; the underlying volume representation
needs to become consistent first.

Across all compaction events at the 12 prescribed profiles:

| Grid | Bed-run event samples | Continuous solution below one cell | Fraction |
|---|---:|---:|---:|
| 40 m | 56,210 | 29,285 | 52.10% |
| 20 m | 67,787 | 16,076 | 23.72% |
| 10 m | 74,054 | 7,517 | 10.15% |

These are repeated samples of evolving bed runs, not independent observations
or unique beds. An independent bracketed root gives the same rounded cell count
as the production iteration in **every** sampled run event. Increasing the
iteration count is therefore not the repair indicated by this experiment.

### Quantized compaction changes later sediment supply

In the same fault-free case, unit 13 at x=9,200 m is deposited with 29.01,
30.33 and 57.03 m of grain height on the 40, 20 and 10 m grids. The difference
is already present immediately after deposition; subsequent compaction preserves
those grains. Before deposition, the bed surface is at 440, 440 and 510 m.
The prescribed base-level forcing is identical, but different accommodation
produces 80, 80 and 150 m of deposited raster thickness.

The 40 m grid represents only two of that unit's three declared beds; the finer
grids represent all three. Whole-cell deposition thus introduces a second
resolution effect: thin beds can disappear or occupy disproportionate thickness.
Across all cases, positive deposits with fewer cells than declared beds occur
in 861, 361 and 376 profile/step samples at 40, 20 and 10 m, respectively.
Zero-cell deposits are counted separately (435, 338 and 66 of 2,820 samples per
grid). The counts are not uniformly monotonic because prior numerical differences
change subsequent accommodation.

### A controlled compaction intervention

Compaction was disabled only in the two no-fault controls, leaving their seeds,
forcing, bed definitions and grid spacings unchanged. All six intervention runs
close their budgets and retain identical prescribed-history hashes. Both variants
are compared on the same eligible triples within each case:

| Case | Shared triples | Fine-grid RMS, original | Fine-grid RMS, compaction disabled |
|---|---:|---:|---:|
| compaction-a | 148 | 57.32 m/s | 11.24 m/s |
| compaction-b | 114 | 35.06 m/s | 8.61 m/s |

This isolates a strong contribution from the compaction/deposition feedback in
these histories. It is **not a proposed fix**: removing compaction changes the
physical model. It also changes interval eligibility (original/off/shared counts
are 169/148/148 and 161/149/114). The main 36-run comparison is retained separately.

### Velocity lookup, transport and boundaries

An exact state-substitution decomposition was calculated for every matched
interval at both grid pairs. It evaluates all eight combinations of present
depth, composition/lithology and burial/loading history on the union of normalized
cell boundaries. Contributions average over substitution order and sum to the
direct-formula velocity difference, with a maximum residual of 5.69e-14 m/s.
Interactions mean these are explanatory substitutions, not unique physical
causes or percentages of variance explained.

The largest interval-velocity discrepancy between lookup and direct evaluation
is **1.52 m/s**. It does not explain the largest local 100–200 m/s discrepancies.
For the carbonate example above, composition is unchanged; its 20→10 m difference
is carried by present depth and retained loading/burial state.

Operation traces also retain the weaker discrepancies in the isolated fault
controls. For example, `normal-a` unit 1 at x=7,600 m obtains 35.36, 17.50 and
13.65 m of grains through deposition, with no net whole-column grain change
from slip. In `thrust-a` unit 13 at x=9,200 m, the deposited grain heights are
30.85, 15.18 and 20.21 m; the net thrust contribution is below 0.004 m at each
grid. Thus even these selected fault-control outliers show substantial deposition
sampling effects. Net event contributions may conceal cancelling transports and
do not establish that fault geometry is irrelevant.

The worst demonstrated compaction failures occur without faults or lateral
transport. Open thrust boundaries therefore cannot cause those particular
failures. Endpoint-cell conventions, fault geometry, interacting faults, erosion
and boundary placement remain possible contributors elsewhere. No buffer-width
or boundary-condition convergence study was performed, and none is claimed.

## Implementation and verification

`simulate(options, observer?)` now provides a synchronous, optional diagnostic
view after each budgeted operation. Views borrow the state arrays; callbacks
must not mutate them and must copy retained values. Normal app simulations use
no observer. Tests compare complete physical outputs, plans and budgets with and
without observation in both tectonic settings.

The diagnostic runner captures whole-column unit inventories by process,
deposition resolution, independent continuous compaction roots and selected
operation traces. Whole-column process changes telescope to final values,
including units that disappear. They describe fixed spatial columns, not parcel
trajectories. The 24 detailed unit/location targets were selected as the two
largest existing noncontracting velocity changes per case before operation
traces were inspected. This is an exploratory development study, not a new
independent validation dataset.

Six new tests cover observer invariance and event coverage, an analytical
constant-porosity thin bed, unloading memory, invariance to subdividing identical
source grains, exact unequal-grid harmonic integration, and additive/interaction
attribution identities. Final suite and build results are recorded in the
verification log.

Reproduce from the repository root after retaining the conservative-thrust
synthetic baseline:

```sh
node validation/numerics/diagnose.mjs
node validation/numerics/compaction-ablation.mjs
node validation/numerics/diagnosis-evidence.mjs
npm test
npm run check
npm run build
```

The plans, compact evidence and source fingerprints live under
`validation/numerics/`. Full traces and interval attributions are saved separately
under `data/numerics/convergence-diagnostics/`; intervention results live under
`data/numerics/compaction-ablation/`. Earlier studies remain unchanged. Scripts
read enumerated simulator sources and synthetic numerical files only.

## Next repair and acceptance criteria

The next implementation should represent bed thickness and material content below
the display grid spacing. Start with a continuous column compaction/deposition
model that preserves each bed's grains, composition and irreversible histories.
Then project it conservatively to the raster, allowing a cell to contain parts
of multiple beds. This requires a deliberate extension of the material state
and its transport; simply rounding differently, merging labels, or dropping
thin beds would not address the demonstrated defect.

Acceptance should first use fixed-supply, no-fault columns, independent analytical
volume relations, and invariance under subdivision of an otherwise identical
bed. Check both grain closure and consistency between bulk volume, pore volume
and the porosity used for velocity. Include beds thinner than 10 m, unloading,
and mixed carbonate/clastic contacts. Integrate transport only after those
column tests pass, then rerun the unchanged 40/20/10 m plan with full coverage
and shared-cohort comparisons. Do not tune against or open the holdout.

Boundary and transport sensitivity remain separate follow-ups. The present
evidence prioritizes the thin-bed representation; it does not establish uniform
convergence, a Richardson order, a GCI, or field accuracy.
