// Browser workers run the Rust core; TypeScript owns messages and transferred frames.
import { verify } from './basinVerify';
import { simulateRust, simulateRustBasin } from './rustEngine';
import type { Frame, Reply, Request } from './protocol';
const post = (reply:Reply, transfer:Transferable[] = []) => (self as unknown as Worker).postMessage(reply, transfer);
const buffers = (f:Frame) => [f.velocity.buffer, f.beds.buffer, f.litho.buffer];
self.onmessage = async (event:MessageEvent<Request>) => {
 const r = event.data;
 try {
  if (r.kind === 'section') {
   const section = await simulateRust(r.options, r.history);
   const frames = section.history; section.history = [];
   if (!r.history) { post({id:r.id,kind:'section',section}, [...buffers(section.now),section.unitOfBed.buffer]); return; }
   post({id:r.id,kind:'preview',section}, [...buffers(section.now),section.unitOfBed.buffer]);
   post({id:r.id,kind:'history',frames}, frames.flatMap(buffers));
  } else {
   const result = await verify(r.options,r.first,r.count,text=>post({id:r.id,kind:'progress',text}),simulateRustBasin);
   post({id:r.id,kind:'verify',result});
  }
 } catch (error) { post({id:r.id,kind:'error',message:(error as Error).message}); }
};
