# Isolated thrust B repair — 2026-10-13

Thrust allocation now minimizes placement displacement weighted by occupied rock volume. The previous objective counted a tiny fragment as much as a full rock packet. This corrects a demonstrated allocation defect and substantially reduces the isolated thrust B thickness regression. Recovery is incomplete: overall fine-grid travel disagreement rises 8.15%, and coupled A coarse thickness RMS rises from 2.407 to 6.725 m. This is not uniform convergence or a field-accuracy claim.

## Diagnosis and correction

Almost all of thrust B's fine-grid thickness discrepancy came from unit 12 at x=5,200 m. It was deposited after the final thrust movement, so its discrepancy was caused by the space left for deposition. The preceding 20–10 m storage-surface difference was 17.818 m; the fixed fill fraction 0.895950 converted that to 15.964 m of bed-thickness disagreement. The repair reduces the bed difference to 3.271 m. Its 40/20/10 m thicknesses change from 166.953/183.941/167.978 m to 166.953/171.248/167.978 m.

The allocator formerly minimized one squared placement distance per moving packet, even when a packet contained only a small rock fragment plus water. It now multiplies that cost by occupied non-water height divided by grid spacing. This integrates the squared storage-placement displacement over represented rock area, up to a common grid-scale factor. Basement contributes; water does not. Capacity still uses the entire packet height. Retained and incoming packets use the same rule. No grain quantities, constituent histories, boundary fluxes, geometry, physical parameters or radius limits are rescaled or retuned. Omitted API weights retain the previous unit-weight behavior; explicit invalid weights fail without mutating inputs.

An independent two-choice fixture explains the correction: a full packet targeting x=0.2 and a tenth-full packet targeting x=0.1 compete for positions 0 and 1. Equal packet counting keeps the thin packet nearest; integrated rock displacement instead keeps the full packet nearest. The occupied-area cost falls from 0.641 to 0.121. This fixture does not depend on a simulation seed or measured grid error.

The same-input diagnostic also solves all eight thrust B slips with both objectives while preserving the baseline trajectory. Weighted costs fall at every slip, by about 0.07–0.32%. At x=6,000 and 6,800 m, reduced final travel disagreement is accompanied by lower sums of absolute bed-level disagreements, rather than solely better cancellation. Substantial per-bed differences remain. The cost is an allocation objective, not a measured physical-advection error; a small cost reduction does not imply a proportional increase in geological accuracy.

## Same frozen 40/20/10 m study

The twelve histories, seeds, process parameters, grids, profile locations, 0–3,000 m travel support, interval eligibility rules, metrics and tolerances are unchanged. The following numbers are RMS differences between grids, not errors against truth.

**Isolated thrust B**, using 55 common intervals and twelve common travel profiles:

| Quantity | Before 40–20 | After 40–20 | Before 20–10 | After 20–10 |
| --- | ---: | ---: | ---: | ---: |
| Unit thickness (m) | 2.314 | 0.711 | 2.156 | 0.459 |
| Vertical travel time (ms) | 0.469 | 0.439 | 0.198 | 0.131 |
| Unit velocity (m/s) | 0.929 | 0.282 | 0.867 | 0.188 |
| Fault depth (m) | 0.000 | 0.000 | 0.000 | 0.000 |

**All twelve cases**, using 1,278 common intervals, 144 travel profiles and 190 fault-depth samples:

| Quantity | Before 40–20 | After 40–20 | Before 20–10 | After 20–10 |
| --- | ---: | ---: | ---: | ---: |
| Unit thickness (m) | 7.618 | 7.553 | 3.883 | 3.814 |
| Vertical travel time (ms) | 1.542 | 1.371 | 0.567 | 0.613 |
| Unit velocity (m/s) | 7.306 | 7.394 | 3.949 | 3.942 |
| Fault depth (m) | 6.498 | 6.486 | 4.120 | 4.118 |

