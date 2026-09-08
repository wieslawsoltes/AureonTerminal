import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {LiveScriptRuntime} from '../src/script-live.js';
import {LiveResultAccumulator} from '../src/script-live-result.js';

const SOURCE='indicator("Tail",overlay=true)\nx=ta.ema(close,3)\nplot(x,"EMA",color=close>open?color.green:color.red)\nplotshape(ta.crossover(close,x),"Cross")\nalertcondition(close>x,"Crossing")\nbarcolor(close>x?color.aqua:color.orange)';
const bars=n=>Array.from({length:n},(_,i)=>({t:1700000000+i*60,o:100+Math.sin(i),h:103+Math.sin(i),l:98+Math.sin(i),c:101+Math.sin(i),v:100+i}));
function setup(n=30) {
  const a=new LiveScriptRuntime(),b=new LiveScriptRuntime(),seed=bars(n),options={source:SOURCE,interval:60,symbol:'TEST',asOf:seed.at(-1).t+20};
  const result=a.run('live-start',seed,{...options,transport:'tail',sessionId:'session.test'});b.run('live-start',seed,{...options,engine:'reference'});
  return {a,b,seed,accumulator:new LiveResultAccumulator(result),result};
}
function equivalent(a,b) {
  for(const k of ['title','kind','overlay','bars','inputs','commands','fills','backgrounds','alerts','graphics'])assert.deepEqual(a[k],b[k],k);
  a.plots.forEach((p,i)=>{
    const q=b.plots[i];for(const key of ['id','name','color','colors','style','width','kind','location'])assert.deepEqual(p[key],q[key],key);
    assert.equal(p.values.length,q.values.length);
    p.values.forEach((v,j)=>assert.ok(Object.is(v,q.values[j])||Math.abs(v-q.values[j])<1e-8));
  });
}
function update(n=30) {return {bar:bars(n).at(-1),asOf:bars(n).at(-1).t+30,sequence:1};}
test('v45 tail patches reconstruct all plots, colors, shapes, alerts and backgrounds without full-history transfer',()=>{
  const {a,b,seed,accumulator}=setup();const all=bars(70);let sequence=0;
  for(let index=29;index<70;index++) {
    const options={bar:all[index],...(index>29?{closedBar:all[index-1]}:{}),asOf:all[index].t+20,sequence:++sequence};
    const patch=a.run('live-update',[],options),reference=b.run('live-update',[],options);
    assert.equal(patch.execution.transport,'tail patch');assert.ok(patch.plots.every(p=>p.values.length<=2));
    assert.ok(patch.execution.outputCells<=12);equivalent(accumulator.apply(patch),reference);
    const same={bar:{...all[index],c:all[index].c+.1},asOf:all[index].t+25,sequence:++sequence};
    equivalent(accumulator.apply(a.run('live-update',[],same)),b.run('live-update',[],same));
  }
  assert.equal(seed.length,30);assert.equal(accumulator.length,70);
});
test('v45 steady patch application reuses numerical buffers and only grows at a geometric boundary',()=>{
  const {a,accumulator}=setup(30),base=accumulator.snapshot(),buffer=base.plots[0].values.buffer,options=update();
  accumulator.apply(a.run('live-update',[],options));assert.equal(accumulator.snapshot().plots[0].values.buffer,buffer);
  for(let n=31;n<=33;n++)accumulator.apply(a.run('live-update',[],{bar:bars(n).at(-1),closedBar:bars(n-1).at(-1),asOf:bars(n).at(-1).t+20,sequence:n-29}));
  assert.equal(accumulator.capacity,64);assert.notEqual(accumulator.snapshot().plots[0].values.buffer,buffer);
});
for(const [name,mutate] of [
  ['sequence gap',r=>r.live.sequence++],['stale cursor',r=>r.patch.baseSequence++],['foreign session',r=>r.live.sessionId='foreign'],
  ['past rewrite',r=>r.patch.start--],['dropped prefix',r=>r.patch.start++],['bar jump',r=>r.bars+=3],
  ['wrong array',r=>r.plots[0].values=[1]],['wrong rows',r=>r.plots[0].values=new Float64Array(0)],
  ['duplicate plots',r=>r.plots.push(r.plots[0])],['schema change',r=>r.plots[0].name='Other'],
  ['commands',r=>r.commands.push({action:'entry'})],['backwards clock',r=>r.live.asOf-=200],['NaN clock',r=>r.live.asOf=NaN],
  ['captured mutable objects',r=>r.captured.x=[1]],['missing colors',r=>delete r.plots[0].colors]
])test(`v45 ${name} rejects atomically without changing accepted chart buffers`,()=>{
  const {a,accumulator}=setup(),patch=a.run('live-update',[],update()),before=structuredClone(accumulator.snapshot()),invalid=structuredClone(patch);
  mutate(invalid);assert.throws(()=>accumulator.apply(invalid),/Invalid realtime patch/);assert.deepEqual(accumulator.snapshot(),before);
  assert.equal(accumulator.apply(patch).live.sequence,1);
});
test('v45 duplicate acknowledgement cannot reapply the same output patch',()=>{
  const {a,accumulator}=setup(),patch=a.run('live-update',[],update());accumulator.apply(patch);assert.throws(()=>accumulator.apply(patch),/sequence/);
});
test('v45 forced reference transport returns full snapshots without disguising a tail patch',()=>{
  const a=new LiveScriptRuntime(),seed=bars(4),options={source:'varip n=0\nn+=1\nplot(n)',interval:60,asOf:seed[3].t+20,transport:'tail',sessionId:'reference.test'};
  const result=a.run('live-start',seed,options);assert.equal(result.execution.engine,'reference');assert.throws(()=>new LiveResultAccumulator(result),/engine/);
  const next=a.run('live-update',[],{bar:seed[3],sequence:1,asOf:seed[3].t+21});assert.equal(next.patch,undefined);assert.equal(next.plots[0].values.length,4);
});
test('v45 a single-open-bar seed and zero-to-one historical transition preserve dynamic first color',()=>{
  const {a,b,accumulator}=setup(1),options={bar:{...bars(1)[0],c:99},asOf:1700000040,sequence:1};
  equivalent(accumulator.apply(a.run('live-update',[],options)),b.run('live-update',[],options));
});
test('v45 malformed transport options and seeds fail before accepting an accumulator',()=>{
  const a=new LiveScriptRuntime(),seed=bars(3),options={source:'plot(close)',interval:60,asOf:seed[2].t+20};
  assert.throws(()=>a.run('live-start',seed,{...options,transport:'silent'}),/transport/);
  assert.throws(()=>a.run('live-start',seed,{...options,transport:'tail'}),/identity/);
  const {result}=setup();assert.throws(()=>new LiveResultAccumulator({...result,patch:{start:0}}),/seed/);assert.throws(()=>new LiveResultAccumulator(result,{maxBars:2}),/capacity/);
});
test('v45 actual engine worker transfers tail buffers repeatedly without detaching retained state',async()=>{
  const url=new URL('../src/engine-worker.js',import.meta.url).href;
  const shim=`import {parentPort} from 'node:worker_threads';globalThis.self={postMessage:(x,t)=>parentPort.postMessage(x,t)};await import(${JSON.stringify(url)});parentPort.on('message',data=>self.onmessage({data}));`;
  const worker=new Worker(new URL('data:text/javascript,'+encodeURIComponent(shim)),{type:'module'});
  let id=0;
  const request=(type,bars,options)=>new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{cleanup();reject(new Error('Worker request deadline'));},5000);
    const cleanup=()=>{clearTimeout(timer);worker.off('message',message);worker.off('error',error);};
    const message=reply=>{cleanup();reply.error?reject(new Error(reply.error)):resolve(reply.result);};
    const error=e=>{cleanup();reject(e);};worker.on('message',message);worker.on('error',error);worker.postMessage({id:++id,type,bars,options});
  });
  try {
    const seed=bars(100),result=await request('live-start',seed,{source:SOURCE,interval:60,symbol:'TEST',asOf:seed[99].t+20,transport:'tail',sessionId:'node.worker'}),accumulator=new LiveResultAccumulator(result);
    for(let i=1;i<=12;i++) {
      const patch=await request('live-update',[],{bar:{...seed[99],v:1000+i,c:seed[99].c+.001*i},asOf:seed[99].t+20+i,sequence:i});
      assert.ok(patch.plots[0].values instanceof Float64Array);assert.equal(patch.plots[0].values.length,1);assert.equal(accumulator.apply(patch).plots[0].values.length,100);
    }
    assert.deepEqual(await request('live-stop',[],{}),{stopped:true});
    await assert.rejects(request('live-update',[],{bar:seed[99],sequence:13,asOf:seed[99].t+40}),/unavailable/);
  } finally {await worker.terminate();}
});
