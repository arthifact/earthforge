# Thrust coupling diagnosis and repair — 2026-10-12

Two numerical defects explain important parts of the rejected thrust prototype's regression. This repair retains exact physical thrust bends and fixes how their geometry couples to gap closure and later thrusts. It does not establish uniform grid convergence or field accuracy.

## Diagnosis and supported changes

1. **Allocation gaps moved the fault itself.** The conservative remapper preserves each sediment parcel's physical position through offsets when grid placement creates a hole. Packing canceled that artificial displacement for material but applied the full storage-coordinate displacement to fault geometry. The new physical-depth map cancels only the numerical portion of actual internal water gaps. True gap closure, subsidence and pore-volume compaction still move the geometry. Independent mixed-gap and compaction fixtures check the distinction, including markers inside a gap and sub-millimetre gaps.
2. **Column projection discarded cut branches.** An older thrust can have separate hanging-wall and footwall branches at the same x after a younger fault cuts it. The old update rounded vertices into columns, averaged coincidences, and filled unoccupied columns. A moving branch could disappear from a column already occupied by a stationary branch. Restoring the old horizontal correction merely moved the large error from fine to coarse refinement. The new state retains physical segments, splits at the active fault and flow-region boundaries, moves only the hanging-wall pieces, and never transports an averaged projection. Open gaps remain gaps. Display and replay draw the actual segments.

The original rejected coupled A/C results were reproduced exactly before the ablations. In coupled A at x=4,400 m, rejected fault-depth values were 619.911 / 727.907 / 626.684 m at 40/20/10 m. Restoring the old carry correction gave 730.103 / 622.825 / 626.684 m: the error changed grid rather than disappearing. With physical gap mapping and retained branches, they are 642.268 / 646.893 / 644.897 m. The 20–10 m jump falls from 101.223 to 1.996 m and the 40–20 m jump from 107.996 to 4.625 m.

In the isolated no-compaction thrust A control, fault-depth fine-grid RMS falls from 13.258 m in the rejected prototype (8.698 m in the accepted baseline) to roundoff. For coupled C, the branch repair alone leaves every travel-time and material measurement unchanged while removing the geometry artifact. Physical-gap repair lowers that case's travel-time fine-grid RMS from 3.036 to 2.573 ms, still above the accepted baseline's 2.370 ms. The independent operation traces and ablations are summarized in `thrust-coupling-ablation.json`; mechanism controls are reproducible with `thrust-coupling-evidence.mjs`.

## Frozen comparison against the accepted normal-fault baseline

Same 12 cases, 40/20/10 m grids, prescribed histories, profile positions, 0–3,000 m support, interval eligibility, metrics and conservation tolerances. No parameter fitting or observational data.

| Quantity | Before 40–20 | After 40–20 | Before 20–10 | After 20–10 |
| --- | ---: | ---: | ---: | ---: |
| Fault depth (m) | 15.126 | 6.519 | 5.248 | 4.194 |
| Unit velocity (m/s) | 7.969 | 7.569 | 4.446 | 4.429 |
| Unit thickness (m) | 7.961 | 7.967 | 4.133 | 4.303 |
| Vertical travel time (ms) | 1.876 | 2.068 | 0.823 | 0.840 |

These pairs use 1,289 common unit/location triples, 190 common fault-depth samples and 144 travel profiles. Eligibility changes from 1,304 to 1,311 of 2,820 interval opportunities. Seven of the former 197 fault samples are absent on all three new grids because a cut left a real gap in the older trace; the previous column interpolation had bridged that gap. They are not replaced by zero or included in the paired error summary. All statuses and raw samples remain in the saved comparison.

Against the rejected prototype, on its separate shared cohort:

| Quantity | Before 40–20 | After 40–20 | Before 20–10 | After 20–10 |
| --- | ---: | ---: | ---: | ---: |
| Fault depth (m) | 16.715 | 6.519 | 9.330 | 4.194 |
| Unit velocity (m/s) | 8.053 | 7.608 | 4.590 | 4.530 |
| Unit thickness (m) | 7.914 | 8.000 | 4.352 | 4.381 |
| Vertical travel time (ms) | 1.783 | 2.068 | 0.980 | 0.840 |

The two tables have different shared interval cohorts and should not be mixed. Across all 1,311 currently eligible intervals, velocity fine-grid RMS is 4.566 m/s and its maximum is 38.917 m/s; this is a different cohort from the paired baseline comparison. On the accepted-baseline cohort, velocity noncontracting/new-change counts change from 410 to 412; thickness RMS worsens. Whole-profile travel-time RMS also remains slightly worse than the accepted baseline (0.823 to 0.840 ms), despite improvement over the rejected prototype (0.980 ms). Coupled A travel time changes from 0.636 to 0.719 ms and coupled C from 2.370 to 2.573 ms. This is a verified mechanism repair, not a claim that every numerical metric improved.

## Conservation and tests

All **93 JavaScript tests pass**, with zero failures or skips. Type checking and the production build pass. Sixteen added tests cover exact buried/emergent thrust geometry and interpolation, actual simulator integration at all three grids, physical versus numerical gap closure, compaction, subcell passive advection in both directions, cut/overlapping branches, subdivision invariance, and an independently derived 45° bend trajectory. The existing worker test additionally checks branch display, replay, and non-aliasing. The existing 40 m heave, 99% thrust consistency, 90% backlimb and compaction/budget gates are unchanged.

All **36/36 runs and 4,494 event budgets close**. An independent audit recomputed **755,160** total/component/bed balances. The maximum absolute event-component residual is 1.53854489e-06 m², within the original 1e-6 m² + 1e-10 × inventory-scale tolerance. No repair-added sediment, boundary relabeling or renormalization. All 21 no-fault and extension runs reproduce their previous ledgers and samples exactly.

## Limits and reproduction

The single-depth compatibility diagnostic is the mean of distinct branch intersections when a fault is multivalued; it is not a unique physical interface in that region. Actual branch segments are retained, advected and drawn independently. Active thrust flow remains a piecewise-linear approximation; passive deformation uses interpolated column maps. Reactivation of a cut passive thrust is explicitly rejected until a new flow geometry is prescribed. The current generator schedules thrusts one at a time and does not request reactivation. Integer-column normal heave, conservative cell-parcel thrust placement and open-boundary continuation still need further convergence work. Physical/observational accuracy is unestablished.

```sh
node --max-old-space-size=8192 --test --test-concurrency=1 tests/*.test.mjs
npm run check
node node_modules/vite/bin/vite.js build --configLoader runner
node validation/numerics/thrust-coupling-evidence.mjs
node --max-old-space-size=8192 validation/numerics/run.mjs data/numerics/thrust-coupling
node validation/numerics/compare-revisions.mjs data/numerics/fault-grid-sensitivity data/numerics/thrust-coupling validation/numerics/thrust-coupling-revision-comparison.json
```

Compact results, paired comparisons, ablations, analytical evidence, budget audit and source/test hashes are in `validation/numerics/thrust-coupling-*`. Full synthetic ledgers and matched samples are in ignored `data/numerics/thrust-coupling/`. Historical reports remain unchanged. The Python importer is unchanged and was not rerun. No observational development/holdout arrays or split files were read or changed; the existing exporter regression uses only synthetic computations and unchanged benchmark metadata. **Holdout untouched.**
