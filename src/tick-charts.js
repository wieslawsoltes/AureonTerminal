/** Tick-derived chart data. Real observations only: never interpolate a price
 * through an unobserved gap. A volume bar may split size, but never trade price.
 */
export function validateTrades(raw,{max=500000}={}) {
  if(!Array.isArray(raw)||raw.length>max)throw new RangeError('Trade dataset limit exceeded');
  let previous=-Infinity;const seen=new Set(),out=[];
  for(const x of raw){const t=Number(x.t??x.time),price=Number(x.price),size=Number(x.size);if(!Number.isFinite(t)||t<0||t<previous||!Number.isFinite(price)||price<=0||!Number.isFinite(size)||size<=0)throw new RangeError('Trades require ascending timestamps, positive price and size');
    if(x.side!=null&&!['buy','sell','unknown'].includes(x.side))throw new RangeError('Trade side must be aggressor buy/sell/unknown');previous=t;const id=x.id==null?null:String(x.id);if(id&&seen.has(id))continue;if(id)seen.add(id);out.push({t,price,size,side:x.side||'unknown',id});}
  return out;
}
export function buildTradeBars(raw,{mode='ticks',threshold=100,maxBars=100000}={}) {
  if(!['ticks','volume','range'].includes(mode)||!Number.isFinite(threshold)||threshold<=0||(mode==='ticks'&&!Number.isInteger(threshold))||!Number.isInteger(maxBars)||maxBars<1||maxBars>250000)throw new RangeError('Invalid trade-bar specification');
  const trades=validateTrades(raw),out=[];let bar=null;
  const start=x=>({t:x.t,endTime:x.t,o:x.price,h:x.price,l:x.price,c:x.price,v:0,trades:0,partial:true,source:'observed trades',sourceIndex:out.length});
  const finish=()=>{bar.partial=false;out.push(bar);if(out.length>maxBars)throw new RangeError('Trade-bar output limit exceeded');bar=null;};
  for(let i=0;i<trades.length;i++){
    const x=trades[i];let remaining=x.size,steps=0;
    while(remaining>0){if(++steps>maxBars+1)throw new RangeError('Volume split limit exceeded');bar??=start(x);const size=mode==='volume'?Math.min(remaining,threshold-bar.v):remaining;
      bar.h=Math.max(bar.h,x.price);bar.l=Math.min(bar.l,x.price);bar.c=x.price;bar.endTime=x.t;bar.v+=size;bar.trades++;bar.lastTradeIndex=i;remaining-=size;
      const full=mode==='ticks'?bar.trades>=threshold:mode==='volume'?bar.v>=threshold*(1-1e-12):bar.h-bar.l>=threshold;
      if(full)finish();if(mode!=='volume'||remaining<x.size*1e-14)break;
    }
  }
  if(bar){if(out.length>=maxBars)throw new RangeError('Trade-bar output limit exceeded');out.push(bar);}return out;
}
export function footprint(raw,{interval=3600,tickSize=.01,maxLevels=50000}={}) {
  if(!Number.isInteger(interval)||interval<1||!Number.isFinite(tickSize)||tickSize<=0)throw new RangeError('Invalid footprint aggregation');
  const trades=validateTrades(raw),bars=new Map();let count=0;
  for(const x of trades){const time=Math.floor(x.t/interval)*interval,key=Math.round(x.price/tickSize);if(!Number.isSafeInteger(key))throw new RangeError('Tick index exceeds exact integer domain');let b=bars.get(time);if(!b){b={t:time,levels:new Map(),buy:0,sell:0,unknown:0};bars.set(time,b);}let l=b.levels.get(key);if(!l){if(++count>maxLevels)throw new RangeError('Footprint level limit exceeded');l={price:key*tickSize,buy:0,sell:0,unknown:0};b.levels.set(key,l);}l[x.side]+=x.size;b[x.side]+=x.size;}
  let cvd=0;return [...bars.values()].map(b=>{const levels=[...b.levels.values()].sort((a,b)=>a.price-b.price).map(l=>({...l,total:l.buy+l.sell+l.unknown,delta:l.buy-l.sell}));const poc=levels.reduce((a,b)=>!a||b.total>a.total?b:a,null);return {...b,levels,poc:poc?.price,delta:b.buy-b.sell,cvd:cvd+=b.buy-b.sell,total:b.buy+b.sell+b.unknown,source:'Observed trades; unknown side retained'};});
}
export function tpoFromTrades(raw,{sessionSeconds=86400,periodSeconds=1800,tickSize=1,maxLevels=50000}={}) {
  if(!Number.isInteger(sessionSeconds)||sessionSeconds<1||!Number.isInteger(periodSeconds)||periodSeconds<1||periodSeconds>sessionSeconds||!Number.isFinite(tickSize)||tickSize<=0)throw new RangeError('Invalid TPO specification');const trades=validateTrades(raw),sessions=new Map();let count=0;
  for(const x of trades){const start=Math.floor(x.t/sessionSeconds)*sessionSeconds,period=Math.floor((x.t-start)/periodSeconds),key=Math.round(x.price/tickSize);if(!Number.isSafeInteger(key))throw new RangeError('Invalid price step');let s=sessions.get(start);if(!s){s={t:start,levels:new Map()};sessions.set(start,s);}let level=s.levels.get(key);if(!level){if(++count>maxLevels)throw new RangeError('TPO level limit');level={price:key*tickSize,periods:new Set()};s.levels.set(key,level);}level.periods.add(period);}
  return [...sessions.values()].map(s=>({t:s.t,levels:[...s.levels.values()].sort((a,b)=>a.price-b.price).map(l=>({price:l.price,periods:[...l.periods].sort((a,b)=>a-b)})),source:'Observed-price TPO; no interpolation between prints'}));
}
