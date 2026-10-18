"""Portable array/volume exports; scientific f64 samples stay f64 by default."""
from __future__ import annotations

import base64
import json
import os
import struct
import tempfile
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

import numpy as np

from ._util import array_sha, canonical, digest
from .model import FIELDS, VOLUME_FIELDS, Grid, Volume


def save_npz(volume: Volume, path: str | Path) -> Path:
    volume.validate()
    target = Path(path)
    if target.exists():
        raise FileExistsError(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    metadata = {**volume.metadata, "grid": volume.grid.to_dict(), "contentSha256": volume.content_digest(), "fieldHashes": {n: array_sha(a) for n, a in volume.fields.items()}}
    metadata["recordSha256"] = digest(metadata)
    arrays = {**volume.fields, **{f"coordinate_{a}": v for a, v in volume.coordinates().items()}, "metadata_json": np.array(canonical(metadata).decode())}
    return write_array_archive(arrays, target)


def write_array_archive(arrays: dict[str, np.ndarray], target: Path) -> Path:
    """Deterministic, exclusive NPZ publication with pickle disabled."""
    if target.exists():
        raise FileExistsError(target)
    if any(a.dtype.hasobject for a in arrays.values()):
        raise ValueError("Object arrays are not supported")
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".earthforge-npz-", dir=target.parent)
    try:
        with os.fdopen(fd, "wb") as f, zipfile.ZipFile(f, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True) as z:
            for name, array in sorted(arrays.items()):
                info = zipfile.ZipInfo(name + ".npy", date_time=(1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                with z.open(info, "w", force_zip64=True) as member:
                    np.lib.format.write_array(member, array, allow_pickle=False)
        os.link(tmp, target)  # Exclusive publication; never replace another result.
    finally:
        Path(tmp).unlink(missing_ok=True)
    return target


def load_npz(path: str | Path) -> Volume:
    with np.load(path, allow_pickle=False) as z:
        metadata = json.loads(str(z["metadata_json"]))
        if metadata.get("schema") != "earthforge-volume-v1" or digest({k:v for k,v in metadata.items() if k != "recordSha256"}) != metadata.get("recordSha256"):
            raise ValueError("Unknown volume schema")
        volume = Volume(Grid.from_dict(metadata["grid"]), {n: z[n].copy() for n in FIELDS}, metadata)
        for axis, values in volume.coordinates().items():
            if not np.array_equal(z[f"coordinate_{axis}"], values):
                raise ValueError("Export coordinates were modified")
    volume.validate()
    if volume.content_digest() != metadata.get("contentSha256") or any(array_sha(a) != metadata["fieldHashes"].get(n) for n, a in volume.fields.items()):
        raise ValueError("Export content fingerprint mismatch")
    return volume


def _base64_array(f, array: np.ndarray) -> None:
    a = np.ascontiguousarray(array.astype(array.dtype.newbyteorder("<"), copy=False))
    raw = memoryview(a).cast("B")
    carry = struct.pack("<Q", len(raw))
    for i in range(0, len(raw), 3 * 1024 * 1024):
        data = carry + raw[i:i+3*1024*1024].tobytes()
        stop = len(data) - len(data) % 3
        f.write(base64.b64encode(data[:stop]))
        carry = data[stop:]
    if carry:
        f.write(base64.b64encode(carry))


def save_vti(volume: Volume, path: str | Path) -> Path:
    """VTK XML ImageData, nodal xyz layout, inline base64 UInt64 size headers."""
    volume.validate()
    target = Path(path)
    sidecar = target.with_suffix(target.suffix + ".json")
    if target.exists() or sidecar.exists():
        raise FileExistsError(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    g = volume.grid
    if any(not np.array_equal(v, g.coordinates()[a]) for a, v in volume.coordinates().items()):
        raise ValueError("This tile has exact global coordinates that cannot be re-based as ImageData without rounding. Export NPZ or assemble the full parent grid before VTI export.")
    extent = f"0 {g.nx-1} 0 {g.ny-1} 0 {g.nz-1}"
    header = f'<?xml version="1.0"?>\n<!-- Earth Forge: coordinates in metres, z positive down. No geographic CRS. -->\n<VTKFile type="ImageData" version="1.0" byte_order="LittleEndian" header_type="UInt64"><ImageData WholeExtent="{extent}" Origin="{" ".join(map(repr,g.origin))}" Spacing="{" ".join(map(repr,g.spacing))}"><Piece Extent="{extent}"><PointData Scalars="velocity">\n'
    fd, tmp = tempfile.mkstemp(prefix=".earthforge-vti-", dir=target.parent)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(header.encode())
            for name in VOLUME_FIELDS:
                a = volume.fields[name]
                kind = {"f": "Float", "i": "Int", "u": "UInt"}[a.dtype.kind] + str(8*a.dtype.itemsize)
                f.write(f'<DataArray type="{kind}" Name="{escape(name)}" NumberOfComponents="1" format="binary">'.encode())
                _base64_array(f, a)
                f.write(b'</DataArray>\n')
            f.write(b'</PointData><CellData/></Piece></ImageData></VTKFile>\n')
        metadata = {**volume.metadata, "grid": g.to_dict(), "contentSha256": volume.content_digest(), "vtk": {"pointData": list(VOLUME_FIELDS), "surfaceAndBasement": "Available in NPZ or NPY dataset; not duplicated as 3D point fields"}}
        # Reserve the sidecar before publishing the volume. It is never overwritten.
        with sidecar.open("xb") as f:
            f.write(canonical(metadata) + b"\n")
        try:
            os.link(tmp, target)
        except BaseException:
            sidecar.unlink()
            raise
    finally:
        Path(tmp).unlink(missing_ok=True)
    return target
