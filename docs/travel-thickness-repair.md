# Travel-time and thickness repair — 2026-10-12

Two verified defects are repaired: compaction no longer erases a parcel's displacement, and thrust transport leaves the below-fault portion of a mixed cell stationary. The frozen study improves fine-grid thickness and travel-time agreement overall and in all three coupled compression cases. The isolated thrust B case still worsens; this is not uniform convergence or a field-accuracy claim.

## Diagnosis and changes

1. **Compaction cleared physical displacement.** A parcel's physical interval is its stored interval translated by `offsetZ`. Setting that translation to zero moved material even when the compaction step did not change its thickness. Compaction now preserves the translation while shortening against the translated bottom. Eighteen analytical storage-coordinate fixtures pass; the former reset passes six and can misplace an interface by 52 m. Scaling the translation by the compaction ratio was independently rejected: it moves the anchored physical bottom and passes only twelve fixtures. Composition, solid volume and irreversible memories are unchanged.
2. **Whole-cell thrust motion carried material below a fractional fault cut.** At 20 m spacing, a fault at 25 m incorrectly moved a bed at 30–35 m because both occupied one flagged cell. The remapper now splits each represented column at the fault, moves only its hanging-wall packet, and leaves footwall constituents in place. Destination assignment respects the available hanging-wall height. Only the moving portion's offsets determine its trajectory. Grain accounting includes only the portions actually transported across open boundaries.
3. **Partial allocation water needs an exact extent.** The remapper records the interval of newly introduced numerical water within each cell. Packing intersects that interval with actual gaps, so adjoining natural water still produces its physical closure. An entire mixed cell is no longer treated as numerical padding. The existing provenance test checks actual output constituents after assembly and rasterization, including composition, both memories, height and grains.

The thickness mechanism was traced before modifying it. In quiet thrust A at x=2,000 m, the archived normal-fault and thrust-coupling versions at 20 m differed by a full 20 m storage gap before deposition despite physical surface positions differing by only 0.245 m. The prescribed fill of 0.851614 converted that storage difference into 17.032 m of unit-14 thickness. That bed formed after the final slip, so directly transporting it could not explain the error. Coupled C also showed material redistribution during slip before compaction amplified it. Source-hashed reruns reproduced all 96 archived travel profiles in the diagnostic subset exactly; a separate continuous-slowness calculation agreed within 12 ns. The travel-time extractor was not the defect.

## Same frozen 40/20/10 m comparison

The same twelve histories, seeds, process parameters, grid spacings, twelve profile positions, 0–3,000 m travel support, interval eligibility, metric code and conservation tolerances are retained. No observational data or parameter fitting. The tables report RMS differences. Smaller values below mean better agreement between grid spacings, not error against a known truth.

| Quantity | Before 40–20 | After 40–20 | Before 20–10 | After 20–10 |
| --- | ---: | ---: | ---: | ---: |
| Unit thickness (m) | 7.804 | 7.659 | 4.265 | 3.877 |
| Vertical travel time (ms) | 2.068 | 1.542 | 0.840 | 0.567 |
| Unit velocity (m/s) | 7.615 | 7.308 | 4.446 | 3.951 |
| Fault depth (m) | 6.519 | 6.498 | 4.194 | 4.120 |

This paired table uses **1,277 common unit/location triples**, **190 common fault-depth samples** and **144 common travel profiles**. Overall interval eligibility changes from 1,311 to 1,299 of 2,820 opportunities: 34 are lost and 22 gained. Shared-cohort comparisons are kept separate from whole-cohort results. Missing or fragmented intervals and absent fault branches retain explicit statuses; no unavailable value is replaced with zero. All seven no-fault/extension case samples and their 21 grain-budget runs reproduce the previous version exactly. Across the entire new cohort of 1,299 eligible intervals (a different cohort from the paired table), fine-grid thickness RMS is 3.905 m and velocity RMS is 3.924 m/s; their maxima remain 46.045 m and 38.917 m/s. There are still 357 thickness triples and 355 velocity triples classified as noncontracting or new-change.

Among the five compression cases alone, the same shared samples improve fine-grid thickness RMS from 4.191 to 2.313 m, travel time from 1.208 to 0.732 ms, velocity from 4.240 to 1.397 m/s, and fault depth from 1.310 to 0.744 m.

| Case | Shared intervals | Thickness before → after (m) | Travel time before → after (ms) |
| --- | ---: | ---: | ---: |
| thrust-a | 74 | 3.464 → 1.311 | 0.297 → 0.100 |
| thrust-b | 54 | 0.221 → 2.176 | 0.073 → 0.198 |
| coupled-compression-a | 48 | 4.137 → 2.723 | 0.719 → 0.345 |
| coupled-compression-b | 96 | 2.025 → 1.749 | 0.264 → 0.131 |
| coupled-compression-c | 59 | 7.927 → 3.536 | 2.573 → 1.579 |

These case rows are 20–10 m differences on each case's shared cohort. They do not use a changed eligibility rule to claim improvement.

