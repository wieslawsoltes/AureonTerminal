import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {TradingCalendar,validateTradingCalendar,sessionBoundary,sessionLocalParts,shiftSessionDate,tradingCalendarTemplate} from '../src/session-calendar.js';
import {analyzeTradingSessions,validateSessionSettings,sessionAnalysisCSV,sessionAnalysisStudy} from '../src/session-analysis.js';
import {validateExtensions,defaultExtensions} from '../src/workspace-v2.js';
import {performJob} from '../src/jobs.js';
const epoch=s=>Date.parse(s)/1000;
const calendar=(extra={})=>({name:'Explicit fixture',timezone:'UTC',weekdays:[0,1,2,3,4,5,6],segments:[{open:'09:00',close:'10:00'}],...extra});
const bar=(t,p=100,v=1)=>({t,o:p,h:p+1,l:p-1,c:p,v});
const bars=(date='2024-01-01',n=60,dt=60,offset=0)=>Array.from({length:n},(_,i)=>bar(epoch(date+'T09:00:00Z')+i*dt+offset,100+i,i+1));
const opts=(values={})=>({interval:60,asOf:epoch('2024-01-10T00:00:00Z'),settings:{calendar:calendar(),openingMinutes:30,targetInterval:300},...values});
const near=(a,b,epsilon=1e-9)=>assert(Math.abs(a-b)<=epsilon,`${a} vs ${b}`);

