/** Coordinates and material ownership for a section of the shared 3D model. */
import {type Axis,type DisplayVolume,type V3,sampleIndex,clamp} from './volumeMath';
import type {PreciseSection} from './history3dProtocol';
export interface SectionData {axis:Axis;position:number;nu:number;nv:number;u0:number;v0:number;uSize:number;vSize:number;velocity:Float32Array;beds:Int32Array;lithology:Float32Array;refined:boolean}
export function sectionPosition(v:DisplayVolume,axis:Axis,fraction:number){const g=v.grid;return[g.origin.x,g.origin.y,g.origin.z][axis]+clamp(fraction)*[g.dx*(g.nx-1),g.dy*(g.ny-1),g.dz*(g.nz-1)][axis];}
export function sectionPoint(s:SectionData,u:number,v:number):V3 {const a=s.u0+clamp(u)*s.uSize,b=s.v0+clamp(v)*s.vSize;return s.axis===0?[s.position,a,b]:s.axis===1?[a,s.position,b]:[a,b,s.position];}
export function sectionIndex(s:SectionData,u:number,v:number){return Math.round(clamp(v)*(s.nv-1))*s.nu+Math.round(clamp(u)*(s.nu-1));}
export function sectionFromVolume(volume:DisplayVolume,axis:Axis,fraction:number,plane?:PreciseSection):SectionData {
 const g=volume.grid,position=sectionPosition(volume,axis,fraction),precise=plane&&plane.axis===['x','y','z'][axis]&&Math.abs(plane.position-position)<1e-6;
 const nu=precise?plane.nu:axis===0?g.ny:g.nx,nv=precise?plane.nv:axis===2?g.ny:g.nz;
 const meta={axis,position,nu,nv,u0:axis===0?g.origin.y:g.origin.x,v0:axis===2?g.origin.y:g.origin.z,uSize:axis===0?(g.ny-1)*g.dy:(g.nx-1)*g.dx,vSize:axis===2?(g.ny-1)*g.dy:(g.nz-1)*g.dz,refined:Boolean(precise)};
 if(precise)return{...meta,velocity:plane.velocity,beds:plane.beds,lithology:plane.lithology};
 const velocity=new Float32Array(nu*nv),beds=new Int32Array(nu*nv),lithology=new Float32Array(nu*nv);
 for(let j=0;j<nv;j++)for(let i=0;i<nu;i++){const p:V3=axis===0?[fraction,i/(nu-1),j/(nv-1)]:axis===1?[i/(nu-1),fraction,j/(nv-1)]:[i/(nu-1),j/(nv-1),fraction],k=sampleIndex(volume,p),n=j*nu+i;velocity[n]=volume.velocity[k];beds[n]=volume.beds[k];lithology[n]=volume.lithology[k];}
 return{...meta,velocity,beds,lithology};
}
