#!/usr/bin/env python3
"""Reproduce screened development logs with the current Rust physics core.

Requires the original prepared development data and four metadata workbooks.
The original holdout is never opened. Existing outputs are never overwritten.
"""
from __future__ import annotations

import argparse
import csv
import datetime
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import subprocess
import sys

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(ROOT/"python/src"))
sys.path.insert(0, str(ROOT/"validation/force2020"))
from earthforge import Engine
from compare import aggregate, caliper_mask, depth_evidence, development_log_path, development_wells, metrics, sample_support
from prepare import read_books, read_sodir, sha256, number
from analysis import baseline_cv, harmonic, paired_difference, quadrant, quadrature


def save_json(path, value):
    path.write_text(json.dumps(value, indent=2, allow_nan=False)+"\n")


def install_log_guard(development_root):
    """Process-wide protection, also covering hashing and symlinked paths."""
    development_root = development_root.resolve()
    accesses = set()

    def audit(event, values):
        if event != "open" or not isinstance(values[0], (str, bytes)):
            return
        path = Path(os.fsdecode(values[0]))
        if path.suffix.lower() != ".npz":
            return
        path = path.resolve()
        if not path.is_relative_to(development_root):
            raise PermissionError("Field run refuses every NPZ outside the development directory")
        if values[2] & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC):
            raise PermissionError("Prepared logs are read-only inputs")
        accesses.add(path.name)

    sys.addaudithook(audit)
    return accesses


def physics_input(facies, depth, scenario):
    fraction = 1.0 if facies == 30000 else 0.0
    if scenario == "less_pure_facies":
        fraction = .8 if fraction else .2
    row = {"fraction": fraction, "depth": depth, "carbonate": False}
    if scenario == "overpressure_below_1500m":
        row["pressure"] = 1500
    burial = {"maximum_burial_plus_500m": 500, "maximum_burial_plus_1000m": 1000}.get(scenario, 0)
    if burial:
        row["history"] = {"maxBurial": depth+burial, "maxEffectiveDepth": depth+burial}
    return row


def predict_support(engine, supports, scenarios):
    """Batch public physics API calls; one model velocity per integration node."""
    queries, layout = [], []
    for row, segments in supports:
        points, weights = quadrature(segments)
        for scenario in scenarios:
            start = len(queries)
            queries.extend(physics_input(row["facies_code"], depth, scenario) for depth in points)
            layout.append((row, scenario, start, len(queries), weights))
    velocities = []
    for start in range(0, len(queries), 4096):
        result = engine.request({"kind": "physics", "rows": queries[start:start+4096]})
        if len(result) != len(queries[start:start+4096]):
            raise ValueError("Native physics response length mismatch")
        velocities.extend(r["velocity"] for r in result)
    for row, scenario, start, end, weights in layout:
        row[scenario] = harmonic(velocities[start:end], weights)
    return len(queries)


def support_segments(arrays, water, row, plan, quality):
    depth = -arrays["z_loc_original"]-water
    left, right = sample_support(arrays["md_m"], depth, plan["max_adjacent_depth_gap_m"])
    lo = row["bin"]*plan["bin_width_m"]
    hi = lo+plan["bin_width_m"]
    valid = (np.isfinite(left) & np.isfinite(right) & (right > left) & (right > lo) & (left < hi)
             & np.isfinite(arrays["vp_m_s"]) & (arrays["vp_m_s"] > 0)
             & (arrays["lithology_confidence"] == plan["confidence"]) & quality
             & (arrays["lithology_code"] == row["facies_code"]))
    segments = list(zip(np.maximum(left[valid], lo).tolist(), np.minimum(right[valid], hi).tolist()))
    lengths = [b-a for a, b in segments]
    measured = harmonic(arrays["vp_m_s"][valid].tolist(), lengths)
    if abs(math.fsum(lengths)-row["coverage_m"]) > 1e-8 or abs(measured-row["observed_m_s"]) > 1e-8:
        raise ValueError("Matched support failed to reproduce the accepted observation")
    return segments


