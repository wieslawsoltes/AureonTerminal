/** Validated, non-executable screening predicates and deterministic report export. */
export const SCREEN_FIELDS = ['symbol','interval','bars','time','age','price','change','volume','source'];
export const SCREEN_OPERATORS = ['>','>=','<','<=','==','!=','crossup','crossdown','exists','isna','contains'];
function field(value) {
  if (typeof value!=='string'||value.length>256||!SCREEN_FIELDS.includes(value)&&!/^plot:.{1,240}$/s.test(value)) throw new TypeError('Unknown screening field');
  return value;
}
export function validateScreenQuery(raw={}) {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new TypeError('Screen query must be an object');
  const filters=raw.filters??[];
  if(!Array.isArray(filters)||filters.length>16)throw new RangeError('At most 16 screen predicates');
  const validated=filters.map(f=>{
    if(!f||!SCREEN_OPERATORS.includes(f.op))throw new TypeError('Unknown screen predicate');
    const out={field:field(f.field),op:f.op};
    if(['exists','isna'].includes(f.op))return out;
    const textual=['symbol','source'].includes(f.field);
    if(textual&&!['contains','==','!='].includes(f.op))throw new TypeError('Text fields require contains or equality');
    if(f.otherField!=null){if(f.op==='contains')throw new TypeError('contains requires literal text');out.otherField=field(f.otherField);if(textual!==['symbol','source'].includes(f.otherField))throw new TypeError('Compared fields must have compatible types');return out;}
    if(textual){if(typeof f.value!=='string'||f.value.length>200)throw new TypeError('Text predicate requires at most 200 characters');out.value=f.value;}
    else {if(f.op==='contains')throw new TypeError('contains requires a text field');if(!Number.isFinite(f.value))throw new TypeError('Numeric predicate requires a finite threshold');out.value=f.value;}
    return out;
  });
  const combine=raw.combine??'all',direction=raw.direction??'desc',limit=raw.limit??25;
  if(!['all','any'].includes(combine)||!['asc','desc'].includes(direction)||!Number.isInteger(limit)||limit<1||limit>100)throw new RangeError('Invalid screen presentation');
  return {filters:validated,combine,sort:field(raw.sort??'symbol'),direction,limit};
}
export function screenValue(row,key,previous=false) {
  if(key.startsWith('plot:')){const plot=row.plots?.find(p=>p.name===key.slice(5));return previous?plot?.previous:plot?.value;}
  if(previous)return key==='price'?row.previousPrice:key==='volume'?row.previousVolume:undefined;
  return Object.hasOwn(row,key)?row[key]:undefined;
}
const present=value=>typeof value==='number'?Number.isFinite(value):typeof value==='string';
export function matchesScreen(row,query) {
  if(row.error)return false;
  const test=f=>{
    const a=screenValue(row,f.field),b=f.otherField?screenValue(row,f.otherField):f.value;
    if(f.op==='exists')return present(a);if(f.op==='isna')return !present(a);
    if(f.op==='contains')return typeof a==='string'&&a.toLowerCase().includes(f.value.toLowerCase());
    if(typeof a==='string'&&typeof b==='string')return f.op==='=='?a===b:f.op==='!='?a!==b:false;
    if(!Number.isFinite(a)||!Number.isFinite(b))return false;
    switch(f.op){case'>':return a>b;case'>=':return a>=b;case'<':return a<b;case'<=':return a<=b;case'==':return a===b;case'!=':return a!==b;
      case'crossup':case'crossdown':{const ap=screenValue(row,f.field,true),bp=f.otherField?screenValue(row,f.otherField,true):b;if(!Number.isFinite(ap)||!Number.isFinite(bp))return false;return f.op==='crossup'?ap<=bp&&a>b:ap>=bp&&a<b;}}
    return false;
  };
  return !query.filters.length||(query.combine==='all'?query.filters.every(test):query.filters.some(test));
}
export function queryScreenRows(rows,raw={},offset=0) {
  const query=validateScreenQuery(raw);
  if(!Array.isArray(rows)||rows.length>100||!Number.isInteger(offset)||offset<0||offset>10000)throw new RangeError('Invalid screen result page');
  const compare=(a,b)=>{
    const x=screenValue(a,query.sort),y=screenValue(b,query.sort),hasX=present(x),hasY=present(y);
    if(hasX!==hasY)return hasX?-1:1;
    if(hasX&&x!==y){const c=typeof x==='number'&&typeof y==='number'?Math.sign(x-y):String(x)<String(y)?-1:1;return query.direction==='asc'?c:-c;}
    return a.index-b.index;
  };
  const all=rows.filter(r=>matchesScreen(r,query)).sort(compare);
  return {rows:all.slice(offset,offset+query.limit),all,total:all.length,errors:rows.filter(r=>r.error),query};
}
export function screenColumns(rows) {
  const names=new Set();for(const row of rows)for(const p of row.plots||[])names.add(p.name);
  if(names.size>64)throw new RangeError('Script generated more than 64 distinct column titles across the universe');
  return [...names].sort((a,b)=>a<b?-1:a>b?1:0);
}
export function screeningCSV(snapshot,query={}) {
  const result=queryScreenRows(snapshot.rows,query),rows=[...result.all,...result.errors],columns=screenColumns(rows);
  const cell=value=>{
    if(value==null||typeof value==='number'&&!Number.isFinite(value))return '""';
    let text=String(value);if(typeof value==='string'&&/^\s*[=+\-@\t\r\n]/.test(value))text="'"+text;
    return '"'+text.replaceAll('"','""')+'"';
  };
  const headers=['Symbol','Interval seconds','Snapshot cutoff UTC seconds','Last closed-bar end UTC seconds','Data age seconds','Bars','Price','Bar change %','Volume','Provenance',...columns,'Error'];
  return [headers,...rows.map(r=>[r.symbol,r.interval,snapshot.asOf,r.time,r.age,r.bars,r.price,r.change,r.volume,r.source,...columns.map(name=>screenValue(r,'plot:'+name)),r.error??''])].map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
}
