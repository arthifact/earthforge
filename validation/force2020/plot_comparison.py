#!/usr/bin/env python3
"""Publication-style, standalone plot of the development-only comparison."""
import argparse
import csv
import json
import os
from pathlib import Path
import sys


def plot(data, output, dependencies=None):
    if dependencies:
        # Keep the pinned analysis numpy first; only plotting packages come here.
        sys.path.append(str(dependencies.resolve()))
    os.environ.setdefault("MPLCONFIGDIR", str((data / "matplotlib-cache").resolve()))
    os.environ.setdefault("XDG_CACHE_HOME", str((data / "plot-cache").resolve()))
    import numpy as np
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    summary = json.loads((data / "comparison/comparison.json").read_text())
    profiles = json.loads((data / "model-profiles.json").read_text())["profiles"]["present_hydrostatic"]
    with (data / "comparison/primary-windows.csv").open() as handle:
        rows = list(csv.DictReader(handle))
    plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 12,
                         "axes.spines.top": False, "axes.spines.right": False,
                         "axes.edgecolor": "#a7aba8", "axes.labelcolor": "#303632",
                         "text.color": "#303632", "xtick.color": "#555e58", "ytick.color": "#555e58"})
    fig, axes = plt.subplots(1, 3, figsize=(15.5, 7.4), gridspec_kw={"width_ratios": [1, 1, 1.05]})
    fig.patch.set_facecolor("#fafaf7")
    fig.subplots_adjust(left=.065, right=.97, bottom=.21, top=.76, wspace=.30)
    fig.text(.065, .93, "First comparison with measured well velocities", fontsize=23, weight="bold")
    fig.text(.065, .88, "44 development wells · 442 intervals · 20 m vertical windows · 24 holdout wells reserved", fontsize=12.5)
    for ax, code, name, color in zip(axes[:2], (65000, 30000), ("Shale", "Sandstone"), ("#4d6651", "#286c8c")):
        subset = [r for r in rows if int(r["facies_code"]) == code]
        ax.set_facecolor("#fafaf7")
        ax.grid(True, color="#e4e7e1", linewidth=.8, zorder=0)
        ax.scatter([float(r["observed_m_s"]) / 1000 for r in subset],
                   [float(r["depth_m"]) / 1000 for r in subset], s=20,
                   color=color, alpha=.38, linewidths=0, zorder=2, label="Well-log intervals")
        ax.plot(np.array(profiles[str(code)]) / 1000, (np.arange(150) * 20 + 10) / 1000,
                color="#282d2a", linewidth=2.3, zorder=3, label="Unchanged model")
        upper = np.ceil(max(max(float(r["observed_m_s"]) for r in rows),
                            max(max(v) for v in profiles.values())) / 500) / 2
        ax.set(xlim=(1.45, upper + .08), ylim=(3, 0), xlabel="P-wave velocity (km/s)",
               xticks=np.arange(1.5, upper + .01, .5))
        ax.set_title(f"{name}\n{len(subset)} intervals · {len({r['well'] for r in subset})} wells",
                     loc="left", fontsize=13, pad=15)
        ax.legend(loc="upper right", frameon=False, fontsize=10.5)
    axes[0].set_ylabel("Depth below sea floor (km)")
    ax = axes[2]
    ax.set_facecolor("#fafaf7")
    ax.set_title("Mean absolute error\nEach parent well has equal weight", loc="left", fontsize=13, pad=15)
    scores = summary["primary_scores"]
    for y, field, label, color in ((1, "present_hydrostatic", "Earth Forge", "#4d6651"),
                                   (0, "baseline_loo", "Depth-only baseline", "#989f99")):
        score = scores[field]
        value = score["mae_m_s"] / 1000
        lo, hi = np.array(score["parent_bootstrap_95_percent"]["mae_m_s"]) / 1000
        ax.barh(y, value, height=.28, color=color, zorder=2)
        ax.errorbar(value, y, xerr=np.array([[value - lo], [hi - value]]), color="#28332b",
                    capsize=5, linewidth=1.5, zorder=3)
        ax.text(0, y + .3, label, fontsize=12)
        ax.text(hi + .02, y, f"{value:.2f}", va="center", fontsize=13, weight="bold")
    ax.set(xlim=(0, .55), ylim=(-1.9, 1.8), yticks=[], xlabel="Error (km/s)")
    ax.spines['left'].set_visible(False)
    ax.grid(axis="x", color="#e4e7e1", linewidth=.8, zorder=0)
    ax.text(0, -1.05, "Whiskers: 95% parent-well resampling intervals", fontsize=9.5)
    ax.text(0, -1.35, "The apparent advantage is uncertain.", fontsize=11, weight="bold")
    ax.text(0, -1.65, "Baseline predictions leave each parent well out.", fontsize=9.5)
    fig.text(.065, .105, "Conditional test: present depth = maximum burial; hydrostatic pressure; brine; model lithology endmembers.", fontsize=11)
    fig.text(.065, .065, "Quality-screened, nearly vertical wells. This tests the rock-physics component, not full basin history or fault geometry.", fontsize=11)
    output.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output.with_suffix(".png"), dpi=180, facecolor=fig.get_facecolor())
    fig.savefig(output.with_suffix(".svg"), facecolor=fig.get_facecolor())
    plt.close(fig)
    print(f"Wrote {output.with_suffix('.png')} and SVG")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=Path("data/force2020"))
    parser.add_argument("--output", type=Path, default=Path("docs/figures/force2020-development"))
    parser.add_argument("--plot-dependencies", type=Path)
    args = parser.parse_args()
    plot(args.data, args.output, args.plot_dependencies)