test('v44 calendar validates real Gregorian dates and date arithmetic',()=>{
  assert.equal(shiftSessionDate('2024-02-28',1),'2024-02-29');assert.equal(shiftSessionDate('2024-12-31',1),'2025-01-01');
  for(const date of ['2023-02-29','1900-02-29','2024-13-01','2024-01-32','24-01-01'])assert.throws(()=>new TradingCalendar(calendar({holidays:[date]})));
});
test('v44 rejects unsafe or unknown calendar fields without mutating input',()=>{
  const input=calendar(),copy=structuredClone(input);const c=new TradingCalendar(input);assert.deepEqual(input,copy);assert(Object.isFrozen(c.spec.segments));
  input.segments[0].open='12:00';assert.equal(c.spec.segments[0].open,'09:00');
  for(const extra of [{foo:1},{timezone:'Invalid/Zone'},{weekdays:[7]},{weekdays:[]},{name:''},{version:2},{disambiguation:'compatible'},{tradeDateOffset:2}])assert.throws(()=>validateTradingCalendar(calendar(extra)));
  assert.throws(()=>validateTradingCalendar(JSON.parse('{"__proto__":{}}')),/Unknown/);
  assert.throws(()=>validateTradingCalendar(calendar({overrides:JSON.parse('{"__proto__":[]}')})),/date/);
});
test('v44 segment validation enforces order, overlap, duration and finite clocks',()=>{
  for(const segments of [[],[{open:'24:00',close:'24:00'}],[{open:'09:99',close:'10:00'}],[{open:'09:00',close:'10:00',x:1}],[{open:'09:00',close:'11:00'},{open:'10:00',close:'12:00'}],[{open:'09:00',close:'10:00',openDay:1}],[{open:'09:00',close:'10:00',closeDay:1}]])assert.throws(()=>new TradingCalendar(calendar({segments})));
});
test('v44 closure and exception limits reject rather than truncate',()=>{
  assert.throws(()=>validateTradingCalendar(calendar({holidays:Array(4097).fill('2024-01-01')})),/4,096/);
  assert.throws(()=>validateTradingCalendar(calendar({segments:Array(9).fill({open:'09:00',close:'10:00'})})),/1–8/);
  assert.throws(()=>validateTradingCalendar(calendar({holidays:['2024-01-01'],overrides:{'2024-01-01':[]}})),/both/);
});
test('v44 half-open New York core boundaries follow winter and summer offset',()=>{
  const c=new TradingCalendar(tradingCalendarTemplate('ny'));
  for(const [date,opening]of[['2024-01-08','14:30'],['2024-07-08','13:30']]){const t=epoch(`${date}T${opening}:00Z`);assert(!c.contains(t-1));assert(c.contains(t));assert(!c.contains(t+6.5*3600));}
});
test('v44 midnight session spans 23 and 25 actual hours through DST',()=>{
  const c=new TradingCalendar({timezone:'America/New_York'});
  assert.equal(c.session('2024-03-10').seconds,23*3600);assert.equal(c.session('2024-11-03').seconds,25*3600);
});
test('v44 half-hour DST and quarter-hour base offsets use actual zone rules',()=>{
  const c=new TradingCalendar({timezone:'Australia/Lord_Howe'});
  assert.equal(c.session('2024-10-06').seconds,23.5*3600);assert.equal(c.session('2024-04-07').seconds,24.5*3600);
  assert.equal(sessionBoundary('2024-01-01','09:00','Asia/Kathmandu'),epoch('2024-01-01T03:15:00Z'));
});
test('v44 nonexistent local boundaries fail under every fold policy',()=>{
  for(const policy of ['reject','earlier','later'])assert.throws(()=>sessionBoundary('2024-03-10','02:30','America/New_York',policy),/Nonexistent/);
  assert.throws(()=>sessionBoundary('2011-12-30','12:00','Pacific/Apia'),/Nonexistent/);
});
test('v44 repeated local boundary requires explicit earlier/later choice',()=>{
  assert.throws(()=>sessionBoundary('2024-11-03','01:30','America/New_York'),/Ambiguous/);
  assert.equal(sessionBoundary('2024-11-03','01:30','America/New_York','earlier'),epoch('2024-11-03T05:30:00Z'));
  assert.equal(sessionBoundary('2024-11-03','01:30','America/New_York','later'),epoch('2024-11-03T06:30:00Z'));
});
test('v44 24:00 resolves next civil midnight rather than adding 86400 seconds',()=>{
  assert.equal(sessionBoundary('2024-03-10','24:00','America/New_York'),epoch('2024-03-11T04:00:00Z'));
});
test('v44 overnight weekday membership and trade labels use session-start date',()=>{
  const c=new TradingCalendar(tradingCalendarTemplate('overnight'));const s=c.session('2024-01-07');
  assert.equal(s.tradeDate,'2024-01-08');assert(c.contains(epoch('2024-01-08T01:00:00Z')));assert(c.contains(epoch('2024-01-08T18:00:00Z')));
  assert.equal(c.session('2024-01-12'),null);
});
test('v44 overnight holiday closes both sides of midnight using the start date',()=>{
  const c=new TradingCalendar({...tradingCalendarTemplate('overnight'),holidays:['2024-01-07']});
  assert(!c.contains(epoch('2024-01-08T01:00:00Z')));assert(!c.contains(epoch('2024-01-08T18:00:00Z')));
  assert(c.contains(epoch('2024-01-09T01:00:00Z')));
});
test('v44 overrides permit an exceptional weekend and explicit empty closure',()=>{
  const c=new TradingCalendar({...tradingCalendarTemplate('ny'),overrides:{'2024-01-06':[{open:'10:00',close:'12:00'}],'2024-01-08':[]}});
  assert(c.contains(epoch('2024-01-06T15:00:00Z')));assert.equal(c.session('2024-01-08'),null);
});
test('v44 shortened sessions use the explicit override rather than usual close',()=>{
  const c=new TradingCalendar({...tradingCalendarTemplate('ny'),overrides:{'2024-07-03':[{open:'09:30',close:'13:00'}]}});
  assert.equal(c.session('2024-07-03').close,epoch('2024-07-03T17:00:00Z'));assert(!c.contains(epoch('2024-07-03T17:01:00Z')));
});
test('v44 split-session breaks are excluded and buckets restart at segment open',()=>{
  const c=new TradingCalendar(calendar({segments:[{open:'09:00',close:'11:30'},{open:'12:30',close:'15:00'}]}));
  assert(!c.contains(epoch('2024-01-01T12:00:00Z')));assert.equal(c.bucket(epoch('2024-01-01T12:31:00Z'),3600).open,epoch('2024-01-01T12:30:00Z'));
});
test('v44 split overnight sessions support explicit second-day segments',()=>{
  const c=new TradingCalendar(calendar({segments:[{open:'18:00',close:'23:00'},{open:'01:00',close:'17:00',openDay:1}]}));
  assert.equal(c.session('2024-01-01').seconds,21*3600);assert(!c.contains(epoch('2024-01-02T00:30:00Z')));assert(c.contains(epoch('2024-01-02T01:00:00Z')));
});
test('v44 adjacent overrides cannot silently overlap overnight sessions',()=>{
  const c=new TradingCalendar(calendar({segments:[{open:'18:00',close:'17:00'}],overrides:{'2024-01-02':[{open:'09:00',close:'12:00'}]}}));
  assert.throws(()=>c.between(epoch('2024-01-01T18:00:00Z'),epoch('2024-01-02T18:00:00Z')),/overlap/);
  assert.throws(()=>c.contains(epoch('2024-01-02T10:00:00Z')),/overlap/);
});
test('v44 range expansion and bucket sizes are bounded',()=>{
  const c=new TradingCalendar();assert.deepEqual(c.between(0,0),[]);assert.throws(()=>c.between(1,0),/Reversed/);
  assert.throws(()=>c.between(0,4000*86400),/limit/);for(const n of[0,-1,1.5,Infinity,86401])assert.throws(()=>c.bucket(0,n));
});
test('v44 schedule templates are distinct immutable specifications without fabricated holidays',()=>{
  for(const id of ['utc','ny','overnight','split']){const c=tradingCalendarTemplate(id);assert.equal(c.holidays.length,0);assert(Object.isFrozen(c));}
  assert.throws(()=>tradingCalendarTemplate('unknown'));
});
test('v44 session membership survives cache eviction',()=>{
  const c=new TradingCalendar();const before=c.session('2022-01-01');for(let i=0;i<600;i++)c.session(shiftSessionDate('2022-01-01',i));assert.deepEqual(c.session('2022-01-01'),before);
});
test('v44 local parts handle zero hour and are independent of host timezone',()=>{
  const p=sessionLocalParts(epoch('2024-01-01T00:00:00Z'),'UTC');assert.deepEqual(p,{date:'2024-01-01',hour:0,minute:0,second:0,weekday:1});
});
test('v44 complete session aggregation preserves OHLC and exact volume',()=>{
  const b=bars(),r=analyzeTradingSessions(b,opts());assert.equal(r.accepted,60);assert.equal(r.sessions.length,1);assert.equal(r.bars.length,12);
  const s=r.sessions[0];assert.deepEqual([s.o,s.h,s.l,s.c,s.v,s.complete,s.coverage],[100,160,99,159,1830,true,1]);
  assert(r.bars.every(x=>x.complete&&!x.partial));assert.equal(r.bars.reduce((n,x)=>n+x.v,0),1830);
});
test('v44 bucket aggregation never bridges split-session breaks',()=>{
  const b=[...bars('2024-01-01',30),...bars('2024-01-01',30,60,90*60)];
  const r=analyzeTradingSessions(b,opts({settings:{calendar:calendar({segments:[{open:'09:00',close:'09:30'},{open:'10:30',close:'11:00'}]}),targetInterval:3600}}));
  assert.equal(r.bars.length,2);assert.equal(r.bars[1].t,epoch('2024-01-01T10:30:00Z'));assert(r.bars.every(x=>x.complete));assert(r.sessions[0].complete);
});
test('v44 missing source slots produce partial buckets and incomplete sessions',()=>{
  const b=bars();b.splice(5,1);const r=analyzeTradingSessions(b,opts());assert.equal(r.sessions[0].missingSeconds,60);assert(!r.sessions[0].complete);assert(!r.bars[1].complete);assert.equal(r.bars[1].count,4);
});
test('v44 shortened final bucket can be complete with explicit actual end',()=>{
  const r=analyzeTradingSessions(bars('2024-01-01',50),opts({settings:{calendar:calendar({overrides:{'2024-01-01':[{open:'09:00',close:'09:50'}]}}),targetInterval:1800}}));
  assert.equal(r.bars.at(-1).end-r.bars.at(-1).t,1200);assert(r.bars.at(-1).complete);assert(r.sessions[0].complete);
});
test('v44 future and provisional bars never contribute or expand the calendar',()=>{
  const b=bars();b[2].partial=true;b.push(bar(epoch('2199-01-01T09:00:00Z')));
  const r=analyzeTradingSessions(b,opts({asOf:b[10].t}));assert.equal(r.accepted,9);assert.equal(r.excluded.partial,1);assert.equal(r.excluded.future,51);
  assert(Number.isNaN(r.plots.VWAP[2]));assert(Number.isNaN(r.plots.VWAP[10]));assert.equal(r.windows.length,1);
});
test('v44 outside and session-boundary bars are rejected without allocating volume',()=>{
  const b=[bar(epoch('2024-01-01T08:30:00Z')),bar(epoch('2024-01-01T09:00:00Z')),bar(epoch('2024-01-01T09:40:00Z'))];
  const r=analyzeTradingSessions(b,opts({interval:1800,settings:{calendar:calendar(),targetInterval:3600}}));
  assert.equal(r.excluded.outside,1);assert.equal(r.excluded.boundary,1);assert.equal(r.accepted,1);assert.equal(r.sessions[0].v,1);
});
test('v44 misaligned source timestamps are explicit exclusions',()=>{
  const r=analyzeTradingSessions(bars('2024-01-01',10,60,1),opts());assert.equal(r.excluded.misaligned,10);assert.equal(r.bars.length,0);assert.equal(r.emptySessions.length,1);
});
test('v44 incompatible target intervals fail before producing false bars',()=>{
  for(const targetInterval of [30,90])assert.throws(()=>analyzeTradingSessions(bars(),opts({settings:{calendar:calendar(),targetInterval}})),/multiple/);
});
test('v44 invalid OHLC, duplicates, overlap and derived display input reject',()=>{
  for(const change of [{c:Infinity},{v:-1},{l:102},{h:99},{partial:'true'},{t:1.5},{synthetic:true},{sourceIndex:1},{derived:true}]){const b=bars();Object.assign(b[0],change);assert.throws(()=>analyzeTradingSessions(b,opts()));}
  const b=bars();b[1].t=b[0].t+30;assert.throws(()=>analyzeTradingSessions(b,opts()),/nonoverlapping/);
  assert.throws(()=>analyzeTradingSessions([],opts()));assert.throws(()=>analyzeTradingSessions(bars(),opts({asOf:NaN})));
});
test('v44 session VWAP and variance match an independent weighted reference',()=>{
  const b=bars(),r=analyzeTradingSessions(b,opts());for(let n=1;n<=b.length;n++){const xs=b.slice(0,n),weight=xs.reduce((s,x)=>s+x.v,0),mean=xs.reduce((s,x)=>s+x.c*x.v,0)/weight,variance=xs.reduce((s,x)=>s+x.v*(x.c-mean)**2,0)/weight;
    near(r.plots.VWAP[n-1],mean);near(r.plots.Upper[n-1],mean+2*Math.sqrt(variance));near(r.plots.Lower[n-1],mean-2*Math.sqrt(variance));}
});
test('v44 session moments retain small variation at large price offsets',()=>{
  const b=bars().map((x,i)=>bar(x.t,1e12+(i%7)*.25,1));const r=analyzeTradingSessions(b,opts());
  const mean=b.reduce((s,x)=>s+(x.c-1e12),0)/b.length,variance=b.reduce((s,x)=>s+(x.c-1e12-mean)**2,0)/b.length;
  near(r.sessions[0].vwap,1e12+mean,.0002);near(r.sessions[0].deviation,Math.sqrt(variance),.0002);
});
test('v44 zero volume is unknown before first positive weight and never divided by zero',()=>{
  const b=bars().map(x=>({...x,v:0})),r=analyzeTradingSessions(b,opts());assert(r.plots.VWAP.every(Number.isNaN));assert.equal(r.sessions[0].vwap,null);assert(r.sessions[0].complete);
});
test('v44 numerical overflow rejects instead of returning infinite results',()=>{
  const b=bars().map(x=>({...x,v:Number.MAX_VALUE}));assert.throws(()=>analyzeTradingSessions(b,opts()),/overflow/);
});
test('v44 VWAP resets at session start but not at a lunch break',()=>{
  const b=[...bars(),...bars('2024-01-02')];const r=analyzeTradingSessions(b,opts());assert.equal(r.plots.VWAP[60],100);
  const split=analyzeTradingSessions([bar(epoch('2024-01-01T09:00:00Z'),100),bar(epoch('2024-01-01T10:00:00Z'),200)],opts({settings:{calendar:calendar({segments:[{open:'09:00',close:'09:01'},{open:'10:00',close:'10:01'}]}),targetInterval:60}}));assert.equal(split.plots.VWAP[1],150);
});
test('v44 opening levels become visible only on closing the fully observed window',()=>{
  const r=analyzeTradingSessions(bars(),opts());assert(r.plots['Opening high'].slice(0,29).every(Number.isNaN));assert.equal(r.plots['Opening high'][29],130);assert.equal(r.plots['Opening high'][59],130);assert.equal(r.plots['Opening low'][29],99);
});
test('v44 missing opening data cannot yield a falsely confirmed opening range',()=>{
  const b=bars();b.splice(3,1);const r=analyzeTradingSessions(b,opts());assert(r.plots['Opening high'].every(Number.isNaN));assert.equal(r.sessions[0].openingComplete,false);
});
test('v44 opening window ends at the first segment close, never crosses a break',()=>{
  const r=analyzeTradingSessions(bars('2024-01-01',10),opts({settings:{calendar:calendar({segments:[{open:'09:00',close:'09:10'},{open:'10:00',close:'11:00'}]}),openingMinutes:30,targetInterval:300}}));
  assert.equal(r.plots['Opening high'][9],110);assert(r.sessions[0].openingComplete);assert(!r.sessions[0].complete);
});
test('v44 previous-session levels require the immediately preceding full session',()=>{
  const r=analyzeTradingSessions([...bars(),...bars('2024-01-02')],opts());assert(Number.isNaN(r.plots['Previous high'][59]));assert.equal(r.plots['Previous high'][60],160);
  const gap=analyzeTradingSessions([...bars(),...bars('2024-01-03')],opts());assert(Number.isNaN(gap.plots['Previous high'][60]));assert.equal(gap.emptySessions.length,1);
  const missing=bars();missing.splice(2,1);const incomplete=analyzeTradingSessions([...missing,...bars('2024-01-02')],opts());assert(Number.isNaN(incomplete.plots['Previous high'][59]));
});
test('v44 explicit holiday does not count as a missing previous scheduled session',()=>{
  const r=analyzeTradingSessions([...bars(),...bars('2024-01-03')],opts({settings:{calendar:calendar({holidays:['2024-01-02']}),targetInterval:300}}));
  assert.equal(r.plots['Previous close'][60],159);assert.equal(r.emptySessions.length,0);
});
test('v44 every session plot is prefix causal, including opening and previous levels',()=>{
  const b=[...bars(),...bars('2024-01-02')],full=analyzeTradingSessions(b,opts());
  for(const n of [1,2,15,29,30,31,59,60,61,90,120]){const prefix=analyzeTradingSessions(b.slice(0,n),opts({asOf:b[n-1].t+60}));for(const name of Object.keys(full.plots))assert.deepEqual(prefix.plots[name],full.plots[name].slice(0,n),`${name}: prefix ${n}`);}
});
test('v44 aggregation handles repeated civil hours as distinct chronological slots',()=>{
  const c={timezone:'America/New_York'},start=epoch('2024-11-03T04:00:00Z'),b=Array.from({length:25},(_,i)=>bar(start+i*3600));
  const r=analyzeTradingSessions(b,{interval:3600,asOf:start+25*3600,settings:{calendar:c,targetInterval:3600}});
  assert.equal(r.bars.length,25);assert.equal(new Set(r.bars.map(x=>x.t)).size,25);assert(r.sessions[0].complete);
});
test('v44 raw history is immutable and numeric plots stay Float64',()=>{
  const b=bars(),before=structuredClone(b),r=analyzeTradingSessions(b,opts());assert.deepEqual(b,before);assert(Object.values(r.plots).every(x=>x instanceof Float64Array));assert.equal(sessionAnalysisStudy(r).plots.length,8);
});
test('v44 settings and explicit overrides survive workspace and named-layout round trips',()=>{
  const x=defaultExtensions();x.sessionResearch=validateSessionSettings({calendar:calendar({overrides:{'2024-01-03':[]}}),shade:true});const round=validateExtensions(JSON.parse(JSON.stringify(x)));assert.deepEqual(round.sessionResearch,x.sessionResearch);
  assert.throws(()=>validateExtensions({...x,sessionResearch:{shade:'yes'}}));assert.throws(()=>validateSessionSettings({multiplier:Infinity}));assert.throws(()=>validateSessionSettings({unknown:1}));
});
test('v44 exported CSV guards source/calendar formulas and preserves completion flags',()=>{
  const r=analyzeTradingSessions(bars(),opts({settings:{calendar:calendar({name:'=Explicit fixture'}),targetInterval:300}})),csv=sessionAnalysisCSV(r,'sessions','\t=source');
  assert(csv.includes('"\'\t=source"'));assert(csv.includes('"\'=Explicit fixture"'));assert(csv.includes('"coverage"'));assert(csv.includes('"true"'));assert.throws(()=>sessionAnalysisCSV(r,'unknown'));
});
test('v44 worker dispatcher executes session research instead of a placeholder',()=>{
  assert.deepEqual(performJob('sessions',bars(),opts()),analyzeTradingSessions(bars(),opts()));
});
test('v44 actual module worker returns equivalent transferred session plots',async()=>{
  const url=new URL('../src/engine-worker.js',import.meta.url).href;
  const worker=new Worker(new URL('data:text/javascript,'+encodeURIComponent(`import{parentPort}from'node:worker_threads';globalThis.self={postMessage:(m,t)=>parentPort.postMessage(m,t)};await import(${JSON.stringify(url)});parentPort.on('message',data=>self.onmessage({data}));`)),{type:'module'});
  try {const r=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('worker timeout')),10000);worker.once('error',e=>{clearTimeout(timer);reject(e);});worker.once('message',r=>{clearTimeout(timer);resolve(r);});worker.postMessage({id:44,type:'sessions',bars:bars(),options:opts()});});assert.equal(r.error,undefined);assert.deepEqual(r.result,structuredClone(analyzeTradingSessions(bars(),opts())));}
  finally{await worker.terminate();}
});

test('v44 session plot breaks identify session, segment and source-gap boundaries',()=>{
  const b=[...bars(),...bars('2024-01-02')];b.splice(5,1);const r=analyzeTradingSessions(b,opts());
  assert.deepEqual([...r.breaks.entries()].filter(([,v])=>v).map(([i])=>i),[0,5,59]);
  assert.strictEqual(sessionAnalysisStudy(r).plots[0].breaks,r.breaks);
});
