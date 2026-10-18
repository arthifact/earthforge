"""Plot the numerical outputs without resimulating or changing their amplitudes."""
from pathlib import Path
import argparse, json
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
parser=argparse.ArgumentParser()
parser.add_argument('--data',type=Path,default=Path('data/seismic/overnight-v1'))
parser.add_argument('--out',type=Path,required=True)
args=parser.parse_args();args.out.mkdir(parents=True,exist_ok=True)
plt.rcParams.update({'font.family':'sans-serif','font.size':10,'axes.spines.top':False,'axes.spines.right':False,'figure.facecolor':'white','axes.facecolor':'white','savefig.facecolor':'white'})
fig,axes=plt.subplots(2,2,figsize=(14,8),layout='constrained',width_ratios=[1.25,1])
for row,(setting,seed) in enumerate([('extension',765184),('compression',20261014)]):
    d=json.loads((args.data/f'basin-{setting}-{seed}.json').read_text());g=d['grid'];s=d['shot']
    x0=g['origin']['x']/1000;z0=g['origin']['z']/1000
    extent=[x0-g['dx']/2000,x0+(g['nx']-.5)*g['dx']/1000,z0+(g['nz']-.5)*g['dz']/1000,z0-g['dz']/2000]
    image=axes[row,0].imshow(np.array(d['velocity']).reshape(g['nz'],g['nx'])/1000,extent=extent,origin='upper',vmin=1.5,vmax=5.6,cmap='viridis',interpolation='nearest',aspect='equal')
    axes[row,0].scatter(s['source']['x']/1000,s['source']['z']/1000,marker='*',s=85,c='#d43f3a',edgecolors='white',linewidths=.5,zorder=4,label='Source')
    axes[row,0].set(title=f'{setting.capitalize()} basin · seed {seed}',xlabel='Distance (km)',ylabel='Depth (km)')
    axes[row,0].text(s['source']['x']/1000+.16,.19,'Source',color='white',fontsize=9)
    fig.colorbar(image,ax=axes[row,0],label='P-wave speed (km/s)',shrink=.83,pad=.02)
    traces=np.array(s['data']).reshape(len(s['receivers']),s['samplesPerReceiver']).T
    rx=np.array([p['x'] for p in s['receivers']])/1000;dr=(rx[1]-rx[0])/2
    total=(s['samplesPerReceiver']-1)*s['dtSeconds']
    gather=axes[row,1].imshow(traces,extent=[rx[0]-dr,rx[-1]+dr,total,0],origin='upper',cmap='gray',vmin=-.01,vmax=.01,interpolation='nearest',aspect='auto')
    axes[row,1].set(title=f'Synthetic shot · {len(rx)} receivers · 6 Hz',xlabel='Receiver distance (km)',ylabel='Time (s)')
    fig.colorbar(gather,ax=axes[row,1],label='Pressure (arbitrary units)',shrink=.83,pad=.02)
fig.suptitle('Earth Forge · Rust velocity models paired with acoustic shot gathers',fontsize=16)
fig.supxlabel('Constant-density acoustics · 20 m grid · absorbing sponge on all sides · linear pressure scale clipped at ±0.01',fontsize=10)
fig.savefig(args.out/'earthforge-seismic-pairs.png',dpi=180)
fig.savefig(args.out/'earthforge-seismic-pairs.pdf')
plt.close(fig)
d=json.loads((args.data/'layered-3d.json').read_text());g=d['grid'];s=d['shot']
v=np.array(d['velocity']).reshape(g['nz'],g['ny'],g['nx'])/1000
u=np.array(s['finalField']).reshape(g['nz'],g['ny'],g['nx'])
mid_y=g['ny']//2;mid_x=g['nx']//2
fig,axes=plt.subplots(2,2,figsize=(11,8),layout='constrained')
for ax,field,extent,title in [(axes[0,0],v[:,mid_y,:],[0,(g['nx']-1)*g['dx']/1000,(g['nz']-1)*g['dz']/1000,0],'Velocity · middle Y section'),(axes[0,1],v[:,:,mid_x],[0,(g['ny']-1)*g['dy']/1000,(g['nz']-1)*g['dz']/1000,0],'Velocity · middle X section')]:
    image=ax.imshow(field,extent=extent,origin='upper',cmap='viridis',vmin=1.5,vmax=3.5,interpolation='nearest',aspect='equal');ax.set(title=title,xlabel='Distance (km)',ylabel='Depth (km)');fig.colorbar(image,ax=ax,label='P-wave speed (km/s)',shrink=.8)
limit=float(np.quantile(np.abs(u),.995))
image=axes[1,0].imshow(u[:,mid_y,:],extent=[0,.8,.8,0],origin='upper',cmap='RdBu',vmin=-limit,vmax=limit,interpolation='nearest',aspect='equal')
axes[1,0].set(title=f'3D wavefield · Y = 0.2 km · t = {(s["samplesPerReceiver"]-1)*s["dtSeconds"]:.2f} s',xlabel='X (km)',ylabel='Depth (km)');fig.colorbar(image,ax=axes[1,0],label='Pressure (arbitrary units)',shrink=.8)
indices=[i for i,p in enumerate(s['receivers']) if p['y']==200]
traces=np.array(s['data']).reshape(len(s['receivers']),s['samplesPerReceiver'])[indices].T
image=axes[1,1].imshow(traces,extent=[.15,.65,(s['samplesPerReceiver']-1)*s['dtSeconds'],0],origin='upper',cmap='gray',vmin=-.0003,vmax=.0003,interpolation='nearest',aspect='auto')
axes[1,1].set(title='3D shot · receivers at Y = 0.2 km',xlabel='Receiver X (km)',ylabel='Time (s)');fig.colorbar(image,ax=axes[1,1],label='Pressure (arbitrary units)',shrink=.8)
fig.suptitle('Earth Forge · full 3D acoustic propagation in an analytic layered model',fontsize=15)
fig.supxlabel('Three rotating wavefields · fourth-order space / second-order time · sponge boundaries · no geological-history claim for this analytic model',fontsize=9)
fig.savefig(args.out/'earthforge-acoustic-3d.png',dpi=180);fig.savefig(args.out/'earthforge-acoustic-3d.pdf');plt.close(fig)
print(json.dumps({'matplotlib':matplotlib.__version__,'numpy':np.__version__,'output':str(args.out)}))
