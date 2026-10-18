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

## Next research milestone

The preferred display strategy is a coarse preview followed by targeted
refinement. Micro-voxel rendering is no longer a development objective. Finer
sampling should answer a scientific query and retain the same material field.

The recommended next release is **controllable 3D fault geometry with a
reproducible growth-strata benchmark**. Current faults can bend along strike
but do not curve in dip. Begin with a fault that flattens with depth (listric
geometry), explicit fault location/dip/slip controls, and consistent transport
of beds, composition and burial/loading memory through its history.

Derive and verify the transport before adding the viewer controls. Require
zero-slip and planar-fault reductions, analytical cases where available,
appropriate constituent/volume accounting for the open regional boundary,
material-subdivision convergence, deterministic replay and native/Wasm
agreement. A curved interface or attractive fold alone does not establish
valid deformation mechanics. Keep this a prescribed-kinematics model unless a
separate force-balance solver is implemented and verified.

Build a public benchmark alongside the feature. Compare a common faulted-basin
task, matching coordinates, extent, properties, precision and hardware. Retain
all failures, time and memory, and distinguish preview, refined plane and full
export costs. The existing flat-layer SubsurfaceGen control does not establish
relative quality or speed on realistic basins. Freeze observational-validation
rules and baselines before evaluating independent data; preserve reserved
holdouts.

## Following releases

- Extend geological coverage one process at a time: depositional clinoforms,
  channels, carbonate platforms and eventually salt-related structures. Label
  prescribed geometry separately from solved sediment transport or salt flow.
- Bring the existing Python well/horizon conditioning into the workspace, then
  improve candidate exploration and correlated observation errors. Evaluate
  uncertainty coverage on unseen cases; a weighted finite library is not an
  independently calibrated posterior.
- Profile generation and refinement separately. Reuse unaffected history/ray
  work and refine requested regions while bounding cache and request memory.
  Track latency distributions, memory and numerical error on representative
  machines. The measured viewer frame rate is not model-generation throughput.
- Publish matched geological and downstream seismic tests, with splits by whole
  model/geological family, plus reproducible examples and outside usability
  checks. Assess leadership on declared tasks and metrics rather than a
  blanket SOTA label.

Primary capability references:
[SubsurfaceGen](https://arxiv.org/html/2605.30541v1) for procedural geological
coverage and paired seismic data, and [GemPy](https://docs.gempy.org/) and
[LoopStructural](https://loop3d.org/LoopStructural/) for observation-constrained
structural modeling. These are distinct modeling approaches and should not be
ranked using one unmatched rendering or generation timing.
