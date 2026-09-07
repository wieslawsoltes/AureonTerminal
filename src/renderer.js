/** Instanced quad renderer. Each primitive is 12 float32 values / 48 bytes.
 * Geometry is transformed to viewport-local pixels BEFORE upload to avoid precision
 * loss from Unix timestamps and large financial prices in float32 shaders.
 * Rectangles and arbitrary line segments share one pipeline and one draw call.
 */
const WGSL=`
struct View { size: vec2f, pad: vec2f };
@group(0) @binding(0) var<uniform> view: View;
struct In { @location(0) bounds:vec4f, @location(1) color:vec4f, @location(2) meta:vec4f };
struct Out { @builtin(position) position:vec4f, @location(0) color:vec4f };
@vertex fn vs(input:In,@builtin(vertex_index) vi:u32)->Out {
  let corners=array<vec2f,6>(vec2f(0.,0.),vec2f(1.,0.),vec2f(0.,1.),vec2f(0.,1.),vec2f(1.,0.),vec2f(1.,1.));
  let uv=corners[vi];var p:vec2f;
  if(input.meta.y<0.5){p=input.bounds.xy+uv*input.bounds.zw;}
  else {let d=input.bounds.zw-input.bounds.xy;let len=max(length(d),0.0001);let normal=vec2f(-d.y,d.x)/len;
    p=input.bounds.xy+uv.x*d+(uv.y-0.5)*input.meta.x*normal;}
  var out:Out;out.position=vec4f(p.x/view.size.x*2.-1.,1.-p.y/view.size.y*2.,0.,1.);out.color=input.color;return out;
}
@fragment fn fs(input:Out)->@location(0) vec4f {return input.color;}`;
const cache=new Map();
export function rgba(hex,alpha=1){const k=hex+alpha;if(cache.has(k))return cache.get(k);let h=hex.replace('#','');if(h.length===3)h=h.split('').map(x=>x+x).join('');const n=parseInt(h,16),c=[((n>>16)&255)/255,((n>>8)&255)/255,(n&255)/255,alpha];cache.set(k,c);return c;}
export class Geometry {
  constructor(){this.data=new Float32Array(12*4096);this.count=0;}
  clear(){this.count=0;}
  add(x,y,z,w,color,thickness=1,type=0){
    if(![x,y,z,w,thickness].every(Number.isFinite))return;
    if((this.count+1)*12>this.data.length){const next=new Float32Array(this.data.length*2);next.set(this.data);this.data=next;}
    const i=this.count++*12,a=this.data;a[i]=x;a[i+1]=y;a[i+2]=z;a[i+3]=w;a[i+4]=color[0];a[i+5]=color[1];a[i+6]=color[2];a[i+7]=color[3];a[i+8]=thickness;a[i+9]=type;a[i+10]=a[i+11]=0;
  }
  rect(x,y,w,h,c){if(w<0){x+=w;w=-w;}if(h<0){y+=h;h=-h;}if(w>0&&h>0)this.add(x,y,w,h,c);}
  line(x1,y1,x2,y2,c,width=1){this.add(x1,y1,x2,y2,c,width,1);}
  dash(x1,y1,x2,y2,c,width=1,dash=5){const d=Math.hypot(x2-x1,y2-y1);if(!d)return;for(let s=0;s<d;s+=dash*2){const e=Math.min(d,s+dash);this.line(x1+(x2-x1)*s/d,y1+(y2-y1)*s/d,x1+(x2-x1)*e/d,y1+(y2-y1)*e/d,c,width);}}
  outline(x,y,w,h,c,width=1){this.line(x,y,x+w,y,c,width);this.line(x+w,y,x+w,y+h,c,width);this.line(x+w,y+h,x,y+h,c,width);this.line(x,y+h,x,y,c,width);}
}
let sharedDevicePromise;
async function acquireDevice(){
  if(!navigator.gpu)throw new Error('WebGPU is unavailable');
  if(!sharedDevicePromise)sharedDevicePromise=(async()=>{const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});if(!adapter)throw new Error('No WebGPU adapter');const device=await adapter.requestDevice();device.lost.then(()=>{sharedDevicePromise=null;});return device;})();
  try{return await sharedDevicePromise;}catch(e){sharedDevicePromise=null;throw e;}
}
export class Renderer {
  constructor(gpuCanvas,fallbackCanvas,onMode){this.gpuCanvas=gpuCanvas;this.fallbackCanvas=fallbackCanvas;this.ctx=fallbackCanvas.getContext('2d');this.onMode=onMode;this.mode='Canvas 2D';this.size=0;this.destroyed=false;this.width=1;this.height=1;this.dpr=1;this.init();}
  async init(){try{
    if(new URLSearchParams(location.search).has('canvas'))throw new Error('Canvas override');
    const device=await acquireDevice();if(this.destroyed)return;this.device=device;
    this.context=this.gpuCanvas.getContext('webgpu');if(!this.context)throw new Error('WebGPU canvas unavailable');
    this.format=navigator.gpu.getPreferredCanvasFormat();this.context.configure({device,format:this.format,alphaMode:'premultiplied'});
    const module=device.createShaderModule({code:WGSL});
    this.pipeline=await device.createRenderPipelineAsync({layout:'auto',vertex:{module,entryPoint:'vs',buffers:[{arrayStride:48,stepMode:'instance',attributes:[{shaderLocation:0,offset:0,format:'float32x4'},{shaderLocation:1,offset:16,format:'float32x4'},{shaderLocation:2,offset:32,format:'float32x4'}]}]},fragment:{module,entryPoint:'fs',targets:[{format:this.format,blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'}}}]},primitive:{topology:'triangle-list'}});
    if(this.destroyed)return;
    this.uniform=device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    this.bind=device.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.uniform}}]});
    this.mode='WebGPU';this.gpuCanvas.hidden=false;this.fallbackCanvas.hidden=true;this.onMode?.(this.mode);
    device.lost.then(info=>{if(!this.destroyed)this.fallback('Device lost: '+info.reason);});
    this.uncaptured=event=>{event.preventDefault();this.fallback(event.error.message);};device.addEventListener('uncapturederror',this.uncaptured);
  }catch(e){this.fallback(e.message);}}
  fallback(reason){this.reason=reason;this.mode='Canvas 2D';this.gpuCanvas.hidden=true;this.fallbackCanvas.hidden=false;this.onMode?.(this.mode);}
  resize(w,h,dpr){this.width=w;this.height=h;this.dpr=dpr;for(const c of[this.gpuCanvas,this.fallbackCanvas]){const width=Math.max(1,Math.round(w*dpr)),height=Math.max(1,Math.round(h*dpr));if(c.width!==width)c.width=width;if(c.height!==height)c.height=height;}this.ctx.setTransform(dpr,0,0,dpr,0,0);}
  render(geometry,bg){if(this.destroyed)return;
    if(this.mode==='WebGPU')try{const device=this.device,bytes=geometry.count*48;
      if(bytes>this.size){this.buffer?.destroy();this.size=2**Math.ceil(Math.log2(Math.max(256,bytes)));this.buffer=device.createBuffer({size:this.size,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});}
      device.queue.writeBuffer(this.uniform,0,new Float32Array([this.width,this.height,0,0]));if(bytes)device.queue.writeBuffer(this.buffer,0,geometry.data.buffer,0,bytes);
      const encoder=device.createCommandEncoder(),pass=encoder.beginRenderPass({colorAttachments:[{view:this.context.getCurrentTexture().createView(),clearValue:{r:bg[0],g:bg[1],b:bg[2],a:1},loadOp:'clear',storeOp:'store'}]});
      if(bytes){pass.setPipeline(this.pipeline);pass.setBindGroup(0,this.bind);pass.setVertexBuffer(0,this.buffer);pass.draw(6,geometry.count);}pass.end();device.queue.submit([encoder.finish()]);return;
    }catch(e){this.fallback(e.message);}
    const ctx=this.ctx,a=geometry.data;ctx.fillStyle=`rgb(${bg[0]*255},${bg[1]*255},${bg[2]*255})`;ctx.fillRect(0,0,this.width,this.height);
    for(let n=0;n<geometry.count;n++){const i=n*12;ctx.fillStyle=ctx.strokeStyle=`rgba(${a[i+4]*255},${a[i+5]*255},${a[i+6]*255},${a[i+7]})`;
      if(a[i+9]<.5)ctx.fillRect(a[i],a[i+1],a[i+2],a[i+3]);else{ctx.lineWidth=a[i+8];ctx.beginPath();ctx.moveTo(a[i],a[i+1]);ctx.lineTo(a[i+2],a[i+3]);ctx.stroke();}}
  }
  destroy(){this.destroyed=true;this.buffer?.destroy();this.uniform?.destroy();this.context?.unconfigure();if(this.uncaptured)this.device?.removeEventListener('uncapturederror',this.uncaptured);}
}
