"""Incremental indicator planning, rollback, tail transport and editor controls.

All observations are explicit test fixtures, never production-provider data.
--document disables workers and checks only UI/runtime fallback. It is not a
substitute for real-origin dedicated-worker and persistence checks in CI.
"""
import asyncio
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
DOCUMENT = '--document' in sys.argv
OUT = ROOT / 'verification' / 'v4' / ('incremental-document' if DOCUMENT else 'incremental')
VARIP = 'indicator("Explicit rollback fallback")\nvarip float count = 0\nif barstate.isnew\n    count := 0\ncount += 1\nplot(count,"Updates")'

async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    tests, errors = [], []
    process = None
    with tempfile.TemporaryDirectory(prefix='aureon-v45-') as private:
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        base = f'http://127.0.0.1:{port}'
        if not DOCUMENT:
            process = subprocess.Popen(['node', 'server.mjs'], cwd=ROOT,
                env={**os.environ, 'HOST':'127.0.0.1', 'PORT':str(port), 'AUREON_DATA_DIR':private, 'AUREON_MONITOR':'0'},
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            async with async_playwright() as p:
                browser = await p.chromium.launch(executable_path=os.environ.get('CHROMIUM', '/usr/bin/chromium'),
                    headless=True, args=['--no-sandbox'])
                context = await browser.new_context(viewport={'width':1440, 'height':1050})
                await context.route('https://**/*', lambda route:route.abort())
                page = await context.new_page()
                page.set_default_timeout(10000)
                page.on('pageerror', lambda error:errors.append(str(error)))

                async def wait(predicate):
                    end = time.monotonic() + 20
                    while not await page.evaluate(predicate):
                        if time.monotonic() > end:
                            raise TimeoutError(predicate)
                        await asyncio.sleep(.04)

                if DOCUMENT:
                    await page.evaluate('()=>{globalThis.Worker=undefined;}')
                    await page.set_content((ROOT/'dist/AureonTerminal.html').read_text().replace(
                        '<html lang="en">', '<html lang="en" data-mode="demo">'), wait_until='load')
                else:
                    for i in range(50):
                        try:
                            await page.goto(base+'/?demo', wait_until='load')
                            break
                        except Exception as error:
                            if 'ERR_BLOCKED_BY_ADMINISTRATOR' in str(error) or i == 49:
                                raise
                            await asyncio.sleep(.1)
                await wait('()=>!!globalThis.aureon?.workbench && !!aureon.app.series && !aureon.app.loading && !aureon.workbench.studyBusy')

                async def check(name, fn):
                    start = time.perf_counter()
                    try:
                        detail = await fn()
                        tests.append({'name':name, 'passed':True, 'detail':detail})
                    except Exception as error:
                        tests.append({'name':name, 'passed':False, 'error':str(error)})
                    tests[-1]['ms'] = round((time.perf_counter()-start)*1000, 2)
                    print(name, tests[-1]['passed'], tests[-1].get('error', ''), flush=True)

                async def load_example():
                    await page.evaluate('()=>aureon.app.setPanel("script")')
                    await page.locator('#script-example').select_option('streaming')
                    await page.locator('[data-v2="example-script"]').click()
                    await page.locator('#realtime-engine').select_option('auto')

                async def planner():
                    await load_example()
                    await page.locator('[data-v2="script-plan"]').click()
                    await wait('()=>!!aureon.workbench.scriptPlan')
                    result = await page.evaluate('()=>aureon.workbench.scriptPlan.result')
                    assert result['supported'] and result['engine']=='incremental', result
                    assert await page.locator('#script-plan-result').count()==1
                    if not DOCUMENT:
                        assert await page.evaluate('()=>!!aureon.workbench.jobs.worker')
                    return result
                await check('Planner inspects the streaming example through the worker job and reports supported kernels', planner)

                async def demo_guard():
                    await page.locator('[data-v2="live-script"]').click()
                    await wait('()=>!!document.querySelector(".toast.error")')
                    assert not await page.evaluate('()=>!!aureon.workbench.liveScript')
                    return {'syntheticRealtimeRejected':True}
                await check('Realtime remains unavailable for the labeled synthetic demonstration', demo_guard)

                async def fixture():
                    return await page.evaluate('''async()=>{
                      const a=aureon.app,w=aureon.workbench,interval=3600,t=Math.floor(Date.now()/1000/interval)*interval;
                      w.stopLiveScript();w.activeScriptSource=null;
                      const bars=Array.from({length:256},(_,i)=>({t:t-(255-i)*interval,o:100+Math.sin(i/7),h:103,l:98,c:101+Math.sin(i/7),v:10,partial:i===255}));
                      a.state.interval=interval;a.chart.interval=interval;a.kind='market';a.loading=false;
                      a.modeLabel='TEST FIXTURE — not a live exchange';
                      a.series=new a.series.constructor(bars,interval);a.chart.setData(a.series.bars,{}, {reset:true});a.setSource();
                      w.updateContext();await w.refresh();a.setPanel('script');
                      document.querySelector('.exchange-name').textContent='INJECTED TEST FIXTURE';
                      globalThis.v45Ledger=JSON.stringify(w.account.snapshot());
                      return {bars:256,source:a.modeLabel};
                    }''')
                await check('Explicit market-transport fixture preserves the simulator account', fixture)

                async def start():
                    await page.locator('[data-v2="live-script"]').click()
                    await wait('()=>!!aureon.workbench.liveScript && !aureon.workbench.liveScript.starting')
                    detail = await page.evaluate('''()=>{const w=aureon.workbench,r=w.scriptResult;
                      if(r.execution.engine!=='incremental'||r.live.sequence!==0||r.bars!==256)throw Error('Incremental seed not installed');
                      globalThis.v45Buffer=r.plots[0].values.buffer;
                      return {engine:r.execution.engine,worker:!!w.liveJobs.worker,bars:r.bars,plots:r.plots.length,session:r.live.sessionId};}''')
                    if not DOCUMENT:
                        assert detail['worker'], detail
                    assert await page.locator('#script-execution-mode').inner_text()=='Incremental graph'
                    return detail
                await check('Editor starts an incremental session with one full seed and the selected worker transport', start)

                async def observation(price=101.1):
                    seq = await page.evaluate('()=>aureon.workbench.liveScript.sequence')
                    await page.evaluate('''price=>{const a=aureon.app;a.market.dispatchEvent(new CustomEvent('trade',{detail:{symbol:a.state.symbol,time:Date.now()/1000,price,size:1,id:'v45-test-'+Math.random()}}));}''', price)
                    await wait('()=>aureon.workbench.scriptResult?.live?.sequence>='+str(seq+1))

                async def tails():
                    for i in range(8):
                        await observation(100+i/10)
                    return await page.evaluate('''()=>{const w=aureon.workbench,r=w.scriptResult;
                      if(r.bars!==256||r.plots.some(p=>p.values.length!==256)||r.plots[0].values.buffer!==globalThis.v45Buffer)throw Error('Tail assembly copied or lost history');
                      if(r.execution.transport!=='tail patch'||r.execution.outputCells>16||r.live.sequence<8||r.commands.length)throw Error('Not bounded tail transport');
                      if(JSON.stringify(w.account.snapshot())!==globalThis.v45Ledger)throw Error('Realtime changed simulator');
                      return {sequence:r.live.sequence,bars:r.bars,numericTailCells:r.execution.outputCells,reusedBuffer:true,orders:0};}''')
                await check('Sequenced intrabar observations patch bounded tails into reusable complete chart buffers', tails)

                async def differential():
                    return await page.evaluate('''async()=>{const w=aureon.workbench,a=aureon.app,r=w.scriptResult;
                      const reference=await w.jobs.run('script',a.series.bars,{source:w.currentScript().source,inputs:w.config.scriptInputs,symbol:a.state.symbol,interval:a.state.interval});
                      let checked=0;
                      for(let p=0;p<r.plots.length;p++)for(let i=0;i<r.bars;i++){
                        const x=r.plots[p].values[i],y=reference.plots[p].values[i];
                        if(!(Object.is(x,y)||Math.abs(x-y)<1e-8))throw Error('Reference differential mismatch '+p+':'+i+':'+x+':'+y);checked++;}
                      a.chart.draw();
                      return {comparedValues:checked,renderedPrimitives:a.chart.geometry.count,engine:r.execution.engine};}''')
                await check('Assembled realtime plot history matches the unchanged reference interpreter', differential)

                async def preference():
                    await page.locator('#realtime-engine').select_option('reference')
                    assert not await page.evaluate('()=>!!aureon.workbench.liveScript')
                    await page.locator('[data-v2="live-script"]').click()
                    await wait('()=>!!aureon.workbench.liveScript && !aureon.workbench.liveScript.starting')
                    await observation(101.2)
                    detail=await page.evaluate('()=>aureon.workbench.scriptResult.execution')
                    assert detail['engine']=='reference' and detail['transport']=='full snapshot', detail
                    return detail
                await check('Changing the execution preference stops the old session and explicitly selects reference execution', preference)

                async def fallback():
                    await page.locator('#script-source').fill(VARIP)
                    assert not await page.evaluate('()=>!!aureon.workbench.liveScript')
                    await page.locator('#realtime-engine').select_option('auto')
                    await page.locator('[data-v2="script-plan"]').click()
                    await wait('()=>!!aureon.workbench.scriptPlan')
                    detail=await page.evaluate('()=>aureon.workbench.scriptPlan.result')
                    assert not detail['supported'] and detail['engine']=='reference' and detail['reason'],detail
                    await page.locator('[data-v2="live-script"]').click()
                    await wait('()=>!!aureon.workbench.liveScript && !aureon.workbench.liveScript.starting')
                    await observation(101.3)
                    values=await page.evaluate('()=>({engine:aureon.workbench.scriptResult.execution.engine,last:aureon.workbench.scriptResult.plots[0].values.at(-1)})')
                    assert values=={'engine':'reference','last':2},values
                    return {**detail,**values}
                await check('Unsupported persistent state selects a visible reference fallback and retains varip semantics', fallback)

                async def forced_rejection():
                    await page.evaluate('()=>{for(const t of document.querySelectorAll(".toast"))t.remove();}')
                    await page.locator('#realtime-engine').select_option('incremental')
                    await page.locator('[data-v2="live-script"]').click()
                    await wait('()=>!!document.querySelector(".toast.error")')
                    assert not await page.evaluate('()=>!!aureon.workbench.liveScript')
                    message=await page.locator('.toast.error').last.inner_text()
                    assert 'Incremental execution unavailable' in message, message
                    return {'error':message,'noSilentFallback':True}
                await check('Incremental-only selection rejects unsupported scripts before arming a session', forced_rejection)

                async def stale():
                    await load_example()
                    await page.locator('[data-v2="live-script"]').click()
                    await wait('()=>!!aureon.workbench.liveScript && !aureon.workbench.liveScript.starting')
                    return await page.evaluate('''async()=>{const w=aureon.workbench,a=aureon.app;
                      a.market.dispatchEvent(new CustomEvent('trade',{detail:{symbol:a.state.symbol,time:Date.now()/1000,price:101,size:1,id:'v45-last-pending'}}));
                      await w.action('clear-script');await new Promise(r=>setTimeout(r,100));
                      if(w.liveScript||w.scriptResult||w.activeScriptSource||a.chart.extraStudies.some(s=>s.id==='user-script'))throw Error('Late output restored removed plots');
                      return {lateTailDiscarded:true,plotsRemoved:true};}''')
                await check('Removing plots during a pending observation cancels transport and rejects stale output', stale)

                async def replay_guard():
                    await page.locator('[data-v2="live-script"]').click()
                    await wait('()=>!!aureon.workbench.liveScript && !aureon.workbench.liveScript.starting')
                    return await page.evaluate('''async()=>{const a=aureon.app,w=aureon.workbench;
                      a.replaying=true;a.chart.setReplay(100);w.onReplay(null,100);
                      if(w.liveScript)throw Error('Replay left live engine armed');
                      a.replaying=false;a.chart.setReplay(null);await w.refresh();
                      return {replayStoppedLive:true};}''')
                await check('Entering replay stops the incremental session instead of applying future tails', replay_guard)

                async def mobile():
                    await page.locator('#realtime-engine').select_option('auto')
                    await page.locator('[data-v2="live-script"]').click()
                    await wait('()=>!!aureon.workbench.liveScript && !aureon.workbench.liveScript.starting')
                    await observation(101.4)
                    await page.evaluate('()=>{for(const t of document.querySelectorAll(".toast"))t.remove();aureon.app.chart.fitAll();aureon.app.chart.draw();document.getElementById("source-text").textContent="Injected test observations — not live exchange data";document.getElementById("feed-badge").textContent="FIXTURE";document.getElementById("watchlist-source").textContent="Synthetic demonstration quotes";}')
                    await page.screenshot(path=str(OUT/'workspace-incremental.png'))
                    await page.set_viewport_size({'width':390,'height':844})
                    detail=await page.evaluate('()=>({width:document.documentElement.scrollWidth,viewport:innerWidth,control:!!document.querySelector("#realtime-engine")})')
                    assert detail['width']<=detail['viewport']+1 and detail['control'], detail
                    await page.screenshot(path=str(OUT/'mobile-incremental.png'))
                    await page.set_viewport_size({'width':1440,'height':1050})
                    return detail
                await check('Execution diagnostics and engine controls remain usable in mobile and desktop workspaces', mobile)

                if not DOCUMENT:
                    async def persistence():
                        await page.locator('#realtime-engine').select_option('reference')
                        await page.reload()
                        await wait('()=>!!globalThis.aureon?.workbench && !aureon.app.loading')
                        await page.evaluate('()=>aureon.app.setPanel("script")')
                        assert await page.locator('#realtime-engine').input_value()=='reference'
                        assert not await page.evaluate('()=>!!aureon.workbench.liveScript')
                        return {'enginePreferenceRetained':True,'noAutomaticRearm':True}
                    await check('Reload persists the execution preference without automatically resuming realtime', persistence)
                await browser.close()
        finally:
            if process:
                process.terminate()
                try:process.wait(timeout=5)
                except subprocess.TimeoutExpired:process.kill();process.wait()
            report={'tests':tests,'passed':sum(x['passed'] for x in tests),'failed':sum(not x['passed'] for x in tests),
                'pageErrors':errors,'origin':'document-mode fallback' if DOCUMENT else 'HTTP loopback',
                'workerTransport':'disabled explicitly' if DOCUMENT else 'real dedicated worker',
                'notRun':['HTTP persistence and real worker transport'] if DOCUMENT else [],
                'externalServices':'None; explicit observation fixtures; no real orders or notifications'}
            (OUT/'browser-report.json').write_text(json.dumps(report,indent=2))
            print(json.dumps({k:report[k] for k in ['passed','failed','pageErrors']}),flush=True)
        assert tests and not errors and all(x['passed'] for x in tests),'Incremental browser regression failed'

if __name__=='__main__':asyncio.run(main())
