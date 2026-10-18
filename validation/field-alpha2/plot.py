#!/usr/bin/env python3
"""Plot the saved field run; never opens raw well logs or fits a model."""
import argparse
import csv
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np


def main(folder, output):
    report = json.loads((folder/"report.json").read_text())
    with (folder/"predictions.csv").open() as handle:
        rows = list(csv.DictReader(handle))
    observed = np.array([float(r["observed_m_s"])/1000 for r in rows])
    predicted = np.array([float(r["rust_matched_support"])/1000 for r in rows])
    depth = np.array([float(r["depth_m"])/1000 for r in rows])
    facies = np.array([int(r["facies_code"]) for r in rows])
    plt.rcParams.update({"font.size": 9, "axes.spines.top": False, "axes.spines.right": False,
                         "axes.titleweight": "bold", "svg.fonttype": "none"})
    fig, axes = plt.subplots(2, 2, figsize=(12.8, 9.8))
    fig.subplots_adjust(left=.075, right=.98, top=.87, bottom=.20, wspace=.33, hspace=.45)
    fig.suptitle("Earth Forge alpha 2 · FORCE 2020 development diagnostic", x=.075, y=.97, ha="left", fontsize=17, weight="bold")
    fig.text(.075, .925, "442 screened 20 m intervals · 44 development wells · current Rust physics · 24 reserved wells unopened", fontsize=10)
    colours = {65000: ("Shale", "#496e87"), 30000: ("Sandstone", "#bb8335")}
    for code, (name, colour) in colours.items():
        use = facies == code
        axes[0, 0].scatter(observed[use], predicted[use], s=17, color=colour, alpha=.65, label=f"{name} · {use.sum()} intervals", edgecolors="none")
        axes[1, 0].scatter((predicted-observed)[use], depth[use], s=17, color=colour, alpha=.65, edgecolors="none")
    limits = [min(observed.min(), predicted.min())-.1, max(observed.max(), predicted.max())+.1]
    axes[0, 0].plot(limits, limits, color="#777777", lw=1, ls="--")
    axes[0, 0].set(xlabel="Observed velocity (km/s)", ylabel="Rust prediction (km/s)", xlim=limits, ylim=limits, title="A  Conditional velocity predictions")
    axes[0, 0].legend(frameon=False, loc="upper left", fontsize=8)
    axes[1, 0].axvline(0, color="#777777", lw=1, ls="--")
    axes[1, 0].set(xlabel="Predicted − observed velocity (km/s)", ylabel="Depth below sea floor (km)", title="C  Errors across observed depths", ylim=(3, 0))

    ax = axes[0, 1]
    for partition, offset, colour, label in [("parent", -.12, "#aa593e", "Exclude one parent well"), ("quadrant", .12, "#496e87", "Exclude one quadrant")]:
        for i, kind in enumerate(("depth", "facies-linear", "facies-quadratic")):
            score = report["scores"][f"{kind}_{partition}_cv"]
            value = score["mae_m_s"]
            bounds = score["parent_bootstrap_95_percent"]["mae_m_s"]
            ax.errorbar(value, i+offset, xerr=[[value-bounds[0]], [bounds[1]-value]], fmt="o", color=colour, capsize=3, ms=5, label=label if i == 0 else None)
    value = report["scores"]["rust_matched_support"]["mae_m_s"]
    ax.axvline(value, color="#47734d", ls="--", label=f"Rust · {value:.1f} m/s")
    ax.set(yticks=[0, 1, 2], yticklabels=["Depth only", "Facies + linear depth", "Facies + quadratic depth"], xlabel="Equal-parent MAE (m/s)", title="B  Empirical controls with excluded groups", ylim=(3.3, -.45))
    ax.legend(frameon=False, fontsize=8, loc="lower left")

    ax = axes[1, 1]
    quadrants = sorted(report["byQuadrant"], key=int)
    score = [report["byQuadrant"][q]["rust_matched_support"] for q in quadrants]
    bias = [s["bias_m_s"] for s in score]
    bars = ax.bar(range(len(score)), bias, color=["#aa593e" if b > 0 else "#496e87" for b in bias], width=.7)
    for bar, s in zip(bars, score):
        if s["wells"] == 1:
            bar.set_hatch("///"); bar.set_alpha(.5)
    ax.axhline(0, color="#777777", lw=1)
    ax.set(xticks=range(len(score)), xticklabels=[f"{q}\n(n={s['wells']})" for q, s in zip(quadrants, score)], ylabel="Equal-parent bias (m/s)", xlabel="North Sea quadrant · n = wells; hatching = one well", title="D  Regional offsets persist")
    for ax in axes.ravel():
        ax.grid(alpha=.15); ax.set_axisbelow(True)
    fig.text(.075, .035, "Points show individual windows; scores weight parent wells equally. Whiskers resample parents from fixed CV predictions;\nthey omit baseline-refitting and spatial-independence uncertainty. Observed facies and depth are supplied to the velocity law.\nThis does not validate generated 3D geology, actual burial/pressure histories, calibrated uncertainty or SOTA superiority.", fontsize=8, color="#555555", linespacing=1.5)
    output.parent.mkdir(parents=True, exist_ok=True)
    for suffix in (".svg", ".png"):
        path = output.with_suffix(suffix)
        if path.exists():
            raise FileExistsError(path)
        fig.savefig(path, dpi=170, facecolor="white")
    plt.close(fig)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    main(args.folder, args.out)
