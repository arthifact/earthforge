import type {SectionData} from './workspaceSection';
import {type DisplayVolume,type ViewState,type V3,type Axis,camera,rayForPixel,traceVolume,colourAt,project,boxes} from './volumeMath';
const vertex=`#version 300 es
in vec2 position;
out vec2 uv;
void main(){uv=position*.5+.5;gl_Position=vec4(position,0.,1.);}`;
const fragment=`#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 uv;
out vec4 outputColour;
uniform sampler3D material;
uniform sampler3D velocity;
uniform sampler2D sectionMaterial;
uniform sampler2D sectionVelocity;
uniform bool hasSection;
uniform int sectionAxis;
uniform float sectionAt;
uniform highp sampler2D surface;
uniform float depthMetres;
uniform vec3 size;
uniform vec3 eye;
uniform vec3 forward;
uniform vec3 right;
uniform vec3 up;
uniform vec2 viewport;
uniform float depthScale;
uniform vec3 clipHigh;
uniform float peel;
uniform vec3 sections;
uniform int mode;
uniform int colour;
uniform bool water;
vec3 origin(){return vec3(eye.xy+.5,.5-eye.z/depthScale);}
vec3 direction(){vec2 q=uv*2.-1.;vec3 d=normalize(forward+.38*(q.x*viewport.x/viewport.y*right+q.y*up));return vec3(d.xy,-d.z/depthScale);}
ivec3 cell(vec3 p){return ivec3(floor(clamp(p,0.,1.)*(size-1.)+.5));}
bool onSection(vec3 p){return hasSection&&abs(p[sectionAxis]-sectionAt)<.00002;}
ivec2 planeCell(vec3 p){vec2 uv=sectionAxis==0?p.yz:sectionAxis==1?p.xz:p.xy;return ivec2(floor(clamp(uv,0.,1.)*(vec2(textureSize(sectionMaterial,0))-1.)+.5));}
vec4 mat(vec3 p){return onSection(p)?texelFetch(sectionMaterial,planeCell(p),0):texelFetch(material,cell(p),0);}
float speed(vec3 p){return onSection(p)?texelFetch(sectionVelocity,planeCell(p),0).r:texelFetch(velocity,cell(p),0).r;}
int bed(vec4 m){return int(round(m.g*255.))+256*int(round(m.b*255.));}
vec4 intersectBox(vec3 o,vec3 d,vec3 lo,vec3 hi){
 float near=0.,far=1e20;int axis=0;
 for(int a=0;a<3;a++){if(hi[a]<=lo[a])return vec4(-1.);if(abs(d[a])<1e-10){if(o[a]<lo[a]||o[a]>hi[a])return vec4(-1.);}else{float t0=(lo[a]-o[a])/d[a],t1=(hi[a]-o[a])/d[a];if(min(t0,t1)>near){near=min(t0,t1);axis=a;}far=min(far,max(t0,t1));}}
 if(far<near)return vec4(-1.);
 float t=near+1e-6;
 for(int i=0;i<1024;i++){
  if(t>far)break;vec3 p=o+d*t;
  if(water||bed(mat(p))!=0){vec3 n=vec3(0.);n[axis]=-sign(d[axis]);return vec4(t,n);}
  vec3 edge=(vec3(cell(p))+mix(vec3(-.5),vec3(.5),step(vec3(0.),d)))/(size-1.);
  float next=1e20;int nextAxis=0;
  for(int a=0;a<3;a++){if(abs(d[a])>1e-10){float candidate=(edge[a]-o[a])/d[a];if(candidate>t+1e-8&&candidate<next){next=candidate;nextAxis=a;}}}
  t=next+1e-6;axis=nextAxis;
 }
 return vec4(-1.);
}
void main(){
 vec3 o=origin(),d=direction();vec4 hit=vec4(-1.);
 if(mode==2){for(int a=0;a<3;a++){if(abs(d[a])<1e-10)continue;float t=(sections[a]-o[a])/d[a];vec3 p=o+d*t;if(t<0.||any(lessThan(p,vec3(0.,0.,peel)))||any(greaterThan(p,clipHigh)))continue;if(!water&&bed(mat(p))==0)continue;if(hit.x<0.||t<hit.x){vec3 n=vec3(0.);n[a]=-sign(d[a]);hit=vec4(t,n);}}}
 else if(mode==1){vec3 hi=clipHigh;hi.x=min(hi.x,sections.x);hit=intersectBox(o,d,vec3(0.,0.,peel),hi);vec3 lo=vec3(hi.x,0.,peel);hi=clipHigh;hi.y=min(hi.y,sections.y);vec4 other=intersectBox(o,d,lo,hi);if(other.x>=0.&&(hit.x<0.||other.x<hit.x))hit=other;}
 else hit=intersectBox(o,d,vec3(0.,0.,peel),clipHigh);
 if(hit.x<0.){outputColour=vec4(vec3(.989,.985,.971)-.008*(1.-uv.y),1.);return;}
 vec3 p=o+d*hit.x;vec4 m=mat(p);int id=bed(m);vec3 c;
 if(id==0)c=vec3(.77,.84,.88);
 else if(id==1)c=vec3(.43,.45,.42);
 else if(colour==1){float t=clamp((speed(p)-1500.)/4100.,0.,1.);c=vec3(34.+188.*t,70.+125.*t,109.-31.*t)/255.;}
 else if(m.a>.5)c=vec3(.70,.59,.75);
 else{float f=m.r;c=vec3(116.+96.*f,137.+44.*f,155.-36.*f)/255.;if(colour==2)c*=.86+float(((id-2)*37)%17)/60.;}
 vec3 n=normalize(vec3(hit.yz,-hit.w/depthScale));
 ivec2 cxy=cell(p).xy;float top=texelFetch(surface,cxy,0).r;
 if(id>1&&abs(p.z*depthMetres-top)<2.*depthMetres/(size.z-1.)){
  ivec2 lo=max(ivec2(0),cxy-ivec2(1)),hi=min(ivec2(size.xy)-1,cxy+ivec2(1));
  float sx=(texelFetch(surface,ivec2(hi.x,cxy.y),0).r-texelFetch(surface,ivec2(lo.x,cxy.y),0).r)/depthMetres*depthScale/((float(hi.x-lo.x))/(size.x-1.));
  float sy=(texelFetch(surface,ivec2(cxy.x,hi.y),0).r-texelFetch(surface,ivec2(cxy.x,lo.y),0).r)/depthMetres*depthScale/((float(hi.y-lo.y))/(size.y-1.));
  n=normalize(vec3(sx,sy,1.));
 }
 float light=.74+.26*max(0.,dot(n,normalize(vec3(.4,-.5,1.))));
 outputColour=vec4(c*light,1.);
}`;
function materialBytes(v:Pick<DisplayVolume,'beds'|'lithology'>){const material=new Uint8Array(v.beds.length*4);for(let i=0;i<v.beds.length;i++){const b=v.beds[i]===-1?0:v.beds[i]===-2?1:v.beds[i]+2;material[i*4]=Math.round(Math.max(0,v.lithology[i])*255);material[i*4+1]=b&255;material[i*4+2]=b>>8;material[i*4+3]=v.lithology[i]===-3?255:0;}return material;}
interface TimerExtension {TIME_ELAPSED_EXT:number;GPU_DISJOINT_EXT:number}
export class VolumeRenderer {
 readonly canvas:HTMLCanvasElement;readonly overlay:HTMLCanvasElement;
 volume?:DisplayVolume;section?:SectionData;sectionAxis:Axis=1;kind='WebGL2';drawCount=0;lastSubmitMs=0;uploadMs=0;textureBytes=0;gpuSamples:number[]=[];
 private gl?:WebGL2RenderingContext;private program?:WebGLProgram;private textures:WebGLTexture[]=[];private locations=new Map<string,WebGLUniformLocation|null>();private timer?:TimerExtension;private queries:WebGLQuery[]=[];measureGPU=false;private failed=false;
 constructor(readonly container:HTMLElement,forceSoftware=false){
  this.canvas=document.createElement('canvas');this.canvas.id='scene';this.canvas.setAttribute('role','img');this.canvas.setAttribute('aria-label','Three-dimensional geological block');this.canvas.tabIndex=0;
  this.overlay=document.createElement('canvas');this.overlay.className='scene-overlay';this.overlay.setAttribute('aria-hidden','true');container.append(this.canvas,this.overlay);
  if(!forceSoftware){try{this.gl=this.canvas.getContext('webgl2',{alpha:false,antialias:false,preserveDrawingBuffer:true})??undefined;if(this.gl)this.initialize();}catch(error){console.warn('3D graphics initialization:',error);this.gl=undefined;this.failed=true;}}
  if(!this.gl){this.kind='Software';if(this.failed){const c=this.canvas.cloneNode() as HTMLCanvasElement;this.canvas.replaceWith(c);Object.defineProperty(this,'canvas',{value:c});this.failed=false;}}
  this.canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();this.failed=true;this.container.dispatchEvent(new CustomEvent('view-error',{detail:'Graphics context lost. Reload the page to restore the block.'}));});
 }
 private initialize(){const gl=this.gl!;const compile=(type:number,source:string)=>{const shader=gl.createShader(type)!;gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader)??'Shader compilation failed');return shader;};
  const program=gl.createProgram()!;gl.attachShader(program,compile(gl.VERTEX_SHADER,vertex));gl.attachShader(program,compile(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program)??'Shader linking failed');this.program=program;gl.useProgram(program);
  const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);const a=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);
  this.timer=gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExtension|undefined;
 }
 private location(name:string){if(!this.locations.has(name))this.locations.set(name,this.gl!.getUniformLocation(this.program!,name));return this.locations.get(name)!;}
 setVolume(v:DisplayVolume){this.volume=v;const start=performance.now();this.textureBytes=v.beds.length*8+v.surface.byteLength;
  if(this.gl){const gl=this.gl;if(Math.max(v.grid.nx,v.grid.ny,v.grid.nz)>gl.getParameter(gl.MAX_3D_TEXTURE_SIZE))throw Error('This display grid exceeds the graphics limit. Select Quick view detail.');for(const t of this.textures)gl.deleteTexture(t);this.textures=[];
   const material=materialBytes(v);
   for(const [i,data] of [material,v.velocity].entries()){const t=gl.createTexture()!;this.textures.push(t);gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_3D,t);gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);for(const a of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T,gl.TEXTURE_WRAP_R])gl.texParameteri(gl.TEXTURE_3D,a,gl.CLAMP_TO_EDGE);gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);gl.texImage3D(gl.TEXTURE_3D,0,i===0?gl.RGBA8:gl.R32F,v.grid.nx,v.grid.ny,v.grid.nz,0,i===0?gl.RGBA:gl.RED,i===0?gl.UNSIGNED_BYTE:gl.FLOAT,data);gl.uniform1i(this.location(i===0?'material':'velocity'),i);}
   const topTexture=gl.createTexture()!;this.textures.push(topTexture);gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,topTexture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.R32F,v.grid.nx,v.grid.ny,0,gl.RED,gl.FLOAT,v.surface);gl.uniform1i(this.location('surface'),2);gl.uniform1f(this.location('depthMetres'),(v.grid.nz-1)*v.grid.dz);
   this.setSection(undefined);
   const error=gl.getError();if(error!==gl.NO_ERROR)throw Error('The graphics device could not allocate this block. Select Quick view detail.');
  }else this.textureBytes=0;
  this.uploadMs=performance.now()-start;
 }
 /** Only a requested plane gets fine textures; the regional block stays bounded. */
 setSection(section?:SectionData){this.section=section;const v=this.volume;if(!v)return;this.textureBytes=this.gl?v.beds.length*8+v.surface.byteLength+(section?section.beds.length*8:0):0;
  if(!this.gl)return;const gl=this.gl;
  for(const [i,data] of [section?materialBytes(section):new Uint8Array(4),section?.velocity??new Float32Array(1)].entries()){
   const unit=i+3,t=this.textures[unit]??gl.createTexture()!;this.textures[unit]=t;gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);gl.texImage2D(gl.TEXTURE_2D,0,i===0?gl.RGBA8:gl.R32F,section?.nu??1,section?.nv??1,0,i===0?gl.RGBA:gl.RED,i===0?gl.UNSIGNED_BYTE:gl.FLOAT,data);gl.uniform1i(this.location(i===0?'sectionMaterial':'sectionVelocity'),unit);
  }
 }
 pollTimers(){const gl=this.gl;if(!gl||!this.timer)return;const disjoint=gl.getParameter(this.timer.GPU_DISJOINT_EXT);this.queries=this.queries.filter(q=>{if(!gl.getQueryParameter(q,gl.QUERY_RESULT_AVAILABLE))return true;if(!disjoint)this.gpuSamples.push(gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6);gl.deleteQuery(q);return false;});if(disjoint)this.gpuSamples=[];}
 render(s:ViewState,interacting=false){if(!this.volume||this.failed)return;const started=performance.now(),v=this.volume,rect=this.container.getBoundingClientRect(),w=Math.max(1,rect.width),h=Math.max(1,rect.height),dpr=Math.min(devicePixelRatio||1,interacting?1:1.5);
  const pixelW=Math.round(w*dpr),pixelH=Math.round(h*dpr);if(this.canvas.width!==pixelW||this.canvas.height!==pixelH){this.canvas.width=pixelW;this.canvas.height=pixelH;}if(this.overlay.width!==pixelW||this.overlay.height!==pixelH){this.overlay.width=pixelW;this.overlay.height=pixelH;}
  if(this.gl){const gl=this.gl,c=camera(v,s);gl.viewport(0,0,pixelW,pixelH);gl.useProgram(this.program!);const v3=(n:string,a:readonly number[])=>gl.uniform3f(this.location(n),a[0],a[1],a[2]);v3('size',[v.grid.nx,v.grid.ny,v.grid.nz]);v3('eye',c.eye);v3('forward',c.forward);v3('right',c.right);v3('up',c.up);v3('clipHigh',[s.clipX,s.clipY,1]);v3('sections',s.sections);gl.uniform2f(this.location('viewport'),pixelW,pixelH);gl.uniform1f(this.location('depthScale'),c.extent);gl.uniform1f(this.location('peel'),s.peel);gl.uniform1i(this.location('mode'),s.mode==='block'?0:s.mode==='cutaway'?1:2);gl.uniform1i(this.location('colour'),s.colour==='lithology'?0:s.colour==='velocity'?1:2);gl.uniform1i(this.location('water'),s.water?1:0);gl.uniform1i(this.location('hasSection'),this.section?1:0);gl.uniform1i(this.location('sectionAxis'),this.sectionAxis);gl.uniform1f(this.location('sectionAt'),s.sections[this.sectionAxis]);
   this.pollTimers();let q:WebGLQuery|null=null;if(this.measureGPU&&this.timer&&this.queries.length<8){q=gl.createQuery();gl.beginQuery(this.timer.TIME_ELAPSED_EXT,q);}gl.drawArrays(gl.TRIANGLES,0,3);if(q&&this.timer){gl.endQuery(this.timer.TIME_ELAPSED_EXT);this.queries.push(q);}
  }else{
   const pw=interacting?150:300,ph=Math.round(pw*h/w),bitmap=document.createElement('canvas');bitmap.width=pw;bitmap.height=ph;const ctx=bitmap.getContext('2d')!,image=ctx.createImageData(pw,ph);
   for(let y=0;y<ph;y++)for(let x=0;x<pw;x++){const ray=rayForPixel(v,s,x+.5,y+.5,pw,ph),hit=traceVolume(v,s,ray.origin,ray.direction),rgba=hit?colourAt(v,hit.index,s.colour):[252,251,247,255];if(hit){const shade=hit.axis===2?1:.8;rgba[0]*=shade;rgba[1]*=shade;rgba[2]*=shade;}image.data.set(rgba,4*(y*pw+x));}ctx.putImageData(image,0,0);const target=this.canvas.getContext('2d')!;target.imageSmoothingEnabled=true;target.drawImage(bitmap,0,0,pixelW,pixelH);
  }
  const ctx=this.overlay.getContext('2d')!;ctx.clearRect(0,0,pixelW,pixelH);ctx.save();ctx.scale(dpr,dpr);ctx.strokeStyle='#54665450';ctx.lineWidth=1;
  for(const b of boxes(s)){for(let axis=0;axis<3;axis++)for(let i=0;i<2;i++)for(let j=0;j<2;j++){const a:V3=[...b.lo],z:V3=[...b.lo],u=(axis+1)%3,k=(axis+2)%3;a[u]=z[u]=i?b.hi[u]:b.lo[u];a[k]=z[k]=j?b.hi[k]:b.lo[k];z[axis]=b.hi[axis];const p=project(v,s,a,w,h),q=project(v,s,z,w,h);ctx.beginPath();ctx.moveTo(p[0],p[1]);ctx.lineTo(q[0],q[1]);ctx.stroke();}}
  // An outline links the 2D section to its position in the block, including hidden edges.
  const a=this.sectionAxis,u=(a+1)%3,k=(a+2)%3;ctx.strokeStyle='#a4462a99';ctx.setLineDash([4,4]);ctx.beginPath();for(const [j,[du,dv]]of [[0,0],[1,0],[1,1],[0,1],[0,0]].entries()){const p:V3=[0,0,0];p[a]=s.sections[a];p[u]=du;p[k]=dv;const q=project(v,s,p,w,h);if(j===0)ctx.moveTo(q[0],q[1]);else ctx.lineTo(q[0],q[1]);}ctx.stroke();ctx.setLineDash([]);
  ctx.fillStyle='#6b7464';ctx.font='11px system-ui';ctx.fillText(`${((v.grid.nx-1)*v.grid.dx/1000).toFixed(0)} × ${((v.grid.ny-1)*v.grid.dy/1000).toFixed(0)} km · ${((v.grid.nz-1)*v.grid.dz/1000).toFixed(1)} km deep${s.exaggeration!==1?' · '+s.exaggeration+'× vertical exaggeration':''}`,16,h-16);ctx.restore();this.drawCount++;this.lastSubmitMs=performance.now()-started;
 }
}
