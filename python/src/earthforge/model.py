"""Coordinate, scenario and artifact contracts. All physical evaluation is Rust."""
from __future__ import annotations

import copy
import json
import math
from dataclasses import asdict, dataclass
from importlib.resources import files
from pathlib import Path
from typing import Any, Iterator

import numpy as np

from ._util import array_sha, canonical, digest, finite_number, integer

CATALOG = json.loads(files("earthforge").joinpath("catalog.json").read_text())
SCENARIOS = {s["id"]: s for s in CATALOG["scenarios"]}
FLOAT_FIELDS = ("velocity", "lithology", "sand_fraction", "grain_fraction", "max_burial", "max_effective_depth", "porosity")
VOLUME_FIELDS = (*FLOAT_FIELDS, "beds", "valid_material")
FIELDS = (*VOLUME_FIELDS, "surface", "basement")
UNITS = {"velocity": "m/s", "lithology": "dimensionless; sand fraction for clastics; -1 water, -2 basement, -3 carbonate", "sand_fraction": "dimensionless, material only", "grain_fraction": "dimensionless, material only", "porosity": "dimensionless, material only; NaN elsewhere", "max_burial": "m, material only", "max_effective_depth": "m equivalent loading depth, material only", "beds": "zero-based bed index; -1 water, -2 basement", "valid_material": "1 sediment/carbonate, 0 water/basement", "surface": "m, z positive down", "basement": "m, z positive down"}


