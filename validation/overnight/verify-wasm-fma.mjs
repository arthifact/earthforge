/** Compile the exact production FMA source into tiny scalar/SIMD verifiers. */
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const folder=mkdtempSync(join(tmpdir(),'earthforge-fma-verify-'));
const source=resolve('validation/overnight/experiments/portable_fma.rs');
const helper=`#[path=${JSON.stringify(source)}]mod portable_fma;\n#[unsafe(no_mangle)]pub extern "C" fn candidate(a:f64,b:f64,c:f64)->f64{portable_fma::fma(a,b,c)}\n#[unsafe(no_mangle)]pub extern "C" fn baseline(a:f64,b:f64,c:f64)->f64{a.mul_add(b,c)}\n`;
writeFileSync(join(folder,'helper.rs'),helper);
let state=0x71a38e2f;const random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;};
const view=new DataView(new ArrayBuffer(24));
function value(wide){const lo=random(),raw=random(),hi=wide?raw:((raw&0x800fffff)|((823+random()%401)<<20))>>>0;view.setUint32(0,lo,true);view.setUint32(4,hi,true);return view.getFloat64(0,true);}
const cases=Array.from({length:220000},(_,i)=>{const wide=i>=200000,a=value(wide),b=value(wide);let c=value(wide);if(!wide&&i%7===0)c=-(a*b);return[a,b,c];});
const bits=x=>{view.setFloat64(0,x,true);return view.getBigUint64(0,true)};
const rows=[];
try{
 for(const simd of [false,true]){
  const output=join(folder,simd?'simd.wasm':'scalar.wasm');
  const flags=['--edition=2024','--crate-name','fma_verify','--crate-type=cdylib','--target=wasm32-unknown-unknown','-C','opt-level=3','-C','lto=thin','-C','codegen-units=1','-C','overflow-checks=yes',...(simd?['-C','target-feature=+simd128']:[]),join(folder,'helper.rs'),'-o',output];
  const build=spawnSync('rustc',flags,{encoding:'utf8'});assert.equal(build.status,0,build.stderr);
  const bytes=readFileSync(output),wasm=(await WebAssembly.instantiate(bytes,{})).instance.exports;
  for(let i=0;i<cases.length;i++){const[a,b,c]=cases[i],actual=wasm.candidate(a,b,c),expected=wasm.baseline(a,b,c);assert.ok(Number.isNaN(actual)&&Number.isNaN(expected)||bits(actual)===bits(expected),`FMA ${simd}/${i}: ${a},${b},${c}`);}
  rows.push({simd,cases:cases.length,bitIdentical:true,verifierSha256:createHash('sha256').update(bytes).digest('hex')});console.log(JSON.stringify(rows.at(-1)));
 }
 writeFileSync('validation/overnight/portable-fma-wasm-validation.json',JSON.stringify({runtime:process.version,sourceSha256:createHash('sha256').update(readFileSync(source)).digest('hex'),method:'Exact production source compiled with scalar and SIMD Wasm flags;220000 bounded/wide/cancellation triples each, compared with independent standard-library fused arithmetic (integer/software implementation). Native unit tests separately compare2.2million triples with hardware FMA. NaNs compared as NaNs; every finite/infinite/signed-zero result must match complete bits.',passed:true,rows},null,2)+'\n');
}finally{rmSync(folder,{recursive:true,force:true});}
