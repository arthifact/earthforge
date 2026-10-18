"""Run with an installed wheel, outside the checkout and without engine/PYTHONPATH overrides."""
import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

from earthforge import Engine, Grid, History, load_dataset
from earthforge._util import canonical, file_sha

parser = argparse.ArgumentParser()
parser.add_argument("--out", required=True, type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
args.out.mkdir(parents=True, exist_ok=False)
engine = Engine()
assert "_bin" in engine.path.parts, engine.path
report = {"schema":"earthforge-installed-wheel-validation-v1","enginePath":str(engine.path),"engineSha256":engine.sha256,"usesBundledEngine":True,"python":sys.version,"numpy":np.__version__}
subprocess.run([sys.executable,str(root/"examples/research/quickstart.py"),str(args.out/"example")],check=True)
study = args.out/"study"
subprocess.run([sys.executable,"-m","earthforge","ensemble",str(root/"examples/research/rift-study.json"),"--out",str(study)],check=True)
subprocess.run([sys.executable,"-m","earthforge","ensemble",str(root/"examples/research/rift-study.json"),"--out",str(study),"--resume"],check=True)
manifest = json.loads((study/"ensemble.json").read_text())
assert manifest["state"] == "complete" and manifest["failures"] == 0
ids = [c["id"] for c in manifest["identity"]["plan"]["candidates"]]
histories = [History.load(study/key/"history.json") for key in ids]
points = [(4950,4950,800),(5000,5000,1000),(5050,5050,1200)]
truth = engine.points(histories[0],points)
observations = [dict(kind="velocity",id=str(i),x=p[0],y=p[1],z=p[2],value=v["velocity"],sigma=100) for i,(p,v) in enumerate(zip(points,truth))]
obs_file = args.out/"synthetic-observations.json"; obs_file.write_bytes(canonical({"schema":"earthforge-observations-v1","observations":observations}))
weights = args.out/"conditioning.json"
subprocess.run([sys.executable,"-m","earthforge","condition",str(obs_file),*[str(study/key/"history.json") for key in ids],"--out",str(weights)],check=True)
weighted = json.loads(weights.read_text()); assert weighted["weights"][0] >= max(weighted["weights"])-1e-14
subprocess.run([sys.executable,"-m","earthforge","shot",str(args.out/"example/volume"),"--source","4980","4980","600","--receiver","4990","4980","600","--frequency","6","--duration",".4","--sponge-cells","4","--out",str(args.out/"paired-shot.npz")],check=True)
with np.load(args.out/"paired-shot.npz",allow_pickle=False) as z:
    assert z["traces"].shape[0]==1 and np.any(z["traces"]!=0)
    report["pairedShotShape"]=list(z["traces"].shape)
# Reproduce the real browser artifact saved at the preceding block-viewer checkpoint.
browser_path = root.parents[1]/"outputs/earthforge-block-908054-stage-12.json"
if browser_path.is_file():
    artifact = json.loads(browser_path.read_text())
    h = History.from_record(artifact)
    v = engine.sample(h,Grid.from_dict(artifact["request"]["query"]["grid"]))
    digest = hashlib.sha256()
    for name,dtype in [("velocity","<f4"),("beds","<i4"),("lithology","<f4"),("surface","<f4"),("basement","<f4")]:
        digest.update(v.fields[name].astype(dtype).tobytes())
    assert digest.hexdigest()==artifact["calculation"]["displaySha256"]
    report["realBrowserExportDisplayExactlyReproduced"]=True
    report["browserDisplaySha256"]=digest.hexdigest()
report.update({"sixMemberStudyAndResume":True,"conditioningCLI":True,"syntheticConditioningESS":weighted["effectiveSampleSize"],"standardNPZAndVTI":True,"exampleContentSha256":load_dataset(args.out/"example/volume").content_digest(),"observationalDataUsed":False})
(args.out/"verification.json").write_text(json.dumps(report,indent=2)+"\n")
print(json.dumps(report,indent=2))
