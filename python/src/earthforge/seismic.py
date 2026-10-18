"""Paired velocity/shot artifacts using the existing Rust acoustic solver."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

import numpy as np

from ._util import canonical, digest
from .export import write_array_archive
from .model import Volume

if TYPE_CHECKING:
    from .engine import Engine


@dataclass
class Shot:
    velocity: np.ndarray
    traces: np.ndarray
    time_seconds: np.ndarray
    source_xyz_m: np.ndarray
    receivers_xyz_m: np.ndarray
    metadata: dict

    def save_npz(self, path: str | Path) -> Path:
        return write_array_archive({"velocity": self.velocity, "traces": self.traces, "time_seconds": self.time_seconds, "source_xyz_m": self.source_xyz_m, "receivers_xyz_m": self.receivers_xyz_m, "metadata_json": np.array(canonical(self.metadata).decode())}, Path(path))


def acoustic_shot(engine: Engine, volume: Volume, *, source: tuple[float, float, float], receivers: list[tuple[float, float, float]], frequency_hz: float, duration_seconds: float, sponge_cells: int = 32, dt_seconds: float | None = None, source_delay_seconds: float | None = None) -> Shot:
    volume.validate()
    if len(source) != 3 or not receivers or any(len(r) != 3 for r in receivers):
        raise ValueError("Supply xyz source and receiver coordinates in metres")
    request = {"kind": "acoustic", "grid": volume.grid.to_dict(), "velocity": volume.fields["velocity"].reshape(-1).tolist(), "source": dict(zip("xyz", map(float, source))), "receivers": [dict(zip("xyz", map(float, r))) for r in receivers], "frequencyHz": frequency_hz, "durationSeconds": duration_seconds, "spongeCells": sponge_cells, "includeFinalField": False}
    if dt_seconds is not None:
        request["dtSeconds"] = dt_seconds
    if source_delay_seconds is not None:
        request["sourceDelaySeconds"] = source_delay_seconds
    result = engine.request(request)
    traces = np.asarray(result.pop("data"), dtype="<f8").reshape(len(receivers), result["samplesPerReceiver"])
    metadata = {"schema": "earthforge-shot-v1", "engineSha256": engine.sha256, "requestSha256": digest(request), "sourceVolumeContentSha256": volume.content_digest(), "volumeProvenance": volume.metadata, "solver": result, "units": {"time_seconds": "s", "source_xyz_m": "m; z positive down", "receivers_xyz_m": "m; z positive down", "velocity": "m/s", "traces": "source-normalized amplitude, not calibrated pressure"}, "limitations": "Constant-density isotropic acoustics; no elastic waves, intrinsic attenuation, anisotropy, free surface or PML. Kernel dispersion/CFL checks apply; no field-survey validation claim."}
    return Shot(volume.fields["velocity"], traces, np.arange(result["samplesPerReceiver"], dtype="<f8")*result["dtSeconds"], np.asarray(source, dtype="<f8"), np.asarray(receivers, dtype="<f8"), metadata)
