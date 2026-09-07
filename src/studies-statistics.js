/** Distribution and regression studies share the same bounded rolling kernels. */
import {rollingPairs,rollingQuantiles,rollingRegression} from './rolling-statistics.js';
import {sma} from './indicators.js';
const array = (values, fn) => Float64Array.from(values, fn);
const param = (key, label, value, min=1, max=10000, step=1) => ({key,label,default:value,min,max,step});
const length = (n=20) => param('length','Window',n);
const close = bars => bars.map(b => b.c);
const returns = bars => array(bars,(b,i) => i && b.c>0 && bars[i-1].c>0 ? Math.log(b.c/bars[i-1].c) : NaN);
export function weightedSessionBands(bars, seconds=86400, multiplier=2) {
  if (!Number.isInteger(seconds)||seconds<60||seconds>604800||!Number.isFinite(multiplier)||multiplier<0||multiplier>10) throw new RangeError('Invalid weighted-session parameters');
  const mid=new Float64Array(bars.length).fill(NaN),upper=mid.slice(),lower=mid.slice();
  let session,weight=0,anchor=0,mean=0,variance=0;
  for(let i=0;i<bars.length;i++) {
    const b=bars[i],bucket=Math.floor(b.t/seconds),price=b.h/3+b.l/3+b.c/3;
    if(bucket!==session){session=bucket;weight=0;anchor=price;mean=0;variance=0;}
    if(!Number.isFinite(b.t)||i>0&&b.t<=bars[i-1].t||!Number.isFinite(price)||!Number.isFinite(b.v)||b.v<0)throw new RangeError('Weighted session needs finite nonnegative observations');
    if(b.v>0){if(weight===0)anchor=price;const next=weight+b.v;if(!Number.isFinite(next))throw new RangeError('Session weight overflow');const value=price-anchor,delta=value-mean,alpha=b.v/next,between=delta*Math.sqrt(alpha)*Math.sqrt(1-alpha);mean+=delta*alpha;variance=(1-alpha)*variance+between*between;if(!Number.isFinite(variance)||!Number.isFinite(mean))throw new RangeError('Session moment overflow');weight=next;}
    if(weight>0){const deviation=multiplier*Math.sqrt(variance);mid[i]=anchor+mean;upper[i]=mid[i]+deviation;lower[i]=mid[i]-deviation;}
  }
  return {VWAP:mid,Upper:upper,Lower:lower};
}
export function createStatisticalStudies() {
  return {
    median:{name:'Rolling median',overlay:true,params:[length()],calc:(b,p)=>({Median:rollingQuantiles(close(b),p.length,[.5])[0]})},
    quantilechannel:{name:'Quantile channel · linear interpolation',overlay:true,params:[length(50),param('lower','Lower quantile',.1,0,.49,.01),param('upper','Upper quantile',.9,.51,1,.01)],calc:(b,p)=>{const [lo,med,hi]=rollingQuantiles(close(b),p.length,[p.lower,.5,p.upper]);return {Median:med,Upper:hi,Lower:lo};}},
    interquartile:{name:'Interquartile range',params:[length(50)],calc:(b,p)=>{const [lo,hi]=rollingQuantiles(close(b),p.length,[.25,.75]);return {IQR:array(hi,(v,i)=>v-lo[i])};}},
    quartiledeviation:{name:'Median deviation · IQR units',levels:[0],params:[length(50)],calc:(b,p)=>{const [lo,med,hi]=rollingQuantiles(close(b),p.length,[.25,.5,.75]);return {Deviation:array(b,(x,i)=>hi[i]>lo[i]?(x.c-med[i])/(hi[i]-lo[i]):NaN)};}},
    regressionchannel:{name:'Regression channel · residual RMS',overlay:true,params:[param('length','Window',50,2),param('mult','Residual RMS multiple',2,0,10,.1)],calc:(b,p)=>{const r=rollingRegression(close(b),p.length);return {Fit:r.fit,Upper:array(r.fit,(x,i)=>x+p.mult*r.error[i]),Lower:array(r.fit,(x,i)=>x-p.mult*r.error[i])};}},
    regressionr2:{name:'Regression explained fraction · R²',range:[0,1],params:[param('length','Window',50,2)],calc:(b,p)=>({R2:rollingRegression(close(b),p.length).r2})},
    regressionerror:{name:'Regression residual RMS',params:[param('length','Window',50,2)],calc:(b,p)=>({RMS:rollingRegression(close(b),p.length).error})},
    returnautocorrelation:{name:'Log-return autocorrelation',range:[-1,1],levels:[0],params:[param('length','Paired window',50,2),param('lag','Lag bars',1,1,1000)],calc:(b,p)=>{const r=returns(b),lag=array(r,(_,i)=>i>=p.lag?r[i-p.lag]:NaN);return {Correlation:rollingPairs(r,lag,p.length).correlation};}},
    pricevolumecorrelation:{name:'Return / volume-change correlation',range:[-1,1],levels:[0],params:[param('length','Paired window',50,2)],calc:(b,p)=>({Correlation:rollingPairs(returns(b),array(b,(x,i)=>i&&x.v>0&&b[i-1].v>0?Math.log(x.v/b[i-1].v):NaN),p.length).correlation})},
    efficiency:{name:'Directional efficiency ratio',range:[0,1],params:[length()],calc:(b,p)=>{const changes=array(b,(x,i)=>i?Math.abs(x.c-b[i-1].c):NaN),noise=sma(changes,p.length);return {Efficiency:array(b,(x,i)=>i>=p.length&&Number.isFinite(noise[i])?noise[i]?Math.abs(x.c-b[i-p.length].c)/(p.length*noise[i]):0:NaN)};}},
    vwapbands:{name:'UTC session VWAP deviation bands',overlay:true,params:[param('seconds','UTC bucket seconds',86400,60,604800),param('mult','Weighted deviation multiple',2,0,10,.1)],calc:(b,p)=>weightedSessionBands(b,p.seconds,p.mult)}
  };
}
