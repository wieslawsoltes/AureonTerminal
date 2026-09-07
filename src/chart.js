import {Renderer,Geometry,rgba} from './renderer.js';
import {clamp,lowerBound,niceStep,segmentDistance,heikinAshi,uid} from './core.js';
const palette={dark:{bg:'#101419',panel:'#14191f',grid:'#222831',text:'#8792a2',bright:'#d9e1eb',up:'#25bd9c',down:'#ef6470',accent:'#578bfa'},light:{bg:'#ffffff',panel:'#f5f7fb',grid:'#e8ecf2',text:'#708094',bright:'#263344',up:'#109e82',down:'#d84858',accent:'#366ed8'}};
export const INDICATOR_INFO={ema:{label:'EMA 20',color:'#efb466',pane:'price'},sma:{label:'SMA 50',color:'#6495ed',pane:'price'},bb:{label:'Bollinger 20 · 2',color:'#9777df',pane:'price'},vwap:{label:'VWAP · UTC session',color:'#e281b4',pane:'price'},rsi:{label:'RSI 14',color:'#b698ed',pane:'rsi'},macd:{label:'MACD 12 26 9',color:'#669cf5',pane:'macd'},atr:{label:'ATR 14',color:'#eab96a',pane:'atr'},stoch:{label:'Stochastic 14 3',color:'#61c7ca',pane:'stoch'},obv:{label:'OBV',color:'#84adfa',pane:'obv'}};
export function formatPrice(p,digits){if(!Number.isFinite(p))return '—';const d=digits??(Math.abs(p)>=1000?2:Math.abs(p)>=1?2:Math.abs(p)>=.01?4:6);return p.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});}
export function compact(n){return Number.isFinite(n)?new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:2}).format(n):'—';}
function clippedLine(g,x1,y1,x2,y2,c,w,box){
  if(![x1,y1,x2,y2].every(Number.isFinite))return;
  let t0=0,t1=1;const dx=x2-x1,dy=y2-y1,p=[-dx,dx,-dy,dy],q=[x1-box.x,box.x+box.w-x1,y1-box.y,box.y+box.h-y1];
  for(let i=0;i<4;i++){if(p[i]===0){if(q[i]<0)return;}else{const t=q[i]/p[i];if(p[i]<0)t0=Math.max(t0,t);else t1=Math.min(t1,t);if(t0>t1)return;}}
  g.line(x1+t0*dx,y1+t0*dy,x1+t1*dx,y1+t1*dy,c,w);
}
export class Chart {
  constructor(host,options={}){
    this.host=host;this.options=options;this.symbol=options.symbol||'BTC-USD';this.interval=options.interval||3600;this.style='candles';this.scale='linear';this.theme='dark';this.bars=[];this.indicators={};this.enabled=['ema','sma','rsi'];this.drawings=[];this.selected=null;this.tool='cursor';this.snap=false;this.drawingsVisible=true;this.locked=false;
    this.count=140;this.right=148;this.manualRange=null;this.cross=null;this.pointer=null;this.pending=null;this.dirty=true;this.raf=0;this.endLimit=null;this.markers=[];this.frameMs=0;
    host.innerHTML='<canvas class="chart-gpu" aria-hidden="true"></canvas><canvas class="chart-fallback" aria-hidden="true"></canvas><canvas class="chart-overlay" tabindex="0" role="img" aria-label="Interactive price chart. Drag to pan, scroll to zoom. Home resets the view."></canvas><div class="chart-watermark" aria-hidden="true"></div><div class="chart-empty">Loading market data…</div>';
    this.gpu=host.querySelector('.chart-gpu');this.fallback=host.querySelector('.chart-fallback');this.canvas=host.querySelector('.chart-overlay');this.ctx=this.canvas.getContext('2d');this.empty=host.querySelector('.chart-empty');this.watermark=host.querySelector('.chart-watermark');
    this.renderer=new Renderer(this.gpu,this.fallback,mode=>{options.onMode?.(mode);this.invalidate();});this.geometry=new Geometry();this.events=new AbortController();
    const on=(target,event,fn,extra={})=>target.addEventListener(event,fn,{signal:this.events.signal,...extra});
    on(this.canvas,'pointerdown',e=>this.down(e));on(this.canvas,'pointermove',e=>this.move(e));on(this.canvas,'pointerup',e=>this.up(e));on(this.canvas,'pointercancel',e=>this.cancel(e));
    on(this.canvas,'pointerleave',()=>{if(!this.pointer){this.cross=null;this.invalidate(false);}});
    on(this.canvas,'wheel',e=>this.wheel(e),{passive:false});on(this.canvas,'dblclick',()=>this.fit());
    on(this.canvas,'contextmenu',e=>{e.preventDefault();const p=this.point(e);options.onContext?.({x:e.clientX,y:e.clientY,price:this.toPrice(p.y),time:this.toTime(this.toIndex(p.x))});});
    on(this.canvas,'keydown',e=>{if(e.key==='Home'){e.preventDefault();this.fit();}if(e.key==='Escape'){this.pending=null;this.selected=null;this.setTool('cursor');this.invalidate();}});
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(host);this.resize();
  }
  get length(){return Math.min(this.bars.length,this.endLimit??Infinity);}
  setData(bars,indicators=this.indicators,{reset=false}={}){const oldLength=this.dataLength??this.length,oldFirst=this.firstTime??this.bars[0]?.t,following=this.right>=oldLength-3;this.bars=bars;this.indicators=indicators;this.ha=null;
    if(reset){this.right=this.length+6;this.count=Math.min(140,Math.max(30,this.length+12));this.manualRange=null;}
    else if(oldFirst!=null&&bars[0]?.t<oldFirst){this.right+=lowerBound(bars,oldFirst);}
    else if(following)this.right+=this.length-oldLength;
    this.dataLength=this.length;this.firstTime=this.bars[0]?.t;this.empty.hidden=Boolean(this.length);this.watermark.textContent=this.symbol.replace('-',' / ');this.invalidate();
  }
  setIndicators(data){this.indicators=data;this.invalidate();}
  setTool(tool){this.tool=tool;this.pending=null;this.canvas.style.cursor=tool==='cursor'?'crosshair':'crosshair';this.options.onTool?.(tool);this.invalidate();}
  setReplay(end){this.endLimit=end;if(end!=null)this.right=end+4;this.manualRange=null;this.invalidate();}
  resize(){const r=this.host.getBoundingClientRect();this.width=Math.max(1,r.width);this.height=Math.max(1,r.height);this.dpr=Math.min(devicePixelRatio||1,3);this.renderer.resize(this.width,this.height,this.dpr);this.canvas.width=Math.max(1,Math.round(this.width*this.dpr));this.canvas.height=Math.max(1,Math.round(this.height*this.dpr));this.ctx.setTransform(this.dpr,0,0,this.dpr,0,0);this.invalidate();}
  fit(){this.count=Math.min(150,Math.max(30,this.length+10));this.right=this.length+6;this.manualRange=null;this.invalidate();this.emitView();}
  fitAll(){this.count=Math.max(30,this.length+10);this.right=this.length+5;this.manualRange=null;this.invalidate();this.emitView();}
  zoom(factor,anchor=.5){const old=this.count;this.count=clamp(this.count*factor,15,Math.max(50,this.length*1.6));this.right+=(this.count-old)*(1-anchor);this.constrain();this.invalidate();this.emitView();}
  constrain(){this.right=clamp(this.right,this.count*.15,Math.max(this.count*.2,this.length+this.count*.8));}
  emitView(){this.options.onView?.({rightTime:this.toTime(this.right),span:this.count*this.interval});if(this.right-this.count<20&&this.length)this.options.onNeedMore?.();}
  syncView(v){this.right=this.timeIndex(v.rightTime);this.count=clamp(v.span/this.interval,15,Math.max(50,this.length*1.6));this.constrain();this.invalidate();}
  toX(i){return (i-(this.right-this.count)+.5)*this.step;}
  toIndex(x){return x/this.step+(this.right-this.count)-.5;}
  toTime(i){if(!this.length)return 0;const k=Math.floor(i),a=this.bars[clamp(k,0,this.length-1)];if(k<0)return this.bars[0].t+i*this.interval;if(k>=this.length-1)return this.bars[this.length-1].t+(i-this.length+1)*this.interval;return a.t+(this.bars[k+1].t-a.t)*(i-k);}
  timeIndex(t){const ix=lowerBound(this.bars,t);if(!this.bars.length)return 0;if(ix===0)return (t-this.bars[0].t)/this.interval;if(ix>=this.bars.length)return this.bars.length-1+(t-this.bars.at(-1).t)/this.interval;const a=this.bars[ix-1],b=this.bars[ix];return ix-1+(t-a.t)/(b.t-a.t);}
  transform(p){return this.effectiveLog?Math.log(Math.max(1e-12,p)):p;}
  untransform(p){return this.effectiveLog?Math.exp(p):p;}
  toY(p){return this.price.y+(this.max-this.transform(p))/(this.max-this.min)*this.price.h;}
  toPrice(y){return this.untransform(this.max-(y-this.price.y)/this.price.h*(this.max-this.min));}
  point(e){const r=this.canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};}
  anchor(p){let i=this.toIndex(p.x),price=this.toPrice(p.y);if(this.snap){i=Math.round(i);const b=this.bars[clamp(i,0,this.length-1)];if(b)price=[b.o,b.h,b.l,b.c].sort((a,b)=>Math.abs(this.toY(a)-p.y)-Math.abs(this.toY(b)-p.y))[0];}return{t:this.toTime(i),p:price};}
  down(e){if(e.button!==0&&e.button!==1)return;if(!this.length)return;e.preventDefault();this.canvas.focus();this.canvas.setPointerCapture(e.pointerId);const p=this.point(e);this.cross=p;
    if(p.x>this.plotWidth){this.pointer={kind:'scale',start:p,min:this.min,max:this.max};return;}
    if(!this.locked&&this.tool!=='cursor'&&e.button===0&&p.y>=this.price.y&&p.y<=this.price.y+this.price.h){
      const a=this.anchor(p);
      if(['hline','vline','text'].includes(this.tool)){
        let text;if(this.tool==='text'){text=window.prompt('Chart annotation','Your note');if(text===null)return;text=text.slice(0,500);}
        this.commitDrawing({id:uid(),type:this.tool,points:[a],text,color:'#84adfa'});return;
      }
      if(this.pending){this.pending.points[1]=a;this.commitDrawing(this.pending);this.pending=null;}
      else {this.pending={id:uid(),type:this.tool,points:[a,{...a}],color:'#84adfa'};this.pointer={kind:'draw',start:p};}
      this.invalidate();return;
    }
    const hit=!this.locked&&this.drawingsVisible?this.hit(p):null;
    if(hit&&e.button===0){this.selected=hit.d.id;this.pointer={kind:'drawing',start:p,anchor:this.anchor(p),drawing:hit.d,handle:hit.handle,before:structuredClone(this.drawings),original:structuredClone(hit.d.points)};this.options.onSelect?.(hit.d);}
    else {this.selected=null;this.pointer={kind:'pan',start:p,right:this.right};}
    this.invalidate();
  }
  move(e){if(!this.length)return;const p=this.point(e);this.cross=p;
    if(this.pointer){const drag=this.pointer;
      if(drag.kind==='pan'){this.right=drag.right-(p.x-drag.start.x)/this.step;this.constrain();this.invalidate();this.emitView();}
      else if(drag.kind==='scale'){const factor=Math.exp((p.y-drag.start.y)*.008),mid=(drag.max+drag.min)/2,half=(drag.max-drag.min)*factor/2;this.manualRange=[mid-half,mid+half];this.invalidate();}
      else if(drag.kind==='draw'&&this.pending){this.pending.points[1]=this.anchor(p);this.invalidate();}
      else if(drag.kind==='drawing'){const a=this.anchor(p);if(drag.handle>=0)drag.drawing.points[drag.handle]=a;else{const dt=a.t-drag.anchor.t,dp=a.p-drag.anchor.p;drag.drawing.points=drag.original.map(v=>({t:v.t+dt,p:v.p+dp}));}this.invalidate();}
    }else if(this.pending){this.pending.points[1]=this.anchor(p);this.invalidate();}
    else this.invalidate(false);
    const i=clamp(Math.round(this.toIndex(p.x)),0,this.length-1);this.options.onHover?.(this.bars[i],i);this.options.onCrosshair?.(this.bars[i]?.t);
  }
  up(e){if(this.canvas.hasPointerCapture(e.pointerId))this.canvas.releasePointerCapture(e.pointerId);const drag=this.pointer;if(!drag)return;
    if(drag.kind==='draw'&&this.pending&&Math.hypot(this.point(e).x-drag.start.x,this.point(e).y-drag.start.y)>5){this.commitDrawing(this.pending);this.pending=null;}
    if(drag.kind==='drawing')this.options.onDrawings?.(drag.before,structuredClone(this.drawings));this.pointer=null;this.invalidate();
  }
  cancel(){if(this.pointer?.kind==='drawing'){this.drawings=this.pointer.before;}this.pointer=null;this.pending=null;this.invalidate();}
  wheel(e){e.preventDefault();if(!this.length)return;const p=this.point(e);if(e.shiftKey||Math.abs(e.deltaX)>Math.abs(e.deltaY)){this.right+=(e.deltaX||e.deltaY)/this.step;this.constrain();this.invalidate();this.emitView();}else this.zoom(Math.exp(clamp(e.deltaY,-300,300)*.0015),clamp(p.x/this.plotWidth,0,1));}
  commitDrawing(d){const before=structuredClone(this.drawings);this.drawings.push(structuredClone(d));this.selected=d.id;this.options.onDrawings?.(before,structuredClone(this.drawings));this.invalidate();}
  deleteSelected(){if(!this.selected)return;const before=structuredClone(this.drawings);this.drawings=this.drawings.filter(d=>d.id!==this.selected);this.selected=null;this.options.onDrawings?.(before,structuredClone(this.drawings));this.invalidate();}
  hit(p){for(let i=this.drawings.length-1;i>=0;i--){const d=this.drawings[i],pts=d.points.map(a=>({x:this.toX(this.timeIndex(a.t)),y:this.toY(a.p)}));
    for(let j=0;j<pts.length;j++)if(Math.hypot(p.x-pts[j].x,p.y-pts[j].y)<9)return{d,handle:j};
    const a=pts[0],b=pts[1]||a;let distance=Infinity;
    if(d.type==='hline')distance=Math.abs(p.y-a.y);else if(d.type==='vline')distance=Math.abs(p.x-a.x);
    else if(d.type==='text')distance=Math.hypot(Math.max(0,Math.abs(p.x-a.x)-60),p.y-a.y);
    else if(d.type==='rectangle'){distance=Math.min(segmentDistance(p.x,p.y,a.x,a.y,b.x,a.y),segmentDistance(p.x,p.y,b.x,a.y,b.x,b.y),segmentDistance(p.x,p.y,b.x,b.y,a.x,b.y),segmentDistance(p.x,p.y,a.x,b.y,a.x,a.y));}
    else if(d.type==='fib'){for(const f of[0,.236,.382,.5,.618,.786,1])distance=Math.min(distance,segmentDistance(p.x,p.y,a.x,a.y+(b.y-a.y)*f,b.x,a.y+(b.y-a.y)*f));}
    else distance=segmentDistance(p.x,p.y,a.x,a.y,b.x,b.y);
    if(distance<7)return{d,handle:-1};
  }return null;}
  layout(){
    const w=this.width,h=this.height;this.plotWidth=Math.max(50,w-83);this.step=this.plotWidth/this.count;this.first=clamp(Math.floor(this.right-this.count)-1,0,this.length-1);this.last=clamp(Math.ceil(this.right)+1,0,this.length);
    const keys=this.enabled.filter(x=>INDICATOR_INFO[x]?.pane!=='price'),sub=Math.max(8,Math.min(82,(h-94)*.48/(keys.length+1)));
    const priceHeight=Math.max(20,h-30-sub*(keys.length+1)-64);this.price={x:0,y:64,w:this.plotWidth,h:priceHeight};this.panes={};let y=64+priceHeight;
    this.volume={x:0,y,w:this.plotWidth,h:sub};y+=sub;
    for(const key of keys){this.panes[key]={x:0,y,w:this.plotWidth,h:sub};y+=sub;}
    this.timeY=h-29;
    let min=Infinity,max=-Infinity;const viewBars=this.style==='heikin'?(this.ha||=(heikinAshi(this.bars))):this.bars;
    for(let i=this.first;i<this.last;i++){const b=viewBars[i];if(b){min=Math.min(min,b.l);max=Math.max(max,b.h);}}
    for(const k of this.enabled){const values=k==='bb'?[this.indicators.bb?.lower,this.indicators.bb?.upper]:INDICATOR_INFO[k]?.pane==='price'?[this.indicators[k]]:[];for(const v of values)if(v)for(let i=this.first;i<this.last;i++)if(Number.isFinite(v[i])){min=Math.min(min,v[i]);max=Math.max(max,v[i]);}}
    if(!Number.isFinite(min)){min=0;max=1;}if(min===max){const d=Math.abs(min)*.01||1;min-=d;max+=d;}
    this.effectiveLog=this.scale==='log'&&min>0;this.percentBase=this.bars[this.first]?.c||1;
    min=this.transform(min);max=this.transform(max);const pad=(max-min)*.1;this.min=min-pad;this.max=max+pad;
    if(this.manualRange){[this.min,this.max]=this.manualRange;}
  }
  invalidate(geometry=true){if(geometry)this.dirty=true;if(!this.raf)this.raf=requestAnimationFrame(()=>{this.raf=0;this.draw();});}
  draw(){if(this.destroyed)return;const start=performance.now();if(!this.width||!this.height)return;this.colors=palette[this.theme]||palette.dark;
    if(this.dirty){this.layout();this.build();this.renderer.render(this.geometry,rgba(this.colors.bg));this.dirty=false;}this.overlay();this.frameMs=performance.now()-start;this.options.onFrame?.({ms:this.frameMs,primitives:this.geometry.count,bars:this.length,visible:Math.max(0,this.last-this.first),mode:this.renderer.mode});}
  build(){const g=this.geometry,c=this.colors;g.clear();this.labels=[];if(!this.length)return;
    const grid=rgba(c.grid),muted=rgba(c.text),up=rgba(c.up),down=rgba(c.down),bottom=this.timeY;
    // Draw main grid and detached axes in one batched geometry stream.
    const step=niceStep(this.max-this.min,Math.max(3,this.price.h/65));
    for(let v=Math.ceil(this.min/step)*step;v<=this.max;v+=step){const p=this.untransform(v),y=this.toY(p);g.line(0,y,this.plotWidth,y,grid);this.labels.push({x:this.plotWidth+10,y,text:this.priceLabel(p),color:c.text});}
    const jump=Math.max(1,Math.ceil(90/this.step));for(let i=Math.ceil(this.first/jump)*jump;i<this.last;i+=jump){const x=this.toX(i);if(x<0||x>this.plotWidth)continue;g.line(x,56,x,bottom,grid);const b=this.bars[i];this.labels.push({x,y:bottom+17,text:this.timeLabel(b.t),color:c.text,align:'center'});}
    g.line(this.plotWidth,0,this.plotWidth,this.height,grid);g.line(0,bottom,this.width,bottom,grid);
    // Level of detail: one OHLC envelope per >= 1.5 screen pixels, preserving extrema.
    const source=this.style==='heikin'?this.ha:this.bars,stride=Math.max(1,Math.floor(1.5/this.step));this.lod=stride;
    let maxVolume=0;for(let i=this.first;i<this.last;i+=stride){let sum=0;for(let j=i;j<Math.min(this.last,i+stride);j++)sum+=this.bars[j].v;maxVolume=Math.max(maxVolume,sum);}
    let prev=null;
    for(let i=this.first;i<this.last;i+=stride){let b=source[i];if(!b)continue;let o=b.o,h=b.h,l=b.l,close=b.c,v=this.bars[i].v,end=i;
      for(let j=i+1;j<Math.min(this.last,i+stride);j++){h=Math.max(h,source[j].h);l=Math.min(l,source[j].l);close=source[j].c;v+=this.bars[j].v;end=j;}
      const x=this.toX((i+end)/2),width=clamp(this.step*(end-i+1)*.72,1,42),col=close>=o?up:down;if(x<-width||x>this.plotWidth+width)continue;
      const yo=this.toY(o),yc=this.toY(close),yh=this.toY(h),yl=this.toY(l);
      if(['line','area'].includes(this.style)){
        if(this.style==='area'){const y=clamp(yc,this.price.y,this.price.y+this.price.h);g.rect(clamp(x-this.step*stride/2,0,this.plotWidth),y,Math.min(this.step*stride+1,this.plotWidth-x+this.step*stride/2),this.price.y+this.price.h-y,rgba(c.accent,.10));}
        if(prev)clippedLine(g,prev.x,prev.y,x,yc,rgba(c.accent),2,this.price);prev={x,y:yc};
      }else if(this.style==='bars'){
        clippedLine(g,x,yh,x,yl,col,1.2,this.price);clippedLine(g,x-width/2,yo,x,yo,col,1.2,this.price);clippedLine(g,x,yc,x+width/2,yc,col,1.2,this.price);
      }else{
        clippedLine(g,x,yh,x,yl,col,1,this.price);const top=clamp(Math.min(yo,yc),this.price.y,this.price.y+this.price.h),height=Math.max(1,clamp(Math.max(yo,yc),this.price.y,this.price.y+this.price.h)-top),left=clamp(x-width/2,0,this.plotWidth),rw=Math.max(0,Math.min(width,this.plotWidth-left));
        if(this.style==='hollow'&&close>=o){g.rect(left,top,rw,height,rgba(c.bg));g.outline(left,top,rw,height,col,1);}else g.rect(left,top,rw,height,col);
      }
      const vh=maxVolume?v/maxVolume*(this.volume.h-24):0;g.rect(clamp(x-width/2,0,this.plotWidth),this.volume.y+this.volume.h-vh-1,Math.max(0,Math.min(width,this.plotWidth-x+width/2)),vh,rgba(close>=o?c.up:c.down,.38));
    }
    g.line(0,this.volume.y,this.width,this.volume.y,grid);this.labels.push({x:12,y:this.volume.y+16,text:'Volume',color:c.text});this.labels.push({x:this.plotWidth+10,y:this.volume.y+16,text:compact(maxVolume),color:c.text});
    if(this.enabled.includes('bb')&&this.indicators.bb){const b=this.indicators.bb;this.plot(b.upper,rgba('#9777df',.7),this.price);this.plot(b.lower,rgba('#9777df',.7),this.price);this.plot(b.mid,rgba('#9777df',.45),this.price);}
    for(const key of ['ema','sma','vwap'])if(this.enabled.includes(key)&&this.indicators[key])this.plot(this.indicators[key],rgba(INDICATOR_INFO[key].color),this.price,1.5);
    for(const [key,box]of Object.entries(this.panes))this.drawPane(key,box);
    const last=this.bars[this.length-1],lastY=this.toY(last.c);if(lastY>=this.price.y&&lastY<=this.price.y+this.price.h){g.dash(0,lastY,this.plotWidth,lastY,rgba(last.c>=last.o?c.up:c.down,.55),1,4);const bg=last.c>=last.o?c.up:c.down;g.rect(this.plotWidth+1,lastY-10,81,20,rgba(bg));this.labels.push({x:this.plotWidth+8,y:lastY+1,text:formatPrice(last.c),color:'#ffffff'});}
    if(this.drawingsVisible){for(const d of this.drawings)this.drawDrawing(d);if(this.pending)this.drawDrawing(this.pending);}
    for(const m of this.markers){if(m.t>this.bars[this.length-1].t)continue;const x=this.toX(this.timeIndex(m.t)),y=this.toY(m.p);if(x>=0&&x<=this.plotWidth&&y>=this.price.y&&y<=this.price.y+this.price.h)this.labels.push({x,y:y+(m.side==='buy'?16:-14),text:m.side==='buy'?'▲':'▼',color:m.side==='buy'?c.up:c.down,align:'center'});}
    // Opaque rails mask geometry outside the plot bounds; axes labels are overlaid next.
  }
  plot(values,color,box,width=1.4,min,max){if(!values)return;const toY=min==null?p=>this.toY(p):p=>box.y+box.h-10-(p-min)/(max-min||1)*Math.max(4,box.h-28);
    const stride=Math.max(1,Math.floor(1/this.step));let previous=null;
    // Min/max envelope decimation keeps sharp excursions visible when zoomed out.
    for(let i=this.first;i<this.last;i+=stride){const pts=[];let mini=i,maxi=i;
      for(let j=i;j<Math.min(this.last,i+stride);j++){if(!Number.isFinite(values[j]))continue;if(!Number.isFinite(values[mini])||values[j]<values[mini])mini=j;if(!Number.isFinite(values[maxi])||values[j]>values[maxi])maxi=j;}
      for(const j of [...new Set([i,mini,maxi,Math.min(this.last-1,i+stride-1)])].sort((a,b)=>a-b))if(Number.isFinite(values[j]))pts.push({x:this.toX(j),y:toY(values[j])});
      if(!pts.length){previous=null;continue;}for(const p of pts){if(previous)clippedLine(this.geometry,previous.x,previous.y,p.x,p.y,color,width,box);previous=p;}
    }
  }
  drawPane(key,box){const g=this.geometry,c=this.colors,info=INDICATOR_INFO[key],raw=this.indicators[key];g.line(0,box.y,this.width,box.y,rgba(c.grid));this.labels.push({x:12,y:box.y+15,text:info.label,color:info.color});if(!raw)return;
    let series=key==='macd'?[raw.line,raw.signal,raw.histogram]:key==='stoch'?[raw.k,raw.d]:[raw];
    let min=Infinity,max=-Infinity;
    if(key==='rsi'||key==='stoch'){min=0;max=100;}else{for(const a of series)for(let i=this.first;i<this.last;i++)if(Number.isFinite(a[i])){min=Math.min(min,a[i]);max=Math.max(max,a[i]);}if(key==='macd'){min=Math.min(0,min);max=Math.max(0,max);}if(!Number.isFinite(min)){min=0;max=1;}const pad=(max-min)*.15||1;min-=pad;max+=pad;}
    const yy=p=>box.y+box.h-10-(p-min)/(max-min||1)*Math.max(4,box.h-28);
    if(key==='rsi'||key==='stoch'){const high=key==='rsi'?70:80,low=key==='rsi'?30:20;g.rect(0,yy(high),box.w,yy(low)-yy(high),rgba(info.color,.04));for(const v of[high,low]){g.dash(0,yy(v),box.w,yy(v),rgba(c.text,.23),1,4);this.labels.push({x:box.w+10,y:yy(v),text:String(v),color:c.text});}}
    else this.labels.push({x:box.w+10,y:box.y+15,text:compact(series[0][this.last-1]),color:c.text});
    if(key==='macd'){const a=raw.histogram;for(let i=this.first;i<this.last;i++){const x=this.toX(i);if(x<0||x>box.w||!Number.isFinite(a[i]))continue;g.rect(x,yy(0),Math.max(1,this.step*.6),yy(a[i])-yy(0),rgba(a[i]>=0?c.up:c.down,.6));}g.line(0,yy(0),box.w,yy(0),rgba(c.grid));this.plot(raw.line,rgba(info.color),box,1.4,min,max);this.plot(raw.signal,rgba('#eab96a'),box,1.3,min,max);}
    else {this.plot(series[0],rgba(info.color),box,1.4,min,max);if(series[1])this.plot(series[1],rgba('#eab96a'),box,1.3,min,max);}
  }
  drawDrawing(d){const g=this.geometry,box=this.price,p=d.points.map(a=>({x:this.toX(this.timeIndex(a.t)),y:this.toY(a.p)})),a=p[0],b=p[1]||a,c=rgba(d.color||'#84adfa'),line=(x1,y1,x2,y2,co=c,w=1.5)=>clippedLine(g,x1,y1,x2,y2,co,w,box);
    if(d.type==='hline')line(0,a.y,box.w,a.y);
    else if(d.type==='vline')line(a.x,box.y,a.x,box.y+box.h);
    else if(d.type==='rectangle'){const x=clamp(Math.min(a.x,b.x),0,box.w),y=clamp(Math.min(a.y,b.y),box.y,box.y+box.h),r=clamp(Math.max(a.x,b.x),0,box.w),bottom=clamp(Math.max(a.y,b.y),box.y,box.y+box.h);g.rect(x,y,r-x,bottom-y,rgba(d.color||'#84adfa',.08));line(a.x,a.y,b.x,a.y);line(b.x,a.y,b.x,b.y);line(b.x,b.y,a.x,b.y);line(a.x,b.y,a.x,a.y);}
    else if(d.type==='fib'){const fs=[0,.236,.382,.5,.618,.786,1];for(const f of fs){const y=a.y+(b.y-a.y)*f;line(a.x,y,b.x,y,rgba(d.color||'#84adfa',f===.618?1:.55));if(y>=box.y&&y<=box.y+box.h)this.labels.push({x:clamp(Math.max(a.x,b.x)+6,0,box.w-130),y:y-5,text:`${f}  (${formatPrice(this.toPrice(y))})`,color:d.color||'#84adfa'});}line(a.x,a.y,b.x,b.y,rgba(d.color||'#84adfa',.5));}
    else if(d.type==='text'){if(a.x>=0&&a.x<box.w&&a.y>=box.y&&a.y<box.y+box.h)this.labels.push({x:a.x,y:a.y,text:d.text||'Note',color:d.color||'#84adfa'});}
    else if(d.type==='ray'){const dx=b.x-a.x,dy=b.y-a.y;if(Math.abs(dx)<.01)line(a.x,a.y,a.x,dy>=0?box.y+box.h:box.y);else{const end=dx>=0?box.w:0;line(a.x,a.y,end,a.y+(end-a.x)*dy/dx);}}
    else {line(a.x,a.y,b.x,b.y);if(d.type==='measure'){const change=d.points[1].p-d.points[0].p,pct=d.points[0].p?change/d.points[0].p*100:0;this.labels.push({x:clamp((a.x+b.x)/2,8,box.w-190),y:clamp(Math.min(a.y,b.y)-12,box.y+12,box.y+box.h),text:`${formatPrice(change)} (${pct.toFixed(2)}%) · ${Math.abs(Math.round((d.points[1].t-d.points[0].t)/this.interval))} bars`,color:d.color||'#84adfa'});}}
    if(d.id===this.selected)for(const v of p)if(v.x>=0&&v.x<=box.w&&v.y>=box.y&&v.y<=box.y+box.h){g.rect(v.x-4,v.y-4,8,8,rgba(this.colors.bg));g.outline(v.x-4,v.y-4,8,8,c,1.5);}
  }
  priceLabel(p){if(this.scale==='percent')return ((p/this.percentBase-1)*100).toFixed(2)+'%';return formatPrice(p);}
  timeLabel(t){const d=new Date(t*1000);return this.interval>=86400?d.toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'}):d.getUTCHours()===0?d.toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'}):d.toISOString().slice(11,16);}
  overlay(){const ctx=this.ctx,c=this.colors;ctx.clearRect(0,0,this.width,this.height);ctx.font='11px "SFMono-Regular", Consolas, monospace';ctx.textBaseline='middle';
    for(const l of this.labels||[]){ctx.fillStyle=l.color||c.text;ctx.textAlign=l.align||'left';ctx.fillText(l.text,l.x,l.y);}
    if(!this.length)return;
    ctx.textAlign='left';
    if(this.cross&&this.cross.x>=0&&this.cross.x<=this.plotWidth&&this.cross.y>=52&&this.cross.y<=this.timeY){
      const index=clamp(Math.round(this.toIndex(this.cross.x)),0,this.length-1),x=this.toX(index),y=this.cross.y;
      ctx.strokeStyle=c.text;ctx.lineWidth=.7;ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(x,52);ctx.lineTo(x,this.timeY);ctx.moveTo(0,y);ctx.lineTo(this.plotWidth,y);ctx.stroke();ctx.setLineDash([]);
      ctx.fillStyle=this.theme==='light'?'#263344':'#37404e';ctx.fillRect(this.plotWidth+1,y-10,81,20);ctx.fillStyle='#fff';ctx.fillText(y<=this.price.y+this.price.h?this.priceLabel(this.toPrice(y)):'',this.plotWidth+8,y+1);
      const label=new Date(this.bars[index].t*1000).toISOString().replace('T',' ').slice(0,16)+' UTC',tw=ctx.measureText(label).width+16,lx=clamp(x-tw/2,0,this.plotWidth-tw);
      ctx.fillStyle=this.theme==='light'?'#263344':'#37404e';ctx.fillRect(lx,this.timeY+1,tw,27);ctx.fillStyle='#fff';ctx.fillText(label,lx+8,this.timeY+15);
    }
    if(this.linkedTime!=null&&!this.cross){const x=this.toX(this.timeIndex(this.linkedTime));if(x>=0&&x<=this.plotWidth){ctx.strokeStyle=c.text;ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(x,52);ctx.lineTo(x,this.timeY);ctx.stroke();ctx.setLineDash([]);}}
  }
  snapshot(){this.dirty=true;this.draw();const canvas=document.createElement('canvas');canvas.width=this.canvas.width;canvas.height=this.canvas.height;const ctx=canvas.getContext('2d');ctx.drawImage(this.renderer.mode==='WebGPU'?this.gpu:this.fallback,0,0);ctx.drawImage(this.canvas,0,0);ctx.scale(this.dpr,this.dpr);ctx.fillStyle=this.colors.bright;ctx.font='bold 14px system-ui';ctx.fillText(`${this.symbol} · Aureon Terminal`,16,24);ctx.font='11px system-ui';ctx.fillStyle=this.colors.text;ctx.fillText(this.options.sourceLabel?.()||'Chart export',16,43);return new Promise(resolve=>canvas.toBlob(resolve,'image/png'));}
  destroy(){this.destroyed=true;cancelAnimationFrame(this.raf);this.events.abort();this.observer.disconnect();this.renderer.destroy();}
}
