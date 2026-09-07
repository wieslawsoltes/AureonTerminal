"""v4 integration: real renderer, worker scripts, causal feedback and shared rooms.
Run normally on a permitted HTTP loopback origin. --document tests the static
client in restricted environments; it explicitly skips authenticated transport.
No production providers, notification recipients or broker credentials are used.
"""
import asyncio, json, os, socket, subprocess, sys, tempfile, time
from pathlib import Path
from playwright.async_api import async_playwright
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'verification' / 'v4'
DOCUMENT = '--document' in sys.argv

async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    results, errors = [], []
    with tempfile.TemporaryDirectory(prefix='aureon-v4-browser-') as private:
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
        base = f'http://127.0.0.1:{port}'
        process = subprocess.Popen(['node', 'server.mjs'], cwd=ROOT, env={**os.environ, 'HOST':'127.0.0.1', 'PORT':str(port), 'AUREON_STORAGE':'sqlite', 'AUREON_DATA_DIR':private, 'AUREON_MONITOR':'0'}, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        try:
            async with async_playwright() as playwright:
                browser = await playwright.chromium.launch(executable_path=os.environ.get('CHROMIUM', '/usr/bin/chromium'), headless=True, args=['--no-sandbox'])
                context = await browser.new_context(viewport={'width':1600, 'height':1000})
                page = await context.new_page(); page.set_default_timeout(10000)
                page.on('pageerror', lambda e: errors.append(str(e)))
                async def wait(p, predicate, timeout=10):
                    until=time.monotonic()+timeout
                    while not await p.evaluate(predicate):
                        if time.monotonic()>until: raise TimeoutError(predicate)
                        await asyncio.sleep(.05)
                async def open_page(p):
                    if DOCUMENT:
                        await p.set_content((ROOT/'dist/AureonTerminal.html').read_text().replace('<html lang="en">','<html lang="en" data-mode="demo">'), wait_until='load')
                    else:
                        for _ in range(40):
                            try: await p.goto(base+'/?demo', wait_until='load'); break
                            except Exception: await asyncio.sleep(.1)
                    await wait(p,'() => !!globalThis.aureon?.workbench && aureon.app.series.bars.length===1000')
                async def check(name, fn):
                    started=time.perf_counter()
                    try: detail=await fn(); results.append({'name':name,'passed':True,'detail':detail,'ms':round(1000*(time.perf_counter()-started),2)})
                    except Exception as e: results.append({'name':name,'passed':False,'error':str(e)})
                    print(name, results[-1]['passed'], results[-1].get('error',''), flush=True)
                await open_page(page)
                async def graphics():
                    await page.evaluate("() => aureon.app.setPanel('script')")
                    source=(ROOT/'examples/retained-graphics.aureon').read_text()
                    await page.locator('#script-source').fill(source)
                    await page.locator('[data-v2="run-script"]').click()
                    await wait(page,"() => aureon.workbench.scriptResult?.graphics?.length===3")
                    return await page.evaluate("() => {const a=aureon.app; a.chart.draw();if(a.chart.scriptGraphics.length!==3)throw Error('graphics not connected');if(!a.chart.labels.some(l=>l.text==='Symbol'))throw Error('table not rendered');return {graphics:a.chart.scriptGraphics.length,geometry:a.chart.geometry.count,worker:!!aureon.workbench.jobs.worker};}")
                await check('Script editor creates retained chart geometry and a literal-text status table', graphics)
                async def visual_copy():
                    return await page.evaluate("async()=>{const w=aureon.workbench,r=await w.jobs.run('script',w.bars(),{source:['var b = box.new(0,70000,5,60000,text=\"Bounded\")','var l = label.new(0,60000,\"<img id=attack src=x>\")'].join(String.fromCharCode(10))});if(r.graphics.length!==2||document.getElementById('attack'))throw Error('unsafe graphics');return {objects:r.graphics.length,literal:r.graphics[1].text};}")
                await check('Worker returns box and label data without creating arbitrary DOM',visual_copy)
                async def feedback():
                    await page.evaluate("() => aureon.app.setPanel('script')")
                    source='strategy("Causal feedback")\nif bar_index == 1 and strategy.position_size == 0\n    strategy.entry("test", strategy.long, qty=1)\nif bar_index == 10 and strategy.position_size > 0\n    strategy.close("test")\nplot(strategy.position_size, "Position")'
                    await page.locator('#script-source').fill(source)
                    await page.evaluate("() => aureon.app.setPanel('lab')")
                    await page.locator('[data-v2form="lab"] [name="signal"]').select_option('script')
                    await page.locator('[data-v2form="lab"] [name="stopPct"]').fill('0')
                    await page.locator('[data-v2form="lab"] [name="takePct"]').fill('0')
                    await page.locator('#run-lab').click()
                    await wait(page,'() => !!aureon.workbench.labResult?.script')
                    return await page.evaluate("()=>{const r=aureon.workbench.labResult,v=r.script.plots[0].values;if(r.trades.length!==1||v[1]!==0||v[2]!==1||v[10]!==1||v[11]!==0)throw Error('causal feedback');return {trades:r.trades.length,position:Array.from(v.slice(0,13)),equity:r.equity.at(-1).value};}")
                await check('Advanced tester form exposes fill-aware position history and next-open exits',feedback)
                async def libraries():
                    return await page.evaluate("async()=>{const w=aureon.workbench,r=await w.jobs.run('script',w.bars(),{source:['import fixture/derived/1 as d','plot(d.value(x=close))'].join(String.fromCharCode(10)),libraries:{'fixture/base/1':{source:'export value(x) => x * 2'},'fixture/derived/1':{source:['import fixture/base/1 as b','export value(x) => b.value(x) + 1'].join(String.fromCharCode(10))}}});if(r.plots[0].values.at(-1)!==w.bars().at(-1).c*2+1)throw Error('library result');return {result:r.plots[0].values.at(-1),worker:!!w.jobs.worker};}")
                await check('Worker links nested explicit libraries and named series arguments',libraries)
                async def replay():
                    await graphics()
                    return await page.evaluate("()=>{const c=aureon.app.chart;c.setReplay(500);c.draw();if(c.labels.some(l=>l.text==='Symbol'))throw Error('future retained table leaked');c.setReplay(null);c.draw();return {replayFutureHidden:true};}")
                await check('Direct replay hides future retained-object mutations',replay)
                async def mobile():
                    await page.set_viewport_size({'width':390,'height':844})
                    await page.evaluate("()=>{aureon.workbench.pro.tab='collaborate';aureon.app.setPanel('pro')}")
                    await asyncio.sleep(.1)
                    dimensions=await page.evaluate("()=>({viewport:innerWidth,document:document.documentElement.scrollWidth})")
                    assert dimensions['document']<=dimensions['viewport']+1,dimensions
                    await page.screenshot(path=str(OUT/'mobile.png'))
                    await page.set_viewport_size({'width':1600,'height':1000})
                    return dimensions
                await check('v4 controls remain within a mobile viewport',mobile)
                if not DOCUMENT:
                    other_context=await browser.new_context(viewport={'width':1400,'height':900})
                    other=await other_context.new_page();other.on('pageerror',lambda e:errors.append(str(e)));await open_page(other)
                    await page.evaluate("()=>aureon.workbench.server.login('alicev4','browser-test-v4-password',true)")
                    await other.evaluate("()=>aureon.workbench.server.login('bobv4','browser-test-v4-password',true)")
                    bob=await other.evaluate('()=>aureon.workbench.server.profile.user.id')
                    room=await page.evaluate("async member=>{const w=aureon.workbench;return w.server.request('pro/rooms',{method:'POST',body:{name:'Browser review',members:[member],payload:w.payload(false)}})}",bob)
                    async def join(p):
                        await p.evaluate("async id=>{const w=aureon.workbench;await w.pro.action('pro-room-load',{dataset:{id}});}",room['id'])
                        await p.locator('[data-v2="pro-drawings-connect"]').click()
                        await wait(p,'()=>!!aureon.workbench.collaboration.replica')
                        await p.evaluate('()=>clearInterval(aureon.workbench.collaboration.timer)')
                    async def join_rooms():
                        await join(page);await join(other)
                        await page.evaluate("()=>{const a=aureon.app,b=a.series.bars.at(-1);a.chart.commitDrawing({id:'shared-browser-line',type:'hline',points:[{t:b.t,p:b.c}],color:'#ff0000',width:1});}")
                        await page.evaluate('()=>aureon.workbench.collaboration.synchronize()')
                        await other.evaluate('()=>aureon.workbench.collaboration.synchronize()')
                        assert await other.evaluate("()=>aureon.app.chart.drawings.some(d=>d.id==='shared-browser-line')")
                        return {'members':2,'transport':'authenticated HTTP','storage':'sqlite'}
                    await check('Two isolated signed-in browsers join shared drawings through UI controls',join_rooms)
                    async def concurrent():
                        for ctx in [context,other_context]: await ctx.set_offline(True)
                        await page.evaluate("()=>{const a=aureon.app,b=structuredClone(a.chart.drawings),n=structuredClone(b);n.find(d=>d.id==='shared-browser-line').color='#00ff00';a.drawingChanged(b,n);}")
                        await other.evaluate("()=>{const a=aureon.app,b=structuredClone(a.chart.drawings),n=structuredClone(b);n.find(d=>d.id==='shared-browser-line').width=3;a.drawingChanged(b,n);}")
                        await wait(page,'()=>!aureon.workbench.collaboration.inFlight')
                        await wait(other,'()=>!aureon.workbench.collaboration.inFlight')
                        for ctx in [context,other_context]: await ctx.set_offline(False)
                        for p in [page,other,page]: await p.evaluate('()=>aureon.workbench.collaboration.synchronize()')
                        a=await page.evaluate("()=>aureon.app.chart.drawings.find(d=>d.id==='shared-browser-line')")
                        b=await other.evaluate("()=>aureon.app.chart.drawings.find(d=>d.id==='shared-browser-line')")
                        assert a==b and a['color']=='#00ff00' and a['width']==3,(a,b)
                        return a
                    await check('Offline disjoint edits converge after reconnection without dropping either property',concurrent)
                    async def undo():
                        await page.evaluate("()=>aureon.app.action('undo')")
                        for p in [page,other]:await p.evaluate('()=>aureon.workbench.collaboration.synchronize()')
                        result=await other.evaluate("()=>aureon.app.chart.drawings.find(d=>d.id==='shared-browser-line')")
                        assert result['color']=='#ff0000' and result['width']==3,result
                        return result
                    await check('Normal chart undo preserves the remote author width change',undo)
                    async def reload_queue():
                        await context.route('**/v2/pro/rooms/**/drawings**',lambda route:route.abort())
                        await page.evaluate("()=>{const a=aureon.app,b=structuredClone(a.chart.drawings),n=structuredClone(b);n.find(d=>d.id==='shared-browser-line').color='#0000ff';a.drawingChanged(b,n);}")
                        await wait(page,'()=>!aureon.workbench.collaboration.inFlight')
                        assert await page.evaluate('()=>aureon.workbench.collaboration.pending.length>0 && !!sessionStorage.getItem(aureon.workbench.collaboration.storageKey)')
                        page.once('dialog',lambda d:d.accept())
                        await page.reload(wait_until='load')
                        await wait(page,'()=>!!globalThis.aureon?.workbench')
                        await context.unroute('**/v2/pro/rooms/**/drawings**')
                        await join(page)
                        await page.evaluate('()=>aureon.workbench.collaboration.synchronize()')
                        await other.evaluate('()=>aureon.workbench.collaboration.synchronize()')
                        result=await other.evaluate("()=>aureon.app.chart.drawings.find(d=>d.id==='shared-browser-line')")
                        assert result['color']=='#0000ff' and result['width']==3,result
                        return {'tabQueueRecovered':True,'drawing':result}
                    await check('Unacknowledged operation IDs survive a reload and are retried idempotently',reload_queue)
                    async def disconnect():
                        await page.locator('[data-v2="pro-drawings-disconnect"]').click()
                        await wait(page,'()=>!aureon.workbench.collaboration.replica')
                        await other.evaluate('()=>aureon.workbench.collaboration.disconnect()')
                        assert await page.evaluate('()=>aureon.workbench.collaboration.pending.length===0')
                        return {'flushed':True}
                    await check('Leaving the room flushes acknowledged operations and restores local history',disconnect)
                    await other_context.close()
                await graphics()
                await page.screenshot(path=str(OUT/'workspace.png'))
                report={'tests':results,'passed':sum(x['passed'] for x in results),'failed':sum(not x['passed'] for x in results),'pageErrors':errors,'origin':'document injection' if DOCUMENT else 'HTTP loopback','notRun':['authenticated multi-browser collaboration','reconnect and reload recovery'] if DOCUMENT else [],'renderer':await page.evaluate('()=>aureon.app.chart.renderer.mode'),'externalServices':'Not contacted; synthetic demonstration only'}
                (OUT/'browser-report.json').write_text(json.dumps(report,indent=2))
                print(json.dumps({k:v for k,v in report.items() if k!='tests'},indent=2),flush=True)
                await browser.close()
                if errors or report['failed']:raise SystemExit(1)
        finally:
            process.terminate()
            try:process.wait(timeout=10)
            except subprocess.TimeoutExpired:process.kill();process.wait()
if __name__=='__main__':asyncio.run(main())
