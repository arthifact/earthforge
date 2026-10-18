# One basin, two views

The current source opens one persistent workspace. `index.html` starts with a
2D section; `3d.html` starts with the block. The view buttons switch in place:
they keep the seed, source model, physical options and history stage. Only the
settings panel scrolls. The earlier independent 2D generator remains at
`classic.html` as a historical research reference, with its tests intact.

The main workspace runs `history3d.worker.ts` and the Rust 3D history for both
views. X, Y and depth sections use world coordinates from that model. Moving
a section first reads the sampled block. After a short pause, optional
refinement evaluates that exact plane using the exported `sourceModel` and
the same stage. It does not draw another seeded history or change material
subdivision. The controller coalesces pending automatic section queries so an
interaction cannot build an unbounded queue of obsolete planes.

Vertical planes support 20 × 10 m or 10 × 10 m display samples over the current
10 km section. Horizontal maps use 65² or 129² samples, respectively. The
whole block retains its selected sampling grid. Refinement replaces only the
selected plane, using bounded buffers and a single cached plane. WebGL2 uses
those same refined arrays on matching section/cutaway faces; a dashed outline
locates the selected plane. Other faces retain the block sampling. The software
3D fallback displays the sampled block; 2D refinement is available there too.

Exports keep the existing `earthforge-block-v1` model/query envelope, adding
workspace mode, section axis and positions. A refined section includes its
reproducible engine query. Display f32 buffers and GPU colour quantization are
presentation encodings; the exported Rust model remains the f64 source.

## Verification

Run `node --test tests/history3d-worker.test.mjs tests/volume-view.test.mjs
tests/workspace-section.test.mjs tests/worker.test.mjs` for the focused tests.
They cover section orientations, noncubic/offset coordinates, exact buffer
ownership, stale plane exclusion, refinement resolution/cache identity, loader
fallback and the existing volume/camera behavior.

After building the native and browser engines, run
`node validation/unified-workspace/validate.mjs`. The recorded report checks
**17,253 exact field values** across rift, reverse-fault and erosion/reburial
histories at stages 0, 6 and 12. All three plane directions match intersecting
3D block nodes exactly; native and portable Wasm planes agree exactly. These
are synthetic software identity checks, not independent field validation.

## Fine voxel work that remains

The next rendering step is a bounded cache of spatial tiles with camera-driven
levels of detail. Refine visible or clipped regions from the continuous model,
retain coarse coverage elsewhere, and discard obsolete jobs. Measure tile
construction, transfer, upload, GPU drawing, memory and error separately.
Adjacent resolutions must agree on material ownership and coordinates; thin
beds need explicit treatment rather than invented visual texture.

The present implementation refines a plane, not the entire volume. A dense
10 m grid over 10 × 10 × 3 km contains about 302 million nodes before storing
multiple fields. Smaller decorative voxels would not create physical detail.
Material convergence and independent geological validation must accompany
finer sampling. Full-basin micro-voxels, force-driven 3D mechanics and near
real-time simulation at arbitrary resolution are not established by this UI
change.
