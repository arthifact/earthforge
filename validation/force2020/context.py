#!/usr/bin/env python3
"""Attach lithostratigraphic and location context to the accepted comparison windows.

Reads the stored primary windows, the supplied NPD group/formation picks and the
SODIR snapshot. Adds, per window: the group and formation whose top is the deepest
one above the window midpoint, whether a pick top falls inside the window, the
quadrant and block from the well name, and the SODIR decimal coordinates. No
velocity, model error or holdout file is read; nothing is fitted here.
"""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

from prepare import read_books, read_sodir, number, sha256

HERE = Path(__file__).resolve().parent


def pick_depths(picks, water_depth):
    """(depth below sea floor, surface name) for each pick with a finite Z, ascending."""
    out = []
    for p in picks:
        z = number(p.get("Z"))
        if z is None:
            continue
        out.append((-z - water_depth, str(p.get("Surface", "")).strip()))
    return sorted(out)


def unit_at(tops, lo, hi):
    """Unit containing the midpoint of [lo, hi], and whether any top lies strictly inside."""
    mid = (lo + hi) / 2
    name, inside = None, False
    for depth, surface in tops:
        if depth <= mid:
            name = surface
        if lo < depth < hi:
            inside = True
    return name, inside


def clean_unit(name):
    if name is None:
        return ""
    for suffix in (" Top", " TOP"):
        if name.endswith(suffix):
            name = name[: -len(suffix)]
    return name.strip()


def well_parts(well):
    quadrant, rest = well.split("/", 1)
    block = rest.split("-", 1)[0]
    return quadrant, f"{quadrant}/{block}"


def attach(rows, tables, metadata):
    out = []
    for r in rows:
        well = r["well"]
        info = metadata.get(well)
        water = number(info.get("wlbWaterDepth")) if info else None
        if water is None:
            raise ValueError(f"No SODIR water depth for cohort well {well}")
        lo, hi = float(r["depth_m"]) - 10, float(r["depth_m"]) + 10
        group, group_inside = unit_at(pick_depths(tables["groups"].get(well, []), water), lo, hi)
        formation, formation_inside = unit_at(pick_depths(tables["formations"].get(well, []), water), lo, hi)
        quadrant, block = well_parts(well)
        out.append({**r, "group_unit": clean_unit(group), "group_top_in_window": group_inside,
                    "formation_unit": clean_unit(formation), "formation_top_in_window": formation_inside,
                    "quadrant": quadrant, "block": block,
                    "lat": number(info.get("wlbNsDecDeg")), "lon": number(info.get("wlbEwDecDeg"))})
    return out


def main(windows: Path, downloads: Path, data: Path, output: Path):
    tables, _ = read_books(downloads)
    metadata = read_sodir(data / "sodir-exploration.csv")
    with windows.open(newline="") as handle:
        rows = list(csv.DictReader(handle))
    attached = attach(rows, tables, metadata)
    fields = list(attached[0].keys())
    with output.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        writer.writerows(attached)
    counts = {}
    for a in attached:
        counts[a["group_unit"]] = counts.get(a["group_unit"], 0) + 1
    summary = {"windows": len(attached), "wells": len({a["well"] for a in attached}),
               "windows_by_group": dict(sorted(counts.items(), key=lambda kv: -kv[1])),
               "group_top_in_window": sum(a["group_top_in_window"] for a in attached),
               "quadrants": sorted({a["quadrant"] for a in attached}, key=int),
               "blocks": len({a["block"] for a in attached}),
               "windows_sha256": sha256(windows), "output_sha256": sha256(output)}
    print(json.dumps(summary, indent=2))
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--downloads", type=Path, required=True)
    parser.add_argument("--data", type=Path, default=Path("data/force2020"))
    parser.add_argument("--windows", type=Path, default=Path("data/force2020/comparison/primary-windows.csv"))
    parser.add_argument("--output", type=Path, default=Path("data/force2020/comparison/primary-windows-context.csv"))
    args = parser.parse_args()
    main(args.windows, args.downloads, args.data, args.output)
