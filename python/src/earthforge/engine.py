"""Thin, bounded native-process interface to the single Rust physics core."""
from __future__ import annotations

import json
import os
import platform
import shutil
import subprocess
import time
from pathlib import Path
from typing import Iterator

import numpy as np

from ._util import canonical, digest, file_sha, finite_number, integer
from .model import FIELDS, FLOAT_FIELDS, SCENARIOS, UNITS, Grid, History, Parameters, Volume, transform_model


class EngineError(RuntimeError):
    pass


def find_engine(path: str | Path | None = None) -> Path:
    name = "earthforge.exe" if os.name == "nt" else "earthforge"
    if path is not None or os.environ.get("EARTHFORGE_ENGINE"):
        candidates = [Path(path if path is not None else os.environ["EARTHFORGE_ENGINE"]).expanduser()]
    else:
        candidates = [Path(__file__).parent / "_bin" / name]
        if shutil.which("earthforge-engine"):
            candidates.append(Path(shutil.which("earthforge-engine")))
        for parent in Path(__file__).resolve().parents:
            if (parent / "crates/earthforge-core/Cargo.toml").is_file():
                candidates.append(parent / "target/release" / name)
                break
    for candidate in candidates:
        if candidate.is_file() and (os.name == "nt" or os.access(candidate, os.X_OK)):
            return candidate.resolve()
    raise EngineError("Native engine not found. Install a platform wheel, set EARTHFORGE_ENGINE, or build with cargo build --locked --release.")


