# Normal-fault grid sensitivity repair — 2026-10-12

Normal faults now start at their prescribed physical origins and retain fractional
shallow-tip positions as they grow upward. The previous implementation snapped
the origin, then clamped each new shallow sample to zero, accumulating a lateral
shift of up to one column per growth step. The new signed guard sample keeps the
zero crossing. Immediately after growth it lies above the domain; transport
clips it to the physical boundary, so this guard adds no sediment volume.

In an independent nine-step uniform-subsidence fixture, the largest tip-position
error falls from 227.46 m to below 6e-14 m. This is an analytical numerical test,
not an error measurement against geological observations. The existing horizontal
heave rounding/carry and both conservative material transports are unchanged.

## Same 40/20/10 m study

All 12 cases, seeds, forcing histories, physical support, comparison definitions
and conservation tolerances remain frozen. All 36 runs close, with no failures
across 4,494 operation budgets and no repair-added sediment. The independent
ledger audit checks 755,160 scalar event/bed/component balances;
its largest residual is 1.26e-06 m²,
within the original inventory-scaled roundoff tolerance. The six no-fault runs
and all 15 compression runs reproduce their baseline ledgers and samples exactly.

RMS grid differences on the same cohort across revisions:

| Quantity | Before 40–20 m | After 40–20 m | Before 20–10 m | After 20–10 m |
| --- | ---: | ---: | ---: | ---: |
| Fault depth (m) | 25.230 | 15.013 | 10.089 | 5.479 |
| Unit velocity (m/s) | 7.451 | 7.432 | 4.400 | 4.296 |
| Unit thickness (m) | 7.829 | 8.069 | 4.221 | 4.256 |
| Vertical travel time (ms) | 1.943 | 1.876 | 0.848 | 0.823 |

The common cohort contains 1296 unit/location triples, 197 fault-depth samples and 144 vertical profiles. Eligible intervals change from 1,301 to 1304 of 2,820. Strict noncontracting/new-change velocity classifications change from 395 to 416. Fault-depth noncontracting/new-change counts increase from 51 to 71 despite the lower RMS and worst difference. No classification or eligibility threshold was changed.

The improvement is concentrated in normal-fault geometry. In `normal-b`, fine-grid
fault-depth RMS falls from 17.387 to 0.042 m; in coupled extension A and C, it falls
from 12.260 to 2.122 m and from 17.797 to 3.538 m on shared samples. Across all 1,304 currently eligible intervals, fine-grid velocity RMS is 4.454 m/s
and the maximum is 38.917 m/s; this larger cohort is reported separately from
the shared-cohort comparison. Some interval
and travel-time differences worsen: in `normal-a`, travel-time RMS rises from
0.184 to 0.329 ms; coupled extension B's shared velocity RMS rises from 6.312
to 6.670 m/s. This repair does not establish uniform local convergence or field
accuracy. The 10 m run is a refinement sample, not truth.

## Tests and a rejected broader prototype

All 77 JavaScript tests pass, including five new geometry regressions, with no
skips. Type checking and the production build pass. The new tests cover physical
listric origins, repeated analytical tip growth in both directions at 40/20/10 m,
open-side termination, signed-tip transport conservation and retained material
histories, and use of the physical origin in actual simulations. Existing
40 m heave, 99% thrust consistency, 90% backlimb dip and compaction/budget gates
remain unchanged. No existing test assertions were weakened or replaced.

A broader prototype retaining continuous thrust-bend markers was tested and
rejected. It passed the focused analytical fixtures and all 36 sediment budgets,
but raised the shared fine-grid fault-depth maximum from 70.68 to 101.22 m and
144-profile travel-time RMS from 0.848 to 0.980 ms. Its full regression run was
interrupted; no complete pass is claimed. Its compact result record is retained
in `validation/numerics/thrust-geometry-prototype-rejection.json`. It is not part
of this implementation.

Remaining numerical issues include integer-column normal heave, grid-sampled
carried/intersecting fault traces, thrust parcel placement and open-boundary
sensitivity. Those require separate analytical controls before another broad
transport/geometry change. Physical coefficients and observational protocols
have not been tuned to this development study.

## Reproduce

```sh
node --max-old-space-size=8192 --test --test-concurrency=1 tests/*.test.mjs
npm run build -- --configLoader native
node validation/numerics/fault-geometry-evidence.mjs
node --max-old-space-size=8192 validation/numerics/run.mjs data/numerics/fault-grid-sensitivity
node validation/numerics/compare-revisions.mjs data/numerics/thin-bed-preservation data/numerics/fault-grid-sensitivity validation/numerics/fault-grid-revision-comparison.json
```

Compact results, paired comparisons, analytical evidence, the ledger audit and
verification hashes are saved under `validation/numerics/fault-grid-*` and
`validation/numerics/fault-geometry-evidence.*`. Full synthetic ledgers and samples
are under ignored `data/numerics/fault-grid-sensitivity/`. Historical results are
preserved. The Python importer was unchanged and its tests were not rerun.
No observational development arrays, holdout arrays or split files were read
or changed. The existing exporter regression used only synthetic calculations
and unchanged benchmark metadata.
