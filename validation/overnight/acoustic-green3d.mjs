/** Absolute waveform/amplitude convergence against the continuum 3D Green function. */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const engine='target/release/earthforge',velocity=2000,frequency=12,delay=1.5/frequency,duration=0.24;
const source={x:300,y:300,z:300};
const receivers=[{x:400,y:300,z:300},{x:360,y:380,z:300},{x:300,y:360,z:380}];
const thresholds={finestRelativeL2:0.01,minRefinementRatio:2};
const rows=[];
for(const h of [20,10,5]) {
 const n=600/h+1,grid={nx:n,ny:n,nz:n,dx:h,dy:h,dz:h,origin:{x:0,y:0,z:0}};
 const request={kind:'acoustic',grid,velocity:Array(n*n*n).fill(velocity),source,receivers,frequencyHz:frequency,durationSeconds:duration,spongeCells:0};
 const input=JSON.stringify(request),run=spawnSync(engine,[],{input,encoding:'utf8',maxBuffer:10*1024*1024});assert.equal(run.status,0,run.stderr);
 const result=JSON.parse(run.stdout);assert.equal(result.ok,true,result.error);const shot=result.value,nt=shot.samplesPerReceiver,dt=shot.dtSeconds;
 const errors=receivers.map((r,j)=>{
  const radius=Math.hypot(r.x-source.x,r.y-source.y,r.z-source.z),travel=radius/velocity;
  let square=0,truthSquare=0,maximum=0,truthPeak=0,candidatePeak=0;
  for(let i=0;i<nt;i++){
   const sourceTime=i*dt-travel;
   const argument=Math.PI*frequency*(sourceTime-delay);
   // m*p_tt-Laplacian(p)=q(t)*delta(x) => p=q(t-r/c)/(4*pi*r).
   // q(t<0)=0, matching the zero-initial-condition simulation.
   const truth=sourceTime<0?0:(1-2*argument*argument)*Math.exp(-argument*argument)/(4*Math.PI*radius);
   const candidate=shot.data[j*nt+i],error=candidate-truth;
   square+=error*error;truthSquare+=truth*truth;maximum=Math.max(maximum,Math.abs(error));truthPeak=Math.max(truthPeak,Math.abs(truth));candidatePeak=Math.max(candidatePeak,Math.abs(candidate));
  }
  return {radiusM:radius,relativeL2:Math.sqrt(square/truthSquare),normalizedLinf:maximum/truthPeak,peakRatio:candidatePeak/truthPeak};
 });
 const row={spacingM:h,grid,dtSeconds:dt,samples:nt,errors,maxRelativeL2:Math.max(...errors.map(e=>e.relativeL2)),logicalArrayBytes:shot.stats.workingArrayBytes,stencilUpdates:shot.stats.stencilUpdates};
 rows.push(row);console.log(JSON.stringify(row));
 writeFileSync('validation/overnight/acoustic-green3d-results.json',JSON.stringify({nativeSha256:createHash('sha256').update(readFileSync(engine)).digest('hex'),equation:'m*p_tt-Laplacian(p)=q(t)*delta(x), constant density and m=1/c²',analytic:'p(t,r)=q(t-r/c)/(4*pi*r), q(t<0)=0',source:{velocityMps:velocity,frequencyHz:frequency,delaySeconds:delay},receivers,domainM:[600,600,600],boundaryScope:'No sponge; recording ends at0.24s, before the earliest reflected wavefront can return to these receivers (at least0.25s).',thresholds,rows},null,2)+'\n');
}
assert.ok(rows.at(-1).maxRelativeL2<thresholds.finestRelativeL2,'Finest 3D waveform must meet predeclared continuum error');
for(let i=1;i<rows.length;i++)assert.ok(rows[i-1].maxRelativeL2/rows[i].maxRelativeL2>thresholds.minRefinementRatio,'Refinement must reduce waveform error');

const complete=JSON.parse(readFileSync("validation/overnight/acoustic-green3d-results.json"));complete.pass=true;complete.refinementRatios=rows.slice(1).map((r,i)=>rows[i].maxRelativeL2/r.maxRelativeL2);writeFileSync("validation/overnight/acoustic-green3d-results.json",JSON.stringify(complete,null,2)+"\n");
