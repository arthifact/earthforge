/** Display geometry only. Authoritative material laws stay in Rust. */
export type V3=[number,number,number];
export type Axis=0|1|2;
export interface VolumeGrid {nx:number;ny:number;nz:number;dx:number;dy:number;dz:number;origin:{x:number;y:number;z:number}}
export interface DisplayVolume {grid:VolumeGrid;velocity:Float32Array;beds:Int32Array;lithology:Float32Array;surface:Float32Array;basement:Float32Array}
export interface ViewState {azimuth:number;elevation:number;zoom:number;mode:'block'|'cutaway'|'sections';colour:'lithology'|'velocity'|'beds';clipX:number;clipY:number;peel:number;sections:V3;water:boolean;exaggeration:number}
export const DEFAULT_VIEW:ViewState={azimuth:40,elevation:29,zoom:1,mode:'block',colour:'lithology',clipX:1,clipY:1,peel:0,sections:[.55,.48,.48],water:false,exaggeration:1};
export const add=(a:V3,b:V3):V3=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
export const mul=(a:V3,s:number):V3=>[a[0]*s,a[1]*s,a[2]*s];
export const dot=(a:V3,b:V3)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export const norm=(v:V3):V3=>mul(v,1/Math.hypot(...v));
export const cross=(a:V3,b:V3):V3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const clamp=(x:number,lo=0,hi=1)=>Math.max(lo,Math.min(hi,x));
export function depthScale(v:DisplayVolume,s:ViewState){return (v.grid.nz-1)*v.grid.dz/((v.grid.nx-1)*v.grid.dx)*s.exaggeration;}
export function camera(v:DisplayVolume,s:ViewState){
 const az=s.azimuth*Math.PI/180,el=s.elevation*Math.PI/180,extent=depthScale(v,s),eye=mul([Math.cos(az)*Math.cos(el),Math.sin(az)*Math.cos(el),Math.sin(el)],2.05/s.zoom),forward=mul(norm(eye),-1),right=norm(cross(forward,[0,0,1])),up=cross(right,forward);
 const toTexture=(p:V3):V3=>[p[0]+.5,p[1]+.5,.5-p[2]/extent];
 const direction=(p:V3):V3=>[p[0],p[1],-p[2]/extent];
 return{eye,forward,right,up,extent,eyeTexture:toTexture(eye),direction,toTexture};
}
export function rayForPixel(v:DisplayVolume,s:ViewState,x:number,y:number,width:number,height:number){const c=camera(v,s),f=.38,dir=norm(add(c.forward,add(mul(c.right,(2*x/width-1)*width/height*f),mul(c.up,(1-2*y/height)*f))));return{origin:c.eyeTexture,direction:c.direction(dir)};}
export function project(v:DisplayVolume,s:ViewState,p:V3,w:number,h:number):[number,number,number]{const c=camera(v,s),world:V3=[p[0]-.5,p[1]-.5,(.5-p[2])*c.extent],d=add(world,mul(c.eye,-1)),z=dot(d,c.forward);return[w/2+dot(d,c.right)/z*h/(2*.38),h/2-dot(d,c.up)/z*h/(2*.38),z];}
export function sampleIndex(v:DisplayVolume,p:V3){const g=v.grid,i=Math.round(clamp(p[0])*(g.nx-1)),j=Math.round(clamp(p[1])*(g.ny-1)),k=Math.round(clamp(p[2])*(g.nz-1));return(k*g.ny+j)*g.nx+i;}
export function boxes(s:ViewState):{lo:V3;hi:V3}[]{const lo:V3=[0,0,s.peel],hi:V3=[s.clipX,s.clipY,1];return s.mode==='cutaway'?[{lo,hi:[Math.min(s.sections[0],hi[0]),hi[1],1]},{lo:[Math.min(s.sections[0],hi[0]),0,s.peel],hi:[hi[0],Math.min(s.sections[1],hi[1]),1]}]:[{lo,hi}];}
export function boxIntersection(o:V3,d:V3,lo:V3,hi:V3){let near=0,far=Infinity,axis:Axis=0;for(let i=0;i<3;i++){if(hi[i]<=lo[i])return null;if(Math.abs(d[i])<1e-14){if(o[i]<lo[i]||o[i]>hi[i])return null;continue;}const a=(lo[i]-o[i])/d[i],b=(hi[i]-o[i])/d[i];if(Math.min(a,b)>near){near=Math.min(a,b);axis=i as Axis;}far=Math.min(far,Math.max(a,b));if(far<near)return null;}return{near,far,axis};}
export interface Hit {point:V3;index:number;distance:number;axis:Axis}
/** Nearest-node volume traversal, including explicit water. No interpolated beds. */
export function traceVolume(v:DisplayVolume,s:ViewState,o:V3,d:V3):Hit|null{
 let best:Hit|null=null;
 if(s.mode==='sections'){
  for(let a=0;a<3;a++){if(Math.abs(d[a])<1e-14)continue;const t=(s.sections[a]-o[a])/d[a];const p=add(o,mul(d,t));if(t<0||p.some((x,i)=>x<0||x>1||i===2&&x<s.peel))continue;const index=sampleIndex(v,p);if(!s.water&&v.beds[index]===-1)continue;if(!best||t<best.distance)best={point:p,index,distance:t,axis:a as Axis};}return best;
 }
 const sizes=[v.grid.nx,v.grid.ny,v.grid.nz];
 for(const b of boxes(s)){const hit=boxIntersection(o,d,b.lo,b.hi);if(!hit)continue;let t=hit.near+1e-7,axis=hit.axis;
  for(let step=0;step<2048&&t<=hit.far;step++){
   const point=add(o,mul(d,t)),index=sampleIndex(v,point);if(s.water||v.beds[index]!==-1){if(!best||t<best.distance)best={point,index,distance:t,axis};break;}
   let next=Infinity,nextAxis:Axis=0;
   for(let a=0;a<3;a++){if(Math.abs(d[a])<1e-14)continue;const cell=Math.round(clamp(point[a])*(sizes[a]-1)),edge=(cell+(d[a]>0?.5:-.5))/(sizes[a]-1),at=(edge-o[a])/d[a];if(at>t+1e-9&&at<next){next=at;nextAxis=a as Axis;}}
   t=next+1e-7;axis=nextAxis;
  }
 }
 return best;
}
export function colourAt(v:DisplayVolume,index:number,mode:ViewState['colour']):[number,number,number,number]{const bed=v.beds[index],l=v.lithology[index];if(bed===-1)return[196,215,223,255];if(bed===-2)return[108,112,105,255];if(mode==='velocity'){const t=clamp((v.velocity[index]-1500)/4100);return[Math.round(34+188*t),Math.round(70+125*t),Math.round(109-31*t),255];}if(l===-3)return[179,151,190,255];const f=clamp(l),t=mode==='beds'?.86+((bed*37)%17)/60:1;return[Math.round((116+96*f)*t),Math.round((137+44*f)*t),Math.round((155-36*f)*t),255];}
export function sectionCanvas(v:DisplayVolume,axis:Axis,position:number,mode:ViewState['colour'],water=true):HTMLCanvasElement{
 const g=v.grid,w=axis===0?g.ny:g.nx,h=axis===2?g.ny:g.nz,c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d')!,img=ctx.createImageData(w,h);
 for(let j=0;j<h;j++)for(let i=0;i<w;i++){const p:V3=axis===0?[position,i/(w-1),j/(h-1)]:axis===1?[i/(w-1),position,j/(h-1)]:[i/(w-1),j/(h-1),position];const k=sampleIndex(v,p),rgba=colourAt(v,k,mode);if(!water&&v.beds[k]===-1)rgba[3]=0;img.data.set(rgba,4*(j*w+i));}ctx.putImageData(img,0,0);return c;
}
