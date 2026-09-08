import {Renderer,RendererDevicePool,Geometry,rgba} from './renderer.js';
/** Small opt-in primitive test using the real shader, upload, blend, MSAA and
 * texture-to-buffer path. Never sends results or destroys the chart device.
 * It is not full API conformance, a performance benchmark or certification.
 */
export async function rendererPixelCheck(){
  if(!globalThis.document)throw new Error('Pixel verification requires a browser');
  const pool=new RendererDevicePool(),canvas=document.createElement('canvas'),fallback=document.createElement('canvas');
  const renderer=new Renderer(canvas,fallback,null,{pool,samples:4});
  try{
    await renderer.ready;
    if(renderer.mode!=='WebGPU')return{passed:false,mode:renderer.mode,reason:renderer.reason,tests:[],notRun:['Real WGSL and GPU readback unavailable']};
    renderer.resize(64,64,1);const g=new Geometry();
    g.rect(4,4,24,24,rgba('#ff0000'));g.rect(16,16,24,24,rgba('#00ff00',.5));
    g.line(4,48,44,48,rgba('#ffffff'),4);g.rect(60,60,-8,-8,rgba('#0000ff'));
    const image=await renderer.capturePixels(g,rgba('#000000'));
    const cases=[['opaque rectangle',8,8,[255,0,0,255]],['ordered alpha blend',20,20,[127,128,0,255]],['half alpha over black',35,35,[0,128,0,255]],['line interior',20,48,[255,255,255,255]],['negative rectangle normalization',55,55,[0,0,255,255]],['untouched opaque background',0,0,[0,0,0,255]]];
    const tests=cases.map(([name,x,y,expected])=>{const actual=Array.from(image.pixels.slice((y*image.width+x)*4,(y*image.width+x)*4+4));return{name,passed:actual.every((v,i)=>Math.abs(v-expected[i])<=1),expected,actual};});
    return{passed:tests.every(t=>t.passed),mode:image.mode,samples:image.samples,adapter:renderer.diagnostics().adapter,tests,notRun:['Physical hardware throughput and full WebGPU conformance']};
  }finally{renderer.destroy();pool.destroy();}
}
