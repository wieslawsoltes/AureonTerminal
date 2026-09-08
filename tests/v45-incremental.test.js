import test from 'node:test';
import assert from 'node:assert/strict';
import {IncrementalScriptSession,planIncrementalScript} from '../src/script-incremental.js';
import {RealtimeScriptSession,runScript,SCRIPT_EXAMPLES} from '../src/script.js';
import {LiveScriptRuntime} from '../src/script-live.js';
import {createJobRuntime} from '../src/jobs.js';
import {validateExtensions,defaultExtensions} from '../src/workspace-v2.js';

function fixture(length=90,offset=100) {
  let seed=1741;
  const random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/2**32);
  return Array.from({length},(_,i)=>{const c=offset+Math.sin(i*.61)*5+random();return {t:1700000000+i*60,o:c-.2,h:c+1,l:c-1,c,v:i%13===0?0:Math.round(random()*1000)};});
}
function equalNumbers(a,b,message='numbers',tolerance=2e-9) {
  assert.equal(a.length,b.length,message+' length');
  for(let i=0;i<a.length;i++) {
    if(typeof a[i]!=='number'||typeof b[i]!=='number'){assert.deepEqual(a[i],b[i],message+':'+i);continue;}
    if(!Number.isFinite(a[i])||!Number.isFinite(b[i]))assert.ok(Object.is(a[i],b[i]),`${message}[${i}]: ${a[i]} != ${b[i]}`);
    else assert.ok(Math.abs(a[i]-b[i])<=tolerance*Math.max(1,Math.abs(a[i]),Math.abs(b[i])),`${message}[${i}]: ${a[i]} != ${b[i]}`);
  }
}
function equivalent(a,b) {
  for(const key of ['title','kind','overlay','bars','inputs','commands','fills','varip','graphics'])assert.deepEqual(a[key],b[key],key);
  assert.equal(a.plots.length,b.plots.length);
  a.plots.forEach((p,i)=>{const q=b.plots[i];for(const key of ['id','name','color','width','style','kind','location','colors'])assert.deepEqual(p[key],q[key],key);equalNumbers(p.values,q.values,p.name);});
  assert.deepEqual(a.alerts,b.alerts);assert.deepEqual(a.backgrounds,b.backgrounds);
  assert.deepEqual(Object.keys(a.captured),Object.keys(b.captured));
  for(const key of Object.keys(a.captured))equalNumbers(a.captured[key],b.captured[key],key);
}
const periods=[1,2,7,30];
for(const key of ['sma','sum','wma','highest','lowest','stdev','linreg','ema','rma','rsi','variance']) {
  test(`v45 ${key}: graph seed and repeated previews/commits match reference over full and missing windows`,()=>{
    for(const period of periods) {
      const source=`indicator("${key}", overlay=true)\nx = bar_index % 17 == 5 ? na : close\ny = ta.${key}(source=x, length=${period})\nplot(y, "Study", color=color.orange)\nplot(y[2], "History")`;
      const bars=fixture(),a=new IncrementalScriptSession(source,{capture:['x','y']}),b=new RealtimeScriptSession(source,{capture:['x','y']});
      a.reset(bars.slice(0,50));b.reset(bars.slice(0,50));equivalent(a.result(),runScript(source,bars.slice(0,50),{capture:['x','y']}));
      for(let i=50;i<70;i++) {
        const bar=bars[i];for(const delta of [0,.8,-.6,.3])equivalent(a.update({...bar,c:bar.c+delta},{asOf:bar.t+30}),b.update({...bar,c:bar.c+delta},{asOf:bar.t+30}));
        equivalent(a.update(bar,{confirmed:true,asOf:bar.t+60}),b.update(bar,{confirmed:true,asOf:bar.t+60}));
      }
      assert.equal(a.closed.length,70);
      assert.equal(a.result().execution.evaluatedBars,150);
    }
  });
}
for(const key of ['change','mom','roc','cross','crossover','crossunder','cum','barssince','atr']) {
  test(`v45 ${key}: nested series, gaps and delayed history match batch interpreter`,()=>{
    const expression=key==='atr'?'ta.atr(length=5)':key.startsWith('cross')?`ta.${key}(x, x[1])`:key==='barssince'?'ta.barssince(x > 101)':`ta.${key}(x${key==='cum'?'':', 2'})`;
    const source=`indicator("Flow")\nx=bar_index % 13 == 7 ? na : close\na=${expression}\nplot(a)\nplot(a[3])\nplot(${expression}[2])`;
    const bars=fixture(),a=new IncrementalScriptSession(source);a.reset(bars);equivalent(a.result(),runScript(source,bars));
  });
}
for(const name of ['trend','oscillator'])test(`v45 shipped ${name} example uses incremental path without output changes`,()=>{
  const source=SCRIPT_EXAMPLES[name],bars=fixture();const a=new IncrementalScriptSession(source);a.reset(bars);equivalent(a.result(),runScript(source,bars));
});
test('v45 arithmetic, lazy pure branches, colors, inputs and background/alert outputs remain typed',()=>{
  const source=`indicator("Typed", overlay=true)
n=input.int(7, "Period", minval=1)
s=input.source(close, "Source")
f=input.bool(true, "Enabled")
k=input.string("constant", "Text")
x=ta.ema(s,n)
y=ta.sma(x,n)
plot(f ? x : y, "Average", color=close > x ? color.green : color.red, linewidth=2)
plot(math.sqrt(math.abs(close - y)), "Math")
plotshape(ta.crossover(x,y), title="Cross", location=location.abovebar)
barcolor(close > x ? color.blue : color.red)
bgcolor(color.new(color.aqua,80))
alertcondition(ta.crossover(x,y), "Signal", "Observed crossing")`;
  const options={inputs:{Period:3,Source:'high',Enabled:false,Text:'test'}},bars=fixture(),a=new IncrementalScriptSession(source,options);a.reset(bars);equivalent(a.result(),runScript(source,bars,options));
});
test('v45 realtime flags preserve historical and committed intrabar metadata through rollback',()=>{
  const source='plot(barstate.isrealtime)\nplot(barstate.isnew)\nplot(barstate.isconfirmed)\nplot(barstate.ishistory)\nplot(barstate.isfirst)\nplot(ta.sum(barstate.isnew,2))';
  const bars=fixture(6),a=new IncrementalScriptSession(source),b=new RealtimeScriptSession(source);
  a.reset(bars.slice(0,2));b.reset(bars.slice(0,2));
  for(const bar of bars.slice(2)){for(let i=0;i<2;i++)equivalent(a.update(bar),b.update(bar));equivalent(a.update(bar,{confirmed:true}),b.update(bar,{confirmed:true}));}
});
test('v45 a history-only kernel maintains the same causal values as deferred reference calls',()=>{
  const source='x=close*2\nplot(ta.ema(x,7)[10])\nplot(ta.wma(x[2],9)[3])\nplot(ta.change(close,0))',bars=fixture();
  const a=new IncrementalScriptSession(source);a.reset(bars);equivalent(a.result(),runScript(source,bars));
});
test('v45 unbiased variance has an unknown single-observation sample and agrees on larger windows',()=>{
  const source='plot(ta.variance(close,1,false))\nplot(ta.variance(source=close,length=7,biased=false))',bars=fixture();
  const a=new IncrementalScriptSession(source);a.reset(bars);equivalent(a.result(),runScript(source,bars));
});
test('v45 persistent aggregate roots survive thousands of replacements without accumulating provisional samples',()=>{
  const source='plot(ta.sma(close,17))\nplot(ta.stdev(close,17))\nplot(ta.rsi(close,17))',bars=fixture(40),a=new IncrementalScriptSession(source),b=new RealtimeScriptSession(source);
  a.reset(bars.slice(0,39));b.reset(bars.slice(0,39));const roots=a.states.map(s=>s?.root);
  for(let i=0;i<1000;i++)a.update({...bars[39],c:bars[39].c+(i%20)/100});
  assert.equal(a.closed.length,39);a.states.forEach((s,i)=>assert.equal(s?.root,roots[i]));
  equivalent(a.update(bars[39],{confirmed:true}),b.update(bars[39],{confirmed:true}));
});
test('v45 discard and reset never commit a preview or retain prior kernel state',()=>{
  const source='plot(ta.ema(close,3))\nplot(ta.wma(close,3))',bars=fixture(12),a=new IncrementalScriptSession(source);
  a.reset(bars.slice(0,10));a.update(bars[10]);a.discard();equivalent(a.result(),runScript(source,bars.slice(0,10)));
  a.update(bars[11]);a.discard();a.reset(bars.slice(0,3));equivalent(a.result(),runScript(source,bars.slice(0,3)));
});
test('v45 large-offset weighted deviation keeps a small variance instead of cancellation',()=>{
  const bars=fixture(90,1e10),a=new IncrementalScriptSession('plot(ta.stdev(close,31))');a.reset(bars);
  const values=bars.slice(-31).map(b=>b.c-1e10),mean=values.reduce((s,x)=>s+x,0)/31,reference=Math.sqrt(values.reduce((s,x)=>s+(x-mean)**2,0)/31);
  assert.ok(Math.abs(a.result().plots[0].values.at(-1)-reference)<2e-6);
});
for(const source of [
  'var x=0\nx:=x+1\nplot(x)', 'varip x=0\nx+=1\nplot(x)',
  'if close>open\n    plot(close)', 'for i=0 to 3\n    x=i\nplot(close)',
  'f(x)=>x*2\nplot(f(close))', 'plot(barstate.islast)', 'plot(ta.median(close,3))',
  'plot(close > open ? ta.ema(close,3) : close)', 'plot(false and ta.crossover(close,open))',
  'x=close\nx:=open\nplot(x)', 'plot(request.security("TEST","60",close))',
  'plot(str.tostring(close))', 'plot(nz(close[1],"a")+close)',
  'x=plot(close)\ny=plot(open)\nfill(x,y)', 'plot(close[bar_index % 3])',
  'plot(ta.sma(close, bar_index+1))', 'plot(ta.ema(close,2), title=str.tostring(close))'
])test(`v45 unsupported plan is explicit and whole-script: ${source.split('\n')[0]}`,()=>{
  const plan=planIncrementalScript(source);assert.equal(plan.supported,false);assert.ok(plan.reason);assert.throws(()=>new IncrementalScriptSession(source),/Line/);
});
test('v45 errors are not converted to fake unsupported results and bad kernel parameters reject',()=>{
  for(const source of ['plot(window.location)','plot(close[-1])','plot(ta.ema(close,0))','plot(ta.ema(close,length=2,source=open))'])assert.throws(()=>planIncrementalScript(source));
});
test('v45 memory and operation budgets are checked before continued stateful use',()=>{
  assert.throws(()=>new IncrementalScriptSession('plot(close)',{maxBars:0}),/history/);
  assert.throws(()=>new IncrementalScriptSession('plot(close)',{maxSeriesCells:1}),/memory/);
  assert.throws(()=>new IncrementalScriptSession('plot(close)',{maxSeriesCells:4000001}),/limit/);
  assert.throws(()=>new IncrementalScriptSession('plot(close)',{maxOperations:NaN}),/operation/);
  const a=new IncrementalScriptSession('plot(ta.sma(close,20))',{maxOperations:2});assert.throws(()=>a.reset(fixture(1)),/budget/);assert.throws(()=>a.update(fixture(2)[1]),/failed/);
});
test('v45 seed and capacity failures do not roll old history off silently',()=>{
  const a=new IncrementalScriptSession('plot(close)',{maxBars:2}),bars=fixture(3);a.reset(bars.slice(0,2));assert.throws(()=>a.update(bars[2]),/capacity/);
  assert.throws(()=>a.reset(bars),/capacity/);assert.throws(()=>a.reset([{...bars[0],partial:true}]),/closed/);
});
test('v45 committed-history and wrong-open-bar revisions fail without modifying closed data',()=>{
  const a=new IncrementalScriptSession('plot(close)'),bars=fixture(4);a.reset(bars.slice(0,2));const saved=structuredClone(a.closed);
  assert.throws(()=>a.update(bars[0]),/committed/);a.update(bars[2]);assert.throws(()=>a.update(bars[3]),/Confirm/);assert.deepEqual(a.closed,saved);
});
test('v45 output arrays can be transferred without detaching committed histories',()=>{
  const source='plot(ta.ema(close,3))\nalertcondition(close>open,"X")',bars=fixture(9),a=new IncrementalScriptSession(source);
  a.reset(bars.slice(0,8));const r=a.result();structuredClone(r,{transfer:[r.plots[0].values.buffer,r.alerts[0].values.buffer]});
  assert.equal(r.plots[0].values.length,0);const b=new RealtimeScriptSession(source);b.reset(bars.slice(0,8));equivalent(a.update(bars[8],{confirmed:true}),b.update(bars[8],{confirmed:true}));
});
test('v45 incremental operation count depends on graph/window, not retained seed length',()=>{
  const source='plot(ta.ema(close,20))\nplot(ta.rsi(close,14))\nplot(ta.sma(close,16))',bars=fixture(1801);
  const counts=[200,1000,1800].map(n=>{const a=new IncrementalScriptSession(source);a.reset(bars.slice(0,n));const r=a.update(bars[n]);assert.equal(r.execution.evaluatedBars,n+1);return r.operations;});
  assert.ok(Math.max(...counts)<150);assert.ok(Math.max(...counts)-Math.min(...counts)<20);
});
test('v45 live runtime auto choice, forced modes, stop/restart and fallback preserve old behavior',()=>{
  const bars=fixture(12),options={source:'plot(ta.ema(close,3))',symbol:'TEST',interval:60,asOf:bars.at(-1).t+60},a=new LiveScriptRuntime();
  assert.equal(a.run('live-start',bars,options).execution.engine,'incremental');
  assert.equal(a.run('live-start',bars,{...options,engine:'reference'}).execution.engine,'reference');
  const source='varip n=0\nn+=1\nplot(n)';const r=a.run('live-start',bars,{...options,source});assert.equal(r.execution.engine,'reference');assert.match(r.execution.fallbackReason,/persistent/);
  assert.throws(()=>a.run('live-start',bars,{...options,source,engine:'incremental'}),/unavailable/);assert.equal(a.active,null);
  assert.throws(()=>a.run('live-start',bars,{...options,engine:'unknown'}),/Unknown/);
  assert.deepEqual(a.run('live-stop',[],{}),{stopped:true});
});
test('v45 full live protocol uses one evaluation per preview and two per rollover without data drift',()=>{
  const bars=fixture(15),a=new LiveScriptRuntime(),b=new LiveScriptRuntime(),source='plot(ta.ema(close,3))\nplot(ta.wma(close,3))';
  const options={source,symbol:'TEST',interval:60,asOf:bars[9].t+30};
  equivalent(a.run('live-start',bars.slice(0,10),options),b.run('live-start',bars.slice(0,10),{...options,engine:'reference'}));
  const before=a.active.session.evaluations;
  equivalent(a.run('live-update',[],{bar:bars[9],asOf:bars[9].t+40,sequence:1}),b.run('live-update',[],{bar:bars[9],asOf:bars[9].t+40,sequence:1}));
  const r=a.run('live-update',[],{bar:bars[10],closedBar:bars[9],asOf:bars[10].t+20,sequence:2});
  equivalent(r,b.run('live-update',[],{bar:bars[10],closedBar:bars[9],asOf:bars[10].t+20,sequence:2}));assert.equal(r.execution.evaluatedBars,before+3);
  assert.throws(()=>a.run('live-update',[],{bar:bars[10],asOf:bars[10].t+21,sequence:2}),/sequence/);assert.equal(a.active,null);
});
test('v45 independent runtime instances never share compiled or checkpoint state',()=>{
  const a=createJobRuntime(),b=createJobRuntime(),bars=fixture(10),options={source:'plot(ta.ema(close,3))',symbol:'TEST',interval:60,asOf:bars[9].t+5};
  const left=a('live-start',bars,options),right=b('live-start',fixture(10,200),options);assert.notEqual(left.plots[0].values[9],right.plots[0].values[9]);
  a('live-stop',[]);assert.ok(b('live-update',[],{bar:fixture(10,200)[9],asOf:bars[9].t+10,sequence:1}));
});
test('v45 realtime engine selection persists without changing workspace schema',()=>{
  assert.equal(defaultExtensions().realtimeEngine,'auto');
  for(const engine of ['auto','reference','incremental'])assert.equal(validateExtensions({version:2,realtimeEngine:engine}).realtimeEngine,engine);
  assert.throws(()=>validateExtensions({version:2,realtimeEngine:'javascript'}),/engine/);
});
test('v45 unreachable invalid history and duplicate metadata use reference semantics, never fail preflight',()=>{
  const bars=fixture(6);
  for(const source of ['plot(false ? close[-1] : close)', 'indicator("A",title=color.new("bad",0))\nplot(close)', 'n=input.int(2,"N",defval=color.new("bad",0))\nplot(close+n)', 'plot(close,"Close",title=color.new("bad",0))']) {
    const a=new LiveScriptRuntime(),options={source,symbol:'TEST',interval:60,asOf:bars.at(-1).t+60};
    const r=a.run('live-start',bars,options);assert.equal(r.execution.engine,'reference');equivalent(r,runScript(source,bars,{symbol:'TEST',interval:60}));
  }
});
test('v45 shipped streaming example and immutable input snapshots survive caller mutation',()=>{
  const source=SCRIPT_EXAMPLES.streaming,bars=fixture(),options={inputs:{Length:7}},a=new IncrementalScriptSession(source,options);options.inputs.Length=300;
  a.reset(bars);equivalent(a.result(),runScript(source,bars,{inputs:{Length:7}}));
});
test('v45 planner job returns a small serializable capability summary without candle evaluation',()=>{
  const job=createJobRuntime(),result=job('script-plan',[],{source:SCRIPT_EXAMPLES.streaming});
  assert.equal(result.supported,true);assert.equal(result.engine,'incremental');
  assert.deepEqual(result.kernels,['ema','sma','stdev','crossover']);assert.equal(result.outputs,6);
  assert.ok(!('program' in result)&&!('nodes' in result));assert.ok(JSON.stringify(result).length<2000);
  assert.deepEqual(JSON.parse(JSON.stringify(result)),result);
});
test('v45 preflight exposes an unsupported whole-source reason but never treats sandbox errors as a plan',()=>{
  const job=createJobRuntime(),plan=job('script-plan',[],{source:SCRIPT_EXAMPLES.retained});
  assert.equal(plan.supported,false);assert.equal(plan.engine,'reference');assert.match(plan.reason,/persistent/);
  assert.throws(()=>job('script-plan',[],{source:'eval("close")'}));
  assert.throws(()=>job('script-plan',[],{source:'plot(ta.sma(close,0))'}),/length/);
});
test('v45 live-start owns cloned input options and reports the chosen engine without changing source',()=>{
  const bars=fixture(30),inputs={Length:3},runtime=new LiveScriptRuntime();
  const options={source:SCRIPT_EXAMPLES.streaming,inputs,symbol:'TEST',interval:60,asOf:bars.at(-1).t+20};
  runtime.run('live-start',bars,options);inputs.Length=17;
  const output=runtime.run('live-update',[],{bar:bars.at(-1),asOf:options.asOf+1,sequence:1});
  assert.equal(output.execution.engine,'incremental');
  equivalent(output,runScript(options.source,bars,{inputs:{Length:3}}));
});
