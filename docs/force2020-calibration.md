# FORCE 2020 coefficient calibration — 2026-10-14

**No calibration was adopted.** Refitting the velocity law's global coefficients
on the 442 development windows does not reduce out-of-sample error. The best
set's leave-one-parent-well-out MAE is 324.4 m/s against 309.5 m/s for the
unchanged coefficients, and its paired interval includes zero. The error is
dominated by per-well offsets that cluster by area, not by the shape of the
global porosity-depth law.

The [plan](../validation/force2020/calibration-plan.json) was frozen before any
fitted error was inspected. It uses the actual `rockVelocity` and `porosity`
functions from `src/basin.ts` with coefficients overridden in memory, the same
1 m slowness quadrature per 20 m bin as the exporter, the same 442 windows,
equal parent-well weighting, and the 24 holdout wells untouched.

## Benchmark reproduction

Before fitting, the [first development comparison](force2020-development.md)
was rerun on this machine from the original five FORCE downloads (all SHA-256
checksums match), a fresh SODIR exploration-wellbore export, and the current
simulator source. The importer reproduces every intake count and the frozen
split. The comparison reproduces 309.477 m/s MAE on 442 windows from 44 wells
with the identical paired interval. The transport repairs made after Oct 12
did not change the velocity law.

## Parameter sets and results

| Set | Coefficients | In-sample MAE, m/s | Leave-one-well-out MAE, m/s | LOO minus untuned, m/s [95%] |
| --- | --- | ---: | ---: | --- |
| Untuned reference | none | 309.5 | 309.5 | — |
| Depth-only baseline | 2, out-of-well | — | 348.2 | +38.8 [−1.1, +83.0] |
| A compaction | shale and sand φ₀, L | 309.1 | 324.4 | +14.9 [−9.4, +38.1] |
| B A + cementation window | A + cementFrom, width | 295.7 | 339.1 | +29.6 [−5.0, +65.7] |
| C B + coordination number | B + n | 297.9 | 330.2 | +20.7 [−11.6, +52.0] |
| D A + overpressure top | A + pressure top | 308.0 | 328.7 | +19.2 [−7.5, +45.3] |

Every set fits the development windows better in sample than the untuned law
and predicts held-out wells worse. More coefficients widen that gap. Fold
coefficients are unstable: set A's sand e-folding depth reaches its 12 km bound
in most folds (53 sandstone windows from 24 wells), and set C's coordination
number ranges from 3.0 to 13.3 across folds. By the pre-registered rule, set A
is chosen and not adopted. The source coefficients are unchanged.

## Why the global law cannot absorb the error

Decomposing each well's errors under the untuned law, with equal well weight:

| Component | m/s |
| --- | ---: |
| Mean absolute per-well offset | 278 |
| Mean within-well scatter about that offset | 133 |
| MAE | 309 |

Twenty-four of 44 wells have an offset larger than 200 m/s. The offsets cluster
by North Sea quadrant:

| Quadrant | Wells | Mean well offset, m/s | Reading |
| --- | ---: | ---: | --- |
| 31, 32, 35 | 15 | −413, −700, −256 | observed rock faster than the model: deeper past burial, older strata, or cementation |
| 15, 16 | 10 | +266, +145 | observed rock slower than the model: young, undercompacted or overpressured |
| 25 | 15 | +29 | mixed, both signs present |

A single global porosity-depth or cementation curve cannot be too slow in one
area and too fast in another at the same depth and facies. The missing input is
burial and pressure history per well, which the released FORCE data do not
supply and which the basin generator is meant to produce. These are observed
correlations in a selected cohort, not a confirmed uplift or pressure map.

## Consequences

1. Global-coefficient tuning is closed as a route to lower error on this cohort.
   The untuned Sclater–Christie and soft-sand coefficients stay.
2. The next test must attach context to each window: lithostratigraphic group
   and formation from the supplied NPD picks, well location, and an explicit
   maximum-burial or pressure scenario per area. Any area-level fit must be
   cross-validated by area, not by well, before claiming regional generalization.
3. The sandstone cohort is too small to constrain sand coefficients. Expanding
   coverage to mixed and thin beds, as planned, comes before any sand refit.
4. The holdout remains unscored. No set was adopted, so there is nothing to
   score on it yet.

## Reproduce and verify

```sh
npm test -- tests/calibration.test.mjs
node validation/force2020/model-profiles.mjs
python validation/force2020/compare.py --downloads /path/to/original/downloads
npm run calibrate:force2020
```

The run takes about four minutes. Full results, per-fold coefficients and
per-window cross-validated predictions are in `data/force2020/calibration/`;
the compact report is [calibration-results.json](../validation/force2020/calibration-results.json).

Verification: seven new tests cover the optimizer on a known quadratic, live
coefficient override and exact restore, exporter-equivalent quadrature, equal
parent weighting, deterministic bootstrap, recovery of known compaction
coefficients from noise-free synthetic windows, and CSV parsing with the
Python writer's line endings. The calibration script refuses to run if the
untuned profile does not reproduce the stored comparison predictions.
