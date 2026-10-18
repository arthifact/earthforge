"""Finite-candidate importance weighting under an explicit observation model.

This is not an inverse solver or calibrated posterior coverage. The caller
supplies uncertainties (including model discrepancy) and assumes independence.
"""
from __future__ import annotations

import math
from typing import TYPE_CHECKING

import numpy as np

from ._util import finite_number, integer
from .model import History

if TYPE_CHECKING:
    from .engine import Engine


def validate_observations(observations: list[dict]) -> list[dict]:
    if not isinstance(observations, list) or not 1 <= len(observations) <= 1024:
        raise ValueError("Supply 1..1024 observations")
    out = []
    ids = set()
    for i, source in enumerate(observations):
        if not isinstance(source, dict):
            raise ValueError("An observation must be an object")
        row = dict(source)
        kind = row.get("kind")
        allowed = {"kind", "id", "x", "y", "value", "sigma"}
        if kind == "velocity":
            allowed.add("z")
        elif kind == "horizon":
            allowed |= {"bed", "unit", "side", "occurrence"}
        elif kind not in ("surface", "basement"):
            raise ValueError(f"Unknown observation kind {kind!r}")
        if set(row) - allowed:
            raise ValueError(f"Unknown observation fields: {sorted(set(row)-allowed)}")
        for a in ("x", "y"):
            finite_number(row.get(a), a, -1e12, 1e12)
        finite_number(row.get("sigma"), "sigma", 1e-9, 1e9)
        finite_number(row.get("value"), "value", 1e-9 if kind == "velocity" else -1e12, 1e12)
        if kind == "velocity":
            finite_number(row.get("z"), "z", -1e12, 1e12)
        if kind == "horizon":
            if ("bed" in row) == ("unit" in row):
                raise ValueError("A horizon needs exactly one bed or depositional unit")
            selector = "bed" if "bed" in row else "unit"
            integer(row[selector], selector, 0, 255)
            if row.get("side") not in ("top", "bottom"):
                raise ValueError("A horizon needs side='top' or 'bottom'")
            if row.get("occurrence") is not None:
                integer(row["occurrence"], "occurrence", 0, 4095)
        row["id"] = row.get("id", str(i))
        if not isinstance(row["id"], str) or not row["id"] or row["id"] in ids:
            raise ValueError("Observation ids must be unique nonempty strings")
        ids.add(row["id"])
        out.append(row)
    return out


def gaussian_log_likelihood(value: float, prediction: float, sigma: float) -> float:
    return -.5*((value-prediction)/sigma)**2 - math.log(sigma) - .5*math.log(2*math.pi)


def log_mean_exp(values: list[float]) -> float:
    if not values:
        return -math.inf
    m = max(values)
    if m == -math.inf:
        return m
    return m + math.log(sum(math.exp(v-m) for v in values)) - math.log(len(values))


