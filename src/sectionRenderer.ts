import {colourAt,clamp,type DisplayVolume,type ViewState} from './volumeMath';
import {sectionIndex,sectionPoint,type SectionData} from './workspaceSection';
export interface SectionLayout {x:number;y:number;width:number;height:number}
export function paintWorkspaceSection(canvas:HTMLCanvasElement,s:SectionData,colour:ViewState['colour'],exaggeration:number):SectionLayout {
 const rect=canvas.getBoundingClientRect(),w=Math.max(1,rect.width),h=Math.max(1,rect.height),dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);const ctx=canvas.getContext('2d')!;ctx.scale(dpr,dpr);ctx.fillStyle='#faf9f6';ctx.fillRect(0,0,w,h);
 const left=w<450?36:46,right=16,top=27,bottom=38,availableW=Math.max(1,w-left-right),availableH=Math.max(1,h-top-bottom),ratio=s.uSize/(s.vSize*(s.axis===2?1:exaggeration)),width=Math.min(availableW,availableH*ratio),height=width/ratio,x=left+(availableW-width)/2,y=top+(availableH-height)/2;
 const bitmap=document.createElement('canvas');bitmap.width=s.nu;bitmap.height=s.nv;const bctx=bitmap.getContext('2d')!,image=bctx.createImageData(s.nu,s.nv),v=s as unknown as DisplayVolume;for(let i=0;i<s.beds.length;i++)image.data.set(colourAt(v,i,colour),i*4);bctx.putImageData(image,0,0);ctx.imageSmoothingEnabled=false;ctx.drawImage(bitmap,x,y,width,height);ctx.strokeStyle='#64675e77';ctx.lineWidth=.7;ctx.strokeRect(x,y,width,height);
 ctx.font='10px ui-monospace,monospace';ctx.fillStyle='#64675e';ctx.textAlign='center';for(let i=0;i<=5;i++){const t=i/5,px=x+t*width;ctx.beginPath();ctx.moveTo(px,y+height);ctx.lineTo(px,y+height+4);ctx.stroke();ctx.fillText(((s.u0+t*s.uSize)/1000).toFixed(1),px,y+height+16);}
 ctx.textAlign='right';for(let i=0;i<=3;i++){const t=i/3,py=y+t*height;ctx.beginPath();ctx.moveTo(x-4,py);ctx.lineTo(x,py);ctx.stroke();ctx.fillText(((s.v0+t*s.vSize)/1000).toFixed(1),x-7,py+3);}
 ctx.textAlign='left';ctx.fillText(`${['X','Y','Depth'][s.axis]} = ${(s.position/1000).toFixed(2)} km · ${s.refined?'continuous model':'block preview'}`,x,Math.max(12,y-11));ctx.textAlign='center';ctx.fillText(`${s.axis===0?'Y':'X'} distance · km`,x+width/2,y+height+31);ctx.save();ctx.translate(Math.max(10,x-33),y+height/2);ctx.rotate(-Math.PI/2);ctx.fillText(s.axis===2?'Y distance · km':'Depth · km',0,0);ctx.restore();
 return{x,y,width,height};
}
export function sectionReadout(s:SectionData,layout:SectionLayout,x:number,y:number):string|undefined {
 const u=(x-layout.x)/layout.width,v=(y-layout.y)/layout.height;if(u<0||u>1||v<0||v>1)return;const index=sectionIndex(s,clamp(u),clamp(v)),p=sectionPoint(s,u,v),b=s.beds[index];return`X ${(p[0]/1000).toFixed(2)} km · Y ${(p[1]/1000).toFixed(2)} km · depth ${(p[2]/1000).toFixed(2)} km · ${b===-1?'water':b===-2?'basement':`bed ${b+1}`} · ${(s.velocity[index]/1000).toFixed(2)} km/s · ${s.refined?'continuous section':'block preview'}`;
}
