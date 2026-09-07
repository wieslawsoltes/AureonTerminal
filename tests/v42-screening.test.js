import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {prepareScreenSnapshot,ScriptScreenRuntime} from '../src/script-screening.js';
import {ScreeningClient} from '../src/screening-client.js';
import {validateScreenQuery,queryScreenRows,screeningCSV,screenColumns} from '../src/screening-query.js';
import {createJobRuntime,JobClient} from '../src/jobs.js';
const bars=(n,start=0)=>Array.from({length:n},(_,i)=>({t:start+i*60,o:100+i,h:101+i,l:99+i,c:100+i,v:10+i}));
const dataset=(symbol='AAA',n=5)=>({symbol,interval:60,source:'Explicit fixture',bars:bars(n)});
const options=(extra={})=>({source:'indicator("Screen")\nplot(close,"Close")\nplot(ta.median(close,3),"Median")',universe:[dataset('AAA'),dataset('BBB')],asOf:300,...extra});
const screen=(opts=options())=>{const r=new ScriptScreenRuntime();r.run('screen-init',{...opts,session:'test'});return opts.universe.map((_,index)=>r.run('screen-symbol',{session:'test',index}));};
test('Screen snapshots exclude future and trailing provisional rows without mutating input',()=>{
 const o=options({asOf:180});o.universe[0].bars[4].partial=true;const before=structuredClone(o),s=prepareScreenSnapshot(o);
 assert.deepEqual(o,before);assert.equal(s.totalBars,6);assert.equal(s.universe[0].excluded,2);assert.equal(s.universe[0].bars.at(-1).t,120);
 o.universe[0].bars[0].c=999;assert.equal(s.universe[0].bars[0].c,100);
});
test('Screen returns independent per-symbol numerical plots and metadata',()=>{
 const r=screen();assert.equal(r.length,2);for(const row of r){assert.equal(row.error,undefined);assert.equal(row.time,300);assert.equal(row.age,0);assert.equal(row.bars,5);assert.deepEqual(row.plots,[{name:'Close',value:104,previous:103},{name:'Median',value:103,previous:102}]);}
});
test('Cutoff and provisional filtering also apply to explicit security datasets',()=>{
 const fast=dataset('AAA',6),slow={symbol:'HTF',interval:180,source:'Fixture HTF',bars:[bars(1)[0],{...bars(1,180)[0],o:999,h:999,l:999,c:999}]};
 const out=screen(options({source:'plot(request.security("HTF","3",close),"Remote")',universe:[fast,slow],asOf:300}));
 assert.equal(out[0].plots[0].value,100);assert.equal(out[0].time,300);assert.equal(out[1].bars,1);
});
test('Runtime parse errors replace old sessions and invalid IDs never access them',()=>{
 const runtime=new ScriptScreenRuntime();runtime.run('screen-init',{...options(),session:'first'});
 assert.throws(()=>runtime.run('screen-symbol',{session:'other',index:0}),/unavailable/);
 assert.throws(()=>runtime.run('screen-init',{...options({source:'invalid ('}),session:'next'}));
 assert.throws(()=>runtime.run('screen-symbol',{session:'first',index:0}),/unavailable/);
});
test('One dataset with no closed bars produces a visible error instead of a zero quote',()=>{
 const o=options({universe:[dataset('AAA',0),dataset('BBB')]}),r=screen(o);assert.match(r[0].error,/No fully closed/);assert.equal(r[0].price,null);assert.equal(r[1].error,undefined);
});
test('Screener rejects strategy scripts and plotless scripts explicitly',()=>{
 assert.match(screen(options({source:'strategy("Not routed")\nstrategy.entry("x",strategy.long)\nplot(close)'}))[0].error,/indicators only/);
 assert.match(screen(options({source:'x=close'}))[0].error,/no plot outputs/);
});
for(const [name,edit]of Object.entries({duplicate:o=>o.universe.push(dataset()),unordered:o=>o.universe[0].bars.reverse(),interiorPartial:o=>o.universe[0].bars[0].partial=true,derived:o=>o.universe[0].bars[0].synthetic=true,invalid:o=>o.universe[0].bars[0].h=1,noSource:o=>o.universe[0].source='',invalidCutoff:o=>o.asOf=NaN,invalidBudget:o=>o.maxOperations=2,oversized:o=>o.universe=Array(101).fill(dataset())}))test('Screen input rejects '+name,()=>{const o=options();edit(o);assert.throws(()=>prepareScreenSnapshot(o));});
test('Screen output budgets isolate per-row script failures',()=>{
 const r=screen(options({source:'for i=0 to 1000\n    x=close\nplot(x)',maxOperations:1000}));assert.ok(r.every(x=>/budget/.test(x.error)));
});
const sampleRows=()=>[
 {index:0,symbol:'AAA',interval:60,bars:5,time:300,age:0,price:10,previousPrice:9,volume:8,source:'Fixture',plots:[{name:'Fast',value:12,previous:8},{name:'Slow',value:11,previous:9}]},
 {index:1,symbol:'BBB',interval:60,bars:5,time:300,age:0,price:null,source:'Fixture',plots:[{name:'Fast',value:null,previous:8},{name:'Slow',value:9,previous:10}]},
 {index:2,symbol:'CCC',interval:60,bars:0,price:null,source:'Fixture',plots:[],error:'No bars'}
];
test('Screen filters compare current and previous columns for real threshold crossings',()=>{
 const q={filters:[{field:'plot:Fast',op:'crossup',otherField:'plot:Slow'}]},result=queryScreenRows(sampleRows(),q);assert.deepEqual(result.rows.map(r=>r.symbol),['AAA']);assert.equal(result.errors.length,1);
 assert.equal(queryScreenRows(sampleRows(),{filters:[{field:'plot:Fast',op:'>',value:0}]}).total,1);
 assert.equal(queryScreenRows(sampleRows(),{filters:[{field:'plot:Fast',op:'isna'}]}).rows[0].symbol,'BBB');
});
test('Screen sorting keeps missing values last in either direction and stable ties',()=>{
 for(const direction of['asc','desc'])assert.deepEqual(queryScreenRows(sampleRows(),{sort:'price',direction}).rows.map(r=>r.symbol),['AAA','BBB']);
 const r=sampleRows();r[1].price=10;assert.deepEqual(queryScreenRows(r,{sort:'price',direction:'desc'}).rows.map(r=>r.index),[0,1]);
});
test('Screen text filters, conjunctions, disjunctions and pagination are validated',()=>{
 const r=sampleRows();assert.equal(queryScreenRows(r,{filters:[{field:'symbol',op:'contains',value:'bb'}]}).rows[0].symbol,'BBB');
 assert.equal(queryScreenRows(r,{filters:[{field:'symbol',op:'==',value:'AAA'}]}).rows[0].symbol,'AAA');
 const q={combine:'any',filters:[{field:'price',op:'>',value:20},{field:'symbol',op:'==',value:'BBB'}],limit:1};assert.equal(queryScreenRows(r,q).total,1);assert.equal(queryScreenRows(r,q,1).rows.length,0);
 for(const x of[{sort:'constructor'},{filters:[{field:'price',op:'script',value:1}]},{filters:[{field:'price',op:'>',value:NaN}]},{limit:0},{filters:[{field:'source',op:'>',value:1}]}])assert.throws(()=>validateScreenQuery(x));
});
test('CSV quote escaping, missing cells, formula guards and error provenance are retained',()=>{
 const r=sampleRows();r[0].source='=HYPERLINK("untrusted")';r[0].plots.push({name:'@header',value:-1,previous:null});
 const csv=screeningCSV({rows:r,asOf:300});assert.ok(csv.includes('"\'=HYPERLINK(""untrusted"")"'));assert.ok(csv.includes('"\'@header"'));assert.ok(csv.includes('"-1"'));assert.ok(csv.includes('"No bars"'));assert.ok(csv.includes('"BBB","60","300"'));
});
test('Excess dynamically named columns fail rather than silently truncate',()=>{
 assert.throws(()=>screenColumns(Array.from({length:65},(_,i)=>({plots:[{name:'P'+i}]}))),/64 distinct/);
});
function mockFactory({delay=0,worker=true,fail=false}={}){const clients=[];return{clients,create(){const runtime=createJobRuntime();let disposed=false;const client={worker:worker?{}:null,async run(type,_bars,opts){await new Promise(r=>setTimeout(r,delay));if(disposed)throw new Error('disposed');if(fail&&type==='screen-symbol')throw new Error('worker failure');return runtime(type,[],opts);},destroy(){disposed=true;this.disposed=true;}};clients.push(client);return client;}};}
test('Worker pool snapshots once, reports progress and restores deterministic universe order',async()=>{
 const f=mockFactory({delay:1}),pool=new ScreeningClient({createClient:()=>f.create()}),o=options({workers:2}),progress=[];
 const work=pool.run(o,p=>progress.push(p.completed));o.universe[0].bars[4].c=999;
 const result=await work;assert.equal(result.rows[0].price,104);assert.deepEqual(result.rows.map(r=>r.symbol),['AAA','BBB']);assert.equal(result.workers,2);assert.deepEqual(progress,[0,1,2]);assert.ok(f.clients.every(c=>c.disposed));assert.equal(pool.active,null);
});
test('Cancel and replacement stop old workers and suppress obsolete progress',async()=>{
 const f=mockFactory({delay:5}),pool=new ScreeningClient({createClient:()=>f.create()}),progress=[];
 const first=pool.run(options(),p=>progress.push(p)).catch(e=>e);pool.cancel();const second=await pool.run(options({universe:[dataset('NEW')]}));
 assert.equal((await first).name,'AbortError');assert.equal(progress.length,0);assert.equal(second.rows[0].symbol,'NEW');assert.ok(f.clients.every(c=>c.disposed));pool.destroy();await assert.rejects(pool.run(options()),/disposed/);
});
test('Worker infrastructure failures reject scans and release all replicas',async()=>{
 const f=mockFactory({fail:true}),pool=new ScreeningClient({createClient:()=>f.create()});await assert.rejects(pool.run(options()),/worker failure/);assert.equal(pool.active,null);assert.ok(f.clients.every(c=>c.disposed));
});
test('Synchronous fallback is explicit, yields between symbols and cannot accept large universes',async()=>{
 const pool=new ScreeningClient({createClient:()=>new JobClient()});const r=await pool.run(options({workers:4}));assert.equal(r.mode,'synchronous-limited');assert.equal(r.workers,1);assert.equal(r.maxOperations,250000);
 await assert.rejects(pool.run(options({universe:[dataset('LARGE',10001)],asOf:1000000})),/10,000 total/);pool.destroy();
});
test('Actual engine worker initializes once and returns small scalar scan rows',async()=>{
 const url=new URL('../src/engine-worker.js',import.meta.url).href;
 const source=`import{parentPort}from'node:worker_threads';globalThis.self={postMessage:(m,t)=>parentPort.postMessage(m,t)};await import(${JSON.stringify(url)});parentPort.on('message',data=>self.onmessage({data}));`;
 const worker=new Worker(new URL('data:text/javascript,'+encodeURIComponent(source)),{type:'module'});let id=0;
 const request=(type,opts)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{worker.removeAllListeners('message');reject(new Error('Worker timeout'));},10000);worker.once('error',reject);worker.once('message',m=>{clearTimeout(timer);m.error?reject(new Error(m.error)):resolve(m.result);});worker.postMessage({id:++id,type,bars:[],options:opts});});
 try{await request('screen-init',{...options(),session:'actual'});const row=await request('screen-symbol',{session:'actual',index:0});assert.deepEqual(row,screen()[0]);assert.ok(JSON.stringify(row).length<1000);await request('screen-close',{session:'actual'});await assert.rejects(request('screen-symbol',{session:'actual',index:0}),/unavailable/);}finally{await worker.terminate();}
});

