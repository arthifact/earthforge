"""Fit observed contact geometry; all resulting histories are evaluated by Rust.

This reconstructs surfaces, not forces, faults, deposition ages or burial history.
Coordinates must already share one Cartesian metre frame and depth reference.
"""
from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Sequence

import numpy as np

from .model import History


@dataclass(frozen=True)
class Contact:
    well: str
    parent: str
    horizon: str
    x: float
    y: float
    depth: float

    def __post_init__(self):
        if not all(isinstance(v, str) and v.strip() for v in (self.well, self.parent, self.horizon)):
            raise ValueError("Contact identities must be nonempty strings")
        if not all(math.isfinite(v) for v in (self.x, self.y, self.depth)) or self.depth < 0:
            raise ValueError("Contact coordinates/depth must be finite, depth positive down")


def _weights(rows: Sequence[Contact]) -> np.ndarray:
    counts = {p: sum(r.parent == p for r in rows) for p in {r.parent for r in rows}}
    return np.array([1 / counts[r.parent] for r in rows])


def fit_field(rows: Sequence[Contact], method: str = "plane", smoothing: float = 1.) -> tuple[dict, dict]:
    """Parent-balanced geometry regression; no physical law is implemented here."""
    if not rows or method not in {"constant", "plane", "smooth"}:
        raise ValueError("Supply contacts and choose constant, plane or smooth")
    if not math.isfinite(smoothing) or smoothing <= 0:
        raise ValueError("Smoothing must be finite and positive")
    xy = np.array([[r.x, r.y] for r in rows], dtype=float)
    z = np.array([r.depth for r in rows])
    w = _weights(rows)
    centre = np.average(xy, axis=0, weights=w)
    scale = np.maximum(np.ptp(xy, axis=0), 1.)
    u = (xy - centre) / scale
    design = np.column_stack([np.ones(len(rows)), u])
    weighted = design * np.sqrt(w[:, None])
    fallback = method != "constant" and np.linalg.matrix_rank(weighted) != 3
    wave_specs = []
    if method == "constant" or fallback:
        theta = np.array([np.average(z, weights=w), 0., 0.])
    elif method == "plane":
        theta = np.linalg.lstsq(weighted, z * np.sqrt(w), rcond=None)[0]
    else:
        terms = []
        for axis in range(2):
            for frequency in (math.pi, 2*math.pi):
                for phase in (0., math.pi/2):
                    terms.append(np.sin(frequency*u[:,axis]+phase))
                    k=np.zeros(2);k[axis]=frequency/scale[axis]
                    wave_specs.append({'kx':float(k[0]),'ky':float(k[1]),'phase':float(phase-k@centre)})
        design=np.column_stack([design,*terms]); normal=np.sqrt(w/w.sum())
        penalty=np.zeros((8,11));penalty[:,3:]=np.eye(8)*math.sqrt(smoothing)
        theta=np.linalg.lstsq(np.vstack([design*normal[:,None],penalty]),np.concatenate([z*normal,np.zeros(8)]),rcond=None)[0]
    slopes = theta[1:3] / scale
    field = {"value": float(theta[0] - slopes @ centre), "slopeX": float(slopes[0]), "slopeY": float(slopes[1])}
    if wave_specs: field['waves']=[dict(spec,amplitude=float(a)) for a,spec in zip(theta[3:],wave_specs)]
    return field, {"method": method, "smoothing": smoothing if method=='smooth' else None, "rankDeficientPlaneFallback": bool(fallback), "parents": sorted({r.parent for r in rows}), "centre": centre.tolist(), "scale": scale.tolist()}


def fit_horizon_stack(contacts: Sequence[Contact], horizons: Sequence[str], bounds: dict,
                      *, method: str = "plane", smoothing: float = 1.) -> tuple[History, dict]:
    """Reconstruct an ordered stack with existing fill-to deposition operators.

    Missing/inverted fitted layers are not corrected using validation targets.
    Rust may return no contact at a queried location; callers must retain that.
    Compaction is disabled because the inputs already describe present geometry.
    """
    if not horizons or len(set(horizons)) != len(horizons):
        raise ValueError("Horizon names must be nonempty and unique")
    if any(r.horizon not in horizons for r in contacts):
        raise ValueError("Contact horizon not in ordered mapping")
    if not contacts:
        raise ValueError("Need training contacts")
    keys = [(r.well, r.horizon) for r in contacts]
    if len(keys) != len(set(keys)):
        raise ValueError("Ambiguous duplicate contact")
    for r in contacts:
        if not (bounds['min']['x'] <= r.x <= bounds['max']['x'] and bounds['min']['y'] <= r.y <= bounds['max']['y'] and bounds['min']['z'] <= r.depth < bounds['max']['z']):
            raise ValueError("Training contact outside reconstruction bounds")
    fields, audits = [], []
    for name in horizons:
        f, a = fit_field([r for r in contacts if r.horizon == name], method, smoothing)
        fields.append(f); audits.append(a)
    beds = [{"unit": i, "phase": "observed-horizon-reconstruction", "a": .4, "b": 0., "c": 0., "d": 100., "carbonate": False} for i in range(len(horizons))]
    model = {"bounds": bounds, "initialSurface": {"value": bounds['max']['z']}, "beds": beds,
             "events": [{"kind": "deposit", "bed": i, "fillTo": fields[i], "compact": False} for i in reversed(range(len(horizons)))], "materialStep": 100.}
    audit = {"method": method, "smoothing": smoothing if method=='smooth' else None, "horizonsShallowToDeep": list(horizons), "fields": fields, "fits": audits,
             "trainingWells": sorted({r.well for r in contacts}), "trainingParents": sorted({r.parent for r in contacts}),
             "scope": "Geometric reconstruction only; no inferred faults, mechanics, ages or burial history. Compaction disabled."}
    return History(model, scenario="field-horizon-reconstruction-v1", parameters=audit), audit


