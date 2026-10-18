"""Isolated end-to-end SDK costs. No viewer, cache-hit or competitor speed claims."""
import json
import os
import platform
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CASES = [(scenario, grid) for scenario in ("rift-v1","reverse-fault-v1","erosion-reburial-v1") for grid in ("coarse-window","10m-crop")]
if len(sys.argv) == 3 and sys.argv[1] == "--child":
    start = time.perf_counter()
    from earthforge import Engine, Grid
    from earthforge._util import file_sha
    plan = json.loads(Path(__file__).with_name("cohort-plan.json").read_text())
    scenario, name = CASES[int(sys.argv[2])]
    grid = Grid.from_dict(plan["grids"][name])
    engine = Engine(ROOT/"target/release/earthforge")
    setup = time.perf_counter()-start
    trials = []
    with tempfile.TemporaryDirectory(prefix="earthforge-pipeline-") as folder:
        for i in range(-1,3):
            t = time.perf_counter(); history = engine.build_history(scenario,seed=1001); source_time = time.perf_counter()-t
            t = time.perf_counter(); volume = engine.sample(history,grid); sample_time = time.perf_counter()-t
            path = Path(folder)/f"trial-{i}.npz"
            t = time.perf_counter(); volume.save_npz(path); export_time = time.perf_counter()-t
            trials.append({"warmup":i<0,"historyConstructionSeconds":source_time,"sampleDecodeAndPackingSeconds":sample_time,"npzValidationHashAndCompressionSeconds":export_time,"endToEndSeconds":source_time+sample_time+export_time,"contentSha256":volume.content_digest(),"compressedBytes":path.stat().st_size})
            path.unlink()
            del volume
    assert len({t["contentSha256"] for t in trials})==1
    memory = None
    if os.name != "nt":
        import resource
        scale = 1 if sys.platform == "darwin" else 1024
        memory = {"pythonPeakRssBytes":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*scale,"nativeChildPeakRssBytes":resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss*scale,"scope":"Per-case high-water marks across warmup and trials. Separate Python process and native child process maxima; not simultaneous total or energy."}
    def median(key):
        return sorted(t[key] for t in trials if not t["warmup"])[1]
    print(json.dumps({"scenario":scenario,"gridName":name,"grid":grid.to_dict(),"nodes":grid.nodes,"materialStepMetres":10,"seed":1001,"setupSeconds":setup,"medians":{k:median(k) for k in ("historyConstructionSeconds","sampleDecodeAndPackingSeconds","npzValidationHashAndCompressionSeconds","endToEndSeconds")},"trials":trials,"memory":memory,"engineSha256":engine.sha256}))
else:
    rows=[]
    for i in range(len(CASES)):
        p = subprocess.run([sys.executable,__file__,"--child",str(i)],capture_output=True,text=True,check=True)
        row=json.loads(p.stdout);rows.append(row);print(json.dumps({"scenario":row["scenario"],"grid":row["gridName"],"medians":row["medians"]}),flush=True)
    result={"schema":"earthforge-research-pipeline-benchmark-v1","python":platform.python_version(),"platform":platform.platform(),"method":"Serial fresh process per case; one warmup and three complete trials; no model cache. Source construction, f64 material-state sampling/result decoding/packing, and NPZ validation/hash/compression measured separately. Imports/engine setup separate. All fields and precision identical per repeat. No build/test/model jobs launched concurrently by this validation run.","scope":"Coarse 10x10x3km preview and 320x320x2000m 10m crop. Neither is a 10m full-field or FWI survey benchmark. No power measurement.","rows":rows}
    Path(__file__).with_name("pipeline-benchmark-results.json").write_text(json.dumps(result,indent=2)+"\n")
