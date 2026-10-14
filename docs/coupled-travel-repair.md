# Constituent thrust transport and coupled-grid comparison

Date: 2026-10-13. Synthetic development comparison only. **Holdout untouched.**

This repair integrates each constituent’s fault-parallel displacement over its represented rectangular area and retains its own transported position. It replaces motion evaluated at the storage-cell top and a common translation for geometrically different constituents. A layer can cross a bend only in part; moving one representative point is not its average motion. Temporary polygon cuts calculate the first moment without adding stored material fragments.

Allocation now uses an exact integer solver for a declared quantized volume-weighted objective. Edge costs are rounded at 1e-12 of the largest parcel weight. Integer path sums and dual potentials, plus deterministic destination ties, prevent inconsistent floating-point decisions between solver stages. Within the chosen stencil, the raw cost gap is bounded by N × 1e-12 × maximum weight, apart from floating cost-evaluation roundoff. Small positive packets are retained even when their costs quantize to zero. Quantization boundaries and input-order changes can still select another tied solution.

No physics parameters, histories, grid spacings, boundary-continuation rules, eligibility rules, metrics, conservation tolerances or existing physical acceptance gates were tuned. The packet radius remains two cells, or three only if the smaller assignment is infeasible. The retained outflow rule still classifies whole packets by rounded targets; correcting motion can therefore change which packets cross that unchanged boundary rule.

## Diagnosed mechanism

The original coupled A regression is caused by lateral allocation and subsequent accommodation. At step 9, x=10,160 m receives 40.014719 m more sediment bulk and 20.913289 m more solid grains than the pre-weighting version. Basement is unchanged and there is no internal water gap. The extra sediment raises the stored surface and reduces unit 9 deposition by 32.032853 m. The deposition equation reproduces that difference within 2.14e-14 m. The deficit then travels downstream through x=9,440 and 8,720 m to x=8,400 m. The earlier step-11 diagnosis identified its propagation, not its origin.

Travel-time discrepancies reflect changed composition, deposition and compaction, not missing sediment. In coupled C, one affected profile exchanges slower clastic material with faster carbonate; another accumulates downstream deposition and compaction changes. Independent smooth slowness integration shows that quadrature error is much smaller than these changes. The frozen travel-time metric was therefore retained. A remembered top-material marker is not a reconstructed physical free surface.

## Frozen 40/20/10 m comparison

The same twelve cases and three grids were rerun. All comparisons below use identical eligible keys in both revisions. “Before” is the occupied-rock weighted thrust revision; “after” is this correction. The complete report also retains whole-cohort metrics, maxima and convergence classifications.

Eligible intervals: 1305 → 1301 of 2820; 1283 shared, 22 lost and 18 gained. Travel comparisons contain all 144 unchanged profile locations. No-fault and extension controls are unchanged.

| Quantity | Unit | Shared samples | 40–20 m RMS | 20–10 m RMS |
| --- | --- | --- | --- | --- |
| Unit thickness | m | 1283 | 7.557 → 7.668 | 3.828 → 3.824 |
| Vertical travel time | ms | 144 | 1.371 → 1.554 | 0.613 → 0.514 |
| Unit velocity | m/s | 1283 | 7.323 → 7.414 | 3.960 → 3.927 |
| Fault depth | m | 190 | 6.486 → 6.493 | 4.118 → 4.112 |

| Case | Shared intervals | Thickness 40–20 (m) | Thickness 20–10 (m) | Time 40–20 (ms) | Time 20–10 (ms) |
| --- | --- | --- | --- | --- | --- |
| thrust-a | 78 | 3.501 → 4.799 | 1.137 → 2.351 | 0.521 → 0.433 | 0.201 → 0.560 |
| thrust-b | 56 | 1.087 → 4.991 | 1.172 → 2.322 | 0.439 → 0.600 | 0.131 → 0.333 |
| coupled-compression-a | 46 | 6.940 → 4.519 | 2.767 → 2.768 | 0.567 → 0.423 | 0.382 → 0.172 |
| coupled-compression-b | 96 | 4.754 → 5.173 | 1.820 → 1.129 | 0.259 → 0.226 | 0.274 → 0.156 |
| coupled-compression-c | 61 | 6.926 → 7.907 | 2.941 → 1.477 | 3.265 → 4.142 | 1.747 → 1.233 |

