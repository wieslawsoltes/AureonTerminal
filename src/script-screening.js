/** Immutable, explicitly supplied closed-bar universes. No implicit providers. */
import {validateCandle} from './core.js';
import {compileScript,runScript} from './script.js';
export function prepareScreenSnapshot(options) {
  if(!options||typeof options.source!=='string'||!options.source.trim()||options.source.length>100000)throw new TypeError('A screening script of 1–100,000 characters is required');
  const asOf=options.asOf??Math.floor(Date.now()/1000),maxOperations=options.maxOperations??2000000;
  if(!Number.isSafeInteger(asOf)||asOf<0||asOf>253402300799)throw new RangeError('Screen cutoff must be valid UTC seconds');
  if(!Number.isInteger(maxOperations)||maxOperations<1000||maxOperations>20000000)throw new RangeError('Screen operation budget must be 1,000–20,000,000');
  if(!Array.isArray(options.universe)||!options.universe.length||options.universe.length>100)throw new RangeError('Screening requires 1–100 explicit datasets');
  // Bound input before copying. The worker replica budget is separately enforced.
  let total=0;
  for(const u of options.universe){if(!Array.isArray(u?.bars)||u.bars.length>250000)throw new RangeError('Dataset must have at most 250,000 bars');total+=u.bars.length;}
  if(total>500000)throw new RangeError('Screening input exceeds 500,000 bars');
  const inputs=Object.create(null),libraries=Object.create(null);
  if(options.inputs!=null&&(typeof options.inputs!=='object'||Array.isArray(options.inputs)))throw new TypeError('Inputs must be a scalar map');
  const inputEntries=Object.entries(options.inputs||{});if(inputEntries.length>256)throw new RangeError('Too many screen inputs');
  for(const [key,value]of inputEntries){if(!/^[\w .:-]{1,200}$/.test(key)||['__proto__','constructor','prototype'].includes(key)||!['number','boolean','string'].includes(typeof value)||typeof value==='number'&&!Number.isFinite(value)||typeof value==='string'&&value.length>2000)throw new TypeError('Invalid screening input');inputs[key]=value;}
  if(options.libraries!=null&&(typeof options.libraries!=='object'||Array.isArray(options.libraries)))throw new TypeError('Libraries must be an explicit versioned map');
  const entries=Object.entries(options.libraries||{});if(entries.length>32)throw new RangeError('Too many screening libraries');
  for(const [key,library]of entries){if(!/^[A-Za-z0-9_.-]+\/[A-Za-z][A-Za-z0-9_]*\/[1-9][0-9]*$/.test(key)||typeof library?.source!=='string'||library.source.length>100000)throw new TypeError('Invalid screening library');libraries[key]={source:library.source};}
  const keys=new Set();let totalBars=0;
  const universe=options.universe.map((u,index)=>{
    if(typeof u.symbol!=='string'||!/^[A-Z0-9._/-]{1,40}$/.test(u.symbol)||!Number.isSafeInteger(u.interval)||u.interval<1||u.interval>31536000||typeof u.source!=='string'||!u.source.trim()||u.source.length>300)throw new TypeError('Screen datasets require symbol, interval and provenance');
    const key=u.symbol+':'+u.interval;if(keys.has(key))throw new TypeError('Duplicate symbol/interval dataset: '+key);keys.add(key);
    let previous=-1;const bars=[];
    for(let i=0;i<u.bars.length;i++){
      const b=validateCandle(u.bars[i]);if(b.t<=previous)throw new RangeError('Screen bars must be strictly ordered and unique');previous=b.t;
      if(b.synthetic)throw new TypeError('Screening requires raw, not derived display candles');
      if(b.partial&&i!==u.bars.length-1)throw new TypeError('A provisional candle must be last');
      if(!Number.isSafeInteger(b.t+u.interval))throw new RangeError('Bar close time exceeds safe integer range');
      if(!b.partial&&b.t+u.interval<=asOf)bars.push({t:b.t,o:b.o,h:b.h,l:b.l,c:b.c,v:b.v});
    }
    totalBars+=bars.length;
    return{index,symbol:u.symbol,interval:u.interval,source:u.source,bars,excluded:u.bars.length-bars.length};
  });
  return {version:1,source:options.source,inputs,libraries,universe,asOf,maxOperations,totalBars};
}
const number=value=>Number.isFinite(value)?value:null;
export class ScriptScreenRuntime {
  constructor(){this.session=null;}
  run(type,options={}) {
    if(type==='screen-init'){
      this.session=null;
      if(typeof options.session!=='string'||!/^[\w.-]{1,128}$/.test(options.session))throw new TypeError('A bounded screening session ID is required');
      const snapshot=prepareScreenSnapshot(options),program=compileScript(snapshot.source,{libraries:snapshot.libraries});
      const datasets=Object.fromEntries(snapshot.universe.map(u=>[u.symbol+':'+u.interval,u]));
      this.session={id:options.session,snapshot,program,datasets};
      return{session:options.session,count:snapshot.universe.length,totalBars:snapshot.totalBars};
    }
    const state=this.session;
    if(!state||state.id!==options.session)throw new Error('Screening session unavailable or replaced');
    if(type==='screen-close'){this.session=null;return{closed:true};}
    if(type!=='screen-symbol')throw new TypeError('Unknown screening operation');
    const index=options.index;
    if(!Number.isInteger(index)||index<0||index>=state.snapshot.universe.length)throw new RangeError('Screen dataset index out of range');
    const u=state.snapshot.universe[index],bars=u.bars,last=bars.at(-1),previous=bars.at(-2);
    const row={index,symbol:u.symbol,interval:u.interval,source:u.source,bars:bars.length,excluded:u.excluded,time:last?last.t+u.interval:null,age:last?state.snapshot.asOf-last.t-u.interval:null,price:number(last?.c),previousPrice:number(previous?.c),volume:number(last?.v),previousVolume:number(previous?.v),change:last&&previous&&previous.c!==0?number((last.c/previous.c-1)*100):null,plots:[]};
    try{
      if(!bars.length)throw new Error('No fully closed observations at this cutoff');
      const r=runScript(state.program,bars,{symbol:u.symbol,interval:u.interval,inputs:state.snapshot.inputs,libraries:state.snapshot.libraries,datasets:state.datasets,maxOperations:state.snapshot.maxOperations,maxCollectionElements:1000000});
      if(r.kind==='strategy'||r.commands.length)throw new Error('Screening accepts indicators only, never execution commands');
      if(r.plots.length>16)throw new RangeError('Screen scripts support at most 16 output plots');
      if(!r.plots.length)throw new Error('Screen script has no plot outputs');
      row.operations=r.operations;
      row.plots=r.plots.map(p=>{if(typeof p.name!=='string'||!p.name.length||p.name.length>240)throw new TypeError('Plot title must be 1–240 characters');return{name:p.name,value:number(p.values.at(-1)),previous:number(p.values.at(-2))};});
    }catch(error){row.error=String(error.message||error).slice(0,2000);row.plots=[];}
    return row;
  }
}
