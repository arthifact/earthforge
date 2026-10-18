"""Independent double-precision Devito FD4 reference, synthetic data only.

The reference uses Devito's symbolic wave equation, sparse injection and
interpolation. Earth Forge's stencil and coefficient arrays are not reused.
"""
from pathlib import Path
import hashlib,json,os,subprocess,time,importlib
import numpy as np
import devito
from devito import Grid,Function,TimeFunction,SparseTimeFunction,Eq,Operator,solve
# Devito 4.8.23 rounds generated derivative coefficients to nine decimal
# digits even for f64 fields. An explicit in-memory override lets this test
# compare binary64 coefficient precision; the installed package is untouched.
fd_module=importlib.import_module('devito.finite_differences.finite_difference')
stock_digits=fd_module._PRECISION
digits=int(os.environ.get('EARTHFORGE_DEVITO_COEFFICIENT_DIGITS',str(stock_digits)))
assert digits in [stock_digits,17]
fd_module._PRECISION=digits
OUT=Path(f'data/seismic/devito-v1/{digits}digits');OUT.mkdir(parents=True,exist_ok=True)
ENGINE=Path(os.environ.get('EARTHFORGE_NATIVE_ENGINE','target/release/earthforge'))
THRESHOLDS={'relativeL2':1e-8,'normalizedLinf':1e-7}
def digest(data):return hashlib.sha256(data).hexdigest()
def compare(name,three,medium):
    nx,ny,nz=(31,21,31) if three else (81,1,71)
    dx,dy,dz=(12.,15.,10.) if three else (10.,1.,12.)
    origin={'x':1000.,'y':2000. if three else 0.,'z':3000.}
    zz,yy,xx=np.indices((nz,ny,nx))
    speed=np.full((nz,ny,nx),2200. if three else 2000.)
    if medium=='layered':speed[zz>=(22 if three else 35)]=3000. if three else 2800.
    if medium=='smooth':speed+=2*xx+3*zz
    source={'x':origin['x']+(180.4 if three else 400.3),'y':origin['y']+(150.7 if three else 0.),'z':origin['z']+(150.8 if three else 300.7)}
    offsets=[(-60.2,-15.3,0.4),(60.6,20.1,1.1),(100.4,-35.2,40.8)] if three else [(-100.1,0.,0.),(100.3,0.,.4),(200.1,0.,120.1)]
    receivers=[{k:source[k]+delta for k,delta in zip(['x','y','z'],offset)} for offset in offsets]
    request={'kind':'acoustic','grid':{'nx':nx,'ny':ny,'nz':nz,'dx':dx,'dy':dy,'dz':dz,'origin':origin},'velocity':speed.ravel().tolist(),'source':source,'receivers':receivers,'frequencyHz':12.,'durationSeconds':.24 if three else .3,'dtSeconds':.00075 if three else .001,'sourceDelaySeconds':.125,'spongeCells':0,'includeFinalField':True}
    request_text=json.dumps(request,separators=(',',':'))
    result=subprocess.run([str(ENGINE.resolve())],input=request_text,text=True,capture_output=True,check=True)
    response=json.loads(result.stdout);assert response['ok'],response
    rust=response['value'];nt=rust['samplesPerReceiver'];dt=rust['dtSeconds']
    shape=(nx,ny,nz) if three else (nx,nz)
    extent=((nx-1)*dx,(ny-1)*dy,(nz-1)*dz) if three else ((nx-1)*dx,(nz-1)*dz)
    grid_origin=(origin['x'],origin['y'],origin['z']) if three else (origin['x'],origin['z'])
    grid=Grid(shape=shape,extent=extent,origin=grid_origin,dtype=np.float64)
    m=Function(name='m',grid=grid,space_order=4,dtype=np.float64)
    m.data[:]=1./((speed.transpose(2,1,0) if three else speed[:,0,:].T)**2)
    u=TimeFunction(name='u',grid=grid,time_order=2,space_order=4,dtype=np.float64)
    keys=['x','y','z'] if three else ['x','z']
    source_coords=np.array([[source[k] for k in keys]],dtype=np.float64)
    receiver_coords=np.array([[p[k] for k in keys] for p in receivers],dtype=np.float64)
    src=SparseTimeFunction(name='src',grid=grid,npoint=1,nt=nt,coordinates=source_coords,dtype=np.float64)
    rec=SparseTimeFunction(name='rec',grid=grid,npoint=len(receivers),nt=nt,coordinates=receiver_coords,dtype=np.float64)
    assert src.coordinates.data.dtype==np.float64
    argument=np.pi*request['frequencyHz']*(np.arange(nt)*dt-request['sourceDelaySeconds'])
    src.data[:,0]=(1.-2.*argument**2)*np.exp(-argument**2)
    stencil=Eq(u.forward,solve(m*u.dt2-u.laplace,u.forward))
    source_term=src.inject(field=u.forward,expr=src*grid.stepping_dim.spacing**2/m/(dx*dz*(dy if three else 1.)))
    receiver_term=rec.interpolate(expr=u)
    operator=Operator([stencil]+source_term+receiver_term,subs=grid.spacing_map)
    c_source=str(operator.ccode)
    (OUT/f'{name}-operator.c').write_text(c_source)
    start=time.perf_counter();operator.apply(time_m=0,time_M=nt-1,dt=dt);reference_seconds=time.perf_counter()-start
    reference=np.asarray(rec.data).T.copy();candidate=np.asarray(rust['data']).reshape(len(receivers),nt)
    reference_field=np.asarray(u.data[(nt-1)%3]);reference_field=reference_field.transpose(2,1,0) if three else reference_field.T
    candidate_field=np.asarray(rust['finalField']).reshape((nz,ny,nx) if three else (nz,nx))
    def error(expected,actual):
        assert np.isfinite(expected).all() and np.isfinite(actual).all()
        norm=float(np.linalg.norm(expected.ravel()));peak=float(np.max(np.abs(expected)))
        assert norm>1e-12 and peak>1e-12
        return {'relativeL2':float(np.linalg.norm((actual-expected).ravel())/norm),'normalizedLinf':float(np.max(np.abs(actual-expected))/peak),'referencePeak':peak}
    traces=error(reference,candidate);field=error(reference_field,candidate_field)
    np.savez_compressed(OUT/f'{name}.npz',reference_traces=reference,candidate_traces=candidate,reference_field=reference_field,candidate_field=candidate_field)
    row={'name':name,'dimensions':3 if three else 2,'medium':medium,'requestSha256':digest(request_text.encode()),'grid':request['grid'],'samples':nt,'dtSeconds':dt,'spatialOrder':4,'timeOrder':2,'sourceCoordinatesDtype':str(src.coordinates.data.dtype),'operatorCSourceSha256':digest(c_source.encode()),'receiverError':traces,'finalFieldError':field,'referenceSecondsIncludingJit':reference_seconds,'pass':all(metrics[key]<=limit for metrics in [traces,field] for key,limit in THRESHOLDS.items())}
    print(json.dumps(row),flush=True)
    return row