def predict_contacts(engine, history: History, queries: Sequence[Contact], horizons: Sequence[str]) -> list[dict]:
    if not queries:
        return []
    model=history.model
    raw = engine.request({"kind": "history3d", "model": model,
                          "query": {"sectionsY": [], "horizons": [{"x": r.x, "y": r.y, "unit": horizons.index(r.horizon)} for r in queries]}})
    result = []
    for row in raw['horizons']:
        contacts = row['contacts']
        valid = len(contacts) == 1 and math.isfinite(contacts[0][0]) and model['bounds']['min']['z'] <= contacts[0][0] < model['bounds']['max']['z']
        result.append({"prediction": contacts[0][0] if valid else None,
                       "status": "predicted" if valid else "missing-or-repeated-or-out-of-domain",
                       "occurrences": len(contacts)})
    if len(result) != len(queries):
        raise ValueError("Rust returned a different number of contacts")
    return result


DEFAULT_HORIZON_CANDIDATES = ({'method':'constant'}, {'method':'plane'},
    *({'method':'smooth','smoothing':v} for v in (100.,10.,1.,.1,.01)))


def select_horizon_stack(engine, contacts: Sequence[Contact], horizons: Sequence[str], bounds: dict,
                         *, groups: dict[str,str] | None = None, score_horizons: Sequence[str] | None = None,
                         candidates: Sequence[dict] = DEFAULT_HORIZON_CANDIDATES,
                         min_training_parents: int = 4, missing_penalty_m: float = 10000.) -> tuple[History,dict]:
    """Training-only grouped validation selects one stack's surface complexity.

    Pass only outer-training contacts. `groups` maps each parent to a geographic
    group for block validation; default groups hold out entire parent wells.
    Selection scores actual Rust contacts, including pinchouts and failures.
    """
    from .engine import EngineError
    parents={r.parent for r in contacts}
    mapping={p:p for p in parents} if groups is None else groups
    if set(mapping) != parents or not candidates or not math.isfinite(missing_penalty_m) or missing_penalty_m <= 0:
        raise ValueError('Supply exact parent group coverage, candidates and a positive missing penalty')
    selected_names=set(horizons if score_horizons is None else score_horizons)
    if not selected_names or not selected_names <= set(horizons):raise ValueError('Unknown scored horizons')
    fold_records=[]; losses=[[] for _ in candidates]
    for group in sorted(set(mapping.values())):
        train=[r for r in contacts if mapping[r.parent]!=group]
        test=[r for r in contacts if mapping[r.parent]==group and r.horizon in selected_names]
        eligible=len({r.parent for r in train})>=min_training_parents
        fold={'heldGroup':group,'trainingParents':sorted({r.parent for r in train}),'testParents':sorted({r.parent for r in test}),'eligible':eligible,'candidates':[]}
        if eligible and test:
            for i,option in enumerate(candidates):
                h,fit=fit_horizon_stack(train,horizons,bounds,**option)
                error=None
                try: predictions=predict_contacts(engine,h,test,horizons)
                except EngineError as e:
                    error=str(e);predictions=[{'prediction':None} for r in test]
                candidate_rows=[]
                for r,p in zip(test,predictions):
                    loss=missing_penalty_m if p['prediction'] is None else abs(p['prediction']-r.depth)
                    losses[i].append((r.parent,loss));candidate_rows.append({'well':r.well,'horizon':r.horizon,'prediction':p['prediction'],'absoluteErrorOrPenalty':loss})
                fold['candidates'].append({'option':dict(option),'modelSha256':h.model_sha256,'fields':fit['fields'],'predictions':candidate_rows,'engineError':error})
        fold_records.append(fold)
    scores=[]
    for option,values in zip(candidates,losses):
        by_parent={p:[v for key,v in values if key==p] for p in {key for key,v in values}}
        scores.append({'option':dict(option),'parentsScored':len(by_parent),'targetsScored':len(values),'penalizedMaeM':float(np.mean([np.mean(v) for v in by_parent.values()])) if by_parent else None})
    best=None
    for i,s in enumerate(scores):
        if s['penalizedMaeM'] is not None and (best is None or s['penalizedMaeM'] < scores[best]['penalizedMaeM']-1e-8):best=i
    option={'method':'plane'} if best is None else dict(candidates[best])
    history,audit=fit_horizon_stack(contacts,horizons,bounds,**option)
    audit['selection']={'selected':option,'noEligibleInnerFoldsFallback':best is None,'candidateScores':scores,'folds':fold_records,'scope':'Grouped validation within supplied training contacts only. Uncertainty is not calibrated.'}
    return history,audit


def inside_hull(point, xy) -> bool:
    """Closed convex hull in XY; no vertical targets are used."""
    points = sorted(set(map(tuple, np.asarray(xy, dtype=float))))
    if len(points) < 3:
        return False
    cross = lambda a, b, c: (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
    lower, upper = [], []
    for p in points:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0: lower.pop()
        lower.append(p)
    for p in reversed(points):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0: upper.pop()
        upper.append(p)
    hull = lower[:-1] + upper[:-1]
    if len(hull) < 3:
        return False
    tolerance = 1e-10 * max(1., float(np.ptp(np.asarray(points), axis=0).max()))**2
    return all(cross(a, b, point) >= -tolerance for a, b in zip(hull, hull[1:]+hull[:1]))
