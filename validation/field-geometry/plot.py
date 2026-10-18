#!/usr/bin/env python3
"""Scientific figure from retained outer predictions, without reading source logs."""
import argparse
import json
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt


def main():
    p=argparse.ArgumentParser();p.add_argument('run',type=Path);p.add_argument('--out',type=Path,required=True);a=p.parse_args()
    result=json.loads((a.run/'results.json').read_text());rows=json.loads((a.run/'predictions.json').read_text())
    plt.rcParams.update({'font.size':10,'axes.spines.top':False,'axes.spines.right':False,'font.family':'DejaVu Sans'})
    fig,axes=plt.subplots(2,2,figsize=(13,9),layout='constrained')
    palette={'constant':'#b4aaa0','plane':'#41694f','adaptive':'#8970a0'}
    ax=axes[0,0];x=np.arange(2);width=.23
    for i,method in enumerate(['constant','plane','adaptive']):
        vals=[result['results'][f'{d}/{method}']['overall']['maeM'] for d in ['parent','block']]
        bars=ax.bar(x+(i-1)*width,vals,width,label={'constant':'Flat','plane':'Tilted plane','adaptive':'Nested smooth selection'}[method],color=palette[method])
        ax.bar_label(bars,fmt='%.1f',padding=3,fontsize=9)
    ax.set(xticks=x,xticklabels=['Whole well excluded','Geographic block excluded'],ylabel='Contact MAE (m)',ylim=(0,245),title='A. Predicting real formation tops');ax.legend(frameon=False,fontsize=8,loc='upper left')
    ax=axes[0,1]
    names=['HORDALAND GP. Top','ROGALAND GP. Top','SHETLAND GP. Top'];colors=['#447e9b','#bd8c43','#795078']
    for name,color in zip(names,colors):
        subset=[r for r in rows if r['method']=='plane' and r['design']=='parent' and r['horizon']==name and r['prediction'] is not None]
        ax.scatter([r['depth'] for r in subset],[r['prediction'] for r in subset],s=22,alpha=.7,color=color,label=name.split()[0].title())
    lim=[0,4500];ax.plot(lim,lim,color='grey',lw=1,ls='--');ax.set(xlim=lim,ylim=lim,xlabel='Observed depth below MSL (m)',ylabel='Predicted depth (m)',title='B. Tilted planes: withheld wells');ax.legend(frameon=False,fontsize=9)
    ax=axes[1,0];regions=sorted(result['intake']['regions']);x=np.arange(len(regions));width=.25
    for i,method in enumerate(['constant','plane','adaptive']):
        vals=[result['results'][f'block/{method}']['groups']['region'][q]['maeM'] for q in regions]
        ax.bar(x+(i-1)*width,vals,width,color=palette[method])
    ax.set(xticks=x,xticklabels=regions,xlabel='NPD quadrant',ylabel='Block-excluded MAE (m)',title='C. Regional differences remain')
    ax=axes[1,1];subset=[r for r in rows if r['method']=='plane' and r['design']=='block' and r['prediction'] is not None]
    for inside,label,color in [(True,'Inside training XY hull','#41694f'),(False,'Outside training XY hull','#b36243')]:
        s=[r for r in subset if r['insideTrainingHull']==inside];ax.scatter([r['nearestTrainingDistanceM']/1000 for r in s],[abs(r['error']) for r in s],s=22,alpha=.65,label=label,color=color)
    ax.set(xlabel='Distance to nearest training contact (km)',ylabel='Absolute contact error (m)',title='D. Extrapolation needs more evidence');ax.legend(frameon=False,fontsize=8)
    fig.suptitle('Earth Forge · first real 3D horizon-contact diagnostic',fontsize=17,fontweight='bold')
    fig.supxlabel('69 wells · 68 parent groups · 207 contacts · 5 regions · 100% prediction coverage\nInterpreted NPD/FORCE 2020 tops; development cross-validation. No fault-surface or mapped-seismic-horizon validation.',fontsize=10)
    a.out.parent.mkdir(parents=True,exist_ok=True)
    for ext in ('png','svg'):fig.savefig(a.out.with_suffix('.'+ext),dpi=180)
    print(a.out.with_suffix('.png'))


if __name__=='__main__':main()