Eligibility changes from 1,299 to 1,305 of 2,820 opportunities: 21 previously eligible intervals are lost and 27 gained. Every transition and its exclusion reason is retained in the matched audit. Shared and whole-cohort summaries remain separate. All 21 no-fault/extension runs reproduce the previous ledgers and matched samples exactly.

**Compression cases**, each on its own shared cohort:

| Case | Shared intervals | Fine thickness before → after (m) | Fine travel before → after (ms) |
| --- | ---: | ---: | ---: |
| thrust-a | 72 | 1.329 → 1.183 | 0.100 → 0.201 |
| thrust-b | 55 | 2.156 → 0.459 | 0.198 → 0.131 |
| coupled-compression-a | 49 | 2.697 → 2.682 | 0.345 → 0.382 |
| coupled-compression-b | 93 | 1.748 → 1.314 | 0.131 → 0.274 |
| coupled-compression-c | 63 | 3.613 → 2.934 | 1.579 → 1.747 |

On all shared compression intervals, fine thickness RMS changes from 2.358 to 1.876 m; fine travel RMS changes from 0.732 to 0.816 ms. The complete summary also retains whole-cohort maxima and noncontracting classifications.

## Recovery against the earlier version

The earlier version before fractional fault cuts had lower isolated B fine-grid disagreement. On exactly 54 intervals shared across all three versions, with twelve travel profiles:

| Quantity | Before fractional cut | Current baseline | Weighted repair |
| --- | ---: | ---: | ---: |
| Unit thickness (m) | 0.221 | 2.176 | 0.463 |
| Vertical travel time (ms) | 0.073 | 0.198 | 0.131 |
| Unit velocity (m/s) | 0.089 | 0.875 | 0.190 |

These numbers show partial recovery, not elimination of the historical regression. The earlier near-zero thickness discrepancy was not proof of physical correctness: its nearly equal stored surfaces concealed a roughly 10 m disagreement in remembered surface-marker depths. Remembered material markers are not a reconstructed physical free surface.

## Regressions and deferred changes

For the four headline quantities, every case/scale RMS increase relative to the current baseline above a 1e-10 native-unit reporting threshold is listed below. The complete revision-comparison JSON also retains 35 increases in the other recorded quantities, including interval top, grain thickness, composition, porosity, burial/loading and seafloor. That threshold is only for display; no acceptance threshold was changed.

| Case | Quantity | Grid pair | Before | After |
| --- | --- | --- | ---: | ---: |
| thrust-a | Vertical travel time (ms) | 20–10 | 0.100 | 0.201 |
| coupled-compression-a | Unit thickness (m) | 40–20 | 2.407 | 6.725 |
| coupled-compression-a | Vertical travel time (ms) | 40–20 | 0.306 | 0.567 |
| coupled-compression-a | Vertical travel time (ms) | 20–10 | 0.345 | 0.382 |
| coupled-compression-a | Unit velocity (m/s) | 40–20 | 2.005 | 3.166 |
| coupled-compression-a | Unit velocity (m/s) | 20–10 | 0.987 | 1.162 |
| coupled-compression-a | Fault depth (m) | 40–20 | 2.834 | 2.896 |
| coupled-compression-a | Fault depth (m) | 20–10 | 0.394 | 0.472 |
| coupled-compression-b | Vertical travel time (ms) | 20–10 | 0.131 | 0.274 |
| coupled-compression-b | Unit velocity (m/s) | 40–20 | 2.843 | 3.269 |
| coupled-compression-b | Fault depth (m) | 20–10 | 0.155 | 0.331 |
| coupled-compression-c | Vertical travel time (ms) | 20–10 | 1.579 | 1.747 |
| coupled-compression-c | Unit velocity (m/s) | 40–20 | 6.152 | 7.575 |
| coupled-compression-c | Unit velocity (m/s) | 20–10 | 1.925 | 2.055 |

