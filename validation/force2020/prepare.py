#!/usr/bin/env python3
"""Audit FORCE LAS 2.0 files without imputing data or fitting the simulator.

Reads the original archive in place, one well at a time. See protocol.md for
the depth-reference limitation and the frozen, grouped holdout design.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import csv
import hashlib
import io
import json
import math
from pathlib import Path
import re
import zipfile

import numpy as np
from openpyxl import load_workbook

ARCHIVE = "LAS_files_Force_2020_all_wells_train_test_blind_hidden_final.zip"
BOOKS = {
    "casing": "NPD_Casing_depth_most_wells.xlsx",
    "formations": "NPD_Lithostratigraphy_member_formations_all_wells.xlsx",
    "groups": "NPD_Lithostratigraphy_groups_all_wells.xlsx",
    "classification_costs": "lithology scoring matrix cost function.xlsx",
}
LITHOLOGY = {
    30000: "Sandstone", 65030: "Sandstone/Shale", 65000: "Shale",
    80000: "Marl", 74000: "Dolomite", 70000: "Limestone", 70032: "Chalk",
    88000: "Halite", 86000: "Anhydrite", 99000: "Tuff", 90000: "Coal",
    93000: "Basement",
}
CLASTICS = (30000, 65000, 65030)
SPLIT_SALT = "earthforge-force2020-grouped-v1"
SODIR_URL = ("https://factpages.sodir.no/public?/Factpages/external/tableview/"
             "wellbore_exploration_all&CultureCode=en&IpAddress=not_used&Top100=false"
             "&rs:Command=Render&rs:Format=CSV&rc:Toolbar=false&rc:Parameters=f")


def sha256(path: Path) -> str:
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def write_json(path: Path, obj) -> None:
    path.write_text(json.dumps(obj, indent=2, sort_keys=True, allow_nan=False) + "\n")


def normalize_well(name: str) -> str:
    return " ".join(name.strip().upper().split())


def parent_group(well: str) -> str:
    # These exploration names share their numeric parent even when FORCE adds
    # unofficial ST/T suffixes. Fail on an unfamiliar naming convention.
    match = re.fullmatch(r"(\d+/\d+-\d+)(?: [A-Z0-9 ]+)?", normalize_well(well))
    if not match:
        raise ValueError(f"Unrecognized well name: {well}")
    return match.group(1)


def make_split(wells: list[str]) -> dict:
    if len(wells) != len(set(wells)):
        raise ValueError("Duplicate well identities")
    groups = sorted({parent_group(well) for well in wells})
    if len(groups) < 2:
        raise ValueError("Need at least two independent well groups")
    ranked = sorted(groups, key=lambda g: hashlib.sha256(f"{SPLIT_SALT}:{g}".encode()).hexdigest())
    held = set(ranked[:math.ceil(len(groups) / 5)])
    return {
        "version": 1, "salt": SPLIT_SALT,
        "method": "Lowest SHA256 ranks: ceil(20% of numeric parent-well groups)",
        "purpose": "Earth Forge holdout; not the original FORCE competition split",
        "wells": {w: {"group": parent_group(w), "partition": "holdout" if parent_group(w) in held
                       else "development"} for w in sorted(wells)},
    }


def freeze_split(path: Path, candidate: dict) -> dict:
    if path.exists():
        frozen = json.loads(path.read_text())
        if frozen != candidate:
            raise ValueError("Frozen split differs from these wells/rules; do not silently resplit")
        return frozen
    path.parent.mkdir(parents=True, exist_ok=True)
    # Exclusive creation avoids overwriting an existing experiment split.
    with path.open("x") as handle:
        json.dump(candidate, handle, indent=2, sort_keys=True, allow_nan=False)
        handle.write("\n")
    return candidate


def las_header(stream) -> tuple[dict, list[tuple[str, str]]]:
    header, curves, section = {}, [], ""
    for raw in stream:
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("~"):
            section = line[1:2].upper()
            if section == "A":
                break
            continue
        if section not in ("V", "W", "C"):
            continue
        prefix = line.split(":", 1)[0]
        match = re.fullmatch(r"\s*([^\.]+)\.([^\s]*)(?:\s+(.*?))?\s*", prefix)
        if not match:
            raise ValueError(f"Malformed LAS header: {line}")
        name, unit, value = match.group(1).strip().upper(), match.group(2), match.group(3) or ""
        if section == "C":
            curves.append((name, unit))
        else:
            header[name] = (unit, value.strip())
    else:
        raise ValueError("LAS has no ASCII section")
    if header.get("VERS", (None, None))[1] != "2.0" or header.get("WRAP", (None, None))[1] != "NO":
        raise ValueError("Only unwrapped LAS 2.0 is supported")
    if len({c[0] for c in curves}) != len(curves):
        raise ValueError("Duplicate LAS curve name")
    if not curves or curves[0] != ("DEPT", "m"):
        raise ValueError("Expected a DEPT index in metres")
    for name, unit in (("DTC", "us/ft"), ("RHOB", "g/cm3")):
        if dict(curves).get(name) != unit:
            raise ValueError(f"Unsupported {name} unit: {dict(curves).get(name)}")
    if not header.get("UWI", (None, ""))[1] or "NULL" not in header:
        raise ValueError("Missing LAS well identity or null value")
    return header, curves


def read_las(stream) -> tuple[dict, dict[str, np.ndarray]]:
    header, curves = las_header(stream)
    # loadtxt validates the column count on every row; never reshape a flat
    # array whose missing fields might shift subsequent observations.
    values = np.loadtxt(stream, dtype=np.float64, ndmin=2)
    if values.shape[1] != len(curves) or not len(values):
        raise ValueError("LAS data do not match the declared curves")
    values[values == float(header["NULL"][1])] = np.nan
    columns = {name: values[:, i] for i, (name, _) in enumerate(curves)}
    md = columns["DEPT"]
    if not np.isfinite(md).all() or not (np.diff(md) > 0).all():
        raise ValueError("Depth index must be finite and strictly increasing")
    duplicate = columns.get("DEPTH_MD")
    if duplicate is not None:
        valid = np.isfinite(duplicate)
        if not np.allclose(md[valid], duplicate[valid], rtol=0, atol=0.001):
            raise ValueError("DEPT and DEPTH_MD disagree")
    header["curves"] = dict(curves)
    return header, columns


def sonic_velocity(dtc: np.ndarray) -> np.ndarray:
    result = np.full(dtc.shape, np.nan)
    np.divide(304800.0, dtc, out=result, where=np.isfinite(dtc) & (dtc > 0))
    return result


def provisional_depth(z: np.ndarray, water_depth: float | None) -> np.ndarray:
    """Assumes Z is elevation relative to MSL; does not certify that datum."""
    if water_depth is None or not math.isfinite(water_depth) or water_depth <= 0:
        return np.full(z.shape, np.nan)
    return -z - water_depth


def interpolate_local(md: np.ndarray, values: np.ndarray, queries: np.ndarray,
                      max_gap: float = 1.0) -> np.ndarray:
    """No extrapolation, no interpolation through nulls or >1 m sample gaps."""
    result = np.full(queries.shape, np.nan)
    for i, q in enumerate(queries):
        j = int(np.searchsorted(md, q))
        if j < len(md) and md[j] == q:
            result[i] = values[j]
        elif 0 < j < len(md) and md[j] - md[j - 1] <= max_gap:
            if np.isfinite(values[j - 1:j + 1]).all():
                fraction = (q - md[j - 1]) / (md[j] - md[j - 1])
                result[i] = values[j - 1] + fraction * (values[j] - values[j - 1])
    return result


def read_books(folder: Path) -> tuple[dict, dict]:
    tables, audit = {}, {}
    for kind, filename in BOOKS.items():
        path = folder / filename
        workbook = load_workbook(path, read_only=True, data_only=True)
        sheet = workbook.worksheets[0]
        rows = [list(r) for r in sheet.values if any(v is not None for v in r)]
        by_well = defaultdict(list)
        if kind != "classification_costs":
            columns = rows[0]
            for row in rows[1:]:
                record = {str(k): v for k, v in zip(columns, row) if k is not None}
                if record.get("Well identifier"):
                    by_well[normalize_well(str(record["Well identifier"]))].append(record)
        tables[kind] = dict(by_well)
        audit[kind] = {"file": filename, "sha256": sha256(path), "sheet": sheet.title,
                       "nonempty_rows": len(rows), "wells": len(by_well),
                       "role": "classification penalty only, not a velocity score" if kind == "classification_costs"
                       else "context picks; not a log-quality certificate"}
        workbook.close()
    return tables, audit


def read_sodir(path: Path) -> dict:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        required = {"wlbWellboreName", "wlbWell", "wlbWaterDepth", "wlbKellyBushElevation"}
        if not required <= set(reader.fieldnames or []):
            raise ValueError("Expected the SODIR exploration-wellbore CSV export")
        result = {}
        for row in reader:
            well = normalize_well(row["wlbWellboreName"])
            if well in result:
                raise ValueError(f"Duplicate SODIR wellbore {well}")
            result[well] = row
        return result


def number(value) -> float | None:
    try:
        v = float(value)
        return v if math.isfinite(v) else None
    except (ValueError, TypeError):
        return None


def count(mask) -> int:
    return int(np.count_nonzero(mask))


def categories(values) -> dict[str, int]:
    finite = values[np.isfinite(values)]
    return {str(float(v)): int(n) for v, n in zip(*np.unique(finite, return_counts=True))}


def audit_well(well: str, columns: dict, tables: dict, metadata: dict) -> tuple[dict, dict]:
    md = columns["DEPT"]
    empty = np.full(md.shape, np.nan)
    get = lambda key: columns.get(key, empty)
    vp = sonic_velocity(get("DTC"))
    z, lith, confidence = get("Z_LOC"), get("FORCE_2020_LITHOFACIES_LITHOLOGY"), get("FORCE_2020_LITHOFACIES_CONFIDENCE")
    info = metadata.get(well, {})  # Exact names only: no implicit suffix matching.
    water = number(info.get("wlbWaterDepth"))
    rkb = number(info.get("wlbKellyBushElevation"))
    depth = provisional_depth(z, water)
    has_vp, has_z = np.isfinite(vp), np.isfinite(z)
    labelled = np.isin(lith, list(LITHOLOGY))
    candidate = has_vp & np.isfinite(depth) & (depth >= 0) & (depth <= 3000) & np.isin(lith, CLASTICS) & (confidence == 1)
    # Do not clip to the simulator's 1500–5600 m/s cap, or discard thin beds.
    # These arrays retain every original index and keep nulls as NaN.
    arrays = {"md_m": md, "z_loc_original": z, "vp_m_s": vp,
              "depth_below_seafloor_provisional_m": depth,
              "rhob_kg_m3": get("RHOB") * 1000, "lithology_code": lith,
              "lithology_confidence": confidence, "candidate_clastic": candidate,
              "cali_in": get("CALI"), "bit_size_in": get("BS"),
              "density_correction_g_cm3": get("DRHO"), "nphi_original": get("NPHI")}
    picks = [r for kind in ("formations", "groups", "casing") for r in tables[kind].get(well, [])]
    usable = [r for r in picks if number(r.get("MD")) is not None and number(r.get("Z")) is not None]
    query = np.array([float(r["MD"]) for r in usable])
    expected = np.array([float(r["Z"]) for r in usable])
    residual = interpolate_local(md, z, query) - expected
    residual = residual[np.isfinite(residual)]
    minimum_offset = float(np.min((md + z)[has_z])) if has_z.any() else None
    result = {
        "well": well, "rows": len(md), "md_min_m": float(md[0]), "md_max_m": float(md[-1]),
        "vp_rows": count(has_vp), "rhob_rows": count(np.isfinite(get("RHOB"))),
        "z_rows": count(has_z), "labelled_rows": count(labelled),
        "high_confidence_rows": count(labelled & (confidence == 1)),
        "vp_and_z_rows": count(has_vp & has_z), "candidate_clastic_rows": count(candidate),
        "vp_outside_model_cap_rows": count(has_vp & ((vp < 1500) | (vp > 5600))),
        "candidate_outside_model_cap_rows": count(candidate & ((vp < 1500) | (vp > 5600))),
        "candidate_with_density_rows": count(candidate & np.isfinite(get("RHOB"))),
        "candidate_with_caliper_and_bit_size_rows": count(candidate & np.isfinite(get("CALI")) & np.isfinite(get("BS"))),
        "nonpositive_dtc_rows": count(np.isfinite(get("DTC")) & (get("DTC") <= 0)),
        "unknown_lithology_rows": count(np.isfinite(lith) & ~labelled),
        "unknown_confidence_rows": count(np.isfinite(confidence) & ~np.isin(confidence, (1, 2, 3))),
        "sonic_without_lithology_rows": count(has_vp & ~labelled),
        "casing_picks": len(tables["casing"].get(well, [])),
        "formation_picks": len(tables["formations"].get(well, [])),
        "group_picks": len(tables["groups"].get(well, [])),
        "sodir_exact_match": bool(info), "sodir_id": info.get("wlbNpdidWellbore"),
        "sodir_parent": info.get("wlbWell"), "water_depth_m": water,
        "rkb_elevation_m": rkb, "max_inclination_deg": number(info.get("wlbMaxInclation")),
        "water_column_vp_rows_provisional": count(has_vp & (depth < 0)),
        "pick_z_comparisons": len(residual),
        "pick_z_median_abs_error_m": float(np.median(np.abs(residual))) if len(residual) else None,
        "pick_z_max_abs_error_m": float(np.max(np.abs(residual))) if len(residual) else None,
        "min_md_plus_z_m": minimum_offset,
        "min_md_plus_z_minus_rkb_m": minimum_offset - rkb if minimum_offset is not None and rkb is not None else None,
        "depth_status": "provisional_Z_MSL_assumption" if info and has_z.any() else "unresolved",
        "curve_units": {},
    }
    return result, arrays


def prepare(downloads: Path, sodir_path: Path, output: Path, split_path: Path) -> dict:
    archive_path = downloads / ARCHIVE
    archive_hash = sha256(archive_path)
    tables, books_audit = read_books(downloads)
    metadata = read_sodir(sodir_path)
    output.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive_path) as archive:
        members = sorted(n for n in archive.namelist() if n.lower().endswith(".las"))
        identities = {}
        for member in members:
            with archive.open(member) as raw, io.TextIOWrapper(raw, encoding="utf-8-sig") as stream:
                header, _ = las_header(stream)
            identities[member] = normalize_well(header["UWI"][1])
        # Freeze before reading numeric observations, computing residuals or fitting.
        candidate_split = make_split(list(identities.values()))
        candidate_split["archive_sha256"] = archive_hash
        split = freeze_split(split_path, candidate_split)
        # Check official parents too: the numeric grouping must not split them.
        official_partitions = defaultdict(set)
        for well, assignment in split["wells"].items():
            parent = metadata.get(well, {}).get("wlbWell")
            if parent:
                official_partitions[parent].add(assignment["partition"])
        if any(len(parts) > 1 for parts in official_partitions.values()):
            raise ValueError("Official SODIR parent well crosses partitions")
        wells, lith_counts, confidence_counts = [], Counter(), Counter()
        for i, member in enumerate(members):
            with archive.open(member) as raw, io.TextIOWrapper(raw, encoding="utf-8-sig") as stream:
                header, columns = read_las(stream)
            well = identities[member]
            audit, arrays = audit_well(well, columns, tables, metadata)
            audit["curve_units"] = header["curves"]
            audit.update(split["wells"][well])
            audit["member"] = member
            audit["member_crc32"] = f"{archive.getinfo(member).CRC:08x}"
            partition = output / audit["partition"]
            partition.mkdir(exist_ok=True)
            np.savez_compressed(partition / (well.replace("/", "_") + ".npz"), **arrays)
            lith_counts.update(categories(arrays["lithology_code"]))
            confidence_counts.update(categories(arrays["lithology_confidence"]))
            wells.append(audit)
            if (i + 1) % 20 == 0:
                print(f"Audited {i + 1}/{len(members)} wells", flush=True)
    total_keys = [k for k in wells[0] if k.endswith("_rows")] + ["rows"]
    summary = {
        "schema_version": 1, "stage": "data preparation only; no simulator accuracy scores",
        "archive": {"name": ARCHIVE, "sha256": archive_hash, "bytes": archive_path.stat().st_size},
        "books": books_audit,
        "sodir": {"source": SODIR_URL, "sha256": sha256(sodir_path),
                   "sync_dates": sorted({r.get("datesyncNPD", "") for r in metadata.values()})},
        "split_sha256": sha256(split_path),
        "well_count": len(wells), "parent_groups": len({w["group"] for w in wells}),
        "partitions": dict(Counter(w["partition"] for w in wells)),
        "totals": {key: sum(w[key] for w in wells) for key in total_keys},
        "sodir_unmatched": [w["well"] for w in wells if not w["sodir_exact_match"]],
        "wells_with_candidates": sum(w["candidate_clastic_rows"] > 0 for w in wells),
        "pick_z_comparisons": sum(w["pick_z_comparisons"] for w in wells),
        "pick_z_max_abs_error_m": max((w["pick_z_max_abs_error_m"] for w in wells
                                      if w["pick_z_max_abs_error_m"] is not None), default=None),
        "lithology_counts": dict(lith_counts), "confidence_counts": dict(confidence_counts),
        "lithology_codes": LITHOLOGY,
        "limitations": [
            "Z_LOC is unit '_' in LAS. MSL elevation is an inference, not a certified datum.",
            "Candidate clastic rows are provisional and not final QC-approved validation observations.",
            "No imputation, log smoothing, model-range clipping, calibration or holdout scoring.",
            "Lithology confidence measures interpretation confidence, not sonic measurement quality.",
            "Casing shoes alone do not establish whether a log was acquired through casing.",
            "Pressure, pore fluids and maximum burial are not supplied as independent constraints.",
        ],
        "wells": wells,
    }
    write_json(output / "audit.json", summary)
    fields = [key for key in wells[0] if key != "curve_units"]
    with (output / "wells.csv").open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(wells)
    print(json.dumps({k: summary[k] for k in ("well_count", "parent_groups", "partitions", "totals", "sodir_unmatched")}, indent=2))
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--downloads", type=Path, required=True)
    parser.add_argument("--sodir", type=Path, required=True, help="SODIR exploration-wellbore CSV export")
    parser.add_argument("--output", type=Path, default=Path("data/force2020"))
    parser.add_argument("--split", type=Path, default=Path(__file__).with_name("split.json"))
    args = parser.parse_args()
    prepare(args.downloads, args.sodir, args.output, args.split)
