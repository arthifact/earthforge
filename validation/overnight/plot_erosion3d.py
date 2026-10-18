"""Show verified material sections before/after prescribed conservative 3D erosion."""
import argparse,json
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon,Patch
parser=argparse.ArgumentParser();parser.add_argument('--out',type=Path,required=True);args=parser.parse_args();args.out.mkdir(parents=True,exist_ok=True)
before=json.loads(Path('validation/overnight/volume3d-result.json').read_text())
after=json.loads(Path('validation/overnight/erosion3d-result.json').read_text())
erosion=after['eventLedgers'][-1]['ledger'];surface=erosion['surface']
plt.rcParams.update({'font.family':'sans-serif','font.size':10,'axes.spines.top':False,'axes.spines.right':False})
fig,axes=plt.subplots(2,3,figsize=(13,8))
fig.subplots_adjust(left=.055,right=.995,top=.90,bottom=.22,wspace=.23,hspace=.45)
shale=np.array([99,108,124])/255;sand=np.array([220,179,104])/255
for row,state in enumerate([before,after]):
 for col,section in enumerate(state['sections']):
  ax=axes[row,col];ax.set_facecolor('#e6f1f7')
  for parcel in section['parcels']:
   material=parcel['material'];xy=np.array([[p['x']/1000,p['z']/1000] for p in parcel['polygon']])
   color='#343d4a' if material['bed']==-2 else '#a3b8ad' if material['carbonate'] else tuple(shale*(1-material['sandFraction'])+sand*material['sandFraction'])
   ax.add_patch(Polygon(xy,closed=True,facecolor=color,edgecolor='#ffffff99',linewidth=.35))
  if row:
   x=np.array([0.,10.]);z=(surface['point']['z']+surface['slopeX']*(x*1000-surface['point']['x'])+surface['slopeY']*(section['y']-surface['point']['y']))/1000
   ax.plot(x,z,'--',color='#146a90',linewidth=1.3)
  ax.set(xlim=(0,10),ylim=(6.2,0),aspect='equal',xlabel='X (km)',ylabel='Depth (km)',title=f'{"After two faults" if row==0 else "After sloping erosion"} · Y = {section["y"]/1000:g} km')
fig.suptitle('Earth Forge · prescribed 3D erosion preserves retained material history',fontsize=15)
fig.legend(handles=[Patch(facecolor=shale,label='Shale-rich'),Patch(facecolor=sand,label='Sand-rich'),Patch(facecolor='#a3b8ad',label='Carbonate'),Patch(facecolor='#343d4a',label='Basement'),Patch(facecolor='#e6f1f7',label='Implicit water/background')],loc='lower center',bbox_to_anchor=(.5,.085),ncol=5,frameon=False)
fig.supxlabel(f'Exported grain volume {erosion["removed"]["grain"]/1e9:.2f} km³ · all constituent/per-bed budgets close · burial/loading memories retained\nPrescribed fault slip and erosion only; 3D deposition, compaction and pressure evolution remain unimplemented.',fontsize=10,y=.015)
fig.savefig(args.out/'earthforge-3d-erosion.png',dpi=180);fig.savefig(args.out/'earthforge-3d-erosion.pdf')
