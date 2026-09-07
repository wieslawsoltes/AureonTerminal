import test from 'node:test';
import assert from 'node:assert/strict';
import {RollingMoments,OrderStatisticsTree,RollingOrderStatistics,rollingMoments,rollingPairs,rollingQuantiles,rollingRegression,rollingPercentRank} from '../src/rolling-statistics.js';
import {weightedSessionBands} from '../src/studies-statistics.js';
const near=(a,b,tolerance=2e-10)=>assert.ok(Number.isNaN(a)&&Number.isNaN(b)||Math.abs(a-b)<=tolerance*Math.max(1,Math.abs(a),Math.abs(b)),`${a} != ${b}`);
function reference(a,b=a,sample=false){
  if(a.some(x=>!Number.isFinite(x))||b.some(x=>!Number.isFinite(x)))return{mean:NaN,meanY:NaN,variance:NaN,varianceY:NaN,covariance:NaN,correlation:NaN};
  const x=a.map(v=>v-a[0]),y=b.map(v=>v-b[0]),mx=x.reduce((s,v)=>s+v,0)/a.length,my=y.reduce((s,v)=>s+v,0)/a.length;
  const xx=x.reduce((s,v)=>s+(v-mx)**2,0),yy=y.reduce((s,v)=>s+(v-my)**2,0),xy=x.reduce((s,v,i)=>s+(v-mx)*(y[i]-my),0),n=a.length-Number(sample);
  return {mean:a[0]+mx,meanY:b[0]+my,variance:n>0?xx/n:NaN,varianceY:n>0?yy/n:NaN,covariance:n>0?xy/n:NaN,correlation:xx&&yy?(xy/Math.sqrt(xx))/Math.sqrt(yy):NaN};
}
function invariant(node){
  if(!node)return {height:0,size:0,min:Infinity,max:-Infinity};
  const l=invariant(node.left),r=invariant(node.right);assert.ok(l.max<node.value&&r.min>node.value);assert.ok(Math.abs(l.height-r.height)<=1);
  assert.equal(node.height,1+Math.max(l.height,r.height));assert.equal(node.size,node.count+l.size+r.size);assert.ok(node.count>0);
  return{height:node.height,size:node.size,min:Math.min(l.min,node.value),max:Math.max(r.max,node.value)};
}
for(const n of[1,2,7,31,100])test('Centered moment tree matches two-pass windows, period '+n,()=>{
  const a=Array.from({length:450},(_,i)=>1e12+Math.sin(i*.27)/100),b=a.map((x,i)=>-3e12+(x-1e12)*2+Math.cos(i*.13)/300),window=new RollingMoments(n);
  a[105]=NaN;b[208]=NaN;
  for(let i=0;i<a.length;i++){
    const r=window.push(a[i],b[i]).snapshot(true);
    if(i<n-1){assert.ok(!r.ready);assert.ok(Number.isNaN(r.mean));continue;}
    const expected=reference(a.slice(i-n+1,i+1),b.slice(i-n+1,i+1),true);
    for(const k of Object.keys(expected))near(r[k],expected[k],k==='mean'||k==='meanY'?1e-15:2e-10);
  }
});
test('Moment tree recovers after a huge price step and exact flat window',()=>{
  const w=new RollingMoments(10);for(let i=0;i<10;i++)w.push(1e12+i);for(let i=0;i<10;i++)w.push(3);
  assert.equal(w.snapshot().mean,3);assert.equal(w.snapshot().variance,0);assert.ok(Number.isNaN(w.snapshot().correlation));
});
test('Moment tree invalidates pairs together and corrects sample denominator',()=>{
 const w=new RollingMoments(2);w.push(1,2).push(3,6);near(w.snapshot().variance,1);near(w.snapshot(true).variance,2);near(w.snapshot().covariance,2);
 w.push(NaN,4);assert.equal(w.snapshot().ready,false);w.push(2,4).push(4,8);near(w.snapshot().correlation,1);
 assert.throws(()=>w.snapshot(1),/boolean/);
});
test('AVL order statistic tree preserves duplicate counts and deletion invariants',()=>{
 const t=new OrderStatisticsTree(),sorted=[];let seed=24;const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%97;};
 for(let i=0;i<2000;i++){
  const v=next();if(i%3||!sorted.length){t.add(v);sorted.push(v);sorted.sort((a,b)=>a-b);}else{const k=next()%sorted.length;assert.equal(t.remove(sorted[k]),true);sorted.splice(k,1);}
  invariant(t.root);assert.equal(t.size,sorted.length);
  for(const q of[0,.1,.25,.5,.75,.9,1]){const h=(sorted.length-1)*q,k=Math.floor(h),f=h-k;near(t.quantile(q),sorted[k]*(1-f)+(sorted[Math.min(k+1,sorted.length-1)])*f);near(t.quantile(q,'nearest'),sorted[Math.max(0,Math.ceil(sorted.length*q)-1)]);}
  assert.equal(t.lessThan(v),sorted.filter(x=>x<v).length);assert.equal(t.lessThan(v,true),sorted.filter(x=>x<=v).length);
 }
 for(const v of sorted)assert.ok(t.remove(v));assert.equal(t.size,0);assert.equal(t.remove(5),false);assert.ok(Number.isNaN(t.quantile(.5)));
});
test('AVL sequential adversarial keys stay height bounded',()=>{
 const t=new OrderStatisticsTree();for(let i=0;i<10000;i++)t.add(i);invariant(t.root);assert.ok(t.root.height<20);for(let i=0;i<10000;i+=2)t.remove(i);invariant(t.root);assert.equal(t.at(0),1);assert.equal(t.at(t.size-1),9999);
});
test('Quantile interpolation is finite across opposite maximum magnitudes',()=>{
 const t=new OrderStatisticsTree().add(-Number.MAX_VALUE).add(Number.MAX_VALUE);assert.equal(t.quantile(.5),0);assert.ok(Number.isFinite(t.quantile(.75)));assert.throws(()=>t.at(2));assert.throws(()=>t.add(NaN));assert.throws(()=>t.quantile(-.1));assert.throws(()=>t.quantile(.5,'invented'));
});
for(const period of[1,2,5,32])test('Rolling quantiles and strict rank match sorted windows with gaps '+period,()=>{
 const a=Array.from({length:175},(_,i)=>i%17===0?NaN:(i*7)%11),[lower,median,upper]=rollingQuantiles(a,period,[.1,.5,.9]),rank=rollingPercentRank(a,period);
 for(let i=0;i<a.length;i++){
  const window=a.slice(Math.max(0,i-period+1),i+1),sorted=[...window].sort((a,b)=>a-b);
  for(const[q,actual]of[[.1,lower[i]],[.5,median[i]],[.9,upper[i]]]){if(i<period-1||sorted.some(x=>!Number.isFinite(x))){assert.ok(Number.isNaN(actual));continue;}const h=(period-1)*q,k=Math.floor(h);near(actual,sorted[k]*(1-h+k)+sorted[Math.min(k+1,period-1)]*(h-k));}
  const previous=a.slice(i-period,i);near(rank[i],i>=period&&Number.isFinite(a[i])&&previous.every(Number.isFinite)?100*previous.filter(v=>v<a[i]).length/period:NaN);
 }
});
test('Rolling statistics reject invalid windows and preserve input arrays',()=>{
 for(const n of[0,-1,2.2,NaN,10001]){assert.throws(()=>new RollingMoments(n));assert.throws(()=>new RollingOrderStatistics(n));}
 const a=[1,2,3],original=[...a];rollingMoments(a,2);rollingPairs(a,a,2);rollingQuantiles(a,2);assert.deepEqual(a,original);assert.throws(()=>rollingPairs(a,[1],2));assert.throws(()=>rollingQuantiles(a,2,[]));
});
test('Regression fit/slope/errors remain stable on large-price small-slope data',()=>{
 const a=Array.from({length:150},(_,i)=>1e12+i*.125),r=rollingRegression(a,20);
 for(let i=19;i<a.length;i++){near(r.fit[i],a[i],1e-15);near(r.slope[i],.125);near(r.r2[i],1);near(r.error[i],0,2e-6);}
 const flat=rollingRegression([2,2,2,2],3);assert.equal(flat.r2.at(-1),1);assert.equal(flat.error.at(-1),0);
});
test('Weighted session bands ignore empty volume, use volume moments, and reset UTC bucket',()=>{
 const bar=(t,c,v)=>({t,o:c,h:c,l:c,c,v}),b=[bar(0,1,0),bar(1,10,1),bar(2,20,3),bar(3,999,0),bar(86400,100,0),bar(86401,50,2)];
 const r=weightedSessionBands(b,86400,2);assert.ok(Number.isNaN(r.VWAP[0]));near(r.VWAP[2],17.5);near(r.Upper[2],17.5+2*Math.sqrt(18.75));near(r.VWAP[3],17.5);assert.ok(Number.isNaN(r.VWAP[4]));assert.equal(r.VWAP[5],50);assert.equal(r.Upper[5],50);assert.throws(()=>weightedSessionBands([bar(0,1,-1)]));
});

