import {rustRequest} from './rustEngine';
import type {ConditioningRequest,ConditioningReply,ConditioningResult,Observation} from './conditioningProtocol';
const post=(reply:ConditioningReply)=>(self as unknown as {postMessage:(reply:ConditioningReply)=>void}).postMessage(reply);
self.onmessage=async(event:MessageEvent<ConditioningRequest>)=>{const r=event.data,start=performance.now();try{
 if(r.kind==='condition'){
  if(!Array.isArray(r.observations)||r.observations.length>128)throw Error('The browser supports up to 128 observations per study. Use Python for larger studies.');
  const result=await rustRequest<ConditioningResult>({kind:'condition',baseModel:r.context.model,stage:r.context.stage,library:r.library,observations:r.observations,includeModels:true});
  post({ok:true,kind:'condition',id:r.id,result,elapsedMs:performance.now()-start});
 }else{
  const model=r.context.model,stage=r.context.stage,locations=[[3500,4200],[6500,5800]],units=[...new Set(model.beds.map(b=>b.unit))].filter(u=>u<stage),unit=units[Math.floor(units.length/2)]??0;
  const rays=await rustRequest<{rays:{surface:number;basement:number}[];horizons:{contacts:number[][]}[]}>({kind:'history3d',model,query:{stage,sectionsY:[],rays:locations,horizons:locations.map(([x,y])=>({x,y,unit}))}});
  const points=locations.map(([x,y],i)=>({x,y,z:Math.max(model.bounds.min.z,Math.min(model.bounds.max.z,rays.rays[i].surface+.55*(rays.rays[i].basement-rays.rays[i].surface)))}));
  const raw=await rustRequest<{points:{velocity:number}[]}>({kind:'history3d',model,query:{stage,sectionsY:[],points}});
  const observations:Observation[]=points.map((p,i)=>({id:`synthetic-well-${i+1}`,kind:'velocity',...p,value:raw.points[i].velocity,sigma:100}));
  for(const [i,h]of rays.horizons.entries())if(h.contacts.length)observations.push({id:`synthetic-horizon-${i+1}`,kind:'horizon',x:locations[i][0],y:locations[i][1],unit,side:'top',occurrence:0,value:h.contacts[0][0],sigma:40});
  post({ok:true,kind:'demo',id:r.id,observations,elapsedMs:performance.now()-start});
 }
}catch(error){post({ok:false,id:r.id,message:(error as Error).message});}};
