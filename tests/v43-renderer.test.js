import test from 'node:test';
import assert from 'node:assert/strict';
import {GEOMETRY_WGSL,Geometry,rgba,renderDimensions,MAX_PRIMITIVES,MAX_RENDER_PIXELS,Renderer,RendererDevicePool} from '../src/renderer.js';

globalThis.GPUBufferUsage={UNIFORM:64,COPY_DST:8,VERTEX:32,MAP_READ:1};
globalThis.GPUTextureUsage={RENDER_ATTACHMENT:16,COPY_SRC:1};
globalThis.GPUMapMode={READ:1};
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const color=rgba('#ff0000');
const sample=()=>{const g=new Geometry();g.rect(1,2,4,5,color);return g;};
function gpuFixture({pipelineGate,deviceGate,bufferLimit=1<<26,scopeGate,failedCompilation=false}={}) {
  const created=[],gpu={getPreferredCanvasFormat:()=> 'rgba8unorm',requests:0};
  gpu.requestAdapter=async()=>{
    gpu.requests++;
    return {info:{vendor:'test',architecture:'mock',description:'Unit-test double, not actual GPU'},isFallbackAdapter:true,requestDevice:async()=>{
      if (deviceGate) await deviceGate.promise;
      const loss=defer(),listeners=new Set(),device={
        limits:{maxTextureDimension2D:8192,maxBufferSize:bufferLimit},buffers:[],textures:[],pipelines:[],queue:{writes:[],submissions:[],writeBuffer(...args){this.writes.push(args);},submit(args){this.submissions.push(args);}},lost:loss.promise,
        addEventListener(name,fn){listeners.add(fn);},removeEventListener(name,fn){listeners.delete(fn);},listeners,
        destroy(){this.destroyed=true;loss.resolve({reason:'destroyed'});},lose(){loss.resolve({reason:'unknown',message:'Fixture loss'});},
        emitError(){const e={error:new Error('Fixture validation error'),preventDefault(){}};for(const fn of [...listeners])fn(e);},
        pushErrorScope(){},popErrorScope(){return scopeGate?scopeGate.promise:Promise.resolve(null);},
        createShaderModule(){return{getCompilationInfo:async()=>({messages:failedCompilation?[{type:'error',lineNum:1,message:'Fixture syntax'}]:[]})};},
        async createRenderPipelineAsync(description){this.pipelines.push(description);if(pipelineGate)await pipelineGate.promise;return{getBindGroupLayout:()=>({})};},
        createBuffer(description){const b={...description,destroyed:false,mapped:new ArrayBuffer(description.size),destroy(){this.destroyed=true;},unmap(){this.unmapped=true;},mapAsync(){return Promise.resolve();},getMappedRange(){return this.mapped;}};this.buffers.push(b);return b;},
        createBindGroup(description){return description;},
        createTexture(description){const t={...description,destroyed:false,createView(){return{texture:this};},destroy(){this.destroyed=true;}};this.textures.push(t);return t;},
        createCommandEncoder(){return{beginRenderPass(description){device.pass=description;return{setPipeline(){},setBindGroup(){},setVertexBuffer(){},draw(...args){device.draw=args;},end(){}};},copyTextureToBuffer(a,b,c){device.copy=[a,b,c];},finish(){return{};}};}
      }; created.push(device);return device;
    }};
  };
  return {gpu,created,pool:new RendererDevicePool(gpu)};
}
function canvases() {
  const calls=[],ctx={calls,setTransform(...v){calls.push(['transform',...v]);},fillRect(...v){calls.push(['rect',this.fillStyle,...v]);},beginPath(){},moveTo(){},lineTo(){},stroke(){calls.push(['stroke']);},getImageData(x,y,w,h){return{data:new Uint8ClampedArray(w*h*4)};}};
  const context={configures:0,unconfigures:0,configure(v){this.configures++;this.config=v;},unconfigure(){this.unconfigures++;},getCurrentTexture(){return{createView:()=>({})};}};
  const fallback={width:0,height:0,hidden:false,getContext:()=>ctx,ownerDocument:{createElement:()=>({width:0,height:0,getContext:()=>ctx})}};
  const canvas={width:0,height:0,hidden:true,getContext:()=>context};
  return {canvas,fallback,ctx,context};
}
function renderer(fixture,options={}) {
  const c=canvases(),r=new Renderer(c.canvas,c.fallback,null,{pool:fixture.pool,...options});return {r,...c};
}

