import type {SourceModel3d} from './history3dProtocol';
export interface Observation {id:string;kind:'velocity'|'horizon'|'surface'|'basement';x:number;y:number;z?:number;value:number;sigma:number;bed?:number;unit?:number;side?:'top'|'bottom';occurrence?:number}
export interface Prediction {id:string;kind:Observation['kind'];prediction:number|number[];value:number;sigma:number;logLikelihood:number|null;interpretation:string}
export interface CandidateScore {status:'compatible'|'incompatible';logLikelihood:number|null;predictions:Prediction[];reason?:string;stats?:unknown}
export interface ConditionedCandidate {id:string;stage:number;parameters:{slipScale:number;subsidenceScale:number;curveStrength:number|null};score:CandidateScore;weight:number;model:SourceModel3d}
export interface ConditioningResult {schema:'earthforge-conditioning-v2';status:'weighted'|'no-compatible-candidates';observations:Observation[];scores:CandidateScore[];candidates:ConditionedCandidate[];weights:number[];effectiveSampleSize:number;positiveWeightCandidates:number;assumptions:string;interpretation?:string}
export interface LibraryRanges {slipScales:number[];subsidenceScales:number[];curveStrengths?:number[]}
export interface ConditioningContext {model:SourceModel3d;stage:number;seed:number;scenario:string}
export type ConditioningRequest={kind:'condition';id:number;context:ConditioningContext;observations:Observation[];library:LibraryRanges}|{kind:'demo';id:number;context:ConditioningContext};
export type ConditioningReply={ok:true;kind:'condition';id:number;result:ConditioningResult;elapsedMs:number}|{ok:true;kind:'demo';id:number;observations:Observation[];elapsedMs:number}|{ok:false;id:number;message:string};
export interface ConditioningStudy {schema:'earthforge-browser-conditioning-v1';createdAt:string;context:ConditioningContext;library:LibraryRanges;result:ConditioningResult;elapsedMs:number;scope:string;observationSource:string;selectedCandidateId?:string}
