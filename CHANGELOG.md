# Changelog

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
