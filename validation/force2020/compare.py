#!/usr/bin/env python3
"""Development-only, untuned rock-physics comparison; see benchmark-plan.json."""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import csv
import json
from pathlib import Path

import numpy as np

from prepare import read_books, read_sodir, sha256, write_json, number

HERE = Path(__file__).resolve().parent


def development_wells(split):
    return {w: a for w, a in split["wells"].items() if a["partition"] == "development"}


def development_log_path(data, split, well):
    if split["wells"].get(well, {}).get("partition") != "development":
        raise ValueError("Only frozen development wells may be opened by this comparison")
    root = (data / "development").resolve()
    path = root / (well.replace("/", "_") + ".npz")
    if not path.resolve().is_relative_to(root):
        raise ValueError("Development log path escapes the development directory")
    return path


def depth_evidence(well, picks, info, audit, plan):
    result = {"well": well, "supported": False}
    if not info:
        return result | {"reason": "unresolved well identity"}
    water, kb = number(info.get("wlbWaterDepth")), number(info.get("wlbKellyBushElevation"))
    tops = [r for r in picks if str(r.get("Surface", "")).upper() == "NORDLAND GP. TOP"]
    if water is None or water <= 0 or kb is None or len(tops) != 1:
        return result | {"reason": "missing or ambiguous sea-floor reference"}
    md, z = number(tops[0].get("MD")), number(tops[0].get("Z"))
    if md is None or z is None:
        return result | {"reason": "invalid reference coordinates"}
    result.update(water_depth_m=water, rkb_elevation_m=kb,
                  seabed_z_difference_m=z + water, seabed_md_difference_m=md - water - kb,
                  coordinate_ties=audit["pick_z_comparisons"],
                  max_coordinate_tie_error_m=audit["pick_z_max_abs_error_m"],
                  sodir_url=info["wlbFactPageUrl"], sodir_id=info["wlbNpdidWellbore"])
    if max(abs(z + water), abs(md - water - kb)) > plan["datum_tolerance_m"] + 1e-8:
        return result | {"reason": "sea-floor datum discrepancy"}
    if (audit["pick_z_comparisons"] < plan["min_coordinate_ties"] or
        audit["pick_z_max_abs_error_m"] is None or
        audit["pick_z_max_abs_error_m"] > plan["max_coordinate_tie_error_m"]):
        return result | {"reason": "insufficient or inconsistent LAS-to-pick coordinate ties"}
    return result | {"supported": True, "reason": "sea-floor datum supported by SODIR and coordinate ties"}


def sample_support(md, depth, max_gap):
    """Nearest-sample vertical supports, truncated at nulls/gaps/trajectory reversals."""
    left, right = depth.copy(), depth.copy()
    dz, dm = np.diff(depth), np.diff(md)
    adjacent = (np.isfinite(dz) & np.isfinite(dm) & (dm > 0) & (dz > 0) &
                (dz <= max_gap) & (dm <= max_gap) & (dz <= 1.02 * dm))
    mids = (depth[:-1] + depth[1:]) / 2
    right[:-1] = np.where(adjacent, mids, depth[:-1])
    left[1:] = np.where(adjacent, mids, depth[1:])
    return left, right


def caliper_mask(arrays, tolerance):
    cal, bit = arrays["cali_in"], arrays["bit_size_in"]
    known = np.isfinite(cal) & np.isfinite(bit) & (cal > 0) & (bit > 0)
    if tolerance is None:
        return np.ones(cal.shape, dtype=bool)
    return known & (np.abs(cal - bit) <= tolerance)