class Engine:
    def __init__(self, path: str | Path | None = None, *, timeout: float = 300, threads: int | None = None):
        self.path = find_engine(path)
        self.timeout = finite_number(timeout, "timeout", .01, 86400)
        self.threads = None if threads is None else integer(threads, "threads", 1, 256)
        self.sha256 = file_sha(self.path)
        self._binary_stamp = self._stamp()
        self.capabilities = self.request({"kind": "capabilities"})
        if self.capabilities.get("schema") != "earthforge-capabilities-v1" or not self.capabilities.get("history3d", {}).get("globallyIndexedGridWindows") or not self.capabilities.get("history3d", {}).get("materialStateProjection"):
            raise EngineError("Engine lacks research sampling support. Rebuild the current Rust core.")

    def _stamp(self):
        s = self.path.stat()
        return s.st_size, s.st_mtime_ns, s.st_ctime_ns, s.st_ino

    def _check_identity(self) -> None:
        stamp = self._stamp()
        if stamp != self._binary_stamp:
            if file_sha(self.path) != self.sha256:
                raise EngineError("The engine executable changed during this study. Create a new Engine and a new study.")
            self._binary_stamp = stamp

    def request(self, request: dict) -> dict:
        self._check_identity()
        data = canonical(request)
        if len(data) > 64 * 1024 * 1024:
            raise ValueError("Engine request exceeds 64 MiB")
        env = dict(os.environ)
        if self.threads is not None:
            env["RAYON_NUM_THREADS"] = str(self.threads)
        try:
            result = subprocess.run([str(self.path)], input=data, capture_output=True, timeout=self.timeout, env=env, check=False)
        except subprocess.TimeoutExpired as e:
            raise EngineError(f"Engine exceeded the {self.timeout:g} s request timeout") from e
        self._check_identity()
        if result.returncode:
            raise EngineError(f"Engine exited with code {result.returncode}: {result.stderr.decode(errors='replace')[:2000]}")
        try:
            response = json.loads(result.stdout)
        except (ValueError, UnicodeError) as e:
            raise EngineError("Engine returned invalid JSON") from e
        if not isinstance(response, dict) or response.get("ok") is not True:
            raise EngineError(str(response.get("error", "Invalid engine response")) if isinstance(response, dict) else "Invalid engine response")
        return response["value"]

    def build_history(self, scenario: str = "rift-v1", *, seed: int = 1001, parameters: Parameters | None = None, material_step: float = 10, steps: int | None = None, faults: int | None = None, compaction: bool | None = None, overpressure: bool | None = None, curve_strength: float | None = None, curve_length_m: float | None = None, fault_dip_degrees: float | None = None, fault_slip_scale: float | None = None) -> History:
        if scenario not in SCENARIOS:
            raise ValueError(f"Unknown scenario {scenario!r}; choose {', '.join(SCENARIOS)}")
        integer(seed, "seed", 1, 2**32-1)
        finite_number(material_step, "material_step", 1, 100)
        options = dict(SCENARIOS[scenario]["options"], seed=seed, materialStep=material_step)
        for name, value, limits in [("steps", steps, (2, 24)), ("faults", faults, (0, 4))]:
            if value is not None:
                options[name] = integer(value, name, *limits)
        for name, value in [("compaction", compaction), ("overpressure", overpressure)]:
            if value is not None:
                if not isinstance(value, bool):
                    raise ValueError(f"{name} must be boolean")
                options[name] = value
        for name, value, limits in [("curveStrength", curve_strength, (0, .95)), ("curveLength", curve_length_m, (100, 10000)), ("faultDipDegrees", fault_dip_degrees, (15, 80)), ("faultSlipScale", fault_slip_scale, (.25, 2))]:
            if value is not None:
                if options["geology"] != "listric-v1":
                    raise ValueError("Curve controls require a versioned listric scenario")
                options[name] = finite_number(value, name, *limits)
        p = parameters or Parameters()
        raw = self.request({"kind": "history3d", "options": options, "includeModel": True, "query": {"sectionsY": []}})
        history = History(transform_model(raw["sourceModel"], p), scenario=scenario, seed=seed, parameters={**p.to_dict(), "recipeOptions": options})
        # Compile the transformed source before returning it. No ray evaluation.
        self.request({"kind": "history3d", "model": history.model, "query": {"sectionsY": []}})
        return history

    def provenance(self, history: History, grid: Grid) -> dict:
        return {"schema": "earthforge-volume-v1", "history": history.to_record(), "grid": grid.to_dict(), "layout": "Nodal arrays (z, y, x), C order, x fastest", "coordinates": "metres; x/y Cartesian local frame; z positive down; no geographic CRS assigned", "units": dict(UNITS), "engine": {"sha256": self.sha256, "capabilities": json.loads(canonical(self.capabilities)), "threads": self.threads}, "runtime": {"python": platform.python_version(), "numpy": np.__version__, "platform": platform.platform()}, "stateValidity": "State fields apply where valid_material == 1. Raw state outside material is a placeholder. Porosity derived as 1-grain_fraction, NaN outside material.", "assumptions": list(self.capabilities["assumptions"]), "fieldAccuracyEstablished": False}

    def iter_tiles(self, history: History, grid: Grid, *, max_rays: int = 512, max_nodes: int = 250_000) -> Iterator[tuple[dict, Volume]]:
        for window in grid.windows(max_rays, max_nodes):
            yield window, self.sample_tile(history, grid, window)

    def sample_tile(self, history: History, grid: Grid, window: dict) -> Volume:
        query = {"sectionsY": [], "grid": grid.to_dict(), "gridWindow": window, "includeMaterial": True, "includeState": True}
        if history.stage is not None:
            query["stage"] = history.stage
        request = {"kind": "history3d", "model": history.model, "query": query}
        start = time.perf_counter()
        raw = self.request(request)
        elapsed = time.perf_counter() - start
        p = raw["projection"]
        if p["indexWindow"] != window or p["samplingGrid"] != grid.to_dict():
            raise EngineError("Engine returned a different sampling window")
        tile_grid = Grid.from_dict(p["grid"])
        for a, (axis, begin, count) in enumerate(zip("xyz", window["start"], window["count"])):
            expected = np.array([grid.origin[a] + (begin+i)*grid.spacing[a] for i in range(count)], dtype="<f8")
            if not np.array_equal(expected, p["coordinates"][axis]):
                raise EngineError("Global sampling coordinates changed")
        fields = {"velocity": np.asarray(p["velocity"], dtype="<f8").reshape(tile_grid.shape), "beds": np.asarray(p["beds"], dtype="<i4").reshape(tile_grid.shape), "lithology": np.asarray(p["lithology"], dtype="<f8").reshape(tile_grid.shape)}
        for target, source in [("sand_fraction", "sandFraction"), ("grain_fraction", "grainFraction"), ("max_burial", "maxBurial"), ("max_effective_depth", "maxEffectiveDepth")]:
            fields[target] = np.asarray(p[source], dtype="<f8").reshape(tile_grid.shape)
        valid = fields["beds"] >= 0
        fields["valid_material"] = valid.astype("u1")
        fields["porosity"] = np.where(valid, 1-fields["grain_fraction"], np.nan).astype("<f8")
        for name in ("surface", "basement"):
            fields[name] = np.asarray(p[name], dtype="<f8").reshape(tile_grid.ny, tile_grid.nx)
        metadata = {**self.provenance(history, grid), "indexWindow": window, "sampleCoordinates": p["coordinates"], "requestSha256": digest(request), "elapsedSeconds": elapsed, "stats": raw["stats"], "stage": raw["stage"]}
        volume = Volume(tile_grid, fields, metadata)
        volume.validate()
        return volume

    def sample(self, history: History, grid: Grid | None = None, *, max_bytes: int = 2 * 1024**3, **tiling) -> Volume:
        g = grid or Grid()
        needed = g.nodes * (len(FLOAT_FIELDS)*8+5) + g.nx*g.ny*16
        if needed > max_bytes:
            raise ValueError(f"Volume needs {needed} array bytes; use export_dataset for disk-backed output or increase max_bytes explicitly")
        fields = {n: np.empty((g.ny, g.nx) if n in ("surface", "basement") else g.shape, dtype="<i4" if n == "beds" else "u1" if n == "valid_material" else "<f8") for n in FIELDS}
        timings = []
        for window, tile in self.iter_tiles(history, g, **tiling):
            x, y, z = window["start"]; nx, ny, nz = window["count"]
            for name, a in fields.items():
                if a.ndim == 2:
                    a[y:y+ny, x:x+nx] = tile.fields[name]
                else:
                    a[z:z+nz, y:y+ny, x:x+nx] = tile.fields[name]
            timings.append({"window": window, "elapsedSeconds": tile.metadata["elapsedSeconds"], "stats": tile.metadata["stats"]})
        volume = Volume(g, fields, {**self.provenance(history, g), "tiles": timings, "elapsedSeconds": sum(t["elapsedSeconds"] for t in timings)})
        volume.validate()
        return volume

    def generate(self, scenario: str = "rift-v1", *, grid: Grid | None = None, **options) -> Volume:
        return self.sample(self.build_history(scenario, **options), grid)

    def points(self, history: History, xyz: list[tuple[float, float, float]]) -> list[dict]:
        if not 1 <= len(xyz) <= 100_000:
            raise ValueError("Point request must contain 1..100000 positions")
        points = []
        for row in xyz:
            if len(row) != 3 or not all(np.isfinite(row)):
                raise ValueError("Points must be finite xyz triples")
            points.append(dict(zip("xyz", map(float, row))))
        query = {"sectionsY": [], "points": points}
        if history.stage is not None:
            query["stage"] = history.stage
        return self.request({"kind": "history3d", "model": history.model, "query": query})["points"]

    def export_dataset(self, history: History, grid: Grid, path: str | Path, **options) -> Path:
        from .dataset import export_dataset
        return export_dataset(self, history, grid, path, **options)
