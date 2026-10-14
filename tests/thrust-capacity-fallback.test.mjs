import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const root=fileURLToPath(new URL('../',import.meta.url));
const source=readFileSync(root+'src/basin.ts','utf8');
async function load(injected) {
  let code=injected?source.replace('try { assignment = assignTransport(nx, nz, allowed, parcels, capacity); }',`try { throw new ${injected}('analytical test sentinel'); }`):source;
  if(process.env.FALLBACK_ABLATION==='parent-flow') code=code.replace('averageFlow(X(src.source % nx) + p.offsetX, Math.floor(src.source / nx) * h + slice.sourceLocalTop + p.offsetZ, p.height)', 'src.displacements![slice.sourcePart]!');
  if(process.env.FALLBACK_ABLATION==='omit-local-offset') code=code.replace('offsetZ: moved.offsetZ - local','offsetZ: moved.offsetZ');
  const built=await build({stdin:{contents:`export * from './src/basin.ts';export * from './src/strata.ts';export * from './src/sedimentBudget.ts';`,resolveDir:root},bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'isolated-fallback-fixture',setup(b){
    b.onLoad({filter:/\/src\/basin\.ts$/},()=>({contents:code,loader:'ts',resolveDir:root+'src'}));
    b.onLoad({filter:/\/src\/conservativeTransport\.ts$/},()=>({contents:readFileSync(root+'src/conservativeTransport.ts','utf8'),loader:'ts',resolveDir:root+'src'}));
  }}]});
  return import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].contents).toString('base64'));
}
const api=await load('PlacementError'), errors=await load('Error'), dormant=await load();
const near=(a,b,t=1e-9)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
function fixture(h) {
  const nx=8,nz=6,bed=(id,height,ox=0,oz=0)=>({bed:id,height,solid:.6*height,fraction:.13+id*.2,burial:77+id,loading:33+id,offsetX:ox,offsetZ:oz});
  const columns=Array.from({length:nx},(_,i)=>i===3
    ?[api.emptyLayer(-1,h),bed(0,.35*h,.09*h),bed(1,.65*h,.09*h),bed(2,.5*h,-.3*h,-h),bed(3,3.5*h)]
    :[api.emptyLayer(-1,2.5*h),bed(3,3.5*h)]);
  return {...api.rasterize(columns,nz,h),columns,nx,nz,h,beds:Array.from({length:4},()=>({carbonate:false}))};
}
function moments(columns,h) {
  const result=new Map();
  for(let i=0;i<columns.length;i++){let top=0;for(const p of columns[i]){if(p.bed>=0){let q=result.get(p.bed);if(!q)result.set(p.bed,q={grain:0,x:0,z:0});q.grain+=p.solid;q.x+=p.solid*(-2000+i*h+p.offsetX);q.z+=p.solid*(top+p.height/2+p.offsetZ);}top+=p.height;}}
  for(const q of result.values()){q.x/=q.grain;q.z/=q.grain;}return result;
}
test('fallback vertical slices retain composition, history, grain and flat-flow first moments',()=>{
  for(const h of [40,20,10]) {
    const state=fixture(h),before=structuredClone(state),P=[[-2500,2.5*h],[0,2.5*h]],moved=api.remapThrust(state,P,.4*h,[0],true);
    assert.deepEqual(state,before);assert.equal(moved.placement.fallback,true);assert.ok(moved.placement.splitSources>0);
    const columns=api.columnsFromRaster(moved,state.nx,state.nz,h),old=moments(state.columns,h),now=moments(columns,h);
    for(const[id,a]of old){const b=now.get(id);near(a.grain,b.grain);near(b.x,a.x+(id===3?0:.4*h));near(b.z,a.z);}
    assert.ok(api.assessBudget(api.inventoryOf(state),api.inventoryOf({...state,...moved,columns}),moved.flux).closed);
    for(const t of moved.transfers){for(const key of ['height','solid','bed','fraction','burial','loading'])assert.equal(t.source[key],t.moved[key]);assert.ok(Number.isFinite(t.sourceLocalTop));assert.ok(Number.isFinite(t.destinationLocalTop));}
    for(let n=0;n<state.grid.length;n++){const parts=api.cellLayers(moved,n,h);near(moved.solid[n],parts.reduce((s,p)=>s+p.solid,0));}
    // The immutable footwall has exactly its original material state in every column.
    for(let i=0;i<state.nx;i++) assert.deepEqual(columns[i].filter(p=>p.bed===3),state.columns[i].filter(p=>p.bed===3));
  }
});
test('fallback catches placement infeasibility only; unrelated errors propagate',()=>{
  const state=fixture(20),P=[[-2500,50],[0,50]];
  assert.throws(()=>errors.remapThrust(state,P,8,[0]),/analytical test sentinel/);
});
test('ordinary feasible matching remains unchanged and zero slip bypasses fallback',()=>{
  const state=fixture(20),P=[[-2500,50],[0,50]];
  const normal=dormant.remapThrust(state,P,8,[0]);assert.equal(normal.placement.fallback,false);
  const zero=api.remapThrust(state,P,0,[0]);assert.deepEqual(zero.grid,state.grid);assert.deepEqual(zero.subcells,state.subcells);
});

test('each vertical child receives its own independent rectangular bend-flow moment',()=>{
  const h=40,nx=61,nz=30,i=7,P=[[-2000,700],[-1600,700],[-1400,500],[400,500]];
  const columns=Array.from({length:nx},(_,j)=>{const x=-2000+j*h,d=x<=-1600?700:x>=-1400?500:700-(x+1600);return[api.emptyLayer(-1,d),api.emptyLayer(-2,nz*h-d)];});
  const bed=(id,height,ox,oz)=>({bed:id,height,solid:.4*height,fraction:.4,burial:90+id,loading:70,offsetX:ox,offsetZ:oz});
  columns[i]=[api.emptyLayer(-1,600),bed(0,40,20,0),api.emptyLayer(-1,40),bed(1,20,19,-77),api.emptyLayer(-2,500)];
  const state={...api.rasterize(columns,nz,h),nx,nz,h,beds:[{carbonate:false},{carbonate:false}]};
  const moved=api.remapThrust(state,P,62,[0,0,0],true);
  const children=moved.transfers.filter(t=>t.source.bed===0);
  assert.ok(children.length>=2,'The fixture must split the marked parent');
  // Independent cubic corner integral of remaining travel beyond the45° bend.
  function expected(x,top,height){const t=Math.tan(Math.PI/8),cube=(x,z)=>Math.max(0,62+x+1600+(700-z)*t)**3;
    const mean=(cube(x+20,top)-cube(x-20,top)-cube(x+20,top+height)+cube(x-20,top+height))/(6*t*40*height);
    return[x+62-(1-1/Math.SQRT2)*mean,top+height/2-mean/Math.SQRT2];}
  for(const t of children){
    const oldX=-2000+t.sourceCell%nx*h+t.source.offsetX;
    const oldTop=Math.floor(t.sourceCell/nx)*h+t.sourceLocalTop+t.source.offsetZ;
    const target=expected(oldX,oldTop,t.source.height);
    const actual=[-2000+t.destinationCell%nx*h+t.moved.offsetX,
      Math.floor(t.destinationCell/nx)*h+t.destinationLocalTop+t.moved.height/2+t.moved.offsetZ];
    near(actual[0],target[0]);near(actual[1],target[1]);
  }
});
