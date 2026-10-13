# Conservative thrust transport — 2026-10-12

The thrust operator transports sediment parcels once each, preserving their grain
volume, bed identity, composition and irreversible burial/loading history. This
replaces independent destination sampling, which duplicated some source cells
and omitted others where flow crossed a thrust bend.

## Results

All **36/36 simulations** pass all **4,494 operation-level budgets**. The previous
**135 failing thrust events** now close, including the per-bed and per-constituent
checks, with no repair-added grains. The largest event/bed/component residual is
**7.55 × 10⁻⁶ m²**, and the largest absolute net total residual is **5.12 × 10⁻⁶ m²**.
Both are roundoff under the unchanged rule, 1e-6 m² + 1e-10 × inventory scale.
All 21 extension budget and comparison outputs are exactly unchanged.

The study makes 5,308,441 parcel assignments (sediment and advected basement)
across the thrust increments;
929,535 differ from the nearest rounded cell (17.51%). Every assignment in this frozen study uses
the two-cell stencil; none requires the third-cell search. This statistic measures raster allocation, not geological
transport distance or a physical error bound.

There are **1,381 matched unit/location triples**, out of the same 2,820
opportunities; the baseline had 1,417. Coverage losses remain in the full ledger.
The same cohort is used for both grid pairs within each revision.

| Quantity | Matched triples | RMS 40→20 m | RMS 20→10 m |
|---|---:|---:|---:|
| Unit top (m) | 1381 | 119.67 | 51.14 |
| Unit thickness (m) | 1381 | 42.27 | 24.29 |
| Interval velocity (m/s) | 1381 | 84.96 | 36.98 |
| Vertical one-way travel time, 0–3 km (ms) | 144 | 22.12 | 12.86 |
| Fault depth (m) | 197 | 86.15 | 46.67 |

Of the velocity triples, 474 contract monotonically, 496 contract with an
oscillation, and **411 do not contract**. The largest 20→10 m velocity difference
is **276.74 m/s**. A smaller pooled RMS does not establish uniform convergence.

To avoid confusing a changed sample population with improvement, the revision
comparison also restricts both versions to their **1,370 shared triples**:

| Quantity and version | RMS 40→20 m | RMS 20→10 m |
|---|---:|---:|
| Velocity before (m/s) | 86.57 | 36.79 |
| Velocity after (m/s) | 85.15 | 36.81 |
| Thickness before (m) | 42.51 | 24.13 |
| Thickness after (m) | 42.37 | 24.23 |

The grain-budget defect is fixed; numerical accuracy does not improve uniformly.
The fine-grid velocity difference is essentially unchanged and the thickness
difference is slightly larger. These are differences between resolutions, not
errors against field data or exact truth. No Richardson order or Grid Convergence
Index is claimed. Computational endpoint-cell conventions remain as documented
in the baseline study; boundary discretization is not isolated by this comparison.

## Method and limits

Each hanging-wall rock cell is an indivisible parcel. Its continuous position is
advanced along the existing fault-parallel flow. A sparse minimum-cost matching
assigns all retained parcels to distinct hanging-wall cells, minimizing squared
distance to their continuous targets within the selected stencil. Candidate
positions initially lie within two grid cells of the rounded target. If this
cannot fit every parcel, the entire pure assignment is retried within three
cells. The chosen radius and actual maximum displacement are recorded. Failure
at three cells throws before committing the step. The footwall is unchanged;
no sediment is discarded or hidden in a boundary flux. The fixed three-cell cap
is an allocation limit, not a claim about geological accuracy. A densely packed
carbonate case in the existing extreme-case sweep requires the third-cell search;
all 36 frozen comparison runs fit within two cells. No grain rescaling, residual-derived flux or mixing between beds is
used. The deterministic matcher is checked against exhaustive small assignments.

Subcell position offsets retain the displacement introduced by raster allocation,
so successive slips do not restart particles at cell centres. Subsidence carries
these offsets. Compaction reconstructs vertical positions and remaps the lateral
position moment using exactly the same source-grain overlaps as composition.
New sediment starts at its assigned grid position.

Backward tracing identifies the transported rock footprint and samples prescribed
open-edge continuation. A vacant raster cell inside that footprint is distinguished
from physical water beneath an overhang. Closing a placement vacancy changes the
grid representation without adding a fictitious downward motion to the continuous
particle. Actual overhang collapse still moves particles down. This distinction
is needed to avoid cumulative fold-dip errors. It is a raster surface treatment,
not a mechanical free-surface or landslide solver.

Outflow is counted from each source's forward target before allocation; inflow
is counted from exterior backward traces using the existing clamped-edge material
continuation. Corner crossings count once, with horizontal faces first. Fractional
translation is continued for incoming parcels too. The lower edge and all four
faces are tested explicitly. Source and destination flux rules are discretized
boundary conditions, not measured geological sediment supplies.

This is a bounded discrete parcel scheme, not a high-order finite-volume overlap
scheme. The three-cell cap applies per assignment, not to the total history's
geometric error. Continuous paths are tested independently on straight ramps in
both directions and through a flat/ramp/flat bend. Grid geometry, compaction,
fault interactions and boundary treatment still require convergence assessment.
The sediment budget excludes water, pore fluid and crystalline basement, and
measures grain volume in m² (m³ per metre perpendicular to the section).

## Test coverage

Final verification: **50/50 JavaScript tests and 13/13 synthetic Python tests pass**,
along with TypeScript checking and the production build. The full JavaScript run
completed in 435 seconds on this machine. No original numerical tolerance was relaxed.

Fifteen direct transport tests cover collision handling, optimality against
120 exhaustive small assignments, bounded third-cell retry and explicit failure,
zero slip with existing position offsets, translation in either direction,
independent open-boundary fluxes, a 45° ramp, a repeated flat/ramp/flat bend,
small increments on 18°, 25° and 32° ramps in both directions, and compaction's
lateral grain moment. They check untouched inputs, exact parcel composition and
burial/loading copies, complete provenance, grain closure and continuous
analytical positions. The repeated-bend raster RMS/max limits are retained.

The existing regression suite still requires the original 99% thrust consistency
rule and 90%-within-2° backlimb-dip rule, all other known-answer gates, physical
bounds at 20 and 10 m under pressure/compaction/carbonate extremes, deterministic
output, and correct worker transfer. Grain-budget rows must now pass alongside
the older geometric checks. An injected budget failure must still be visible.
The synthetic FORCE tests do not load real development or holdout logs.

## Reproducibility

The original `validation/numerics/plan.json`, metric extraction, eligibility rules
and closure tolerances are unchanged. Full ledgers are saved separately in
`data/numerics/conservative-thrust/`; the earlier `data/numerics/verified/` and
`validation/numerics/results.json` remain the historical baseline. The new compact
result is `validation/numerics/conservative-thrust-results.json`. The companion
`thrust-revision-comparison.json` compares identical unit/location cohorts across
both revisions, verifies the plan hash and requires identical physical-history
fingerprints. Saved summaries include source hashes and the runtime version.

```
npm test
npm run check
npm run build
node validation/numerics/run.mjs data/numerics/conservative-thrust
node validation/numerics/compare-revisions.mjs data/numerics/verified data/numerics/conservative-thrust validation/numerics/thrust-revision-comparison.json
```

The study reads only simulator sources and the frozen synthetic plan. No
observational log arrays were copied into the isolated workspace or read by these
runs. The FORCE development results remain evidence for their recorded source
version; they were not rerun for this numerical change. Holdout logs, split,
metrics and scores remain untouched.
