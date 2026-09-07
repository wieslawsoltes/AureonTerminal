/** Stateful L2 book and tape aggregation. No volume/delta is inferred from candle color. */
export class OrderBook {
  constructor(symbol){this.symbol=symbol;this.reset();}
  reset(){this.bids=new Map();this.asks=new Map();this.ready=false;this.received=0;this.revision=0;}
  apply(message,now=Date.now()){
    if(message.product_id!==this.symbol)return false;
    const level=(row)=>{const price=Number(row[0]),quantity=Number(row[1]);if(!Number.isFinite(price)||price<=0||!Number.isFinite(quantity)||quantity<0)throw new Error('Invalid book level.');return [price,quantity];};
    if(message.type==='snapshot'){
      if(!Array.isArray(message.bids)||!Array.isArray(message.asks)||message.bids.length+message.asks.length>500000)throw new Error('Invalid book snapshot.');
      const bids=new Map(),asks=new Map();for(const row of message.bids){const [p,s]=level(row);if(s)bids.set(p,s);}for(const row of message.asks){const [p,s]=level(row);if(s)asks.set(p,s);}
      this.bids=bids;this.asks=asks;this.ready=true;
    }else if(message.type==='l2update'){
      if(!this.ready)return false;
      if(!Array.isArray(message.changes)||message.changes.length>500000)throw new Error('Invalid L2 update.');
      // Validate the entire batch before mutating either side.
      const changes=message.changes.map(([side,p,q])=>{if(!['buy','sell'].includes(side))throw new Error('Invalid L2 side.');return[side,...level([p,q])];});
      for(const[side,p,q]of changes){const map=side==='buy'?this.bids:this.asks;if(q===0)map.delete(p);else map.set(p,q);}
    }else return false;
    if(this.bids.size+this.asks.size>500000){this.reset();throw new Error('Order book capacity exceeded.');}
    this.received=now;this.revision++;return true;
  }
  snapshot(depth=24){const side=(map,sign)=>{let cumulative=0;return [...map].sort((a,b)=>sign*(a[0]-b[0])).slice(0,depth).map(([price,size])=>({price,size,cumulative:cumulative+=size}));};const bids=side(this.bids,-1),asks=side(this.asks,1);return{symbol:this.symbol,ready:this.ready,bids,asks,spread:bids.length&&asks.length?asks[0].price-bids[0].price:NaN,received:this.received,revision:this.revision};}
}
export class Footprint {
  constructor(interval=60,tickSize=1,maxBars=500){if(!(Number.isInteger(interval)&&interval>0&&tickSize>0&&Number.isFinite(tickSize)&&Number.isInteger(maxBars)&&maxBars>0&&maxBars<=10000))throw new Error('Invalid footprint interval/tick.');this.interval=interval;this.tickSize=tickSize;this.maxBars=maxBars;this.bars=new Map();this.seen=new Set();this.queue=[];this.head=0;this.started=null;this.dropped=0;}
  push(trade){const {id,time,price,size,side}=trade;if(id==null||!Number.isFinite(time)||!Number.isFinite(price)||price<=0||!Number.isFinite(size)||size<0||!['buy','sell'].includes(side))return false;if(this.seen.has(id))return false;
    this.seen.add(id);this.queue.push(id);if(this.queue.length-this.head>100000){this.seen.delete(this.queue[this.head++]);if(this.head>20000){this.queue.splice(0,this.head);this.head=0;}}
    const t=Math.floor(time/this.interval)*this.interval;if(this.bars.size>=this.maxBars&&t<Math.min(...this.bars.keys())){this.dropped++;return false;}
    if(this.started===null)this.started=time;
    let b=this.bars.get(t);if(!b){b={t,levels:new Map(),buy:0,sell:0,trades:0};this.bars.set(t,b);}
    const bin=Math.round(price/this.tickSize);let row=b.levels.get(bin);if(!row){if(b.levels.size>=10000){this.dropped++;return false;}row={price:bin*this.tickSize,buy:0,sell:0};b.levels.set(bin,row);}
    row[side]+=size;b[side]+=size;b.trades++;
    if(this.bars.size>this.maxBars)this.bars.delete(Math.min(...this.bars.keys()));return true;
  }
  rows(){let cvd=0;return [...this.bars.values()].sort((a,b)=>a.t-b.t).map(b=>({...b,delta:b.buy-b.sell,cvd:cvd+=b.buy-b.sell,levels:[...b.levels.values()].sort((a,b)=>b.price-a.price)}));}
}
/** Coinbase matches use MAKER side; aggressor side must be inverted. */
export function matchToTrade(m){if(m.type!=='match'||!['buy','sell'].includes(m.side))return null;return{id:m.trade_id,time:Date.parse(m.time)/1000,price:Number(m.price),size:Number(m.size),side:m.side==='sell'?'buy':'sell',symbol:m.product_id};}
export class OrderFlowFeed extends EventTarget {
  constructor(){super();this.closed=true;this.generation=0;this.attempt=0;}
  emit(type,detail){this.dispatchEvent(new CustomEvent(type,{detail}));}
  connect(symbol,interval=60,tickSize=1){this.close();this.closed=false;this.symbol=symbol;this.interval=interval;this.tickSize=tickSize;this.book=new OrderBook(symbol);this.footprint=new Footprint(interval,tickSize);this.open();}
  open(){if(this.closed)return;const generation=++this.generation;this.book.reset();this.emit('status',{state:'connecting',text:'Connecting to public L2 batch + matches'});let socket;try{socket=this.socket=new WebSocket('wss://ws-feed.exchange.coinbase.com');}catch(e){this.emit('status',{state:'error',text:e.message});return;}
    this.lastMessage=Date.now();socket.onopen=()=>{if(generation!==this.generation)return;this.attempt=0;socket.send(JSON.stringify({type:'subscribe',product_ids:[this.symbol],channels:['level2_batch','matches','heartbeat']}));};
    socket.onmessage=({data})=>{if(generation!==this.generation)return;this.lastMessage=Date.now();try{const m=JSON.parse(data);if(m.type==='error')throw new Error(m.message);if(this.book.apply(m)){this.emit('book',this.book.snapshot(60));if(m.type==='snapshot')this.emit('status',{state:'live',text:'Streaming L2 snapshot + absolute-size updates'});}const trade=matchToTrade(m);if(trade&&this.footprint.push(trade)){this.emit('trade',trade);}}catch(e){this.emit('status',{state:'error',text:e.message});socket.close();}};
    socket.onerror=()=>this.emit('status',{state:'error',text:'Order-flow connection unavailable'});
    socket.onclose=()=>{clearInterval(this.health);if(this.closed||generation!==this.generation)return;this.book.reset();this.emit('status',{state:'stale',text:'Disconnected; L2 invalidated. Tape has a coverage gap.'});this.timer=setTimeout(()=>this.open(),Math.min(30000,1000*2**this.attempt++));};
    this.health=setInterval(()=>{if(Date.now()-this.lastMessage>25000)socket.close();},5000);
  }
  close(){this.closed=true;this.generation++;clearTimeout(this.timer);clearInterval(this.health);this.socket?.close();this.book?.reset();}
}
