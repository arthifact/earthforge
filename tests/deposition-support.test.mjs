import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(process.env.EARTHFORGE_SOURCE??fileURLToPath(new URL('..',import.meta.url)));
const {build}=createRequire(resolve(root,'package.json'))('esbuild');
const b=await build({entryPoints:[resolve(root,'src/strata.ts')],bundle:true,platform:'node',format:'esm',write:false});
const {depositedLayer,MATERIAL_QUADRATURE_M}=await import(`data:text/javascript;base64,${Buffer.from(b.outputFiles[0].contents).toString('base64')}`);
function units(x){const v=new DataView(new ArrayBuffer(8));v.setFloat64(0,x);const b=v.getBigUint64(0),e=Number(b>>52n&2047n),m=b&((1n<<52n)-1n);return e?(m+(1n<<52n))<<BigInt(e-1):m;}
const bulk=parts=>parts.flatMap(p=>p.lengths??[p.height]).reduce((n,h)=>n+units(h),0n),near=(a,b)=>assert(Math.abs(a-b)<=128*Number.EPSILON*Math.max(Number.MIN_VALUE,Math.abs(a),Math.abs(b)));
const physics={porosity:()=>.25,effectiveDepth:d=>d/2};

test('depositional quadrature partitions the exact declared bulk, including nondivisible bin lengths',()=>{
 for(const h of[22,43,40,20,10,.1,2**-40,2**-60]){
  const parts=depositedLayer(3,h,.4,false,17,null,physics),n=Math.ceil(h/MATERIAL_QUADRATURE_M);
  assert.equal(parts.length,n);assert.equal(bulk(parts),units(h));near(parts.reduce((s,p)=>s+p.solid,0),.75*h);
  const mids=Array.from({length:n},(_,j)=>17+(j+.5)*(h/n));
  for(const p of parts){assert(p.height>0);assert.equal(p.bed,3);assert.equal(p.fraction,.4);assert(mids.includes(p.burial));assert.equal(p.loading,p.burial/2);assert.equal(p.offsetX,0);assert.equal(p.offsetZ,0);}
 }
});

test('a signed exact deposit span preserves tiny residuals without assigning them separate quadrature memories',()=>{
 for(const h of[40,20,10])for(const tiny of[2**-40,2**-60]){
  const parts=depositedLayer(2,[h,tiny],.25,false,9,null,physics),n=Math.ceil((h+tiny)/MATERIAL_QUADRATURE_M);
  assert.equal(bulk(parts),units(h)+units(tiny));if(tiny<h*Number.EPSILON)assert(parts.some(p=>(p.lengths??[p.height]).some(t=>t<h*Number.EPSILON)));
  const bins=new Map();for(const p of parts){if(!bins.has(p.burial))bins.set(p.burial,[]);bins.get(p.burial).push(p);}
  assert.equal(parts.length,n);assert.equal(bins.size,n);let j=0;
  for(const [mid,p]of bins){assert.equal(mid,9+(j+.5)*((h+tiny)/n));assert(p.every(q=>q.loading===mid/2));j++;}
  near(parts.reduce((s,p)=>s+p.solid,0),.75*(h+tiny));
  assert.equal(bulk(depositedLayer(2,[h,-tiny],.25,false,0,null,physics)),units(h)-units(tiny));
 }
});

test('deposition exact spans define zero support and reject negative or nonfinite thickness',()=>{
 for(const h of[0,[],[10,-10]])assert.deepEqual(depositedLayer(0,h,0,false,0,null,physics),[]);
 for(const h of[-1,[10,-11],NaN,[Infinity],[-Infinity]])assert.throws(()=>depositedLayer(0,h,0,false,0,null,physics),/Invalid deposited thickness/);
});
