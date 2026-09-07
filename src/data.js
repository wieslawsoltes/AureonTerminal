import {normalizeCandles,resample} from './core.js';
export const PRODUCTS=[
 {id:'BTC-USD',name:'Bitcoin',short:'BTC',color:'#f7931a'},
 {id:'ETH-USD',name:'Ethereum',short:'ETH',color:'#7685df'},
 {id:'SOL-USD',name:'Solana',short:'SOL',color:'#9b70ef'},
 {id:'XRP-USD',name:'XRP',short:'XRP',color:'#8d9aaf'},
 {id:'DOGE-USD',name:'Dogecoin',short:'DOGE',color:'#c6a456'},
 {id:'ADA-USD',name:'Cardano',short:'ADA',color:'#3f88da'},
 {id:'AVAX-USD',name:'Avalanche',short:'AVAX',color:'#e75a67'},
 {id:'LINK-USD',name:'Chainlink',short:'LINK',color:'#527dec'}
];
export const TIMEFRAMES=[{value:60,label:'1m'},{value:300,label:'5m'},{value:900,label:'15m'},{value:3600,label:'1h'},{value:14400,label:'4h'},{value:21600,label:'6h'},{value:86400,label:'1D'},{value:604800,label:'1W'}];
const REST='https://api.exchange.coinbase.com';
const WS='wss://ws-feed.exchange.coinbase.com';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
export function fromCoinbase(rows){if(!Array.isArray(rows))throw new Error('Unexpected candle response.');return normalizeCandles(rows.map(r=>({t:Number(r[0]),l:Number(r[1]),h:Number(r[2]),o:Number(r[3]),c:Number(r[4]),v:Number(r[5])})));}
export class MarketData extends EventTarget {
  constructor(){super();this.symbols=[];this.active='BTC-USD';this.attempt=0;this.socket=null;this.closed=false;this.lastMessage=0;this.lastSequence=new Map();this.quotes=new Map();this.trades=[];this.products=PRODUCTS;this.restMode='direct';this.restTail=Promise.resolve();this.nextRest=0;this.connected=false;}
  emit(type,detail){this.dispatchEvent(new CustomEvent(type,{detail}));}
  async json(path,signal){
    if(!/^\/products(?:\/[A-Z0-9.-]+(?:\/(candles|stats|ticker|book))?)?(\?|$)/.test(path))throw new Error('Invalid market data path.');
    // Serialize REST requests to keep the public API comfortably below its burst limit.
    const turn=this.restTail;let release;this.restTail=new Promise(r=>release=r);await turn;
    try{
      const wait=Math.max(0,this.nextRest-Date.now());if(wait)await delay(wait);this.nextRest=Date.now()+180;
      let last;
      for(let retry=0;retry<3;retry++){
        const controller=new AbortController(),abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)controller.abort();
        const timeout=setTimeout(()=>controller.abort(),8000);
        try{
          const url=this.restMode==='proxy'?`./api${path}`:REST+path;
          const r=await fetch(url,{signal:controller.signal,headers:{Accept:'application/json'}});
          if(r.status===429){const raw=Number(r.headers.get('Retry-After'));await delay(Number.isFinite(raw)&&raw>0?Math.min(raw*1000,10000):500*(2**retry));continue;}
          if(!r.ok)throw new Error(`Coinbase HTTP ${r.status}`);
          const data=await r.json();return data;
        }catch(e){last=e;if(signal?.aborted)throw e;
          if(retry===0&&this.restMode==='direct'&&['localhost','127.0.0.1'].includes(location.hostname)){this.restMode='proxy';continue;}
          if(e.name==='AbortError'||retry===2)break;await delay(300*(retry+1));
        }finally{clearTimeout(timeout);signal?.removeEventListener('abort',abort);}
      }
      throw new Error(last?.name==='AbortError'?'Market data request timed out.':last?.message||'Market data request failed.');
    }finally{release();}
  }
  async history(symbol,interval,{end,pages=2,signal}={}){
    const base=interval===14400?3600:interval===604800?86400:interval;
    let all=[],cursor=end;
    for(let p=0;p<pages;p++){
      let q=`granularity=${base}`;
      if(cursor!=null){const until=Math.floor(cursor),start=until-base*299;q+=`&start=${new Date(start*1000).toISOString()}&end=${new Date(until*1000).toISOString()}`;}
      const rows=fromCoinbase(await this.json(`/products/${encodeURIComponent(symbol)}/candles?${q}`,signal));
      if(!rows.length)break;all=[...rows,...all];cursor=rows[0].t-1;
    }
    let bars=normalizeCandles(all);if(interval!==base)bars=resample(bars,interval);
    if(end!=null)bars=bars.filter(b=>b.t<=end);
    const latest=bars.at(-1);if(latest&&latest.t+interval>Date.now()/1000)latest.partial=true;
    return {bars,cutoff:Date.now()/1000,source:'Coinbase Exchange',interval};
  }
  async book(symbol){const b=await this.json(`/products/${symbol}/book?level=2`);return{symbol,received:Date.now(),sequence:b.sequence,bids:(b.bids||[]).slice(0,12).map(r=>({price:+r[0],size:+r[1]})),asks:(b.asks||[]).slice(0,12).map(r=>({price:+r[0],size:+r[1]}))};}
  async stats(symbol){const s=await this.json(`/products/${symbol}/stats`);return{open:+s.open,high:+s.high,low:+s.low,volume:+s.volume,last:+s.last};}
  async listProducts(){const products=await this.json('/products');return products.filter(p=>p.quote_currency==='USD'&&p.status==='online').map(p=>({id:p.id,name:p.display_name||p.id,short:p.base_currency,color:'#8b95ad'}));}
  connect(symbols){this.symbols=[...new Set(symbols)].slice(0,50);this.closed=false;this.open();}
  open(){
    clearTimeout(this.timer);if(this.closed)return;
    if(this.socket){this.socket.onclose=null;this.socket.close();}
    this.emit('status',{state:'connecting',text:'Connecting live feed'});
    const ws=this.socket=new WebSocket(WS);this.lastMessage=Date.now();this.lastSequence.clear();
    ws.onopen=()=>{if(ws!==this.socket)return;this.attempt=0;this.connected=true;ws.send(JSON.stringify({type:'subscribe',product_ids:this.symbols,channels:['ticker','heartbeat']}));this.emit('status',{state:'live',text:'Live trade feed'});};
    ws.onmessage=event=>{
      if(ws!==this.socket)return;this.lastMessage=Date.now();let m;try{m=JSON.parse(event.data);}catch{return;}
      if(m.type==='error'){this.emit('status',{state:'error',text:m.message||'Feed error'});return;}
      if(m.type!=='ticker')return;
      const time=Date.parse(m.time)/1000,price=+m.price;
      if(!Number.isFinite(time)||!(price>0))return;
      const old=this.quotes.get(m.product_id);if(old&&time<old.time)return;
      const q={symbol:m.product_id,price,time,received:Date.now(),bid:+m.best_bid,ask:+m.best_ask,open:+m.open_24h,high:+m.high_24h,low:+m.low_24h,volume:+m.volume_24h,size:+m.last_size,side:m.side,tradeId:m.trade_id};
      if(q.open>0)q.change=(price/q.open-1)*100;
      this.quotes.set(q.symbol,q);this.emit('quote',q);
      // Do not derive loss from ticker sequence gaps: the sequence includes non-ticker exchange messages.
      if(old?.tradeId!==q.tradeId&&Number.isFinite(q.size)&&q.tradeId!=null){
        const tick={symbol:q.symbol,time,price,size:q.size,id:q.tradeId,side:q.side};
        if(q.symbol===this.active){this.trades.unshift(tick);this.trades=this.trades.slice(0,80);}this.emit('trade',tick);
      }
    };
    ws.onerror=()=>this.emit('status',{state:'error',text:'Live feed unavailable'});
    ws.onclose=()=>{if(ws!==this.socket||this.closed)return;this.connected=false;const ms=Math.min(30000,1000*2**this.attempt++)+Math.random()*500;this.emit('status',{state:'reconnecting',text:'Feed interrupted · reconnecting'});this.timer=setTimeout(()=>{this.open();this.emit('reconnect',{});},ms);};
    clearInterval(this.health);this.health=setInterval(()=>{if(Date.now()-this.lastMessage>25000){this.emit('status',{state:'stale',text:'Stale feed · reconnecting'});ws.close();}},5000);
  }
  setSymbols(symbols){const unique=[...new Set(symbols)].slice(0,50);if(JSON.stringify(unique)===JSON.stringify(this.symbols))return;this.symbols=unique;this.open();}
  dispose(){this.closed=true;this.connected=false;clearTimeout(this.timer);clearInterval(this.health);this.socket?.close();}
}
export class CandleCache {
  constructor(){this.db=null;this.ready=new Promise(resolve=>{try{const r=indexedDB.open('aureon-market-cache',1);r.onupgradeneeded=()=>r.result.createObjectStore('candles');r.onsuccess=()=>{this.db=r.result;resolve();};r.onerror=()=>resolve();}catch{resolve();}});}
  async get(key){await this.ready;if(!this.db)return null;return new Promise(resolve=>{const r=this.db.transaction('candles').objectStore('candles').get(key);r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>resolve(null);});}
  async put(key,value){await this.ready;if(!this.db)return;return new Promise(resolve=>{try{const tx=this.db.transaction('candles','readwrite');tx.objectStore('candles').put({...value,cachedAt:Date.now()},key);tx.oncomplete=()=>resolve();tx.onerror=()=>resolve();tx.onabort=()=>resolve();}catch{resolve();}});}
}