The compaction-only ablation reduced fine-grid travel-time RMS from 0.840 to 0.704 ms. Adding the fractional fault cut and exact numerical-water ranges reduces it further to 0.567 ms on the same 144 profiles. Separate ablation files retain their own source hashes and shared interval cohorts.

## Remaining regressions

Quiet thrust B worsens in fine-grid thickness, velocity and travel time. Almost all of its added squared thickness discrepancy comes from unit 12 at x=5,200 m: the 20–10 m difference changes from approximately zero to 15.964 m. That bed forms after the final thrust increment. Candidate storage surfaces differ by 17.818 m before deposition, and the unchanged fill factor 0.895950 produces the bed difference. Previously, nearly identical storage surfaces hid a 10 m difference in remembered surface-marker depths including offsets. The corresponding remembered surface-marker depth disagreement improves slightly, from 10.000 to 8.875 m. These markers share the same physical x=5,202.843 m; they are not a reconstructed physical free surface. The travel-time regression is concentrated at different profiles, x=6,000 and 6,800 m. This identifies remaining allocation/accommodation sensitivity; the old near-zero thickness difference was not independent evidence of correct physical positioning.

Coarse-grid thickness also worsens in quiet thrust A (3.464→6.514 m) and coupled B (4.428→5.616 m). Coupled C fault-depth RMS worsens from 1.671→2.124 m on 40–20 m and 0.833→1.295 m on 20–10 m. Coupled A's new fine thickness and travel-time differences exceed its coarse differences. These results are retained, not hidden by the improving aggregate.

For comparison with the earlier normal-fault repair, on its separate shared cohort of 1,274 intervals:

| Quantity | Before 40–20 | After 40–20 | Before 20–10 | After 20–10 |
| --- | ---: | ---: | ---: | ---: |
| Unit thickness (m) | 7.923 | 7.622 | 4.135 | 3.882 |
| Vertical travel time (ms) | 1.876 | 1.542 | 0.823 | 0.567 |
| Unit velocity (m/s) | 7.714 | 7.329 | 4.359 | 3.951 |
| Fault depth (m) | 15.126 | 6.498 | 5.248 | 4.120 |

Relative to that older version, quiet thrust B still has worse fine thickness and velocity; coupled A fine thickness changes from 2.592 to 2.844 m. The two comparison cohorts differ and their numbers must not be mixed.

## Tests and conservation

All **103 tests pass**, with zero failures or skips. Type checking and the production build pass. Ten new tests cover compaction identity and anchored physical positions, very thin displaced layers, fractional hanging-wall/footwall cuts at all three grids in both directions, partial boundary grain flux, zero-slip identity, capacity conflicts and impossible placement, exact water-gap handling, and independence from footwall offsets. The existing transport provenance test now checks the actual assembled output. Existing 40 m heave, 99% thrust consistency, 90% backlimb, pressure, compaction and grain-budget acceptance gates are unchanged.

An independent exhaustive allocator audit passes **1,000 cases**: 773 optimal feasible assignments (700 using radius two; 73 using radius three), and 227 correctly rejected impossible assignments. There is no input mutation and no discrepancy in assignment cost. The seed and source hashes are recorded.

All **36/36 runs and 4,494 event budgets close**. A separate audit recomputes **755,160** total/component/bed balances. The largest event-component residual is 1.25542283e-06 m², within the original 1e-6 m² + 1e-10 × inventory-scale tolerance. Repair-added sediment is zero. There is no grain rescaling, normalization or relabeling of interior losses as boundary flux.

## Limits and reproduction

The fractional cut is exact in the represented column coordinates; it does not perform arbitrary polygon intersection in each constituent's displaced physical coordinates. Whole moving packets still occupy distinct cells using a bounded minimum-cost assignment. Some volume-feasible configurations cannot accommodate indivisible packets and explicitly throw; they are not repaired by deleting grains. Remaining deposition-space and lateral-placement sensitivity needs further work. A broader polygon prototype was rejected because fragments grew to millions, its finest run did not complete, and its boundary prescription changed. Surface-only corrections were also rejected after worsening coupled results.

Three grids do not establish an asymptotic convergence order, and the 10 m result is not ground truth. Observational accuracy remains untested here.

```sh
node --max-old-space-size=8192 --test --test-concurrency=2 tests/*.test.mjs
npm run check
node node_modules/vite/bin/vite.js build --configLoader runner
node validation/numerics/travel-thickness-evidence.mjs
node validation/numerics/travel-thickness-capacity-evidence.mjs
node --max-old-space-size=8192 validation/numerics/run.mjs data/numerics/travel-thickness
node validation/numerics/compare-revisions.mjs data/numerics/thrust-coupling data/numerics/travel-thickness validation/numerics/travel-thickness-revision-comparison.json
```

Compact results, both historical comparisons, the compaction-only ablation and cut ablation, diagnosis evidence, capacity audit, budgets and final hashes are saved in `validation/numerics/travel-thickness-*`. The 50 full synthetic JSON files are retained under ignored `data/numerics/travel-thickness/`. Historical reports are preserved. No observational development/holdout arrays or split files were read or modified. The existing exporter regression uses only the unchanged synthetic helper and benchmark metadata. Python importer tests were not rerun because that path was unchanged. **Holdout untouched.**
