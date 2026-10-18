// Coarse WebAssembly boundary: one request runs all numerical work in Rust.
// Typed arrays are copied out before another call can grow or reuse Wasm memory.
import type { BasinOptions } from './basin';
import type { Frame, Section } from './protocol';
interface Exports extends WebAssembly.Exports {
 memory: WebAssembly.Memory;
 earthforge_alloc(length: number): number;
 earthforge_free(pointer: number, length: number): void;
 earthforge_run(pointer: number, length: number): number;
 earthforge_result_ptr(): number;
 earthforge_result_free(): void;
}
interface WireFrame { nx:number; nz:number; velocity:number[]; beds:number[]; litho:number[]; faults:Frame['faults'] }
interface WireSection extends Omit<Section, 'now' | 'history' | 'unitOfBed'> { unitOfBed:number[]; now:WireFrame; history:WireFrame[] }
const encoder = new TextEncoder(), decoder = new TextDecoder();
const loading = new Map<boolean, Promise<Exports>>();
async function load(deterministic: boolean): Promise<Exports> {
 let pending = loading.get(deterministic);
 if (!pending) {
  pending = (async () => {
   const errors: unknown[] = [];
   // Compile the SIMD module when supported. Older browsers and incomplete
   // local builds can use the portable module through the same request ABI.
   const prefix = deterministic ? 'earthforge_core_deterministic' : 'earthforge_core';
   for (const filename of [`${prefix}_simd.wasm`, `${prefix}.wasm`]) {
    try {
     const response = await fetch(`${import.meta.env?.BASE_URL ?? '/'}rust/${filename}`);
     if (!response.ok) throw Error(`${filename}: HTTP ${response.status}`);
     const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), {math:{exp:Math.exp,expm1:Math.expm1,tanh:Math.tanh,sin:Math.sin,tan:Math.tan,cbrt:Math.cbrt}});
     return instance.exports as Exports;
    } catch (error: unknown) { errors.push(error); }
   }
   throw new AggregateError(errors, 'Could not load simulation engine. Run npm run build:rust.');
  })().catch((error: unknown) => { loading.delete(deterministic); throw error; });
 loading.set(deterministic, pending);
 }
 return pending;
}
export async function rustRequest<T>(request:unknown, options:{preview?:boolean} = {}):Promise<T> {
 // Research calls share native scalar arithmetic. Only routine page previews
 // opt into the faster host primitives; no material state crosses that boundary.
 const core = await load(options.preview !== true), bytes = encoder.encode(JSON.stringify(request));
 const pointer = core.earthforge_alloc(bytes.length);
 if (!pointer) throw Error('Simulation request exceeds engine memory limit');
 let result: {ok:true; value:T} | {ok:false; error:string};
 try {
  new Uint8Array(core.memory.buffer, pointer, bytes.length).set(bytes);
  const length = core.earthforge_run(pointer, bytes.length);
  result = JSON.parse(decoder.decode(new Uint8Array(core.memory.buffer, core.earthforge_result_ptr(), length))) as typeof result;
 } finally { core.earthforge_free(pointer, bytes.length); core.earthforge_result_free(); }
 if (!result.ok) throw Error(result.error);
 return result.value;
}
const frame = (f:WireFrame):Frame => ({...f, velocity:Float32Array.from(f.velocity), beds:Int32Array.from(f.beds), litho:Float32Array.from(f.litho)});
export async function simulateRust(options:BasinOptions, history:boolean):Promise<Section> {
 const start = performance.now();
 const section = await rustRequest<WireSection>({kind:'section', options:{...options, record:history}}, {preview:true});
 return {...section, unitOfBed:Int32Array.from(section.unitOfBed), now:frame(section.now), history:section.history.map(frame), checks:{...section.checks, seconds:(performance.now()-start)/1000}};
}

// Full material diagnostics are requested only by Checks and numerical studies.
// Normal viewing crosses the boundary using compact section frames above.
export async function simulateRustBasin(options:BasinOptions):Promise<import('./basin').Basin> {
 const raw = await rustRequest<Record<string, unknown>>({kind:'basin', options:{...options, record:false}});
 return decodeRustBasin(raw);
}
export function decodeRustBasin(raw:Record<string, unknown>):import('./basin').Basin {
 type Basin = import('./basin').Basin;
 const faults = raw.faults as (Omit<Basin['faults'][number], 'depth'> & {depth:(number|null)[]})[];
 for (const fault of faults) {
  if (!fault.trace) delete fault.trace;
  if (!fault.thrust) delete fault.thrust;
  else if (!fault.thrust.points) delete fault.thrust.points;
 }
 const view = raw.view as {velocity:number[]; beds:number[]; sandFraction:number[]; nx:number; nz:number; floor:number[]};
 return {...raw,
  grid:Int32Array.from(raw.grid as number[]), solid:Float64Array.from(raw.solid as number[]),
  sandFraction:Float64Array.from(raw.sandFraction as number[]), burial:Float32Array.from(raw.burial as number[]), effectiveBurial:Float32Array.from(raw.effectiveBurial as number[]), pre:Int32Array.from(raw.pre as number[]),
  faults:faults.map(f=>({...f,depth:Float64Array.from(f.depth.map(z=>z??NaN))})),
  view:{...view,velocity:Float32Array.from(view.velocity),beds:Int32Array.from(view.beds),sandFraction:Float32Array.from(view.sandFraction),floor:Float64Array.from(view.floor)},
 } as unknown as Basin;
}
