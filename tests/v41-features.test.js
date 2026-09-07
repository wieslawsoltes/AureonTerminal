import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveScriptRuntime} from '../src/script-live.js';
import {createJobRuntime,JobClient} from '../src/jobs.js';
import {analyzeFootprint,footprintSettings} from '../src/footprint-analysis.js';
import {footprint} from '../src/tick-charts.js';
import {prepareTradeProfiles} from '../src/chart-pro.js';
import {validateExtensions} from '../src/workspace-v2.js';
const bar = (t=300) => ({t,o:100,h:102,l:99,c:101,v:10});
const history = () => Array.from({length:5},(_,i)=>bar(i*60));
const source = 'var int bars = 0\nbars += 1\nvarip int updates = 0\nif barstate.isnew\n    updates := 0\nupdates += 1\nplot(updates,"Updates")\nplot(bars,"Bars")';
const start = (runtime, extra={}) => runtime.run('live-start',[...history(),{...bar(),partial:true}],{source,symbol:'TEST',interval:60,asOf:305,...extra});
test('Realtime worker session carries varip but rolls ordinary variables back',()=>{
 const r=new LiveScriptRuntime(),initial=start(r);assert.equal(initial.plots[0].values.at(-1),1);assert.equal(initial.plots[1].values.at(-1),6);
 const next=r.run('live-update',[],{bar:{...bar(),v:11},asOf:306,sequence:1});assert.equal(next.plots[0].values.at(-1),2);assert.equal(next.plots[1].values.at(-1),6);assert.equal(next.live.sequence,1);
});
test('Realtime rollover confirms the actual old source bar, then starts a new bar',()=>{
 const r=new LiveScriptRuntime();start(r);const next=r.run('live-update',[],{bar:bar(360),closedBar:bar(),asOf:365,sequence:1});assert.equal(next.plots[0].values.at(-1),1);assert.equal(next.plots[1].values.at(-1),7);assert.equal(next.plots[0].values.at(-2),2);
});
for(const [name,update] of Object.entries({duplicate:{bar:bar(),asOf:306,sequence:0},gap:{bar:bar(),asOf:306,sequence:2},time:{bar:bar(),asOf:304,sequence:1},volume:{bar:{...bar(),v:9},asOf:306,sequence:1},open:{bar:{...bar(),o:101},asOf:306,sequence:1},rollover:{bar:bar(360),asOf:361,sequence:1}})) test('Realtime rejects '+name+' and requires explicit restart',()=>{
 const r=new LiveScriptRuntime();start(r);assert.throws(()=>r.run('live-update',[],update));assert.throws(()=>r.run('live-update',[],{bar:bar(),asOf:310,sequence:1}),/unavailable/);
});
test('Realtime does not seed future, duplicate or interior partial history',()=>{
 for(const bars of [[bar(400)], [bar(0),bar(0)], [{...bar(0),partial:true},bar(60)], [bar(60),bar(0)]])assert.throws(()=>new LiveScriptRuntime().run('live-start',bars,{source,interval:60,asOf:100}));
});
test('Realtime indicators cannot route strategy commands',()=>{
 assert.throws(()=>start(new LiveScriptRuntime(),{source:'strategy("Strategy")\nplot(close)'}),/indicators only/);
 assert.throws(()=>start(new LiveScriptRuntime(),{source:'indicator("Indicator")\nstrategy.entry("x",strategy.long)'}),/Declare strategy\(\) before order commands/);
});
test('Realtime memory limits fail rather than silently rolling off history',()=>{
 const r=new LiveScriptRuntime();start(r,{maxBars:6});assert.throws(()=>r.run('live-update',[],{bar:bar(360),closedBar:bar(),asOf:365,sequence:1}),/capacity/);
});
test('Job runtimes isolate realtime state and retain pure job behavior',()=>{
 const a=createJobRuntime(),b=createJobRuntime();a('live-start',[...history(),{...bar(),partial:true}],{source,interval:60,asOf:305});assert.throws(()=>b('live-update',[],{bar:bar(),asOf:306,sequence:1}),/unavailable/);
 assert.equal(a('script',history(),{source:'plot(close)'}).plots[0].values.length,5);a('live-stop',[]);assert.throws(()=>a('live-update',[],{bar:bar(),asOf:306,sequence:1}),/unavailable/);
});
test('Workerless runtime retains state and cancellation actually discards it',async()=>{
 const client=new JobClient();try{await client.run('live-start',[...history(),{...bar(),partial:true}],{source,interval:60,asOf:305});const r=await client.run('live-update',[],{bar:bar(),asOf:306,sequence:1});assert.equal(r.plots[0].values.at(-1),2);client.cancel();await assert.rejects(client.run('live-update',[],{bar:bar(),asOf:307,sequence:2}),/unavailable/);}finally{client.destroy();}
});
const profile=(rows)=>({t:0,levels:rows.map(([price,buy,sell,unknown=0])=>({price,buy,sell,unknown}))});
test('Diagonal footprint requires an observed adjacent row, not fabricated zero volume',()=>{
 const r=analyzeFootprint(profile([[100,10,1],[101,10,1],[103,100,1]]),1);
 assert.equal(r.levels[0].buyImbalance,false);assert.equal(r.levels[1].buyImbalance,true);assert.equal(r.levels[2].buyImbalance,false);
});
test('Stacked imbalance requires consecutive ticks and breaks across gaps',()=>{
 const r=analyzeFootprint(profile([[100,1,1],[101,9,1],[102,9,1],[103,9,1],[105,9,1]]),1);
 assert.deepEqual(r.stacks,[{side:'buy',low:101,high:103,rows:3}]);assert.equal(r.levels[4].stackedBuy,false);
});
test('Unknown aggressor volume contributes to value area, never classified imbalance',()=>{
 const r=analyzeFootprint(profile([[100,0,0,100],[101,5,1,0],[102,1,1,0]]),1,{valueArea:.7});assert.equal(r.poc,100);assert.equal(r.valueAreaVolume,100);assert.equal(r.total,108);assert.equal(r.levels[0].buyImbalance,false);assert.equal(r.levels[0].sellImbalance,false);
});
test('Footprint POC and area use deterministic lower-price tie breaking',()=>{
 const r=analyzeFootprint(profile([[101,5,5],[100,5,5],[102,5,5]]),1,{valueArea:.5});assert.equal(r.poc,100);assert.equal(r.valueAreaLow,100);assert.equal(r.valueAreaHigh,101);assert.equal(r.valueAreaVolume,20);
});
test('Same-row imbalance honors volume thresholds and does not flag zero versus zero',()=>{
 const r=analyzeFootprint(profile([[100,0,0],[101,2,0],[102,5,1]]),1,{imbalanceMode:'same',imbalanceMin:3});assert.deepEqual(r.levels.map(x=>x.buyImbalance),[false,false,true]);
});
test('Footprint settings are validated during workspace import',()=>{
 for(const options of [{imbalanceRatio:0},{imbalanceStack:2.5},{imbalanceMin:-1},{valueArea:1.1},{imbalanceMode:'imaginary'}]){assert.throws(()=>footprintSettings(options));assert.throws(()=>validateExtensions({version:2,typeOptions:options}));}
 assert.equal(validateExtensions({version:2,typeOptions:{valueArea:.8}}).typeOptions.valueArea,.8);
});
test('Footprint renderer preparation uses the same computed analysis and preserves input',()=>{
 const trades=[{t:10,price:100,size:1,side:'sell'},{t:11,price:101,size:10,side:'buy'}],original=structuredClone(trades),expected=analyzeFootprint(footprint(trades,{interval:60,tickSize:1})[0],1);
 assert.deepEqual(prepareTradeProfiles(trades,60,{tickSize:1}).footprint.get(0),expected);assert.deepEqual(trades,original);
});

test('An outbox retry persists earlier failed operations before claiming later edits are saved',async()=>{
 const {RoomDrawingSync}=await import('../src/drawing-sync.js');let calls=0,saved;
 const sync=new RoomDrawingSync({}, {outbox:{async put(_scope,batch){if(!calls++)throw new Error('Quota temporarily unavailable');saved=batch;},close(){}}});
 sync.replica={};sync.scope='test';const a={actor:'a',clock:1},b={actor:'b',clock:1};
 await assert.rejects(sync.persist([a]),/Quota/);assert.equal(sync.unsaved.size,1);await sync.persist([b]);assert.deepEqual(saved,[a,b]);assert.equal(sync.unsaved.size,0);assert.equal(sync.storageError,null);
});
