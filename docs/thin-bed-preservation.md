# Thin-bed preservation — 2026-10-12

Beds thinner than a display cell now retain their physical volume, grains,
identity, composition, and burial/loading memories. They can compact below
one cell and contribute to velocity even when another bed supplies the pixel
label. This repairs a numerical representation problem; it does not establish
accuracy against real basins.

## Material representation

`src/strata.ts` stores ordered continuous layers in each column. Deposition,
vertical subsidence, erosion and compaction use physical thicknesses rather
than integer row counts. Deposition retains every prescribed bed in a positive,
unclipped deposit. Erosion, subsidence, and normal-fault boundary crossings
remove only the intersected fraction and count its constituent grains
independently in the ledger. Thrust boundary crossings retain the existing
cell-parcel approximation and count every component of each departing parcel.

Compaction solves each material parcel's implicit midpoint volume equation
with a bracket while retaining irreversible loading memory. No bed is forced
to occupy one cell. The maximum deposition quadrature length is 10 m at every
display grid; it is not a minimum bed thickness. Independent sand, shale and
carbonate tests refine this material quadrature through 40/20/10/5 m against
the integrated porosity law. The tested 10 m error is below 0.02 m.

Normal faults shear complete continuous columns, splitting only at the fault
and open boundaries; only horizontal heave retains the existing column/carry
rule. Thrust transport carries every component of a mixed cell. The existing
bounded conservative thrust assignment and its rejection rules remain in place. Raster labels serve display and the thrust consistency screen; continuous
layers define the inventory and normal-fault cutoffs/thicknesses. Velocity uses actual grain/pore volume plus
present stress and retained memories. Thickness-weighted harmonic averaging
preserves vertical slowness across thin lithologies. It is not a full elastic
or anisotropic upscaling model.

Replay caches the correct 20 m projection and returns independent arrays.
Requests to resample a cached replay at another spacing fail explicitly;
the final physical state can still be sampled at 40, 20 or 10 m. Regenerating
past physical states at arbitrary spacing would require another simulation.

## Same 40/20/10 m comparison

The frozen 12 cases, seeds, forcing histories, physical support and budget
thresholds are unchanged. All 36 runs close, with zero failures across 4,494
operation budgets and no repair-added sediment. The largest event/bed/component
residual is approximately 1.23e-6 m², within the original inventory-scaled
roundoff tolerance. Each bed and its sand, shale and carbonate are checked.

Interval metrics now integrate true layer interfaces rather than dominant
raster labels. The definitions, unique-contiguous-interval requirement,
two-grid-cell minimum thickness, window exclusion and one-cell fault clearance
remain. A physically retained thin bed can therefore still be excluded from
this conservative comparison. Coverage changes from 1,381 to 1,301 of 2,820
opportunities. The fair revision comparison uses the 1,205 unit/location triples
eligible in both versions, and all 144 common vertical travel-time profiles.

| RMS difference | Before: 40–20 m | After: 40–20 m | Before: 20–10 m | After: 20–10 m |
| --- | ---: | ---: | ---: | ---: |
| Unit velocity (m/s), shared 1,205 triples | 85.55 | 7.45 | 35.20 | 4.40 |
| Unit thickness (m), shared 1,205 triples | 43.21 | 7.86 | 24.31 | 4.22 |
| Unit porosity, shared 1,205 triples | 0.12068 | 0.00148 | 0.06527 | 0.00095 |
| Vertical travel time (ms), 144 profiles | 22.12 | 1.94 | 12.86 | 0.85 |

Fine-grid velocity differences above 50 m/s drop from 141 to zero shared triples.
Uniform convergence is not established: strict noncontracting/new-change
classifications increase from 352 to 363 on that shared cohort, although 242
of the latter now differ by less than 1 m/s and none exceed 50 m/s. No
classification tolerance was added. Across the entire new eligible cohort,
velocity RMS differences are 8.08 and 4.90 m/s; its largest fine difference
is 76.09 m/s. Coupled extension remains the largest contributor.

## Verification and reproducibility

The final full JavaScript suite passes all 72 tests (16 new), with no skips.
Type checking and the production build pass. Controlled normal-fault heave
retains 122 measured horizons at 20 m and 130 at 10 m; worst errors are 19.31
and 7.24 m, respectively, under the unchanged 40 m gate. The layer
representation increases compute/memory cost; elapsed duration includes long periods with little host CPU progress and
concurrent numerical work, so it is not an isolated compute-time benchmark.

The 16 new tests cover sub-millimetre raster round trips, mixed lithologies,
independent compaction answers and quadrature refinement, partial erosion,
unloading, physical overhangs, boundary grains, analytical thrust centroids,
harmonic velocity, replay, interval eligibility, actual thin deposition,
fractional normal-fault shear and known thin-horizon cutoffs at all three grids.
The existing suite retains the 40 m heave gate, 99% thrust consistency gate,
90% backlimb-within-2° gate and original compaction/error/budget thresholds.

The broad regression run exposed remaining raster assumptions in normal-fault
transport and cutoff measurement. Both now use continuous interfaces. The
independent planar-fault fixture recovers a known thin-horizon displacement
in both directions at 40/20/10 m, without changing the heave acceptance limit.

Tests were adapted to the physical representation: deposited composition
is checked on each actual layer, and controlled compaction must be independent
of display spacing instead of strictly improving when an already continuous
column is resampled. Compaction validation includes subcell intervals rather
than excluding them. The old six-history budget fixture now requires the
erosion operation, not positive erosion in every history; a separate genuinely
uplifted history checks positive erosion against the independently reconstructed
physical wave base. Replay and worker transfer remain covered.

- Final source/plan hashes and summary: `validation/numerics/thin-bed-results.json`.
- Same-cohort comparison: `validation/numerics/thin-bed-revision-comparison.json`.
- Complete ledgers, samples and refinement series: `data/numerics/thin-bed-preservation/`.
- Test/build record: `validation/numerics/thin-bed-verification.json`.

Earlier results remain intact. The historical whole-cell diagnosis and ablation
runners now reject different source revisions before running or writing output,
preventing comparison of a new intervention against an old control. Future
mechanism probes need contemporaneous controls.

No observational development arrays, holdout arrays or split files were read
or changed. The unchanged synthetic exporter helper and benchmark metadata
were used only by its existing regression test. Python importer tests were
not rerun because that code and data path were unchanged.

The next numerical questions are coupled-fault transport and open-boundary
sensitivity, followed by broader prescribed histories and constitutive
sensitivity. The fixed material quadrature, cell-based fault placement and
eligibility-selected interval sample limit the present evidence. The holdout
remains reserved for a later, predeclared evaluation.
