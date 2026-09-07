import {rollingMoments,rollingPercentRank} from './rolling-statistics.js';
/** Extended study catalogue. Warm-up remains NaN, outputs never backfilled.
 * Parameter metadata is the same source used by UI and worker validation.
 */
import {sma,ema,rma,rsi,atr,bollinger} from './indicators.js';
const empty=n=>new Float64Array(n).fill(NaN);
const arr=(a,f)=>Float64Array.from(a,f);
const diff=a=>arr(a,(v,i)=>i?v-a[i-1]:NaN);
const divide=(a,b,factor=1)=>arr(a,(v,i)=>Number.isFinite(v)&&Number.isFinite(b[i])&&b[i]!==0?factor*v/b[i]:NaN);
const param=(key,label,value,min=1,max=10000,step=1)=>({key,label,default:value,min,max,step});
const len=(n=20)=>param('length','Length',n);
const sum=(a,n)=>arr(sma(a,n),v=>v*n);
function variance(a,n){return rollingMoments(a,n).variance;}
function adaptive(a,n,fast,slow){const out=empty(a.length),changes=arr(diff(a),Math.abs),noise=sum(changes,n);let last=NaN;for(let i=n;i<a.length;i++){if(!Number.isFinite(a[i])||!Number.isFinite(noise[i])){last=NaN;continue;}if(!Number.isFinite(last))last=a[i];const efficiency=noise[i]?Math.abs(a[i]-a[i-n])/noise[i]:0,alpha=(efficiency*(2/(fast+1)-2/(slow+1))+2/(slow+1))**2;last+=alpha*(a[i]-last);out[i]=last;}return out;}
function directionalVolume(b){let ad=0;return arr(b,x=>ad+=x.h===x.l?0:(2*x.c-x.h-x.l)/(x.h-x.l)*x.v);}
export function createExtraStudies({extrema,wma,roc,regression}) {
 const moving=(name,fn,overlay=true,n=20)=>({name,overlay,params:[len(n)],calc:(b,p)=>({[name]:fn(b.map(x=>x.c),p.length)})});
 const registry={
  tr:{name:'True range',params:[],calc:b=>({TR:arr(b,(x,i)=>i?Math.max(x.h-x.l,Math.abs(x.h-b[i-1].c),Math.abs(x.l-b[i-1].c)):x.h-x.l)})},
  trima:moving('Triangular moving average',(a,n)=>sma(sma(a,Math.ceil(n/2)),Math.floor(n/2)+1)),
  swma:{name:'Symmetrically weighted MA · 4',overlay:true,params:[],calc:b=>({SWMA:arr(b,(x,i)=>i<3?NaN:(b[i-3].c+2*b[i-2].c+2*b[i-1].c+x.c)/6)})},
  zlema:moving('Zero-lag EMA',(a,n)=>{const lag=Math.floor((n-1)/2);return ema(arr(a,(v,i)=>i>=lag?2*v-a[i-lag]:NaN),n);}),
  kama:{name:'Kaufman adaptive MA',overlay:true,params:[len(10),param('fast','Fast period',2),param('slow','Slow period',30)],calc:(b,p)=>{if(p.fast>=p.slow)throw new RangeError('Fast period must precede slow');return {KAMA:adaptive(b.map(x=>x.c),p.length,p.fast,p.slow)};}},
  alma:{name:'Arnaud Legoux MA',overlay:true,params:[len(9),param('offset','Offset',.85,0,1,.01),param('sigma','Sigma',6,.1,50,.1)],calc:(b,p)=>{const m=p.offset*(p.length-1),s=p.length/p.sigma,w=Array.from({length:p.length},(_,i)=>Math.exp(-((i-m)**2)/(2*s*s))),den=w.reduce((a,b)=>a+b,0);return {ALMA:arr(b,(_,i)=>i<p.length-1?NaN:w.reduce((a,v,j)=>a+v*b[i-p.length+1+j].c,0)/den)};}},
  mcginley:moving('McGinley dynamic',(a,n)=>{let last=NaN;const seed=sma(a,n);return arr(a,(v,i)=>{if(i<n-1)return NaN;if(!Number.isFinite(last))last=seed[i];else if(v>0&&last>0)last+=(v-last)/Math.max(1,n*(v/last)**4);else last=NaN;return last;});}),
  stddev:moving('Population standard deviation',(a,n)=>arr(variance(a,n),Math.sqrt),false),
  variance:moving('Population variance',variance,false),
  zscore:moving('Rolling z-score',(a,n)=>{const mean=sma(a,n),v=variance(a,n);return arr(a,(x,i)=>v[i]>0?(x-mean[i])/Math.sqrt(v[i]):NaN);},false),
  bbwidth:{name:'Bollinger bandwidth %',params:[param('length','Length',20,2),param('mult','Deviation',2,.1,10,.1)],calc:(b,p)=>{const x=bollinger(b.map(x=>x.c),p.length,p.mult);return {Width:divide(arr(x.upper,(v,i)=>v-x.lower[i]),x.mid,100)};}},
  bbpercent:{name:'Bollinger %B',levels:[0,1],params:[param('length','Length',20,2),param('mult','Deviation',2,.1,10,.1)],calc:(b,p)=>{const x=bollinger(b.map(x=>x.c),p.length,p.mult);return {PercentB:divide(arr(b,(v,i)=>v.c-x.lower[i]),arr(x.upper,(v,i)=>v-x.lower[i]))};}},
  envelope:{name:'Moving-average envelopes',overlay:true,params:[len(),param('percent','Envelope %',2,.01,100,.01)],calc:(b,p)=>{const mid=sma(b.map(x=>x.c),p.length);return {Mid:mid,Upper:arr(mid,v=>v*(1+p.percent/100)),Lower:arr(mid,v=>v*(1-p.percent/100))};}},
  cmo:{name:'Chande momentum oscillator',range:[-100,100],levels:[-50,50],params:[len(14)],calc:(b,p)=>{const d=diff(b.map(x=>x.c)),up=sum(arr(d,v=>Math.max(0,v)),p.length),down=sum(arr(d,v=>Math.max(0,-v)),p.length);return {CMO:arr(up,(v,i)=>Number.isFinite(v)?v+down[i]?100*(v-down[i])/(v+down[i]):0:NaN)};}},
  trix:moving('TRIX',(a,n)=>roc(ema(ema(ema(a,n),n),n),1),false,15),
  tsi:{name:'True strength index',levels:[0],params:[param('long','Long',25),param('short','Short',13),param('signal','Signal',7)],calc:(b,p)=>{const d=diff(b.map(x=>x.c)),line=divide(ema(ema(d,p.long),p.short),ema(ema(arr(d,Math.abs),p.long),p.short),100);return {TSI:line,Signal:ema(line,p.signal)};}},
  ppo:{name:'Percentage price oscillator',levels:[0],params:[param('fast','Fast',12),param('slow','Slow',26),param('signal','Signal',9)],calc:(b,p)=>{if(p.fast>=p.slow)throw new RangeError('Fast must precede slow');const a=ema(b.map(x=>x.c),p.fast),d=ema(b.map(x=>x.c),p.slow),line=divide(arr(a,(v,i)=>v-d[i]),d,100),signal=ema(line,p.signal);return {PPO:line,Signal:signal,Histogram:arr(line,(v,i)=>v-signal[i])};}},
  pvo:{name:'Percentage volume oscillator',levels:[0],params:[param('fast','Fast',12),param('slow','Slow',26),param('signal','Signal',9)],calc:(b,p)=>{if(p.fast>=p.slow)throw new RangeError('Fast must precede slow');const a=ema(b.map(x=>x.v),p.fast),d=ema(b.map(x=>x.v),p.slow),line=divide(arr(a,(v,i)=>v-d[i]),d,100);return {PVO:line,Signal:ema(line,p.signal)};}},
  coppock:{name:'Coppock curve',levels:[0],params:[param('fast','Fast ROC',11),param('slow','Slow ROC',14),param('smooth','WMA length',10)],calc:(b,p)=>{const c=b.map(x=>x.c),a=roc(c,p.fast),d=roc(c,p.slow);return {Coppock:wma(arr(a,(v,i)=>v+d[i]),p.smooth)};}},
  dpo:{name:'Detrended price oscillator · unshifted causal',levels:[0],params:[len()],calc:(b,p)=>{const c=b.map(x=>x.c),avg=sma(c,p.length),lag=Math.floor(p.length/2)+1;return {DPO:arr(c,(_,i)=>i>=lag?c[i-lag]-avg[i]:NaN)};}},
  aroon:{name:'Aroon up/down',range:[0,100],params:[len(25)],calc:(b,p)=>{const up=empty(b.length),down=empty(b.length);for(let i=p.length;i<b.length;i++){let hi=i,lo=i;for(let j=i-p.length;j<=i;j++){if(b[j].h>b[hi].h)hi=j;if(b[j].l<b[lo].l)lo=j;}up[i]=100*(p.length-i+hi)/p.length;down[i]=100*(p.length-i+lo)/p.length;}return {Up:up,Down:down};}},
  vortex:{name:'Vortex indicator',params:[len(14)],calc:(b,p)=>{const tr=arr(b,(x,i)=>i?Math.max(x.h-x.l,Math.abs(x.h-b[i-1].c),Math.abs(x.l-b[i-1].c)):NaN),den=sum(tr,p.length);return {Plus:divide(sum(arr(b,(x,i)=>i?Math.abs(x.h-b[i-1].l):NaN),p.length),den),Minus:divide(sum(arr(b,(x,i)=>i?Math.abs(x.l-b[i-1].h):NaN),p.length),den)};}},
  choppiness:{name:'Choppiness index',levels:[38.2,61.8],params:[param('length','Length',14,2)],calc:(b,p)=>{const h=extrema(b.map(x=>x.h),p.length),l=extrema(b.map(x=>x.l),p.length,false),tr=sum(atr(b,1),p.length);return {Chop:arr(tr,(v,i)=>h[i]>l[i]?100*Math.log10(v/(h[i]-l[i]))/Math.log10(p.length):NaN)};}},
  ultimate:{name:'Ultimate oscillator',range:[0,100],levels:[30,70],params:[param('short','Short',7),param('medium','Medium',14),param('long','Long',28)],calc:(b,p)=>{const bp=arr(b,(x,i)=>i?x.c-Math.min(x.l,b[i-1].c):NaN),tr=arr(b,(x,i)=>i?Math.max(x.h,b[i-1].c)-Math.min(x.l,b[i-1].c):NaN),average=n=>divide(sum(bp,n),sum(tr,n)),a=average(p.short),d=average(p.medium),e=average(p.long);return {Ultimate:arr(a,(v,i)=>100*(4*v+2*d[i]+e[i])/7)};}},
  bop:{name:'Balance of power',levels:[0],params:[len(14)],calc:(b,p)=>({BOP:sma(arr(b,x=>x.h===x.l?0:(x.c-x.o)/(x.h-x.l)),p.length)})},
  elder:{name:'Elder Ray bull/bear power',levels:[0],params:[len(13)],calc:(b,p)=>{const e=ema(b.map(x=>x.c),p.length);return {Bull:arr(b,(x,i)=>x.h-e[i]),Bear:arr(b,(x,i)=>x.l-e[i])};}},
  force:{name:'Elder force index',levels:[0],params:[len(13)],calc:(b,p)=>({Force:ema(arr(b,(x,i)=>i?(x.c-b[i-1].c)*x.v:NaN),p.length)})},
  pvt:{name:'Price volume trend',params:[],calc:b=>{let sum=0;return {PVT:arr(b,(x,i)=>{if(i&&b[i-1].c!==0)sum+=(x.c/b[i-1].c-1)*x.v;return sum;})};}},
  nvi:{name:'Negative volume index',params:[],calc:b=>{let v=1000;return {NVI:arr(b,(x,i)=>{if(i&&x.v<b[i-1].v&&b[i-1].c)v*=x.c/b[i-1].c;return v;})};}},
  pvi:{name:'Positive volume index',params:[],calc:b=>{let v=1000;return {PVI:arr(b,(x,i)=>{if(i&&x.v>b[i-1].v&&b[i-1].c)v*=x.c/b[i-1].c;return v;})};}},
  chaikin:{name:'Chaikin oscillator',levels:[0],params:[param('fast','Fast EMA',3),param('slow','Slow EMA',10)],calc:(b,p)=>{const a=directionalVolume(b),fast=ema(a,p.fast),slow=ema(a,p.slow);return {Chaikin:arr(fast,(v,i)=>v-slow[i])};}},
  eom:{name:'Ease of movement',levels:[0],params:[len(14),param('scale','Volume divisor',100000000,1,1000000000)],calc:(b,p)=>({EOM:sma(arr(b,(x,i)=>i&&x.v?((x.h+x.l-b[i-1].h-b[i-1].l)/2)*(x.h-x.l)/(x.v/p.scale):NaN),p.length)})},
  mass:{name:'Mass index',levels:[27],params:[param('smooth','EMA length',9),param('length','Sum length',25)],calc:(b,p)=>{const e=ema(b.map(x=>x.h-x.l),p.smooth);return {Mass:sum(divide(e,ema(e,p.smooth)),p.length)};}},
  ulcer:{name:'Ulcer index',params:[len(14)],calc:(b,p)=>{const c=b.map(x=>x.c),h=extrema(c,p.length),draw=arr(c,(v,i)=>h[i]?((v/h[i]-1)*100)**2:NaN);return {Ulcer:arr(sma(draw,p.length),Math.sqrt)};}},
  histvol:{name:'Historical log-return volatility · annualized',params:[param('length','Length',20,2),param('annualization','Observations / year',252,1,525600)],calc:(b,p)=>{const logs=arr(b,(x,i)=>i&&x.c>0&&b[i-1].c>0?Math.log(x.c/b[i-1].c):NaN);return {Volatility:arr(variance(logs,p.length),v=>100*Math.sqrt(v*p.annualization))};}},
  percentrank:{name:'Percent rank · strictly lower observations',range:[0,100],params:[len(100)],calc:(b,p)=>({Rank:rollingPercentRank(b.map(x=>x.c),p.length,true)})},
  fisher:{name:'Fisher transform',levels:[0],params:[len(9)],calc:(b,p)=>{const c=b.map(x=>(x.h+x.l)/2),h=extrema(c,p.length),l=extrema(c,p.length,false),f=empty(b.length),trigger=empty(b.length);let v=0,last=0;for(let i=p.length-1;i<b.length;i++){v=h[i]===l[i]?0:Math.max(-.999,Math.min(.999,.66*((c[i]-l[i])/(h[i]-l[i])-.5)+.67*v));trigger[i]=last;f[i]=last=.5*Math.log((1+v)/(1-v))+.5*last;}return {Fisher:f,Trigger:trigger};}},
  linregslope:{name:'Linear regression slope',levels:[0],params:[param('length','Length',20,2)],calc:(b,p)=>{const c=b.map(x=>x.c),fit=regression(c,p.length),mean=sma(c,p.length);return {Slope:arr(fit,(v,i)=>(v-mean[i])*2/(p.length-1))};}},
  fractals:{name:'Confirmed fractal levels · no backdating',overlay:true,params:[param('length','Shoulder',2,1,50)],calc:(b,p)=>{let up=NaN,down=NaN;const u=empty(b.length),d=empty(b.length);for(let i=2*p.length;i<b.length;i++){const k=i-p.length;let high=true,low=true;for(let j=k-p.length;j<=i;j++)if(j!==k){high&&=b[k].h>b[j].h;low&&=b[k].l<b[j].l;}if(high)up=b[k].h;if(low)down=b[k].l;u[i]=up;d[i]=down;}return {High:u,Low:d};}},
  relativevolume:{name:'Relative volume',levels:[1],params:[len(20)],calc:(b,p)=>({RVOL:divide(b.map(x=>x.v),sma(b.map(x=>x.v),p.length))})}
 };
 return registry;
}
