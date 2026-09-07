/** Causal geometric scanners. Patterns are rule-based annotations, not predictions.
 * A pivot at i is usable only at i+right. Stable IDs encode source/confirmation
 * indices, and appending future candles cannot rewrite an emitted observation.
 */
const near=(x,y,t)=>Math.abs(x-y)<=t*Math.max(Math.abs(x),Math.abs(y),1e-12);
const between=(x,a,b)=>x>=a&&x<=b;
const body=b=>Math.abs(b.c-b.o),span=b=>b.h-b.l;
export function confirmedPivots(bars,{left=3,right=3}={}) {
  if(!Number.isInteger(left)||!Number.isInteger(right)||left<1||right<1||left>100||right>100)throw new RangeError('Pivot shoulders must be integers in 1..100');
  const out=[];for(let confirmed=left+right;confirmed<bars.length;confirmed++){
    if(bars[confirmed].partial)continue;const i=confirmed-right,b=bars[i];let high=true,low=true;
    for(let j=i-left;j<=confirmed;j++){if(j===i)continue;if(bars[j].partial){high=low=false;break;}if(j<i){high&&=b.h>=bars[j].h;low&&=b.l<=bars[j].l;}else{high&&=b.h>bars[j].h;low&&=b.l<bars[j].l;}}
    // An outside bar can be both extrema; its intrabar ordering is unknown.
    if(high!==low)out.push({index:i,time:b.t,price:high?b.h:b.l,kind:high?'high':'low',confirmedIndex:confirmed,confirmedTime:bars[confirmed].t});
  }return out;
}
export function scanPatterns(bars,{left=3,right=3,tolerance=.025,maxResults=10000,candles=true,geometry=true}={}) {
  if(!Array.isArray(bars)||bars.length>250000||!Number.isFinite(tolerance)||tolerance<=0||tolerance>.25||!Number.isInteger(maxResults)||maxResults<1||maxResults>100000)throw new RangeError('Invalid scanner limits');
  for(let i=0;i<bars.length;i++){const b=bars[i];if(![b.t,b.o,b.h,b.l,b.c].every(Number.isFinite)||b.h<Math.max(b.o,b.c)||b.l>Math.min(b.o,b.c)||b.l>b.h||(i&&b.t<=bars[i-1].t))throw new RangeError('Scanner requires ascending valid raw candles');}
  const out=[],seen=new Set(),emit=(type,direction,start,end,points=[],details={})=>{
    const id=`${type}:${bars[start].t}:${bars[end].t}:${direction}`;if(seen.has(id))return;seen.add(id);
    out.push({id,type,direction,startIndex:start,index:end,time:bars[end].t,price:bars[end].c,points,details,source:'Causal rule-based scanner',predictiveProbability:null});
  };
  if(candles)for(let i=0;i<bars.length;i++){
    const b=bars[i],p=bars[i-1],q=bars[i-2];if(b.partial)continue;const r=span(b),d=body(b),upper=b.h-Math.max(b.o,b.c),lower=Math.min(b.o,b.c)-b.l,bull=b.c>b.o;
    if(r<=0)continue;
    if(d<=r*.1)emit('Doji',0,i,i);
    if(d<=r*.1&&lower>=r*.65&&upper<=r*.15)emit('Dragonfly doji',1,i,i);
    if(d<=r*.1&&upper>=r*.65&&lower<=r*.15)emit('Gravestone doji',-1,i,i);
    if(d>=r*.9)emit('Marubozu',bull?1:-1,i,i);
    if(d>r*.1&&d<=r*.35&&lower>=2*d&&upper<=r*.15)emit('Hammer geometry',1,i,i);
    if(d>r*.1&&d<=r*.35&&upper>=2*d&&lower<=r*.15)emit('Inverted hammer geometry',1,i,i);
    if(!p||p.partial)continue;
    if(bull&&p.c<p.o&&b.o<=p.c&&b.c>=p.o&&d>body(p))emit('Bullish engulfing',1,i-1,i);
    if(!bull&&p.c>p.o&&b.o>=p.c&&b.c<=p.o&&d>body(p))emit('Bearish engulfing',-1,i-1,i);
    if(bull&&p.c<p.o&&b.o>=p.c&&b.c<=p.o&&d<body(p)*.65)emit('Bullish harami',1,i-1,i);
    if(!bull&&p.c>p.o&&b.c>=p.o&&b.o<=p.c&&d<body(p)*.65)emit('Bearish harami',-1,i-1,i);
    if(bull&&p.c<p.o&&b.o<p.c&&b.c>(p.o+p.c)/2&&b.c<p.o)emit('Piercing line',1,i-1,i);
    if(!bull&&p.c>p.o&&b.o>p.c&&b.c<(p.o+p.c)/2&&b.c>p.o)emit('Dark cloud cover',-1,i-1,i);
    if(near(b.l,p.l,tolerance/5)&&bull&&p.c<p.o)emit('Tweezer bottom',1,i-1,i);
    if(near(b.h,p.h,tolerance/5)&&!bull&&p.c>p.o)emit('Tweezer top',-1,i-1,i);
    if(!q||q.partial)continue;
    if(q.c<q.o&&body(p)<body(q)*.3&&bull&&b.c>(q.o+q.c)/2)emit('Morning star geometry',1,i-2,i);
    if(q.c>q.o&&body(p)<body(q)*.3&&!bull&&b.c<(q.o+q.c)/2)emit('Evening star geometry',-1,i-2,i);
    if(q.c>q.o&&p.c>p.o&&bull&&q.c<p.c&&p.c<b.c&&p.o>q.o&&p.o<q.c&&b.o>p.o&&b.o<p.c)emit('Three white soldiers',1,i-2,i);
    if(q.c<q.o&&p.c<p.o&&!bull&&q.c>p.c&&p.c>b.c&&p.o<q.o&&p.o>q.c&&b.o<p.o&&b.o>p.c)emit('Three black crows',-1,i-2,i);
  }
  if(geometry){const pivots=confirmedPivots(bars,{left,right}),chain=[];
    for(const pivot of pivots){
      if(chain.at(-1)?.kind===pivot.kind){if(pivot.kind==='high'?pivot.price>chain.at(-1).price:pivot.price<chain.at(-1).price)chain[chain.length-1]=pivot;else continue;}else chain.push(pivot);
      const add=(name,dir,p,details={})=>emit(name,dir,p[0].index,pivot.confirmedIndex,p.map(x=>({t:x.time,p:x.price})),{...details,classification:'confirmed-pivot candidate; no breakout assumed',pivotDelay:right});
      if(chain.length>=3){const p=chain.slice(-3),[a,b,c]=p;if(near(a.price,c.price,tolerance)&&Math.abs(a.price-b.price)>Math.abs(a.price)*tolerance)add(a.kind==='high'?'Double top':'Double bottom',a.kind==='high'?-1:1,p,{neckline:b.price});}
      if(chain.length>=5){const p=chain.slice(-5),[x,a,b,c,d]=p,dir=x.kind==='high'?-1:1,s=dir<0?1:-1;
        if(near(x.price,b.price,tolerance)&&near(b.price,d.price,tolerance))add(x.kind==='high'?'Triple top':'Triple bottom',dir,p);
        if(s*b.price>s*x.price&&s*b.price>s*d.price&&near(x.price,d.price,tolerance*2)&&near(a.price,c.price,tolerance*2))add(x.kind==='high'?'Head and shoulders':'Inverse head and shoulders',dir,p,{neckline:(a.price+c.price)/2});
        const xa=Math.abs(a.price-x.price),ab=Math.abs(b.price-a.price),bc=Math.abs(c.price-b.price),cd=Math.abs(d.price-c.price),ad=Math.abs(d.price-a.price);
        if(xa&&ab&&bc){const ratios={AB_XA:ab/xa,BC_AB:bc/ab,CD_BC:cd/bc,AD_XA:ad/xa};
          const harmonic=(name,abrange,adrange,cdRange)=>{if(between(ratios.AB_XA,...abrange)&&between(ratios.BC_AB,.382-tolerance,.886+tolerance)&&between(ratios.CD_BC,...cdRange)&&between(ratios.AD_XA,...adrange))add(name,x.kind==='low'?1:-1,p,ratios);};
          harmonic('Gartley',[.618-tolerance,.618+tolerance],[.786-tolerance,.786+tolerance],[1.13,1.70]);
          harmonic('Bat',[.382-tolerance,.5+tolerance],[.886-tolerance,.886+tolerance],[1.618,2.8]);
          harmonic('Butterfly',[.786-tolerance,.786+tolerance],[1.27-tolerance,1.618+tolerance],[1.618,2.8]);
          harmonic('Crab',[.382-tolerance,.618+tolerance],[1.618-tolerance,1.618+tolerance],[2.24,3.7]);
          if(near(ab,cd,tolerance*2))add('AB=CD',x.kind==='low'?1:-1,[a,b,c,d],ratios);
        }
        const highs=p.filter(x=>x.kind==='high'),lows=p.filter(x=>x.kind==='low');
        if(highs.length>=2&&lows.length>=2){const highSlope=(highs.at(-1).price-highs[0].price)/(highs.at(-1).index-highs[0].index),lowSlope=(lows.at(-1).price-lows[0].price)/(lows.at(-1).index-lows[0].index);
          if(highSlope<0&&lowSlope>0)add('Symmetrical triangle',0,p,{highSlope,lowSlope});
          else if(near(highs.at(-1).price,highs[0].price,tolerance)&&lowSlope>0)add('Ascending triangle',1,p);
          else if(near(lows.at(-1).price,lows[0].price,tolerance)&&highSlope<0)add('Descending triangle',-1,p);
          else if(highSlope>0&&lowSlope>highSlope)add('Rising wedge',-1,p);
          else if(lowSlope<0&&highSlope<0&&highSlope<lowSlope)add('Falling wedge',1,p);
        }
      }
      if(chain.length>=6){const p=chain.slice(-6),sign=p[0].kind==='low'?1:-1,v=p.map(x=>x.price*sign),w1=v[1]-v[0],w3=v[3]-v[2],w5=v[5]-v[4];if(v[2]>v[0]&&v[3]>v[1]&&v[4]>v[1]&&v[5]>v[3]&&w3>=Math.min(w1,w5))add('Elliott impulse candidate',sign,p,{wave1:w1,wave3:w3,wave5:w5});}
      if(chain.length>12)chain.splice(0,chain.length-12);
    }
  }
  return out.sort((a,b)=>a.index-b.index||a.id.localeCompare(b.id)).slice(-maxResults);
}