test('Screen query templates round-trip through portable workspace validation without aliasing',async()=>{
 const {defaultExtensions,validateExtensions}=await import('../src/workspace-v2.js');const source=defaultExtensions();source.screenQuery=validateScreenQuery({filters:[{field:'plot:Fast',op:'crossup',otherField:'plot:Slow'}],sort:'plot:Fast',direction:'asc'});source.screenTemplates=[{id:'one',name:'Crossing',query:source.screenQuery}];const loaded=validateExtensions(JSON.parse(JSON.stringify(source)));assert.deepEqual(loaded.screenQuery,source.screenQuery);assert.deepEqual(loaded.screenTemplates,source.screenTemplates);source.screenQuery.filters[0].op='crossdown';assert.equal(loaded.screenTemplates[0].query.filters[0].op,'crossup');
});
test('Invalid or duplicate saved screen queries are rejected, not silently truncated',async()=>{
 const {defaultExtensions,validateExtensions}=await import('../src/workspace-v2.js');const source=defaultExtensions(),query=validateScreenQuery();source.screenTemplates=Array(21).fill({id:'one',name:'Query',query});assert.throws(()=>validateExtensions(source),/20/);source.screenTemplates=Array(2).fill({id:'one',name:'Query',query});assert.throws(()=>validateExtensions(source),/Duplicate/);source.screenTemplates=[{id:'one',name:'Query',query:{filters:[{field:'constructor',op:'>',value:0}]}}];assert.throws(()=>validateExtensions(source),/Unknown/);
});
test('Disposed analysis clients reject new work instead of resurrecting worker resources',async()=>{
 const j=new JobClient();j.destroy();await assert.rejects(j.run('script',[],{source:'plot(close)'}),/disposed/i);const c=new ScreeningClient();c.destroy();await assert.rejects(c.run(options()),/disposed/i);
});
test('Opening a result dataset requires completed scan identity and returns a detached copy',async()=>{
 const c=new ScreeningClient({createClient:()=>new JobClient()});assert.throws(()=>c.dataset(0),/completed/);await c.run(options());const copy=c.dataset(0);copy.bars[0].c=999;assert.equal(c.dataset(0).bars[0].c,100);assert.throws(()=>c.dataset(-1));c.destroy();assert.throws(()=>c.dataset(0),/completed/);
});

test('Crossings reject numeric metadata that has no retained previous value',()=>{
 for(const field of['change','age','time','interval','bars'])for(const op of['crossup','crossdown'])assert.throws(()=>validateScreenQuery({filters:[{field,op,value:0}]}),/prior values/);
});
test('Both sides of column crossings require prior values, not just the left operand',()=>{
 for(const otherField of['age','change','time','bars','interval'])assert.throws(()=>validateScreenQuery({filters:[{field:'plot:Signal',op:'crossup',otherField}]}),/Both crossing columns/);
 for(const field of['price','volume','plot:Signal'])assert.doesNotThrow(()=>validateScreenQuery({filters:[{field,op:'crossup',otherField:'plot:Threshold'}]}));
});
test('Portable saved query validation rejects unsupported metadata crossings',async()=>{
 const {defaultExtensions,validateExtensions}=await import('../src/workspace-v2.js');const source=defaultExtensions();source.screenTemplates=[{id:'invalid-cross',name:'Invalid',query:{filters:[{field:'change',op:'crossup',value:0}]}}];assert.throws(()=>validateExtensions(source),/prior values/);
});
