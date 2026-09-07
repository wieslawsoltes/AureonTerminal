"""v4.2 numerical studies and parallel screening, using explicit local fixtures.
HTTP mode requires actual workers. --document reports its renderer/worker mode
and skips HTTP reload persistence; it never bypasses browser origin policy.
"""
import asyncio, json, os, socket, subprocess, sys, tempfile, time
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
DOCUMENT='--document' in sys.argv
OUT=ROOT/'verification'/'v4'/('statistics-document' if DOCUMENT else 'statistics-screening')
SOURCE='''indicator("Distribution screen")
plot(close,"Close")
plot(ta.median(close,5),"Median")
plot(ta.percentile_linear_interpolation(close,5,75),"Upper quartile")
plot(ta.variance(close,5),"Variance")'''
async def main():
    OUT.mkdir(parents=True,exist_ok=True)
    tests,errors=[],[]
    with tempfile.TemporaryDirectory(prefix='aureon-v42-') as private:
        with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
        base=f'http://127.0.0.1:{port}'
        process=None
        if not DOCUMENT:
            process=subprocess.Popen(['node','server.mjs'],cwd=ROOT,env={**os.environ,'HOST':'127.0.0.1','PORT':str(port),'AUREON_DATA_DIR':private,'AUREON_MONITOR':'0'},stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        try:
            async with async_playwright() as p:
                browser=await p.chromium.launch(executable_path=os.environ.get('CHROMIUM','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
                context=await browser.new_context(viewport={'width':1600,'height':1050},accept_downloads=True)
                await context.route('https://**/*',lambda route:route.abort())
                page=await context.new_page();page.set_default_timeout(10000)
                page.on('pageerror',lambda e:errors.append(str(e)))
                async def wait(predicate):
                    until=time.monotonic()+20
                    while not await page.evaluate(predicate):
                        if time.monotonic()>until:raise TimeoutError(predicate)
                        await asyncio.sleep(.05)
                async def open_page():
                    if DOCUMENT:
                        await page.evaluate('()=>{globalThis.Worker=undefined;}')  # Explicit worker-unavailable fixture; not a worker success claim.
                        await page.set_content((ROOT/'dist/AureonTerminal.html').read_text().replace('<html lang="en">','<html lang="en" data-mode="demo">'),wait_until='load')
                    else:
                        for i in range(50):
                            try:await page.goto(base+'/?demo',wait_until='load');break
                            except Exception as e:
                                if 'ERR_BLOCKED_BY_ADMINISTRATOR' in str(e):raise
                                if i==49:raise
                                await asyncio.sleep(.1)
                    await wait('()=>!!globalThis.aureon?.workbench && aureon.app.series.bars.length===1000 && !aureon.workbench.studyBusy')
                async def check(name,fn):
                    start=time.perf_counter()
                    try:detail=await fn();tests.append({'name':name,'passed':True,'detail':detail})
                    except Exception as e:tests.append({'name':name,'passed':False,'error':str(e)})
                    tests[-1]['ms']=round(1000*(time.perf_counter()-start),2)
                    print(name,tests[-1]['passed'],tests[-1].get('error',''),flush=True)
                await open_page()
                async def studies():
                    return await page.evaluate('''async()=>{const {app:a,workbench:w}=aureon,types=['median','quantilechannel','interquartile','quartiledeviation','regressionchannel','regressionr2','regressionerror','returnautocorrelation','pricevolumecorrelation','efficiency','vwapbands'];w.config.studies=types.map((type,i)=>({id:'stats-'+i,type,params:{},visible:true}));await w.refresh();a.chart.draw();await w.action('studies',{dataset:{}});if(!document.querySelector('input[placeholder*="84"]'))throw Error('Catalogue count is stale');a.closeModal();if(!a.chart.geometry.count)throw Error('Empty chart');return{added:types.length,geometry:a.chart.geometry.count,worker:!!w.jobs.worker};}''')
                await check('All eleven new study types compute and render with the 84-study catalogue',studies)
                async def script():
                    await page.evaluate('()=>aureon.app.setPanel("script")')
                    await page.locator('#script-source').fill(SOURCE)
                    await page.locator('[data-v2="run-script"]').click()
                    await wait('()=>aureon.workbench.scriptResult?.plots?.some(p=>p.name==="Median")')
                    return await page.evaluate('''()=>{const r=aureon.workbench.scriptResult;if(r.plots.length!==4||r.plots.some(p=>!Number.isFinite(p.values.at(-1))))throw Error('Missing statistical output');return{plots:r.plots.map(p=>p.name),values:r.plots.map(p=>p.values.at(-1))};}''')
                await check('Editor executes rolling median, quartile and variance and returns finite series',script)
                async def scan():
                    await page.evaluate('''()=>{const w=aureon.workbench;w.config.research.universe=Array.from({length:12},(_,j)=>({symbol:'FIX-'+String(j).padStart(2,'0'),interval:j===11?180:60,source:j===10?'=Fixture provenance':'Explicit browser fixture',bars:Array.from({length:62},(_,i)=>({t:i*(j===11?180:60),o:100+j*10+i,h:101+j*10+i,l:99+j*10+i,c:100+j*10+i,v:10+i,partial:i===61}))}));w.pro.tab='scripts';aureon.app.setPanel('pro');}''')
                    form=page.locator('[data-v2form="pro-screen-run"]')
                    await form.locator('[name="cutoff"]').fill('1970-01-01T01:00')
                    await form.locator('[name="workers"]').select_option('2')
                    await form.locator('[type="submit"]').click()
                    await wait('()=>!aureon.workbench.pro.screening.running')
                    result=await page.evaluate('''()=>{const s=aureon.workbench.pro.screening,r=s.result;if(!r?.complete)throw Error(s.state);if(r.rows.length!==12||r.rows.some(row=>row.error)||r.rows[0].bars!==60||r.rows[0].excluded!==2||r.rows[0].time!==3600)throw Error('Invalid frozen cutoff');const p=r.rows[0].plots;if(p.find(x=>x.name==='Median').value!==157||p.find(x=>x.name==='Variance').value!==2||p.find(x=>x.name==='Upper quartile').value!==158)throw Error('Wrong numerical output');if(!document.querySelector('[data-v2="pro-screen-open"][data-index="11"]').disabled)throw Error('Unsupported chart interval not identified');return{workers:r.workers,mode:r.mode,rows:r.rows.length,closedBars:r.totalBars,first:r.rows[0]};}''')
                    if not DOCUMENT:assert result['workers']==2 and result['mode']=='workers',result
                    return result
                await check('Two-worker frozen scan excludes future/provisional bars and keeps all named scalar columns',scan)
                async def filter_query():
                    form=page.locator('[data-v2form="pro-screen-filter"]')
                    await form.locator('[name="field"]').select_option('change')
                    assert await form.locator('[name="op"] option[value="crossup"]').is_disabled()
                    await form.locator('[name="field"]').select_option('price')
                    await form.locator('[name="otherField"]').select_option('age')
                    assert await form.locator('[name="op"] option[value="crossdown"]').is_disabled()
                    await form.locator('[name="otherField"]').select_option('')
                    assert not await form.locator('[name="op"] option[value="crossup"]').is_disabled()
                    await form.locator('[name="field"]').select_option('plot:Median');await form.locator('[name="op"]').select_option('>=');await form.locator('[name="value"]').fill('197');await form.locator('[type="submit"]').click()
                    await page.locator('#script-screen-sort').select_option('plot:Median');await page.locator('#script-screen-direction').select_option('asc');await page.locator('#script-screen-limit').select_option('10')
                    return await page.evaluate('''()=>{const s=aureon.workbench.pro.screening,buttons=[...document.querySelectorAll('#script-screen-output [data-v2="pro-screen-open"]')];if(buttons.length!==8||buttons[0].textContent!=='FIX-04'||s.query.sort!=='plot:Median'||s.query.filters.length!==1)throw Error('Filtering or sorting failed');return{matches:buttons.length,first:buttons[0].textContent,query:s.query};}''')
                await check('Actual form predicates and stable plot-column sorting select eight matches',filter_query)
                async def csv():
                    async with page.expect_download() as info:await page.locator('#script-screen-csv').click()
                    download=await info.value;path=OUT/'screen.csv';await download.save_as(path);text=path.read_text()
                    assert "'=Fixture provenance" in text and 'Upper quartile' in text and 'FIX-04' in text and 'FIX-00' not in text,text[:500]
                    return{'filename':download.suggested_filename,'lines':len(text.splitlines()),'formulaSafe':True,'columns':'all named plots'}
                await check('Filtered CSV exports all named columns and guards formula-looking provenance',csv)
                async def templates():
                    page.once('dialog',lambda dialog:dialog.accept('Median threshold'))
                    await page.locator('[data-v2="pro-screen-save"]').click()
                    await page.locator('[data-v2="pro-screen-clear"]').click()
                    await page.locator('[data-v2="pro-screen-load"]').click()
                    before=await page.evaluate('()=>{const w=aureon.workbench;if(w.config.screenTemplates.length!==1||w.pro.screening.query.filters.length!==1)throw Error("Template restore failed");return{query:w.pro.screening.query,template:w.config.screenTemplates[0]};}')
                    if not DOCUMENT:
                        await page.reload();await wait('()=>!!globalThis.aureon?.workbench && aureon.app.series.bars.length===1000')
                        restored=await page.evaluate('()=>({query:aureon.workbench.pro.screening.query,template:aureon.workbench.config.screenTemplates[0]})')
                        assert before==restored,(before,restored)
                    return{'saved':True,'loaded':True,'survivesReload':not DOCUMENT}
                await check('Saved query templates restore conditions and persist through workspace storage',templates)
                async def isolated_snapshot():
                    return await page.evaluate('''async()=>{const w=aureon.workbench,p=w.pro.screening,c=p.client,options={source:'plot(close,"Captured")',universe:[{symbol:'CAPTURE',interval:60,source:'Frozen fixture',bars:Array.from({length:50},(_,i)=>({t:i*60,o:i+1,h:i+1,l:i+1,c:i+1,v:1}))}],asOf:3000,workers:2};const task=c.run(options);options.source='plot(999,"Changed")';options.universe[0].bars[49].c=999;const r=await task;if(r.rows[0].plots[0].value!==50||r.rows[0].plots[0].name!=='Captured')throw Error('Mutable input leaked into worker');const child=c.dataset(0);child.bars[0].c=-1;if(c.dataset(0).bars[0].c!==1)throw Error('Mutable dataset export');return{immutableInput:true,immutableDataset:true,mode:r.mode};}''')
                await check('Running scans and later dataset exports are isolated from caller mutations',isolated_snapshot)
                async def cancel():
                    return await page.evaluate('''async()=>{const w=aureon.workbench,chartWorker=w.jobs.worker,liveWorker=w.liveJobs?.worker,c=w.pro.screening.client;let progress=0;const pending=c.run({source:'plot(ta.variance(close,30),"V")',universe:[{symbol:'CANCEL',interval:60,source:'Cancellation fixture',bars:Array.from({length:2000},(_,i)=>({t:i*60,o:100+i,h:100+i,l:100+i,c:100+i,v:1}))}],asOf:120000,workers:2},()=>progress++);if(!c.cancel())throw Error('No active scan to cancel');let aborted=false;try{await pending;}catch(e){if(e.name!=='AbortError')throw e;aborted=true;}await new Promise(r=>setTimeout(r,50));if(!aborted||progress||w.jobs.worker!==chartWorker||w.liveJobs?.worker!==liveWorker)throw Error('Cancellation crossed worker ownership');return{aborted,lateProgress:progress,chartUnchanged:true,liveUnchanged:true};}''')
                await check('Cancellation terminates only the scanner pool and suppresses all late progress',cancel)
                async def open_snapshot():
                    # Repeat via the real UI after reload/cancellation, and open the captured row.
                    await scan()
                    await page.locator('[data-v2="pro-screen-clear"]').click()
                    await page.locator('#script-screen-direction').select_option('asc')
                    await page.locator('[data-v2="pro-screen-open"][data-index="0"]').click()
                    await wait('()=>aureon.app.kind==="import" && aureon.app.state.symbol==="FIX-00"')
                    return await page.evaluate('''()=>{const a=aureon.app;if(a.series.bars.length!==60||a.series.bars.at(-1).c!==159||a.state.interval!==60)throw Error('Snapshot was replaced or reopened with future data');return{kind:a.kind,symbol:a.state.symbol,bars:a.series.bars.length,lastTime:a.series.bars.at(-1).t};}''')
                await check('Opening a completed row installs the exact frozen dataset rather than live prices',open_snapshot)
                async def mobile():
                    await page.set_viewport_size({'width':390,'height':844})
                    await page.evaluate('()=>{aureon.workbench.pro.tab="scripts";aureon.app.setPanel("pro");}')
                    await asyncio.sleep(.1)
                    dims=await page.evaluate('()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,run:!!document.getElementById("script-screen-run")})')
                    assert dims['document']<=dims['viewport']+1 and dims['run'],dims
                    await page.screenshot(path=str(OUT/'mobile.png'));return dims
                await check('Mobile screening controls wrap without document-width overflow',mobile)
                await page.set_viewport_size({'width':1600,'height':1050});await page.locator('#script-screen-heading').scroll_into_view_if_needed();await page.screenshot(path=str(OUT/'workspace.png'))
                report={'tests':tests,'passed':sum(t['passed'] for t in tests),'failed':sum(not t['passed'] for t in tests),'pageErrors':errors,'origin':'document injection' if DOCUMENT else 'HTTP loopback','notRun':['HTTP reload persistence','required dedicated workers'] if DOCUMENT else [],'renderer':await page.evaluate('()=>aureon.app.chart.renderer.mode'),'externalServices':'None; all data from explicit deterministic fixtures'}
                (OUT/'browser-report.json').write_text(json.dumps(report,indent=2));print(json.dumps({k:v for k,v in report.items() if k!='tests'},indent=2),flush=True)
                await browser.close()
                if report['failed'] or errors:raise SystemExit(1)
        finally:
            if process:
                process.terminate()
                try:process.wait(timeout=5)
                except subprocess.TimeoutExpired:process.kill();process.wait()
if __name__=='__main__':asyncio.run(main())