## Historical recovery on a single shared cohort

All five original coupled A outliers at x=8,400 m remain eligible in every revision. Their coarse thickness RMS changes from 19.601 to 0.387 m, close to the pre-weighting 0.346 m. Their fine thickness RMS worsens from 0.114 to 0.370 m. This fixed subset is reported separately from the full coupled A cohort.

| Revision | Original five: 40–20 RMS (m) | Original five: 20–10 RMS (m) |
| --- | --- | --- |
| Pre-weighting | 0.346 | 0.125 |
| Weighted baseline | 19.601 | 0.114 |
| Correction | 0.387 | 0.370 |

The three-way comparison retains exactly the same samples across the pre-weighting version, current weighted baseline, and correction. Coupled A uses 46 intervals; isolated B uses 55. Both use twelve travel profiles.

| Case | Quantity | Grid pair | Pre-weighting | Weighted baseline | Correction |
| --- | --- | --- | --- | --- | --- |
| coupled-compression-a | Unit thickness (m) | 40–20 | 2.482 | 6.940 | 4.519 |
| coupled-compression-a | Unit thickness (m) | 20–10 | 2.782 | 2.767 | 2.768 |
| coupled-compression-a | Vertical travel time (ms) | 40–20 | 0.306 | 0.567 | 0.423 |
| coupled-compression-a | Vertical travel time (ms) | 20–10 | 0.345 | 0.382 | 0.172 |
| thrust-b | Unit thickness (m) | 40–20 | 2.314 | 0.711 | 4.031 |
| thrust-b | Unit thickness (m) | 20–10 | 2.156 | 0.459 | 0.458 |
| thrust-b | Vertical travel time (ms) | 40–20 | 0.469 | 0.439 | 0.600 |
| thrust-b | Vertical travel time (ms) | 20–10 | 0.198 | 0.131 | 0.333 |

## Every headline RMS increase

This table lists all 20 headline case/scale increases above a 1e-10 native-unit display threshold. The threshold affects reporting only. The supplemental field audit retains another 41 increases in other recorded quantities, and the coverage report retains every lost or gained interval.

| Case | Quantity | Grid pair | Before | After |
| --- | --- | --- | --- | --- |
| thrust-a | Unit thickness (m) | 40–20 | 3.501 | 4.799 |
| thrust-a | Unit thickness (m) | 20–10 | 1.137 | 2.351 |
| thrust-a | Vertical travel time (ms) | 20–10 | 0.201 | 0.560 |
| thrust-a | Unit velocity (m/s) | 40–20 | 1.208 | 1.547 |
| thrust-a | Unit velocity (m/s) | 20–10 | 0.356 | 0.737 |
| thrust-b | Unit thickness (m) | 40–20 | 1.087 | 4.991 |
| thrust-b | Unit thickness (m) | 20–10 | 1.172 | 2.322 |
| thrust-b | Vertical travel time (ms) | 40–20 | 0.439 | 0.600 |
| thrust-b | Vertical travel time (ms) | 20–10 | 0.131 | 0.333 |
| thrust-b | Unit velocity (m/s) | 40–20 | 0.482 | 2.106 |
| thrust-b | Unit velocity (m/s) | 20–10 | 0.557 | 1.134 |
| coupled-compression-a | Unit thickness (m) | 20–10 | 2.767 | 2.768 |
| coupled-compression-a | Unit velocity (m/s) | 20–10 | 1.198 | 1.205 |
| coupled-compression-b | Unit thickness (m) | 40–20 | 4.754 | 5.173 |
| coupled-compression-b | Unit velocity (m/s) | 40–20 | 3.751 | 4.274 |
| coupled-compression-b | Fault depth (m) | 40–20 | 0.489 | 0.666 |
| coupled-compression-c | Unit thickness (m) | 40–20 | 6.926 | 7.907 |
| coupled-compression-c | Vertical travel time (ms) | 40–20 | 3.265 | 4.142 |
| coupled-compression-c | Unit velocity (m/s) | 40–20 | 5.992 | 7.647 |
| coupled-compression-c | Fault depth (m) | 40–20 | 1.853 | 1.995 |

