"""UI regression harness. Requires Python Playwright and Chromium, not runtime dependencies.
Loads the standalone artifact into a browser document. Does not stub market responses.
The explicit deterministic-demo flag prevents this suite from representing test data as live.
"""
import asyncio, json, os, time
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'verification'/'v2'
async def main():
 OUT.mkdir(parents=True,exist_ok=True)
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=os.environ.get('CHROMIUM','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
  page=await browser.new_page(viewport={'width':1600,'height':1000},device_scale_factor=1)
  page.set_default_timeout(4500)
  errors=[];results=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.on('dialog',lambda d:asyncio.create_task(d.accept('Verification layout' if d.type=='prompt' else None)))
  html=(ROOT/'dist/AureonTerminal.html').read_text().replace('<html lang="en">','<html lang="en" data-mode="demo">')
  await page.set_content(html,wait_until='load')
  await page.wait_for_timeout(350)
  async def check(name,fn):
   t=time.perf_counter()
   try:
    detail=await fn();results.append({'name':name,'passed':True,'detail':detail,'milliseconds':round((time.perf_counter()-t)*1000,2)})
   except Exception as e:results.append({'name':name,'passed':False,'error':repr(e)})
   print(name,results[-1]['passed'],results[-1].get('error',''),flush=True)
  async def js(code):return await page.evaluate(code)
  await check('Startup and explicit synthetic provenance',lambda:js("()=>{if(!aureon.workbench||aureon.app.series.bars.length!==1000||document.querySelector('#feed-badge').textContent!=='DEMO')throw Error('startup');return{bars:1000,renderer:aureon.app.chart.renderer.mode};}"))
  for panel in ['script','lab','screener','research','flow','ledger','rules','library','services']:
   await check('Open panel: '+panel,lambda panel=panel:js("()=>{aureon.app.setPanel('"+panel+"');if(document.querySelector('#panel-content').textContent.length<100)throw Error('Empty panel');return true;}"))
  async def studies():
   await page.locator('.workbench-toolbar [data-v2="studies"]').click()
   await page.locator('[data-v2="add-study"][data-type="ema"]').click()
   a=page.locator('#study-instances input[name="length"]').first
   await a.fill('34');await a.dispatch_event('change')
   await page.locator('[data-v2="add-study"][data-type="bb"]').click()
   await js('()=>aureon.app.closeModal()')
   await page.wait_for_function('aureon.workbench.studyResults.length===2')
   assert await js('()=>aureon.workbench.config.studies[0].params.length')==34
   return await js('()=>aureon.workbench.studyResults.map(s=>({name:s.name,plots:s.plots.length}))')
  await check('Add and parameter-edit independent study instances through UI',studies)
  for style in ['candles','hollow','bars','line','area','heikin','step','baseline','columns','hlc','renko','linebreak','kagi','pnf','range']:
   await check('Render chart style: '+style,lambda style=style:js("()=>{const a=aureon.app;a.state.style='"+style+"';a.chart.setStyle('"+style+"');a.chart.fit();a.chart.draw();if(!a.chart.bars.length)throw Error('No transformed bars');return{raw:a.series.bars.length,display:a.chart.bars.length,primitives:a.chart.geometry.count};}"))
  await js("()=>{aureon.app.state.style='candles';aureon.app.chart.setStyle('candles');aureon.app.setPanel('overview');}")
  async def drawing():
   canvas=page.locator('#main-pane .chart-overlay');box=await canvas.bounding_box();x=box['x'];y=box['y']
   price=await js('()=>({y:aureon.app.chart.price.y,h:aureon.app.chart.price.h})');print('DRAW PRICE',price,box,flush=True)
   low=price['y']+price['h']*.25;mid=price['y']+price['h']*.5;high=price['y']+price['h']*.75
   before=await js('()=>aureon.app.chart.drawings.length')
   await js("()=>aureon.app.chart.setTool('channel')")
   for px,py in [(250,mid),(480,low),(350,high)]:await page.mouse.click(x+px,y+py)
   after=await js('()=>aureon.app.chart.drawings.length');assert after==before+1, f'channel before={before} after={after}; pending='+str(await js('()=>aureon.app.chart.pending'))
   await js("()=>aureon.app.action('undo')");assert await js('()=>aureon.app.chart.drawings.length')==before
   await js("()=>aureon.app.action('redo')");assert await js('()=>aureon.app.chart.drawings.length')==after
   await js("()=>aureon.app.chart.setTool('brush')")
   await page.mouse.move(x+500,y+mid);await page.mouse.down();await page.mouse.move(x+600,y+high,steps=12);await page.mouse.up()
   assert await js('()=>aureon.app.chart.drawings.at(-1).points.length')>2
   await js("()=>aureon.app.chart.setTool('cursor')")
   return {'channel':'3 anchors','brush':'pointer stroke','undoRedo':True}
  await check('Three-anchor channel, freehand brush and undo/redo',drawing)
  async def objects():
   await js("()=>{const w=aureon.workbench;w.selectedObjects=new Set(aureon.app.chart.drawings.slice(-2).map(d=>d.id));w.openObjects();}")
   await page.locator('[data-v2="object-group"]').click()
   assert await js('()=>new Set(aureon.app.chart.drawings.slice(-2).map(d=>d.group)).size')==1
   await page.locator('[data-v2="object-toggle"][data-property="locked"]').first.click()
   assert await js('()=>aureon.app.chart.drawings.at(-1).locked')
   await js('()=>aureon.app.closeModal()');return True
  await check('Object grouping and locking via object manager',objects)
  async def script():
   await page.locator('.workbench-toolbar [data-v2="panel-script"]').click()
   await page.locator('#script-source').fill('indicator("Verified custom EMA", overlay=true)\np = input.int(17, "Length", minval=1)\nm = ta.ema(close, p)\nplot(m, "Custom EMA", color=color.orange)')
   await page.locator('[data-v2="run-script"]').click()
   await page.wait_for_function('aureon.workbench.scriptResult?.title==="Verified custom EMA"')
   await page.locator('[data-v2form="script-inputs"] input[name="Length"]').fill('27')
   await page.locator('[data-v2form="script-inputs"] button').click()
   await page.wait_for_function('aureon.workbench.scriptResult?.inputs[0].value===27')
   return await js('()=>({plots:aureon.workbench.scriptResult.plots.length,bars:aureon.workbench.scriptResult.bars})')
  await check('Edit, execute and re-parameterize a real script',script)
  async def invalid_script():
   await page.locator('#script-source').fill('plot(fetch("https://invalid.example"))')
   await page.locator('[data-v2="run-script"]').click();await page.wait_for_function('aureon.workbench.scriptError.length>0')
   assert await js('()=>aureon.workbench.scriptResult===null')
   error=await page.locator('.script-error').inner_text()
   await page.locator('#script-source').fill('indicator("Verified RSI", overlay=false)\nplot(ta.rsi(close, 14), "RSI", color=color.purple)')
   await page.locator('[data-v2="run-script"]').click();await page.wait_for_function('aureon.workbench.scriptResult?.title==="Verified RSI"')
   return error
  await check('Script diagnostic rejects network access then recovers',invalid_script)
  async def profiles():
   await page.locator('.workbench-toolbar [data-v2="profile"]').click()
   await page.wait_for_function('aureon.app.chart.profile?.total>0')
   await page.locator('.workbench-toolbar [data-v2="chart-options"]').click()
   await page.locator('[data-v2form="chart-options"] [name="timezone"]').fill('Europe/Warsaw')
   await page.locator('[data-v2form="chart-options"] [name="session"]').check()
   await page.locator('[data-v2form="chart-options"] button[type="submit"]').click()
   assert await js('()=>aureon.app.chart.sessionCalendar.zone')=='Europe/Warsaw'
   return await js('()=>({profile:aureon.app.chart.profile.mode,zone:aureon.app.chart.timezone})')
  await check('Volume-profile calculation and timezone/session settings',profiles)
  for n in [2,4,6,8,1]:
   async def layout(n=n):
    await js(f'async()=>await aureon.workbench.setLayout({n})')
    await page.wait_for_function(f'aureon.workbench.extraCharts.length==={n-1} && aureon.workbench.extraCharts.every(e=>e.chart.bars.length>0)')
    return {'charts':n}
   await check('Multi-chart layout '+str(n),layout)
  await check('Computed relative comparison preserves raw primary data',lambda:js("async()=>{const w=aureon.workbench,raw=aureon.app.series.bars;await w.compare({symbol:'ETH-USD',operation:'relative',ratio:1});if(!w.compareStudy.plots[0].values.some(Number.isFinite)||raw!==aureon.app.series.bars)throw Error('comparison');return true;}"))
  async def lab():
   await js("()=>aureon.app.setPanel('lab')")
   await page.locator('#run-lab').click()
   await page.wait_for_function('!!aureon.workbench.labResult')
   r=await js('()=>({trades:aureon.workbench.labResult.tradeCount,fees:aureon.workbench.labResult.fees,equityPoints:aureon.workbench.labResult.equity.length})')
   assert r['trades']>0 and r['equityPoints']==1000
   await page.screenshot(path=str(OUT/'strategy-browser.png'))
   return r
  await check('Advanced strategy tester generates actual executions/equity',lab)
  await check('Training-only selection and separate holdout sweep',lambda:js("async()=>{await aureon.workbench.runSweep();const r=aureon.workbench.sweepResult;if(r.split!==700||r.results.length!==12)throw Error('sweep');return{runs:r.results.length,holdoutBars:r.holdout.equity.length};}"))
  async def ledger():
   await js("()=>{aureon.app.startReplay();aureon.app.setPanel('ledger');}")
   form=page.locator('[data-v2form="ledger"]')
   await form.locator('[name="quantity"]').fill('0.01')
   await form.locator('[name="type"]').select_option('market')
   await form.locator('button[type="submit"]').click()
   assert await js('()=>aureon.workbench.account.orders.length')>=1
   assert await js('()=>aureon.workbench.account.fills.length')==0
   await js("()=>aureon.app.seekReplay(aureon.app.chart.endLimit+1)")
   assert await js('()=>aureon.workbench.account.fills.length')==1
   await js('()=>aureon.app.seekReplay(aureon.app.chart.endLimit-2)')
   assert await js('()=>aureon.workbench.replayOutOfSync')
   await js('()=>aureon.app.stopReplay()')
   return {'nextBarFill':True,'rewindProtection':True}
  await check('Replay order ticket, next-bar execution and rewind protection',ledger)
  async def scan():
   await js("()=>aureon.app.setPanel('screener')")
   await page.locator('[data-v2="scan"]').click();await page.wait_for_function('!aureon.workbench.scanning&&aureon.workbench.screenerRows.length>0')
   n=await js('()=>aureon.workbench.screenerRows.length')
   assert await page.locator('.heat-tile').count()==n
   await page.locator('[data-v2form="screen"] [name="field"]').select_option('price')
   await page.locator('[data-v2form="screen"] [name="value"]').fill('1000000000')
   await page.locator('[data-v2form="screen"] button').click()
   assert await page.locator('.heat-tile').count()==0
   return {'computedSymbols':n,'filterWorks':True}
  await check('Screener scan, computed heatmap and numeric filters',scan)
  async def research():
   raw={'version':1,'source':'UI verification fixture – not live research','universe':[],'events':[{'time':1767225600,'title':'Imported test event','kind':'earnings'}],'news':[{'time':1767225600,'title':'<img src=x onerror="window.xss=1">','summary':'Imported fixture only','url':'javascript:alert(1)'}],'fundamentals':[{'symbol':'TEST','period':'FY2025','metrics':{'Revenue':12345}}]}
   await page.locator('#v2-file').set_input_files({'name':'research.json','mimeType':'application/json','buffer':json.dumps(raw).encode()})
   await page.wait_for_function('aureon.workbench.config.research.events.length===1')
   await page.locator('#research-tab').select_option('news')
   assert await page.locator('.news-card img').count()==0
   assert await page.locator('.news-card a').count()==0
   await page.locator('#research-tab').select_option('calendar')
   assert 'Imported test event' in await page.locator('#panel-content').inner_text()
   await page.locator('#research-tab').select_option('fundamentals')
   assert '12,345' in await page.locator('#panel-content').inner_text()
   return {'events':1,'fundamentals':1,'safeImportedNews':True}
  await check('Research JSON import, calendar/fundamentals rendering and HTML safety',research)
  async def roundtrip():
   result=await js("async()=>{const w=aureon.workbench,p=w.payload(),count=aureon.app.chart.drawings.length;p.dataset.source='Verified imported historical fixture';await w.importWorkspace(p);if(aureon.app.chart.drawings.length!==count||w.config.studies.length!==2||aureon.app.kind!=='import')throw Error('roundtrip');return{bars:aureon.app.series.bars.length,drawings:count,source:aureon.app.modeLabel};}")
   assert 'Verified imported' in await page.locator('#source-text').inner_text();return result
  await check('Workspace + scripts/studies/drawings/data round-trip',roundtrip)
  await check('Chart PNG contains a nonempty actual rendering',lambda:js("async()=>{const b=await aureon.app.chart.snapshot();if(b.type!=='image/png'||b.size<10000)throw Error('snapshot');return{mime:b.type,bytes:b.size};}"))
  async def theme():
   await js("()=>{aureon.app.setTheme('light');aureon.app.chart.draw();}")
   assert await js("()=>document.body.classList.contains('light')")
   await js("()=>aureon.app.setTheme('dark')");return True
  await check('Light/dark theme switch',theme)
  await check('All original data and paper panels still render',lambda:js("()=>{for(const p of ['overview','data','strategy','paper','alerts']){aureon.app.setPanel(p);if(!document.querySelector('#panel-content').textContent.length)throw Error(p);}return true;}"))
  await js("async()=>{const a=aureon.app,w=aureon.workbench;w.activeScriptSource=null;w.scriptResult=null;w.compareStudy=null;w.config.research={version:1,source:'User-imported research',events:[],news:[],fundamentals:[],universe:[]};w.config.session=null;w.applySession();await a.loadSymbol('BTC-USD',3600);a.setPanel('script');w.config.scriptId='trend';w.currentScript().source=`indicator(\"Aureon trend study\", overlay=true)\nlength = input.int(34, \"EMA length\", minval=1)\nfast = ta.ema(close, length)\nslow = ta.ema(close, 89)\nplot(fast, \"EMA 34\", color=color.blue)\nplot(slow, \"EMA 89\", color=color.orange)\nalertcondition(ta.crossover(fast, slow), \"Trend crossover\")`;await w.runScript();a.chart.fit();a.chart.draw();}")
  await page.wait_for_function('!aureon.app.computationBusy && !aureon.workbench.studyBusy')
  await js('async()=>{await aureon.workbench.runScript();aureon.workbench.renderScript();aureon.app.chart.draw();}')
  await page.wait_for_timeout(150)
  await js("()=>document.querySelectorAll('.toast').forEach(e=>e.remove())")
  await page.screenshot(path=str(OUT/'workspace-browser.png'))
  environment=await js('()=>({renderer:aureon.app.chart.renderer.mode,rendererReason:aureon.app.chart.renderer.reason,workerActive:!!aureon.workbench.jobs.worker,workerFallbackReason:aureon.workbench.jobs.failureReason||null,secureContext:isSecureContext,userAgent:navigator.userAgent,syntheticDemo:aureon.app.forceDemo})')
  report={'environment':environment,'tests':results,'passed':sum(r['passed'] for r in results),'failed':sum(not r['passed'] for r in results),'pageErrors':errors}
  (OUT/'browser-report.json').write_text(json.dumps(report,indent=2))
  print(json.dumps({k:v for k,v in report.items() if k!='tests'},indent=2))
  await browser.close()
  if report['failed'] or errors:raise SystemExit(1)
asyncio.run(main())
