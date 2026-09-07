/** Deterministic simulated execution. Never sends a real-money order.
 * Currency = quote currency, quantity = base units. Accounting is float64.
 */
import {uid,validateCandle} from './core.js';
const finite=(x,name)=>{if(!Number.isFinite(x))throw new Error(`${name} must be finite.`);return x;};
const positive=(x,name)=>{finite(x,name);if(x<=0)throw new Error(`${name} must be positive.`);return x;};
const ACTIVE=new Set(['open','triggered','partial']);
export class SimulationBroker {
  constructor({initial=100000,feeBps=10,slippageBps=0,maxLeverage=1,maintenance=.2}={}){
    positive(initial,'Initial capital');finite(feeBps,'Fees');finite(slippageBps,'Slippage');finite(maxLeverage,'Leverage');finite(maintenance,'Maintenance margin');
    if(feeBps<0||feeBps>1000||slippageBps<0||slippageBps>1000||maxLeverage<1||maxLeverage>10||maintenance<0||maintenance>=1/maxLeverage)throw new Error('Invalid execution assumptions.');
    Object.assign(this,{initial,cash:initial,feeBps,slippageBps,maxLeverage,maintenance,orders:[],fills:[],positions:{},marks:{},sequence:0,realized:0,totalFees:0,lastTime:0});
  }
  equity(){return this.cash+Object.entries(this.positions).reduce((s,[symbol,p])=>s+p.quantity*(this.marks[symbol]??p.average),0);}
  exposure(){return Object.entries(this.positions).reduce((s,[symbol,p])=>s+Math.abs(p.quantity)*(this.marks[symbol]??p.average),0);}
  submit(request,at=this.lastTime){
    if(this.orders.length>=100000)throw new Error('Order capacity exceeded. Export/reset account.');
    const {symbol,side,type='market',quantity,limit,stop,trail,bracket,timeInForce='GTC',reduceOnly=false,group=null,expires=null}=request;
    if(typeof symbol!=='string'||!/^[A-Z0-9._/-]{1,40}$/.test(symbol))throw new Error('Invalid order symbol.');
    if(!['buy','sell'].includes(side)||!['market','limit','stop','stop-limit','trailing'].includes(type)||!['GTC','IOC'].includes(timeInForce))throw new Error('Unsupported order instruction.');
    if(request.id!=null&&(typeof request.id!=='string'||!request.id.length||request.id.length>128))throw new Error('Invalid order ID.');if(group!=null&&(typeof group!=='string'||group.length>128))throw new Error('Invalid OCO group.');positive(quantity,'Quantity');finite(at,'Order time');if(['limit','stop-limit'].includes(type))positive(limit,'Limit');if(['stop','stop-limit'].includes(type))positive(stop,'Stop');if(type==='trailing')positive(trail,'Trailing distance');
    if(expires!=null&&(!Number.isFinite(expires)||expires<=at))throw new Error('Expiration must be after submission.');
    if(bracket){if(bracket.takeProfit!=null)positive(bracket.takeProfit,'Take profit');if(bracket.stopLoss!=null)positive(bracket.stopLoss,'Stop loss');}
    const order={id:request.id||uid(),symbol,side,type,quantity,filled:0,average:0,limit,stop,trail,bracket:bracket?{...bracket}:null,timeInForce,reduceOnly:!!reduceOnly,group,expires,created:at,status:'open',sequence:++this.sequence};
    if(this.orders.some(o=>o.id===order.id))throw new Error('Duplicate client order ID.');this.orders.push(order);return order;
  }
  cancel(id){const o=this.orders.find(o=>o.id===id);if(o&&ACTIVE.has(o.status)){o.status='canceled';return true;}return false;}
  cancelAll(symbol){for(const o of this.orders)if(!symbol||o.symbol===symbol)this.cancel(o.id);}
  amend(id,patch){const o=this.orders.find(o=>o.id===id);if(!o||!ACTIVE.has(o.status))throw new Error('Order cannot be amended.');for(const key of Object.keys(patch))if(!['quantity','limit','stop','trail'].includes(key))throw new Error('Cannot amend '+key);for(const[k,v]of Object.entries(patch))positive(v,k);if(patch.quantity!=null&&patch.quantity<=o.filled)throw new Error('Quantity must exceed already filled quantity.');Object.assign(o,patch);return o;}
  tick({symbol,time,price,bid=price,ask=price,liquidity=Infinity},{liquidate=true}={}){
    if(typeof symbol!=='string'||!/^[A-Z0-9._/-]{1,40}$/.test(symbol))throw new Error('Invalid quote symbol.');positive(price,'Trade price');positive(bid,'Bid');positive(ask,'Ask');finite(time,'Quote time');if(bid>ask)throw new Error('Crossed quote.');if(liquidity<0||Number.isNaN(liquidity))throw new Error('Invalid liquidity.');
    // Out-of-order ticks must never rewrite the portfolio mark or retrigger stops.
    if(time<(this.markTimes?.[symbol]??-Infinity))return[];this.markTimes??={};this.markTimes[symbol]=time;this.marks[symbol]=price;this.lastTime=Math.max(this.lastTime,time);
    let available=liquidity;const result=[];
    for(const o of [...this.orders]){
      if(o.symbol!==symbol||!ACTIVE.has(o.status)||time<o.created)continue;
      if(o.expires!=null&&time>=o.expires){o.status='expired';continue;}
      const buy=o.side==='buy',quote=buy?ask:bid;
      if(o.type==='trailing'){
        o.extreme=o.extreme==null?quote:buy?Math.min(o.extreme,quote):Math.max(o.extreme,quote);
        o.stop=buy?o.extreme+o.trail:o.extreme-o.trail;
      }
      if(['stop','stop-limit','trailing'].includes(o.type)&&!o.activated){if(buy?quote>=o.stop:quote<=o.stop){o.activated=true;o.triggeredAt=time;o.status='triggered';}}
      let eligible=o.type==='market'||o.type==='limit'||o.activated;
      if(o.type==='limit'||o.type==='stop-limit')eligible=eligible&&(buy?quote<=o.limit:quote>=o.limit);
      if(!eligible){if(o.timeInForce==='IOC')o.status='canceled';continue;}
      let qty=Math.min(o.quantity-o.filled,available);const p=this.positions[symbol]||{quantity:0,average:0,entryFees:0,entryTime:time,realized:0};
      if(o.reduceOnly){if(p.quantity===0||Math.sign(p.quantity)===(buy?1:-1)){o.status='canceled';continue;}qty=Math.min(qty,Math.abs(p.quantity));}
      if(qty<=1e-12){if(o.timeInForce==='IOC')o.status='canceled';continue;}
      let fillPrice=quote*(1+(buy?1:-1)*this.slippageBps/10000);
      if(o.type==='limit'||o.type==='stop-limit')fillPrice=buy?Math.min(fillPrice,o.limit):Math.max(fillPrice,o.limit);
      const signed=(buy?1:-1)*qty,fee=qty*fillPrice*this.feeBps/10000,newQty=p.quantity+signed;
      const oldExposure=this.exposure(),newExposure=oldExposure-Math.abs(p.quantity)*price+Math.abs(newQty)*price;
      const postEquity=this.equity()-signed*(fillPrice-price)-fee;
      const reducing=Math.abs(newQty)<Math.abs(p.quantity)&&Math.sign(newQty||p.quantity)===Math.sign(p.quantity);
      if(!o.reduceOnly&&!reducing&&(postEquity<=0||newExposure>Math.max(0,postEquity)*this.maxLeverage+1e-7)){o.status='rejected';o.reason='Insufficient simulated buying power at fill.';continue;}
      const closeQty=p.quantity&&Math.sign(p.quantity)!==Math.sign(signed)?Math.min(Math.abs(p.quantity),qty):0;
      const entryFeesClosed=p.quantity?p.entryFees*closeQty/Math.abs(p.quantity):0;
      const gross=(fillPrice-p.average)*closeQty*Math.sign(p.quantity),exitFee=fee*closeQty/qty,net=gross-entryFeesClosed-exitFee;
      const fill={id:uid(),orderId:o.id,symbol,side:o.side,time,price:fillPrice,quantity:qty,fee,closedQuantity:closeQty,realized:net,entryPrice:closeQty?p.average:null,entryTime:closeQty?p.entryTime:null,entrySide:p.quantity>0?'long':'short'};
      p.entryFees-=entryFeesClosed;
      if(p.quantity===0||Math.sign(p.quantity)===Math.sign(signed)){p.average=(Math.abs(p.quantity)*p.average+qty*fillPrice)/(Math.abs(p.quantity)+qty);if(p.quantity===0)p.entryTime=time;p.entryFees+=fee;}
      else if(qty>Math.abs(p.quantity)+1e-12){p.average=fillPrice;p.entryTime=time;p.entryFees=fee-exitFee;}
      else if(Math.abs(newQty)<1e-12){p.average=0;p.entryFees=0;}
      p.quantity=Math.abs(newQty)<1e-12?0:newQty;p.realized+=net;this.positions[symbol]=p;this.cash-=signed*fillPrice+fee;this.realized+=net;this.totalFees+=fee;
      o.average=(o.average*o.filled+fillPrice*qty)/(o.filled+qty);o.filled+=qty;o.status=o.filled>=o.quantity-1e-12?'filled':'partial';o.updated=time;this.fills.push(fill);result.push(fill);available-=qty;
      // Reduce the sibling by exactly the amount executed; partial OCO exits remain protected.
      if(o.group)for(const sibling of this.orders)if(sibling.id!==o.id&&sibling.group===o.group&&ACTIVE.has(sibling.status)){sibling.quantity=Math.max(sibling.filled,sibling.quantity-qty);if(sibling.quantity<=sibling.filled+1e-12)sibling.status='canceled';}
      const opened=qty-closeQty;
      if(o.bracket&&opened>0){const group=uid(),side=buy?'sell':'buy';if(o.bracket.takeProfit!=null)this.submit({symbol,side,type:'limit',quantity:opened,limit:o.bracket.takeProfit,reduceOnly:true,group},time);if(o.bracket.stopLoss!=null)this.submit({symbol,side,type:'stop',quantity:opened,stop:o.bracket.stopLoss,reduceOnly:true,group},time);}
      if(o.timeInForce==='IOC'&&ACTIVE.has(o.status))o.status='canceled';
    }
    if(liquidate&&this.exposure()>0&&this.equity()<this.exposure()*this.maintenance){this.cancelAll();for(const[s,p]of Object.entries(this.positions)){if(s!==symbol||!p.quantity)continue;const o=this.submit({symbol:s,side:p.quantity>0?'sell':'buy',quantity:Math.abs(p.quantity),reduceOnly:true},time);o.reason='Simulated maintenance-margin liquidation';result.push(...this.tick({symbol,time,price,bid,ask},{liquidate:false}));}}
    return result;
  }
  snapshot(){return{version:1,initial:this.initial,cash:this.cash,feeBps:this.feeBps,slippageBps:this.slippageBps,maxLeverage:this.maxLeverage,maintenance:this.maintenance,orders:this.orders,fills:this.fills,positions:this.positions,marks:this.marks,markTimes:this.markTimes||{},sequence:this.sequence,realized:this.realized,totalFees:this.totalFees,lastTime:this.lastTime};}
  static restore(raw){
    if(!raw||raw.version!==1)throw new Error('Unsupported simulation account');
    const b=new SimulationBroker({initial:raw.initial,feeBps:raw.feeBps,slippageBps:raw.slippageBps,maxLeverage:raw.maxLeverage,maintenance:raw.maintenance});
    if(!Array.isArray(raw.orders)||raw.orders.length>100000||!Array.isArray(raw.fills)||raw.fills.length>200000)throw new Error('Invalid ledger');
    const symbols=/^[A-Z0-9._/-]{1,40}$/, ids=new Set(), statuses=new Set(['open','partial','triggered','filled','canceled','rejected','expired']);
    for(const order of raw.orders){
      if(typeof order.id!=='string'||order.id.length>128||ids.has(order.id)||!symbols.test(order.symbol||'')||!statuses.has(order.status))throw new Error('Invalid saved order');
      ids.add(order.id);const checked=b.submit(order,order.created);
      for(const key of ['filled','average','sequence'])finite(order[key],key);
      if(order.filled<0||order.filled>order.quantity+1e-9||order.average<0||!Number.isInteger(order.sequence))throw new Error('Invalid saved fill quantity');
      for(const key of ['updated','extreme','triggeredAt'])if(order[key]!=null)finite(order[key],key);
      Object.assign(checked,{filled:order.filled,average:order.average,status:order.status,sequence:order.sequence});for(const key of ['updated','extreme','triggeredAt'])if(order[key]!=null)checked[key]=order[key];if(order.activated!=null){if(typeof order.activated!=='boolean')throw new Error('Invalid activation state');checked.activated=order.activated;}if(order.reason!=null)checked.reason=String(order.reason).slice(0,1000);
    }
    b.fills=raw.fills.map(f=>{if(!symbols.test(f.symbol||'')||!['buy','sell'].includes(f.side)||typeof f.orderId!=='string'||!ids.has(f.orderId))throw new Error('Invalid saved fill');for(const key of ['time','price','quantity','fee','closedQuantity','realized'])finite(f[key],key);if(f.price<=0||f.quantity<=0||f.fee<0||f.closedQuantity<0||f.closedQuantity>f.quantity)throw new Error('Invalid saved fill amounts');if(f.closedQuantity>0&&(!Number.isFinite(f.entryPrice)||f.entryPrice<=0||!Number.isFinite(f.entryTime)||!['long','short'].includes(f.entrySide)))throw new Error('Invalid closed fill metadata');return{id:String(f.id),orderId:f.orderId,symbol:f.symbol,side:f.side,time:f.time,price:f.price,quantity:f.quantity,fee:f.fee,closedQuantity:f.closedQuantity,realized:f.realized,entryPrice:f.entryPrice,entryTime:f.entryTime,entrySide:f.entrySide};});
    for(const[k,v]of Object.entries(raw.positions||{})){if(!symbols.test(k)||!['quantity','average','entryFees','realized','entryTime'].every(f=>Number.isFinite(v[f]))||v.average<0||v.entryFees<0)throw new Error('Invalid position');b.positions[k]={quantity:v.quantity,average:v.average,entryFees:v.entryFees,realized:v.realized,entryTime:v.entryTime};}
    b.markTimes={};for(const[k,v]of Object.entries(raw.marks||{})){if(!symbols.test(k)||!Number.isFinite(v)||v<=0)throw new Error('Invalid mark');b.marks[k]=v;}for(const[k,v]of Object.entries(raw.markTimes||{})){if(!symbols.test(k)||!Number.isFinite(v))throw new Error('Invalid mark time');b.markTimes[k]=v;}
    for(const key of ['cash','realized','totalFees','lastTime','sequence'])b[key]=finite(raw[key],key);
    if(b.totalFees<0||!Number.isInteger(b.sequence)||b.sequence<raw.orders.length)throw new Error('Invalid ledger counters');return b;
  }
}
export function strategyStatistics(equity,trades,initial,fees=0){
  let peak=initial,maxDrawdown=0,drawdownDuration=0,currentDuration=0,grossProfit=0,grossLoss=0;const drawdown=[],returns=[];
  for(let i=0;i<equity.length;i++){const x=equity[i];if(x.value>=peak){peak=x.value;currentDuration=0;}else currentDuration++;drawdownDuration=Math.max(drawdownDuration,currentDuration);const d=peak?(peak-x.value)/peak:0;maxDrawdown=Math.max(maxDrawdown,d);drawdown.push({t:x.t,value:-d*100});if(i&&equity[i-1].value>0)returns.push(x.value/equity[i-1].value-1);}
  for(const t of trades)if(t.pnl>0)grossProfit+=t.pnl;else grossLoss-=t.pnl;
  const mean=returns.length?returns.reduce((s,x)=>s+x,0)/returns.length:0,variance=returns.length>1?returns.reduce((s,x)=>s+(x-mean)**2,0)/(returns.length-1):0;
  const elapsed=equity.length>1?equity.at(-1).t-equity[0].t:0,periods=elapsed>0?(equity.length-1)*31557600/elapsed:0,final=equity.at(-1)?.value??initial;
  return{initial,final,net:final-initial,returnPct:(final/initial-1)*100,maxDrawdownPct:maxDrawdown*100,drawdownDuration,profitFactor:grossLoss?grossProfit/grossLoss:grossProfit?Infinity:NaN,grossProfit,grossLoss,winRate:trades.length?100*trades.filter(x=>x.pnl>0).length/trades.length:0,tradeCount:trades.length,expectancy:trades.length?trades.reduce((s,t)=>s+t.pnl,0)/trades.length:0,sharpe:variance>0?mean/Math.sqrt(variance)*Math.sqrt(periods):NaN,cagr:elapsed>0&&final>0?(Math.pow(final/initial,31557600/elapsed)-1)*100:NaN,fees,drawdown};
}
/** Signals at close i -> orders at open i+1. Conservative intrabar convention:
 * open -> adverse extreme -> favorable extreme -> close (relative to position).
 * Raw OHLCV only. Stops/takes are assumptions, not actual historical executions.
 */
