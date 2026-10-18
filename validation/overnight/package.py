"""Package explicit synthetic evidence paths; never inspect observational datasets."""
from pathlib import Path
import datetime
import hashlib
import json
import os
import tarfile

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(os.environ.get("EARTHFORGE_HANDOFF_DIR", ROOT.parents[1] / "outputs"))
OUT.mkdir(parents=True, exist_ok=True)


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def files_under(path):
    assert path.exists(), path
    if path.is_file():
        return [path]
    return sorted(p for p in path.rglob("*") if p.is_file())


def archive(name, entries):
    rows = []
    target = OUT / name
    with tarfile.open(target, "w:gz", compresslevel=6) as tf:
        for path, relative in entries:
            assert path.is_file() and not path.is_symlink(), path
            tf.add(path, arcname=relative, recursive=False)
            rows.append({"path": relative, "bytes": path.stat().st_size,
                         "sha256": digest(path)})
    with tarfile.open(target) as tf:
        assert tf.getnames() == [r["path"] for r in rows]
        for member, row in zip(tf.getmembers(), rows):
            assert hashlib.sha256(tf.extractfile(member).read()).hexdigest() == row["sha256"]
    print(name, len(rows), target.stat().st_size, flush=True)
    return {"name": name, "bytes": target.stat().st_size,
            "sha256": digest(target), "members": rows, "verifiedReadback": True}


def relative_entries(paths):
    return [(p, str(p.relative_to(ROOT))) for p in paths]


reports = []
pairs = [ROOT / "data/seismic/overnight-v1" / (name + ".json") for name in (
    "basin-extension-765184", "basin-compression-20261014", "layered-3d",
    "faulted-3d", "eroded-faulted-3d")]
reports.append(archive("earthforge-seismic-examples.tar.gz", relative_entries(pairs)))

studies = ("overnight-canonical-v1", "overnight-allocation-v1", "final-sine-fix-v1")
numerics = [p for name in studies for p in files_under(ROOT / "data/numerics" / name)]
reports.append(archive("earthforge-overnight-numerics.tar.gz", relative_entries(numerics)))

refs = files_under(ROOT / "data/seismic/devito-v1") + [ROOT / "validation/overnight" / name for name in (
    "compare_devito.py", "reference-requirements.txt", "devito-comparison-summary.json",
    "devito-comparison-9digits-results.json", "devito-comparison-17digits-results.json",
    "acoustic-green3d.mjs", "acoustic-green3d-results.json")]
reports.append(archive("earthforge-independent-reference.tar.gz", relative_entries(refs)))

engines = [(p, "engine-candidates/" + p.name) for p in sorted((ROOT.parent / "engine-candidates").iterdir()) if p.is_file()]
engines += relative_entries(files_under(ROOT / "crates/earthforge-core/licenses") + files_under(ROOT / "validation/overnight/experiments"))
reports.append(archive("earthforge-frozen-engines.tar.gz", engines))

manifest = {"createdAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "scope": "Explicit synthetic simulations, numerical studies, independent solver artifacts and owned frozen candidates. No observational data or dependency environments.",
            "archives": reports}
(OUT / "earthforge-artifact-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
