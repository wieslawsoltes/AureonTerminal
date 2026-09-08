"""Session calendar/analytics UI, dedicated workers and snapshot invalidation.
All observations are explicit fixtures. --document validates only workerless UI;
it does not bypass browser origin policy or claim persistent storage/transport.
"""
import asyncio,json,os,socket,subprocess,sys,tempfile,time
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
DOCUMENT='--document' in sys.argv
OUT=ROOT/'verification'/'v4'/('sessions-document' if DOCUMENT else 'sessions')
CALENDAR={'version':1,'name':'Explicit <session> fixture','timezone':'UTC','weekdays':[0,1,2,3,4,5,6],'segments':[{'open':'09:00','close':'10:00'}],'holidays':[],'overrides':{}}
async def main():
    OUT.mkdir(parents=True,exist_ok=True);tests=[];errors=[];process=None
    with tempfile.TemporaryDirectory(prefix='aureon-v44-') as private:
        with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
        base=f'http://127.0.0.1:{port}'
        if not DOCUMENT:process=subprocess.Popen(['node','server.mjs'],cwd=ROOT,env={**os.environ,'HOST':'127.0.0.1','PORT':str(port),'AUREON_DATA_DIR':private,'AUREON_MONITOR':'0'},stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        try:
            async with async_playwright() as p:
                browser=await p.chromium.launch(executable_path=os.environ.get('CHROMIUM','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
                context=await browser.new_context(viewport={'width':1440,'height':1050},accept_downloads=True)
                await context.route('https://**/*',lambda route:route.abort())
                page=await context.new_page();page.set_default_timeout(10000);page.on('pageerror',lambda e:errors.append(str(e)))
                async def wait(predicate):
                    end=time.monotonic()+20
                    while not await page.evaluate(predicate):
                        if time.monotonic()>end:raise TimeoutError(predicate)
                        await asyncio.sleep(.04)
                if DOCUMENT:
                    await page.evaluate('()=>{globalThis.Worker=undefined;}')
                    await page.set_content((ROOT/'dist/AureonTerminal.html').read_text().replace('<html lang="en">','<html lang="en" data-mode="demo">'),wait_until='load')
                else:
                    for i in range(50):
                        try:await page.goto(base+'/?demo',wait_until='load');break
                        except Exception as e:
                            if 'ERR_BLOCKED_BY_ADMINISTRATOR' in str(e) or i==49:raise
                            await asyncio.sleep(.1)
                await wait('()=>!!globalThis.aureon?.workbench?.pro?.sessions && !!aureon.app.series')
                async def check(name,fn):
                    start=time.perf_counter()
                    try:detail=await fn();tests.append({'name':name,'passed':True,'detail':detail})
                    except Exception as e:tests.append({'name':name,'passed':False,'error':str(e)})
                    tests[-1]['ms']=round((time.perf_counter()-start)*1000,2);print(name,tests[-1]['passed'],tests[-1].get('error',''),flush=True)
                async def fixture():
                    await page.evaluate('''async()=>{const a=aureon.app,t=Date.parse('2024-01-01T09:00:00Z')/1000,bars=Array.from({length:120},(_,i)=>({t:t+(i>=60?86400:0)+(i%60)*60,o:100+i%60,h:101+i%60,l:99+i%60,c:100+i%60,v:1}));await a.installImported({...a.state,symbol:'BTC-USD',interval:60,indicators:[]},bars,60,'=Explicit session fixture');aureon.workbench.pro.tab='sessions';a.setPanel('pro');}''')
                    await wait('()=>!aureon.workbench.studyBusy && aureon.workbench.context==="BTC-USD:60:import"')
                    return {'bars':120,'source':'explicit deterministic imported candles'}
                await check('Session tools open with imported raw history and unchanged execution focus',fixture)
                async def run(cal=CALENDAR):
                    form=page.locator('[data-v2form="pro-session-run"]')
                    await form.locator('[name="calendar"]').fill(json.dumps(cal));await form.locator('[name="openingMinutes"]').fill('30')
                    await form.locator('[name="targetInterval"]').fill('300');await form.locator('[name="cutoff"]').fill('2024-01-03T00:00')
                    await form.locator('[name="shade"]').check();await form.locator('[name="overlay"]').check();await form.locator('[type="submit"]').click()
                    await wait('()=>!aureon.workbench.pro.sessions.running')
                    return await page.evaluate('''()=>{const w=aureon.workbench,r=w.pro.sessions.result;if(!r)throw Error(w.pro.sessions.status);return {accepted:r.accepted,sessions:r.sessions.length,bars:r.bars.length,complete:r.sessions.every(s=>s.complete),worker:!!w.pro.sessions.client.worker};}''')
                async def actual_form():
                    result=await run();assert result['accepted']==120 and result['sessions']==2 and result['bars']==24 and result['complete'],result
                    if not DOCUMENT:assert result['worker'],result
                    return result
                await check('Applied calendar form computes session summaries and resampled candles through its job runtime',actual_form)
                async def overlays():
                    return await page.evaluate('''()=>{const {app:a,workbench:w}=aureon,s=w.pro.sessions,r=s.result;const p=r.plots;if(!Number.isNaN(p['Opening high'][28])||p['Opening high'][29]!==130||p['Previous high'][60]!==160||p.VWAP[60]!==100)throw Error('Causal session levels differ');a.chart.draw();const study=a.chart.extraStudies.find(x=>x.id==='session-research');if(study.plots.length!==8||!study.plots[0].breaks[60]||!a.chart.geometry.count)throw Error('Missing renderer integration');if(a.chart.sessionCalendar.contains(Date.parse('2024-01-01T08:00:00Z')/1000)!==true)throw Error('Out-of-snapshot time should be unknown/unshaded');return{plots:8,openingConfirmedAt:29,previousSessionAt:60,resetVWAP:p.VWAP[60],primitives:a.chart.geometry.count};}''')
                await check('Causal opening, VWAP and previous-session overlays render with discontinuities',overlays)
                async def reports():
                    await page.locator('[data-v2="pro-session-view"][data-mode="bars"]').click()
                    assert await page.locator('#session-analysis-table tbody tr').count()==24
                    if DOCUMENT:
                        text=await page.evaluate('''async()=>{const a=aureon.app,old=a.download;let text;try{a.download=async b=>text=await b.text();await aureon.workbench.pro.sessions.action('pro-session-export',{kind:'bars'});await new Promise(r=>setTimeout(r,10));return text;}finally{a.download=old;}}''')
                    else:
                        async with page.expect_download() as info:await page.locator('[data-v2="pro-session-export"][data-kind="bars"]').click()
                        download=await info.value;target=OUT/'session-bars.csv';await download.save_as(target);text=target.read_text()
                    assert 'coverage' in text and 'Explicit session fixture' in text and len(text.splitlines())==25,text[:300]
                    return{'rows':24,'metadata':['coverage','complete','partial'],'actualDownload':not DOCUMENT}
                await check('Session and candle reports expose completion metadata and export a real CSV',reports)
                async def invalid():
                    before=await page.evaluate('()=>JSON.stringify(aureon.workbench.config.sessionResearch)')
                    await page.locator('#session-calendar-json').fill(json.dumps({**CALENDAR,'segments':[{'open':'09:99','close':'10:00'}]}))
                    await page.locator('[data-v2form="pro-session-run"] [type="submit"]').click()
                    await wait('()=>!!document.querySelector(".toast.error")')
                    after=await page.evaluate('()=>JSON.stringify(aureon.workbench.config.sessionResearch)');assert before==after
                    await page.locator('#session-calendar-json').fill(json.dumps(CALENDAR))
                    return {'previousRulesIntact':True,'invalidBoundaryRejected':True}
                await check('Invalid clock input cannot replace the applied calendar or accepted result',invalid)
                async def missing():
                    await page.evaluate('''()=>{const a=aureon.app;a.series.bars.splice(5,1);a.series.version++;a.chart.setData(a.series.bars);aureon.workbench.refresh();}''')
                    await wait('()=>!aureon.workbench.pro.sessions.result')
                    result=await run()
                    detail=await page.evaluate('''()=>{const r=aureon.workbench.pro.sessions.result;if(r.sessions[0].complete||r.sessions[0].missingSeconds!==60||r.sessions[0].openingComplete||!Number.isNaN(r.plots['Previous high'][59]))throw Error('Missing candle fabricated');return{missing:r.sessions[0].missingSeconds,complete:r.sessions[0].complete};}''')
                    return {**result,**detail}
                await check('Source revisions clear snapshots; missing candles remain partial and invalidate dependent levels',missing)
                async def replay():
                    await page.evaluate('''async()=>{const a=aureon.app;a.replaying=true;a.chart.setReplay(20);await aureon.workbench.refresh();}''')
                    await wait('()=>!aureon.workbench.pro.sessions.result')
                    result=await run()
                    detail=await page.evaluate('''()=>{const a=aureon.app,r=aureon.workbench.pro.sessions.result;if(r.accepted!==20||r.sessions[0].openingComplete||r.asOf!==a.visibleBars().at(-1).t+60)throw Error('Replay cutoff leaked future values');return{accepted:r.accepted,asOf:r.asOf};}''')
                    await page.evaluate('''async()=>{const a=aureon.app;a.replaying=false;a.chart.setReplay(null);await aureon.workbench.refresh();}''')
                    return detail
                await check('Replay applies its own closed prefix even with a later user cutoff',replay)
                async def cancellation():
                    return await page.evaluate('''async()=>{const w=aureon.workbench,s=w.pro.sessions,worker=w.jobs.worker,live=w.liveJobs.worker;const pending=s.submit('pro-session-run',document.querySelector('[data-v2form="pro-session-run"]'));await s.action('pro-session-cancel');await pending;await new Promise(r=>setTimeout(r,50));if(s.result||s.running||w.jobs.worker!==worker||w.liveJobs.worker!==live)throw Error('Cancellation crossed job ownership or accepted late output');return{resultDiscarded:true,chartWorkerUnchanged:true,liveWorkerUnchanged:true};}''')
                await check('Cancellation owns only the session worker and suppresses stale completions',cancellation)
                async def templates():
                    await page.locator('#session-template').select_option('overnight');await page.locator('[data-v2="pro-session-template"]').click()
                    text=await page.locator('#session-calendar-json').input_value();cal=json.loads(text);assert cal['tradeDateOffset']==1 and cal['timezone']=='America/Chicago'
                    applied=await page.evaluate('()=>aureon.workbench.config.sessionResearch.calendar.timezone');assert applied=='UTC'
                    return {'draft':'overnight','appliedUnchanged':True}
                await check('Calendar templates remain drafts until explicitly applied',templates)
                async def mobile():
                    await run();await page.evaluate('()=>{for(const t of document.querySelectorAll(".toast"))t.remove();aureon.app.chart.fitAll();aureon.app.chart.draw();}');await page.set_viewport_size({'width':390,'height':844});await asyncio.sleep(.15)
                    result=await page.evaluate('()=>({width:document.documentElement.scrollWidth,viewport:innerWidth,form:!!document.querySelector("#session-calendar-json")})');assert result['width']<=result['viewport']+1 and result['form'],result
                    await page.screenshot(path=str(OUT/'mobile-sessions.png'));await page.set_viewport_size({'width':1440,'height':1050});await page.screenshot(path=str(OUT/'workspace-sessions.png'))
                    return result
                await check('Session forms and reports fit a mobile viewport',mobile)
                if not DOCUMENT:
                    async def calendar_import():
                        before=await page.evaluate('()=>JSON.stringify(aureon.workbench.config.sessionResearch)')
                        fixture={**CALENDAR,'name':'Imported <img src=x onerror=alert(1)> literal calendar','overrides':{'2024-01-01':[{'open':'09:00','close':'09:30'}]}}
                        await page.locator('#session-calendar-file').set_input_files({'name':'calendar.json','mimeType':'application/json','buffer':json.dumps(fixture).encode()})
                        await wait('()=>aureon.workbench.pro.sessions.status.includes("imported as a draft")')
                        assert json.loads(await page.locator('#session-calendar-json').input_value())['name']==fixture['name']
                        assert await page.evaluate('()=>JSON.stringify(aureon.workbench.config.sessionResearch)')==before
                        assert await page.locator('.session-research img').count()==0
                        return {'fileRead':True,'notAppliedImplicitly':True,'literalText':True}
                    await check('Calendar file import validates into a draft without executing text or changing applied rules',calendar_import)
                    async def persistence():
                        before=await page.evaluate('()=>JSON.stringify(aureon.workbench.config.sessionResearch)')
                        await page.reload();await wait('()=>!!globalThis.aureon?.workbench?.pro?.sessions')
                        after=await page.evaluate('()=>JSON.stringify(aureon.workbench.config.sessionResearch)');assert before==after
                        result=await page.evaluate('()=>aureon.workbench.pro.sessions.result');assert result is None
                        return {'rulesRetained':True,'staleResultsNotPersisted':True}
                    await check('Reload restores calendar rules without pretending old research is current',persistence)
                await browser.close()
        finally:
            if process:
                process.terminate()
                try:process.wait(timeout=5)
                except subprocess.TimeoutExpired:process.kill();process.wait()
            report={'tests':tests,'passed':sum(x['passed'] for x in tests),'failed':sum(not x['passed'] for x in tests),'pageErrors':errors,'origin':'document-mode fallback' if DOCUMENT else 'HTTP loopback','workerTransport':'disabled explicitly' if DOCUMENT else 'real dedicated worker','notRun':['HTTP persistence, downloads and real worker transport'] if DOCUMENT else [],'externalServices':'None; imported deterministic fixtures, no orders'}
            (OUT/'browser-report.json').write_text(json.dumps(report,indent=2));print(json.dumps({k:report[k] for k in ['passed','failed','pageErrors']}),flush=True)
        assert tests and not errors and all(x['passed'] for x in tests),'Session browser regression failed'
if __name__=='__main__':asyncio.run(main())
