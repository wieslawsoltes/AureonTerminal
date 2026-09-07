import {createExtraStudies} from './studies-extra.js';
/** Configurable study registry. Outputs are aligned to raw source bars, float64.
 * No look-ahead/backfilling of warm-up observations. Gap behavior is explicit.
 */
import {sma,ema,rma,rsi,atr,macd,bollinger,stochastic,vwap,obv} from './indicators.js';
const blank=n=>new Float64Array(n).fill(NaN);
const zip=(a,b,f)=>Float64Array.from(a,(v,i)=>f(v,b[i]));
export function validPeriod(n){if(!Number.isInteger(n)||n<1||n>10000)throw new Error('Period must be an integer in [1,10000].');return n;}
export function extrema(a,n,highest=true){validPeriod(n);const out=blank(a.length),q=[];let head=0,bad=0;for(let i=0;i<a.length;i++){if(!Number.isFinite(a[i]))bad++;else{while(q.length>head&&(highest?a[q.at(-1)]<=a[i]:a[q.at(-1)]>=a[i]))q.pop();q.push(i);}if(i>=n&&!Number.isFinite(a[i-n]))bad--;while(head<q.length&&q[head]<=i-n)head++;if(i>=n-1&&!bad&&head<q.length)out[i]=a[q[head]];if(head>10000){q.splice(0,head);head=0;}}return out;}
export function wma(a,n){validPeriod(n);const out=blank(a.length),den=n*(n+1)/2;let sum=0,weighted=0,bad=0;for(let i=0;i<a.length;i++){const v=Number.isFinite(a[i])?a[i]:0;weighted+=n*v-sum;sum+=v;if(!Number.isFinite(a[i]))bad++;if(i>=n){sum-=Number.isFinite(a[i-n])?a[i-n]:0;if(!Number.isFinite(a[i-n]))bad--;}if(i>=n-1&&bad===0)out[i]=weighted/den;}return out;}
export function vwma(bars,n){validPeriod(n);const num=sma(bars.map(b=>b.c*b.v),n),den=sma(bars.map(b=>b.v),n);return zip(num,den,(a,b)=>b?a/b:NaN);}
export function hma(a,n){validPeriod(n);return wma(zip(wma(a,Math.max(1,Math.floor(n/2))),wma(a,n),(x,y)=>2*x-y),Math.max(1,Math.floor(Math.sqrt(n))));}
export function roc(a,n){validPeriod(n);return Float64Array.from(a,(v,i)=>i>=n&&a[i-n]!==0?(v/a[i-n]-1)*100:NaN);}
export function cci(bars,n){validPeriod(n);const tp=bars.map(b=>(b.h+b.l+b.c)/3),mean=sma(tp,n),out=blank(bars.length);for(let i=n-1;i<bars.length;i++){let dev=0;for(let j=i-n+1;j<=i;j++)dev+=Math.abs(tp[j]-mean[i]);out[i]=dev? (tp[i]-mean[i])/(.015*dev/n):0;}return out;}
export function moneyFlow(bars,n){validPeriod(n);const pos=blank(bars.length),neg=blank(bars.length);for(let i=1;i<bars.length;i++){const b=bars[i],p=bars[i-1],tp=(b.h+b.l+b.c)/3,prev=(p.h+p.l+p.c)/3;pos[i]=tp>prev?tp*b.v:0;neg[i]=tp<prev?tp*b.v:0;}return zip(sma(pos,n),sma(neg,n),(p,m)=>!Number.isFinite(p)?NaN:m===0?(p===0?50:100):100-100/(1+p/m));}
export function dmi(bars,n=14,smooth=14){const plus=blank(bars.length),minus=blank(bars.length);for(let i=1;i<bars.length;i++){const up=bars[i].h-bars[i-1].h,down=bars[i-1].l-bars[i].l;plus[i]=up>down&&up>0?up:0;minus[i]=down>up&&down>0?down:0;}const tr=atr(bars,n),p=zip(rma(plus,n),tr,(x,y)=>y?100*x/y:0),m=zip(rma(minus,n),tr,(x,y)=>y?100*x/y:0),dx=zip(p,m,(a,b)=>a+b?100*Math.abs(a-b)/(a+b):0);return{plus:p,minus:m,adx:rma(dx,smooth)};}
export function supertrend(bars,n=10,mult=3){const a=atr(bars,n),upper=blank(bars.length),lower=blank(bars.length),trend=blank(bars.length),direction=blank(bars.length);let dir=1;for(let i=0;i<bars.length;i++){if(!Number.isFinite(a[i]))continue;const b=bars[i],mid=(b.h+b.l)/2,u=mid+mult*a[i],l=mid-mult*a[i];upper[i]=i&&Number.isFinite(upper[i-1])&&bars[i-1].c<=upper[i-1]?Math.min(u,upper[i-1]):u;lower[i]=i&&Number.isFinite(lower[i-1])&&bars[i-1].c>=lower[i-1]?Math.max(l,lower[i-1]):l;if(i&&Number.isFinite(trend[i-1])){if(dir<0&&b.c>upper[i-1])dir=1;else if(dir>0&&b.c<lower[i-1])dir=-1;}direction[i]=dir;trend[i]=dir>0?lower[i]:upper[i];}return{trend,direction};}
export function parabolicSAR(bars,step=.02,max=.2){if(!(step>0&&max>=step&&max<=1))throw new Error('SAR acceleration requires 0 < step ≤ max ≤ 1.');const out=blank(bars.length);if(bars.length<2)return out;let up=bars[1].c>=bars[0].c,ep=up?bars[0].h:bars[0].l,sar=up?bars[0].l:bars[0].h,af=step;for(let i=1;i<bars.length;i++){sar+=af*(ep-sar);sar=up?Math.min(sar,bars[i-1].l,i>1?bars[i-2].l:Infinity):Math.max(sar,bars[i-1].h,i>1?bars[i-2].h:-Infinity);if(up?bars[i].l<sar:bars[i].h>sar){up=!up;sar=ep;ep=up?bars[i].h:bars[i].l;af=step;}else if(up?bars[i].h>ep:bars[i].l<ep){ep=up?bars[i].h:bars[i].l;af=Math.min(max,af+step);}out[i]=sar;}return out;}
export function regression(a,n){validPeriod(n);const out=blank(a.length);if(n===1)return Float64Array.from(a);const sx=n*(n-1)/2,sxx=n*(n-1)*(2*n-1)/6;let sum=0,sxy=0,bad=0;for(let i=0;i<a.length;i++){const v=Number.isFinite(a[i])?a[i]:0;if(i<n){sum+=v;sxy+=i*v;if(!Number.isFinite(a[i]))bad++;}else{const old=Number.isFinite(a[i-n])?a[i-n]:0;sxy-=sum-old;sxy+=(n-1)*v;sum+=v-old;if(!Number.isFinite(a[i-n]))bad--;if(!Number.isFinite(a[i]))bad++;}if(i>=n-1&&!bad){const slope=(n*sxy-sx*sum)/(n*sxx-sx*sx);out[i]=(sum-slope*sx)/n+slope*(n-1);}}return out;}
export function correlation(a,b,n){validPeriod(n);const out=blank(a.length);for(let i=n-1;i<a.length;i++){let x=0,y=0;for(let j=i-n+1;j<=i;j++){x+=a[j];y+=b[j];}x/=n;y/=n;let xy=0,xx=0,yy=0;for(let j=i-n+1;j<=i;j++){const dx=a[j]-x,dy=b[j]-y;xy+=dx*dy;xx+=dx*dx;yy+=dy*dy;}out[i]=xx&&yy?xy/Math.sqrt(xx*yy):NaN;}return out;}
const C=['#5b9cfa','#f6b95e','#b99af5','#5dccb2','#ee7fa4'];
const P=(key,label,def,min=1,max=10000,step=1)=>({key,label,default:def,min,max,step});
const LEN=(n=20)=>P('length','Length',n);
export const STUDIES = {
  ema:{name:'Exponential moving average',overlay:true,params:[LEN()],calc:(b,p)=>({EMA:ema(b.map(x=>x.c),p.length)})},
  sma:{name:'Simple moving average',overlay:true,params:[LEN(50)],calc:(b,p)=>({SMA:sma(b.map(x=>x.c),p.length)})},
  wma:{name:'Weighted moving average',overlay:true,params:[LEN()],calc:(b,p)=>({WMA:wma(b.map(x=>x.c),p.length)})},
  hma:{name:'Hull moving average',overlay:true,params:[LEN()],calc:(b,p)=>({HMA:hma(b.map(x=>x.c),p.length)})},
  rma:{name:'Wilder moving average',overlay:true,params:[LEN()],calc:(b,p)=>({RMA:rma(b.map(x=>x.c),p.length)})},
  vwma:{name:'Volume-weighted MA',overlay:true,params:[LEN()],calc:(b,p)=>({VWMA:vwma(b,p.length)})},
  dema:{name:'Double exponential MA',overlay:true,params:[LEN()],calc:(b,p)=>{const e=ema(b.map(x=>x.c),p.length);return{DEMA:zip(e,ema(e,p.length),(a,b)=>2*a-b)};}},
  tema:{name:'Triple exponential MA',overlay:true,params:[LEN()],calc:(b,p)=>{const a=ema(b.map(x=>x.c),p.length),e=ema(a,p.length),f=ema(e,p.length);return{TEMA:Float64Array.from(a,(x,i)=>3*x-3*e[i]+f[i])};}},
  bb:{name:'Bollinger Bands',overlay:true,params:[P('length','Length',20,2),P('mult','Deviation',2,.1,10,.1)],calc:(b,p)=>bollinger(b.map(x=>x.c),p.length,p.mult)},
  rsi:{name:'Relative strength index',levels:[30,70],range:[0,100],params:[LEN(14)],calc:(b,p)=>({RSI:rsi(b.map(x=>x.c),p.length)})},
  macd:{name:'MACD',params:[P('fast','Fast',12),P('slow','Slow',26),P('signal','Signal',9)],calc:(b,p)=>macd(b.map(x=>x.c),p.fast,p.slow,p.signal)},
  atr:{name:'Average true range',params:[LEN(14)],calc:(b,p)=>({ATR:atr(b,p.length)})},
  stoch:{name:'Stochastic',levels:[20,80],range:[0,100],params:[LEN(14),P('smooth','%D smoothing',3)],calc:(b,p)=>stochastic(b,p.length,p.smooth)},
  stochrsi:{name:'Stochastic RSI',levels:[20,80],range:[0,100],params:[LEN(14),P('smooth','Smoothing',3)],calc:(b,p)=>{const a=rsi(b.map(x=>x.c),p.length),h=extrema(a,p.length),l=extrema(a,p.length,false),k=Float64Array.from(a,(v,i)=>h[i]!==l[i]?100*(v-l[i])/(h[i]-l[i]):50);return{k:sma(k,p.smooth),d:sma(sma(k,p.smooth),p.smooth)};}},
  obv:{name:'On-balance volume',params:[],calc:b=>({OBV:obv(b)})},
  vwap:{name:'Session VWAP · UTC',overlay:true,params:[],calc:b=>({VWAP:vwap(b)})},
  avwap:{name:'Anchored VWAP',overlay:true,params:[P('anchor','Start bar index',0,0,250000)],calc:(b,p)=>{let v=0,pv=0;return{VWAP:Float64Array.from(b,(x,i)=>{if(i<p.anchor)return NaN;pv+=(x.h+x.l+x.c)/3*x.v;v+=x.v;return v?pv/v:NaN;})};}},
  donchian:{name:'Donchian channel',overlay:true,params:[LEN()],calc:(b,p)=>{const upper=extrema(b.map(x=>x.h),p.length),lower=extrema(b.map(x=>x.l),p.length,false);return{upper,lower,mid:zip(upper,lower,(a,b)=>(a+b)/2)};}},
  keltner:{name:'Keltner channel',overlay:true,params:[LEN(),P('mult','ATR multiplier',2,.1,20,.1)],calc:(b,p)=>{const mid=ema(b.map(x=>x.c),p.length),a=atr(b,p.length);return{mid,upper:zip(mid,a,(x,y)=>x+p.mult*y),lower:zip(mid,a,(x,y)=>x-p.mult*y)};}},
  supertrend:{name:'Supertrend',overlay:true,params:[LEN(10),P('mult','ATR multiplier',3,.1,20,.1)],calc:(b,p)=>({Trend:supertrend(b,p.length,p.mult).trend})},
  sar:{name:'Parabolic SAR',overlay:true,params:[P('step','Acceleration',.02,.001,1,.001),P('max','Maximum',.2,.001,1,.01)],calc:(b,p)=>({SAR:parabolicSAR(b,p.step,p.max)})},
  dmi:{name:'Directional movement / ADX',levels:[25],params:[LEN(14),P('smooth','ADX smoothing',14)],calc:(b,p)=>dmi(b,p.length,p.smooth)},
  cci:{name:'Commodity channel index',levels:[-100,100],params:[LEN()],calc:(b,p)=>({CCI:cci(b,p.length)})},
  mfi:{name:'Money flow index',range:[0,100],levels:[20,80],params:[LEN(14)],calc:(b,p)=>({MFI:moneyFlow(b,p.length)})},
  williams:{name:'Williams %R',range:[-100,0],levels:[-80,-20],params:[LEN(14)],calc:(b,p)=>{const h=extrema(b.map(x=>x.h),p.length),l=extrema(b.map(x=>x.l),p.length,false);return{'%R':Float64Array.from(b,(x,i)=>h[i]!==l[i]?-100*(h[i]-x.c)/(h[i]-l[i]):-50)};}},
  roc:{name:'Rate of change',levels:[0],params:[LEN(10)],calc:(b,p)=>({ROC:roc(b.map(x=>x.c),p.length)})},
  momentum:{name:'Momentum',levels:[0],params:[LEN(10)],calc:(b,p)=>({MOM:Float64Array.from(b,(x,i)=>i>=p.length?x.c-b[i-p.length].c:NaN)})},
  cmf:{name:'Chaikin money flow',levels:[0],params:[LEN()],calc:(b,p)=>{const mf=sma(b.map(x=>x.h===x.l?0:(2*x.c-x.l-x.h)/(x.h-x.l)*x.v),p.length),v=sma(b.map(x=>x.v),p.length);return{CMF:zip(mf,v,(x,y)=>y?x/y:0)};}},
  adl:{name:'Accumulation / distribution',params:[],calc:b=>{let sum=0;return{ADL:Float64Array.from(b,x=>sum+=x.h===x.l?0:(2*x.c-x.l-x.h)/(x.h-x.l)*x.v)};}},
  linreg:{name:'Linear regression',overlay:true,params:[LEN(50)],calc:(b,p)=>({LSMA:regression(b.map(x=>x.c),p.length)})},
  awesome:{name:'Awesome oscillator',levels:[0],params:[P('fast','Fast',5),P('slow','Slow',34)],calc:(b,p)=>{const a=b.map(x=>(x.h+x.l)/2);return{AO:zip(sma(a,p.fast),sma(a,p.slow),(x,y)=>x-y)};}},
  ichimoku:{name:'Ichimoku · causal projected spans',overlay:true,params:[P('tenkan','Conversion',9),P('kijun','Base',26),P('span','Span B',52)],calc:(b,p)=>{const h=b.map(x=>x.h),l=b.map(x=>x.l),mid=n=>zip(extrema(h,n),extrema(l,n,false),(a,b)=>(a+b)/2),tenkan=mid(p.tenkan),kijun=mid(p.kijun),a=zip(tenkan,kijun,(x,y)=>(x+y)/2),bb=mid(p.span);return{tenkan,kijun,spanA:Float64Array.from(a,(_,i)=>i>=p.kijun?a[i-p.kijun]:NaN),spanB:Float64Array.from(bb,(_,i)=>i>=p.kijun?bb[i-p.kijun]:NaN)};}},
  pivots:{name:'Previous UTC session pivots',overlay:true,params:[],calc:b=>{const out={P:blank(b.length),R1:blank(b.length),S1:blank(b.length),R2:blank(b.length),S2:blank(b.length)};let day=null,h=-Infinity,l=Infinity,c=NaN,prev;for(let i=0;i<b.length;i++){const x=b[i],d=Math.floor(x.t/86400);if(day!==d){if(day!==null)prev={h,l,c};day=d;h=-Infinity;l=Infinity;}if(prev){const p=(prev.h+prev.l+prev.c)/3;out.P[i]=p;out.R1[i]=2*p-prev.l;out.S1[i]=2*p-prev.h;out.R2[i]=p+prev.h-prev.l;out.S2[i]=p-prev.h+prev.l;}h=Math.max(h,x.h);l=Math.min(l,x.l);c=x.c;}return out;}}
};
export function studyParameters(type,raw={}){const def=STUDIES[type];if(!def)throw new Error('Unknown study: '+type);const out={};for(const spec of def.params){const v=Number(raw[spec.key]??spec.default);if(!Number.isFinite(v)||v<spec.min||v>spec.max||(spec.step===1&&!Number.isInteger(v)))throw new Error(`${spec.label} must be ${spec.min}–${spec.max}.`);out[spec.key]=v;}return out;}
export function computeStudies(bars,specs=[]){if(!Array.isArray(specs)||specs.length>32)throw new Error('At most 32 study instances.');return specs.filter(s=>s.visible!==false).map(s=>{const d=STUDIES[s.type];if(!d)throw new Error('Unknown study '+s.type);const p=studyParameters(s.type,s.params),raw=d.calc(bars,p);return{id:s.id,type:s.type,name:s.name||d.name,overlay:s.overlay??!!d.overlay,levels:d.levels||[],range:d.range,plots:Object.entries(raw).map(([name,values],i)=>({name,values,color:i===0&&/^#[\da-f]{6}$/i.test(s.color||'')?s.color:C[i%C.length],width:s.width||1.5}))};});}

Object.assign(STUDIES, createExtraStudies({extrema,wma,roc,regression}));
