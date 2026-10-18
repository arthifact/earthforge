"""Deterministic finite-prior studies with resumable per-model outputs."""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Callable

from ._util import atomic_json, canonical, digest, finite_number, integer, job_lock
from .conditioning import normalize_weights, score_history, validate_observations
from .dataset import load_dataset
from .model import PARAMETER_LIMITS, SCENARIOS, FLOAT_FIELDS, Grid, History, Parameters

if TYPE_CHECKING:
    from .engine import Engine


@dataclass(frozen=True)
class EnsemblePlan:
    scenario: str = "rift-v1"
    count: int = 8
    seed: int = 1001
    priors: dict[str, list[float]] = field(default_factory=dict)
    options: dict = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.scenario not in SCENARIOS:
            raise ValueError("Unknown scenario")
        integer(self.count, "count", 1, 10000); integer(self.seed, "seed", 1, 2**32-1)
        if set(self.priors) - PARAMETER_LIMITS.keys():
            raise ValueError("Unknown uncertain parameter")
        for name, interval in self.priors.items():
            if not isinstance(interval, (list, tuple)) or len(interval) != 2:
                raise ValueError("A uniform prior needs [lower, upper]")
            lo, hi = PARAMETER_LIMITS[name]
            a = finite_number(interval[0], name, lo, hi); b = finite_number(interval[1], name, lo, hi)
            if a > b:
                raise ValueError("Prior lower limit exceeds upper limit")
        if set(self.options) - {"steps", "faults", "material_step", "compaction", "overpressure"}:
            raise ValueError("Unknown scenario option")
        for name, limits in [("steps", (2, 24)), ("faults", (0, 4))]:
            if name in self.options:
                integer(self.options[name], name, *limits)
        if "material_step" in self.options:
            finite_number(self.options["material_step"], "material_step", 1, 100)
        if any(not isinstance(self.options[n], bool) for n in ("compaction", "overpressure") if n in self.options):
            raise ValueError("compaction and overpressure options must be boolean")

    def candidates(self) -> list[dict]:
        out = []
        used_seeds = set()
        for i in range(self.count):
            retry = 0
            while True:
                recipe_seed = int.from_bytes(hashlib.sha256(canonical(["earthforge-geology-seed-v2", self.seed, i, retry])).digest()[:4], "big")
                if recipe_seed and recipe_seed not in used_seeds:
                    used_seeds.add(recipe_seed)
                    break
                retry += 1
            values = Parameters().to_dict()
            for name, (lo, hi) in sorted(self.priors.items()):
                # Stable, versioned counter sampler. 53 uniform pseudorandom bits;
                # independent parameter keys, no reliance on NumPy RNG versions.
                bits = int.from_bytes(hashlib.sha256(canonical(["earthforge-prior-v2", self.seed, i, name])).digest()[:8], "big") >> 11
                values[name] = lo + (hi-lo) * (bits / 2**53)
            candidate = {"scenario": self.scenario, "seed": recipe_seed, "parameters": values, "options": dict(self.options)}
            candidate["id"] = f"{i:05d}-{digest(candidate)[:12]}"
            out.append(candidate)
        return out

    def to_record(self) -> dict:
        return {"schema": "earthforge-ensemble-plan-v1", "scenario": self.scenario, "count": self.count, "seed": self.seed, "priors": self.priors, "options": self.options, "sampler": "earthforge-prior-v2: independent uniform 53-bit parameter samples; hashed, collision-rejected nonzero 32-bit geological recipe seeds", "candidates": self.candidates()}


def _save_manifest(path: Path, record: dict) -> None:
    record["recordSha256"] = digest({k:v for k,v in record.items() if k != "recordSha256"})
    atomic_json(path, record)


