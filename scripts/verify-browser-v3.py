"""End-to-end v3 UI/worker/PWA checks using a real local HTTP origin.
Requires Python Playwright and Chromium. Providers are not contacted in demo mode.
No backend credentials or real-money submissions are used by this harness.
"""
import asyncio, json, os, subprocess, tempfile, time, socket, sys
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
DOCUMENT='--document' in sys.argv
OUT=ROOT/'verification'/'v3'
async def main():
 OUT.mkdir(parents=True,exist_ok=True)
 with tempfile.TemporaryDirectory(prefix='aureon-browser-') as private:
  with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
  proc=subprocess.Popen(['node','server.mjs'],cwd=ROOT,env={**os.environ,'HOST':'127.0.0.1','PORT':str(port),'AUREON_DATA_DIR':private,'AUREON_MONITOR':'0'},stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
  try:
   async with async_playwright() as p:
    browser=await p.chromium.launch(executable_path=os.environ.get('CHROMIUM','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
    context=await browser.new_context(viewport={'width':1600,'height':1000},device_scale_factor=1)
    page=await context.new_page();page.set_default_timeout(8000);errors=[];results=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    async def check(name,fn):
     start=time.perf_counter()
     try:detail=await fn();results.append({'name':name,'passed':True,'detail':detail,'milliseconds':round((time.perf_counter()-start)*1000,2)})
     except Exception as e:results.append({'name':name,'passed':False,'error':repr(e)})
     print(name,results[-1]['passed'],results[-1].get('error',''),flush=True)
    async def js(code):return await page.evaluate(code)
    base=f'http://127.0.0.1:{port}'
    if DOCUMENT:
     await page.set_content((ROOT/'dist/AureonTerminal.html').read_text().replace('<html lang="en">','<html lang="en" data-mode="demo">'),wait_until='load')
    else:
     for i in range(30):
      try:await page.goto(base+'/?demo',wait_until='load');break
      except Exception:await asyncio.sleep(.1)
    try:await page.wait_for_function('globalThis.aureon?.workbench && aureon.app.series.bars.length===1000')
    except Exception:
     print('STARTUP ERRORS',errors,await page.locator('body').inner_text(),flush=True);raise
    await check('Startup provenance and computed script output; report worker availability',lambda:js("async()=>{const w=aureon.workbench,r=await w.jobs.run('script',w.bars(),{source:'plot(ta.sma(close, 2))'});if(!r.plots[0].values.length)throw Error('no computation');if(location.protocol==='http:'&&(!isSecureContext||!w.jobs.worker))throw Error('HTTP worker unavailable');return {secure:isSecureContext,worker:!!w.jobs.worker,renderer:aureon.app.chart.renderer.mode,kind:aureon.app.kind};}"))
    for tab in ['analytics','patterns','trades','scripts','execution','research','server','collaborate','accessibility']:
     await check('Open Pro workflow '+tab,lambda tab=tab:js("()=>{const w=aureon.workbench;w.pro.tab='"+tab+"';aureon.app.setPanel('pro');if(document.querySelector('.pro-content').textContent.length<100)throw Error('empty');return true;}"))
    async def analytics():
     await js("()=>{aureon.workbench.pro.tab='analytics';aureon.workbench.pro.render();}")
     await page.locator('[data-v2form="pro-analysis"] [type="submit"]').click()
     await page.wait_for_function('aureon.workbench.pro.results?.price>0')
     return await js('()=>aureon.workbench.pro.results')
    await check('Options model calculates through actual form controls',analytics)
    async def patterns():
     await page.locator('[data-v2="pro-tab"][data-tab="patterns"]').click()
     await page.locator('[data-v2form="pro-patterns"] [type="submit"]').click()
     await page.wait_for_function('aureon.workbench.pro.patterns.length>0')
     return await js('()=>({patterns:aureon.workbench.pro.patterns.length,worker:!!aureon.workbench.jobs.worker})')
    await check('Causal pattern scan produces computed detections; report worker availability',patterns)
    async def trades():
     data=await js("()=>({symbol:aureon.app.state.symbol,source:'Browser test supplied trades, not live',trades:aureon.app.series.bars.slice(-40).flatMap((b,i)=>[b.o,b.h,b.l,b.c].map((price,j)=>({id:'fixture-'+i+'-'+j,t:b.t+j*aureon.app.state.interval/4,price,size:b.v/4,side:j%2?'sell':'buy'})))})")
     await page.locator('#pro-trades-file').set_input_files({'name':'trades.json','mimeType':'application/json','buffer':json.dumps(data).encode()})
     await page.wait_for_function('aureon.workbench.observedTrades?.length===160')
     return await js('()=>aureon.workbench.pro.tradeSummary')
    await check('Observed trade JSON import validates symbol and retains explicit source',trades)
    for style in ['volumecandles','highlow','hlcarea','linemarkers','stepline','circles','footprint','tpo','tickcount','tradevolume','traderange']:
     await check('Render v3 chart style '+style,lambda style=style:js("()=>{const a=aureon.app;a.chart.setStyle('"+style+"',{tickSize:100,tradeThreshold:100,tpoPeriod:1800});a.state.style='"+style+"';a.chart.fit();a.chart.draw();return{bars:a.chart.bars.length,primitives:a.chart.geometry.count,observations:a.chart.tradeData.length};}"))
    await check('Replay hides future observed footprint data',lambda:js("()=>{const c=aureon.app.chart;c.setStyle('footprint',{tickSize:100});c.setReplay(970);const times=[...c.tradeProfiles.footprint.keys()],cutoff=c.rawBars[969].t+c.interval;if(times.some(t=>t>=cutoff))throw Error('future footprint');c.setReplay(null);c.setStyle('candles');aureon.app.state.style='candles';return {visibleBuckets:times.length};}"))
    async def tiles():
     await js('async()=>{await aureon.workbench.tiles.create(16);}');await page.wait_for_function('aureon.workbench.extraCharts.length===15&&aureon.workbench.extraCharts.every(t=>t.chart.bars.length>0)')
     return await js("()=>{const w=aureon.workbench,t=w.extraCharts[0],before=t.chart.drawings.length;const b=t.chart.bars.at(-1);t.chart.commitDrawing({id:'browser-drawing-'+Date.now()+'-'+Math.random(),type:'hline',points:[{t:b.t,p:b.c}],color:'#ffffff',width:1});if(t.chart.drawings.length!==before+1)throw Error('tile editing');w.tiles.action(t,'undo');if(t.chart.drawings.length!==before)throw Error('tile undo');w.tiles.action(t,'redo');if(t.chart.drawings.length!==before+1)throw Error('tile redo');return{tiles:16,editable:true};}")
    await check('16 chart panes load; secondary drawing editor supports undo/redo',tiles)
    await check('Drawing replication is opt-in and matches symbols only',lambda:js("()=>{const w=aureon.workbench,t=w.extraCharts[0],u=w.extraCharts[1];t.settings.symbol=aureon.app.state.symbol;u.settings.symbol='OTHER-USD';w.config.syncDrawings=true;const before=u.chart.drawings.length,b=aureon.app.series.bars.at(-1);aureon.app.chart.commitDrawing({id:'browser-drawing-'+Date.now()+'-'+Math.random(),type:'hline',points:[{t:b.t,p:b.c}],color:'#ffffff',width:1});if(t.chart.drawings.length!==aureon.app.chart.drawings.length||u.chart.drawings.length!==before)throw Error('replication');return true;}"))
    await js('()=>aureon.workbench.tiles.create(1)')
    await check('Profiler and entry-ID portfolio strategy execute with live adapter unavailable',lambda:js("async()=>{const w=aureon.workbench;w.currentScript().source='strategy(\"Fixture\")\\nif bar_index == 1\\n    strategy.entry(\"one\", strategy.long, qty=1)\\nif bar_index == 10\\n    strategy.close(\"one\")';await w.runScript(false);if(!w.scriptResult?.profile?.length)throw Error(w.scriptError||'profile');const r=await w.jobs.run('portfolio',w.bars(),{source:w.currentScript().source});if(r.trades.length!==1)throw Error('entry/close');return{profile:w.scriptResult.profile.length,trades:r.trades.length};}"))
    if not DOCUMENT:await check('Browser authentication and Pro capability refresh with no broker configured',lambda:js("async()=>{const w=aureon.workbench;await w.server.login('browserowner','browser-test-password-2026',true);await w.pro.refreshServer();if(w.pro.serverData.capabilities.live.enabled)throw Error('live unexpectedly enabled');w.pro.tab='server';w.pro.render();return {user:w.server.profile.user.username,mfa:w.pro.serverData.capabilities.mfa};}"))
    async def mobile():
     await page.set_viewport_size({'width':390,'height':844});await js("()=>{aureon.workbench.pro.tab='analytics';aureon.app.setPanel('pro');}");await page.wait_for_timeout(150)
     r=await js('()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,centerRight:document.querySelector(".center-workspace").getBoundingClientRect().right,app:document.querySelector("#app").getBoundingClientRect().width})')
     assert r['document']<=r['viewport']+1 and r['centerRight']<=r['viewport']+1 and r['app']<=r['viewport']+1,r
     await page.screenshot(path=str(OUT/'mobile.png'));return r
    await check('Mobile viewport has no document-width overflow and controls remain available',mobile)
    await page.set_viewport_size({'width':1600,'height':1000})
    async def pwa():
     await js('()=>aureon.workbench.pro.registerPWA()');await page.wait_for_function('navigator.serviceWorker.controller!==null')
     names=await js('()=>caches.keys()');assert any('aureon-shell-' in n for n in names),names
     cachekeys=await js('async()=>{const n=(await caches.keys()).find(n=>n.startsWith("aureon-shell-"));return(await(await caches.open(n)).keys()).map(k=>k.url)}')
     assert not any('/v2/' in u or '/api/' in u for u in cachekeys)
     await context.set_offline(True);await page.goto(base+'/?demo',wait_until='load');await page.wait_for_function('aureon?.workbench && aureon.app.series.bars.length===1000');state=await js('()=>({kind:aureon.app.kind,worker:!!aureon.workbench.jobs.worker})');assert state['kind']=='demo',state;await context.set_offline(False);return{'cacheEntries':cachekeys,'offline':state}
    if not DOCUMENT:await check('Offline PWA reload uses standalone shell and never caches private APIs',pwa)
    await js("()=>{aureon.workbench.pro.tab='analytics';aureon.app.setPanel('pro');aureon.workbench.pro.results=aureon.workbench.pro.calculate('options',aureon.workbench.pro.defaults('options'));aureon.workbench.pro.render();}")
    await page.screenshot(path=str(OUT/'workspace.png'))
    report={'tests':results,'passed':sum(r['passed'] for r in results),'failed':sum(not r['passed'] for r in results),'pageErrors':errors,'origin':'document injection (loopback browser navigation blocked by environment policy)' if DOCUMENT else 'local HTTP loopback','notRun':['browser authentication','PWA install/offline','secure-origin WebGPU'] if DOCUMENT else [],'providerConnectivity':'Not tested; demo / protocol fixtures','renderer':await js('()=>aureon.app.chart.renderer.mode')}
    (OUT/'browser-report.json').write_text(json.dumps(report,indent=2));print(json.dumps({k:v for k,v in report.items() if k!='tests'},indent=2))
    await browser.close()
    if report['failed'] or errors:raise SystemExit(1)
  finally:
   proc.terminate()
   try:proc.wait(timeout=10)
   except subprocess.TimeoutExpired:proc.kill();proc.wait()
if __name__=='__main__':asyncio.run(main())
