import test from 'node:test';
import assert from 'node:assert/strict';
import {runScript,compileScript,RealtimeScriptSession} from '../src/script.js';
import {runScriptPortfolioBacktest} from '../src/execution-pro.js';
import {renderScriptGraphics} from '../src/script-graphics-renderer.js';
import {Geometry} from '../src/renderer.js';
const bars=Array.from({length:20},(_,i)=>({t:1000+i*60,o:100+i,h:103+i,l:99+i,c:102+i,v:20}));
const visual=`indicator("Retained drawings", overlay=true)
var line level = line.new(0, close, 1, close, color=color.aqua, width=2, extend=extend.right)
line.set_xy2(level, bar_index, close)
var box zone = box.new(0, 108, 5, 100, bgcolor="#578bfa22", text="Range")
var label tag = label.new(0, 105, "Initial", textcolor=color.white)
label.set_xy(tag, bar_index, close)
label.set_text(tag, "Updated")
var table status = table.new(position.top_right, 2, 2)
table.cell(status, 0, 0, "Close", bgcolor="#14191f")
table.cell(status, 1, 0, str.tostring(close))
plot(line.get_price(level, bar_index))`;
test('retained line, box, label and table execute with typed persistent handles',()=>{const r=runScript(visual,bars);assert.equal(r.graphics.length,4);assert.equal(r.graphics.find(x=>x.type==='line').x2,19);assert.equal(r.graphics.find(x=>x.type==='label').text,'Updated');assert.equal(r.graphics.find(x=>x.type==='table').cells['1:0'].text,'121');assert.equal(r.plots[0].values.at(-1),121);});
test('graphic copy is independent and deletion removes only its selected handle',()=>{const r=runScript(`var l = line.new(0, 100, 2, 110)
var c = line.copy(l)
line.set_y2(c, 200)
if barstate.islast
    line.delete(l)`,bars);assert.equal(r.graphics.length,1);assert.equal(r.graphics[0].y2,200);});
test('graphic mutation rejects invalid field values before changing registry',()=>{for(const source of ['line.new(0, 1, 2, 3, width=99)','label.new(0, 1, "x", color="javascript:bad")','table.new(position.top_right, 100, 100)','line.set_xy2("@line:666", 1, 2)','table.cell(table.new(position.top_right, 1, 1), 2, 0, "x")','line.new(0,1,2,3,typo=1)'])assert.throws(()=>runScript(source,bars));});
test('script drawing allocation limits cannot be avoided through deletion',()=>{assert.throws(()=>runScript('line.new(bar_index,close,bar_index+1,close)',bars,{maxGraphicObjects:3}),/budget/);assert.throws(()=>runScript('plot(line.get_y1(line.new(0,1,1,2))[1])',bars),/past bar/);});
test('retained text is returned as plain data, without HTML evaluation',()=>{const text='<img src=x onerror=alert(1)>';const r=runScript('var l = label.new(0,100,"'+text+'")',bars);assert.equal(r.graphics[0].text,text);});
test('graphics obey prefix causality and ordinary realtime rollback',()=>{for(const n of [3,10]){const prefix=runScript(visual,bars.slice(0,n));assert.equal(prefix.graphics.find(x=>x.type==='line').x2,n-1);assert.equal(prefix.graphics.find(x=>x.type==='table').updatedAt,n-1);}const s=new RealtimeScriptSession('var l = line.new(0,100,1,101)\nline.set_y2(l, close)');s.update(bars[0],{confirmed:true});const a=s.update(bars[1],{confirmed:false}),b=s.update({...bars[1],c:104},{confirmed:false});assert.equal(a.graphics.length,1);assert.equal(b.graphics.length,1);assert.equal(b.graphics[0].y2,104);});
test('script graphics emit finite instanced geometry and clipped literal labels',()=>{const result=runScript(visual,bars),geometry=new Geometry(),chart={geometry,scriptGraphics:result.graphics,labels:[],price:{x:0,y:64,w:500,h:300},length:20,rawBars:bars,interval:60,timeIndex:t=>(t-1000)/60,toX:i=>i*20,toY:p=>350-(p-90)*8};renderScriptGraphics(chart);assert.ok(geometry.count>5);assert.ok(chart.labels.some(x=>x.text==='Updated'&&x.clip===chart.price));assert.ok(chart.labels.some(x=>x.text==='Close'));chart.endLimit=3;chart.labels=[];geometry.clear();renderScriptGraphics(chart);assert.ok(!chart.labels.some(x=>x.text==='Updated'));});
test('named technical arguments use the same numerical engine',()=>{const a=runScript('plot(ta.ema(source=close,length=3))\nplot(ta.rsi(length=5,source=close))',bars),b=runScript('plot(ta.ema(close,3))\nplot(ta.rsi(close,5))',bars);assert.deepEqual(a.plots.map(p=>[...p.values]),b.plots.map(p=>[...p.values]));assert.throws(()=>runScript('plot(ta.ema(close,source=open,length=3))',bars),/duplicated/);assert.throws(()=>runScript('plot(ta.ema(source=close,lenght=3))',bars),/Unknown/);});
test('named user arguments preserve series and evaluate side effects exactly once',()=>{const r=runScript('double(x) => x + x\nvar a = array.from(2,4,8)\nx = barstate.isfirst ? double(x=array.pop(a)) : 0\nplot(x)\nplot(array.size(a))',bars);assert.equal(r.plots[0].values[0],16);assert.equal(r.plots[1].values[0],2);assert.throws(()=>runScript('f(x) => x\nplot(f(1,x=2))',bars),/duplicated/);});
test('nested versioned libraries are linked with isolated aliases',()=>{const libraries={'local/base/1':{source:'library("Base")\nexport twice(x) => x*2'},'local/derived/1':{source:'import local/base/1 as b\nlibrary("Derived")\nexport shifted(x) => b.twice(x)+1'}};const r=runScript('import local/derived/1 as d\nplot(d.shifted(x=close))',bars,{libraries});assert.equal(r.plots[0].values.at(-1),243);});
test('cyclic imports, missing dependencies and repeated aliases fail explicitly',()=>{const libraries={'x/a/1':{source:'import x/b/1 as b\nexport f(x) => b.f(x)'},'x/b/1':{source:'import x/a/1 as a\nexport f(x) => a.f(x)'}};assert.throws(()=>compileScript('import x/a/1 as a',{libraries}),/Cyclic/);assert.throws(()=>compileScript('import x/missing/1 as x',{libraries}),/required/);assert.throws(()=>compileScript('import x/a/1 as a\nimport x/b/1 as a',{libraries}),/Duplicate/);});
test('higher-timeframe requests cannot advance the parent strategy simulation clock',()=>{const remote=[{t:880,o:90,h:92,l:89,c:91,v:1},{t:1000,o:91,h:93,l:90,c:92,v:1},{t:1120,o:92,h:94,l:91,c:93,v:1}];const r=runScriptPortfolioBacktest(bars,'strategy("Request")\nplot(request.security("REMOTE","2",close))\nplot(strategy.position_size)',{interval:60,datasets:{'REMOTE:120':{bars:remote}}});assert.equal(r.equity.length,bars.length);assert.ok(r.script.plots[1].values.every(x=>x===0));});