def load_cohorts(data, downloads, qc, split):
    intake = json.loads((data/"audit.json").read_text())
    if intake["split_sha256"] != sha256(ROOT/"validation/force2020/split.json"):
        raise ValueError("Prepared data differs from the frozen split")
    if sha256(data/"sodir-exploration.csv") != intake["sodir"]["sha256"]:
        raise ValueError("Changed official metadata snapshot")
    expected = json.loads((ROOT/"validation/force2020/intake-summary.json").read_text())
    if intake["archive"]["sha256"] != expected["archive"]["sha256"]:
        raise ValueError("Unexpected source archive")
    books, book_hashes = read_books(downloads)
    for kind, book in book_hashes.items():
        if book["sha256"] != expected["books"][kind]["sha256"]:
            raise ValueError(f"Changed metadata workbook: {kind}")
    metadata = read_sodir(data/"sodir-exploration.csv")
    audits = {w["well"]: w for w in intake["wells"]}
    variants = {"primary": qc["primary_caliper_difference_in"],
                **{f"caliper_{str(t).replace('.', '_')}in": t for t in qc["caliper_sensitivity_in"]},
                "quality_unknown_or_flagged_included": None}
    cohorts, counts = {v: [] for v in variants}, {v: {} for v in variants}
    reviews, supports = [], []
    for well, assignment in development_wells(split).items():
        info = metadata.get(well, {})
        evidence = depth_evidence(well, books["groups"].get(well, []), info, audits[well], qc)
        review = {"well": well, "group": assignment["group"], "datum": evidence}
        reviews.append(review)
        if not evidence["supported"]:
            review["excluded"] = evidence["reason"]
            continue
        angle = number(info.get("wlbMaxInclation"))
        review["maximumInclinationDegrees"] = angle
        if angle is None or angle < 0 or angle > qc["max_inclination_deg"]:
            review["excluded"] = "inclination above limit or unknown"
            continue
        path = development_log_path(data, split, well)
        review["preparedLogSha256"] = sha256(path)
        review["windows"] = {}
        with np.load(path, allow_pickle=False) as arrays:
            for variant, tolerance in variants.items():
                quality = caliper_mask(arrays, tolerance)
                rows, dispositions = aggregate(arrays, evidence["water_depth_m"], qc, quality)
                review["windows"][variant] = len(rows)
                for reason, count in dispositions.items():
                    counts[variant][reason] = counts[variant].get(reason, 0)+count
                for row in rows:
                    row.update(well=well, group=assignment["group"])
                    if variant == "primary":
                        supports.append((row, support_segments(arrays, evidence["water_depth_m"], row, qc, quality)))
                cohorts[variant].extend(rows)
    return cohorts, supports, {"wells": reviews, "windowDisposition": counts,
                               "sourceArchiveSha256": intake["archive"]["sha256"],
                               "sourceAuditSha256": sha256(data/"audit.json"),
                               "metadataBookHashes": book_hashes}


