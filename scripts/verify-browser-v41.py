"""v4.1 browser regressions: real IndexedDB, actual workers and fixture observations.
No external exchange, brokerage, email, SMS or push service is contacted.
Run by verify-browser-v4.py so the existing CI workflow retains this evidence.
"""
import asyncio, json, os, socket, subprocess, sys, tempfile, time
from pathlib import Path
from playwright.async_api import async_playwright
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'verification' / 'v4' / 'next'

async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    results, errors = [], []
    with tempfile.TemporaryDirectory(prefix='aureon-v41-browser-') as private:
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
        base = f'http://127.0.0.1:{port}'
        process = subprocess.Popen(['node', 'server.mjs'], cwd=ROOT, env={**os.environ, 'HOST':'127.0.0.1', 'PORT':str(port), 'AUREON_STORAGE':'sqlite', 'AUREON_DATA_DIR':private, 'AUREON_MONITOR':'0'}, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        try:
            async with async_playwright() as p:
                browser = await p.chromium.launch(executable_path=os.environ.get('CHROMIUM','/usr/bin/chromium'), headless=True, args=['--no-sandbox'])
                context = await browser.new_context(viewport={'width':1600,'height':1000})
                await context.route('https://**/*',lambda route:route.abort())
                page = await context.new_page()
                async def wait(predicate):
                    until=time.monotonic()+15
                    while not await page.evaluate(predicate):
                        if time.monotonic()>until:raise TimeoutError(predicate)
                        await asyncio.sleep(.05)
                async def open_page():
                    page.on('pageerror',lambda e:errors.append(str(e)))
                    for _ in range(50):
                        try: await page.goto(base+'/?demo',wait_until='load'); break
                        except Exception as e:
                            if 'ERR_BLOCKED_BY_ADMINISTRATOR' in str(e):raise
                            await asyncio.sleep(.1)
                    await wait('()=>!!globalThis.aureon?.workbench && aureon.app.series.bars.length===1000')
                async def check(name,fn):
                    started=time.perf_counter()
                    try: detail=await fn();results.append({'name':name,'passed':True,'detail':detail})
                    except Exception as e: results.append({'name':name,'passed':False,'error':str(e)})
                    results[-1]['ms']=round(1000*(time.perf_counter()-started),2)
                    print(name,results[-1]['passed'],results[-1].get('error',''),flush=True)
                await open_page()
                async def idb():
                    return await page.evaluate('''async()=>{
                      const {DrawingOutbox}=await import('./src/drawing-outbox.js');
                      const a=new DrawingOutbox({name:'regression-outbox'}),b=new DrawingOutbox({name:'regression-outbox'});
                      const scope='["alice","room","BTC-USD"]',other='["bob","room","BTC-USD"]';
                      const x={actor:'alice.tab1',clock:1,kind:'set',drawing:'x',fields:{color:'#00ff00'}},y={actor:'alice.tab2',clock:1,kind:'set',drawing:'y',fields:{color:'#0000ff'}};
                      await Promise.all([a.put(scope,[x]),b.put(scope,[y])]);
                      if((await a.read(scope)).length!==2)throw Error('Lost concurrent operation');
                      await a.put(other,[x]);await a.acknowledge(scope,[{...x,fields:{color:'#ff0000'}}]);
                      if((await b.read(scope)).length!==2)throw Error('Wrong payload acknowledged');
                      let rejected=false;try{await b.put(scope,[{...x,fields:{color:'#ff0000'}}]);}catch{rejected=true;}
                      if(!rejected||(await a.read(scope)).length!==2)throw Error('Transaction did not roll back');
                      await a.acknowledge(scope,[x]);a.close();b.close();
                      const restored=new DrawingOutbox({name:'regression-outbox'}),saved=await restored.read(scope);
                      if(saved.length!==1||saved[0].actor!==y.actor||(await restored.read(other)).length!==1)throw Error('Acknowledgement lost another tab or scope');
                      restored.close();return{concurrent:2,remaining:saved.length,preciseAcknowledgement:true,rollback:true,scopeIsolation:true};
                    }''')
                await check('IndexedDB transactions preserve concurrent tabs and acknowledge exact operations only',idb)
                async def storage_failure():
                    return await page.evaluate('''async()=>{const {DrawingOutbox}=await import('./src/drawing-outbox.js');const b=new DrawingOutbox({factory:null});try{await b.read('scope');throw Error('Unexpected success');}catch(e){if(!e.message.includes('requires IndexedDB'))throw e;return{explicitFailure:e.message};}}''')
                await check('Unavailable durable storage fails explicitly instead of claiming saved edits',storage_failure)
                async def close_recovery():
                    nonlocal page
                    await page.evaluate("()=>aureon.workbench.server.login('tabrecovery','long-browser-test-password',true)")
                    room=await page.evaluate("async()=>{const w=aureon.workbench;return w.server.request('pro/rooms',{method:'POST',body:{name:'Tab recovery',members:[],payload:w.payload(false)}})}")
                    await page.evaluate("async id=>{const c=aureon.workbench.collaboration;await c.connect(id);clearInterval(c.timer);}",room['id'])
                    await context.route('**/v2/pro/rooms/**/drawings**',lambda route:route.abort())
                    saved=await page.evaluate('''async()=>{const {app:a,workbench:w}=aureon,c=w.collaboration,b=a.series.bars.at(-1);a.chart.commitDrawing({id:'closed-tab-line',type:'hline',points:[{t:b.t,p:b.c}],color:'#ff0000',width:1});await c.persistence;const ops=await c.outbox.read(c.scope);if(!ops.length)throw Error('No durable pending edit');return {count:ops.length,actor:c.replica.actor};}''')
                    await page.close(run_before_unload=False)
                    await context.unroute('**/v2/pro/rooms/**/drawings**')
                    page=await context.new_page();await open_page()
                    result=await page.evaluate('''async id=>{const c=aureon.workbench.collaboration;await c.connect(id);clearInterval(c.timer);const count=c.pending.length,actor=c.replica.actor;await c.synchronize();const rows=await c.outbox.read(c.scope);if(!aureon.app.chart.drawings.some(d=>d.id==='closed-tab-line')||rows.length)throw Error('Recovery or acknowledgement failed');await c.disconnect();return{count,actor,remaining:rows.length};}''',room['id'])
                    assert result['count']==saved['count'] and result['actor']!=saved['actor'],(saved,result)
                    return{'closedTabRecovered':True,'newReplicaIdentity':True,'operations':saved['count']}
                await check('Closing the entire tab retains unacknowledged drawings for an explicit new-tab rejoin',close_recovery)
                async def replay():
                    await page.evaluate('()=>{const w=aureon.workbench;w.currentScript().source='+json.dumps((ROOT/'examples/retained-graphics.aureon').read_text())+';aureon.app.setPanel("script");return w.runScript();}')
                    await wait('()=>aureon.workbench.scriptResult?.bars===1000 && !aureon.workbench.studyBusy')
                    await page.evaluate('()=>aureon.app.startReplay()')
                    await wait('()=>aureon.workbench.scriptResult?.bars===700 && !aureon.workbench.studyBusy')
                    await page.evaluate('()=>aureon.app.seekReplay(300)')
                    await wait('()=>aureon.workbench.scriptResult?.bars===300 && !aureon.workbench.studyBusy')
                    result=await page.evaluate('''()=>{const a=aureon.app,r=aureon.workbench.scriptResult;a.chart.draw();if(!a.chart.labels.some(l=>l.text==='Symbol')||r.graphics.length!==3)throw Error('Historical graphics missing');return{bars:r.bars,objects:r.graphics.length,tableVisible:true};}''')
                    await page.evaluate('()=>aureon.app.stopReplay()');await wait('()=>aureon.workbench.scriptResult?.bars===1000 && !aureon.workbench.studyBusy')
                    return result
                await check('Initial replay seek, rewind and exit rebuild retained graphics from the correct prefix',replay)
                async def stale():
                    return await page.evaluate('''async()=>{const w=aureon.workbench,original=w.jobs.run.bind(w.jobs),saved=w.scriptResult;let resolve;w.jobs.run=(type,...args)=>type==='script'?new Promise(r=>resolve=r):original(type,...args);try{const pending=w.runScript(false);await w.action('clear-script');resolve(saved);await pending;if(w.scriptResult||w.app.chart.scriptGraphics.length)throw Error('Stale worker output restored removed plots');return{staleResultDiscarded:true};}finally{w.jobs.run=original;}}''')
                await check('Late worker completion cannot restore plots after explicit removal',stale)
                async def worker():
                    return await page.evaluate('''async()=>{const {JobClient}=await import('./src/jobs.js'),j=new JobClient();try{if(!j.worker)throw Error('Actual worker required');const source='varip int n = 0\\nn += 1\\nplot(n)';const b={t:60,o:100,h:101,l:99,c:100,v:1,partial:true};const first=await j.run('live-start',[b],{source,interval:60,asOf:61}),next=await j.run('live-update',[],{bar:{...b,v:2},sequence:1,asOf:62});if(first.plots[0].values[0]!==1||next.plots[0].values[0]!==2)throw Error('State lost across worker messages');j.cancel();let rejected=false;try{await j.run('live-update',[],{bar:b,sequence:2,asOf:63});}catch{rejected=true;}if(!rejected)throw Error('Canceled session survived');return{actualWorker:true,updates:2,cancellation:true};}finally{j.destroy();}}''')
                await check('Actual browser worker preserves realtime session state and discards it on cancellation',worker)
                async def ui_live():
                    await page.evaluate('()=>{aureon.app.setPanel("script");aureon.workbench.currentScript().source="indicator(\\"Observed updates\\")\\nvarip int n = 0\\nif barstate.isnew\\n    n := 0\\nn += 1\\nplot(n)";aureon.workbench.renderScript();}')
                    rejected=await page.evaluate("async()=>{try{await aureon.workbench.startLiveScript();return false;}catch(e){return e.message.includes('not replay or synthetic');}}")
                    assert rejected
                    # Fixtures exercise the same accepted-trade listener. No exchange data claimed.
                    await page.evaluate('''async()=>{const {CandleSeries}=await import('./src/core.js'),a=aureon.app,interval=a.state.interval,t=Math.floor(Date.now()/1000/interval)*interval;const bars=Array.from({length:50},(_,i)=>({t:t-(49-i)*interval,o:100,h:102,l:99,c:101,v:10,partial:i===49}));a.series=new CandleSeries(bars,interval);a.kind='market';a.modeLabel='TEST FIXTURE — not a live exchange';a.chart.setData(a.series.bars,{}, {reset:true});a.workbench.updateContext();await a.workbench.refresh();}''')
                    await page.locator('[data-v2="live-script"]').click();await wait('()=>aureon.workbench.scriptResult?.live?.sequence===0')
                    await page.evaluate("()=>{const a=aureon.app;a.market.dispatchEvent(new CustomEvent('trade',{detail:{symbol:a.state.symbol,time:Date.now()/1000,price:101,size:1,id:'v41-fixture-observation'}}));}")
                    await wait('()=>aureon.workbench.scriptResult?.live?.sequence===1')
                    result=await page.evaluate('''()=>{const w=aureon.workbench;if(w.scriptResult.plots[0].values.at(-1)!==2||!w.liveJobs.worker)throw Error('UI listener did not preserve observation state');return{sequence:w.scriptResult.live.sequence,updates:w.scriptResult.plots[0].values.at(-1),actualWorker:!!w.liveJobs.worker,source:'Injected validated fixture observation, not production connectivity'};}''')
                    # A cloned worker dependency must never survive edits in the main window.
                    await page.evaluate('''()=>{const w=aureon.workbench;w.config.libraries['local/changed/1']={source:'export f(x) => x'};w.save();if(w.liveScript)throw Error('Edited library did not stop realtime');}''')
                    await page.locator('[data-v2="live-script"]').click();await wait('()=>!!aureon.workbench.liveScript && !aureon.workbench.liveScript.starting')
                    await page.evaluate('''()=>{const w=aureon.workbench;w.config.research.universe=[{symbol:'FIXTURE',interval:60,source:'test',bars:[{t:0,o:1,h:1,l:1,c:1,v:1}]}];w.save();if(w.liveScript)throw Error('Replaced research did not stop realtime');}''')
                    result['dependencyEditsStopRealtime']=True
                    await page.reload();await wait('()=>aureon.app.kind==="demo" && aureon.app.series.bars.length===1000')
                    return result
                await check('Realtime UI refuses synthetic mode and processes an accepted fixture trade without strategy execution',ui_live)
                async def footprint():
                    await page.evaluate('''()=>{const w=aureon.workbench,a=aureon.app,t=a.series.bars.at(-1).t,p=a.series.bars.at(-1).c;w.observedTrades=Array.from({length:4},(_,i)=>[{t:t+i,price:p+i,size:1,side:'sell'},{t:t+i+.1,price:p+i,size:9,side:'buy'}]).flat();w.pro.tradeSymbol=a.state.symbol;w.pro.tradeSource='OBSERVED-TRADE TEST FIXTURE';w.pro.tab='trades';a.setPanel('pro');}''')
                    form=page.locator('[data-v2form="pro-trade-chart"]')
                    await form.locator('[name="tickSize"]').fill('1');await form.locator('[name="imbalanceMode"]').select_option('same')
                    await form.locator('[name="imbalanceRatio"]').fill('4');await form.locator('[name="imbalanceStack"]').fill('2');await form.locator('[name="valueArea"]').fill('0.8')
                    await form.locator('[type="submit"]').click()
                    result=await page.evaluate('''()=>{const w=aureon.workbench,a=aureon.app;a.chart.draw();if(a.state.style!=='footprint'||w.config.typeOptions.valueArea!==.8||w.config.typeOptions.imbalanceRatio!==4)throw Error('Footprint settings not applied');return{style:a.state.style,options:w.config.typeOptions,geometry:a.chart.geometry.count};}''')
                    await page.screenshot(path=str(OUT/'footprint.png'));return result
                await check('Footprint form applies same-row imbalances, stacked levels and value-area settings',footprint)
                await page.screenshot(path=str(OUT/'workspace.png'))
                report={'tests':results,'passed':sum(r['passed'] for r in results),'failed':sum(not r['passed'] for r in results),'pageErrors':errors,'origin':'HTTP loopback','renderer':await page.evaluate('()=>aureon.app.chart.renderer.mode'),'externalServices':'No production providers or deliveries. Realtime UI used explicitly injected observations.'}
                (OUT/'browser-report.json').write_text(json.dumps(report,indent=2))
                print(json.dumps({k:v for k,v in report.items() if k!='tests'},indent=2),flush=True)
                await browser.close()
                if errors or report['failed']:raise SystemExit(1)
        finally:
            process.terminate()
            try:process.wait(timeout=5)
            except subprocess.TimeoutExpired:process.kill();process.wait()
if __name__=='__main__':
    asyncio.run(main())
    subprocess.run([sys.executable,str(ROOT/'scripts/verify-browser-v42.py')],check=True)