import {runScript} from '../src/script.js';
const barsFor=a=>a.map((c,i)=>({t:i*60,o:c*2,h:c*2+1,l:c-1,c,v:1}));
test('Named rolling language kernels use the same full-window statistics',()=>{
 const r=runScript(`plot(ta.median(length=3,source=close),'Median')
plot(ta.percentile_linear_interpolation(close,3,25),'Quantile')
plot(ta.percentile_nearest_rank(close,3,25),'Nearest')
plot(ta.variance(close,3),'Variance')
plot(ta.covariance(source1=close,source2=open,length=3,biased=false),'Covariance')
plot(ta.correlation(close,open,3),'Correlation')`,barsFor([1,2,3,4,5]));
 for(const [j,v]of[4,3.5,3,2/3,2,1].entries())near(r.plots[j].values.at(-1),v);
 for(const p of r.plots){assert.ok(Number.isNaN(p.values[0]));assert.ok(Number.isNaN(p.values[1]));}
});
test('Rolling language call sites inside user functions retain isolated state',()=>{
 const r=runScript('f(x) => ta.median(x,3)\nplot(f(close))\nplot(f(open))',barsFor([1,2,3,4,5]));assert.equal(r.plots[0].values.at(-1),4);assert.equal(r.plots[1].values.at(-1),8);
});
test('Rolling language validates fixed parameters, excess arguments and heap budgets',()=>{
 const b=barsFor([1,2,3,4,5]);
 for(const s of['plot(ta.median(close,0))','plot(ta.median(close,bar_index+1))','plot(ta.percentile_nearest_rank(close,3,101))','plot(ta.variance(close,3,1))','plot(ta.median(close,3,4))'])assert.throws(()=>runScript(s,b),s);
 assert.throws(()=>runScript('plot(ta.median(close,3))',b,{maxCollectionElements:10}),/memory budget/);
 assert.ok(runScript('plot(ta.median(close,10000))',b).plots[0].values.every(Number.isNaN));
});
test('Rolling language consumes bounded deterministic operations and exposes no futures',()=>{
 const b=barsFor(Array.from({length:100},(_,i)=>100+Math.sin(i))),source='plot(ta.variance(close,20,false))\nplot(ta.percentile_linear_interpolation(close,20,75))';
 const full=runScript(source,b),prefix=runScript(source,b.slice(0,43));
 for(let j=0;j<full.plots.length;j++)for(let i=0;i<43;i++)near(prefix.plots[j].values[i],full.plots[j].values[i]);
 assert.throws(()=>runScript(source,b,{maxOperations:100}),/Operation budget/);
});