rows=[]
for name,three,medium in [('homogeneous-2d',False,'homogeneous'),('layered-2d',False,'layered'),('smooth-2d',False,'smooth'),('homogeneous-3d',True,'homogeneous'),('layered-3d',True,'layered')]:
    rows.append(compare(name,three,medium))
    report={'devitoVersion':devito.__version__,'stockCoefficientDigits':stock_digits,'coefficientDigits':digits,'inMemoryCoefficientPrecisionOverride':digits!=stock_digits,'devitoFiniteDifferenceSourceSha256':digest(Path(fd_module.__file__).read_bytes()),'compilerFlags':devito.configuration['compiler'].cflags,'numpyVersion':np.__version__,'compiler':str(devito.configuration['compiler']),'platform':str(devito.configuration['platform']),'safeMath':bool(devito.configuration['safe-math']),'thresholds':THRESHOLDS,'nativeSha256':digest(ENGINE.read_bytes()),'comparisonScriptSha256':digest(Path(__file__).read_bytes()),'boundaryScope':'No sponge in either solver; matching zero Dirichlet halos. Boundary reflections may occur in the later fields. This does not cross-validate absorbing boundaries.','method':'Independent Devito symbolic m*u.dt2-u.laplace, fourth-order space, second-order time, double precision and standard sparse source/receiver operators. Same synthetic nodal velocities, metre/second units, time step, Ricker samples and inverse-cell source normalization. No Earth Forge stencil reuse. Timings include JIT and are not a speed comparison.','cases':rows}
    Path(f'validation/overnight/devito-comparison-{digits}digits-results.json').write_text(json.dumps(report,indent=2)+'\n')
assert all(r['pass'] for r in rows),'Reference comparison exceeds the predeclared thresholds'
