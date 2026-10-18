"""Run after installing the local wheel or the source package; writes a new folder."""
from pathlib import Path
import argparse
from earthforge import Engine, Grid, load_dataset

parser = argparse.ArgumentParser()
parser.add_argument("out", type=Path)
args = parser.parse_args()
args.out.mkdir(parents=True, exist_ok=False)
engine = Engine()
history = engine.build_history("rift-v1", seed=1001, steps=6, faults=1)
grid = Grid(17, 17, 101, 10, 10, 10, (4900, 4900, 400))
engine.export_dataset(history, grid, args.out/"volume")
volume = load_dataset(args.out/"volume")
volume.save_npz(args.out/"model.npz")
volume.save_vti(args.out/"model.vti")
print(f"Wrote {grid.nodes:,} f64 nodal samples; content SHA256 {volume.content_digest()}")