def run_ensemble(engine: Engine, plan: EnsemblePlan, grid: Grid, path: str | Path, *, observations: list[dict] | None = None, resume: bool = False, max_total_bytes: int = 2*1024**3, max_rays: int = 512, max_nodes: int = 250_000, on_progress: Callable[[int, int], None] | None = None) -> dict:
    rows = validate_observations(observations) if observations is not None else None
    needed = plan.count*(grid.nodes*(len(FLOAT_FIELDS)*8+5)+grid.nx*grid.ny*16)
    if needed > max_total_bytes:
        raise ValueError(f"Study needs {needed} array bytes, above explicit max_total_bytes={max_total_bytes}")
    identity = {"plan": plan.to_record(), "grid": grid.to_dict(), "observations": rows, "engineSha256": engine.sha256, "maxRays": max_rays, "maxNodes": max_nodes}
    # Validate tiling before creating output.
    list(grid.windows(max_rays, max_nodes))
    target = Path(path)
    target.mkdir(parents=True, exist_ok=resume)
    with job_lock(target):
        manifest_path = target / "ensemble.json"
        if resume:
            manifest = json.loads(manifest_path.read_text())
            if manifest.get("schema") != "earthforge-ensemble-v1" or manifest.get("identity") != identity or manifest.get("planSha256") != digest(identity) or digest({k:v for k,v in manifest.items() if k != "recordSha256"}) != manifest.get("recordSha256"):
                raise ValueError("Resume plan, engine or observations differ from the saved study")
        else:
            manifest = {"schema": "earthforge-ensemble-v1", "state": "incomplete", "planSha256": digest(identity), "identity": identity, "estimatedArrayBytes": needed, "members": {}, "interpretation": "Synthetic prior ensemble. Optional likelihood weights describe this finite candidate library; no field-calibrated coverage or inversion-success claim."}
            _save_manifest(manifest_path, manifest)
        for i, candidate in enumerate(identity["plan"]["candidates"]):
            key = candidate["id"]; member_dir = target / key
            existing = manifest["members"].get(key)
            if existing and existing["state"] == "complete":
                history = History.load(member_dir / "history.json")
                if history.model_sha256 != existing["modelSha256"]:
                    raise ValueError("Saved member source model was modified")
                load_dataset(member_dir / "volume")
                continue
            try:
                history = engine.build_history(candidate["scenario"], seed=candidate["seed"], parameters=Parameters(**candidate["parameters"]), **candidate["options"])
                member_dir.mkdir(exist_ok=True)
                history_file = member_dir / "history.json"
                if history_file.exists():
                    if History.load(history_file).to_record() != history.to_record():
                        raise ValueError("Existing history does not match this member")
                else:
                    atomic_json(history_file, history.to_record())
                score = score_history(engine, history, rows) if rows is not None else {"status": "unconditioned", "logLikelihood": 0.0}
                volume_dir = member_dir / "volume"
                engine.export_dataset(history, grid, volume_dir, resume=volume_dir.exists(), max_rays=max_rays, max_nodes=max_nodes, max_bytes=max_total_bytes)
                saved = json.loads((volume_dir / "dataset.json").read_text())
                manifest["members"][key] = {"state": "complete", "modelSha256": history.model_sha256, "contentSha256": saved["contentSha256"], "score": score}
            except Exception as e:
                manifest["members"][key] = {"state": "failed", "errorType": type(e).__name__, "message": str(e)[:2000], "score": {"status": "failed", "logLikelihood": None}}
            _save_manifest(manifest_path, manifest)
            if on_progress is not None:
                on_progress(i+1, plan.count)
        ordered = [manifest["members"][c["id"]] for c in identity["plan"]["candidates"]]
        failures = sum(r["state"] != "complete" for r in ordered)
        manifest["failures"] = failures
        manifest["state"] = "complete" if not failures else "complete-with-failures"
        manifest["weighting"] = normalize_weights([r["score"] for r in ordered])
        if failures:
            manifest["weighting"]["failureScope"] = "Failed candidates carry zero weight; the study is incomplete for scientific interpretation until these failures are resolved."
        _save_manifest(manifest_path, manifest)
    return manifest


def condition_histories(engine: Engine, histories: list[History], observations: list[dict], *, prior_weights: list[float] | None = None) -> dict:
    rows = validate_observations(observations)
    scores = [score_history(engine, h, rows) for h in histories]
    return {"schema": "earthforge-conditioning-v1", "observations": rows, "engineSha256": engine.sha256, "models": [h.model_sha256 for h in histories], "scores": scores, **normalize_weights(scores, prior_weights)}
