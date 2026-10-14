import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const bundle=await build({stdin:{contents:'export * from "./src/exactLength.ts";',resolveDir:root},bundle:true,platform:'node',format:'esm',write:false});
const {binaryLength,exactLengthScale}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);

test('exact length scales have defined empty and zero behavior and reject invalid inputs',()=>{
 for(const values of[[],[0],[-0,0]]){
  const s=exactLengthScale(values);
  assert.equal(s.units(0),0n);assert.equal(s.units(-0),0n);assert.deepEqual(s.chunks(0n),[]);assert.equal(s.number(0n),0);
 }
 for(const x of[-1,NaN,Infinity,-Infinity]){
  assert.throws(()=>binaryLength(x),/Invalid exact length/);
  assert.throws(()=>exactLengthScale([x]),/Invalid exact length/);
  assert.throws(()=>exactLengthScale([1]).units(x),/Invalid exact length/);
 }
 assert.throws(()=>exactLengthScale([1]).chunks(-1n),/Negative exact length/);
 assert.throws(()=>exactLengthScale([1]).units(2**-60),/below the declared exact scale/);
});

test('binary lengths preserve subnormal, power-of-two and noninteger represented values',()=>{
 assert.deepEqual(binaryLength(Number.MIN_VALUE),{mantissa:1n,exponent:-1074});
 assert.deepEqual(binaryLength(1),{mantissa:1n<<52n,exponent:-52});
 assert.deepEqual(binaryLength(1.5),{mantissa:3n<<51n,exponent:-52});
 const values=[Number.MIN_VALUE,2**-60,2**-40,.1,10,20,40,2**60];
 const s=exactLengthScale(values);
 for(const x of values){const u=s.units(x),parts=s.chunks(u);assert(parts.every(p=>p>0&&Number.isFinite(p)));assert.equal(parts.reduce((n,p)=>n+s.units(p),0n),u);assert.equal(s.number(u),x);}
});

test('positive exact differences stay as multiple finite chunks instead of rounding away a residual',()=>{
 for(const h of[40,20,10])for(const tiny of[2**-40,2**-60,Number.MIN_VALUE]){
  const s=exactLengthScale([h,tiny]),sum=s.units(h)+s.units(tiny),difference=s.units(h)-s.units(tiny);
  for(const u of[sum,difference]){const chunks=s.chunks(u);assert(chunks.length>=1);if(tiny<=2**-60)assert(chunks.length>=2);assert(chunks.every(x=>x>0));assert.equal(chunks.reduce((n,x)=>n+s.units(x),0n),u);}
  // This projection deliberately remains a Number; exact ownership uses units.
  assert.equal(s.number(sum),h+tiny);
 }
});