def aggregate(arrays, water_depth, plan, quality):
    depth = -arrays["z_loc_original"] - water_depth
    left, right = sample_support(arrays["md_m"], depth, plan["max_adjacent_depth_gap_m"])
    vp, lith = arrays["vp_m_s"], arrays["lithology_code"]
    valid = (np.isfinite(vp) & (vp > 0) & (arrays["lithology_confidence"] == plan["confidence"]) & quality)
    width, records, counts = plan["bin_width_m"], [], Counter()
    for b in range(plan["depth_max_m"] // width):
        lo, hi = b * width, (b + 1) * width
        inside = np.isfinite(left) & np.isfinite(right) & (right > lo) & (left < hi) & (right > left)
        if not inside.any():
            counts["no_coordinate_coverage"] += 1
            continue
        observed_codes = np.unique(lith[inside & np.isfinite(lith)])
        if len(observed_codes) != 1:
            counts["mixed_or_unlabelled_window"] += 1
            continue
        code = observed_codes[0]
        if str(int(code)) not in plan["facies"] or code != int(code):
            counts["out_of_scope_facies"] += 1
            continue
        used = inside & valid & (lith == code)
        overlap = np.maximum(0, np.minimum(right[used], hi) - np.maximum(left[used], lo))
        coverage = float(overlap.sum())
        if coverage < width * plan["min_coverage_fraction"] - 1e-9:
            counts["insufficient_quality_coverage"] += 1
            continue
        l, r = np.maximum(left[used], lo), np.minimum(right[used], hi)
        # Even with >90% total support, never bridge an internal >1 m gap.
        if len(l) > 1 and np.max(l[1:] - r[:-1]) > plan["max_adjacent_depth_gap_m"]:
            counts["internal_quality_gap"] += 1
            continue
        measured = coverage / float(np.sum(overlap / vp[used]))
        records.append({"bin": b, "depth_m": (lo + hi) / 2, "facies_code": int(code),
                        "observed_m_s": measured, "coverage_m": coverage,
                        "sample_count": int(used.sum()), "constant_sonic": bool(np.ptp(vp[used]) == 0)})
        counts["accepted"] += 1
    return records, dict(counts)


def baseline_loo(rows):
    """Out-of-group linear baseline, with equal total weight per training group."""
    groups = np.array([r["group"] for r in rows])
    x = np.column_stack([np.ones(len(rows)), [r["depth_m"] / 1000 for r in rows]])
    y = np.array([r["observed_m_s"] for r in rows])
    predicted = np.full(len(rows), np.nan)
    group_counts = Counter(groups)
    weights = np.array([1 / group_counts[g] for g in groups])
    for held in sorted(group_counts):
        train = groups != held
        if len(set(groups[train])) < 2:
            continue
        rootw = np.sqrt(weights[train])
        coef = np.linalg.lstsq(x[train] * rootw[:, None], y[train] * rootw, rcond=None)[0]
        predicted[~train] = x[~train] @ coef
    return predicted


def metrics(rows, field, bootstrap=None):
    if not rows:
        return None
    errors = defaultdict(list)
    for r in rows:
        value = r[field]
        if not np.isfinite(value):
            raise ValueError("Missing prediction cannot silently disappear from metrics")
        errors[r["group"]].append(value - r["observed_m_s"])
    stat = np.array([[np.mean(e), np.mean(np.abs(e)), np.mean(np.square(e))]
                     for _, e in sorted(errors.items())])
    result = {"windows": len(rows), "wells": len({r["well"] for r in rows}), "groups": len(errors),
              "bias_m_s": float(stat[:, 0].mean()), "mae_m_s": float(stat[:, 1].mean()),
              "rmse_m_s": float(np.sqrt(stat[:, 2].mean()))}
    if bootstrap and len(stat) > 1:
        rng = np.random.default_rng(bootstrap["seed"])
        resampled = stat[rng.integers(0, len(stat), (bootstrap["repeats"], len(stat)))].mean(axis=1)
        resampled[:, 2] = np.sqrt(resampled[:, 2])
        bounds = np.percentile(resampled, bootstrap["interval_percent"], axis=0)
        result["parent_bootstrap_95_percent"] = {key: bounds[:, i].tolist()
            for i, key in enumerate(("bias_m_s", "mae_m_s", "rmse_m_s"))}
    return result


def attach_predictions(rows, models):
    for r in rows:
        for scenario, profile in models.items():
            r[scenario] = profile[str(r["facies_code"])][r["bin"]]
    if rows:
        for r, prediction in zip(rows, baseline_loo(rows)):
            r["baseline_loo"] = float(prediction)


def paired_mae_difference(rows, bootstrap):
    """Paired resampling of stored per-group errors; negative favors the model."""
    differences = defaultdict(list)
    for r in rows:
        observed = r["observed_m_s"]
        differences[r["group"]].append(abs(r["present_hydrostatic"] - observed)
                                        - abs(r["baseline_loo"] - observed))
    values = np.array([np.mean(v) for _, v in sorted(differences.items())])
    if not len(values):
        return None
    rng = np.random.default_rng(bootstrap["seed"])
    draws = values[rng.integers(0, len(values), (bootstrap["repeats"], len(values)))].mean(axis=1)
    return {"model_minus_baseline_mae_m_s": float(values.mean()),
            "parent_bootstrap_95_percent_m_s": np.percentile(draws, bootstrap["interval_percent"]).tolist(),
            "interpretation": "negative favors model; interval is conditional on this selected cohort and stored CV predictions"}


def compare(data, downloads, output, profiles=None):
    plan_path = HERE / "benchmark-plan.json"
    plan = json.loads(plan_path.read_text())
    split_path = HERE / "split.json"
    split = json.loads(split_path.read_text())
    intake = json.loads((data / "audit.json").read_text())
    profiles_path = profiles or data / "model-profiles.json"
    models = json.loads(profiles_path.read_text())
    if models["plan_sha256"] != sha256(plan_path):
        raise ValueError("Model profiles were made for a different comparison plan")
    if models["simulator_source_sha256"] != sha256(HERE.parent.parent / "src/basin.ts"):
        raise ValueError("Simulator changed since profiles were exported")
    if sha256(split_path) != intake["split_sha256"]:
        raise ValueError("Split changed since data preparation")
    metadata = read_sodir(data / "sodir-exploration.csv")
    if sha256(data / "sodir-exploration.csv") != intake["sodir"]["sha256"]:
        raise ValueError("SODIR snapshot differs from intake")
    books, book_hashes = read_books(downloads)
    for kind, book in book_hashes.items():
        if book["sha256"] != intake["books"][kind]["sha256"]:
            raise ValueError(f"Metadata workbook changed: {kind}")
    audits = {w["well"]: w for w in intake["wells"]}
    variants = {"primary": plan["primary_caliper_difference_in"]}
    variants.update({f"caliper_{str(t).replace('.', '_')}in": t for t in plan["caliper_sensitivity_in"]})
    variants["quality_unknown_or_flagged_included"] = None
    cohorts = {v: [] for v in variants}
    reasons = {v: Counter() for v in variants}
    depth_checks, well_checks = [], []
    for well, assignment in development_wells(split).items():
        audit, info = audits[well], metadata.get(well, {})
        evidence = depth_evidence(well, books["groups"].get(well, []), info, audit, plan)
        depth_checks.append(evidence)
        inclination = number(info.get("wlbMaxInclation"))
        review = {"well": well, "group": assignment["group"], "depth_supported": evidence["supported"],
                  "maximum_inclination_deg": inclination, "windows": {}}
        if not evidence["supported"]:
            review["exclusion"] = evidence["reason"]
            well_checks.append(review)
            continue
        if inclination is None or inclination < 0 or inclination > plan["max_inclination_deg"]:
            review["exclusion"] = f"inclination above {plan['max_inclination_deg']} degrees or unknown"
            well_checks.append(review)
            continue
        # Only this explicit development path is opened. No holdout-array reads.
        input_path = development_log_path(data, split, well)
        review["prepared_log_sha256"] = sha256(input_path)
        with np.load(input_path, allow_pickle=False) as arrays:
            for variant, tolerance in variants.items():
                records, counts = aggregate(arrays, evidence["water_depth_m"], plan, caliper_mask(arrays, tolerance))
                for r in records:
                    r.update(well=well, group=assignment["group"])
                cohorts[variant].extend(records)
                reasons[variant].update(counts)
                review["windows"][variant] = len(records)
        well_checks.append(review)
    for rows in cohorts.values():
        attach_predictions(rows, models["profiles"])
    primary = cohorts["primary"]
    if not primary:
        raise ValueError("No quality-screened windows: do not emit an empty success")
    fields = list(plan["scenarios"]) + ["baseline_loo"]
    summary = {
        "stage": "development-only conditional rock-physics diagnostic; no tuning or holdout scores",
        "plan_sha256": sha256(plan_path), "split_sha256": sha256(split_path),
        "simulator_source_sha256": models["simulator_source_sha256"],
        "model_profiles_sha256": sha256(profiles_path),
        "model_revision": models.get("model_revision", "original"),
        "comparison_source_sha256": sha256(HERE / "compare.py"),
        "exporter_sha256": models.get("exporter_sha256"),
        "intake_audit_sha256": sha256(data / "audit.json"),
        "source_archive_sha256": intake["archive"]["sha256"],
        "development_wells": len(development_wells(split)),
        "depth_supported_wells": sum(r["supported"] for r in depth_checks),
        "depth_exclusions": [r for r in depth_checks if not r["supported"]],
        "near_vertical_wells": sum("exclusion" not in r for r in well_checks),
        "primary_scores": {f: metrics(primary, f, plan["bootstrap"]) for f in fields},
        "paired_baseline_comparison": paired_mae_difference(primary, plan["bootstrap"]),
        "quality_sensitivity": {v: {"model": metrics(rows, "present_hydrostatic"),
                                   "baseline": metrics(rows, "baseline_loo"),
                                   "window_disposition": dict(reasons[v])}
                                for v, rows in cohorts.items()},
        "by_depth": {f"{lo}-{lo+1000}m": {
            f: metrics([r for r in primary if lo <= r["depth_m"] < lo + 1000], f)
            for f in ("present_hydrostatic", "baseline_loo")}
            for lo in range(0, plan["depth_max_m"], 1000)},
        "by_facies": {props["name"]: {f: metrics([r for r in primary if str(r["facies_code"]) == code], f)
            for f in ("present_hydrostatic", "baseline_loo")} for code, props in plan["facies"].items()},
        "constant_sonic_windows": sum(r["constant_sonic"] for r in primary),
        "observed_outside_model_cap_windows": sum(not 1500 <= r["observed_m_s"] <= 5600 for r in primary),
        "observed_vertical_support_m": sum(r["coverage_m"] for r in primary),
        "depth_checks": depth_checks, "well_checks": well_checks,
    }
    output.mkdir(parents=True, exist_ok=True)
    write_json(output / "comparison.json", summary)
    with (output / "primary-windows.csv").open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(primary[0]))
        writer.writeheader()
        writer.writerows(primary)
    print(json.dumps({k: summary[k] for k in ("development_wells", "depth_supported_wells", "near_vertical_wells", "primary_scores", "by_depth", "by_facies")}, indent=2))
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=Path("data/force2020"))
    parser.add_argument("--downloads", type=Path, required=True)
    parser.add_argument("--profiles", type=Path, help="Explicit model profiles; preserves earlier comparison artifacts")
    parser.add_argument("--output", type=Path, default=Path("data/force2020/comparison"))
    args = parser.parse_args()
    compare(args.data, args.downloads, args.output, args.profiles)
