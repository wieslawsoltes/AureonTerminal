/** Derived charts never replace the market OHLCV used for execution.
 * Non-time charts are deterministic close-only constructions. Each item carries
 * sourceIndex/sourceTime; multiple bricks from one close share that timestamp.
 */
export const CHART_TYPES = Object.freeze({
  candles:'Candles', hollow:'Hollow candles', bars:'OHLC bars', line:'Line', area:'Area',
  heikin:'Heikin-Ashi', step:'Step line', baseline:'Baseline', columns:'Columns',
  hlc:'High–low–close', renko:'Renko · close-derived', linebreak:'Line break',
  kagi:'Kagi · close-derived', pnf:'Point & figure', range:'Range · close-derived'
});
export const NON_TIME_TYPES = new Set(['renko','linebreak','kagi','pnf','range']);
const limit = (out, n=100000) => { if (out.length >= n) throw new Error('Derived chart exceeds 100,000 elements. Increase the box size.'); };
function size(value) { if (!Number.isFinite(value) || value <= 0) throw new Error('Box/reversal size must be positive and finite.'); return value; }
function item(b, index, open, close, volume=0, extra={}) {
  return {t:b.t, o:open, h:Math.max(open,close), l:Math.min(open,close), c:close, v:volume,
    sourceTime:b.t, sourceIndex:index, synthetic:true, ...extra};
}
export function renko(bars, box=1, {reversal=2,maxElements=100000}={}) {
  size(box); if (![1,2].includes(reversal)) throw new Error('Renko reversal must be one or two boxes.');
  if (!bars.length) return [];
  const out=[]; let last=Math.floor(bars[0].c/box)*box, direction=0, volume=bars[0].v;
  for (let i=1; i<bars.length; i++) {
    const b=bars[i]; volume+=b.v; let delta=b.c-last;
    let dir=Math.sign(delta), steps=Math.floor((Math.abs(delta)+box*1e-10)/box);
    const flip=direction && dir!==direction;
    if (steps<(flip?reversal:1)) continue;
    if (flip && reversal===2) { last+=dir*box; steps--; }
    if (out.length+steps>maxElements) throw new Error('Derived chart capacity exceeded; increase box size.');
    const v=volume/steps;
    for (let k=0;k<steps;k++) { limit(out,maxElements); const next=last+dir*box;out.push(item(b,i,last,next,v,{direction:dir}));last=next; }
    direction=dir; volume=0;
  }
  return out;
}
export function rangeBars(bars, box=1) { return renko(bars,box,{reversal:1}); }
export function lineBreak(bars, lines=3) {
  if (!Number.isInteger(lines)||lines<1||lines>100) throw new Error('Line-break count must be 1–100.');
  if (bars.length<2) return [];
  const out=[]; let last=bars[0].c, volume=bars[0].v;
  for (let i=1;i<bars.length;i++) {
    const b=bars[i];volume+=b.v;if (b.c===last) continue;
    const dir=Math.sign(b.c-last),prev=out.at(-1),recent=out.slice(-lines);
    const continuation=!prev || dir===Math.sign(prev.c-prev.o);
    const breaks=dir>0?recent.every(x=>b.c>x.h):recent.every(x=>b.c<x.l);
    if (continuation || breaks) { limit(out);const open=continuation?last:prev.o;out.push(item(b,i,open,b.c,volume));last=b.c;volume=0; }
  }
  return out;
}
export function kagi(bars, reversal=1) {
  size(reversal);if(!bars.length)return [];
  const out=[];let start=bars[0].c,extreme=start,direction=0,vol=bars[0].v;
  let shoulder=Infinity,waist=-Infinity,thick=false,lastIndex=0;
  for(let i=1;i<bars.length;i++) {
    const p=bars[i].c;vol+=bars[i].v;
    if(!direction){if(Math.abs(p-start)<reversal)continue;direction=Math.sign(p-start);extreme=p;lastIndex=i;continue;}
    if((p-extreme)*direction>=0){extreme=p;lastIndex=i;if(p>shoulder)thick=true;if(p<waist)thick=false;continue;}
    if((extreme-p)*direction<reversal)continue;
    limit(out);out.push(item(bars[lastIndex],lastIndex,start,extreme,vol-bars[i].v,{direction,thick}));
    if(direction>0)shoulder=extreme;else waist=extreme;
    start=extreme;extreme=p;direction=-direction;lastIndex=i;vol=bars[i].v;
    if(p>shoulder)thick=true;if(p<waist)thick=false;
  }
  if(direction)out.push(item(bars[lastIndex],lastIndex,start,extreme,vol,{direction,thick,partial:true}));
  return out;
}
export function pointFigure(bars,box=1,reversal=3) {
  size(box);if(!Number.isInteger(reversal)||reversal<1||reversal>20)throw new Error('PnF reversal must be 1–20 boxes.');
  if(!bars.length)return [];
  const out=[];let level=Math.floor(bars[0].c/box),dir=0,current=null,volume=bars[0].v;
  const emit=(b,i,first,last)=>{limit(out);current=item(b,i,first*box,last*box,volume,{direction:dir,box,firstBox:first,lastBox:last});out.push(current);volume=0;};
  for(let i=1;i<bars.length;i++){
    const b=bars[i];volume+=b.v;const up=Math.floor((b.c+box*1e-10)/box),down=Math.ceil((b.c-box*1e-10)/box);
    if(!dir){if(up>level){dir=1;emit(b,i,level+1,up);level=up;}else if(down<level){dir=-1;emit(b,i,level-1,down);level=down;}continue;}
    const target=dir>0?up:down;
    if((target-level)*dir>0){level=target;current.c=level*box;current.h=Math.max(current.o,current.c);current.l=Math.min(current.o,current.c);current.lastBox=level;current.t=b.t;current.sourceTime=b.t;current.sourceIndex=i;current.v+=volume;volume=0;}
    else if(dir>0&&level-down>=reversal){dir=-1;emit(b,i,level-1,down);level=down;}
    else if(dir<0&&up-level>=reversal){dir=1;emit(b,i,level+1,up);level=up;}
  }
  return out;
}
export function deriveChart(bars,type,options={}) {
  const box=options.box ?? (Math.max(Math.abs(bars[0]?.c||1)*.002,1e-8));
  switch(type){case'renko':return renko(bars,box);case'range':return rangeBars(bars,box);case'linebreak':return lineBreak(bars,options.lines??3);case'kagi':return kagi(bars,box);case'pnf':return pointFigure(bars,box,options.reversal??3);default:return bars;}
}
/** Projection preserves causality: every plotted value is from its source bar. */
export function projectValues(values,derived) {
  if(ArrayBuffer.isView(values)||Array.isArray(values))return Float64Array.from(derived,b=>values[b.sourceIndex]);
  if(values&&typeof values==='object')return Object.fromEntries(Object.entries(values).map(([k,v])=>[k,projectValues(v,derived)]));
  return values;
}
