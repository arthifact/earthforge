#!/usr/bin/env python3
"""Matched fresh-process timings on one predetermined real-contact stack."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import statistics
import subprocess
import time


def main():
    p=argparse.ArgumentParser();p.add_argument('run',type=Path);p.add_argument('--engine',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args()
    folds=json.loads((a.run/'folds.json').read_text());fold=sorted([f for f in folds if f['region']=='35' and f['design']=='parent' and f['method']=='plane'],key=lambda f:f['heldGroup'])[0]
    history=json.loads((a.run/fold['history']).read_text());b=history['model']['bounds']['max'];xy=[(b['x']*i/20,b['y']*j/20) for j in range(21) for i in range(21)]
    tasks={
        'continuous-horizons':{'horizons':[{'x':x,'y':y,'unit':u} for x,y in xy for u in range(4)]},
        'coarse-block':{'grid':{'nx':49,'ny':49,'nz':241,'dx':b['x']/48,'dy':b['y']/48,'dz':5000/240,'origin':dict(x=0,y=0,z=0)}},
        'section':{'planes':[{'axis':'y','position':b['y']/2,'nu':501,'nv':501}],'zMax':5000}}
    results={}
    for name,query in tasks.items():
        payload=json.dumps({'kind':'history3d','model':history['model'],'query':{'sectionsY':[],**query}},separators=(',',':')).encode();trials=[]
        for i in range(4):
            command=[str(a.engine.resolve())]
            if platform.system()=='Darwin':command=['/usr/bin/time','-l',*command]
            elif platform.system()=='Linux':command=['/usr/bin/time','-v',*command]
            start=time.perf_counter();raw=subprocess.run(command,input=payload,capture_output=True,env={**os.environ,'RAYON_NUM_THREADS':'4'},check=True);elapsed=time.perf_counter()-start
            decode=time.perf_counter();response=json.loads(raw.stdout);decoded=time.perf_counter()-decode
            if not response['ok']:raise RuntimeError(response.get('error'))
            text=raw.stderr.decode();rss=None
            if platform.system()=='Darwin':
                match=re.search(r'(\d+)\s+maximum resident set size',text);rss=int(match[1]) if match else None
            elif platform.system()=='Linux':
                match=re.search(r'Maximum resident set size \(kbytes\):\s*(\d+)',text);rss=int(match[1])*1024 if match else None
            trial={'wallSeconds':elapsed,'callerDecodeSeconds':decoded,'outputBytes':len(raw.stdout),'peakRssBytes':rss,'nativeStats':response['value']['stats']}
            if i:trials.append(trial)
        results[name]={'query':query,'requestSha256':hashlib.sha256(payload).hexdigest(),'trials':trials,'medianWallSeconds':statistics.median(t['wallSeconds'] for t in trials),'maxPeakRssBytes':max((t['peakRssBytes'] for t in trials if t['peakRssBytes'] is not None),default=None)}
        print(name,results[name]['medianWallSeconds'],flush=True)
    record={'schema':'earthforge-field-geometry-performance-v1','case':{'region':'35','heldParent':fold['heldGroup'],'method':'plane','modelSha256':history['modelSha256'],'events':len(history['model']['events']),'faults':0,'materialStepM':100},'engineSha256':hashlib.sha256(a.engine.read_bytes()).hexdigest(),'machine':platform.platform(),'threads':4,'warmupsPerTask':1,'trialsPerTask':3,'results':results,'scope':'Simple observed-horizon reconstruction, four prescribed deposition surfaces, no inferred faults or compaction solve. Includes native startup, parse/evaluation, serialization and pipe transfer; caller decoding separate. Geometry resolution/complexity differs from dynamic rift benchmarks; no general real-time or browser guarantee.'}
    with a.out.open('x') as handle:handle.write(json.dumps(record,indent=2,sort_keys=True)+'\n')


if __name__=='__main__':main()
