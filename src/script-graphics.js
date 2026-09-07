/** Script-owned retained primitives. Opaque IDs resolve only in this bounded
 * registry; text is rendered as text, never HTML. This module has no DOM access.
 */
export const GRAPHIC_CONSTANTS={
  'xloc.bar_index':'bar_index','xloc.bar_time':'bar_time',
  'extend.none':'none','extend.left':'left','extend.right':'right','extend.both':'both',
  'line.style_solid':'solid','line.style_dashed':'dashed','line.style_dotted':'dotted',
  'label.style_label_up':'up','label.style_label_down':'down','label.style_none':'none',
  'text.align_left':'left','text.align_center':'center','text.align_right':'right',
  'size.tiny':10,'size.small':11,'size.normal':12,'size.large':16,'size.huge':20,
  'position.top_left':'top_left','position.top_center':'top_center','position.top_right':'top_right',
  'position.middle_left':'middle_left','position.middle_center':'middle_center','position.middle_right':'middle_right',
  'position.bottom_left':'bottom_left','position.bottom_center':'bottom_center','position.bottom_right':'bottom_right'
};
const layouts={
  'line.new':['x1','y1','x2','y2','xloc','extend','color','style','width'],
  'box.new':['left','top','right','bottom','border_color','border_width','border_style','extend','xloc','bgcolor','text','text_size','text_color','text_halign'],
  'label.new':['x','y','text','xloc','yloc','color','style','textcolor','size','textalign'],
  'table.new':['position','columns','rows','bgcolor','frame_color','frame_width','border_color','border_width'],
  'table.cell':['table_id','column','row','text','width','height','text_color','text_halign','text_valign','text_size','bgcolor']
};
const numeric=(v,name)=>{if(!Number.isFinite(v))throw new Error('Script graphic '+name+' must be finite');return v;};
const boundedText=v=>{if(typeof v!=='string'||v.length>4000)throw new Error('Script graphic text limit is 4,000 characters');return v;};
const color=v=>{if(typeof v!=='string'||!/^#(?:[a-f\d]{3}|[a-f\d]{6}|[a-f\d]{8})$/i.test(v))throw new Error('Script graphic color must be hexadecimal');return v;};
const enumValue=(v,values,name)=>{if(!values.includes(v))throw new Error('Unsupported graphic '+name);return v;};
export class ScriptGraphics {
  constructor({maxObjects=500,maxAllocations=10000,maxCells=10000,budget=()=>{}}={}){
    Object.assign(this,{maxObjects,maxAllocations,maxCells,budget});this.objects=new Map();this.next=0;this.cells=0;
  }
  args(name,positional,named,names){
    names??=layouts[name];if(!names)throw new Error('Unsupported graphics call '+name);
    if(positional.length>names.length)throw new Error('Too many '+name+' arguments');const result={};
    positional.forEach((v,i)=>result[names[i]]=v);
    for(const[k,v]of Object.entries(named)){if(!names.includes(k)||Object.hasOwn(result,k))throw new Error('Unknown or duplicated '+name+' argument '+k);result[k]=v;}
    return result;
  }
  object(id,type){const object=this.objects.get(id);if(!object||object.type!==type)throw new Error('Unknown or deleted '+type+' handle');return object;}
  create(type,fields,index){
    if(this.objects.size>=this.maxObjects||this.next>=this.maxAllocations)throw new Error('Script graphics object budget exceeded');
    const id='@'+type+':'+(++this.next),o={...fields,id,type,createdAt:index,updatedAt:index};this.validate(o);
    this.budget();this.objects.set(id,o);return id;
  }
  validate(o){
    if(o.type==='table'){
      enumValue(o.position,Object.values(GRAPHIC_CONSTANTS).filter(x=>typeof x==='string'&&x.includes('_')&&!x.startsWith('bar_')),'table position');
      for(const k of ['columns','rows'])if(!Number.isInteger(o[k])||o[k]<1||o[k]>50)throw new Error('Table dimensions must be 1..50');
      if(o.columns*o.rows>2500)throw new Error('Table cell budget exceeded');
    }else{
      enumValue(o.xloc,['bar_index','bar_time'],'xloc');
      for(const k of o.type==='line'?['x1','x2','y1','y2']:o.type==='box'?['left','right','top','bottom']:['x','y'])numeric(o[k],k);
      const xs=o.type==='line'?[o.x1,o.x2]:o.type==='box'?[o.left,o.right]:[o.x];
      if(xs.some(x=>x<0||!Number.isSafeInteger(x)))throw new Error('Script graphic x coordinates must be nonnegative safe integers');
      if(o.extend)enumValue(o.extend,['none','left','right','both'],'extension');
    }
    for(const k of ['color','bgcolor','border_color','frame_color','text_color','textcolor'])if(o[k]!==undefined)color(o[k]);
    for(const k of ['width','border_width','frame_width'])if(o[k]!==undefined&&(numeric(o[k],k)<0||o[k]>10))throw new Error('Graphic stroke width must be 0..10');
    if(o.text!==undefined)boundedText(o.text);
    if(o.type==='line')enumValue(o.style,['solid','dashed','dotted'],'line style');
    if(o.type==='box'){enumValue(o.border_style,['solid','dashed','dotted'],'border style');enumValue(o.text_halign,['left','center','right'],'text alignment');}
    if(o.type==='label'){enumValue(o.style,['up','down','none'],'label style');enumValue(o.textalign,['left','center','right'],'label alignment');}
    for(const k of ['size','text_size'])if(o[k]!==undefined&&(!Number.isFinite(o[k])||o[k]<8||o[k]>40))throw new Error('Graphic text size must be 8..40');
  }
  call(name,args,named={},index=0){
    this.budget();const[type,method]=name.split('.');
    if(method==='new'){
      const a=this.args(name,args,named);
      if(type==='line')return this.create(type,{xloc:'bar_index',extend:'none',color:'#578bfa',style:'solid',width:1,...a},index);
      if(type==='box')return this.create(type,{xloc:'bar_index',extend:'none',border_color:'#578bfa',border_width:1,border_style:'solid',bgcolor:'#578bfa22',text:'',text_size:12,text_color:'#d9e1eb',text_halign:'center',...a},index);
      if(type==='label'){
        if(a.yloc!==undefined&&a.yloc!=='price')throw new Error('Labels currently use explicit price coordinates');delete a.yloc;
        return this.create(type,{xloc:'bar_index',text:'',color:'#578bfa',style:'down',textcolor:'#ffffff',size:12,textalign:'center',...a},index);
      }
      if(type==='table'){
        const fields={bgcolor:'#14191fcc',frame_color:'#578bfa',frame_width:1,border_color:'#222831',border_width:1,cells:{},...a};
        this.validate({...fields,type});if(this.cells+fields.columns*fields.rows>this.maxCells)throw new Error('Script table cell allocation budget exceeded');
        const id=this.create(type,fields,index);this.cells+=fields.columns*fields.rows;return id;
      }
    }
    if(type==='table'&&method==='cell'){
      const a=this.args(name,args,named),o=this.object(a.table_id,type);
      if(!Number.isInteger(a.column)||!Number.isInteger(a.row)||a.column<0||a.row<0||a.column>=o.columns||a.row>=o.rows)throw new Error('Table cell index out of bounds');
      if(a.width!==undefined||a.height!==undefined)throw new Error('Explicit table cell dimensions are not supported');
      if(a.text_valign!==undefined&&a.text_valign!=='center')throw new Error('Only centered table cell vertical alignment is supported');
      const cell={text:boundedText(a.text??''),text_color:color(a.text_color??'#d9e1eb'),bgcolor:color(a.bgcolor??o.bgcolor),text_halign:enumValue(a.text_halign??'left',['left','center','right'],'cell alignment'),text_size:a.text_size??12};
      if(!Number.isFinite(cell.text_size)||cell.text_size<8||cell.text_size>40)throw new Error('Table text size must be 8..40');
      o.cells[a.column+':'+a.row]=cell;o.updatedAt=index;return 0;
    }
    if(method==='delete'){
      const a=this.args(name,args,named,['id']);if(a.id===null||Number.isNaN(a.id))return 0;
      const o=this.object(a.id,type);this.objects.delete(o.id);return 0;
    }
    if(method==='copy'){
      const a=this.args(name,args,named,['id']),o=this.object(a.id,type);if(type==='table')throw new Error('Copy tables by creating and filling a new table');
      const {id,createdAt,updatedAt,...fields}=structuredClone(o);return this.create(type,fields,index);
    }
    if(method==='get_price'&&type==='line'){
      const a=this.args(name,args,named,['id','x']),o=this.object(a.id,type);numeric(a.x,'x');
      if(o.xloc!=='bar_index')throw new Error('Line price interpolation requires bar-index coordinates');return o.x1===o.x2?NaN:o.y1+(o.y2-o.y1)*(a.x-o.x1)/(o.x2-o.x1);
    }
    const properties={line:['x1','x2','y1','y2','color','width','style','extend','xloc'],box:['left','right','top','bottom','text','text_color','text_size','text_halign','border_color','border_width','border_style','bgcolor','extend'],label:['x','y','text','color','textcolor','style','size','textalign'],table:['position','bgcolor','frame_color','frame_width','border_color','border_width']};
    if(method?.startsWith('get_')){
      const property=method.slice(4);if(!properties[type]?.includes(property))throw new Error('Unsupported getter '+name);
      const a=this.args(name,args,named,['id']);return this.object(a.id,type)[property];
    }
    if(method?.startsWith('set_')){
      const property=method.slice(4),tuple={xy:['x','y'],xy1:['x1','y1'],xy2:['x2','y2'],lefttop:['left','top'],rightbottom:['right','bottom']}[property];
      const fields=tuple||[property];if(fields.some(k=>!properties[type]?.includes(k)))throw new Error('Unsupported setter '+name);
      const a=this.args(name,args,named,['id',...fields]),o=this.object(a.id,type),next={...o};
      for(const key of fields){if(a[key]===undefined)throw new Error('Missing graphics argument '+key);next[key]=a[key];}
      this.validate(next);next.updatedAt=index;this.objects.set(o.id,next);return 0;
    }
    if(type==='table'&&method==='clear'){
      const a=this.args(name,args,named,['id']);this.object(a.id,type).cells={};this.object(a.id,type).updatedAt=index;return 0;
    }
    throw new Error('Unsupported script graphics operation '+name);
  }
  snapshot(){return [...this.objects.values()].map(x=>structuredClone(x));}
}
