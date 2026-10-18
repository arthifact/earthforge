# Earth Forge incremental releases

Ship a useful open-source alpha and a public web app, then improve them in
small releases. The initial release should be reproducible, understandable
and usable for the supported synthetic workflows. Independent field validity
and SOTA comparisons remain ongoing research milestones.

## First public alpha

Use `v0.2.0-alpha.1` for the web/source release and `0.2.0a1` for the equivalent
Python release. The npm application version matches the web release. The Rust
crate retains its separate internal library version; the public source tag
identifies the complete application release.

The first alpha includes the current 2D and 3D viewers, three scenario families,
model export, the Python examples and the documented research workflow.
Publish the assumptions and known limits with those features. Link the web app
and source repository so users can move from trying a model to reproducing it.

The project uses the [MIT license](../LICENSE). Before publication, select the
web destination, verify the
release build and examples, retain dependency notices and tag the exact source.
Broader geology, blind field validation and full-field SOTA comparisons are
later milestones, rather than prerequisites for calling this an alpha.

## Small releases after the alpha

| Milestone | Deliverable | Evidence to retain |
| --- | --- | --- |
| First follow-up | Fix early user problems; improve examples, model sharing and browser usability | Reproductions and focused checks for the affected workflow |
| Research workflow | Test native installers on more platforms and improve study/report ergonomics | Clean installs and repeatable examples on each supported platform |
| Geological coverage | Add one process or geometry at a time, beginning with the most useful user request | Independent analytical cases, material conservation and convergence checks |
| Performance | Improve the measured bottleneck in the same supported task | Before/after quality, precision, time and memory on matched cases |
| External validity | Evaluate untouched geological observations and complex matched generator tasks | Frozen protocols, whole-geology holdouts and independently reproduced results |

Keep fixes and scientific features small enough to review and reproduce.
Publish a changelog for each release and preserve old examples and results.
Version changes to scenario recipes or numerical behavior; changing the
viewer must not silently change the exported model.

## Build the web artifact

The browser build runs the Rust core locally in WebAssembly. It can be deployed
as static files; the Python CLI and a native simulation server are not required
to use the web viewer.

From the repository root:

```sh
rustup target add wasm32-unknown-unknown
npm ci
npm run build
npm run package:web -- --version 0.2.0-alpha.1 --out releases/web-alpha.1
```

The packager creates a new folder containing the two app pages, generated
assets, four Wasm modules, third-party notices and a SHA-256 manifest. It copies
only the app build, not local datasets or the repository. Existing output
folders are refused. The project MIT license is included and identified in the
manifest. A `.nojekyll` marker keeps the static build intact on GitHub Pages.
Preparing an artifact does not publish it.

Preview the production build with `npm run preview`. For a packaged artifact,
serve its folder with a local static server. Before publication, open both
pages, generate a fixed seed, rotate/clip the block, export a model and confirm
that all four Wasm assets can be served. Keep the manifest with that release.

Deploy the folder to the selected static host over HTTPS. Serve JavaScript and
Wasm as files, rather than rewriting missing assets to an HTML page. Configure
`.wasm` as `application/wasm`. The current artifact targets the domain root.
If a host uses a subdirectory such as `/earthforge/`, rebuild with that base:

```sh
npm run build -- --base=/earthforge/
npm run package:web -- --version 0.2.0-alpha.1 --out releases/web-alpha.1-subpath
```

Use a separate preview deployment for later changes, then promote a checked
artifact to the public URL. Retain the previous artifact for rollback.
`vite preview` is for local verification, not the public production server.
See [Vite's static deployment guide](https://vite.dev/guide/static-deploy.html)
and [MDN's Wasm loading guide](https://developer.mozilla.org/en-US/docs/WebAssembly/Guides/Loading_and_running).

## Public status

The web alpha is live on [GitHub Pages](https://arthifact.github.io/earthforge/),
with the [3D basin](https://arthifact.github.io/earthforge/3d.html) at a separate
entry page. The public site uses HTTPS and needs no sign-in. The original
repository remains public; its default branch was not changed by deployment.

GitHub Actions verifies the source before publishing GitHub Pages. The
[`research.yml` workflow](../.github/workflows/research.yml) checks Rust and Python
on Linux, macOS and Windows with Python 3.10/3.12. It checks the browser build
and reference tests separately, packages the static site with license notices,
then deploys that same artifact only after all required jobs pass. Pull
requests run checks without deploying. Manual runs deploy only from `main`.

The hosting configuration is recorded in
[`deployment/github-pages.json`](../deployment/github-pages.json). The old
`gh-pages` artifact commit is retained as the initial manual deployment and
rollback reference. Every new web manifest records its source commit.

To prepare a future Pages release separately from the regular local build:

```sh
npm run build:pages
npm run package:web -- --out releases/pages-site
```

Set the new application/Python versions and use fresh output folders for each
release. Check both entry pages under `/earthforge/`, then push the reviewed
source to `main`. Pages receives the artifact from that successful workflow;
there is no separate hand-maintained deployment source. The optional `--dist`
argument selects a separate build directory. Packaging includes the MIT
license, dependency notices, `.nojekyll`, source commit and fingerprints.

The alpha release provides the tagged source and verified platform installers.
Python registry publication remains separate; nothing is uploaded to PyPI by
the build or deployment workflow. See the
[research example](../examples/research/README.md) for installation and complete
verification. This release does not change the numerical engine.