def main(args):
    if args.out.exists():
        raise FileExistsError("Choose a fresh output directory; earlier results are preserved")
    plan = json.loads((HERE/"plan.json").read_text())
    for name, expected in plan["frozenInputs"].items():
        if sha256(ROOT/name) != expected:
            raise ValueError(f"Frozen input changed: {name}")
    qc = json.loads((ROOT/"validation/force2020/benchmark-plan.json").read_text())
    split = json.loads((ROOT/"validation/force2020/split.json").read_text())
    accesses = install_log_guard(args.data/"development")
    engine = Engine(args.engine, threads=4)
    cohorts, supports, intake = load_cohorts(args.data, args.downloads, qc, split)
    primary = cohorts["primary"]
    if not primary:
        raise ValueError("Empty screened cohort cannot be a successful validation")
    # Reproduce every original fixed-bin scenario through the Rust core.
    profile_rows = [{"facies_code": int(code), "bin": b} for code in qc["facies"]
                    for b in range(qc["depth_max_m"]//qc["bin_width_m"])]
    width = qc["bin_width_m"]
    profile_support = [(r, [(r["bin"]*width, (r["bin"]+1)*width)]) for r in profile_rows]
    queries = predict_support(engine, profile_support, qc["scenarios"])
    profiles = {(r["facies_code"], r["bin"]): r for r in profile_rows}
    for rows in cohorts.values():
        for row in rows:
            row["rust_full_bin"] = profiles[(row["facies_code"], row["bin"])]["present_hydrostatic"]
    queries += predict_support(engine, supports, qc["scenarios"])
    for row in primary:
        row["rust_matched_support"] = row["present_hydrostatic"]
    fits = {}
    for partition in ("parent", "quadrant"):
        for kind in ("depth", "facies-linear", "facies-quadratic"):
            name = f"{kind}_{partition}_cv"
            values, fits[name] = baseline_cv(primary, kind, partition)
            for row, value in zip(primary, values):
                row[name] = value
    bootstrap = plan["uncertainty"]
    fields = ["rust_full_bin", "rust_matched_support", *fits]
    score = {name: metrics(primary, name, bootstrap) for name in fields}
    breakdown = lambda rows: {name: metrics(rows, name) for name in fields}
    report = {"schema": "earthforge-field-alpha2-results-v1", "createdAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
              "scope": "Previously explored FORCE development cohort; conditional clastic velocity validation, not generated geological geometry, an independent final test or a SOTA ranking.",
              "planSha256": sha256(HERE/"plan.json"), "sourceCommit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
              "engineSha256": engine.sha256, "physicsSourceSha256": sha256(ROOT/"crates/earthforge-core/src/physics.rs"),
              "analysisSourceSha256": {p.name: sha256(p) for p in (HERE/"run.py", HERE/"analysis.py")},
              "dependencies": {name: importlib.metadata.version(name) for name in ("numpy", "openpyxl", "et-xmlfile")},
              "cohort": {"windows": len(primary), "wells": len({r["well"] for r in primary}), "parents": len({r["group"] for r in primary}),
                         "quadrants": len({quadrant(r) for r in primary}), "verticalSupportMetres": sum(r["coverage_m"] for r in primary),
                         "faciesWindows": {code: sum(r["facies_code"] == int(code) for r in primary) for code in qc["facies"]}},
              "scores": score,
              "pairedDifferences": [paired_difference(primary, "rust_matched_support", field, bootstrap) for field in fields if field != "rust_matched_support"],
              "supportMatching": {"maximumPredictionChangeMps": max(abs(r["rust_full_bin"]-r["rust_matched_support"]) for r in primary),
                                  "nativePhysicsEvaluations": queries, "integrationMaximumSpacingMetres": 1},
              "sensitivityScores": {s: metrics(primary, s) for s in qc["scenarios"]},
              "qualitySensitivity": {v: metrics(rows, "rust_full_bin") for v, rows in cohorts.items()},
              "byDepth": {f"{lo}-{lo+1000}": breakdown([r for r in primary if lo <= r["depth_m"] < lo+1000]) for lo in (0, 1000, 2000)},
              "byFacies": {code: breakdown([r for r in primary if r["facies_code"] == int(code)]) for code in qc["facies"]},
              "byQuadrant": {q: breakdown([r for r in primary if quadrant(r) == q]) for q in sorted({quadrant(r) for r in primary})},
              "access": {"developmentLogFilesRead": len(accesses), "developmentFiles": sorted(accesses), "holdoutArraysOpened": 0,
                         "enforcement": "Membership/path guards plus process audit hook rejecting NPZ paths outside development and writes to logs"},
              "noPhysicsOrQaChanges": True, "accuracyAcceptanceThreshold": None}
    args.out.mkdir(parents=True)
    save_json(args.out/"report.json", report)
    save_json(args.out/"intake.json", intake)
    save_json(args.out/"baseline-folds.json", fits)
    save_json(args.out/"rust-profiles.json", profile_rows)
    with (args.out/"predictions.csv").open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(primary[0]))
        writer.writeheader(); writer.writerows(primary)
    print(json.dumps({"cohort": report["cohort"], "scores": score, "supportMatching": report["supportMatching"],
                      "developmentLogsRead": len(accesses), "holdoutArraysOpened": 0}, indent=2))
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--downloads", type=Path, required=True)
    parser.add_argument("--engine", type=Path, default=ROOT/"target/release/earthforge")
    parser.add_argument("--out", type=Path, required=True)
    main(parser.parse_args())
