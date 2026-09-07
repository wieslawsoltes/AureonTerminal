/** Pure, DOM-independent domain layer. Time is Unix seconds; prices are quote/base. */
export const VERSION = 1;
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const uid = () => globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export function lowerBound(items, value, key = x => x.t) {
  let a = 0, b = items.length;
  while (a < b) { const m = (a + b) >>> 1; if (key(items[m]) < value) a = m + 1; else b = m; }
  return a;
}
export function validateCandle(c) {
  if (!c || !['t','o','h','l','c','v'].every(k => typeof c[k] === 'number' && Number.isFinite(c[k]))) throw new Error('OHLCV values must be finite numbers.');
  if (!Number.isSafeInteger(c.t) || c.t < 0) throw new Error('Candle time must be nonnegative Unix seconds.');
  if (c.h < Math.max(c.o,c.c,c.l) || c.l > Math.min(c.o,c.c,c.h) || c.v < 0) throw new Error(`Invalid OHLCV envelope at ${c.t}.`);
  return c;
}
export function normalizeCandles(input) {
  if (!Array.isArray(input) || input.length > 250000) throw new Error('Expected an array of at most 250,000 candles.');
  const map = new Map();
  for (const c of input) { validateCandle(c); map.set(c.t, {t:c.t,o:c.o,h:c.h,l:c.l,c:c.c,v:c.v, ...(c.partial ? {partial:true} : {})}); }
  return [...map.values()].sort((a,b) => a.t-b.t);
}
/** Weekly bars use ISO Monday 00:00 UTC; all other intervals use the Unix epoch. */
export const bucketTime = (time, seconds) => { const offset=seconds===604800?345600:0; return Math.floor((time-offset)/seconds)*seconds+offset; };
export class CandleSeries {
  constructor(candles = [], interval = 3600) {
    if (!Number.isInteger(interval) || interval < 1) throw new Error('Invalid interval.');
    this.interval = interval; this.bars = normalizeCandles(candles); this.version = 0;
    this.ids = new Set(); this.idQueue = []; this.acceptAfter = 0;
  }
  merge(candles) {
    const incoming=normalizeCandles(candles),out=[];let i=0,j=0;
    while(i<this.bars.length||j<incoming.length){
      const a=this.bars[i],b=incoming[j];
      if(!b||(a&&a.t<b.t)){out.push(a);i++;}
      else if(!a||b.t<a.t){out.push(b);j++;}
      else{out.push(b);i++;j++;}
    }
    if(out.length>250000)throw new Error('Candle capacity exceeded.');
    this.bars=out;this.version++;
  }
  /** Ticks before an authoritative REST snapshot cutoff are intentionally ignored.
   * Current bars are provisional; finalized bars are later reconciled against REST. */
  tick({time, price, size, id}) {
    if (![time,price,size].every(Number.isFinite) || price <= 0 || size < 0 || time < this.acceptAfter) return false;
    const key = id == null ? null : String(id);
    if (key !== null && this.ids.has(key)) return false;
    const bucket = bucketTime(time, this.interval);
    let last = this.bars.at(-1);
    if (last && bucket < last.t) return false; // Older finalized bars: repair via REST, not an unbounded late tick.
    if (key !== null) {
      this.ids.add(key); this.idQueue.push(key);
      if (this.idQueue.length > 20000) for (const old of this.idQueue.splice(0,10000)) this.ids.delete(old);
    }
    if (!last || bucket > last.t) {
      last = {t:bucket,o:price,h:price,l:price,c:price,v:size,partial:true,_first:time,_last:time}; this.bars.push(last);
    } else {
      last.h = Math.max(last.h,price); last.l = Math.min(last.l,price); last.v += size; last.partial = true;
      if (time >= (last._last ?? last.t)) { last.c = price; last._last = time; }
      if (last._first != null && time < last._first) { last.o = price; last._first = time; }
    }
    this.version++; return true;
  }
}
export function resample(candles, seconds) {
  if (!Number.isInteger(seconds) || seconds < 1) throw new Error('Invalid resampling interval.');
  const out = [];
  for (const c of normalizeCandles(candles)) {
    const t = bucketTime(c.t,seconds); let b = out.at(-1);
    if (!b || b.t !== t) out.push(b = {t,o:c.o,h:c.h,l:c.l,c:c.c,v:c.v});
    else { b.h=Math.max(b.h,c.h); b.l=Math.min(b.l,c.l); b.c=c.c; b.v+=c.v; }
    if (c.partial) b.partial=true;
  }
  return out;
}
export function heikinAshi(bars) {
  let po = 0, pc = 0;
  return bars.map((b,i) => {
    const c = (b.o+b.h+b.l+b.c)/4, o = i ? (po+pc)/2 : (b.o+b.c)/2;
    po=o; pc=c; return {...b,o,c,h:Math.max(b.h,o,c),l:Math.min(b.l,o,c)};
  });
}
export class UndoStack {
  constructor(limit=150) { this.limit=limit; this.undoItems=[]; this.redoItems=[]; }
  push(before,after) {
    if (JSON.stringify(before)===JSON.stringify(after)) return;
    this.undoItems.push({before:structuredClone(before),after:structuredClone(after)});
    if (this.undoItems.length>this.limit) this.undoItems.shift(); this.redoItems=[];
  }
  undo() { const op=this.undoItems.pop(); if (!op) return null; this.redoItems.push(op); return structuredClone(op.before); }
  redo() { const op=this.redoItems.pop(); if (!op) return null; this.undoItems.push(op); return structuredClone(op.after); }
}
/** RFC4180-style quoted CSV parser, accepting header names time/timestamp/date and OHLCV. */
export function parseCSV(text) {
  if (typeof text!=='string' || text.length>30_000_000) throw new Error('CSV is too large (30 MB maximum).');
  const rows=[]; let row=[], cell='', quoted=false;
  for (let i=0;i<text.length;i++) {
    const ch=text[i];
    if (ch==='"') { if (quoted && text[i+1]==='"') { cell+='"';i++; } else quoted=!quoted; }
    else if (ch===',' && !quoted) {row.push(cell);cell='';}
    else if ((ch==='\n'||ch==='\r')&&!quoted) {
      if (ch==='\r'&&text[i+1]==='\n') i++;
      row.push(cell);if(row.some(x=>x.trim())) rows.push(row);row=[];cell='';
    } else cell+=ch;
  }
  if(quoted) throw new Error('CSV contains an unterminated quoted field.');
  row.push(cell);if(row.some(x=>x.trim())) rows.push(row);
  const headers=(rows.shift()||[]).map(x=>x.trim().replace(/^\uFEFF/,'').toLowerCase());
  const columns={t:['time','timestamp','date','datetime'],o:['open','o'],h:['high','h'],l:['low','l'],c:['close','c'],v:['volume','v']};
  const ix=Object.fromEntries(Object.entries(columns).map(([k,n])=>[k,headers.findIndex(h=>n.includes(h))]));
  if(Object.values(ix).some(x=>x<0)) throw new Error('CSV must have time, open, high, low, close, volume columns.');
  return normalizeCandles(rows.map((r,i)=>{
    const raw=r[ix.t]?.trim();let t;
    if (/^\d+(\.\d+)?$/.test(raw)) {t=Number(raw);if(t>1e12)t/=1000;}
    else { if(!/^\d{4}-\d{2}-\d{2}$/.test(raw) && !/Z$|[+-]\d\d:\d\d$/i.test(raw)) throw new Error(`Row ${i+2}: ISO timestamps must include a timezone.`); t=Date.parse(raw)/1000; }
    const c={t:Math.floor(t)};
    for(const k of ['o','h','l','c','v']) {if(!r[ix[k]]?.trim())throw new Error(`Row ${i+2}: missing ${k}.`);c[k]=Number(r[ix[k]]);}
    return validateCandle(c);
  }));
}
export const toCSV = bars => 'time,open,high,low,close,volume\n'+bars.map(b=>[new Date(b.t*1000).toISOString(),b.o,b.h,b.l,b.c,b.v].join(',')).join('\n');
export function niceStep(range, target=6) {
  if (!(range>0)) return 1;
  const raw=range/target, power=10**Math.floor(Math.log10(raw)), n=raw/power;
  return (n<=1?1:n<=2?2:n<=2.5?2.5:n<=5?5:10)*power;
}
export function segmentDistance(px,py,ax,ay,bx,by) {
  const dx=bx-ax,dy=by-ay,t=clamp(((px-ax)*dx+(py-ay)*dy)/(dx*dx+dy*dy||1),0,1);
  return Math.hypot(px-ax-t*dx,py-ay-t*dy);
}
/** Deterministic test/demo data. Always identified as synthetic in the UI. */
export function demoCandles(count=1000, interval=3600, seed=42, base=67000) {
  let state=seed>>>0;
  const rnd=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  const start=Date.UTC(2025,0,1)/1000; let c=base; const out=[];
  for(let i=0;i<count;i++) { const o=c; c=Math.max(base*.08,o*Math.exp((rnd()-.49)*.012+Math.sin(i*.025)*.0008));
    const h=Math.max(o,c)*(1+rnd()*.003),l=Math.min(o,c)*(1-rnd()*.003);
    out.push({t:start+i*interval,o,h,l,c,v:10+rnd()*130+Math.abs(c-o)*.06}); }
  return out;
}
/** Local, long-only spot paper ledger. No exchange order endpoints exist in this app. */
export class PaperBroker {
  constructor(state) {
    this.state=state ? structuredClone(state) : {cash:100000,initial:100000,feeBps:10,positions:{},orders:[],fills:[]};
  }
  place({symbol,side,type,quantity,price},quote) {
    if (!/^[A-Z0-9.-]+-USD$/.test(symbol)) throw new Error('Paper ledger supports USD-quoted spot pairs only.');
    if (!['buy','sell'].includes(side)||!['market','limit','stop'].includes(type)) throw new Error('Invalid order type or side.');
    if (!(quantity>0)||!Number.isFinite(quantity)) throw new Error('Quantity must be positive.');
    if (type!=='market'&&(!(price>0)||!Number.isFinite(price))) throw new Error('A positive trigger price is required.');
    const order={id:uid(),symbol,side,type,quantity,price:Number(price)||0,status:'open',created:Date.now()};
    if(type==='market') {
      if (!quote || Date.now()-quote.received>15000 || (Number.isFinite(quote.time)&&Date.now()-quote.time*1000>15000) || !(quote.bid>0&&quote.ask>0) || quote.ask<quote.bid) throw new Error('A fresh, valid live bid/ask is required for a paper market order.');
      this.fill(order,side==='buy'?quote.ask:quote.bid);
    } else this.state.orders.push(order);
    return order;
  }
  fill(order,price) {
    const s=this.state, p=s.positions[order.symbol]||{qty:0,cost:0,realized:0};
    const notional=order.quantity*price,fee=notional*s.feeBps/10000;
    if(order.side==='buy') {
      if(notional+fee>s.cash+1e-8)throw new Error('Insufficient paper cash.');
      s.cash-=notional+fee;p.qty+=order.quantity;p.cost+=notional+fee;
    } else {
      if(order.quantity>p.qty+1e-10)throw new Error('Insufficient spot position. Short selling is disabled.');
      const cost=p.qty ? p.cost*order.quantity/p.qty : 0;
      p.qty=Math.max(0,p.qty-order.quantity);p.cost=Math.max(0,p.cost-cost);p.realized+=notional-fee-cost;s.cash+=notional-fee;
    }
    s.positions[order.symbol]=p;order.status='filled';order.fillPrice=price;order.fee=fee;
    s.fills.unshift({...order,filled:Date.now()});s.fills=s.fills.slice(0,500);
  }
  onQuote(symbol,quote) {
    if(!quote || Date.now()-quote.received>15000 || (Number.isFinite(quote.time)&&Date.now()-quote.time*1000>15000) || !(quote.bid>0&&quote.ask>0) || quote.ask<quote.bid) return [];
    const filled=[];
    for(const o of this.state.orders) {
      if(o.symbol!==symbol||o.status!=='open')continue;
      const p=o.side==='buy'?quote.ask:quote.bid;
      const hit=o.type==='limit'?(o.side==='buy'?p<=o.price:p>=o.price):(o.side==='buy'?p>=o.price:p<=o.price);
      if(hit) {try {this.fill(o,p);filled.push(o);}catch(e){o.status='rejected';o.reason=e.message;}}
    }
    return filled;
  }
  cancel(id) {const o=this.state.orders.find(o=>o.id===id&&o.status==='open');if(o)o.status='cancelled';}
  equity(quotes) {let total=this.state.cash;for(const [symbol,p]of Object.entries(this.state.positions))total+=p.qty*(quotes.get(symbol)?.price||(p.qty?p.cost/p.qty:0));return total;}
}
export class AlertEngine {
  constructor(alerts=[]) {this.alerts=alerts;this.previous=new Map();}
  add(symbol,price,direction='cross') {if(!(price>0)||!Number.isFinite(price)||!['cross','above','below'].includes(direction))throw new Error('Invalid alert.');const a={id:uid(),symbol,price,direction,active:true,created:Date.now()};this.alerts.push(a);return a;}
  evaluate(symbol,price) {
    if(!Number.isFinite(price))return [];
    const prev=this.previous.get(symbol);this.previous.set(symbol,price);const result=[];
    if(prev==null)return result;
    for(const a of this.alerts)if(a.active&&a.symbol===symbol){
      const up=prev<a.price&&price>=a.price,down=prev>a.price&&price<=a.price;
      if((a.direction==='cross'&&(up||down))||(a.direction==='above'&&up)||(a.direction==='below'&&down)){a.active=false;a.triggered=Date.now();a.triggerPrice=price;result.push(a);}
    }
    return result;
  }
}
export function validateWorkspace(raw) {
  if(!raw || raw.version!==VERSION)throw new Error('Unsupported workspace schema.');
  if(typeof raw.symbol!=='string'||!/^[A-Z0-9._-]{1,32}$/.test(raw.symbol))throw new Error('Invalid symbol.');
  if(![60,300,900,3600,14400,21600,86400,604800].includes(raw.interval))throw new Error('Invalid interval.');
  const tools=['trend','ray','hline','vline','rectangle','fib','text','measure'];
  const drawings=raw.drawings||{};
  if(!drawings||typeof drawings!=='object'||Array.isArray(drawings)||Object.keys(drawings).length>200)throw new Error('Too many drawing layers.');
  for(const name of Object.keys(drawings))if(['__proto__','constructor','prototype'].includes(name)||!/^[A-Z0-9._-]{1,32}$/.test(name))throw new Error('Invalid drawing layer name.');
  for(const items of Object.values(drawings)){
    if(!Array.isArray(items)||items.length>3000)throw new Error('Invalid drawing layer.');
    for(const d of items){
      if(!tools.includes(d.type)||typeof d.id!=='string'||!Array.isArray(d.points)||d.id.length>128||d.points.length!==(['hline','vline','text'].includes(d.type)?1:2))throw new Error('Invalid drawing.');
      for(const p of d.points)if(!Number.isFinite(p.t)||p.t<0||p.t>8e12||!Number.isFinite(p.p))throw new Error('Invalid drawing coordinates.');
      if(d.text!=null&&(typeof d.text!=='string'||d.text.length>500))throw new Error('Invalid drawing label.');
      if(d.color!=null&&!/^#[0-9a-f]{6}$/i.test(d.color))throw new Error('Invalid drawing color.');
    }
  }
  const allowed=['ema','sma','bb','vwap','rsi','macd','atr','stoch','obv'];
  return {version:VERSION,symbol:raw.symbol,interval:raw.interval,style:['candles','hollow','bars','line','area','heikin'].includes(raw.style)?raw.style:'candles',
    scale:['linear','log','percent'].includes(raw.scale)?raw.scale:'linear',indicators:(raw.indicators||['ema','sma','rsi']).filter(x=>allowed.includes(x)),
    drawings:structuredClone(drawings),watchlist:(raw.watchlist||[]).filter(x=>typeof x==='string'&&/^[A-Z0-9.-]+-USD$/.test(x)).slice(0,50),
    split:Boolean(raw.split),theme:raw.theme==='light'?'light':'dark'};
}
