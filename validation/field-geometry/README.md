# Real-well contact geometry

See [the field report](../../docs/field-geometry-validation.md) for the method,
results, limits and complete reproduction commands. This is a depth-domain
contact reconstruction benchmark using interpreted NPD/FORCE 2020 group tops;
it is not a mapped-seismic-horizon or independent fault-surface benchmark.

- `plan.json`: committed before initial geometry predictions.
- `improvement-plan.json`: committed after baseline inspection, before the
  nested smooth trial. The smooth result does not establish a clear gain.
- `run.py`: read-only, checksum-verified development intake, Rust prediction,
  parent/block exclusion, nested training-only selection and all error summaries.
- `baseline-results.json`, `results.json`, `selection-results.json`: retained
  outcomes, coverage, exclusions and candidate choices, including worse errors.
- `repeat-verification.json`: exact repeated predictions and preserved baselines.
- `engine-parity.json`: two field-fitted stacks agree across native/four Wasm cores.
- `performance.json`: all warmup/trial scope, sampling, time and peak memory.
- `test_protocol.py`: grouping, failure scoring, bootstrap and source/access guards.
- `plot.py`, `verify-engines.mjs`, `benchmark.py`: reproducible figure and checks.

Full local run folders contain source contact tables, every reconstructed
history, all nested candidate fields/predictions and the original fold ledger.
Their fingerprints are retained; raw well logs and the reserved holdout are
not opened. Code is MIT; source data retains its original provenance and terms.
