# Changelog

## 0.2.0-alpha.2 web update

- Versioned dip-curved/along-strike-bent 3D fault scenarios, with conservative
  inverse material transport and explicit curve/dip/slip controls.
- Shared Rust well/horizon likelihoods and candidate weights for Python and Wasm.
- A Data panel for observations, candidate search, predictions, exact model
  selection and study export; export dialogs include inspectable JSON.
- Realistic synthetic curved-basin, refinement, held-out conditioning and
  fresh-process time/memory benchmarks, with recorded results in Measure.

- One persistent workspace for 2D and 3D, with settings that scroll beside the model.
- 2D sections now sample the same Rust 3D history, preserving model and stage when switching views.
- Debounced continuous-model section refinement at 20 × 10 m or 10 × 10 m display spacing; the selected refined plane is shared with WebGL2.
- Separate block, section and view measurements; the original 2D app remains at `classic.html` for research comparisons.
- Synthetic identity checks: 17,253 exact field comparisons across three scenario families and three stages.


## 0.2.0-alpha.1 web release 2026-10-17

The web alpha is published on [GitHub Pages](https://arthifact.github.io/earthforge/),
including [the 3D viewer](https://arthifact.github.io/earthforge/3d.html).
The equivalent Python research version is `0.2.0a1`. The source release
includes verified platform installers; Python registry publication is separate.

### Available

- Shared Rust physics compiled for native research jobs and browser WebAssembly.
- Original 2D sections and a 3D basin viewer with rotation, clipping, movable
  sections and geological-history replay.
- Rift, reverse-fault and erosion/reburial scenarios shared by the web app and
  Python catalog.
- Python API and CLI for reproducible studies, resumable tiled exports and
  finite-library well/horizon conditioning.
- NumPy and VTK exports, material-state fields and paired acoustic shot data.
- Numerical tests, convergence diagnostics and scoped performance evidence.
- A static web release packager with asset fingerprints and dependency notices.
- Source-driven testing on Linux, macOS and Windows, with Pages deployment
  gated on the native, Python and browser checks.
- A repeatable CLI-to-NumPy/VTK workflow and a captured browser exchange fixture.

### Scope

Fault motion, pressure and surface history are prescribed. Compaction is
vertical and drained. The reverse-fault recipe does not establish balanced
fold-and-thrust mechanics. Independent field accuracy and SOTA superiority
remain unestablished. See [the research evidence](docs/research-release.md).

### Release preparation

The project uses the MIT license, included in source, Python distributions and
web artifacts. Third-party notices are preserved. GitHub Pages publishes the
checked source build through Actions, with HTTPS enabled. Later releases can
add geological features and validation incrementally.
