"""Run the predeclared supported-scenario cohort without tuning physical laws."""
import json
import os
import subprocess
import time
from pathlib import Path

import numpy as np

from earthforge import Engine, Grid, condition_histories
from earthforge._util import array_sha, digest, file_sha

ROOT = Path(__file__).resolve().parents[2]
PLAN_PATH = Path(__file__).with_name("cohort-plan.json")
plan = json.loads(PLAN_PATH.read_text())
engine = Engine(ROOT/"target/release/earthforge")
before = Path(os.environ.get("EARTHFORGE_FROZEN_NATIVE", ROOT.parent/"research-release-engines/before-native"))
report = {"schema": "earthforge-research-cohort-results-v1", "planSha256": file_sha(PLAN_PATH), "engineSha256": engine.sha256, "beforeNativeSha256": file_sha(before), "cases": [], "materialRefinement": [], "syntheticConditioning": [], "scope": "Synthetic supported-scenario verification. No field holdout, competitor timing or downstream FWI benefit claim."}

for scenario in plan["scenarios"]:
    histories = [engine.build_history(scenario, seed=seed) for seed in plan["seeds"]]
    for history in histories:
        for name, specification in plan["grids"].items():
            grid = Grid.from_dict(specification)
            v = engine.sample(history, grid)
            checks = [t["stats"]["evaluation"] for t in v.metadata["tiles"]]
            assert all(t["maxNormalizedGrainResidual"] <= 1 for t in checks)
            raw = subprocess.run([str(before)], input=json.dumps({"kind": "history3d", "model": history.model, "query": {"sectionsY": [], "grid": grid.to_dict(), "includeMaterial": True}}).encode(), capture_output=True, check=True)
            old = json.loads(raw.stdout); assert old["ok"], old
            p = old["value"]["projection"]
            for field in ("velocity", "beds", "lithology", "surface", "basement"):
                expected = np.asarray(p[field], dtype=v.fields[field].dtype).reshape(v.fields[field].shape)
                np.testing.assert_array_equal(expected, v.fields[field])
            row = {"scenario": scenario, "seed": history.seed, "grid": name, "nodes": grid.nodes, "modelSha256": history.model_sha256, "contentSha256": v.content_digest(), "frozenPhysicalFieldsExact": True, "grainChecks": sum(t["localEventsChecked"] for t in checks), "velocityMinMax": [float(np.min(v.fields["velocity"])), float(np.max(v.fields["velocity"]))], "sedimentFractionOfSampleNodes": float(np.mean(v.fields["valid_material"])), "sampleSecondsDiagnostic": v.metadata["elapsedSeconds"]}
            report["cases"].append(row); print(json.dumps({k: row[k] for k in ("scenario", "seed", "grid", "nodes")}), flush=True)
    ref = plan["materialRefinement"]; g = Grid.from_dict(ref["grid"])
    volumes = [engine.generate(scenario, seed=ref["seed"], steps=ref["steps"], faults=ref["faults"], material_step=step, grid=g) for step in ref["levelsMetres"]]
    differences = []
    for coarse, fine, h1, h2 in zip(volumes, volumes[1:], ref["levelsMetres"], ref["levelsMetres"][1:]):
        delta = coarse.fields["velocity"]-fine.fields["velocity"]
        same = (coarse.fields["beds"] == fine.fields["beds"]) & (coarse.fields["beds"] >= 0)
        twt = lambda a: 2*np.trapezoid(1/a.fields["velocity"], x=g.coordinates()["z"], axis=0)
        d = {"fromMetres": h1, "toMetres": h2, "allVelocityRmsMetresPerSecond": float(np.sqrt(np.mean(delta**2))), "commonSedimentVelocityRmsMetresPerSecond": float(np.sqrt(np.mean(delta[same]**2))) if np.any(same) else None, "commonSedimentNodes": int(np.count_nonzero(same)), "bedDisagreementFraction": float(np.mean(coarse.fields["beds"] != fine.fields["beds"])), "twoWayVerticalSlownessIntegralRmsMilliseconds": float(1000*np.sqrt(np.mean((twt(coarse)-twt(fine))**2))), "basementRmsMetres": float(np.sqrt(np.mean((coarse.fields["basement"]-fine.fields["basement"])**2)))}
        differences.append(d)
    report["materialRefinement"].append({"scenario": scenario, "differences": differences, "interpretation": "Fixed common nodal samples; material subdivision varies. Boundary shifts affect all-node RMS. Vertical slowness integrals are quadrature diagnostics, not simulated first arrivals. Every trend retained; no convergence assertion."})
    c = plan["syntheticConditioning"]
    truth = histories[plan["seeds"].index(c["truthSeed"])]
    values = engine.points(truth, c["trainingVelocityPositions"])
    observations = [dict(kind="velocity", id=f"synthetic-{i}", x=p[0], y=p[1], z=p[2], value=v["velocity"], sigma=c["sigmaMetresPerSecond"]) for i, (p, v) in enumerate(zip(c["trainingVelocityPositions"], values))]
    weighted = condition_histories(engine, histories, observations)
    truth_index = plan["seeds"].index(c["truthSeed"])
    assert weighted["weights"][truth_index] >= max(weighted["weights"])-1e-14
    predictions = np.array([[r["velocity"] for r in engine.points(h, c["heldoutVelocityPositions"])] for h in histories])
    y = predictions[truth_index]
    before_rms = float(np.sqrt(np.mean((predictions.mean(axis=0)-y)**2)))
    after_rms = float(np.sqrt(np.mean((np.asarray(weighted["weights"])@predictions-y)**2)))
    report["syntheticConditioning"].append({"scenario": scenario, "observations": observations, "weights": weighted["weights"], "effectiveSampleSize": weighted["effectiveSampleSize"], "heldoutLocationPriorMeanRmsMetresPerSecond": before_rms, "heldoutLocationWeightedMeanRmsMetresPerSecond": after_rms, "interpretation": "Closed finite-library sanity check; the truth is one of six candidates. Different spatial locations are held out, not geology or field data. Not calibrated coverage or independent inversion validation."})
    Path(__file__).with_name("cohort-results.json").write_text(json.dumps(report, indent=2, allow_nan=False)+"\n")
print("Cohort complete; all declared equality and local-budget gates pass.", flush=True)
