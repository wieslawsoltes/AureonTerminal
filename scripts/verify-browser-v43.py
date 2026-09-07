"""Renderer UI and required SwiftShader WebGPU primitive checks.
The software backend verifies actual WGSL/device execution, not hardware speed.
Runs on a real loopback origin in CI; local administrator policies are not bypassed.
"""
import asyncio,base64,json,os,shutil,socket,subprocess,sys,tempfile,time
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'verification'/'v4'/'renderer'
# Match Chromium's Vulkan/SwiftShader pixel-test configuration: the compositor
# uses ANGLE-on-SwiftShader, not ANGLE Vulkan requiring unavailable WSI extensions.
GPU_FLAGS=['--enable-unsafe-webgpu','--use-webgpu-adapter=swiftshader','--use-vulkan=swiftshader','--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-features=Vulkan','--disable-vulkan-surface']
async def main():
    OUT.mkdir(parents=True,exist_ok=True);tests=[];errors=[];warnings=[];adapter=None;version=None
    with tempfile.TemporaryDirectory(prefix='aureon-v43-') as private:
        with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
        base=f'http://127.0.0.1:{port}'
        process=subprocess.Popen(['node','server.mjs'],cwd=ROOT,env={**os.environ,'HOST':'127.0.0.1','PORT':str(port),'AUREON_DATA_DIR':private,'AUREON_MONITOR':'0'},stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        try:
            async with async_playwright() as p:
                browser=await p.chromium.launch(executable_path=os.environ.get('CHROMIUM','/usr/bin/chromium'),headless=False,args=['--no-sandbox',*GPU_FLAGS]);version=browser.version
                context=await browser.new_context(viewport={'width':1440,'height':960},accept_downloads=True)
                await context.route('https://**/*',lambda route:route.abort())
                page=await context.new_page();page.set_default_timeout(10000);page.on('pageerror',lambda e:errors.append(str(e)));page.on('console',lambda m:warnings.append(m.text) if m.type=='warning' and len(warnings)<100 else None)
                async def wait(predicate):
                    end=time.monotonic()+25
                    while not await page.evaluate(predicate):
                        if time.monotonic()>end:raise TimeoutError(predicate+' '+json.dumps(await page.evaluate('()=>aureon.app.chart.renderer.diagnostics()')))
                        await asyncio.sleep(.05)
                for i in range(60):
                    try:await page.goto(base+'/?demo',wait_until='load');break
                    except Exception as e:
                        if 'ERR_BLOCKED_BY_ADMINISTRATOR' in str(e) or i==59:raise
                        await asyncio.sleep(.1)
                await wait('()=>!!globalThis.aureon?.workbench && aureon.app.series.bars.length===1000')
                async def check(name,fn):
                    start=time.perf_counter()
                    try:detail=await fn();tests.append({'name':name,'passed':True,'detail':detail})
                    except Exception as e:tests.append({'name':name,'passed':False,'error':str(e)})
                    tests[-1]['ms']=round((time.perf_counter()-start)*1000,2);print(name,tests[-1]['passed'],tests[-1].get('error',''),flush=True)
                async def device():
                    nonlocal adapter
                    result=await page.evaluate('''async()=>{const r=aureon.app.chart.renderer;await r.ready;aureon.app.chart.draw();if(r.mode!=='WebGPU')throw Error(r.reason);if(!r.diagnostics().stats.gpuFrames)throw Error('No actual GPU frame');const info=r.diagnostics();if(info.adapter.fallback!==true&&!/swiftshader/i.test(JSON.stringify(info.adapter)))throw Error('Expected fallback-adapter signal or software identity: '+JSON.stringify(info.adapter));if(document.querySelector('.version').textContent!=='v'+aureon.releaseVersion||aureon.releaseVersion!=='4.3.0')throw Error('Release identity differs');return info;}''')
                    adapter=result['adapter'];return result
                await check('Actual application acquires SwiftShader and submits its native WGSL pipeline',device)
                async def presentation():
                    try:
                        await page.evaluate('''async()=>{
                          const {Renderer,RendererDevicePool,Geometry,rgba}=await import('./src/renderer.js');
                          const pool=new RendererDevicePool(),canvas=document.createElement('canvas');
                          canvas.id='gpu-presentation-fixture';canvas.style.cssText='position:fixed;left:8px;top:8px;z-index:2147483647';document.body.append(canvas);
                          const r=new Renderer(canvas,document.createElement('canvas'),null,{pool,samples:4});
                          globalThis.rendererPresentationFixture={r,pool,canvas};await r.ready;if(r.mode!=='WebGPU')throw Error(r.reason);
                          r.resize(64,64,1);const g=new Geometry();g.rect(4,4,24,24,rgba('#ff0000'));g.rect(36,36,20,20,rgba('#00ff00'));r.render(g,rgba('#000000'));
                          await r.device.queue.onSubmittedWorkDone();await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
                        }''')
                        # Allow the virtual display compositor to present the one-shot frame.
                        # No continuous redraw is used to manufacture screenshot content.
                        await asyncio.sleep(1)
                        png=await page.locator('#gpu-presentation-fixture').screenshot()
                        (OUT/'gpu-presentation.png').write_bytes(png)
                        return await page.evaluate('''async png=>{
                          const image=new Image();image.src='data:image/png;base64,'+png;await image.decode();
                          const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
                          const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
                          const samples=[[8,8,[255,0,0,255]],[44,44,[0,255,0,255]],[1,1,[0,0,0,255]]];
                          for(const [x,y,expected]of samples){const actual=ctx.getImageData(x,y,1,1).data;if(actual.some((v,i)=>Math.abs(v-expected[i])>1))throw Error('Presented WebGPU pixel differs: '+x+','+y+' '+[...actual]);}
                          if(rendererPresentationFixture.r.mode!=='WebGPU')throw Error('Presentation used fallback');return{width:image.width,height:image.height,presentedPixelSamples:samples.length,renderer:'WebGPU',source:'Browser compositor screenshot, not offscreen readback'};
                        }''',base64.b64encode(png).decode('ascii'))
                    finally:
                        await page.evaluate('()=>{const x=globalThis.rendererPresentationFixture;if(x){x.r.destroy();x.pool.destroy();x.canvas.remove();delete globalThis.rendererPresentationFixture;}}')
                await check('Browser compositor presents actual WebGPU canvas pixels',presentation)
                await page.screenshot(path=str(OUT/'workspace-webgpu.png'))
                async def pixels():
                    return await page.evaluate('''async()=>{const{rendererPixelCheck}=await import('./src/renderer-health.js');const result=await rendererPixelCheck();if(!result.passed||result.mode!=='WebGPU'||result.tests.length!==6)throw Error(JSON.stringify(result));return result;}''')
                await check('Six GPU readback fixtures verify opaque rectangles, alpha, line and clear pixels',pixels)
                async def antialias():
                    return await page.evaluate('''async()=>{const{Renderer,RendererDevicePool,Geometry,rgba}=await import('./src/renderer.js');const pool=new RendererDevicePool(),r=new Renderer(document.createElement('canvas'),document.createElement('canvas'),null,{pool,samples:1});try{await r.ready;if(r.mode!=='WebGPU')throw Error(r.reason);r.resize(64,64,1);const g=new Geometry();g.line(4,7,57,48,rgba('#ffffff'),1);const first=await r.capturePixels(g,rgba('#000000'));await r.setSamples(4);if(r.mode!=='WebGPU')throw Error(r.reason);const second=await r.capturePixels(g,rgba('#000000'));const partial=image=>{let n=0;for(let i=0;i<image.pixels.length;i+=4)if(image.pixels[i]>0&&image.pixels[i]<255)n++;return n;};const one=partial(first),four=partial(second);if(four<=one||four<20)throw Error('No resolved multisample edge coverage: '+one+'/'+four);return{singleSamplePartialPixels:one,multisamplePartialPixels:four,samples:second.samples};}finally{r.destroy();pool.destroy();}}''')
                await check('4x multisampling resolves measurable diagonal edge coverage',antialias)
                async def dpi():
                    return await page.evaluate('''async()=>{const{Renderer,RendererDevicePool,Geometry,rgba}=await import('./src/renderer.js');const pool=new RendererDevicePool(),r=new Renderer(document.createElement('canvas'),document.createElement('canvas'),null,{pool,samples:4});try{await r.ready;if(r.mode!=='WebGPU')throw Error(r.reason);r.resize(33,19,2);const g=new Geometry();g.rect(4,4,5,5,rgba('#d02070'));const image=await r.capturePixels(g,rgba('#000'));if(image.width!==66||image.height!==38)throw Error('Wrong physical dimensions');const pixel=[...image.pixels.slice((12*66+12)*4,(12*66+12)*4+4)];if(pixel.some((v,i)=>Math.abs(v-[208,32,112,255][i])>1))throw Error('DPR/color mismatch '+pixel);r.render(g,rgba('#000'));const buffer=r.buffer,texture=r.msaa;r.render(g,rgba('#000'));if(buffer!==r.buffer||texture!==r.msaa)throw Error('Reallocated stable resources');g.rect(10,10,10,10,rgba('#fff'));r.render(g,rgba('#000'));if(r.diagnostics().stats.drawCalls!==1)throw Error('Not instanced');return{width:image.width,height:image.height,pixel,uploadBytes:r.diagnostics().stats.uploadedBytes,draws:r.diagnostics().stats.drawCalls};}finally{r.destroy();pool.destroy();}}''')
                await check('High-DPI geometry, padded readback and reusable one-draw buffers work on a real device',dpi)
                async def canvas_parity():
                    return await page.evaluate('''async()=>{const{Renderer,RendererDevicePool,Geometry,rgba}=await import('./src/renderer.js');const pool=new RendererDevicePool(),r=new Renderer(document.createElement('canvas'),document.createElement('canvas'),null,{pool,samples:1});try{await r.ready;if(r.mode!=='WebGPU')throw Error(r.reason);r.resize(64,64,1);const g=new Geometry();g.rect(4,4,30,20,rgba('#ff0000'));g.rect(14,8,20,26,rgba('#00ff00',.5));g.line(5,48,45,48,rgba('#3377bb'),4);const gpu=await r.capturePixels(g,rgba('#181818'));await r.setBackend('canvas');const cpu=await r.capturePixels(g,rgba('#181818'));let max=0;const points=[[1,1],[8,8],[18,12],[20,30],[20,48]];for(const [x,y]of points)for(let c=0;c<4;c++)max=Math.max(max,Math.abs(gpu.pixels[(y*64+x)*4+c]-cpu.pixels[(y*64+x)*4+c]));if(max>1)throw Error('Interior pixel disagreement: '+max);return{points:points.length,maxChannelDifference:max};}finally{r.destroy();pool.destroy();}}''')
                await check('GPU and independent Canvas rendering agree on interior color and blend samples',canvas_parity)
                async def loss():
                    return await page.evaluate('''async()=>{const{Renderer,RendererDevicePool,Geometry,rgba}=await import('./src/renderer.js');const pool=new RendererDevicePool(),make=()=>new Renderer(document.createElement('canvas'),document.createElement('canvas'),null,{pool}),a=make(),b=make();try{await Promise.all([a.ready,b.ready]);if(a.mode!=='WebGPU'||b.mode!=='WebGPU'||a.device!==b.device)throw Error('Shared acquisition failed');a.resize(64,64,1);b.resize(64,64,1);const g=new Geometry();g.rect(0,0,20,20,rgba('#f00'));a.render(g,rgba('#000'));b.render(g,rgba('#000'));const old=a.device;old.destroy();await old.lost;for(let i=0;i<100&&(a.mode!=='Canvas 2D'||b.mode!=='Canvas 2D');i++)await new Promise(r=>setTimeout(r,10));if(a.mode!=='Canvas 2D'||b.mode!=='Canvas 2D')throw Error('Loss did not preserve Canvas rendering');const cpu=await a.capturePixels(g,rgba('#000'));if(cpu.pixels[(8*64+8)*4]!==255)throw Error('Fallback lost geometry');await Promise.all([a.retry(),b.retry()]);if(a.mode!=='WebGPU'||b.mode!=='WebGPU'||a.device!==b.device||a.device===old)throw Error('Recovery failed: '+JSON.stringify([a.diagnostics(),b.diagnostics()]));a.destroy();const result=await b.capturePixels(g,rgba('#000'));if(result.pixels[(8*64+8)*4]!==255)throw Error('Destroying one chart broke the other');return{simulatedLoss:'GPUDevice.destroy() test; not a physical driver crash',recovered:true,otherChartUnaffected:true};}finally{a.destroy();b.destroy();pool.destroy();}}''')
                await check('Explicit device destruction exercises two-chart loss, fallback and fresh-device recovery',loss)
                async def resize():
                    return await page.evaluate('''async()=>{const{Renderer,RendererDevicePool,Geometry,rgba}=await import('./src/renderer.js');const pool=new RendererDevicePool(),r=new Renderer(document.createElement('canvas'),document.createElement('canvas'),null,{pool});try{await r.ready;if(r.mode!=='WebGPU')throw Error(r.reason);const g=new Geometry();g.rect(0,0,10,10,rgba('#fff'));for(const size of[32,65,80]){r.resize(size,32,1);for(const samples of[1,4]){await r.setSamples(samples);if(r.mode!=='WebGPU')throw Error(r.reason);const out=await r.capturePixels(g,rgba('#000'));if(out.width!==size||out.pixels[(5*size+5)*4]!==255)throw Error('Stale resize target');}}if(r.diagnostics().stats.errors)throw Error('Unexpected validation error');return{sizes:3,sampleModes:2,errors:r.diagnostics().stats.errors};}finally{r.destroy();pool.destroy();}}''')
                await check('Resize and sample-count changes rebuild device-local targets without validation errors',resize)
                async def controls():
                    await page.evaluate('()=>aureon.app.openSettings()')
                    await page.locator('#renderer-backend').select_option('canvas');await wait('()=>aureon.app.chart.renderer.mode==="Canvas 2D"')
                    await page.locator('#renderer-samples').select_option('1');await page.locator('[data-action="renderer-retry"]').click();await wait('()=>aureon.app.chart.renderer.mode==="WebGPU"')
                    assert await page.locator('#renderer-backend').input_value()=='auto'
                    await page.locator('[data-action="renderer-pixels"]').click();await wait('()=>!aureon.app.pixelCheckBusy')
                    result=json.loads(await page.locator('#renderer-pixel-result').inner_text());assert result['passed'] and result['mode']=='WebGPU'
                    async with page.expect_download() as item:await page.locator('[data-action="renderer-report"]').click()
                    download=await item.value;path=OUT/'renderer-diagnostics.json';await download.save_as(path);data=json.loads(path.read_text());assert data['mode']=='WebGPU' and data['samples']==1
                    return{'pixelTests':len(result['tests']),'diagnosticExport':True,'samples':data['samples']}
                await check('Settings operate backend, quality, explicit retry, pixel checks and diagnostic export',controls)
                async def immutable_chart():
                    return await page.evaluate('''async()=>{const a=aureon.app,r=a.chart.renderer,drawings=JSON.stringify(a.chart.drawings),bars=a.series.bars.map(x=>x.c),jobs=a.workbench.jobs;for(let i=0;i<3;i++){await r.setBackend('canvas');await r.retry();}if(JSON.stringify(a.chart.drawings)!==drawings||a.series.bars.some((b,i)=>b.c!==bars[i])||a.workbench.jobs!==jobs)throw Error('Backend changes mutated chart data or workers');a.closeModal();a.chart.draw();return{bars:bars.length,drawingsPreserved:true,analysisWorkerPreserved:true,gpuFrames:r.diagnostics().stats.gpuFrames};}''')
                await check('Backend changes preserve chart data, drawing identities and analysis workers',immutable_chart)
                async def export_chart():
                    await page.evaluate('async()=>{await aureon.app.chart.renderer.setBackend("canvas");aureon.app.chart.draw();}')
                    async with page.expect_download() as item:await page.locator('[data-action="snapshot"]').first.click()
                    download=await item.value;await download.save_as(OUT/'chart-export.png')
                    assert (OUT/'chart-export.png').read_bytes().startswith(b'\x89PNG\r\n\x1a\n')
                    await page.screenshot(path=str(OUT/'workspace.png'))
                    await page.set_viewport_size({'width':390,'height':844});await page.evaluate('()=>aureon.app.openSettings()');await asyncio.sleep(.2)
                    detail=await page.evaluate('()=>({viewport:innerWidth,width:document.documentElement.scrollWidth,controls:!!document.querySelector("#renderer-backend")})');assert detail['width']<=detail['viewport']+1 and detail['controls'];await page.screenshot(path=str(OUT/'mobile.png'));return detail
                await check('Canvas chart export and mobile renderer controls remain functional',export_chart)
                await browser.close()
        finally:
            process.terminate()
            try:process.wait(timeout=5)
            except subprocess.TimeoutExpired:process.kill();process.wait()
            report={'tests':tests,'passed':sum(t['passed'] for t in tests),'failed':sum(not t['passed'] for t in tests),'pageErrors':errors,'warnings':warnings,'origin':'HTTP loopback','renderer':'Actual WebGPU with forced SwiftShader, plus independent Canvas 2D comparison','adapter':adapter,'browserVersion':version,'displayMode':'headed; virtual X11 in Linux CI','gpuFlags':GPU_FLAGS,'notRun':['Physical GPU throughput/driver failure','Full WebGPU conformance suite','Production data and brokerage'],'externalServices':'None; deterministic local fixtures only'}
            (OUT/'browser-report.json').write_text(json.dumps(report,indent=2));print(json.dumps({'passed':report['passed'],'failed':report['failed'],'pageErrors':errors}),flush=True)
        assert tests and not errors and all(t['passed'] for t in tests), 'Renderer browser checks failed'
if __name__=='__main__':
    # Headless Chromium's SwiftShader swap-chain screenshot path was transparent
    # even when readback and lifecycle tests passed. Real presentation is required;
    # use the CI-provisioned virtual display, never weaken or skip pixel assertions.
    if sys.platform.startswith('linux') and not os.environ.get('DISPLAY'):
        if os.environ.get('GITHUB_ACTIONS')!='true' or not shutil.which('xvfb-run'):
            raise SystemExit('GPU presentation verification requires a display. Run: xvfb-run -a python scripts/verify-browser-v43.py')
        os.execvp('xvfb-run',['xvfb-run','-a',sys.executable,str(Path(__file__).resolve()),*sys.argv[1:]])
    asyncio.run(main())

