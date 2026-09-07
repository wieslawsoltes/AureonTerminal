/** Explicitly parameterized research mathematics. No quotes, rates, calendars or
 * entitlements are invented. All rates/volatilities are annual decimal values.
 * Prices derived here are analyses, never executable broker quotes.
 */
const finite = (x, name) => { if (!Number.isFinite(x)) throw new RangeError(`${name} must be finite`); return x; };
const positive = (x, name) => { finite(x, name); if (x <= 0) throw new RangeError(`${name} must be positive`); return x; };
const normalPDF = x => Math.exp(-x*x/2)/Math.sqrt(2*Math.PI);
export function normalCDF(x) {
  if (x === Infinity) return 1; if (x === -Infinity) return 0; finite(x, 'normal variate');
  const a = Math.abs(x), t = 1/(1+0.2316419*a);
  const tail = normalPDF(a)*t*(0.319381530+t*(-0.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));
  return x >= 0 ? 1-tail : tail;
}
function optionInputs(p) {
  const {spot, strike, years, volatility, rate=0, dividend=0, right='call'} = p;
  positive(spot,'spot'); positive(strike,'strike'); finite(years,'years'); finite(volatility,'volatility');
  finite(rate,'rate'); finite(dividend,'dividend');
  if (years < 0 || years > 100 || volatility < 0 || volatility > 10 || !['call','put'].includes(right)) throw new RangeError('Invalid option domain');
  if (Math.abs(rate*years)>100 || Math.abs(dividend*years)>100) throw new RangeError('Discount exponent exceeds supported domain');
  return {spot,strike,years,volatility,rate,dividend,right};
}
export function blackScholes(input) {
  const {spot:S,strike:K,years:T,volatility:v,rate:r,dividend:q,right} = optionInputs(input);
  const sign=right==='call'?1:-1, dq=Math.exp(-q*T), dr=Math.exp(-r*T), forward=S*dq-K*dr;
  if (T===0 || v===0) {
    const itm=sign*forward>0, kink=forward===0;
    return {price:Math.max(0,sign*forward),delta:itm?sign*dq:kink?sign*dq/2:0,
      gamma:kink?NaN:0,vega:0,rho:itm?sign*K*T*dr:0,
      theta:itm?sign*(q*S*dq-r*K*dr):0,model:'European Black–Scholes–Merton',greekUnits:'theta/year; vega/1.0 volatility; rho/1.0 rate'};
  }
  const sqrt=Math.sqrt(T), d1=(Math.log(S/K)+(r-q+v*v/2)*T)/(v*sqrt), d2=d1-v*sqrt;
  const nd=normalPDF(d1), n1=normalCDF(sign*d1), n2=normalCDF(sign*d2);
  return {price:sign*(S*dq*n1-K*dr*n2),delta:sign*dq*n1,gamma:dq*nd/(S*v*sqrt),
    vega:S*dq*nd*sqrt,rho:sign*K*T*dr*n2,
    theta:-S*dq*nd*v/(2*sqrt)-sign*r*K*dr*n2+sign*q*S*dq*n1,
    d1,d2,model:'European Black–Scholes–Merton',greekUnits:'theta/year; vega/1.0 volatility; rho/1.0 rate'};
}
export function impliedVolatility(input, price, {tolerance=1e-8, maxIterations=160}={}) {
  finite(price,'option price'); positive(tolerance,'tolerance');
  if(!Number.isInteger(maxIterations)||maxIterations<1||maxIterations>1000)throw new RangeError('Invalid iteration budget');
  const p=optionInputs({...input,volatility:0}); if(p.years===0)throw new RangeError('Expiry has no identifiable implied volatility');
  const floor=blackScholes(p).price, upper=p.right==='call'?p.spot*Math.exp(-p.dividend*p.years):p.strike*Math.exp(-p.rate*p.years);
  if(price<floor-tolerance||price>=upper)throw new RangeError('Option price violates finite-volatility European bounds');
  if(Math.abs(price-floor)<=tolerance)return {volatility:0,iterations:0,residual:floor-price,converged:true};
  let lo=0,hi=1; while(hi<10&&blackScholes({...p,volatility:hi}).price<price)hi=Math.min(10,hi*2);
  if(blackScholes({...p,volatility:hi}).price<price)throw new RangeError('Implied volatility exceeds supported bracket');
  let mid,residual;
  for(let i=1;i<=maxIterations;i++){mid=(lo+hi)/2;residual=blackScholes({...p,volatility:mid}).price-price;
    if(Math.abs(residual)<=tolerance)return {volatility:mid,iterations:i,residual,converged:true};
    if(residual>0)hi=mid;else lo=mid;
  }
  return {volatility:mid,iterations:maxIterations,residual,converged:false};
}
export function americanOption(input, steps=300) {
  const p=optionInputs(input),{spot:S,strike:K,years:T,volatility:v,rate:r,dividend:q,right}=p,sign=right==='call'?1:-1;
  if(!Number.isInteger(steps)||steps<2||steps>2000)throw new RangeError('Tree steps must be 2..2000');
  if(T===0)return {price:Math.max(0,sign*(S-K)),steps:0,model:'American CRR binomial'};
  const dt=T/steps;
  if(v===0){let price=0;for(let j=0;j<=steps;j++)price=Math.max(price,Math.exp(-r*j*dt)*Math.max(0,sign*(S*Math.exp((r-q)*j*dt)-K)));return {price,steps,model:'American deterministic exercise grid'};}
  const u=Math.exp(v*Math.sqrt(dt)),d=1/u,prob=(Math.exp((r-q)*dt)-d)/(u-d),disc=Math.exp(-r*dt);
  if(prob<0||prob>1)throw new RangeError('CRR probability outside [0,1]; increase steps or revise inputs');
  const values=new Float64Array(steps+1);
  for(let j=0;j<=steps;j++)values[j]=Math.max(0,sign*(S*Math.exp((2*j-steps)*Math.log(u))-K));
  for(let n=steps-1;n>=0;n--)for(let j=0;j<=n;j++)values[j]=Math.max(disc*(prob*values[j+1]+(1-prob)*values[j]),sign*(S*Math.exp((2*j-n)*Math.log(u))-K),0);
  return {price:values[0],steps,model:'American CRR binomial; no discrete cash dividends'};
}
export function parseOptionSymbol(symbol) {
  const m=String(symbol).match(/^([A-Z0-9.]{1,6})\s*(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/);
  if(!m)throw new RangeError('Expected OCC compact option symbol');
  const year=2000+Number(m[2]),month=Number(m[3]),day=Number(m[4]),date=new Date(Date.UTC(year,month-1,day));
  if(date.getUTCMonth()!==month-1||date.getUTCDate()!==day)throw new RangeError('Invalid option expiry date');
  return {symbol,underlying:m[1],expiry:date.toISOString().slice(0,10),right:m[5]==='C'?'call':'put',strike:Number(m[6])/1000};
}
export function optionPortfolio(legs, spots) {
  if(!Array.isArray(legs)||legs.length>100||!Array.isArray(spots)||spots.length>10000)throw new RangeError('Portfolio limits exceeded');
  const parsed=legs.map(l=>{if(!['call','put','stock'].includes(l.right))throw new RangeError('Unsupported option leg');finite(l.quantity,'quantity');positive(l.multiplier??(l.right==='stock'?1:100),'multiplier');finite(l.premium,'premium');if(l.right!=='stock')positive(l.strike,'strike');return l;});
  return spots.map(spot=>{positive(spot,'scenario spot');let pnl=0;for(const l of parsed){const intrinsic=l.right==='stock'?spot:Math.max(0,(l.right==='call'?1:-1)*(spot-l.strike));pnl+=(intrinsic-l.premium)*l.quantity*(l.multiplier??(l.right==='stock'?1:100));}return {spot,pnl};});
}
function cashflows(flows) {
  if(!Array.isArray(flows)||!flows.length||flows.length>10000)throw new RangeError('Provide 1..10000 explicit future cash flows');
  return flows.map(f=>({time:positive(f.time,'cash-flow year fraction'),amount:positive(f.amount,'cash-flow amount')})).sort((a,b)=>a.time-b.time);
}
export function bondAnalytics(flows,yieldRate,{frequency=2}={}) {
  finite(yieldRate,'yield');if(!Number.isInteger(frequency)||frequency<1||frequency>365||yieldRate<=-frequency)throw new RangeError('Invalid compounding domain');
  const f=cashflows(flows),base=1+yieldRate/frequency;let price=0,d1=0,d2=0,weighted=0;
  for(const x of f){const pv=x.amount*Math.pow(base,-frequency*x.time);price+=pv;weighted+=x.time*pv;d1-=x.time*pv/base;d2+=x.time*(x.time+1/frequency)*pv/(base*base);}
  if(!Number.isFinite(price)||price<=0)throw new RangeError('Bond discount overflow');
  return {dirtyPrice:price,macaulayDuration:weighted/price,modifiedDuration:-d1/price,convexity:d2/price,dv01:-d1*1e-4,yield:yieldRate,frequency};
}
export function bondYield(flows,dirtyPrice,{frequency=2,tolerance=1e-9}={}) {
  positive(dirtyPrice,'dirty price');positive(tolerance,'tolerance');const f=cashflows(flows);
  let lo=-Math.min(.1,frequency*.5),hi=.2;
  while(bondAnalytics(f,lo,{frequency}).dirtyPrice<dirtyPrice)lo=(lo-frequency)/2;
  while(bondAnalytics(f,hi,{frequency}).dirtyPrice>dirtyPrice){hi=hi*2+.1;if(hi>1000)throw new RangeError('Yield exceeds bracket');}
  for(let i=0;i<200;i++){const y=(lo+hi)/2,p=bondAnalytics(f,y,{frequency}).dirtyPrice;if(Math.abs(p-dirtyPrice)<tolerance)return {...bondAnalytics(f,y,{frequency}),iterations:i+1};if(p>dirtyPrice)lo=y;else hi=y;}
  throw new RangeError('Yield solver did not converge');
}
export function discountFactor(curve,time) {
  finite(time,'maturity');if(time<0||!Array.isArray(curve)||!curve.length||curve.length>1000)throw new RangeError('Invalid curve');
  let previous=0;const nodes=[{time:0,discount:1}];for(const p of curve){positive(p.time,'node maturity');positive(p.discount,'discount factor');if(p.time<=previous)throw new RangeError('Curve nodes must be strictly increasing');nodes.push(p);previous=p.time;}
  if(time===0)return 1;let j=1;while(j<nodes.length-1&&nodes[j].time<time)j++;
  const a=nodes[j-1],b=nodes[j],w=(time-a.time)/(b.time-a.time);
  return Math.exp(Math.log(a.discount)*(1-w)+Math.log(b.discount)*w);
}
export function forwardRate(curve,start,end) { if(end<=start)throw new RangeError('Forward end must follow start');return Math.log(discountFactor(curve,start)/discountFactor(curve,end))/(end-start); }
export function macroTransform(points,{kind='level',lag=12}={}) {
  if(!Array.isArray(points)||points.length>100000||!Number.isInteger(lag)||lag<1)throw new RangeError('Invalid macro series');
  if(!['level','change','percent','log'].includes(kind))throw new RangeError('Unknown macro transform');
  return points.map((p,i)=>{const x=Number.isFinite(p.value)?p.value:NaN,b=points[i-lag]?.value;return {...p,value:kind==='level'?x:kind==='log'?(x>0?Math.log(x):NaN):Number.isFinite(b)?kind==='change'?x-b:b!==0?(x/b-1)*100:NaN:NaN};});
}
export function financialRatios(m) {
  const ratio=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&b!==0?a/b:null;
  return {grossMargin:ratio(m.grossProfit,m.revenue),operatingMargin:ratio(m.operatingIncome,m.revenue),netMargin:ratio(m.netIncome,m.revenue),returnOnEquity:ratio(m.netIncome,m.equity),returnOnAssets:ratio(m.netIncome,m.assets),currentRatio:ratio(m.currentAssets,m.currentLiabilities),debtEquity:ratio(m.debt,m.equity),priceEarnings:ratio(m.marketCap,m.netIncome),priceSales:ratio(m.marketCap,m.revenue),priceBook:ratio(m.marketCap,m.equity),freeCashFlow:Number.isFinite(m.operatingCashFlow)&&Number.isFinite(m.capex)?m.operatingCashFlow-Math.abs(m.capex):null};
}
export function corporateActionSeries(bars,actions,{asOf=Infinity,dividends=true}={}) {
  if(!Array.isArray(bars)||!Array.isArray(actions)||actions.length>10000)throw new RangeError('Invalid action dataset');
  const out=bars.map(b=>({...b,adjusted:true,synthetic:true})),log=[];
  for(const a of [...actions].filter(a=>a.time<=asOf).sort((a,b)=>b.time-a.time)){
    positive(a.time,'action time');let factor,volume=1;
    if(a.type==='split'){positive(a.ratio,'split ratio');factor=1/a.ratio;volume=a.ratio;}
    else if(a.type==='dividend'&&dividends){finite(a.cash,'dividend');if(a.cash<0)throw new RangeError('Negative dividend');const prev=bars.findLast(b=>b.t<a.time);if(!prev)throw new RangeError('Dividend requires observed pre-event close');if(a.cash>=prev.c)throw new RangeError('Dividend must be below pre-event close');factor=(prev.c-a.cash)/prev.c;}
    else if(a.type==='dividend')continue;else throw new RangeError('Unsupported corporate action');
    for(const b of out)if(b.t<a.time){for(const k of ['o','h','l','c'])b[k]*=factor;b.v*=volume;}
    log.push({...a,priceFactor:factor,volumeFactor:volume});
  }
  return {bars:out,actions:log,source:'User-supplied corporate actions; backward price adjustment; not executable'};
}
export function continuousFutures(contracts,rolls,{initial,asOf=Infinity,mode='difference'}={}) {
  if(!['difference','ratio','none'].includes(mode)||!contracts[initial]||!Array.isArray(rolls)||rolls.length>1000)throw new RangeError('Invalid continuous contract specification');
  const used=rolls.filter(r=>r.time<=asOf).sort((a,b)=>a.time-b.time),segments=[];let name=initial,start=-Infinity;
  for(const r of used){positive(r.time,'roll time');if(r.time<=start||r.from!==name||!contracts[r.to])throw new RangeError('Invalid roll chain');
    const old=contracts[r.from].findLast(b=>b.t<=r.time),next=contracts[r.to].findLast(b=>b.t<=r.time);if(!old||!next)throw new RangeError('Roll requires observed prices for both contracts');
    if(mode==='ratio'&&(old.c<=0||next.c<=0))throw new RangeError('Ratio roll requires positive prices');
    segments.push({name,start,end:r.time,delta:next.c-old.c,ratio:next.c/old.c});start=r.time;name=r.to;
  }
  segments.push({name,start,end:asOf===Infinity?Infinity:asOf+1,delta:0,ratio:1});const out=[];
  for(let i=0;i<segments.length;i++){const s=segments[i],adjust=segments.slice(i).reduce((a,x)=>mode==='ratio'?a*x.ratio:a+x.delta,mode==='ratio'?1:0);
    for(const b of contracts[s.name])if(b.t>=s.start&&b.t<s.end&&b.t<=asOf){const n={...b,contract:s.name,synthetic:true,adjusted:mode!=='none'};if(mode!=='none')for(const k of ['o','h','l','c'])n[k]=mode==='ratio'?b[k]*adjust:b[k]+adjust;out.push(n);}}
  return {bars:out.sort((a,b)=>a.t-b.t),rolls:used,mode,source:'Explicit observed-contract rolls; synthetic display instrument'};
}
export function convertCurrency(amount,from,to,quotes,{now,maxAge=86400}={}) {
  finite(amount,'amount');finite(now,'quote observation time');positive(maxAge,'maximum age');if(!/^[A-Z]{3}$/.test(from)||!/^[A-Z]{3}$/.test(to))throw new RangeError('ISO currency code required');
  if(from===to)return {amount,path:[from],rate:1};const graph=new Map();
  const add=(a,b,rate,time)=>{if(!graph.has(a))graph.set(a,[]);graph.get(a).push({to:b,rate,time});};
  for(const q of quotes){positive(q.rate,'FX rate');finite(q.time,'FX timestamp');if(q.time>now||now-q.time>maxAge)continue;add(q.base,q.quote,q.rate,q.time);add(q.quote,q.base,1/q.rate,q.time);}
  const queue=[{currency:from,rate:1,path:[from]}],seen=new Set([from]);
  for(let i=0;i<queue.length&&i<100;i++){const x=queue[i];for(const e of graph.get(x.currency)||[]){if(seen.has(e.to))continue;const y={currency:e.to,rate:x.rate*e.rate,path:[...x.path,e.to]};if(e.to===to)return {amount:amount*y.rate,rate:y.rate,path:y.path};seen.add(e.to);queue.push(y);}}
  throw new RangeError('No fresh FX conversion path');
}
export function constantProductSwap({reserveIn,reserveOut,amountIn,fee=.003}) {
  positive(reserveIn,'input reserve');positive(reserveOut,'output reserve');positive(amountIn,'input amount');finite(fee,'fee');if(fee<0||fee>=1)throw new RangeError('Fee must be in [0,1)');
  const net=amountIn*(1-fee),amountOut=reserveOut*net/(reserveIn+net),mid=reserveOut/reserveIn;
  return {amountOut,feePaid:amountIn*fee,executionPrice:amountOut/amountIn,priceImpact:1-amountOut/(amountIn*mid),newReserveIn:reserveIn+amountIn,newReserveOut:reserveOut-amountOut,model:'Constant-product AMM; no routing, gas or MEV model'};
}
export function impermanentLoss(priceRatio){positive(priceRatio,'relative price');return 2*Math.sqrt(priceRatio)/(1+priceRatio)-1;}
export function aggregateHoldings(holdings,field='sector') {
  if(!['sector','country','currency','symbol'].includes(field)||!Array.isArray(holdings)||holdings.length>100000)throw new RangeError('Invalid holdings');const sums=new Map();let total=0;
  for(const h of holdings){finite(h.weight,'weight');if(h.weight<0)throw new RangeError('Only nonnegative allocation weights supported');total+=h.weight;const key=String(h[field]||'Unknown');sums.set(key,(sums.get(key)||0)+h.weight);}
  return {totalWeight:total,unallocated:Math.max(0,1-total),exposures:[...sums].map(([name,weight])=>({name,weight})).sort((a,b)=>b.weight-a.weight)};
}