@dataclass(frozen=True)
class Grid:
    nx: int = 33
    ny: int = 33
    nz: int = 161
    dx: float = 312.5
    dy: float = 312.5
    dz: float = 18.75
    origin: tuple[float, float, float] = (0.0, 0.0, 0.0)

    def __post_init__(self) -> None:
        for name in ("nx", "ny", "nz"):
            integer(getattr(self, name), name, 1, 2**31 - 1)
        for name in ("dx", "dy", "dz"):
            finite_number(getattr(self, name), name, np.finfo(float).tiny, 1e9)
        if len(self.origin) != 3:
            raise ValueError("origin must contain x, y, z")
        object.__setattr__(self, "origin", tuple(finite_number(v, "origin", -1e12, 1e12) for v in self.origin))
        if self.nodes > 2**63 - 1:
            raise ValueError("Grid size exceeds supported index range")
        if not all(math.isfinite(self.origin[a] + (n-1)*d) for a, (n, d) in enumerate(zip(self.counts, self.spacing))):
            raise ValueError("Grid endpoint overflow")

    @property
    def counts(self) -> tuple[int, int, int]:
        return self.nx, self.ny, self.nz

    @property
    def spacing(self) -> tuple[float, float, float]:
        return self.dx, self.dy, self.dz

    @property
    def shape(self) -> tuple[int, int, int]:
        return self.nz, self.ny, self.nx

    @property
    def nodes(self) -> int:
        return self.nx * self.ny * self.nz

    def to_dict(self) -> dict:
        return {"nx": self.nx, "ny": self.ny, "nz": self.nz, "dx": self.dx, "dy": self.dy, "dz": self.dz, "origin": dict(zip("xyz", self.origin))}

    @classmethod
    def from_dict(cls, data: dict) -> Grid:
        d = dict(data)
        if isinstance(d.get("origin"), dict):
            d["origin"] = tuple(d["origin"][a] for a in "xyz")
        return cls(**d)

    def coordinates(self) -> dict[str, np.ndarray]:
        # Match Rust's origin + global_index * spacing, without tile rebasing.
        return {a: np.array([o + i*d for i in range(n)], dtype="<f8") for a, o, n, d in zip("xyz", self.origin, self.counts, self.spacing)}

    def windows(self, max_rays: int = 512, max_nodes: int = 250_000) -> Iterator[dict]:
        integer(max_rays, "max_rays", 1, 8192)
        integer(max_nodes, "max_nodes", 1, 4_000_000)
        rays = min(max_rays, max(1, max_nodes // self.nz))
        tx = min(self.nx, rays)
        ty = min(self.ny, max(1, rays // tx))
        tz = min(self.nz, max(1, max_nodes // (tx * ty)))
        for z in range(0, self.nz, tz):
            for y in range(0, self.ny, ty):
                for x in range(0, self.nx, tx):
                    yield {"start": [x, y, z], "count": [min(tx, self.nx-x), min(ty, self.ny-y), min(tz, self.nz-z)]}


PARAMETER_LIMITS = {"slip_scale": (0.25, 2.0), "subsidence_scale": (0.5, 2.0), "sediment_supply_scale": (0.5, 2.0), "facies_shift_m": (-1500.0, 1500.0), "erosion_depth_offset_m": (-150.0, 400.0), "pressure_top_offset_m": (-500.0, 500.0)}


@dataclass(frozen=True)
class Parameters:
    slip_scale: float = 1.0
    subsidence_scale: float = 1.0
    sediment_supply_scale: float = 1.0
    facies_shift_m: float = 0.0
    erosion_depth_offset_m: float = 0.0
    pressure_top_offset_m: float = 0.0

    def __post_init__(self) -> None:
        for name, (lo, hi) in PARAMETER_LIMITS.items():
            finite_number(getattr(self, name), name, lo, hi)

    def to_dict(self) -> dict:
        return asdict(self)


def transform_model(model: dict, parameters: Parameters) -> dict:
    spec = copy.deepcopy(model)
    def scale_field(field: dict | None, factor: float) -> None:
        if field is None or factor == 1:
            return
        for key in ("value", "slopeX", "slopeY"):
            if key in field:
                field[key] *= factor
        for term in [*field.get("waves", []), *field.get("fronts", [])]:
            term["amplitude"] *= factor
    for event in spec["events"]:
        kind = event["kind"]
        if kind in ("fault", "sweptFault") and parameters.slip_scale != 1:
            for a in "xyz":
                event["fault"]["slip"][a] *= parameters.slip_scale
        if kind == "subsidence":
            scale_field(event["displacement"], parameters.subsidence_scale)
        if kind == "deposit":
            for key in ("thickness", "maxThickness"):
                scale_field(event.get(key), parameters.sediment_supply_scale)
            if parameters.facies_shift_m:
                for front in (event.get("fraction") or {}).get("fronts", []):
                    front["centre"] += parameters.facies_shift_m
        if kind == "erosion" and parameters.erosion_depth_offset_m:
            event["surface"]["value"] += parameters.erosion_depth_offset_m
        if kind == "pressure" and event.get("top") and parameters.pressure_top_offset_m:
            event["top"]["value"] += parameters.pressure_top_offset_m
    return spec


class History:
    def __init__(self, model: dict, *, scenario: str = "explicit-model", seed: int | None = None, parameters: dict | None = None, stage: int | None = None):
        self._model = json.loads(canonical(model))
        self.scenario = scenario
        self.seed = seed
        self.parameters = dict(parameters or {})
        self.stage = stage

    @property
    def model(self) -> dict:
        return copy.deepcopy(self._model)

    @property
    def model_sha256(self) -> str:
        return digest(self._model)

    def to_record(self) -> dict:
        record = {"schema": "earthforge-history-v1", "scenario": self.scenario, "seed": self.seed, "parameters": self.parameters, "stage": self.stage, "model": self.model, "modelSha256": self.model_sha256}
        return {**record, "recordSha256": digest(record)}

    @classmethod
    def from_record(cls, record: dict) -> History:
        if record.get("format") == "earthforge-block-v1":
            return cls(record["request"]["model"], stage=record["request"]["query"].get("stage"), scenario=record.get("research", {}).get("scenario", "explicit-model"), seed=record.get("research", {}).get("seed"), parameters={"recipeOptions": record.get("research", {}).get("options")})
        if record.get("schema") != "earthforge-history-v1" or digest(record["model"]) != record.get("modelSha256") or digest({k:v for k,v in record.items() if k != "recordSha256"}) != record.get("recordSha256"):
            raise ValueError("Unknown or modified history record")
        return cls(record["model"], scenario=record["scenario"], seed=record["seed"], parameters=record["parameters"], stage=record.get("stage"))

    @classmethod
    def load(cls, path: str | Path) -> History:
        return cls.from_record(json.loads(Path(path).read_text()))


@dataclass
class Volume:
    grid: Grid
    fields: dict[str, np.ndarray]
    metadata: dict[str, Any]

    def validate(self) -> None:
        if set(self.fields) != set(FIELDS):
            raise ValueError("Unexpected volume fields")
        for name, array in self.fields.items():
            shape = (self.grid.ny, self.grid.nx) if name in ("surface", "basement") else self.grid.shape
            expected = "i" if name == "beds" else "u" if name == "valid_material" else "f"
            if array.shape != shape or array.dtype.kind != expected or array.dtype.itemsize != (4 if name == "beds" else 1 if name == "valid_material" else 8):
                raise ValueError(f"Invalid {name} shape or dtype")
            if name != "porosity":
                flat = array.reshape(-1)
                for begin in range(0, flat.size, 262144):
                    if not np.all(np.isfinite(flat[begin:begin+262144])):
                        raise ValueError(f"Nonfinite {name}")
        flat = {n: a.reshape(-1) for n, a in self.fields.items() if a.ndim == 3}
        for begin in range(0, self.grid.nodes, 262144):
            block = {n: a[begin:begin+262144] for n, a in flat.items()}
            valid = block["beds"] >= 0
            if np.any(block["beds"] < -2) or np.any(block["velocity"] <= 0) or not np.array_equal(valid.astype("u1"), block["valid_material"]):
                raise ValueError("Invalid material labels, mask or velocity")
            if np.any(np.isfinite(block["porosity"][~valid])):
                raise ValueError("Nonmaterial porosity must be NaN")
            for name in ("sand_fraction", "grain_fraction", "porosity"):
                a = block[name][valid]
                if not np.all(np.isfinite(a)) or np.any(a < -1e-12) or np.any(a > 1+1e-12):
                    raise ValueError(f"Invalid material {name}")

    def coordinates(self) -> dict[str, np.ndarray]:
        if "sampleCoordinates" in self.metadata:
            values = {a: np.asarray(self.metadata["sampleCoordinates"][a], dtype="<f8") for a in "xyz"}
            for a, n in zip("xyz", self.grid.counts):
                if values[a].shape != (n,) or not np.all(np.isfinite(values[a])):
                    raise ValueError("Invalid explicit sample coordinates")
            return values
        return self.grid.coordinates()

    def content_digest(self) -> str:
        return digest({"grid": self.grid.to_dict(), "coordinates": {a: array_sha(v) for a,v in self.coordinates().items()}, "fields": {n: array_sha(a) for n, a in sorted(self.fields.items())}})

    def save_npz(self, path: str | Path) -> Path:
        from .export import save_npz
        return save_npz(self, path)

    def save_vti(self, path: str | Path) -> Path:
        from .export import save_vti
        return save_vti(self, path)
