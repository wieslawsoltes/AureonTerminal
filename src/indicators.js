/** O(n) indicators with explicit NaN warm-up; all calculations are float64. */
const empty=n=>new Float64Array(n).fill(NaN);
function period(n){if(!Number.isInteger(n)||n<1||n>10000)throw new Error('Period must be an integer in [1, 10000].');}
export function sma(values,n){period(n);const out=empty(values.length);let sum=0,count=0;for(let i=0;i<values.length;i++){if(Number.isFinite(values[i])){sum+=values[i];count++;}if(i>=n&&Number.isFinite(values[i-n])){sum-=values[i-n];count--;}if(i>=n-1&&count===n)out[i]=sum/n;}return out;}
export function ema(values,n){period(n);const out=empty(values.length),a=2/(n+1);let prev=NaN,sum=0,count=0;for(let i=0;i<values.length;i++){const v=values[i];if(!Number.isFinite(v)){prev=NaN;sum=0;count=0;continue;}if(!Number.isFinite(prev)){sum+=v;count++;if(count===n)prev=sum/n;}else prev=a*v+(1-a)*prev;out[i]=prev;}return out;}
export function rma(values,n){period(n);const out=empty(values.length);let prev=NaN,sum=0,count=0;for(let i=0;i<values.length;i++){const v=values[i];if(!Number.isFinite(v)){prev=NaN;sum=0;count=0;continue;}if(!Number.isFinite(prev)){sum+=v;count++;if(count===n)prev=sum/n;}else prev=(prev*(n-1)+v)/n;out[i]=prev;}return out;}
export function rsi(values,n=14){period(n);const gain=empty(values.length),loss=empty(values.length);for(let i=1;i<values.length;i++){const d=values[i]-values[i-1];gain[i]=Math.max(0,d);loss[i]=Math.max(0,-d);}const g=rma(gain,n),l=rma(loss,n),out=empty(values.length);for(let i=0;i<out.length;i++)if(Number.isFinite(g[i])&&Number.isFinite(l[i]))out[i]=l[i]===0?(g[i]===0?50:100):100-100/(1+g[i]/l[i]);return out;}
export function bollinger(values,n=20,multiplier=2){period(n);if(n<2)throw new Error('Bollinger period must be at least 2.');const mid=empty(values.length),upper=empty(values.length),lower=empty(values.length);let mean=0,m2=0,count=0;for(let i=0;i<values.length;i++){
  const x=values[i];if(!Number.isFinite(x))throw new Error('Bollinger input must be finite.');
  if(count===n){const old=values[i-n],next=(n*mean-old)/(n-1);m2-=(old-mean)*(old-next);mean=next;count--;}
  count++;const d=x-mean;mean+=d/count;m2+=d*(x-mean);
  if(count===n){const std=Math.sqrt(Math.max(0,m2/n));mid[i]=mean;upper[i]=mean+multiplier*std;lower[i]=mean-multiplier*std;}
}return {mid,upper,lower};}
export function macd(values,fast=12,slow=26,signalPeriod=9){if(fast>=slow)throw new Error('MACD fast period must be smaller than slow.');const a=ema(values,fast),b=ema(values,slow),line=Float64Array.from(a,(v,i)=>v-b[i]),signal=ema(line,signalPeriod),histogram=Float64Array.from(line,(v,i)=>v-signal[i]);return{line,signal,histogram};}
export function atr(bars,n=14){const tr=Float64Array.from(bars,(b,i)=>i?Math.max(b.h-b.l,Math.abs(b.h-bars[i-1].c),Math.abs(b.l-bars[i-1].c)):b.h-b.l);return rma(tr,n);}
export function vwap(bars){const out=empty(bars.length);let session=-1,pv=0,v=0;for(let i=0;i<bars.length;i++){const b=bars[i],day=Math.floor(b.t/86400);if(day!==session){session=day;pv=0;v=0;}pv+=(b.h+b.l+b.c)/3*b.v;v+=b.v;if(v)out[i]=pv/v;}return out;}
export function stochastic(bars,n=14,smooth=3){period(n);const k=empty(bars.length);const high=[],low=[];let hi=0,lo=0;for(let i=0;i<bars.length;i++){
  while(high.length>hi&&bars[high.at(-1)].h<=bars[i].h)high.pop();high.push(i);
  while(low.length>lo&&bars[low.at(-1)].l>=bars[i].l)low.pop();low.push(i);
  while(high[hi]<=i-n)hi++;while(low[lo]<=i-n)lo++;
  if(i>=n-1){const h=bars[high[hi]].h,l=bars[low[lo]].l;k[i]=h===l?50:(bars[i].c-l)/(h-l)*100;}
  if(hi>10000){high.splice(0,hi);hi=0;}if(lo>10000){low.splice(0,lo);lo=0;}
}return{k,d:sma(k,smooth)};}
export function obv(bars){let v=0;return Float64Array.from(bars,(b,i)=>{if(i)v+=Math.sign(b.c-bars[i-1].c)*b.v;return v;});}
export function computeIndicators(bars){const close=Float64Array.from(bars,b=>b.c);return{ema:ema(close,20),sma:sma(close,50),bb:bollinger(close),rsi:rsi(close),macd:macd(close),vwap:vwap(bars),atr:atr(bars),stoch:stochastic(bars),obv:obv(bars)};}
/** Long-only EMA cross backtest. Prior-bar signal -> next-bar open; no same-bar fills. */
export function backtest(bars,{fast=12,slow=26,initial=100000,feeBps=10,slippageBps=5,allocation=1}={}){
  period(fast);period(slow);if(fast>=slow||bars.length<slow+3)throw new Error('Need fast < slow and more than slow + 2 bars.');
  if(!(initial>0)||![initial,feeBps,slippageBps,allocation].every(Number.isFinite)||feeBps<0||feeBps>1000||slippageBps<0||slippageBps>1000||allocation<=0||allocation>1)throw new Error('Invalid backtest assumptions.');
  const close=bars.map(b=>b.c),f=ema(close,fast),s=ema(close,slow),fee=feeBps/10000,slip=slippageBps/10000;
  let cash=initial,qty=0,entry=null,peak=initial,maxDrawdown=0;const trades=[],equity=[],markers=[];
  for(let i=0;i<bars.length;i++){
    if(i>=2&&Number.isFinite(s[i-2])){
      const up=f[i-2]<=s[i-2]&&f[i-1]>s[i-1],down=f[i-2]>=s[i-2]&&f[i-1]<s[i-1];
      if(up&&!qty){const price=bars[i].o*(1+slip),cost=cash*allocation;qty=cost/(price*(1+fee));cash-=cost;entry={t:bars[i].t,price,quantity:qty,cost};markers.push({t:bars[i].t,p:price,side:'buy'});}
      else if(down&&qty){const price=bars[i].o*(1-slip),proceeds=qty*price*(1-fee);cash+=proceeds;trades.push({...entry,exitTime:bars[i].t,exitPrice:price,pnl:proceeds-entry.cost});markers.push({t:bars[i].t,p:price,side:'sell'});qty=0;entry=null;}
    }
    const value=cash+qty*bars[i].c;peak=Math.max(peak,value);maxDrawdown=Math.max(maxDrawdown,(peak-value)/peak);equity.push({t:bars[i].t,value});
  }
  const final=equity.at(-1).value,wins=trades.filter(t=>t.pnl>0).length;
  return{initial,final,net:final-initial,returnPct:(final/initial-1)*100,maxDrawdownPct:maxDrawdown*100,trades,wins,winRate:trades.length?wins/trades.length*100:0,equity,markers,openPosition:entry,assumptions:{fast,slow,feeBps,slippageBps,allocation,execution:'Previous-bar signal, next-bar open; open position marked to final close.'}};
}
