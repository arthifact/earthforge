"""Command-line research workflows, separate from the native JSON engine."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import __version__
from ._util import atomic_json
from .dataset import load_dataset
from .engine import Engine
from .ensemble import EnsemblePlan, condition_histories, run_ensemble
from .model import CATALOG, SCENARIOS, Grid, History, Parameters
from .seismic import acoustic_shot


def _json(path: str) -> dict:
    return json.loads(Path(path).read_text())


def _grid(args, base: Grid | None = None) -> Grid:
    g = base or Grid()
    return Grid(*(args.shape or g.counts), *(args.spacing or g.spacing), tuple(args.origin or g.origin))


def _output_json(path: str, value: dict) -> None:
    target = Path(path)
    if target.exists():
        raise FileExistsError(target)
    atomic_json(target, value)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="earthforge", description="Reproducible geological-history velocity models. Rust physics; Python orchestration. Research alpha.")
    parser.add_argument("--version", action="version", version=__version__)
    parser.add_argument("--engine", help="Native engine path; alternatively EARTHFORGE_ENGINE")
    parser.add_argument("--threads", type=int, default=None, help="Native Rayon thread count")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("scenarios", help="Show versioned scenarios and limitations")
    sub.add_parser("doctor", help="Check engine, sampling support and environment")
    generate = sub.add_parser("generate", help="Create a resumable f64 NPY volume dataset")
    generate.add_argument("--scenario", choices=SCENARIOS, default="rift-v1")
    generate.add_argument("--seed", type=int, default=1001)
    generate.add_argument("--steps", type=int, default=None)
    generate.add_argument("--faults", type=int, default=None)
    generate.add_argument("--material-step", type=float, default=10)
    generate.add_argument("--parameters", help="JSON object of physical scenario parameters")
    generate.add_argument("--history", help="Use an exported history or browser model/view JSON instead of a recipe")
    generate.add_argument("--resume", action="store_true")
    generate.add_argument("--out", required=True)
    generate.add_argument("--npz", help="Also write a compressed NPZ (loads volume arrays)")
    generate.add_argument("--vti", help="Also write VTK ImageData")
    generate.add_argument("--shape", type=int, nargs=3, default=None, metavar=("NX", "NY", "NZ"))
    generate.add_argument("--spacing", type=float, nargs=3, default=None, metavar=("DX", "DY", "DZ"))
    generate.add_argument("--origin", type=float, nargs=3, default=None)
    generate.add_argument("--max-output-gib", type=float, default=2)
    generate.add_argument("--tile-rays", type=int, default=512)
    generate.add_argument("--tile-nodes", type=int, default=250000)
    batch = sub.add_parser("ensemble", help="Run or resume a frozen batch-study JSON plan")
    batch.add_argument("plan"); batch.add_argument("--out", required=True); batch.add_argument("--resume", action="store_true")
    batch.add_argument("--max-output-gib", type=float, default=2)
    condition = sub.add_parser("condition", help="Weight explicit histories against wells or horizon contacts")
    condition.add_argument("observations"); condition.add_argument("histories", nargs="+"); condition.add_argument("--out", required=True)
    inspect = sub.add_parser("inspect", help="Verify a completed NPY dataset and summarize its provenance")
    inspect.add_argument("dataset")
    shot = sub.add_parser("shot", help="Generate a paired velocity/shot-gather NPZ with Rust acoustics")
    shot.add_argument("dataset"); shot.add_argument("--source", type=float, nargs=3, required=True)
    shot.add_argument("--receiver", type=float, nargs=3, action="append", required=True)
    shot.add_argument("--frequency", type=float, required=True); shot.add_argument("--duration", type=float, required=True)
    shot.add_argument("--sponge-cells", type=int, default=32); shot.add_argument("--out", required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "scenarios":
            print(json.dumps(CATALOG, indent=2)); return 0
        if args.command == "inspect":
            v = load_dataset(args.dataset)
            print(json.dumps({"grid": v.grid.to_dict(), "contentSha256": v.content_digest(), "history": {k: v.metadata["history"][k] for k in ("scenario", "seed", "modelSha256")}, "precision": "float64", "fieldAccuracyEstablished": False}, indent=2)); return 0
        engine = Engine(args.engine, threads=args.threads)
        if args.command == "doctor":
            print(json.dumps({"package": __version__, "engine": str(engine.path), "engineSha256": engine.sha256, "capabilities": engine.capabilities}, indent=2)); return 0
        if args.command == "generate":
            history = History.load(args.history) if args.history else engine.build_history(args.scenario, seed=args.seed, steps=args.steps, faults=args.faults, material_step=args.material_step, parameters=Parameters(**(_json(args.parameters) if args.parameters else {})))
            base = Grid.from_dict(_json(args.history)["request"]["query"]["grid"]) if args.history and _json(args.history).get("format") == "earthforge-block-v1" else None
            engine.export_dataset(history, _grid(args, base), args.out, resume=args.resume, max_bytes=int(args.max_output_gib*1024**3), max_rays=args.tile_rays, max_nodes=args.tile_nodes, on_progress=lambda n, total: print(f"Tile {n}/{total}", file=sys.stderr))
            if args.npz or args.vti:
                volume = load_dataset(args.out)
                if args.npz:
                    volume.save_npz(args.npz)
                if args.vti:
                    volume.save_vti(args.vti)
            print(json.dumps({"dataset": str(Path(args.out).resolve()), "state": "complete"})); return 0
        if args.command == "ensemble":
            config = _json(args.plan)
            if config.get("schema") != "earthforge-study-v1" or set(config)-{"schema", "plan", "grid", "observations", "tiling"}:
                raise ValueError("Expected earthforge-study-v1 with plan/grid and optional observations/tiling")
            result = run_ensemble(engine, EnsemblePlan(**config["plan"]), Grid.from_dict(config["grid"]), args.out, observations=config.get("observations"), resume=args.resume, max_total_bytes=int(args.max_output_gib*1024**3), **config.get("tiling", {}), on_progress=lambda n, total: print(f"Model {n}/{total}", file=sys.stderr))
            print(json.dumps({"state": result["state"], "failures": result["failures"], "weighting": result["weighting"]}, indent=2)); return 0 if not result["failures"] and result["weighting"]["status"] != "no-compatible-candidates" else 2
        if args.command == "condition":
            source = _json(args.observations)
            if source.get("schema") != "earthforge-observations-v1":
                raise ValueError("Expected earthforge-observations-v1")
            result = condition_histories(engine, [History.load(p) for p in args.histories], source["observations"])
            _output_json(args.out, result)
            print(json.dumps({k: result[k] for k in ("status", "effectiveSampleSize", "weights")}, indent=2)); return 0 if result["status"] == "weighted" else 2
        if args.command == "shot":
            result = acoustic_shot(engine, load_dataset(args.dataset), source=tuple(args.source), receivers=[tuple(r) for r in args.receiver], frequency_hz=args.frequency, duration_seconds=args.duration, sponge_cells=args.sponge_cells)
            result.save_npz(args.out)
            print(json.dumps({"shot": str(Path(args.out).resolve()), "traceShape": list(result.traces.shape), "dimensions": result.metadata["solver"]["dimensions"]})); return 0
    except (ValueError, OSError, RuntimeError, KeyError, TypeError) as e:
        print(f"Earth Forge: {e}", file=sys.stderr); return 1
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
