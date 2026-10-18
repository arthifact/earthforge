"""Fixed-support integration and out-of-group empirical controls.

This module contains statistics and integration coordinates, not rock physics.
All physical velocity predictions come from the current native Rust engine.
"""
from __future__ import annotations

from collections import Counter, defaultdict
import math

import numpy as np


def quadrature(segments, max_step=1.0):
    """Midpoint integration on each observed segment; never bridge a gap."""
    if not math.isfinite(max_step) or max_step <= 0:
        raise ValueError("Positive finite integration spacing required")
    positions, weights = [], []
    previous = -math.inf
    for start, end in segments:
        if not all(math.isfinite(v) for v in (start, end)) or end <= start or start < previous:
            raise ValueError("Support segments must be finite, ordered and disjoint")
        count = max(1, math.ceil((end-start)/max_step))
        width = (end-start)/count
        positions.extend(start+(i+.5)*width for i in range(count))
        weights.extend([width]*count)
        previous = end
    if not positions:
        raise ValueError("Empty observed support")
    return positions, weights


def harmonic(velocities, weights):
    if len(velocities) != len(weights) or not velocities:
        raise ValueError("Nonempty matching velocity and support arrays required")
    if any(not math.isfinite(v) or v <= 0 for v in [*velocities, *weights]):
        raise ValueError("Velocity and support weights must be positive and finite")
    return math.fsum(weights)/math.fsum(w/v for w, v in zip(weights, velocities))


def quadrant(row):
    return row["well"].split("/", 1)[0]


def baseline_cv(rows, kind, partition):
    """Equal-parent WLS. Excluded parent/region never contributes to its fit."""
    if kind not in ("depth", "facies-linear", "facies-quadratic"):
        raise ValueError("Unknown empirical baseline")
    if partition not in ("parent", "quadrant"):
        raise ValueError("Unknown cross-validation partition")
    groups = np.array([r["group"] for r in rows])
    folds = groups if partition == "parent" else np.array([quadrant(r) for r in rows])
    depth = np.array([r["depth_m"]/1000 for r in rows])
    facies = np.array([r["facies_code"] for r in rows])
    observed = np.array([r["observed_m_s"] for r in rows])
    prediction = np.full(len(rows), np.nan)
    fits = []
    for held in sorted(set(folds)):
        train = folds != held
        if len(set(groups[train])) < 2:
            raise ValueError("A baseline fold needs at least two training parents")
        counts = Counter(groups[train])
        weight = np.array([1/counts[g] if t else 0 for g, t in zip(groups, train)])

        def fit(mask, degree):
            design = np.column_stack([depth**d for d in range(degree+1)])
            x = design[mask]*np.sqrt(weight[mask, None])
            y = observed[mask]*np.sqrt(weight[mask])
            if np.linalg.matrix_rank(x) != degree+1:
                raise ValueError(f"Singular {kind} training design in excluded fold {held}")
            coefficients = np.linalg.lstsq(x, y, rcond=None)[0]
            return design@coefficients, coefficients.tolist()

        fallback, depth_coef = fit(train, 1)
        held_mask = ~train
        prediction[held_mask] = fallback[held_mask]
        details = {"held": str(held), "trainingParents": len(counts),
                   "trainingRows": int(train.sum()), "depthCoefficients": depth_coef,
                   "faciesFits": {}}
        if kind != "depth":
            for code in sorted(set(facies[held_mask])):
                mask = train & (facies == code)
                key = str(int(code))
                if not mask.any():
                    details["faciesFits"][key] = {"fallback": "depth-only; facies absent from training"}
                    continue
                values, coefficients = fit(mask, 2 if kind == "facies-quadratic" else 1)
                use = held_mask & (facies == code)
                prediction[use] = values[use]
                details["faciesFits"][key] = {"coefficients": coefficients}
        fits.append(details)
    if not np.isfinite(prediction).all():
        raise ValueError("A missing empirical prediction must not disappear")
    return prediction.tolist(), fits


def paired_difference(rows, left, right, bootstrap):
    errors = defaultdict(list)
    for row in rows:
        observed = row["observed_m_s"]
        errors[row["group"]].append(abs(row[left]-observed)-abs(row[right]-observed))
    means = np.array([np.mean(e) for _, e in sorted(errors.items())])
    if not len(means) or not np.isfinite(means).all():
        raise ValueError("A paired comparison needs finite predictions")
    rng = np.random.default_rng(bootstrap["seed"])
    samples = means[rng.integers(0, len(means), (bootstrap["repeats"], len(means)))].mean(axis=1)
    return {"left": left, "right": right, "maeDifferenceMps": float(means.mean()),
            "parentBootstrap95PercentMps": np.percentile(samples, [2.5, 97.5]).tolist(),
            "negativeMeans": "left has lower MAE; fixed predictions, without refitting uncertainty"}
