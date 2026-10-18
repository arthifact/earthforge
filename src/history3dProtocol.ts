import type {DisplayVolume,VolumeGrid} from './volumeMath';
export interface History3dOptions {
 seed:number;steps:number;faults:number;setting:'extension'|'compression';compaction:boolean;exhumation:boolean;overpressure:boolean;materialStep:number;geology?:'classic'|'detailed';
}
export interface HistorySlice {y:number;x0:number;x1:number;z0:number;z1:number;nx:number;nz:number;velocity:number[];beds:number[];lithology:number[];surface:number[];basement:number[]}
export interface History3dResult {
 engine:string;dimensions:3;model:string;boundary:string;accounting:string;stage:number;stages:number[];eventsApplied:number;eventNames:string[];options:History3dOptions;
 bounds:{min:{x:number;y:number;z:number};max:{x:number;y:number;z:number}};
 slices:HistorySlice[];projection:DisplayVolume;sourceModel:unknown;beds:{unit:number;phase:string;carbonate:boolean}[];
 stats:{uniqueRays:number;retainedProfileLayers:number;authoritativeVoxels:number;evaluation:{evaluatedProfiles:number;cacheHits:number;localEventsChecked:number;maxNormalizedGrainResidual:number;compactionLayers:number;porosityEvaluations:number}};
}
export type Detail='preview'|'standard'|'detail';
export interface History3dRequest {kind?:'block';id:number;options:History3dOptions;stage?:number;detail:Detail;depth?:number}
export interface BlockQuery {sectionsY:number[];grid:VolumeGrid;includeMaterial:true}
export function blockQuery(detail:Detail,depth=3000):BlockQuery {const n=detail==='detail'?65:detail==='standard'?49:33,nz=detail==='detail'?481:detail==='standard'?241:161;return{sectionsY:[],includeMaterial:true,grid:{nx:n,ny:n,nz,dx:10000/(n-1),dy:10000/(n-1),dz:depth/(nz-1),origin:{x:0,y:0,z:0}}};}
export interface PreciseSection {axis:'x'|'y'|'z';position:number;nu:number;nv:number;velocity:Float32Array;beds:Int32Array;lithology:Float32Array;zMax:number}
export interface RefineRequest {kind:'plane';id:number;model:unknown;stage:number;axis:'x'|'y'|'z';position:number;depth:number;spacing?:10|20}
export type ViewerRequest=History3dRequest|RefineRequest;
export type History3dReply={kind:'block';id:number;ok:true;result:History3dResult;query:BlockQuery;elapsedMs:number;packingMs:number;displaySha256:string;cached:boolean;evaluations:number;cacheBytes:number}|{kind:'plane';id:number;ok:true;plane:PreciseSection;elapsedMs:number;cached:boolean;query:unknown}|{id:number;ok:false;message:string};
