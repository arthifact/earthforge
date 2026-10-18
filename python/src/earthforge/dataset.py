"""Resumable f64 NPY datasets, with model/engine identity and per-tile integrity."""
from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import TYPE_CHECKING, Callable

import numpy as np

from ._util import array_sha, atomic_json, digest, job_lock
from .model import FIELDS, FLOAT_FIELDS, Grid, History, Volume

if TYPE_CHECKING:
    from .engine import Engine


def _slices(window: dict, dimension: int):
    x, y, z = window["start"]; nx, ny, nz = window["count"]
    return (slice(y, y+ny), slice(x, x+nx)) if dimension == 2 else (slice(z, z+nz), slice(y, y+ny), slice(x, x+nx))


def _tile_hashes(fields: dict, window: dict) -> dict:
    return {name: array_sha(a[_slices(window, a.ndim)]) for name, a in fields.items()}


def _open_fields(path: Path, grid: Grid, mode: str) -> dict:
    return {name: np.lib.format.open_memmap(path / f"{name}.npy", mode=mode, dtype="<i4" if name == "beds" else "u1" if name == "valid_material" else "<f8", shape=(grid.ny, grid.nx) if name in ("surface", "basement") else grid.shape) for name in FIELDS}


def _save_manifest(path: Path, record: dict) -> None:
    record["recordSha256"] = digest({k:v for k,v in record.items() if k != "recordSha256"})
    atomic_json(path, record)


def export_dataset(engine: Engine, history: History, grid: Grid, path: str | Path, *, resume: bool = False, max_rays: int = 512, max_nodes: int = 250_000, max_bytes: int = 2 * 1024**3, on_progress: Callable[[int, int], None] | None = None) -> Path:
    target = Path(path)
    needed = grid.nodes * (len(FLOAT_FIELDS)*8+5) + grid.nx*grid.ny*16
    if needed > max_bytes:
        raise ValueError(f"Dataset needs {needed} array bytes, above explicit max_bytes={max_bytes}")
    windows = list(grid.windows(max_rays, max_nodes))
    identity = {"history": history.to_record(), "grid": grid.to_dict(), "windows": windows, "engineSha256": engine.sha256, "precision": "little-endian float64; int32 bed labels; uint8 validity"}
    plan_sha = digest(identity)
    if not resume:
        target.mkdir(parents=True, exist_ok=False)
    elif not target.is_dir():
        raise FileNotFoundError(target)
    with job_lock(target):
        manifest_path = target / "dataset.json"
        if resume:
            manifest = json.loads(manifest_path.read_text())
            if manifest.get("schema") != "earthforge-dataset-v1" or manifest.get("planSha256") != plan_sha or manifest.get("identity") != identity or digest({k:v for k,v in manifest.items() if k != "recordSha256"}) != manifest.get("recordSha256"):
                raise ValueError("Resume model, grid, engine or tile plan differs from the saved dataset")
            missing = [name for name in FIELDS if not (target / f"{name}.npy").is_file()]
            if missing and manifest["completedTiles"]:
                raise ValueError("A completed tile is missing an array file")
            fields = _open_fields(target, grid, "r+" if manifest["completedTiles"] else "w+")
            for key, entry in manifest["completedTiles"].items():
                if key not in {str(i) for i in range(len(windows))} or _tile_hashes(fields, windows[int(key)]) != entry["hashes"]:
                    raise ValueError("A completed dataset tile was modified; refusing to blend results")
            if manifest["state"] == "complete":
                loaded = load_dataset(target)
                del loaded
                return target
        else:
            if shutil.disk_usage(target).free < needed + 16 * 1024**2:
                raise OSError(f"Insufficient disk space for {needed} array bytes")
            manifest = {"schema": "earthforge-dataset-v1", "state": "incomplete", "planSha256": plan_sha, "identity": identity, "metadata": engine.provenance(history, grid), "completedTiles": {}, "estimatedArrayBytes": needed}
            # Store a recoverable manifest before allocating files.
            _save_manifest(manifest_path, manifest)
            fields = _open_fields(target, grid, "w+")
        for i, window in enumerate(windows):
            if str(i) in manifest["completedTiles"]:
                continue
            tile = engine.sample_tile(history, grid, window)
            for name, a in fields.items():
                a[_slices(window, a.ndim)] = tile.fields[name]
                a.flush()
            manifest["completedTiles"][str(i)] = {"hashes": _tile_hashes(fields, window), "elapsedSeconds": tile.metadata["elapsedSeconds"], "stats": tile.metadata["stats"]}
            _save_manifest(manifest_path, manifest)
            if on_progress is not None:
                on_progress(i+1, len(windows))
        volume = Volume(grid, fields, manifest["metadata"])
        volume.validate()
        manifest["contentSha256"] = volume.content_digest()
        manifest["fieldHashes"] = {n: array_sha(a) for n, a in fields.items()}
        manifest["state"] = "complete"
        _save_manifest(manifest_path, manifest)
    return target


def load_dataset(path: str | Path, *, verify: bool = True) -> Volume:
    target = Path(path)
    manifest = json.loads((target / "dataset.json").read_text())
    if manifest.get("schema") != "earthforge-dataset-v1" or manifest.get("state") != "complete" or digest({k:v for k,v in manifest.items() if k != "recordSha256"}) != manifest.get("recordSha256"):
        raise ValueError("Dataset is not a completed Earth Forge dataset")
    if digest(manifest["identity"]) != manifest.get("planSha256"):
        raise ValueError("Dataset plan fingerprint mismatch")
    History.from_record(manifest["identity"]["history"])
    grid = Grid.from_dict(manifest["identity"]["grid"])
    fields = {name: np.load(target / f"{name}.npy", mmap_mode="r", allow_pickle=False) for name in FIELDS}
    volume = Volume(grid, fields, manifest["metadata"])
    volume.validate()
    if verify and (volume.content_digest() != manifest.get("contentSha256") or any(array_sha(a) != manifest["fieldHashes"].get(n) for n, a in fields.items())):
        raise ValueError("Dataset arrays were modified")
    return volume
