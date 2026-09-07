import {EXTRA_DRAWING_TOOLS,extraDrawingGeometry} from './drawings-extra.js';
/** Shared geometric construction for rendering AND picking. Coordinates are
 * logical chart pixels; persistent anchors always remain timestamp/price pairs.
 */
export const DRAWING_TOOLS={
  trend:{name:'Trend line',points:2,category:'Lines'},ray:{name:'Ray',points:2,category:'Lines'},extended:{name:'Extended line',points:2,category:'Lines'},arrow:{name:'Arrow',points:2,category:'Lines'},hline:{name:'Horizontal line',points:1,category:'Lines'},vline:{name:'Vertical line',points:1,category:'Lines'},horizontalray:{name:'Horizontal ray',points:1,category:'Lines'},
  channel:{name:'Parallel channel',points:3,category:'Channels'},pitchfork:{name:'Andrews pitchfork',points:3,category:'Channels'},regression:{name:'Regression channel',points:2,category:'Channels'},
  fib:{name:'Fibonacci retracement',points:2,category:'Fibonacci / Gann'},fibextension:{name:'Trend-based Fib extension',points:3,category:'Fibonacci / Gann'},fibfan:{name:'Fibonacci speed fan',points:2,category:'Fibonacci / Gann'},fibtime:{name:'Fibonacci time zones',points:2,category:'Fibonacci / Gann'},fibchannel:{name:'Fibonacci channel',points:3,category:'Fibonacci / Gann'},gannfan:{name:'Gann fan',points:2,category:'Fibonacci / Gann'},fibcircles:{name:'Fibonacci circles',points:2,category:'Fibonacci / Gann'},
  rectangle:{name:'Rectangle',points:2,category:'Shapes'},ellipse:{name:'Ellipse',points:2,category:'Shapes'},triangle:{name:'Triangle',points:3,category:'Shapes'},rotatedrect:{name:'Rotated rectangle',points:3,category:'Shapes'},polyline:{name:'Polyline · double-click ends',points:0,category:'Shapes'},brush:{name:'Brush · drag',points:0,category:'Shapes'},
  longposition:{name:'Long position · entry / stop / target',points:3,category:'Forecast / measure'},shortposition:{name:'Short position · entry / stop / target',points:3,category:'Forecast / measure'},measure:{name:'Price / time range',points:2,category:'Forecast / measure'},dateRange:{name:'Date range',points:2,category:'Forecast / measure'},priceRange:{name:'Price range',points:2,category:'Forecast / measure'},
  text:{name:'Text',points:1,category:'Annotation'},callout:{name:'Callout',points:2,category:'Annotation'},note:{name:'Price note',points:1,category:'Annotation'},buy:{name:'Buy marker',points:1,category:'Annotation'},sell:{name:'Sell marker',points:1,category:'Annotation'},
  xabcd:{name:'XABCD pattern',points:5,category:'Patterns'},elliott:{name:'Elliott impulse',points:6,category:'Patterns'},abc:{name:'Elliott correction',points:4,category:'Patterns'},headshoulders:{name:'Head & shoulders',points:7,category:'Patterns'}
};
Object.assign(DRAWING_TOOLS,EXTRA_DRAWING_TOOLS);
export const LEGACY_DRAWINGS=new Set(['trend','ray','hline','vline','fib','rectangle','text','measure']);
export function drawingGeometry(d,chart){
  const extra=extraDrawingGeometry(d,chart);if(extra)return extra;
  const p=d.points.map(x=>({x:chart.toX(chart.timeIndex(x.t)),y:chart.toY(x.p)})),a=p[0],b=p[1]||a,c=p[2]||b,segments=[],rects=[],labels=[];
  if(!a)return{segments,rects,labels};const line=(a,b,alpha=1)=>segments.push({a,b,alpha}),label=(v,text)=>labels.push({x:v.x,y:v.y,text:String(text)}),extend=(a,b,both=false)=>{const dx=b.x-a.x,dy=b.y-a.y;if(Math.abs(dx)<.001){line({x:a.x,y:both?chart.price.y:a.y},{x:a.x,y:dy>=0?chart.price.y+chart.price.h:chart.price.y});return;}const end=dx>0?chart.plotWidth:0,start=both?(dx>0?0:chart.plotWidth):a.x;line({x:start,y:a.y+(start-a.x)*dy/dx},{x:end,y:a.y+(end-a.x)*dy/dx});};
  const chain=pts=>{for(let i=1;i<pts.length;i++)line(pts[i-1],pts[i]);};
  switch(d.type){
    case'extended':extend(a,b,true);break;
    case'arrow':{line(a,b);const angle=Math.atan2(b.y-a.y,b.x-a.x);for(const offset of[-.45,.45])line(b,{x:b.x-12*Math.cos(angle+offset),y:b.y-12*Math.sin(angle+offset)});break;}
    case'horizontalray':line(a,{x:chart.plotWidth,y:a.y});break;
    case'channel':case'fibchannel':{const dx=b.x-a.x,dy=b.y-a.y,offset=c.y-(a.y+(c.x-a.x)*dy/(dx||1));const ratios=d.type==='channel'?[0,.5,1]:[0,.236,.382,.5,.618,1,1.618];for(const r of ratios){const u={x:a.x,y:a.y+offset*r},v={x:b.x,y:b.y+offset*r};line(u,v,r===.5?.45:1);if(d.type==='fibchannel')label(v,r);}break;}
    case'pitchfork':{const mid={x:(b.x+c.x)/2,y:(b.y+c.y)/2},dx=mid.x-a.x,dy=mid.y-a.y;extend(a,mid);extend(b,{x:b.x+dx,y:b.y+dy});extend(c,{x:c.x+dx,y:c.y+dy});line(b,c,.4);break;}
    case'regression':{const bars=chart.rawBars||chart.bars,t0=Math.min(d.points[0].t,d.points[1].t),t1=Math.max(d.points[0].t,d.points[1].t),data=bars.filter(x=>x.t>=t0&&x.t<=t1);if(data.length<2){line(a,b);break;}const n=data.length;let sx=0,sy=0,sxx=0,sxy=0;for(let i=0;i<n;i++){const x=data[i].t-data[0].t;sx+=x;sy+=data[i].c;sxx+=x*x;sxy+=x*data[i].c;}const slope=(n*sxy-sx*sy)/(n*sxx-sx*sx||1),intercept=(sy-slope*sx)/n;let variance=0;for(let i=0;i<n;i++)variance+=(data[i].c-intercept-slope*(data[i].t-data[0].t))**2;const std=Math.sqrt(variance/n);for(const k of[-2,0,2])line({x:chart.toX(chart.timeIndex(data[0].t)),y:chart.toY(intercept+k*std)},{x:chart.toX(chart.timeIndex(data.at(-1).t)),y:chart.toY(intercept+slope*(data.at(-1).t-data[0].t)+k*std)},k?.6:1);label(a,'Regression ±2σ');break;}
    case'fibextension':{const delta=d.points[1].p-d.points[0].p;for(const r of[0,.618,1,1.272,1.618,2,2.618]){const y=chart.toY(d.points[2].p+delta*r);line({x:a.x,y},{x:c.x+90,y});label({x:c.x+95,y},`${r} · ${(d.points[2].p+delta*r).toPrecision(6)}`);}chain(p);break;}
    case'fibfan':case'gannfan':{const ratios=d.type==='fibfan'?[.236,.382,.5,.618,.786,1]:[.125,.25,.5,1,2,4,8];for(const r of ratios){const end={x:b.x,y:a.y+(b.y-a.y)*r};extend(a,end);label(end,d.type==='gannfan'?`${r}:1`:r);}break;}
    case'fibtime':{const delta=d.points[1].t-d.points[0].t;for(const f of[0,1,2,3,5,8,13,21,34]){const x=chart.toX(chart.timeIndex(d.points[0].t+f*delta));line({x,y:chart.price.y},{x,y:chart.price.y+chart.price.h},.7);label({x:x+3,y:chart.price.y+14},f);}break;}
    case'fibcircles':{for(const f of[.382,.618,1,1.618,2.618]){const rx=(b.x-a.x)*f,ry=(b.y-a.y)*f;let old=null;for(let k=0;k<=64;k++){const q={x:a.x+Math.cos(k/64*2*Math.PI)*rx,y:a.y+Math.sin(k/64*2*Math.PI)*ry};if(old)line(old,q,.7);old=q;}}break;}
    case'ellipse':{const mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2},rx=Math.abs(b.x-a.x)/2,ry=Math.abs(b.y-a.y)/2;let old=null;for(let k=0;k<=64;k++){const q={x:mid.x+Math.cos(k/64*Math.PI*2)*rx,y:mid.y+Math.sin(k/64*Math.PI*2)*ry};if(old)line(old,q);old=q;}break;}
    case'triangle':chain([a,b,c,a]);break;
    case'rotatedrect':{const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1,h=((c.x-b.x)*(-dy)+(c.y-b.y)*dx)/len,ox=-dy/len*h,oy=dx/len*h;chain([a,b,{x:b.x+ox,y:b.y+oy},{x:a.x+ox,y:a.y+oy},a]);break;}
    case'polyline':case'brush':chain(p);break;
    case'longposition':case'shortposition':{const right=Math.max(b.x,c.x,a.x+80),entry=d.points[0].p,stop=d.points[1].p,target=d.points[2].p,dir=d.type==='longposition'?1:-1,risk=(entry-stop)*dir,reward=(target-entry)*dir;rects.push({x:a.x,y:a.y,w:right-a.x,h:b.y-a.y,color:'#ef6470',alpha:.16},{x:a.x,y:a.y,w:right-a.x,h:c.y-a.y,color:'#25bd9c',alpha:.16});for(const v of[a,b,c])line({x:a.x,y:v.y},{x:right,y:v.y});label({x:a.x+7,y:b.y-8},`Stop ${stop.toPrecision(6)} · ${risk>0?(risk/Math.abs(entry)*100).toFixed(2)+'%':'invalid side'}`);label({x:a.x+7,y:c.y-8},`Target ${target.toPrecision(6)} · R/R ${risk>0&&reward>0?(reward/risk).toFixed(2):'invalid'}`);label({x:a.x+7,y:a.y-8},`${dir>0?'LONG':'SHORT'} ${entry.toPrecision(6)}${d.quantity?' · risk '+(Math.abs(risk)*d.quantity).toFixed(2):''}`);break;}
    case'dateRange':case'priceRange':{const v=d.type==='dateRange'?{x:b.x,y:a.y}:{x:a.x,y:b.y};line(a,v);for(const q of[a,v])line({x:q.x-4,y:q.y-4},{x:q.x+4,y:q.y+4});const text=d.type==='dateRange'?`${(Math.abs(d.points[1].t-d.points[0].t)/3600).toFixed(2)} hours`:`${(d.points[1].p-d.points[0].p).toPrecision(6)} · ${((d.points[1].p/d.points[0].p-1)*100).toFixed(2)}%`;label({x:(a.x+v.x)/2,y:(a.y+v.y)/2-12},text);break;}
    case'callout':line(a,b);label({x:b.x+8,y:b.y-5},d.text||'Callout');break;
    case'note':label(a,d.points[0].p.toPrecision(7));break;
    case'buy':case'sell':label(a,d.type==='buy'?'▲ BUY':'▼ SELL');break;
    case'xabcd':case'elliott':case'abc':case'headshoulders':{chain(p);const text=d.type==='xabcd'?['X','A','B','C','D']:d.type==='elliott'?['0','1','2','3','4','5']:d.type==='abc'?['0','A','B','C']:['0','LS','1','HEAD','2','RS','3'];p.forEach((v,i)=>label({x:v.x,y:v.y+(i%2?-12:15)},text[i]||i));break;}
  }
  return{segments,rects,labels};
}
export function validateDrawing(d){
  const def=DRAWING_TOOLS[d?.type];if(!def||typeof d.id!=='string'||d.id.length>128||!Array.isArray(d.points))throw new Error('Invalid drawing.');
  if(def.points?d.points.length!==def.points:d.points.length<2||d.points.length>4000)throw new Error('Invalid anchor count.');
  for(const p of d.points)if(!Number.isFinite(p.t)||p.t<0||p.t>8e12||!Number.isFinite(p.p))throw new Error('Invalid drawing anchor.');
  if(d.color!=null&&!/^#[a-f\d]{6}$/i.test(d.color))throw new Error('Invalid drawing color.');
  if(d.width!=null&&(!Number.isFinite(d.width)||d.width<.5||d.width>10))throw new Error('Invalid drawing width.');
  if(d.text!=null&&(typeof d.text!=='string'||d.text.length>500))throw new Error('Invalid drawing text.');
  if(d.group!=null&&(typeof d.group!=='string'||d.group.length>128))throw new Error('Invalid drawing group.');
  if(d.quantity!=null&&(!Number.isFinite(d.quantity)||d.quantity<0))throw new Error('Invalid position quantity.');
  return d;
}
