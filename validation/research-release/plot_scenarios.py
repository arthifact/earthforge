"""Scientific section figure from the f64 continuous history, not viewer pixels."""
import argparse
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from earthforge import Engine, SCENARIOS

parser=argparse.ArgumentParser();parser.add_argument("out",type=Path);args=parser.parse_args();args.out.parent.mkdir(parents=True,exist_ok=True)
engine=Engine();fig,axes=plt.subplots(1,3,figsize=(14,3.3),sharey=True,layout="constrained")
for ax,(name,scenario) in zip(axes,SCENARIOS.items()):
    history=engine.build_history(name,seed=1001)
    result=engine.request({"kind":"history3d","model":history.model,"query":{"sectionsY":[],"zMax":3000,"planes":[{"axis":"y","position":5000,"nu":501,"nv":301}]}})["planes"][0]
    a=np.asarray(result["velocity"]).reshape(301,501)/1000
    mesh=ax.pcolormesh(np.asarray(result["uCoordinates"])/1000,np.asarray(result["vCoordinates"])/1000,a,shading="nearest",cmap="viridis",vmin=1.5,vmax=5.6,rasterized=True)
    ax.set_title(scenario["name"],fontsize=10);ax.set_xlabel("X (km)");ax.set_aspect("equal");ax.set_ylim(3,0)
axes[0].set_ylabel("Depth (km, positive down)")
fig.colorbar(mesh,ax=axes,label="P-wave velocity (km/s)",shrink=.7)
fig.suptitle("Earth Forge research scenarios · seed 1001 · Y = 5 km · true proportions",fontsize=12)
fig.text(.5,.015,"Continuous-model sections sampled at 20 m × 10 m; 10 m material subdivision. Synthetic examples; independent field accuracy unestablished.",ha="center",fontsize=8)
fig.savefig(args.out,dpi=220);fig.savefig(args.out.with_suffix('.pdf'));plt.close(fig)
