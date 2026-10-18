# Contributing to Earth Forge

Earth Forge is being prepared for an open-source alpha. Small fixes,
reproducible bug reports, scientific checks and usable examples are welcome.
Earth Forge uses the [MIT license](LICENSE). Third-party components retain
their own licenses and notices.

## Report a problem

Include the app or package version, scenario, seed, settings and what you
expected to happen. A small exported history or minimal Python example is
especially useful. For performance reports, include the machine, grid,
material subdivision, first-run versus repeated-run timing and what the
measurement includes. Share only data you have permission to redistribute.

## Run the project

Use Rust 1.88 or newer, Node 22.12+ (or Node 20.19+ within the 20.x series),
and Python 3.10+ for the research tools.

```sh
rustup target add wasm32-unknown-unknown
npm ci
npm run dev
```

The app opens on port 5174. The dev command builds the four Wasm modules first.
For Python work:

```sh
python -m venv .venv
# Activate that environment using your platform's usual command.
cargo build --locked --release
python -m pip install -e ./python
earthforge doctor
```

## Make a focused change

Keep simulation laws and material history in the Rust core. Web and Python
clients should call that core. Identify the supported geometry and physical
assumptions when adding a process. Include independent checks for a changed
law or numerical method, rather than asserting only that it matches itself.

For numerical or performance changes, compare the same seeds, physical
settings, output grids and precision. Preserve failing cases. State when a
speed change also changes accuracy or physical scope. Visual-only changes
can use focused viewer checks.

Run the checks relevant to your change. The main entry points are:

```sh
cargo test --locked --release
cargo clippy --locked --release --all-targets --all-features -- -D warnings
python -m unittest discover -s python/tests -v
npm run check
npm run build
```

The optional `vtk==9.5.2` dependency enables the independent VTK-reader test.
See `tests/` for focused worker/view checks. The historical TypeScript engine
is retained as a migration reference; new physics belongs in Rust.

## Submit and document

Explain the user-visible change, why it is useful and how you checked it.
Update examples and the changelog when behavior changes. Keep private data,
build products and large generated studies out of source changes. Changes to
scientific claims should link to the experiment and its measured scope.
