/** Main-thread owner of incremental chart buffers. Only this accumulator mutates
 * these buffers. Snapshots are views for rendering, not immutable audit exports.
 * Copy a snapshot explicitly before retaining it independently of the live chart.
 */
const fail = message => {throw new Error('Invalid realtime patch: '+message);};
const families=['plots','alerts','backgrounds'];
function signature(frame) {
  return JSON.stringify({title:frame.title,kind:frame.kind,overlay:frame.overlay,inputs:frame.inputs,
    plots:frame.plots.map(p=>[p.id,p.name,p.width,p.style,p.kind,p.location]),
    alerts:frame.alerts.map(a=>[a.id,a.title,a.message]),backgrounds:frame.backgrounds.map(b=>[b.id,b.kind])});
}
function validate(frame,rows,maxBars) {
  if(frame?.execution?.engine!=='incremental'||frame.kind!=='indicator'||!Number.isInteger(frame.bars)||frame.bars<1||frame.bars>maxBars)fail('engine or capacity');
  if(!frame.live||!Number.isInteger(frame.live.sequence)||!Number.isFinite(frame.live.asOf)||typeof frame.live.sessionId!=='string'||! /^[\w.-]{1,128}$/.test(frame.live.sessionId))fail('identity or clock');
  if(!Array.isArray(frame.commands)||frame.commands.length||!Array.isArray(frame.graphics)||frame.graphics.length||Object.keys(frame.captured||{}).length||frame.fills?.length)fail('unsupported effects');
  let cells=0;
  for(const family of families) {
    const items=frame[family];if(!Array.isArray(items)||items.length>5000)fail('output catalogue');
    if(new Set(items.map(x=>x.id)).size!==items.length)fail('duplicate output identity');
    for(const item of items) {
      const typed=family==='plots'?item.values instanceof Float64Array:family==='alerts'?item.values instanceof Uint8Array:Array.isArray(item.values);
      if(!typed||item.values.length!==rows)fail('output row count or type');
      if(family==='plots'&&(!Array.isArray(item.colors)||item.colors.length!==rows))fail('color row count');
      cells+=maxBars*(family==='plots'?2:1);
    }
  }
  if(cells>2000000)fail('output-memory budget');
}
export class LiveResultAccumulator {
  constructor(seed,{maxBars=5000}={}) {
    if(!Number.isInteger(maxBars)||maxBars<1||maxBars>10000)fail('capacity');
    validate(seed,seed.bars,maxBars);
    if(seed.patch||seed.live.sequence!==0)fail('full seed required');
    this.maxBars=maxBars;this.length=seed.bars;this.capacity=Math.min(maxBars,Math.max(16,2**Math.ceil(Math.log2(seed.bars))));
    this.lastAsOf=seed.live.asOf;this.identity=seed.live.sessionId;this.sequence=0;this.schema=signature(seed);this.frame=seed;
    this.buffers={};
    for(const family of families)this.buffers[family]=seed[family].map(item=>{
      const values=family==='backgrounds'?[...item.values]:new (family==='plots'?Float64Array:Uint8Array)(this.capacity);
      if(family!=='backgrounds')values.set(item.values);
      return {values,...(family==='plots'?{colors:[...item.colors]}:{})};
    });
  }
  apply(frame) {
    const start=Math.max(0,this.length-1);
    if(frame?.live?.sessionId!==this.identity||frame.live.sequence!==this.sequence+1||frame.live.asOf<this.lastAsOf||frame.patch?.baseSequence!==this.sequence||frame.patch.start!==start)fail('stale, foreign or noncontiguous sequence');
    if(frame.bars<this.length||frame.bars>this.length+1)fail('only one bar may append');
    validate(frame,frame.bars-start,this.maxBars);
    if(signature(frame)!==this.schema)fail('output schema changed');
    // Allocate every replacement before touching accepted state.
    let replacement=this.buffers,capacity=this.capacity;
    if(frame.bars>capacity) {
      capacity=Math.min(this.maxBars,capacity*2);replacement={};
      for(const family of families)replacement[family]=this.buffers[family].map(item=>{
        if(family==='backgrounds')return item;
        const values=new item.values.constructor(capacity);values.set(item.values.subarray(0,this.length));return {...item,values};
      });
    }
    for(const family of families)frame[family].forEach((item,i)=>{
      const target=replacement[family][i];
      if(family==='backgrounds'){for(let j=0;j<item.values.length;j++)target.values[start+j]=item.values[j];}
      else target.values.set(item.values,start);
      if(family==='plots')for(let j=0;j<item.colors.length;j++)target.colors[start+j]=item.colors[j];
    });
    this.buffers=replacement;this.capacity=capacity;this.length=frame.bars;this.sequence=frame.live.sequence;this.lastAsOf=frame.live.asOf;this.frame=frame;
    return this.snapshot();
  }
  snapshot() {
    const result={...this.frame};delete result.patch;
    for(const family of families)result[family]=this.frame[family].map((item,i)=>{
      const state=this.buffers[family][i];
      return {...item,values:family==='backgrounds'?state.values:state.values.subarray(0,this.length),...(family==='plots'?{colors:state.colors}:{})};
    });
    return result;
  }
}