export function runBacktest(bars,{commands=[],initial=100000,feeBps=10,slippageBps=5,allocation=.95,maxLeverage=1,stopPct=0,takePct=0,allowShort=true,start=0,end=bars.length,liquidateEnd=false}={}){
  if(!bars.length)throw new Error('Backtest needs market bars.');for(const b of bars){validateCandle(b);if(b.synthetic)throw new Error('Synthetic bars cannot be used for execution.');}
  if(!Number.isFinite(allocation)||allocation<=0||allocation>1||!Number.isFinite(stopPct)||stopPct<0||stopPct>=100||!Number.isFinite(takePct)||takePct<0||takePct>10000)throw new Error('Invalid risk settings.');
  if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end>bars.length||end<=start)throw new Error('Invalid date/index window.');
  const broker=new SimulationBroker({initial,feeBps,slippageBps,maxLeverage,maintenance:Math.min(.2,.5/maxLeverage)}),symbol='BACKTEST',byIndex=new Map(),equity=[],markers=[];
  for(const c of commands){if(!Number.isInteger(c.index)||c.index<0||c.index>=bars.length)throw new Error('Invalid signal index');if(!byIndex.has(c.index))byIndex.set(c.index,[]);byIndex.get(c.index).push(c);}
  for(let i=start;i<end;i++){
    const b=bars[i];if(b.partial)break;const tick=(price,part)=>broker.tick({symbol,time:b.t+part,price});
    tick(b.o,0); // Process existing gap-through protective orders before new entries.
    // A holdout window starts flat: do not use a signal formed before its boundary.
    if(i>start)for(const c of byIndex.get(i-1)||[]){
      const p=broker.positions[symbol]?.quantity||0;
      if(c.action==='close'||(c.action==='entry'&&p&&Math.sign(p)!==c.direction)){
        broker.cancelAll(symbol);if(p){broker.submit({symbol,side:p>0?'sell':'buy',quantity:Math.abs(p),reduceOnly:true},b.t);tick(b.o,0);}
      }
      if(c.action==='entry'&&(c.direction>0||allowShort)&&!broker.positions[symbol]?.quantity){
        const dir=c.direction;if(![1,-1].includes(dir))throw new Error('Invalid signal direction');const equityNow=broker.equity(),cost=b.o*(1+slippageBps/10000)*(1+feeBps/10000);
        const quantity=c.quantity??equityNow*allocation*maxLeverage/cost;if(!(quantity>0&&Number.isFinite(quantity)))continue;
        const bracket={};if(stopPct)bracket.stopLoss=b.o*(1-dir*stopPct/100);if(takePct)bracket.takeProfit=b.o*(1+dir*takePct/100);
        if(Object.values(bracket).some(x=>x<=0))throw new Error('Risk target cannot be nonpositive');broker.submit({symbol,side:dir>0?'buy':'sell',quantity,bracket:Object.keys(bracket).length?bracket:null},b.t);tick(b.o,0);
      }
    }
    const direction=Math.sign(broker.positions[symbol]?.quantity||1),nextTime=bars[i+1]?.t??b.t+1,dt=Math.max(.001,(nextTime-b.t)/4);
    tick(direction>0?b.l:b.h,dt);tick(direction>0?b.h:b.l,2*dt);tick(b.c,3*dt);equity.push({t:b.t,value:broker.equity()});
  }
  if(liquidateEnd&&equity.length){const lastIndex=start+equity.length-1,b=bars[lastIndex],p=broker.positions[symbol]?.quantity||0;broker.cancelAll();if(p){broker.submit({symbol,side:p>0?'sell':'buy',quantity:Math.abs(p),reduceOnly:true},broker.lastTime);broker.tick({symbol,time:broker.lastTime,price:b.c});equity.at(-1).value=broker.equity();}}
  const trades=broker.fills.filter(f=>f.closedQuantity>0).map(f=>({t:f.entryTime,exitTime:f.time,price:f.entryPrice,exitPrice:f.price,quantity:f.closedQuantity,pnl:f.realized,side:f.entrySide}));
  for(const f of broker.fills)markers.push({t:f.time,p:f.price,side:f.side});
  return{...strategyStatistics(equity,trades,initial,broker.totalFees),trades,equity,markers,orders:broker.orders,openPosition:broker.positions[symbol],account:broker.snapshot(),assumptions:{signal:'Confirmed close; next-bar-open execution.',intrabar:'Open → adverse → favorable → close. Protective orders processed before new signals.',slippageBps,feeBps,allocation,maxLeverage,stopPct,takePct,liquidateEnd,syntheticBars:false,borrowCosts:'Not modeled',sharpe:'Zero risk-free rate; annualization from observed bar spacing; not a forecast.'}};
}
export function parameterSweep(bars,signalFactory,{fast=[5,10,15],slow=[20,30,50],holdout=.3,execution={}}={}){
  if(fast.length*slow.length>200||holdout<=0||holdout>=1)throw new Error('At most 200 runs and a holdout fraction between 0 and 1.');const split=Math.floor(bars.length*(1-holdout));if(split<30||bars.length-split<10)throw new Error('Not enough bars for train/holdout split.');
  const results=[];for(const f of fast)for(const s of slow){if(f>=s)continue;const commands=signalFactory(bars.slice(0,split),f,s);const training=runBacktest(bars.slice(0,split),{...execution,commands});results.push({fast:f,slow:s,training});}
  results.sort((a,b)=>b.training.net-a.training.net);const best=results[0];if(!best)throw new Error('No valid parameter pairs.');const commands=signalFactory(bars,best.fast,best.slow),holdoutResult=runBacktest(bars,{...execution,commands,start:split});
  return{split,results:results.map(x=>({fast:x.fast,slow:x.slow,net:x.training.net,returnPct:x.training.returnPct,drawdown:x.training.maxDrawdownPct,trades:x.training.tradeCount})),best:{fast:best.fast,slow:best.slow},holdout:holdoutResult,selection:'Ranked on training net profit only. One selected parameter pair evaluated on untouched holdout; warm-up uses earlier bars, but no pre-holdout signal enters.'};
}
