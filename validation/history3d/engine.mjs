import {readFileSync} from 'node:fs';
export async function wasmEngine(path){
 const setup=performance.now();const {instance}=await WebAssembly.instantiate(readFileSync(path),{math:{exp:Math.exp,expm1:Math.expm1,tanh:Math.tanh,sin:Math.sin,tan:Math.tan,cbrt:Math.cbrt}});
 const e=instance.exports,encoder=new TextEncoder(),decoder=new TextDecoder();
 return {setupMs:performance.now()-setup,memory:()=>e.memory.buffer.byteLength,run(request){const bytes=encoder.encode(JSON.stringify(request)),ptr=e.earthforge_alloc(bytes.length);if(!ptr)throw Error('Allocation failed');let result;try{new Uint8Array(e.memory.buffer,ptr,bytes.length).set(bytes);const size=e.earthforge_run(ptr,bytes.length);result=JSON.parse(decoder.decode(new Uint8Array(e.memory.buffer,e.earthforge_result_ptr(),size)));}finally{e.earthforge_free(ptr,bytes.length);e.earthforge_result_free();}if(!result.ok)throw Error(result.error);return result.value;}};
}
