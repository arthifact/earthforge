import {rustRequest} from './rustEngine';
import {blockQuery,type ViewerRequest,type History3dReply,type History3dResult,type BlockQuery,type PreciseSection} from './history3dProtocol';
import type {DisplayVolume} from './volumeMath';
interface Cached {result:History3dResult;query:BlockQuery;elapsedMs:number;packingMs:number;bytes:number;displaySha256:string}
// Only completed, reproducible queries are cached. Camera and clipping never
// enter this worker. Bound cache by both bytes and entry count.
const post=(message:History3dReply,transfer:Transferable[]=[]) => (self as unknown as {postMessage:(m:History3dReply,t:Transferable[])=>void}).postMessage(message,transfer);
const replay=new Map<string,Cached>();let bytes=0,evaluations=0;
function cloneVolume(v:DisplayVolume):DisplayVolume{return{grid:v.grid,velocity:v.velocity.slice(),beds:v.beds.slice(),lithology:v.lithology.slice(),surface:v.surface.slice(),basement:v.basement.slice()};}
let lastPlane:{key:string;plane:PreciseSection;elapsedMs:number;query:unknown}|undefined;
self.onmessage=async(event:MessageEvent<ViewerRequest>)=>{
 const r=event.data;
 if(r.kind==='plane'){
  try{
   const key=JSON.stringify([r.model,r.stage,r.axis,r.position,r.depth]);let value=lastPlane;const cached=value?.key===key;
   if(!cached){const query={sectionsY:[],stage:r.stage,zMax:r.depth,planes:[{axis:r.axis,position:r.position,nu:r.axis==='z'?65:501,nv:r.axis==='z'?65:Math.ceil(r.depth/10)+1}]};const start=performance.now();const raw=await rustRequest<{planes:PreciseSection[]}>({kind:'history3d',model:r.model,query});const p=raw.planes[0];value={key,query,elapsedMs:performance.now()-start,plane:{...p,velocity:new Float32Array(p.velocity),beds:new Int32Array(p.beds),lithology:new Float32Array(p.lithology)}};lastPlane=value;}
   const p=value!.plane,plane={...p,velocity:p.velocity.slice(),beds:p.beds.slice(),lithology:p.lithology.slice()};post({id:r.id,kind:'plane',ok:true,plane,elapsedMs:value!.elapsedMs,cached,query:value!.query},[plane.velocity,plane.beds,plane.lithology].map(a=>a.buffer as ArrayBuffer));
  }catch(error){post({id:r.id,ok:false,message:(error as Error).message});}return;
 }
 const key=JSON.stringify([r.options,r.stage??r.options.steps,r.detail,r.depth??3000]);
 try{
  let value=replay.get(key);const cached=Boolean(value);
  if(!value){
   const start=performance.now(),query=blockQuery(r.detail,r.depth),result=await rustRequest<History3dResult>({kind:'history3d',options:r.options,includeModel:true,query:{...query,stage:r.stage}});
   const elapsedMs=performance.now()-start,packing=performance.now(),p=result.projection;
   if(!p||!p.lithology||!p.surface)throw Error('The engine did not return the full material volume. Rebuild the Rust browser modules.');
   const volume:DisplayVolume={grid:p.grid,velocity:new Float32Array(p.velocity),beds:new Int32Array(p.beds),lithology:new Float32Array(p.lithology),surface:new Float32Array(p.surface),basement:new Float32Array(p.basement)};
   result.projection=volume;const size=[volume.velocity,volume.beds,volume.lithology,volume.surface,volume.basement].reduce((n,a)=>n+a.byteLength,0);
   const payload=new Uint8Array(size);let offset=0;for(const array of [volume.velocity,volume.beds,volume.lithology,volume.surface,volume.basement]){payload.set(new Uint8Array(array.buffer,array.byteOffset,array.byteLength),offset);offset+=array.byteLength;}
   const digest=await crypto.subtle.digest('SHA-256',payload);const displaySha256=[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
   value={result,query,elapsedMs,packingMs:performance.now()-packing,bytes:size,displaySha256};evaluations++;
   while(replay.size&&(bytes+size>32*1024*1024||replay.size>=3)){const oldest=replay.keys().next().value!;bytes-=replay.get(oldest)!.bytes;replay.delete(oldest);}
   if(size<=32*1024*1024){replay.set(key,value);bytes+=size;}
  }else{replay.delete(key);replay.set(key,value);}
  // Transfer display buffers while retaining the bounded cache. f32 here is a
  // display encoding only; the exported model/query reproduces the f64 solve.
  const projection=cloneVolume(value.result.projection),reply:History3dReply={kind:'block',id:r.id,ok:true,result:{...value.result,projection},query:value.query,elapsedMs:value.elapsedMs,packingMs:value.packingMs,displaySha256:value.displaySha256,cached,evaluations,cacheBytes:bytes};
  post(reply,[projection.velocity,projection.beds,projection.lithology,projection.surface,projection.basement].map(a=>a.buffer as ArrayBuffer));
 }catch(error){post({id:r.id,ok:false,message:(error as Error).message});}
};