The largest new coarse-thickness regression is concentrated at x=8,400 m in coupled A: five common eligible rows explain 99.41% of its increased squared discrepancy. Much of the unit-9/unit-10 difference is created upstream at x=8,720 m during step 11 and carried into the column at the final step-12 slip; a unit-7 packet is also allocated into a neighboring column. Subsequent deposition and compaction propagate the changed column inventory. The traced output reproduces the archived intervals within 1.14e-13 m, with closed budgets and no direct boundary influx into this column. Coupled C accounts for 85.70% of the overall increase in squared fine-grid travel discrepancy. These are genuine shared-sample changes, not eligibility artifacts.

Restoring the older column-major processing order gives mixed results: it can improve isolated B travel, but worsens isolated A and several coupled metrics. Equal-cost tie ordering is not a physical calibration parameter, so it was left unchanged. A separate motion-centroid correction has an independent analytical justification but produces inconsistent coupled results; it was also deferred. Their source-hashed pilots and shared-cohort comparisons are retained.

The cut remains exact in represented column coordinates, not arbitrary displaced physical polygons. Motion sampling near bends and the choice among equally optimal discrete assignments remain limitations. Indivisible packets still occupy distinct cells within the existing two/three-cell stencil; some volume-feasible packings remain infeasible and throw explicitly. These issues need separate corrections with analytical tests rather than seed-specific tuning. Three grids do not establish asymptotic convergence, and the 10 m result is not ground truth.

## Tests, conservation and reproduction

All **108 tests pass**, with zero failures, cancellations or skips. Type checking and the production build pass. Five new tests cover the independent weighted-choice fixture, optional-weight compatibility and invalid inputs, 300 exhaustive capacity-constrained problems, tiny positive weights and scale invariance of the known-answer choice, and actual constituent-preserving transport in both directions at 40/20/10 m. The simulator fixture checks output columns, conserved grains, composition, both burial memories, stationary footwall and zero boundary flux. Existing physical acceptance gates are unchanged.

The separate 2,000-case exhaustive audit verifies feasible weighted assignments and correctly rejected impossible ones, including third-cell fallback and tiny weights. Omitted and explicit unit weights reproduce the cost-only legacy ablation. Numerical optimality is compared with an absolute tolerance, so tiny individual terms do not have a guaranteed small relative error. The ablation also demonstrates that the new mechanism tests catch removal of weighting.

All **36/36 runs and 4,494 event budgets close**. The independent audit recomputes **755,160** total, constituent and bed balances. Maximum absolute event-component residual is 3.00072134e-06 m², within the original 1e-6 m² + 1e-10 × inventory-scale tolerance. Repair-added sediment is zero.

```sh
node --max-old-space-size=8192 --test --test-concurrency=2 tests/*.test.mjs
npm run check
node node_modules/vite/bin/vite.js build --configLoader runner
node validation/numerics/thrust-b-weighted-evidence.mjs --ablation-tests
node --max-old-space-size=8192 validation/numerics/run.mjs data/numerics/thrust-b-repair
node validation/numerics/compare-revisions.mjs data/numerics/travel-thickness data/numerics/thrust-b-repair validation/numerics/thrust-b-revision-comparison.json
```

Compact results, both historical comparisons, full eligibility audit, three-way isolated B comparison, mechanism evidence, rejected alternatives, independent review, allocator audit and final hashes are stored in `validation/numerics/thrust-b-*`. The fifty full synthetic JSON files are retained under ignored `data/numerics/thrust-b-repair/`. Earlier reports remain intact. No observational development/holdout arrays or split files were read or modified. The existing synthetic exporter test uses only the unchanged helper and benchmark metadata. **Holdout untouched.**


## Follow-up diagnosis (2026-10-13)

The [constituent-flow follow-up](coupled-travel-repair.md) traced the dominant coupled A unit-volume difference farther upstream: it originates in the step-9 lateral packet exchange at x=10,160 m, before unit-9 deposition. Step 11 at x=8,720 m carries the existing difference onward. The earlier attribution above is superseded by the source-hashed causal trace in `validation/numerics/coupled-travel-a-diagnosis.json`.
