import {footprint,tpoFromTrades,buildTradeBars,validateTrades} from './tick-charts.js';
import {analyzeFootprint} from './footprint-analysis.js';
import {rgba} from './renderer.js';
export const TRADE_CHART_TYPES=new Set(['tickcount','tradevolume','traderange']);
export const PRO_CHART_TYPES={volumecandles:'Volume-width candles · fixed time',highlow:'High / low bars',hlcarea:'HLC band',linemarkers:'Line with markers',stepline:'Step with markers',circles:'Close markers',footprint:'Footprint · observed trades',tpo:'TPO · observed prices',tickcount:'Tick-count candles · actual trades',tradevolume:'Volume candles · actual trades',traderange:'Range candles · actual trades'};
export function tradeDisplay(trades,style,options={}){return buildTradeBars(trades,{mode:{tickcount:'ticks',tradevolume:'volume',traderange:'range'}[style],threshold:options.tradeThreshold??(style==='tickcount'?100:1)});}
export function prepareTradeProfiles(raw,interval,options={}){const trades=validateTrades(raw),tickSize=options.tickSize??Math.max(1e-8,(trades.at(-1)?.price||1)*.0001);return{footprint:new Map(footprint(trades,{interval,tickSize}).map(b=>[b.t,analyzeFootprint(b,tickSize,options)])),tpo:tpoFromTrades(trades,{tickSize,periodSeconds:options.tpoPeriod??1800}),tickSize,periodSeconds:options.tpoPeriod??1800};}
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
/** Pixel-space Liang–Barsky clipping, shared by the new style primitives. */
export function clipSegment(a,b,box){let low=0,high=1;const dx=b.x-a.x,dy=b.y-a.y,p=[-dx,dx,-dy,dy],q=[a.x-box.x,box.x+box.w-a.x,a.y-box.y,box.y+box.h-a.y];for(let i=0;i<4;i++){if(Math.abs(p[i])<1e-15){if(q[i]<0)return null;}else{const r=q[i]/p[i];if(p[i]<0)low=Math.max(low,r);else high=Math.min(high,r);if(low>high)return null;}}return[{x:a.x+low*dx,y:a.y+low*dy},{x:a.x+high*dx,y:a.y+high*dy}];}
export function renderProBar(chart,{b,x,width,yo,yc,yh,yl,col,volume,maxVolume,previous}){
  const style=chart.style;if(!['volumecandles','highlow','hlcarea','linemarkers','stepline','circles','footprint','tpo'].includes(style))return false;
  const g=chart.geometry,box={x:0,y:chart.price.y,w:chart.plotWidth,h:chart.price.h},colors=chart.colors;
  const line=(a,b,color=col,w=1)=>{const points=clipSegment(a,b,box);if(points)g.line(points[0].x,points[0].y,points[1].x,points[1].y,color,w);};
  const rect=(x,y,w,h,color)=>{const left=clamp(Math.min(x,x+w),0,box.w),right=clamp(Math.max(x,x+w),0,box.w),top=clamp(Math.min(y,y+h),box.y,box.y+box.h),bottom=clamp(Math.max(y,y+h),box.y,box.y+box.h);if(right>left&&bottom>top)g.rect(left,top,right-left,bottom-top,color);};
  if(style==='tpo')return true;
  if(style==='highlow'){line({x,y:yh},{x,y:yl});line({x:x-width/2,y:yh},{x:x+width/2,y:yh});line({x:x-width/2,y:yl},{x:x+width/2,y:yl});return true;}
  if(style==='hlcarea'){rect(x-chart.step/2,yh,chart.step,yl-yh,rgba(colors.accent,.15));if(previous){line({x:previous.x,y:previous.h},{x,y:yh},rgba(colors.up,.7));line({x:previous.x,y:previous.l},{x,y:yl},rgba(colors.down,.7));line({x:previous.x,y:previous.y},{x,y:yc},rgba(colors.accent),1.5);}return true;}
  if(['linemarkers','stepline','circles'].includes(style)){const color=rgba(colors.accent);if(previous&&style!=='circles'){if(style==='stepline'){line({x:previous.x,y:previous.y},{x,y:previous.y},color,1.5);line({x,y:previous.y},{x,y:yc},color,1.5);}else line({x:previous.x,y:previous.y},{x,y:yc},color,1.5);}if(chart.step>=4){let old;const radius=Math.min(3,chart.step*.22);for(let i=0;i<=12;i++){const q={x:x+radius*Math.cos(i/12*2*Math.PI),y:yc+radius*Math.sin(i/12*2*Math.PI)};if(old)line(old,q,color,1.2);old=q;}}return true;}
  if(style==='volumecandles'){const w=clamp(chart.step*.85*(maxVolume?volume/maxVolume:0),1,chart.step*.9);line({x,y:yh},{x,y:yl});rect(x-w/2,Math.min(yo,yc),w,Math.max(1,Math.abs(yc-yo)),col);return true;}
  const fp=chart.tradeProfiles?.footprint.get(b.t);line({x,y:yh},{x,y:yl},rgba(colors.text,.35));if(!fp)return true;
  const tickSize=chart.tradeProfiles.tickSize,w=Math.max(1,chart.step*.94),cell=Math.max(1,Math.abs(chart.toY(b.c+tickSize)-chart.toY(b.c))),max=Math.max(1e-15,...fp.levels.map(l=>Math.max(l.buy,l.sell,l.unknown)));
  for(const level of fp.levels){const y=chart.toY(level.price),row=Math.max(1,Math.abs(chart.toY(level.price+tickSize/2)-chart.toY(level.price-tickSize/2))*.94);if(y<box.y-row||y>box.y+box.h+row)continue;
    rect(x-w/2,y-row/2,w/2,row,rgba(colors.down,.12+.7*level.sell/max));rect(x,y-row/2,w/2,row,rgba(colors.up,.12+.7*level.buy/max));
    if(level.stackedSell)rect(x-w/2,y-row/2,Math.min(3,w/8),row,rgba(colors.down,1));
    if(level.stackedBuy)rect(x+w/2-Math.min(3,w/8),y-row/2,Math.min(3,w/8),row,rgba(colors.up,1));
    if(level.inValueArea)line({x:x-w/2,y:y+row/2},{x:x+w/2,y:y+row/2},rgba(colors.accent,.28),.6);
    if(level.unknown)rect(x-w*.05,y-row/2,w*.1,row,rgba(colors.text,.65));
    if(level.price===fp.poc)line({x:x-w/2,y:y-row/2},{x:x+w/2,y:y-row/2},rgba(colors.accent),1.5);
    if(w>=85&&cell>=13){chart.labels.push({x:x-4,y,text:shortSize(level.sell)+(level.sellImbalance?'!':''),align:'right',color:level.sellImbalance?colors.down:colors.bright},{x:x+4,y,text:shortSize(level.buy)+(level.buyImbalance?'!':''),color:level.buyImbalance?colors.up:colors.bright});}
  }
  if(w>=45)chart.labels.push({x,y:chart.price.y+chart.price.h-10,text:'Δ '+shortSize(fp.delta),align:'center',color:fp.delta>=0?colors.up:colors.down});return true;
}
function shortSize(n){return Math.abs(n)>=1e6?(n/1e6).toFixed(1)+'M':Math.abs(n)>=1e3?(n/1e3).toFixed(1)+'K':n.toFixed(Math.abs(n)<1?3:1);}
export function renderTradeOverlay(chart){
  if(!['footprint','tpo'].includes(chart.style))return;const profiles=chart.tradeProfiles,colors=chart.colors;
  chart.labels.push({x:12,y:chart.price.y+15,text:!profiles?'Actual-trade data required · import in Pro tools or connect Order Flow':chart.style==='footprint'?'Observed sell × buy · ! imbalance · edge = stacked · gray = unknown':'Observed-price TPO · letters are UTC periods; unobserved prices stay empty',color:colors.text});
  if(chart.style!=='tpo'||!profiles)return;
  const g=chart.geometry,letters='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  for(const session of profiles.tpo)for(const level of session.levels){const y=chart.toY(level.price),height=Math.max(1,Math.abs(chart.toY(level.price+profiles.tickSize/2)-chart.toY(level.price-profiles.tickSize/2))*.92);if(y<chart.price.y||y>chart.price.y+chart.price.h)continue;for(const period of level.periods){const t=session.t+period*profiles.periodSeconds,x=chart.toX(chart.timeIndex(t)),right=chart.toX(chart.timeIndex(t+profiles.periodSeconds)),width=Math.max(1,right-x-1);if(x<0||x>chart.plotWidth)continue;g.rect(x,clamp(y-height/2,chart.price.y,chart.price.y+chart.price.h),Math.min(width,chart.plotWidth-x),Math.min(height,chart.price.y+chart.price.h-y),rgba(colors.accent,.3+(period%3)*.15));if(width>=10&&height>=13)chart.labels.push({x:x+width/2,y,text:letters[period%letters.length],align:'center',color:colors.bright});}}
}
