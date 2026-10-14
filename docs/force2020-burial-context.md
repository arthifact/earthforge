# FORCE 2020 burial-state context — 2026-10-14

**A single burial-state offset per lithostratigraphic group or per quadrant
removes about an eighth of the velocity error on held-out wells, with the
coefficients untouched.** Leave-one-well-out MAE falls from 309.5 m/s to
266.4 m/s with quadrant offsets and to 273.1 m/s with group offsets. Only the
group offsets transfer to an unseen quadrant (279.0 m/s). By the pre-registered
rule nothing is recorded as a scenario: the paired interval of the best model
against the untuned law is [−95.2, +4.5] m/s, which includes zero on this
44-well cohort. Against the depth-only baseline both models are clearly better.

The [plan](../validation/force2020/context-plan.json) was frozen before any
fitted error was inspected. It follows the [coefficient calibration](force2020-calibration.md),
which found that per-well offsets, not the law's shape, dominate the error.

## Context attached to each window

[`context.py`](../validation/force2020/context.py) attaches, from the supplied
NPD picks and the SODIR snapshot, the lithostratigraphic group whose top is the
deepest one above each window's midpoint, the quadrant and block from the well
name, and decimal coordinates. Three of 442 windows contain a group top. No
velocity or model error is read.

Area and age are confounded in the cohort: quadrants 16 and 25 are mostly
Cenozoic Hordaland and Rogaland shale; quadrants 31 and 35 are mostly Jurassic
and Cretaceous Viking, Dunlin and Shetland units. The plan therefore tests
area-based and unit-based explanations against each other.

## The burial-state offset

One number per unit, δ in metres, applied to the unchanged `rockVelocity`:

- δ > 0, exhumation: maximum burial and maximum effective loading are present
  depth plus δ; current stress stays at present depth.
- δ < 0, undercompaction with overpressure: maximum effective loading and the
  current stress depth are present depth plus δ; geometric burial, which drives
  the cementation proxy, stays at present depth.

Offsets are fitted by scan and golden-section search on an equal-well-weighted
squared error. Units absent from a training fold keep δ = 0.

## Results

| Model | Units | In-sample MAE | Leave-one-well-out MAE | Leave-one-quadrant-out MAE | LOO-well minus untuned [95%] |
| --- | ---: | ---: | ---: | ---: | --- |
| Untuned | 0 | 309.5 | 309.5 | 309.5 | — |
| Depth-only baseline | 2 | — | 348.2 | — | +38.8 [−1.1, +83.0] |
| M0 one global offset | 1 | 314.1 | 321.9 | 349.4 | +12.4 [−1.6, +26.5] |
| M1 per quadrant | 10 | 218.3 | **266.4** | 309.5 | −43.1 [−95.2, +4.5] |
| M1b per block | 25 | 192.0 | 294.2 | 309.5 | −15.2 [−62.0, +29.9] |
| M2 per group | 10 | 222.1 | 273.1 | **279.0** | −36.4 [−87.9, +20.3] |
| M3 quadrant + group | 20 | 182.0 | 268.4 | 295.2 | −41.1 [−87.2, +7.1] |

All values in m/s. A global offset does not help: the offsets have opposite
signs in different units. Block-level offsets overfit. The area model cannot
transfer to an unseen quadrant by construction; the group model does, improving
quadrants 7, 15, 31, 32 and 35 and worsening 16, 26 and 34.

### Fitted offsets

Per group, full development fit, with the range across leave-one-well-out folds:

| Group | Age | δ, m | Fold range, m | Windows / wells |
| --- | --- | ---: | --- | ---: |
| Hordaland | Oligocene–Miocene | −350 | −374 to −322 | 216 / 22 |
| Nordland | Miocene–Pleistocene | −20 | −61 to +92 | 42 / 8 |
| Rogaland | Paleocene–Eocene | −6 | −82 to +19 | 66 / 23 |
| Cromer Knoll | Lower Cretaceous | +239 | −104 to +325 | 10 / 6 |
| Dunlin | Lower Jurassic | +438 | +104 to +514 | 16 / 7 |
| Viking | Upper Jurassic | +462 | +435 to +498 | 33 / 14 |
| Shetland | Upper Cretaceous | +704 | +462 to +787 | 47 / 7 |
| Vestland, Båt, Tyne | Jurassic, Triassic | unstable | 1–2 wells each | 12 / 5 |

Per quadrant: 35 is +568 m (422 to 625, 9 wells), 31 is +510 m (485 to 545,
5 wells), 16 is −309 m (−379 to −188, 8 wells), 25 is −62 m (−116 to −19,
15 wells), 15 is −586 m (2 wells). Single-well quadrants 7, 26, 32, 33 and 34
have no fold range and should not be read.

### Reading

- The Hordaland Group shale behaves as if 350 m less loaded than its depth,
  consistently across 22 wells. Undercompacted, overpressured Hordaland shale
  in the Viking Graben is a known observation; the fitted number is this
  cohort's estimate, not a pore-pressure measurement.
- Pre-Cenozoic units behave as if 400–700 m more buried than their present
  depth. That is consistent with Neogene exhumation of the northern margin,
  with time-dependent cementation of older rocks, or both. The area fit
  (quadrants 31 and 35 at +500 to +570 m) and the unit fit cannot separate
  these on this cohort.
- Every model remains too fast between 2 and 3 km (bias +136 to +197 m/s).
  A constant offset does not fix the depth trend at the deep end.
- Sandstone remains poorly constrained: 53 windows from 24 wells.

## Consequences for the generator

The simulator must be able to produce these states, not just these velocities:
a prescribed overpressure profile already exists; whole-section exhumation
with retained compaction and cementation memory does not. A regional preset
would carry a Cenozoic overpressure scenario and a margin exhumation of roughly
0.5 km. That is a modelling target identified here, to be validated on the
holdout once the protocol is fixed, not a tuned result.

## Reproduce and verify

```sh
python -m unittest discover -s validation/force2020 -p 'test_*.py' -v
python validation/force2020/context.py --downloads /path/to/original/downloads
npm test -- tests/context-scenarios.test.mjs
npm run context:force2020
```

The run takes under a minute. Full results and per-window cross-validated
predictions are in `data/force2020/context/`; the compact report is
[context-results.json](../validation/force2020/context-results.json).

Verification: four Python tests cover pick-depth conversion, unit assignment
and boundary flags, name parsing and the water-depth requirement; six JavaScript
tests cover the offset semantics against direct `rockVelocity` calls in both
signs, the 1-D minimizer, recovery of known per-unit offsets with equal well
weight, separation of additive area and unit offsets, and parsing. The script
refuses to run if a zero offset does not reproduce the stored predictions.
Holdout untouched; coefficients unchanged.
