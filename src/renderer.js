/** Local-pixel instanced geometry: 12 float32 / 48 bytes per primitive.
 * Financial coordinates stay float64 upstream. GPU and Canvas use identical
 * ordered geometry; text stays on the chart overlay. No external shader library.
 */
export const GEOMETRY_WGSL=`
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

export const MAX_PRIMITIVES=262144;
export const MAX_RENDER_PIXELS=8388608;
const MAX_COORDINATE=16777216;
const cache=new Map();
const finitePixel=x=>Number.isFinite(x)&&Math.abs(x)<=MAX_COORDINATE;
const unit=x=>Number.isFinite(x)&&x>=0&&x<=1;
const validColor=c=>c!=null&&c.length===4&&unit(c[0])&&unit(c[1])&&unit(c[2])&&unit(c[3]);
export function rgba(hex,alpha=1){
  if(!Number.isFinite(alpha))alpha=1;alpha=Math.min(1,Math.max(0,alpha));
  let h=String(hex||'#578bfa').replace(/^#/,'');const key=h+':'+alpha;
  if(cache.has(key))return cache.get(key);
  if(!/^(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(h))h='578bfa';
  if(h.length===3)h=h.split('').map(x=>x+x).join('');
  if(h.length===8){alpha*=parseInt(h.slice(6),16)/255;h=h.slice(0,6);}
  const n=parseInt(h,16),c=Object.freeze([((n>>16)&255)/255,((n>>8)&255)/255,(n&255)/255,alpha]);
  if(cache.size>=4096)cache.clear();cache.set(key,c);return c;
}
export class Geometry {
  constructor(limit=MAX_PRIMITIVES){
    if(!Number.isInteger(limit)||limit<1||limit>MAX_PRIMITIVES)throw new RangeError('Invalid geometry capacity');
    this.limit=limit;this.data=new Float32Array(12*Math.min(4096,limit));this.clear();
  }
  clear(){this.count=0;this.dropped=0;}
  add(x,y,z,w,color,thickness=1,type=0){
    if(!(finitePixel(x)&&finitePixel(y)&&finitePixel(z)&&finitePixel(w)&&finitePixel(thickness))||!validColor(color)||!(type===0||type===1)||thickness<=0){this.dropped++;return false;}
    if(this.count>=this.limit){this.dropped++;return false;}
    if((this.count+1)*12>this.data.length){const next=new Float32Array(Math.min(this.limit*12,this.data.length*2));next.set(this.data);this.data=next;}
    const i=this.count++*12,a=this.data;
    a[i]=x;a[i+1]=y;a[i+2]=z;a[i+3]=w;a[i+4]=color[0];a[i+5]=color[1];a[i+6]=color[2];a[i+7]=color[3];a[i+8]=thickness;a[i+9]=type;a[i+10]=a[i+11]=0;return true;
  }
  rect(x,y,w,h,c){if(w<0){x+=w;w=-w;}if(h<0){y+=h;h=-h;}if(w>0&&h>0)this.add(x,y,w,h,c);}
  line(x1,y1,x2,y2,c,width=1){if(x1===x2&&y1===y2)return;this.add(x1,y1,x2,y2,c,width,1);}
  dash(x1,y1,x2,y2,c,width=1,dash=5){
    if(![x1,y1,x2,y2,width,dash].every(finitePixel)||dash<=0||width<=0||!validColor(c)){this.dropped++;return;}
    const d=Math.hypot(x2-x1,y2-y1);if(!d)return;
    const steps=Math.ceil(d/(dash*2));if(steps>65536||steps>this.limit-this.count){this.dropped++;return;}
    for(let i=0;i<steps;i++){const s=i*dash*2,e=Math.min(d,s+dash);this.line(x1+(x2-x1)*s/d,y1+(y2-y1)*s/d,x1+(x2-x1)*e/d,y1+(y2-y1)*e/d,c,width);}
  }
  outline(x,y,w,h,c,width=1){this.line(x,y,x+w,y,c,width);this.line(x+w,y,x+w,y+h,c,width);this.line(x+w,y+h,x,y+h,c,width);this.line(x,y+h,x,y,c,width);}
}
/** Backing-store limits apply to each chart, before browser/GPU allocation. */
export function renderDimensions(width,height,dpr=1,deviceLimit=8192){
  if(![width,height,dpr].every(Number.isFinite)||width<=0||height<=0||dpr<=0)throw new RangeError('Invalid renderer dimensions');
  if(width>1000000||height>1000000)throw new RangeError('Chart CSS dimensions exceed limit');
  const side=Math.min(8192,Math.max(1,Number.isFinite(deviceLimit)?Math.floor(deviceLimit):8192));
  const scale=Math.min(dpr,4,side/width,side/height,Math.sqrt(MAX_RENDER_PIXELS/width/height));
  const w=Math.max(1,Math.floor(width*scale)),h=Math.max(1,Math.floor(height*scale));
  return{width:w,height:h,scaleX:w/width,scaleY:h/height,limited:scale<dpr};
}
function descriptor(module,format,samples){return{
  label:'Aureon instanced geometry '+samples+'x',layout:'auto',
  vertex:{module,entryPoint:'vs',buffers:[{arrayStride:48,stepMode:'instance',attributes:[{shaderLocation:0,offset:0,format:'float32x4'},{shaderLocation:1,offset:16,format:'float32x4'},{shaderLocation:2,offset:32,format:'float32x4'}]}]},
  fragment:{module,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'}}}]},
  primitive:{topology:'triangle-list'},multisample:{count:samples}
};}
/** Device + pipelines are shared, but render targets/buffers have one owner.
 * A late loss/rejection only clears the exact acquisition it belongs to. */
export class RendererDevicePool {
  constructor(gpu=()=>globalThis.navigator?.gpu){this.gpu=gpu;this.pending=null;this.disposed=false;}
  destroy(){this.disposed=true;const pending=this.pending;this.pending=null;pending?.then(record=>release(record.device),()=>{});}
  acquire(){
    if(this.disposed)return Promise.reject(new Error('Device pool is disposed'));
    if(this.pending)return this.pending;
    let pending;pending=(async()=>{
      const gpu=typeof this.gpu==='function'?this.gpu():this.gpu;
      if(!gpu)throw new Error('WebGPU unavailable on this origin/browser');
      const adapter=await gpu.requestAdapter({powerPreference:'high-performance'});
      if(!adapter)throw new Error('No WebGPU adapter');
      const device=await adapter.requestDevice();
      if(this.disposed){release(device);throw new Error('Device pool was disposed during acquisition');}
      const info=adapter.info||device.adapterInfo||{};
      const record={device,gpu,lost:false,listeners:new Set(),pipelines:new Map(),info:{vendor:String(info.vendor||''),architecture:String(info.architecture||''),description:String(info.description||''),fallback:adapter.isFallbackAdapter??null}};
      device.lost.then(info=>{record.lost=true;if(this.pending===pending)this.pending=null;for(const callback of [...record.listeners])callback(info);record.listeners.clear();});return record;
    })();this.pending=pending;
    pending.catch(()=>{if(this.pending===pending)this.pending=null;});return pending;
  }
  pipeline(record,format,samples){
    if(this.disposed||record.lost)return Promise.reject(new Error('Device pool is unavailable'));
    if(!['rgba8unorm','bgra8unorm'].includes(format)||![1,4].includes(samples))return Promise.reject(new RangeError('Invalid pipeline configuration'));
    const key=format+':'+samples;if(record.pipelines.has(key))return record.pipelines.get(key);
    const value=(async()=>{
      const module=record.device.createShaderModule({label:'Aureon quad WGSL',code:GEOMETRY_WGSL});
      const compilation=await module.getCompilationInfo?.();
      const errors=compilation?.messages?.filter(m=>m.type==='error');
      if(errors?.length)throw new Error(errors.map(m=>'WGSL '+m.lineNum+': '+m.message).join('; ').slice(0,1000));
      return record.device.createRenderPipelineAsync(descriptor(module,format,samples));
    })();record.pipelines.set(key,value);
    value.catch(()=>{if(record.pipelines.get(key)===value)record.pipelines.delete(key);});return value;
  }
}
const sharedPool=new RendererDevicePool();
function release(resource){try{resource?.destroy();}catch{}}
function background(bg){if(!validColor(bg))throw new TypeError('Invalid background color');return{r:bg[0],g:bg[1],b:bg[2],a:1};}
function geometryBytes(g){if(!(g instanceof Geometry)||!Number.isInteger(g.count)||g.count<0||g.count>g.limit||g.count>MAX_PRIMITIVES||!(g.data instanceof Float32Array)||g.count*12>g.data.length)throw new TypeError('Invalid geometry buffer');return g.count*48;}
const errorText = error => String(error?.message ?? error ?? 'Unknown renderer failure').slice(0, 1000);
const abortError = message => Object.assign(new Error(message), {name:'AbortError'});

/** A chart owns its canvases, vertex buffer, uniform and MSAA target. Device and
 * immutable pipelines alone are shared. Every asynchronous operation is fenced
 * by a generation; changing the backend can never revive a stale GPU session. */
export class Renderer {
  constructor(gpuCanvas, fallbackCanvas, onMode, options={}) {
    this.gpuCanvas=gpuCanvas; this.fallbackCanvas=fallbackCanvas;
    this.ctx=fallbackCanvas.getContext('2d');
    if (!this.ctx) throw new Error('Canvas 2D unavailable');
    this.onMode=onMode; this.pool=options.pool || sharedPool;
    this.samples=options.samples ?? 4;
    if (![1,4].includes(this.samples)) throw new RangeError('Samples must be 1 or 4');
    this.timeout=options.timeout ?? 12000;
    if (!Number.isInteger(this.timeout) || this.timeout<1 || this.timeout>120000) throw new RangeError('Invalid GPU initialization timeout');
    this.preference=options.backend ?? (new URLSearchParams(globalThis.location?.search || '').has('canvas')?'canvas':'auto');
    if (!['auto','canvas'].includes(this.preference)) throw new RangeError('Invalid renderer backend');
    this.mode='Canvas 2D'; this.width=1; this.height=1; this.dpr=1; this.size=0;
    this.generation=0; this.destroyed=false; this.state=null; this.lastScene=null; this.captureBusy=false;
    this.stats={frames:0,gpuFrames:0,canvasFrames:0,drawCalls:0,uploadedBytes:0,allocations:0,errors:0,recoveries:0,lastSubmitMs:0};
    this.resize(1,1,1);
    // Defer initialization so callbacks cannot run against a half-built Chart.
    this.ready=Promise.resolve().then(()=>this.generation===0?this.init():this.diagnostics());
  }
  notify() {
    try { this.onMode?.(this.mode); }
    catch (error) { this.notificationError=errorText(error); }
  }
  /** Destroy only this chart's resources, never a shared device. */
  releaseGPU() {
    const state=this.state; this.state=null;
    if (state?.uncaptured) state.device.removeEventListener('uncapturederror',state.uncaptured);
    if (state?.onLost) state.record.listeners.delete(state.onLost);
    release(this.buffer); release(state?.uniform); release(this.msaa);
    this.buffer=null; this.uniform=null; this.msaa=null; this.size=0; this.msaaKey='';
    if (state?.configured) { try { state.context.unconfigure(); } catch {} }
    this.context=null; this.pipeline=null; this.bind=null; this.device=null; this.record=null;
  }
  async init() {
    if (this.destroyed) return this.diagnostics();
    const generation=++this.generation; this.releaseGPU();
    this.mode='Canvas 2D'; this.reason=this.preference==='canvas'?'Canvas selected':'Initializing WebGPU';
    this.gpuCanvas.hidden=true; this.fallbackCanvas.hidden=false; this.paintLast();
    if (this.preference==='canvas') { this.notify(); return this.diagnostics(); }
    const current=()=>!this.destroyed && this.generation===generation;
    let timer;
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('WebGPU initialization timed out; retry explicitly')),this.timeout);});
    const bounded=promise=>Promise.race([promise,timeout]);
    let uniform=null;
    try {
      const record=await bounded(this.pool.acquire());
      if (!current()) return this.diagnostics();
      if (record.lost) throw new Error('Acquired device is already lost');
      const device=record.device, format=record.gpu.getPreferredCanvasFormat();
      const pipeline=await bounded(this.pool.pipeline(record,format,this.samples));
      if (!current()) return this.diagnostics();
      if (record.lost) throw new Error('Device lost during pipeline compilation');
      const context=this.gpuCanvas.getContext('webgpu');
      if (!context) throw new Error('WebGPU canvas unavailable');
      // Error-scope push/pop pairs are synchronous: independent charts cannot
      // interleave scopes on the shared device while awaiting a promise.
      device.pushErrorScope('validation'); device.pushErrorScope('out-of-memory');
      let bind, creationError;
      try {
        uniform=device.createBuffer({label:'Aureon viewport',size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
        bind=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uniform}}]});
      } catch (error) { creationError=error; }
      const creationScopes=Promise.all([device.popErrorScope(),device.popErrorScope()]);
      const creationErrors=await bounded(creationScopes);
      if (!current()) { release(uniform); return this.diagnostics(); }
      if (creationError || creationErrors.some(Boolean)) throw creationError || creationErrors.find(Boolean);
      const state={device,record,context,uniform,pipeline,bind,format,configured:false,uncaptured:null};
      this.state=state; this.device=device; this.record=record; this.context=context;
      this.uniform=uniform; this.pipeline=pipeline; this.bind=bind; this.format=format; uniform=null;
      // Re-evaluate pixel bounds using this adapter's actual texture limit.
      this.resize(this.width,this.height,this.dpr);
      device.pushErrorScope('validation'); device.pushErrorScope('out-of-memory');
      let configurationError;
      try { context.configure({device,format,alphaMode:'premultiplied'}); state.configured=true; }
      catch (error) { configurationError=error; }
      const configurationScopes=Promise.all([device.popErrorScope(),device.popErrorScope()]);
      const configurationErrors=await bounded(configurationScopes);
      if (!current()) return this.diagnostics();
      if (configurationError || configurationErrors.some(Boolean)) throw configurationError || configurationErrors.find(Boolean);
      if (record.lost) throw new Error('Device lost during canvas configuration');
      state.uncaptured=event=>{
        // The shared-device event is handled by every active owner. Each owner
        // independently invalidates its own state, preserving its own scene.
        event.preventDefault?.();
        if (current() && this.state===state) this.fallback(errorText(event.error));
      };
      device.addEventListener('uncapturederror',state.uncaptured);
      state.onLost=info=>{
        if (current() && this.state===state) this.fallback('Device lost: '+errorText(info?.message || info?.reason));
      };
      record.listeners.add(state.onLost);
      this.mode='WebGPU'; this.reason=''; this.gpuCanvas.hidden=false; this.fallbackCanvas.hidden=true;
      if (this.lastScene) this.drawGPU(this.lastScene);
      this.notify();
    } catch (error) {
      release(uniform);
      if (current()) this.fallback(errorText(error));
    } finally { clearTimeout(timer); }
    return this.diagnostics();
  }
  fallback(reason) {
    if (this.destroyed) return;
    ++this.generation; this.releaseGPU();
    this.reason=errorText(reason); this.mode='Canvas 2D'; this.stats.errors++;
    this.gpuCanvas.hidden=true; this.fallbackCanvas.hidden=false;
    this.paintLast(); this.notify();
  }
  setBackend(backend) {
    if (!['auto','canvas'].includes(backend)) return Promise.reject(new RangeError('Invalid renderer backend'));
    if (this.destroyed) return Promise.reject(new Error('Renderer is destroyed'));
    this.preference=backend; this.ready=this.init(); return this.ready;
  }
  setSamples(samples) {
    if (![1,4].includes(samples)) return Promise.reject(new RangeError('Samples must be 1 or 4'));
    if (this.destroyed) return Promise.reject(new Error('Renderer is destroyed'));
    if (this.samples===samples) return this.ready;
    this.samples=samples; this.ready=this.init(); return this.ready;
  }
  retry() {
    if (this.destroyed) return Promise.reject(new Error('Renderer is destroyed'));
    this.stats.recoveries++; return this.setBackend('auto');
  }
  resize(width,height,dpr=1) {
    if (this.destroyed) return;
    const dimensions=renderDimensions(width,height,dpr,this.device?.limits?.maxTextureDimension2D);
    this.width=width; this.height=height; this.dpr=dpr; this.dimensions=dimensions;
    let changed=false;
    for (const canvas of [this.gpuCanvas,this.fallbackCanvas]) {
      if (canvas.width!==dimensions.width) { canvas.width=dimensions.width; changed=true; }
      if (canvas.height!==dimensions.height) { canvas.height=dimensions.height; changed=true; }
    }
    this.ctx.setTransform(dimensions.scaleX,0,0,dimensions.scaleY,0,0);
    if (changed) { release(this.msaa); this.msaa=null; this.msaaKey=''; }
    if (changed && this.mode==='Canvas 2D') this.paintLast();
  }
  /** Reuse a bounded immutable snapshot: Geometry is rebuilt in-place by Chart. */
  remember(geometry,bg) {
    const bytes=geometryBytes(geometry); background(bg);
    let scene=this.lastScene;
    if (!scene || scene.data.length<geometry.count*12) {
      const capacity=Math.min(MAX_PRIMITIVES*12,Math.max(12,2**Math.ceil(Math.log2(Math.max(12,geometry.count*12)))));
      scene={data:new Float32Array(capacity),count:0,bg:[0,0,0,1],dropped:0}; this.lastScene=scene;
    }
    scene.data.set(geometry.data.subarray(0,geometry.count*12)); scene.count=geometry.count;
    scene.bg=[bg[0],bg[1],bg[2],1]; scene.dropped=geometry.dropped;
    return {scene,bytes};
  }
  render(geometry,bg) {
    if (this.destroyed) return;
    const start=globalThis.performance?.now() ?? Date.now();
    const {scene}=this.remember(geometry,bg); this.stats.frames++;
    this.stats.drawCalls=0; this.stats.uploadedBytes=0;
    if (this.mode==='WebGPU') {
      try { this.drawGPU(scene); }
      catch (error) { this.fallback(errorText(error)); }
    } else this.paintLast();
    this.stats.lastSubmitMs=(globalThis.performance?.now() ?? Date.now())-start;
  }
  upload(scene) {
    const bytes=scene.count*48,device=this.device;
    if (!device || this.record?.lost) throw new Error('GPU is not available');
    if (bytes>this.size) {
      const capacity=Math.max(256,2**Math.ceil(Math.log2(bytes)));
      if (capacity>device.limits.maxBufferSize) throw new RangeError('Geometry exceeds adapter buffer capacity');
      const buffer=device.createBuffer({label:'Aureon instances',size:capacity,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
      release(this.buffer); this.buffer=buffer; this.size=capacity; this.stats.allocations++;
    }
    device.queue.writeBuffer(this.uniform,0,new Float32Array([this.width,this.height,0,0]));
    if (bytes) device.queue.writeBuffer(this.buffer,0,scene.data.buffer,scene.data.byteOffset,bytes);
    this.stats.uploadedBytes=bytes; return bytes;
  }
  multisampleTarget(width,height) {
    if (this.samples===1) return null;
    const key=[width,height,this.samples,this.format].join(':');
    if (!this.msaa || this.msaaKey!==key) {
      const texture=this.device.createTexture({label:'Aureon MSAA',size:[width,height],sampleCount:this.samples,format:this.format,usage:GPUTextureUsage.RENDER_ATTACHMENT});
      release(this.msaa); this.msaa=texture; this.msaaKey=key; this.stats.allocations++;
    }
    return this.msaa;
  }
  encode(encoder,view,scene,msaa=null) {
    const attachment={view:msaa?msaa.createView():view,clearValue:background(scene.bg),loadOp:'clear',storeOp:msaa?'discard':'store'};
    if (msaa) attachment.resolveTarget=view;
    const pass=encoder.beginRenderPass({label:'Aureon geometry',colorAttachments:[attachment]});
    if (scene.count) {
      pass.setPipeline(this.pipeline); pass.setBindGroup(0,this.bind); pass.setVertexBuffer(0,this.buffer);
      pass.draw(6,scene.count); this.stats.drawCalls=1;
    } else this.stats.drawCalls=0;
    pass.end();
  }
  drawGPU(scene) {
    this.upload(scene);
    const {width,height}=this.dimensions,msaa=this.multisampleTarget(width,height);
    const encoder=this.device.createCommandEncoder({label:'Aureon frame'});
    this.encode(encoder,this.context.getCurrentTexture().createView(),scene,msaa);
    this.device.queue.submit([encoder.finish()]); this.stats.gpuFrames++;
  }
  paintLast() {
    if (this.destroyed || !this.lastScene) return;
    const scene=this.lastScene,ctx=this.ctx,a=scene.data;
    ctx.setTransform(this.dimensions.scaleX,0,0,this.dimensions.scaleY,0,0);
    ctx.globalAlpha=1; ctx.globalCompositeOperation='source-over'; ctx.lineCap='butt';
    ctx.fillStyle=`rgb(${scene.bg[0]*255},${scene.bg[1]*255},${scene.bg[2]*255})`;
    ctx.fillRect(0,0,this.width,this.height);
    for (let n=0;n<scene.count;n++) {
      const i=n*12;
      ctx.fillStyle=ctx.strokeStyle=`rgba(${a[i+4]*255},${a[i+5]*255},${a[i+6]*255},${a[i+7]})`;
      if (a[i+9]<.5) ctx.fillRect(a[i],a[i+1],a[i+2],a[i+3]);
      else { ctx.lineWidth=a[i+8]; ctx.beginPath(); ctx.moveTo(a[i],a[i+1]); ctx.lineTo(a[i+2],a[i+3]); ctx.stroke(); }
    }
    this.stats.canvasFrames++;
  }
  /** Explicit diagnostic operation, never run on the regular render loop. It
   * checks the real shader and copy/map path. A lifecycle change rejects it,
   * rather than disguising a failed GPU operation as a successful CPU result. */
  async capturePixels(geometry,bg) {
    if (this.destroyed) throw new Error('Renderer is destroyed');
    if (this.captureBusy) throw new Error('Pixel capture is already in progress');
    const bytes=geometryBytes(geometry); background(bg);
    const {width,height}=this.dimensions;
    if (width*height>4194304) throw new RangeError('Diagnostic capture is limited to 4,194,304 pixels');
    this.captureBusy=true;
    const scene={data:geometry.data.slice(0,bytes/4),count:geometry.count,bg:[bg[0],bg[1],bg[2],1]};
    let texture=null,msaa=null,readback=null,timer,scopes;
    const generation=this.generation,device=this.device,samples=this.samples,format=this.format;
    const current=()=>!this.destroyed && generation===this.generation && device===this.device;
    try {
      if (this.mode!=='WebGPU') {
        // An independent temporary Canvas avoids mutating the displayed scene.
        const canvas=this.fallbackCanvas.ownerDocument?.createElement('canvas') ?? new OffscreenCanvas(width,height);
        canvas.width=width; canvas.height=height;
        const ctx=canvas.getContext('2d');
        if (!ctx) throw new Error('Diagnostic Canvas unavailable');
        const painter={ctx,dimensions:this.dimensions,width:this.width,height:this.height,lastScene:scene,stats:{canvasFrames:0},destroyed:false};
        this.paintLast.call(painter);
        return {mode:'Canvas 2D',samples:1,width,height,pixels:ctx.getImageData(0,0,width,height).data};
      }
      if (!['bgra8unorm','rgba8unorm'].includes(format)) throw new Error('Unsupported readback color format');
      const bytesPerRow=Math.ceil(width*4/256)*256;
      device.pushErrorScope('validation'); device.pushErrorScope('out-of-memory');
      let encodeError;
      try {
        this.upload(scene);
        texture=device.createTexture({label:'Aureon diagnostic target',size:[width,height],format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
        if (samples===4) msaa=device.createTexture({label:'Aureon diagnostic MSAA',size:[width,height],format,sampleCount:4,usage:GPUTextureUsage.RENDER_ATTACHMENT});
        readback=device.createBuffer({label:'Aureon pixel readback',size:bytesPerRow*height,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
        const encoder=device.createCommandEncoder({label:'Aureon pixel verification'});
        this.encode(encoder,texture.createView(),scene,msaa);
        encoder.copyTextureToBuffer({texture},{buffer:readback,bytesPerRow,rowsPerImage:height},[width,height]);
        device.queue.submit([encoder.finish()]);
      } catch (error) { encodeError=error; }
      scopes=Promise.all([device.popErrorScope(),device.popErrorScope()]);
      // Attach immediately; a thrown encoding error must not leave a rejected
      // error-scope promise unobserved.
      scopes.catch(()=>{});
      if (encodeError) throw encodeError;
      const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('GPU readback timed out')),this.timeout);});
      const [scopeErrors]=await Promise.race([Promise.all([scopes,readback.mapAsync(GPUMapMode.READ)]),timeout]);
      if (!current()) throw abortError('Renderer changed during pixel capture');
      if (scopeErrors.some(Boolean)) throw scopeErrors.find(Boolean);
      const mapped=new Uint8Array(readback.getMappedRange()),pixels=new Uint8ClampedArray(width*height*4);
      for (let y=0;y<height;y++) pixels.set(mapped.subarray(y*bytesPerRow,y*bytesPerRow+width*4),y*width*4);
      if (format==='bgra8unorm') for (let i=0;i<pixels.length;i+=4) { const blue=pixels[i]; pixels[i]=pixels[i+2]; pixels[i+2]=blue; }
      return {mode:'WebGPU',samples,width,height,pixels};
    } finally {
      clearTimeout(timer);
      try { readback?.unmap(); } catch {}
      release(readback); release(msaa); release(texture); this.captureBusy=false;
    }
  }
  diagnostics() {
    return {
      mode:this.mode,preference:this.preference,samples:this.samples,reason:this.reason || '',destroyed:this.destroyed,
      dimensions:{...this.dimensions},cssSize:{width:this.width,height:this.height,dpr:this.dpr},bufferBytes:this.size,
      geometry:{count:this.lastScene?.count || 0,dropped:this.lastScene?.dropped || 0,limit:MAX_PRIMITIVES,retainedBytes:this.lastScene?.data.byteLength || 0},
      stats:{...this.stats},adapter:this.record?{...this.record.info}:null,
      timing:'lastSubmitMs measures CPU-side rendering/submission, not GPU execution',
      ...(this.notificationError?{notificationError:this.notificationError}:{})
    };
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed=true; ++this.generation; this.releaseGPU(); this.lastScene=null;
  }
}
