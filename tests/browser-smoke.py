"""End-to-end UI assertions. Requires Python Playwright and Chromium.
Start `npm start`, then `python tests/browser-smoke.py`.
An administrator-blocked navigation uses the exact standalone distribution via
set_content instead; this fallback tests Canvas and Blob workers, not WebGPU or
production-network access. The report identifies the path actually exercised.
"""
import asyncio, json, os, pathlib
from playwright.async_api import async_playwright
ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=pathlib.Path(os.environ.get('TEST_OUTPUT',str(ROOT/'test-results')))

async def main():
 OUT.mkdir(exist_ok=True)
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),headless=True,args=['--no-sandbox','--enable-unsafe-webgpu','--use-angle=swiftshader','--ignore-gpu-blocklist'])
  page=await browser.new_page(viewport={'width':1600,'height':1000},device_scale_factor=1,accept_downloads=True)
  errors=[];checks=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  try:
   await page.goto('http://127.0.0.1:4173/?demo=1',wait_until='networkidle',timeout=10000)
   loading='modular HTTP app'
  except Exception as e:
   if 'ERR_BLOCKED_BY_ADMINISTRATOR' not in str(e):raise
   await page.close()
   page=await browser.new_page(viewport={'width':1600,'height':1000},device_scale_factor=1,accept_downloads=True)
   page.on('pageerror',lambda error:errors.append(str(error)))
   html=(ROOT/'dist/AureonTerminal.html').read_text().replace('<html lang="en">','<html lang="en" data-mode="demo">')
   await page.set_content(html,wait_until='load')
   loading='standalone injected into administrator-restricted about:blank'
  await page.wait_for_function('window.aureon?.app.indicatorData?.rsi?.length===1000')
  await page.wait_for_timeout(300)
  assert await page.locator('#feed-badge').inner_text()=='DEMO'
  assert await page.evaluate('aureon.app.chart.geometry.count>100')
  assert 'not real quotes' in await page.locator('#watchlist-source').inner_text()
  checks.append('boot, computed studies, visible candle geometry, explicit data provenance')
  await page.screenshot(path=str(OUT/'workspace-dark.png'))

  # Indicator checkboxes update real chart panes.
  await page.click('[data-action="indicators"]')
  await page.check('input[data-indicator="macd"]')
  await page.check('input[data-indicator="bb"]')
  await page.click('#modal [data-action="close-modal"]')
  await page.wait_for_function("!!aureon.app.chart.panes.macd")
  assert await page.evaluate("aureon.app.chart.enabled.includes('bb')")
  checks.append('indicator dialog changes studies and pane geometry')

  # Change all chart types without replacing the source OHLCV.
  for style in ['line','area','heikin','hollow','bars','candles']:
   await page.click('[data-action="chart-style"]')
   await page.click(f'[data-style="{style}"]')
   await page.wait_for_timeout(50)
   assert await page.evaluate('aureon.app.chart.style')==style
  checks.append('six chart types render from the same source OHLCV')

  canvas=page.locator('#primary-chart .chart-overlay')
  box=await canvas.bounding_box()
  x,y=box['x'],box['y']
  before=await page.evaluate('aureon.app.chart.count')
  await page.mouse.move(x+500,y+180)
  await page.mouse.wheel(0,-250)
  await page.wait_for_timeout(100)
  assert await page.evaluate('aureon.app.chart.count')<before
  await page.click('[data-action="fit"]',force=True)
  checks.append('pointer-anchored wheel zoom and fit')

  await page.click('[data-tool="trend"]')
  await page.mouse.move(x+230,y+200);await page.mouse.down()
  await page.mouse.move(x+520,y+145,steps=10);await page.mouse.up()
  assert await page.evaluate('aureon.app.chart.drawings.length')==1
  assert await page.evaluate("aureon.app.chart.drawings[0].points.length") == 2
  await page.keyboard.press('Control+z')
  assert await page.evaluate('aureon.app.chart.drawings.length')==0
  await page.keyboard.press('Control+Shift+z')
  assert await page.evaluate('aureon.app.chart.drawings.length')==1
  await page.click('[data-tool="hline"]');await page.mouse.click(x+650,y+260)
  assert await page.evaluate('aureon.app.chart.drawings.length')==2
  await page.click('[data-tool="cursor"]')
  await page.click('[data-depth="drawings"]')
  assert await page.locator('.object-row').count()==2
  checks.append('two-point drawing creation, horizontal levels, undo/redo, object list')

  await page.click('[data-panel="strategy"]')
  await page.fill('#strategy-form input[name="fast"]','5')
  await page.fill('#strategy-form input[name="slow"]','15')
  await page.click('#run-strategy')
  await page.wait_for_function('!!aureon.app.strategyResult')
  assert await page.evaluate('aureon.app.strategyResult.trades.length')>0
  assert await page.locator('#equity-chart').count()==1
  checks.append('backtest client, computed trades, equity curve')
  await page.screenshot(path=str(OUT/'strategy-tester.png'))

  await page.click('[data-action="replay"]')
  assert await page.evaluate('aureon.app.chart.length<aureon.app.series.bars.length')
  assert await page.evaluate('aureon.app.strategyResult===null')
  n=await page.evaluate('aureon.app.chart.length')
  await page.click('[data-action="replay-step"]')
  assert await page.evaluate('aureon.app.chart.length')==n+1
  await page.click('#replay-toggle')
  assert not await page.evaluate('aureon.app.replaying')
  checks.append('replay truncates visible history and clears future backtest markers')

  await page.click('[data-action="alert"]')
  await page.fill('#alert-form input[name="price"]','80000')
  await page.click('#alert-form button[type="submit"]')
  assert await page.evaluate('aureon.app.alerts.alerts.length')==1
  assert await page.locator('.alerts-row').count()==1
  await page.click('[data-panel="paper"]')
  assert await page.locator('#paper-form button[type="submit"]').is_disabled()
  checks.append('alert creation; fake/demo quotes cannot execute paper orders')

  await page.click('[data-action="compare"]')
  await page.click('#symbol-results [data-select-symbol="ETH-USD"]')
  await page.wait_for_function('aureon.app.comparison?.bars.length===1000')
  assert await page.locator('#comparison-pane').is_visible()
  assert 'SYNTHETIC' in await page.locator('#comparison-source').inner_text()
  await page.click('[data-action="split"]')
  checks.append('second chart has an independent data series and explicit provenance')

  await page.click('[data-action="settings"]')
  await page.select_option('#theme-select','light')
  await page.click('#modal [data-action="close-modal"]')
  await page.click('[data-panel="overview"]')
  await page.wait_for_timeout(100)
  assert await page.locator('body.light').count()==1
  await page.screenshot(path=str(OUT/'workspace-light.png'))
  await page.click('[data-action="settings"]');await page.select_option('#theme-select','dark');await page.click('#modal [data-action="close-modal"]')
  checks.append('dark and light chart / workspace themes')

  # Portable workspace data validates and imports without upgrading to "live".
  exported=await page.evaluate('''() => ({application:'Aureon Terminal',workspace:structuredClone(aureon.app.state),dataset:{symbol:aureon.app.state.symbol,interval:aureon.app.state.interval,bars:aureon.app.series.bars.slice(0,200)}})''')
  path=OUT/'roundtrip-workspace.json';path.write_text(json.dumps(exported))
  await page.set_input_files('#file-input',str(path))
  await page.wait_for_function("aureon.app.kind==='import' && aureon.app.series.bars.length===200")
  assert await page.locator('#feed-badge').inner_text()=='IMPORTED'
  assert await page.evaluate('aureon.app.chart.drawings.length')==2
  checks.append('workspace JSON import preserves semantic drawings and validates OHLCV')

  await page.evaluate('''async () => {const blob=await aureon.app.chart.snapshot();window.pngResult={size:blob.size,type:blob.type};}''')
  assert await page.evaluate('pngResult.size')>10000
  assert await page.evaluate('pngResult.type')=='image/png'
  checks.append('real chart PNG export')

  await page.click('[data-interval="14400"]')
  await page.wait_for_timeout(100)
  assert await page.evaluate('aureon.app.series.bars.length')==50
  checks.append('imported OHLCV resampling preserves candles instead of fabricating smaller bars')

  await page.set_viewport_size({'width':1000,'height':780})
  await page.wait_for_timeout(200)
  assert await page.evaluate('aureon.app.chart.width')>300
  checks.append('responsive desktop layout')
  report={'loading':loading,'backend':await page.evaluate('aureon.app.chart.renderer.mode'),'workerActive':await page.evaluate('!!aureon.app.compute.worker'),'passed':len(checks),'checks':checks,'javascriptErrors':errors,'productionNetworkTested':False,'webgpuHardwareTested':False}
  (OUT/'browser-report.json').write_text(json.dumps(report,indent=2))
  print(json.dumps(report,indent=2))
  await browser.close()
  assert not errors,errors
asyncio.run(main())