## Tests and conservation

All **117 distinct tests are verified across the initial full run and a targeted rerun**, with no skipped or cancelled tests. The initial full run reported 116 passes and one failure: an existing bend-crossing fixture expected an advected top point, whereas the corrected transport stores the represented material’s mean displacement. That fixture now uses an independent closed-form area integral and retains its original 20 m RMS and 40 m maximum displacement gates. The complete 15-test thrust file was rerun successfully; the other 102 tests and every production source file are unchanged. The original failed log and successful rerun log are both retained. No failed test was hidden or tolerance relaxed. The nine new tests cover a closed-form partially crossed bend, horizontal and vertical partition additivity, reversed and mirrored flow, tiny positive intervals, actual constituent positions across storage shifts, conservation and unchanged histories/footwall, stable trajectory displacement, exhaustive quantized matching, numerical ties and quantization boundaries, tiny weights, scaling, and half-cell input tolerance. Type checking and the production build pass. Independent ablation tests confirm that common constituent translation and the old floating solver are detected.

All **36/36 runs and 4,494 operation budgets close**. The independent audit recomputes **755,160** scalar total/bed/component balances, verifies event continuity, and finds no repair-added sediment. Maximum absolute residual: 2.28732824e-06 m². Worst residual/tolerance ratio: 0.0022390085. The original tolerance is 1e-6 m² + 1e-10 × inventory scale.

## Limits and rejected alternatives

A new coupled A unit-7 discrepancy at x=9,200 m remains: its signed 40–20 m thickness difference changes from −0.708 to −25.216 m. An extra incoming edge packet raises the boundary column, reduces later deposition, and that deficit travels inward. Isolated B also worsens on the current shared cohort: its 20–10 m thickness RMS changes from 1.172 to 2.322 m, chiefly because an extra 10 m packet changes the accommodation for unit 12. The historical three-way B cohort excludes that unit-12 interval at x=6,000 m, so its slightly improved fine-thickness result does not establish recovery for all current B samples.

The original coupled A measurements improve, but this is not a uniform convergence result. Indivisible packets can still shift a column’s material inventory by approximately a grid cell, which changes later accommodation. New or remaining local defects, coarse travel-time disagreement, eligibility changes and all recorded-field regressions remain visible in the evidence. The correction retains an area first moment; it does not retain a deforming polygon mesh or reconstruct exact material footprints across repeated events. Fault cuts remain exact in represented column coordinates. Physical vertical order can differ from packed column order.

Whole-column locking was rejected because valid cases have more packets than admissible cells; it also cannot remove the traced packet that already occupies its rounded physical target. Horizontal-first optimization and post-assignment ordering gave mixed or worse results. A persistent geometric representation would address a broader limitation, but requires consistent compaction, erosion, deposition and boundary coupling. The earlier polygon prototype is not a safe drop-in replacement: remaking each clipped piece into a full-width layer creates artificial repeated splitting and rapid memory growth.

Locking only incoming boundary packets conserved sediment in all twelve pilot runs and reduced the new A discrepancy, but revived the original five A outliers: their coarse thickness RMS returned from 0.387 to 19.668 m. Fixing incoming slots rerouted retained packets, changing column accommodation and future boundary donors. This alternative was rejected.

Three grids do not prove an asymptotic convergence rate, and 10 m is not ground truth. Grid agreement is not validation against independent geology or field velocities.

## Reproduction and retained evidence

```sh
node --max-old-space-size=8192 --test --test-concurrency=2 tests/*.test.mjs
npm run check
node node_modules/vite/bin/vite.js build --configLoader runner
node --max-old-space-size=8192 validation/numerics/run.mjs data/numerics/coupled-travel-repair
```

The fifty raw synthetic JSON files are retained under ignored `data/numerics/coupled-travel-repair/`. Paired and three-way reports, all-field and eligibility audits, causal diagnoses, geometry/allocator audits, rejected alternatives, test ablations, code review, and verified hashes are under `validation/numerics/coupled-travel-*`. Earlier study results remain intact. No observational development or holdout arrays or split files were read or changed. The unchanged synthetic exporter test uses only its helper and benchmark metadata.
