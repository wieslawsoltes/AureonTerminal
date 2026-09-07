import {rgba} from './renderer.js';
/** Render retained script objects through the same instanced geometry stream as
 * candles. Canvas text remains clipped and independently accessible in the UI.
 */
export function renderScriptGraphics(chart){
  const g=chart.geometry,box=chart.price;if(!box||!chart.length)return;
  const raw=chart.rawBars||chart.bars,cutoff=(chart.endLimit??raw.length)-1;
  const x=(value,loc)=>chart.toX(loc==='bar_time'?chart.timeIndex(value/1000):chart.timeIndex(raw[value]?.t??(raw.at(-1).t+(value-raw.length+1)*chart.interval)));
  const y=value=>chart.toY(value),inside=(a,b)=>a>=box.x&&a<=box.x+box.w&&b>=box.y&&b<=box.y+box.h;
  function line(ax,ay,bx,by,c,width,style='solid'){
    if(![ax,ay,bx,by].every(Number.isFinite))return;
    let lo=0,hi=1;const dx=bx-ax,dy=by-ay,p=[-dx,dx,-dy,dy],q=[ax-box.x,box.x+box.w-ax,ay-box.y,box.y+box.h-ay];
    for(let i=0;i<4;i++){if(p[i]===0){if(q[i]<0)return;}else{const t=q[i]/p[i];if(p[i]<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);if(lo>hi)return;}}
    if(!width)return;const a=[ax+lo*dx,ay+lo*dy,bx===ax?bx:ax+hi*dx,ay+hi*dy];
    if(style==='solid')g.line(...a,rgba(c),width);else g.dash(...a,rgba(c),width,style==='dotted'?2:6);
  }
  function rect(left,top,right,bottom,fill,stroke,width=1,style='solid'){
    const l=Math.max(box.x,Math.min(left,right)),r=Math.min(box.x+box.w,Math.max(left,right)),t=Math.max(box.y,Math.min(top,bottom)),b=Math.min(box.y+box.h,Math.max(top,bottom));
    if(r<l||b<t)return;if(fill)g.rect(l,t,r-l,b-t,rgba(fill));
    if(stroke){line(left,top,right,top,stroke,width,style);line(right,top,right,bottom,stroke,width,style);line(right,bottom,left,bottom,stroke,width,style);line(left,bottom,left,top,stroke,width,style);}
  }
  const label=(px,py,text,color,align='left',size=12,clip=box)=>{if(inside(px,py))chart.labels.push({x:px,y:py,text,color,align,size,clip});};
  for(const o of chart.scriptGraphics||[]){
    // An old batch result cannot leak later object mutations during direct replay.
    // Running the script on the replay prefix restores its historical objects.
    if(o.updatedAt>cutoff)continue;
    if(o.type==='line'){
      let ax=x(o.x1,o.xloc),bx=x(o.x2,o.xloc),ay=y(o.y1),by=y(o.y2);
      if(ax!==bx&&o.extend!=='none'){
        const slope=(by-ay)/(bx-ax),origin={x:ax,y:ay};
        if(['left','both'].includes(o.extend)){ax=box.x;ay=origin.y+(ax-origin.x)*slope;}
        if(['right','both'].includes(o.extend)){bx=box.x+box.w;by=origin.y+(bx-origin.x)*slope;}
      }
      line(ax,ay,bx,by,o.color,o.width,o.style);
    }else if(o.type==='box'){
      let l=x(o.left,o.xloc),r=x(o.right,o.xloc);if(['left','both'].includes(o.extend))l=box.x;if(['right','both'].includes(o.extend))r=box.x+box.w;
      const t=y(o.top),b=y(o.bottom);rect(l,t,r,b,o.bgcolor,o.border_color,o.border_width,o.border_style);
      const align=o.text_halign,px=align==='left'?Math.min(l,r)+5:align==='right'?Math.max(l,r)-5:(l+r)/2;label(px,(t+b)/2,o.text,o.text_color,align,o.text_size);
    }else if(o.type==='label'){
      const px=x(o.x,o.xloc),py=y(o.y),height=o.size+10,width=Math.min(box.w,Math.max(16,o.text.length*o.size*.62+12));
      const top=py+(o.style==='up'?-height-4:o.style==='down'?4:-height/2);
      if(o.style!=='none')rect(px-width/2,top,px+width/2,top+height,o.color,null);
      const lx=o.textalign==='left'?px-width/2+6:o.textalign==='right'?px+width/2-6:px;label(lx,top+height/2,o.text,o.textcolor,o.textalign,o.size);
    }else if(o.type==='table'){
      const maxSize=Math.max(12,...Object.values(o.cells).map(c=>c.text_size)),cw=Math.min(140,Math.max(36,(box.w-16)/o.columns)),rh=Math.max(26,maxSize+10),width=cw*o.columns,height=rh*o.rows;
      const[vertical,horizontal]=o.position.split('_'),left=horizontal==='left'?box.x+8:horizontal==='right'?box.x+box.w-width-8:box.x+(box.w-width)/2,top=vertical==='top'?box.y+8:vertical==='bottom'?box.y+box.h-height-8:box.y+(box.h-height)/2;
      rect(left,top,left+width,top+height,o.bgcolor,o.frame_color,o.frame_width);
      for(const[key,c]of Object.entries(o.cells)){
        const[col,row]=key.split(':').map(Number),l=left+col*cw,t=top+row*rh;rect(l,t,l+cw,t+rh,c.bgcolor,o.border_color,o.border_width);
        const px=c.text_halign==='right'?l+cw-5:c.text_halign==='center'?l+cw/2:l+5;label(px,t+rh/2,c.text,c.text_color,c.text_halign,c.text_size,{x:Math.max(box.x,l+2),y:Math.max(box.y,t+2),w:Math.max(0,Math.min(box.x+box.w,l+cw-2)-Math.max(box.x,l+2)),h:Math.max(0,Math.min(box.y+box.h,t+rh-2)-Math.max(box.y,t+2))});
      }
    }
  }
}
