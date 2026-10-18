# Reproduce an Earth Forge research model

Use the native-backed Python package to generate a history, inspect a sampled
volume, export it and read it independently. These examples are synthetic;
they establish software interoperability, not field accuracy.

## Install

Download the wheel matching your operating system and architecture from the
[alpha release](https://github.com/arthifact/earthforge/releases/tag/v0.2.0-alpha.1).
Install it into a Python 3.10+ environment:

```sh
python -m pip install /path/to/earthforge_research.whl
earthforge doctor
```

Use the wheel's actual filename. The bundled engine needs neither Rust nor Node
at runtime. Wheels target their recorded build platforms: Linux wheels are not
manylinux-certified, and macOS wheels conservatively require the build host's
OS version. Build from source when no compatible wheel is available:

```sh
cargo build --locked --release
python -m pip install ./python
earthforge doctor
```

## Generate and inspect

From the source checkout, with the package installed:

```sh
python examples/research/quickstart.py example-model
earthforge inspect example-model/volume
```

The example writes a 160 × 160 × 1,000 m crop at 10 m nodal spacing. Its arrays
contain 17 × 17 × 101 nodes, including both endpoints. Inspect them in Python:

```python
from earthforge import load_npz

volume = load_npz("example-model/model.npz")
print(volume.grid.to_dict())
print(volume.fields["velocity"].shape)  # (101, 17, 17): z, y, x
print(volume.fields["velocity"].min(), volume.fields["velocity"].max())
```

Positions are local Cartesian metres and velocity is m/s. Depth is positive
down; no geographic CRS is inferred. Material-state fields are valid where
`valid_material == 1`; porosity is NaN outside material.

## Inspect the VTK file

In ParaView, open `example-model/model.vti` with **File → Open**, then select
**Apply**. The file contains nodal point arrays, including velocity, bed labels,
porosity and burial history. Its axes retain Earth's positive-down depth
convention. Retain the adjacent JSON file for provenance. See
[ParaView's loading guide](https://docs.paraview.org/en/latest/UsersGuide/dataIngestion.html).

## Reproduce a browser export

In the [3D web app](https://arthifact.github.io/earthforge/3d.html), generate a
model and select **Export model and view**. Then use the saved JSON directly:

```sh
earthforge generate --history my-browser-export.json --out reproduced \
  --npz reproduced.npz --vti reproduced.vti
```

The exported physical history, stage and grid are preserved. Rendering controls
such as camera position do not affect the generated model. Change the output
grid explicitly to sample the same history at another resolution.

`browser-export-908054.json` is a synthetic browser exchange fixture. It keeps
the complete physical request, original precision statement and display hash
from a captured stage-12 browser export. Camera measurements were omitted.
The original full export SHA-256 is
`6d685328e15244022db7f0c0ae5995b9555e44cdf71dd899e8b22fa5dea32442`.
Its display arrays must reproduce SHA-256
`5d72997aa795fc8943d5f5a325397cbd28b69cf909c3290c91c2934419c63169`.

## Run the complete verification

```sh
python -m pip install vtk==9.5.2
python examples/research/validate_workflow.py --out verified-model --require-vtk
```

Add `--require-bundled` when testing a downloaded native-bundled wheel. This
checks CLI generation and inspection, exact resume and NPZ roundtrip, all VTI
point arrays with an independent VTK reader, a six-model study and synthetic
conditioning, a paired 3D acoustic shot, and exact browser-export reproduction.
`verification.json` records the checks, engine fingerprint and resulting model
fingerprint. Reusing an existing output folder is refused.

The conditioning example deliberately includes its synthetic truth in the
candidate library. It does not demonstrate field inversion, independent
generalization or calibrated uncertainty. No observational data is required.
