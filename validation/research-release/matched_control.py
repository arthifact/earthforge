"""Scoped executable control against the unmodified published SubsurfaceGen source."""
import hashlib
import json
import math
import os
import platform
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PLAN_PATH = Path(os.environ.get("EARTHFORGE_CONTROL_PLAN", Path(__file__).with_name("matched-control-plan.json")))
plan = json.loads(PLAN_PATH.read_text())
REFERENCE_ROOT = Path(os.environ.get("EARTHFORGE_SUBSURFACEGEN_SOURCE", ROOT.parent/"subsurfacegen-reference"))
sys.path.insert(0, str(REFERENCE_ROOT))

if len(sys.argv) == 4 and sys.argv[1] == "--child":
    which = sys.argv[2]; grid = plan["grids"][int(sys.argv[3])]
    setup_start = time.perf_counter()
    import numpy as np
    from earthforge import Engine
    from earthforge._util import array_sha
    engine = Engine(ROOT/"target/release/earthforge", threads=plan["threads"]) if which == "earthforge" else None
    if which == "subsurfacegen":
        import torch
        from subsurfacegen.model_builder import Axis, Hypercube, GeoModel
        from subsurfacegen.model_builder.deposit import Deposit, DepositConfig
        torch.set_default_dtype(torch.float64); torch.set_num_threads(plan["threads"])
    setup_seconds = time.perf_counter()-setup_start
    height = plan["layerThicknessMetres"]
    solids = [height*(1-phi) for phi in plan["carbonateBulkPorosityTopToBottom"]]
    vm = math.sqrt((70.8e9+4/3*30.3e9)/2710)
    vf = math.sqrt(2.4e9/1030)
    velocities = []
    for solid in solids:
        phi = 1-solid/height; factor = 1-phi
        velocities.append(factor*factor*vm+phi*vf)
    expected = np.full((grid["nz"], grid["ny"], grid["nx"]), plan["basementVelocityMetresPerSecond"], dtype="<f8")
    thickness = int(height/grid["dz"])
    for i, velocity in enumerate(velocities):
        expected[i*thickness:(i+1)*thickness] = velocity
    beds = [dict(unit=i, phase="analytic control", a=.5, b=0, c=0, d=100, carbonate=True) for i in range(4)]
    model = {"bounds": {"min": dict(x=0,y=0,z=0), "max": dict(x=10000,y=10000,z=6200)}, "initialSurface": {"value":0}, "initialLayers": [dict(bed=i,height=height,solid=solid,fraction=.5,burial=1000,loading=800) for i,solid in enumerate(solids)], "beds": beds, "events": [], "materialStep":10}
    trials = []
    for trial in range(-1, plan["trials"]):
        start = time.perf_counter()
        if which == "earthforge":
            raw = engine.request({"kind":"history3d","model":model,"query":{"sectionsY":[],"grid":grid}})
            values = np.asarray(raw["projection"]["velocity"], dtype="<f8").reshape(expected.shape)
        else:
            initial_nz = grid["nz"]-4*thickness
            axes = [Axis(initial_nz,grid["dz"],0,"z","m"),Axis(grid["ny"],grid["dy"],0,"y","m"),Axis(grid["nx"],grid["dx"],0,"x","m")]
            m = GeoModel(Hypercube(axes),{"vp":plan["basementVelocityMetresPerSecond"]},"vp",device="cpu",dtype=torch.float64)
            for velocity in reversed(velocities):
                m = Deposit(DepositConfig(thickness=thickness, property_value=velocity,depth_gradient=0,expansion_mode=False,interbed_thickness_mean=1000,interbed_thickness_std=0,interbed_property_std=0,interbed_noise_amplitude=0,noise_amplitude=0,surface_taper_frac=plan.get("surfaceTaperFraction",.15),base_taper_frac=plan.get("baseTaperFraction",0),interbed_noise_octaves=1,noise_octaves=1,seed=1001)).apply(m)
            values = m.get_primary_field().detach().cpu().numpy().copy()
        seconds = time.perf_counter()-start
        assert values.shape == expected.shape and values.dtype == np.dtype("<f8")
        error = float(np.max(np.abs(values-expected)))
        if error > plan["numericGate"]["maxAbsoluteErrorMetresPerSecond"]:
            raise AssertionError(f"Independent reference mismatch: {error}")
        trials.append({"warmup":trial < 0,"seconds":seconds,"maxAbsoluteReferenceErrorMetresPerSecond":error,"fieldSha256":array_sha(values)})
    measured = sorted(t["seconds"] for t in trials if not t["warmup"])
    print(json.dumps({"engine":which,"grid":grid,"setupSeconds":setup_seconds,"medianSeconds":measured[len(measured)//2],"trials":trials,"numpy":np.__version__,"torch":torch.__version__ if which == "subsurfacegen" else None,"nativeSha256":engine.sha256 if engine else None}))
else:
    rows = []
    for i in range(len(plan["grids"])):
        for which in ("earthforge","subsurfacegen"):
            p = subprocess.run([sys.executable,__file__,"--child",which,str(i)],capture_output=True,text=True,check=True)
            row = json.loads(p.stdout.strip().splitlines()[-1]); rows.append(row)
            if p.stderr:
                Path(__file__).with_name(f"matched-control-{which}-{i}.stderr.log").write_text(p.stderr)
            print(json.dumps({"engine":which,"gridIndex":i,"medianSeconds":row["medianSeconds"]}),flush=True)
    source = REFERENCE_ROOT
    hashes = {str(p.relative_to(source)):hashlib.sha256(p.read_bytes()).hexdigest() for p in source.rglob("*.py")}
    result = {"schema":"earthforge-subsurfacegen-control-results-v1","planSha256":hashlib.sha256(PLAN_PATH.read_bytes()).hexdigest(),"python":platform.python_version(),"platform":platform.platform(),"threads":plan["threads"],"sourceArchive":json.loads(Path(__file__).with_name("subsurfacegen-source.json").read_text()),"subsurfacegenPythonSourceHashes":hashes,"rows":rows,"scopeDifferences":plan["scopeDifferences"],"interpretation":"Both tools executed on the same CPU with a common f64 reference field and predeclared numerical gate. Scoped construction timings only; methods and internal bookkeeping differ. No SOTA, realistic-basin speedup or field-accuracy claim."}
    Path(__file__).with_name("matched-control-results.json").write_text(json.dumps(result,indent=2)+"\n")