test('geometry uses exact 48-byte instances and normalizes rectangles',()=>{
  const g=new Geometry();g.rect(20,30,-10,-15,color);g.line(0,0,5,6,color,2);
  assert.equal(g.count,2);assert.deepEqual([...g.data.slice(0,4)],[10,15,10,15]);assert.deepEqual([...g.data.slice(20,24)],[2,1,0,0]);
});
test('geometry capacity is bounded and counts omitted requests',()=>{
  const g=new Geometry(3);for(let i=0;i<7;i++)g.rect(i,0,1,1,color);
  assert.equal(g.count,3);assert.equal(g.dropped,4);assert.equal(g.data.length,36);g.clear();assert.equal(g.count+g.dropped,0);
});
test('geometry grows geometrically only to its configured bound',()=>{
  const g=new Geometry(5000);for(let i=0;i<5001;i++)g.rect(i,0,1,1,color);
  assert.equal(g.data.length,5000*12);assert.equal(g.count,5000);assert.equal(g.dropped,1);
});
test('geometry rejects nonfinite coordinates, colors, widths and kinds',()=>{
  const g=new Geometry();for(const v of [NaN,Infinity,-Infinity,1e30])assert.equal(g.add(v,0,1,1,color),false);
  for(const c of [[2,0,0,1],[0,0,0,-1],[0,NaN,0,1],[],null])assert.equal(g.add(0,0,1,1,c),false);
  assert.equal(g.add(0,0,1,1,color,0),false);assert.equal(g.add(0,0,1,1,color,1,2),false);assert.equal(g.count,0);assert.equal(g.dropped,11);
});
test('dashes reject nonprogressing or excessive loops atomically',()=>{
  const g=new Geometry(20);for(const dash of [0,-1,NaN,1e-100])g.dash(0,0,100,0,color,1,dash);
  assert.equal(g.count,0);assert.equal(g.dropped,4);g.dash(0,0,20,0,color,1,5);assert.equal(g.count,2);
});
test('invalid geometry capacities fail before allocating',()=>{
  for(const v of [0,-1,1.5,NaN,Infinity,MAX_PRIMITIVES+1])assert.throws(()=>new Geometry(v),RangeError);
});
test('colors are validated, alpha-composed, cached immutably',()=>{
  assert.deepEqual(rgba('#fff'),[1,1,1,1]);assert.equal(rgba('#ffffff80',.5)[3],128/255*.5);
  assert.equal(rgba('#000',-4)[3],0);assert.equal(rgba('#000',4)[3],1);
  assert.deepEqual(rgba('invalid'),rgba('#578bfa'));assert(Object.isFrozen(rgba('#abc')));assert.strictEqual(rgba('#abc'),rgba('#abc'));
});
test('backing dimensions honor CSS aspect, DPR, adapter and pixel budgets',()=>{
  assert.deepEqual(renderDimensions(33,19,2),{width:66,height:38,scaleX:2,scaleY:2,limited:false});
  for(const [w,h,dpr] of [[10000,10000,4],[1e6,1,4],[1,1e6,4],[3000,2000,3]]){
    const d=renderDimensions(w,h,dpr,4096);assert(d.width*d.height<=MAX_RENDER_PIXELS);assert(d.width<=4096&&d.height<=4096);assert(d.limited);
  }
});
test('invalid dimensions never reach a canvas allocation',()=>{
  for(const args of [[0,10],[-1,10],[NaN,10],[10,Infinity],[10,10,0],[1e7,10]])assert.throws(()=>renderDimensions(...args),RangeError);
});
test('pool coalesces concurrent acquisitions and pipeline compilations',async()=>{
  const f=gpuFixture();try{
    const [a,b]=await Promise.all([f.pool.acquire(),f.pool.acquire()]);assert.strictEqual(a,b);assert.equal(f.gpu.requests,1);
    const [p,q]=await Promise.all([f.pool.pipeline(a,'rgba8unorm',4),f.pool.pipeline(a,'rgba8unorm',4)]);assert.strictEqual(p,q);assert.equal(a.device.pipelines.length,1);
    await f.pool.pipeline(a,'rgba8unorm',1);assert.equal(a.device.pipelines.length,2);
  }finally{f.pool.destroy();}
});
test('lost devices invalidate only their own acquisition and allow a new shared device',async()=>{
  const f=gpuFixture();try{const a=await f.pool.acquire();a.device.lose();await tick();const b=await f.pool.acquire();assert.notEqual(a,b);assert(a.lost);assert.equal(f.gpu.requests,2);}finally{f.pool.destroy();}
});
test('failed pool acquisition is retryable without sticky rejected promises',async()=>{
  let calls=0;const f=gpuFixture(),pool=new RendererDevicePool(()=>++calls===1?null:f.gpu);
  await assert.rejects(pool.acquire(),/unavailable/);await pool.acquire();assert.equal(calls,2);pool.destroy();
});
test('pool disposal during acquisition destroys the late device',async()=>{
  const gate=defer(),f=gpuFixture({deviceGate:gate}),p=f.pool.acquire();await tick();f.pool.destroy();gate.resolve();await assert.rejects(p,/disposed/);assert(f.created[0].destroyed);await assert.rejects(f.pool.acquire(),/disposed/);
});
test('shader diagnostics reject pipeline compilation explicitly',async()=>{
  const f=gpuFixture({failedCompilation:true});try{const a=await f.pool.acquire();await assert.rejects(f.pool.pipeline(a,'rgba8unorm',4),/WGSL 1/);assert.equal(a.pipelines.size,0);}finally{f.pool.destroy();}
});
test('invalid pipeline options reject before reaching GPU',async()=>{
  const f=gpuFixture();try{const a=await f.pool.acquire();await assert.rejects(f.pool.pipeline(a,'rgba8unorm',3),RangeError);await assert.rejects(f.pool.pipeline(a,'unknown',1),RangeError);assert.equal(a.device.pipelines.length,0);}finally{f.pool.destroy();}
});
test('renderer starts asynchronously and preserves a pre-ready Canvas scene',async()=>{
  const f=gpuFixture(),{r,ctx}=renderer(f);try{r.resize(80,60,2);r.render(sample(),rgba('#111'));assert.equal(r.mode,'Canvas 2D');assert(ctx.calls.some(c=>c[0]==='rect'));await r.ready;assert.equal(r.mode,'WebGPU');assert.equal(r.stats.gpuFrames,1);}finally{r.destroy();f.pool.destroy();}
});
test('empty geometry clears target without allocating an instance buffer or issuing a draw',async()=>{
  const f=gpuFixture(),{r}=renderer(f);try{await r.ready;r.render(new Geometry(),rgba('#fff'));assert.equal(r.buffer,null);assert.equal(r.stats.drawCalls,0);assert.equal(r.device.pass.colorAttachments[0].clearValue.r,1);}finally{r.destroy();f.pool.destroy();}
});
test('stable scenes reuse buffer and MSAA target and issue one instanced draw',async()=>{
  const f=gpuFixture(),{r}=renderer(f);try{await r.ready;r.resize(80,60,2);const g=sample();r.render(g,rgba('#000'));const buffer=r.buffer,msaa=r.msaa;g.line(0,0,10,10,color);r.render(g,rgba('#000'));assert.strictEqual(r.buffer,buffer);assert.strictEqual(r.msaa,msaa);assert.deepEqual(r.device.draw,[6,2]);assert.equal(r.stats.drawCalls,1);assert.equal(r.stats.uploadedBytes,96);}finally{r.destroy();f.pool.destroy();}
});
test('resize disposes the old MSAA target and retains CSS-to-physical transforms',async()=>{
  const f=gpuFixture(),{r,ctx}=renderer(f);try{await r.ready;r.resize(64,64,1);r.render(sample(),rgba('#000'));const old=r.msaa;r.resize(33,19,2);assert(old.destroyed);assert.equal(r.msaa,null);r.render(sample(),rgba('#000'));assert.deepEqual(r.msaa.size,[66,38]);assert.deepEqual(ctx.calls.filter(c=>c[0]==='transform').at(-1),['transform',2,0,0,2,0,0]);}finally{r.destroy();f.pool.destroy();}
});
test('device loss immediately paints an immutable last-frame snapshot',async()=>{
  const f=gpuFixture(),{r,ctx,fallback,canvas}=renderer(f);try{await r.ready;const g=sample();r.render(g,rgba('#000'));g.clear();g.rect(100,100,1,1,rgba('#0f0'));r.device.lose();await tick();assert.equal(r.mode,'Canvas 2D');assert.equal(canvas.hidden,true);assert.equal(fallback.hidden,false);assert(ctx.calls.some(c=>c[0]==='rect'&&c[2]===1&&c[3]===2));assert.deepEqual([...r.lastScene.data.slice(0,4)],[1,2,4,5]);}finally{r.destroy();f.pool.destroy();}
});
test('two charts share loss/retry but never destroy one another’s resources',async()=>{
  const f=gpuFixture(),a=renderer(f).r,b=renderer(f).r;try{await Promise.all([a.ready,b.ready]);const device=a.device;assert.strictEqual(device,b.device);assert.equal(a.record.listeners.size,2);a.render(sample(),color);b.render(sample(),color);device.lose();await tick();assert.equal(a.mode,'Canvas 2D');assert.equal(b.mode,'Canvas 2D');await Promise.all([a.retry(),b.retry()]);assert.equal(a.mode,'WebGPU');assert.strictEqual(a.device,b.device);assert.notStrictEqual(a.device,device);a.destroy();assert(!b.device.destroyed);assert.equal(b.record.listeners.size,1);b.render(sample(),color);}finally{a.destroy();b.destroy();f.pool.destroy();}
});
test('backend changes release uniforms/listeners without accumulating loss callbacks',async()=>{
  const f=gpuFixture(),{r}=renderer(f);try{await r.ready;const device=r.device,record=r.record;for(let i=0;i<8;i++){const uniform=r.uniform;await r.setBackend('canvas');assert(uniform.destroyed);assert.equal(device.listeners.size,0);assert.equal(record.listeners.size,0);await r.retry();assert.equal(record.listeners.size,1);assert.equal(device.listeners.size,1);}assert.equal(device.pipelines.length,1);}finally{r.destroy();f.pool.destroy();}
});
test('pending pipeline completion cannot override a later Canvas preference',async()=>{
  const gate=defer(),f=gpuFixture({pipelineGate:gate}),{r,canvas}=renderer(f);try{const pending=r.ready;await tick();await r.setBackend('canvas');gate.resolve();await pending;assert.equal(r.mode,'Canvas 2D');assert(canvas.hidden);assert.equal(r.uniform,null);}finally{r.destroy();f.pool.destroy();}
});
test('destroy during shader compilation cannot configure or allocate chart resources',async()=>{
  const gate=defer(),f=gpuFixture({pipelineGate:gate}),{r,context}=renderer(f);const pending=r.ready;await tick();r.destroy();gate.resolve();await pending;assert.equal(context.configures,0);assert.equal(f.created[0].buffers.length,0);f.pool.destroy();
});
test('initialization timeout stays on Canvas even when a late device arrives',async()=>{
  const gate=defer(),f=gpuFixture({deviceGate:gate}),{r}=renderer(f,{timeout:5});try{await r.ready;assert.match(r.reason,/timed out/);gate.resolve();await tick();assert.equal(r.mode,'Canvas 2D');assert.equal(r.uniform,null);await r.retry();assert.equal(r.mode,'WebGPU');}finally{r.destroy();f.pool.destroy();}
});
test('synchronous and uncaptured GPU failures preserve Canvas operation',async()=>{
  const f=gpuFixture(),{r}=renderer(f);try{await r.ready;r.render(sample(),color);r.device.emitError();assert.equal(r.mode,'Canvas 2D');assert.match(r.reason,/validation/);await r.retry();r.device.queue.submit=()=>{throw new Error('Submission failure');};r.render(sample(),color);assert.equal(r.mode,'Canvas 2D');assert.match(r.reason,/Submission/);}finally{r.destroy();f.pool.destroy();}
});
test('GPU buffer limits fall back without unbounded allocations',async()=>{
  const f=gpuFixture({bufferLimit:256}),{r}=renderer(f);try{await r.ready;const g=new Geometry();for(let i=0;i<6;i++)g.rect(i,0,1,1,color);r.render(g,color);assert.equal(r.mode,'Canvas 2D');assert.match(r.reason,/capacity/);assert.equal(r.lastScene.count,6);}finally{r.destroy();f.pool.destroy();}
});
test('changing sample counts rebuilds the pipeline but retains financial scene',async()=>{
  const f=gpuFixture(),{r}=renderer(f);try{await r.ready;r.render(sample(),color);const data=[...r.lastScene.data];await r.setSamples(1);assert.equal(r.samples,1);assert.equal(r.msaa,null);assert.deepEqual([...r.lastScene.data],data);assert.equal(r.mode,'WebGPU');await assert.rejects(r.setSamples(3),RangeError);await assert.rejects(r.setBackend('unknown'),RangeError);}finally{r.destroy();f.pool.destroy();}
});
test('diagnostic copies cannot mutate renderer state',async()=>{
  const f=gpuFixture(),{r}=renderer(f);try{await r.ready;r.render(sample(),color);const d=r.diagnostics();d.stats.frames=-1;d.dimensions.width=-1;d.adapter.vendor='changed';assert.equal(r.stats.frames,1);assert.equal(r.dimensions.width,1);assert.equal(r.record.info.vendor,'test');assert.match(d.timing,/not GPU/);}finally{r.destroy();f.pool.destroy();}
});
test('invalid geometry and capture bounds fail before GPU work',async()=>{
  const f=gpuFixture(),{r}=renderer(f);try{await r.ready;const n=r.device.queue.submissions.length;assert.throws(()=>r.render({count:1,data:new Float32Array(12)},color),TypeError);const g=sample();g.count=1e9;assert.throws(()=>r.render(g,color),TypeError);r.resize(3000,2000,1);await assert.rejects(r.capturePixels(sample(),color),RangeError);assert.equal(r.device.queue.submissions.length,n);}finally{r.destroy();f.pool.destroy();}
});
test('capture pads rows and destroys all temporary GPU resources',async()=>{
  const f=gpuFixture(),{r}=renderer(f);try{await r.ready;r.resize(33,19,2);const device=r.device,result=await r.capturePixels(sample(),color);assert.equal(result.pixels.length,66*38*4);assert.equal(device.copy[1].bytesPerRow,512);assert.equal(device.copy[1].buffer.destroyed,true);assert(device.textures.every(t=>t.destroyed));assert.equal(r.captureBusy,false);}finally{r.destroy();f.pool.destroy();}
});
test('concurrent captures reject and lifecycle changes invalidate outstanding readbacks',async()=>{
  const f=gpuFixture(),{r}=renderer(f);try{await r.ready;const device=r.device,create=device.createBuffer.bind(device),gate=defer();device.createBuffer=description=>{const b=create(description);if(description.usage&GPUBufferUsage.MAP_READ)b.mapAsync=()=>gate.promise;return b;};const first=r.capturePixels(sample(),color);await assert.rejects(r.capturePixels(sample(),color),/progress/);await r.setBackend('canvas');gate.resolve();await assert.rejects(first,{name:'AbortError'});assert.equal(r.captureBusy,false);assert(device.buffers.filter(b=>b.usage&GPUBufferUsage.MAP_READ).every(b=>b.destroyed));}finally{r.destroy();f.pool.destroy();}
});
test('Canvas diagnostic capture does not replace the retained display scene',async()=>{
  const f=gpuFixture(),{r}=renderer(f,{backend:'canvas'});try{await r.ready;r.resize(32,32,1);r.render(sample(),color);const scene=r.lastScene,data=[...scene.data];const g=new Geometry();g.rect(10,10,2,2,rgba('#0f0'));const out=await r.capturePixels(g,color);assert.equal(out.mode,'Canvas 2D');assert.strictEqual(r.lastScene,scene);assert.deepEqual([...scene.data],data);assert.equal(f.gpu.requests,0);}finally{r.destroy();f.pool.destroy();}
});
test('destroy is idempotent and rejects subsequent async control operations',async()=>{
  const f=gpuFixture(),{r}=renderer(f);await r.ready;r.render(sample(),color);const device=r.device,uniform=r.uniform,buffer=r.buffer;r.destroy();r.destroy();assert(uniform.destroyed&&buffer.destroyed);assert(!device.destroyed);assert.equal(r.lastScene,null);assert.equal(device.listeners.size,0);await assert.rejects(r.retry(),/destroyed/);await assert.rejects(r.setSamples(1),/destroyed/);await assert.rejects(r.capturePixels(sample(),color),/destroyed/);f.pool.destroy();
});

// This regression names the observed compiler error; actual shader compilation
// and execution are required separately by the SwiftShader browser suite.
test('WGSL instance attributes avoid the reserved metadata identifier',()=>{
  assert.doesNotMatch(GEOMETRY_WGSL,/\bmeta\b/);
  assert.match(GEOMETRY_WGSL,/@location\(2\) styleData:vec4f/);
});
