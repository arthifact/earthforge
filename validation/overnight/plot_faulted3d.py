"""Inspect the verified continuous-material -> 3D wave modelling example."""
import argparse,json
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
p=argparse.ArgumentParser();p.add_argument('--out',type=Path,required=True);a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
d=json.loads(Path('data/seismic/overnight-v1/faulted-3d.json').read_text());g=d['grid'];s=d['shot']
v=np.asarray(d['velocity']).reshape(g['nz'],g['ny'],g['nx'])/1000
x0=g['origin']['x']/1000;z0=g['origin']['z']/1000;ext=[x0-g['dx']/2000,x0+(g['nx']-.5)*g['dx']/1000,z0+(g['nz']-.5)*g['dz']/1000,z0-g['dz']/2000]
plt.rcParams.update({'font.family':'sans-serif','font.size':10,'axes.spines.top':False,'axes.spines.right':False})
fig=plt.figure(figsize=(13,9),layout='constrained');layout=fig.add_gridspec(2,3,height_ratios=[1,1.2])
for col,j in enumerate([0,15,30]):
    ax=fig.add_subplot(layout[0,col]);im=ax.imshow(v[:,j,:],extent=ext,vmin=1.5,vmax=2.5,cmap='viridis',interpolation='nearest',aspect='equal')
    ax.set(title=f'Velocity · Y = {(g["origin"]["y"]+j*g["dy"])/1000:.3f} km',xlabel='X (km)',ylabel='Depth (km)')
    if j==15:
        ax.scatter(s['source']['x']/1000,s['source']['z']/1000,marker='*',c='red',edgecolors='white',linewidths=.5,s=80,zorder=3)
        ax.text(s['source']['x']/1000+.05,s['source']['z']/1000,'Source',color='white',fontsize=9)
    fig.colorbar(im,ax=ax,label='P-wave speed (km/s)',shrink=.82)
ax=fig.add_subplot(layout[1,0:2]);indices=[i for i,r in enumerate(s['receivers']) if abs(r['y']-s['source']['y'])<1e-6]
traces=np.asarray(s['data']).reshape(len(s['receivers']),s['samplesPerReceiver'])[indices].T
xs=np.array([s['receivers'][i]['x'] for i in indices])/1000;half=(xs[1]-xs[0])/2;t=(s['samplesPerReceiver']-1)*s['dtSeconds']
im=ax.imshow(traces,extent=[xs[0]-half,xs[-1]+half,t,0],origin='upper',interpolation='nearest',aspect='auto',cmap='gray',vmin=-.0002,vmax=.0002)
ax.set(title='Full 3D shot · middle receiver line · 6 Hz',xlabel='Receiver X (km)',ylabel='Time (s)');fig.colorbar(im,ax=ax,label='Pressure (arbitrary units)',shrink=.86)
ax=fig.add_subplot(layout[1,2]);u=np.asarray(s['finalField']).reshape(g['nz'],g['ny'],g['nx']);limit=float(np.quantile(np.abs(u),.995))
im=ax.imshow(u[:,15,:],extent=ext,origin='upper',interpolation='nearest',aspect='equal',cmap='RdBu',vmin=-limit,vmax=limit)
ax.set(title=f'Wavefield · middle Y · t = {t:.3f} s',xlabel='X (km)',ylabel='Depth (km)');fig.colorbar(im,ax=ax,label='Pressure (arbitrary units)',shrink=.86)
fig.suptitle('Earth Forge · faulted 3D material → velocity grid → 3D seismic shot',fontsize=15)
fig.supxlabel('Two prescribed inclined faults · 40 continuous material fragments · 115,351 derived grid nodes · constant-density acoustics · 45 receivers',fontsize=10)
fig.savefig(a.out/'earthforge-faulted-3d-seismic.png',dpi=180);fig.savefig(a.out/'earthforge-faulted-3d-seismic.pdf')
