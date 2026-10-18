# Alpha 2 publication evidence

GitHub Pages serves `0.2.0-alpha.2` from source
`11d9b65a9a178980e0bb165b05c54632f2dd8b23`.

- [CI results](ci-results.json): all 14 jobs succeeded in
  [run 39101952130](https://github.com/arthifact/earthforge/actions/runs/39101952130),
  including 217 JavaScript tests with no failures, cancellations or skips.
- [Deployment check](deployment.json): all 18 published files match the
  [public release manifest](release-manifest.json); the four Wasm files have
  the expected `application/wasm` content type.
- [Public-engine smoke test](public-engine-smoke.json): actual downloaded
  public bytes from all four engines exactly match native curved geology and
  conditioning on one small fixed-seed case. Extended regressions are separate.
- [Public browser workflow](browser-workflow.json): the curved basin reached
  Ready, nine candidates were scored against four clearly labelled synthetic
  observations, and a selected candidate's exact history loaded. Cutaway,
  rotation, shared 2D section refinement and the recorded benchmark panel worked
  without captured console warnings or errors. Timings describe that single
  browser session, rather than a controlled performance benchmark.
- [Shard coverage](shard-coverage.json) uses synthetic filename fixtures to
  verify that each of the 35 production test filenames is assigned once.
  Actual production test outcomes are in `ci-results.json`.

These checks establish deployment integrity and reproducibility on supported
cases. They do not establish real-field geometry accuracy, calibrated
geological uncertainty, general real-time performance or SOTA superiority.
The [field diagnostic](../../docs/field-validation-alpha2.md) is separate.