def score_history(engine: Engine, history: History, observations: list[dict]) -> dict:
    rows = validate_observations(observations)
    model = history.model
    query: dict = {"sectionsY": [], "points": [], "rays": [], "horizons": []}
    if history.stage is not None:
        query["stage"] = history.stage
    indices = []
    unavailable = set()
    for row in rows:
        for a in ("x", "y", "z"):
            if a in row and not model["bounds"]["min"][a] <= row[a] <= model["bounds"]["max"][a]:
                raise ValueError(f"Observation {row['id']} is outside the model coordinate bounds")
        kind = row["kind"]
        target = "points" if kind == "velocity" else "horizons" if kind == "horizon" else "rays"
        indices.append((target, len(query[target])))
        if target == "points":
            query[target].append({a: row[a] for a in "xyz"})
        elif target == "horizons":
            selector = "bed" if "bed" in row else "unit"
            known = row[selector] < len(model["beds"]) if selector == "bed" else any(b["unit"] == row[selector] for b in model["beds"])
            if not known:
                unavailable.add(row["id"])
                query[target].append({"x": row["x"], "y": row["y"], "bed": 0})
            else:
                query[target].append({a: row[a] for a in ("x", "y", selector)})
        else:
            query[target].append([row["x"], row["y"]])
    if not model["beds"] and query["horizons"]:
        return {"status": "incompatible", "logLikelihood": None, "reason": "No sediment beds for a horizon observation", "predictions": []}
    result = engine.request({"kind": "history3d", "model": model, "query": query})
    predictions = []
    total = 0.0
    for row, (target, i) in zip(rows, indices):
        sample = result[target][i]
        if target == "horizons":
            depths = [] if row["id"] in unavailable else [c[0 if row["side"] == "top" else 1] for c in sample["contacts"]]
            occurrence = row.get("occurrence")
            if occurrence is not None:
                depths = depths[occurrence:occurrence+1]
            likelihood = log_mean_exp([gaussian_log_likelihood(row["value"], d, row["sigma"]) for d in depths])
            prediction = depths
            interpretation = "Equal-weight mixture across all occurrences" if occurrence is None else f"Occurrence {occurrence}, shallowest first"
        else:
            prediction = sample["velocity" if target == "points" else row["kind"]]
            likelihood = gaussian_log_likelihood(row["value"], prediction, row["sigma"])
            interpretation = "Independent Gaussian; sigma supplied by caller"
        total += likelihood
        predictions.append({"id": row["id"], "kind": row["kind"], "prediction": prediction, "value": row["value"], "sigma": row["sigma"], "logLikelihood": likelihood if math.isfinite(likelihood) else None, "interpretation": interpretation})
    return {"status": "compatible" if math.isfinite(total) else "incompatible", "logLikelihood": total if math.isfinite(total) else None, "predictions": predictions, "assumptions": "Independent Gaussian observation/model-discrepancy errors. Horizons use the explicit occurrence or a normalized equal-weight mixture. Missing horizons have zero likelihood. No field-calibrated coverage claim."}


def normalize_weights(scores: list[dict], prior_weights: list[float] | None = None) -> dict:
    if not scores:
        raise ValueError("No candidates supplied")
    prior = np.asarray(prior_weights if prior_weights is not None else np.ones(len(scores)), dtype=float)
    if prior.shape != (len(scores),) or np.any(~np.isfinite(prior)) or np.any(prior < 0) or not np.any(prior > 0):
        raise ValueError("Prior weights must be finite, nonnegative and nonzero")
    prior /= prior.max()
    prior /= prior.sum()
    logs = np.array([float(s["logLikelihood"]) if s.get("logLikelihood") is not None else -np.inf for s in scores])
    if np.any(np.isnan(logs)) or np.any(np.isposinf(logs)):
        raise ValueError("Invalid candidate log likelihood")
    combined = np.full_like(logs, -np.inf)
    active = prior > 0
    combined[active] = logs[active] + np.log(prior[active])
    if not np.any(np.isfinite(combined)):
        return {"status": "no-compatible-candidates", "weights": [0.0]*len(scores), "effectiveSampleSize": 0.0, "positiveWeightCandidates": 0}
    weights = np.exp(combined - np.max(combined)); weights /= weights.sum()
    ess = 1.0/float(np.sum(weights**2))
    return {"status": "weighted", "weights": weights.tolist(), "effectiveSampleSize": ess, "positiveWeightCandidates": int(np.count_nonzero(weights)), "interpretation": "Weights over this finite candidate library and stated prior/likelihood only. A small ESS calls for more candidates; it is not evidence of narrow geological uncertainty or calibrated credible intervals."}


def weighted_quantile(values: list[float], weights: list[float], probabilities=(.05, .5, .95)) -> list[float]:
    v = np.asarray(values, dtype=float); w = np.asarray(weights, dtype=float); p = np.asarray(probabilities, dtype=float)
    if v.ndim != 1 or w.shape != v.shape or not len(v) or np.any(~np.isfinite(v)) or np.any(~np.isfinite(w)) or np.any(w < 0) or not w.sum() > 0 or np.any(~np.isfinite(p)) or np.any(p < 0) or np.any(p > 1):
        raise ValueError("Invalid weighted-quantile inputs")
    active = w > 0; v = v[active]; w = w[active]
    order = np.argsort(v, kind="stable"); v = v[order]; c = np.cumsum(w[order]/w.sum()); c[-1] = 1.0
    return v[np.minimum(np.searchsorted(c, p, side="left"), len(v)-1)].tolist()
