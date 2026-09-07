import {ScriptGraphics,GRAPHIC_CONSTANTS} from './script-graphics.js';
import {ScriptHeap,UNHANDLED_COLLECTION} from './script-collections.js';
import {computeStudies,supertrend} from './studies.js';
/** AureonScript: original, bounded financial-series interpreter. Never eval/Function.
 * See SCRIPTING.md for its deliberately explicit compatibility boundary.
 */
import {alignClosedSeries} from './analytics.js';
export class ScriptError extends Error {
  constructor(message,line=1,column=1){super(`Line ${line}:${column}: ${message}`);this.name='ScriptError';this.line=line;this.column=column;}
}
const binaryPrecedence={or:1,and:2,'==':3,'!=':3,'>':4,'<':4,'>=':4,'<=':4,'+':5,'-':5,'*':6,'/':6,'%':6};
const forbidden=new Set(['__proto__','prototype','constructor','window','document','globalThis','eval','Function','fetch','import','require']);
const isTrue=v=>typeof v==='number'?Number.isFinite(v)&&v!==0:!!v;
export function tokenize(source,line=1){const out=[];let p=0;
  while(p<source.length){const c=source[p];if(/\s/.test(c)){p++;continue;}const start=p;
    if(c==='"'||c==="'"){const quote=c;p++;let v='',closed=false;while(p<source.length){let ch=source[p++];if(ch===quote){closed=true;break;}if(ch==='\\'){ch=source[p++];v+=({n:'\n',t:'\t',r:'\r'}[ch]??ch);}else v+=ch;}if(!closed)throw new ScriptError('Unterminated string',line,start+1);out.push({kind:'literal',value:v,column:start+1});continue;}
    const num=source.slice(p).match(/^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/);if(num){p+=num[0].length;const value=Number(num[0]);if(!Number.isFinite(value))throw new ScriptError('Non-finite literal',line,start+1);out.push({kind:'literal',value,column:start+1});continue;}
    const name=source.slice(p).match(/^[A-Za-z_][A-Za-z0-9_.]*/);if(name){p+=name[0].length;if(name[0].split('.').some(s=>forbidden.has(s)))throw new ScriptError('Forbidden identifier',line,start+1);out.push({kind:'name',value:name[0],column:start+1});continue;}
    const op=['>=','<=','==','!=',':=','+=','-=','*=','/=','=>','&&','||'].find(x=>source.startsWith(x,p))||c;
    if(!['>=','<=','==','!=',':=','+=','-=','*=','/=','=>','&&','||','+','-','*','/','%','<','>','(',')','[',']',',','?',':','='].includes(op))throw new ScriptError('Unexpected character '+c,line,p+1);
    p+=op.length;out.push({kind:'operator',value:op==='&&'?'and':op==='||'?'or':op,column:start+1});
  }
  out.push({kind:'end',value:'EOF',column:p+1});return out;
}
let nextNode=0;
class ExpressionParser {
  constructor(text,line){this.tokens=tokenize(text,line);this.pos=0;this.line=line;}
  peek(v){return this.tokens[this.pos]?.value===v;}
  take(){return this.tokens[this.pos++];}
  expect(v){if(!this.peek(v))this.fail('Expected '+v);return this.take();}
  fail(message){throw new ScriptError(message,this.line,this.tokens[this.pos]?.column||1);}
  node(type,fields){return{type,...fields,id:++nextNode,line:this.line};}
  parse(min=0){let left;const t=this.take();
    if(t.kind==='literal')left=this.node('literal',{value:t.value});
    else if(['-','+','not'].includes(t.value))left=this.node('unary',{op:t.value,arg:this.parse(7)});
    else if(t.value==='('){left=this.parse();this.expect(')');}
    else if(t.value==='['){const items=[];if(!this.peek(']'))do{items.push(this.parse());if(!this.peek(','))break;this.take();}while(!this.peek(']'));this.expect(']');left=this.node('tuple',{items});}
    else if(t.kind==='name'){left=this.node('name',{name:t.value});}
    else this.fail('Expected expression');
    while(this.pos<this.tokens.length){
      if(left.type==='name'&&['array.new','map.new','matrix.new'].includes(left.name)&&this.peek('<')){this.take();const generics=[];do{const t=this.take();if(t.kind!=='name')this.fail('Expected generic type');generics.push(t.value);if(!this.peek(','))break;this.take();}while(true);this.expect('>');left.generics=generics;}
      if(this.peek('(')){if(left.type!=='name')this.fail('Only named whitelisted functions can be called');this.take();const args=[],named={};if(!this.peek(')'))do{if(this.tokens[this.pos].kind==='name'&&this.tokens[this.pos+1]?.value==='='){const name=this.take().value;this.take();if(Object.hasOwn(named,name))this.fail('Duplicate named argument '+name);named[name]=this.parse();}else args.push(this.parse());if(!this.peek(','))break;this.take();}while(!this.peek(')'));this.expect(')');left=this.node('call',{name:left.name,args,named,generics:left.generics||[]});continue;}
      if(this.peek('[')){this.take();const offset=this.parse();this.expect(']');left=this.node('history',{arg:left,offset});continue;}
      const op=this.tokens[this.pos].value,prec=binaryPrecedence[op];if(prec==null||prec<min)break;this.take();left=this.node('binary',{op,left,right:this.parse(prec+1)});
    }
    if(min===0&&this.peek('?')){this.take();const yes=this.parse();this.expect(':');const no=this.parse();left=this.node('ternary',{test:left,yes,no});}
    return left;
  }
  all(){const node=this.parse();if(!this.peek('EOF'))this.fail('Unexpected token '+this.tokens[this.pos].value);return node;}
}
const expression=(text,line)=>new ExpressionParser(text,line).all();
function logicalLines(source){const lines=[];let buffer='',balance=0,first=1,indent=0;
  for(const [index,raw]of source.split(/\r?\n/).entries()){
    if(raw.includes('\t'))throw new ScriptError('Use spaces, not tabs',index+1);
    let clean='',quote=null,escape=false;
    for(let j=0;j<raw.length;j++){const ch=raw[j];if(quote){clean+=ch;if(escape){escape=false;continue;}if(ch==='\\')escape=true;else if(ch===quote)quote=null;}else if(ch==='"'||ch==="'"){quote=ch;clean+=ch;}else if(ch==='/'&&raw[j+1]==='/')break;else {clean+=ch;if(ch==='('||ch==='[')balance++;if(ch===')'||ch===']')balance--;}}
    if(!clean.trim()&&!buffer)continue;if(!buffer){first=index+1;indent=raw.length-raw.trimStart().length;}
    buffer+=(buffer?' ':'')+clean.trim();if(balance<0)throw new ScriptError('Unmatched closing delimiter',index+1);
    if(balance===0){lines.push({text:buffer.trim(),indent,line:first});buffer='';}
  }
  if(balance||buffer)throw new ScriptError('Unclosed expression',first);return lines;
}
export function compileScript(source,options={}){
  if(typeof source!=='string'||source.length>100000)throw new ScriptError('Script limit is 100,000 characters');nextNode=0;const lines=logicalLines(source);let cursor=0;
  function block(indent){const statements=[];
    while(cursor<lines.length){const l=lines[cursor];if(l.indent<indent)break;if(l.indent>indent)throw new ScriptError('Unexpected indentation',l.line);if(l.text==='else'||l.text.startsWith('else if '))break;cursor++;
      if(l.text.startsWith('if ')){const test=expression(l.text.slice(3),l.line);if(cursor>=lines.length||lines[cursor].indent<=indent)throw new ScriptError('Expected indented if body',l.line);const yes=block(lines[cursor].indent);let no=[];
        if(lines[cursor]?.indent===indent&&lines[cursor].text==='else'){const elseLine=lines[cursor++];if(!lines[cursor]||lines[cursor].indent<=indent)throw new ScriptError('Expected else body',elseLine.line);no=block(lines[cursor].indent);}
        else if(lines[cursor]?.indent===indent&&lines[cursor].text.startsWith('else if ')){lines[cursor]={...lines[cursor],text:lines[cursor].text.slice(5)};no=blockOneIf(indent);}
        statements.push({type:'if',test,yes,no,line:l.line});continue;}
      const loop=l.text.match(/^for\s+([A-Za-z_]\w*)\s*=\s*(.+?)\s+to\s+(.+)$/);
      if(loop){if(!lines[cursor]||lines[cursor].indent<=indent)throw new ScriptError('Expected for body',l.line);statements.push({type:'for',name:loop[1],start:expression(loop[2],l.line),end:expression(loop[3],l.line),body:block(lines[cursor].indent),line:l.line});continue;}
      const importMatch=l.text.match(/^import\s+([A-Za-z0-9_/-]+)\s+as\s+([A-Za-z_]\w*)$/);
      if(importMatch){if(forbidden.has(importMatch[2]))throw new ScriptError('Forbidden import alias',l.line);statements.push({type:'import',library:importMatch[1],alias:importMatch[2],line:l.line});continue;}
      const record=l.text.match(/^type\s+([A-Za-z_]\w*)$/);
      if(record){const fields=[];while(lines[cursor]?.indent>indent){const f=lines[cursor++],m=f.text.match(/^([A-Za-z_]\w*)\s+([A-Za-z_]\w*)(?:\s*=\s*(.+))?$/);if(!m||forbidden.has(m[2]))throw new ScriptError('Expected typed record field',f.line);fields.push({type:m[1],name:m[2],value:m[3]?expression(m[3],f.line):null});}if(!fields.length||fields.length>64||new Set(fields.map(f=>f.name)).size!==fields.length)throw new ScriptError('Invalid record fields',l.line);statements.push({type:'record',name:record[1],fields,line:l.line});continue;}
      const fun=l.text.match(/^(?:(export)\s+)?(?:(method)\s+)?([A-Za-z_]\w*)\s*\(([^)]*)\)\s*=>\s*(.*)$/);
      if(fun){const parameters=fun[4].split(',').map(x=>x.trim()).filter(Boolean).map(x=>{const m=x.match(/^(?:([A-Za-z_]\w*)\s+)?([A-Za-z_]\w*)$/);if(!m)throw new ScriptError('Expected typed or untyped parameter',l.line);return {type:m[1],name:m[2]};});let body=fun[5]?expression(fun[5],l.line):null;if(!body){if(!lines[cursor]||lines[cursor].indent<=indent)throw new ScriptError('Expected function body',l.line);body=block(lines[cursor].indent);}statements.push({type:'function',name:fun[3],params:parameters.map(p=>p.name),parameters,method:!!fun[2],exported:!!fun[1],body,line:l.line});continue;}
      const tuple=l.text.match(/^\[([^\]]+)\]\s*=\s*(.+)$/);
      if(tuple){const names=tuple[1].split(',').map(x=>x.trim());if(names.some(n=>!/^\w+$/.test(n)||forbidden.has(n))||new Set(names.filter(n=>n!=='_')).size!==names.filter(n=>n!=='_').length)throw new ScriptError('Invalid tuple names',l.line);statements.push({type:'tupleAssign',names,value:expression(tuple[2],l.line),line:l.line});continue;}
      const assign=l.text.match(/^(?:(varip|var)\s+)?(?:(?:float|int|bool|string|color|line|box|label|table|(?:array|map|matrix)<[^>]+>|[A-Z]\w*)\s+)?([A-Za-z_][\w.]*)\s*(:=|\+=|-=|\*=|\/=|=(?!=))\s*(.+)$/);
      if(assign){if(assign[2].split('.').some(x=>forbidden.has(x)))throw new ScriptError('Forbidden variable',l.line);statements.push({type:'assign',persistent:!!assign[1],intrabar:assign[1]==='varip',name:assign[2],op:assign[3],value:expression(assign[4],l.line),line:l.line});}
      else statements.push({type:'expression',value:expression(l.text,l.line),line:l.line});
    }return statements;
  }
  function blockOneIf(indent){const rest=lines.slice(cursor);let end=cursor+1;while(end<lines.length&&lines[end].indent>indent)end++;if(lines[end]?.indent===indent&&lines[end].text==='else'){end++;while(end<lines.length&&lines[end].indent>indent)end++;}const tail=lines.splice(end);const parsed=block(indent);lines.push(...tail);return parsed;}
  const ast=block(lines[0]?.indent??0);if(cursor!==lines.length)throw new ScriptError('Unexpected else',lines[cursor].line);
  if(nextNode>5000)throw new ScriptError('AST limit is 5,000 nodes');
  function audit(node,scope='global'){
    if(!node||typeof node!=='object')return;
    if(Array.isArray(node)){for(const child of node)audit(child,scope);return;}
    if(node.type==='function'){
      if(scope!=='global'||forbidden.has(node.name)||node.params.some(p=>forbidden.has(p))||new Set(node.params).size!==node.params.length)throw new ScriptError('Invalid scalar function declaration',node.line);
      audit(node.body,'function');return;
    }
    if(node.type==='for'){if(forbidden.has(node.name))throw new ScriptError('Forbidden loop variable',node.line);audit(node.start,scope);audit(node.end,scope);audit(node.body,'loop');return;}
    if(node.type==='record'&&(scope!=='global'||forbidden.has(node.name)||['array','map','matrix','strategy','ta'].includes(node.name)))throw new ScriptError('Invalid record declaration',node.line);
    if(scope!=='global'&&node.type==='call'&&((scope==='loop'&&/^ta\./.test(node.name))||/^(request\.|input\.|strategy\.)/.test(node.name)||['plot','hline','plotshape','fill','bgcolor','barcolor','alertcondition'].includes(node.name)))throw new ScriptError('Stateful series calls must be outside scalar functions and loops',node.line);
    for(const value of Object.values(node))if(value&&typeof value==='object')audit(value,scope);
  }
  audit(ast);
  const imports=ast.filter(n=>n.type==='import');if(new Set(imports.map(x=>x.alias)).size!==imports.length)throw new ScriptError('Duplicate library alias');let nodes=nextNode,linked=[];
  for(const imp of imports){const entry=options.libraries?.[imp.library];if(!entry||typeof entry.source!=='string')throw new ScriptError('Local versioned library required: '+imp.library,imp.line);const stack=options.libraryStack||[];if(stack.includes(imp.library))throw new ScriptError('Cyclic versioned library import: '+imp.library,imp.line);if(stack.length>=8)throw new ScriptError('Library nesting limit is eight',imp.line);const library=compileScript(entry.source,{...options,libraryStack:[...stack,imp.library]});const functions=library.ast.filter(n=>n.type==='function');if(library.ast.some(n=>n.type!=='function'&&!(n.type==='expression'&&n.value.type==='call'&&n.value.name==='library')))throw new ScriptError('Libraries may contain only exported pure/series functions',imp.line);if(functions.some(f=>!f.exported))throw new ScriptError('Library functions require export declarations',imp.line);const names=new Set(functions.map(f=>f.name));const rewrite=n=>{if(!n||typeof n!=='object')return;if(Array.isArray(n)){n.forEach(rewrite);return;}if(n.id)n.id=++nodes;if((n.type==='call'||n.type==='function')&&names.has(n.name))n.name=imp.alias+'.'+n.name;for(const value of Object.values(n))if(value&&typeof value==='object')rewrite(value);};const copied=structuredClone(functions);rewrite(copied);linked.push(...copied);}
  if(nodes>5000)throw new ScriptError('Linked AST limit exceeded');return{ast:[...linked,...ast.filter(n=>n.type!=='import')],nodes,source};
}
const colors={blue:'#578bfa',red:'#ef6470',green:'#25bd9c',orange:'#efb466',purple:'#b698ed',yellow:'#ead074',white:'#ffffff',black:'#101419',aqua:'#61c7ca',teal:'#25bd9c',gray:'#8792a2',lime:'#78cf84',fuchsia:'#e281b4',maroon:'#a44865',silver:'#c0c5ce',navy:'#34558c',olive:'#8b965b'};
const baseFields={open:'o',high:'h',low:'l',close:'c',volume:'v'};
export function timeframeSeconds(text){const s=String(text);const m=s.match(/^(\d+)?([SDWM])?$/);if(!m)throw new ScriptError('Supported timeframes: minutes, nS, nD, nW');if(m[2]==='M')throw new ScriptError('Calendar-month security requests require an explicit calendar provider');const n=Number(m[1]||1);const v=n*({S:1,D:86400,W:604800}[m[2]]||60);if(!(v>0&&v<=31536000))throw new ScriptError('Invalid timeframe');return v;}
function technicalSignature(name){
  const key=name.startsWith('ta.')?name.slice(3):null;
  if(['sma','ema','rma','wma','rsi','highest','lowest','stdev','sum','change','roc','mom','cci','mfi'].includes(key))return ['source','length'];
  if(['crossover','crossunder','cross'].includes(key))return ['source1','source2'];
  if(key==='linreg')return ['source','length'];
  if(key==='valuewhen')return ['condition','source','occurrence'];
  if(key==='barssince')return ['condition'];if(key==='cum')return ['source'];if(key==='atr')return ['length'];
  if(key==='bb')return ['series','length','mult'];if(key==='macd')return ['source','fastlen','slowlen','siglen'];
  if(key==='dmi')return ['diLength','adxSmoothing'];if(key==='supertrend')return ['factor','atrPeriod'];if(key==='sar')return ['start','inc','max'];
  return null;
}
export function runScript(source,bars,options={}){
  const program=typeof source==='string'?compileScript(source,options):source;
  if(!Array.isArray(bars)||bars.length>250000)throw new ScriptError('Maximum 250,000 source bars');
  if(program.nodes*Math.max(1,bars.length)>24000000)throw new ScriptError('Script series-memory budget exceeded');
  let operations=0;const maxOperations=options.maxOperations??20000000,maxHistory=10000;
  const vars=new Map(),persistent=new Set(),intrabar=new Set(),initialized=new Set(),functions=new Map(),types=new Map(),states=new Map(),plots=new Map(),alerts=new Map(),commands=[],inputs=new Map(),fills=[],backgrounds=[];
  const meta={title:'Untitled script',overlay:false,kind:'indicator'};let current=0,depth=0;
  const profile=new Map(),brokerSeries=[];
  function budget(node){if(node?.line)profile.set(node.line,(profile.get(node.line)||0)+1);if(++operations>maxOperations)throw new ScriptError('Operation budget exceeded',node?.line);if(depth>64)throw new ScriptError('Call depth exceeded',node?.line);}
  const heap=new ScriptHeap({maxElements:options.maxCollectionElements??1000000,budget:()=>budget()});
  const graphics=new ScriptGraphics({maxObjects:options.maxGraphicObjects??500,budget:()=>budget()});
  const boundedString=v=>{const text=String(v);if(text.length>100000)throw new ScriptError('String length budget exceeded');return text;};
  const realtimeState=i=>options.realtimeStates?.[bars[i].t]||(i===bars.length-1&&options.realtime?{realtime:true,isNew:options.isNew!==false}:null);
  const intrabarSeeds=i=>options.varipSeedByTime?.[bars[i].t]||(i===bars.length-1?options.varipSeeds:null)||{};
  const stateKey=(node,locals)=>String(locals.__scope||'')+':'+node.id;
  function fail(node,text){throw new ScriptError(text,node.line);}
  function array(name){if(!vars.has(name)){if(vars.size>=256)throw new ScriptError('Variable count limit exceeded');vars.set(name,new Array(bars.length).fill(NaN));}return vars.get(name);}
  function value(node,i,locals={}){
    budget(node);if(i<0||i>=bars.length)return NaN;
    switch(node.type){
      case'literal':return node.value;
      case'tuple':return node.items.map(x=>value(x,i,locals));
      case'name':{
        const name=node.name;if(locals.__series?.has(name)){const binding=locals.__series.get(name);if(!binding.cache.has(i))binding.cache.set(i,value(binding.node,i,binding.locals));return binding.cache.get(i);}if(Object.hasOwn(locals,name))return locals[name];if(locals.__scope&&vars.has(locals.__scope+':'+name))return vars.get(locals.__scope+':'+name)[i];if(name==='true')return true;if(name==='false')return false;if(name==='na')return NaN;
        if(Object.hasOwn(baseFields,name))return bars[i][baseFields[name]];
        if(name==='hl2')return(bars[i].h+bars[i].l)/2;if(name==='hlc3')return(bars[i].h+bars[i].l+bars[i].c)/3;if(name==='ohlc4')return(bars[i].o+bars[i].h+bars[i].l+bars[i].c)/4;
        if(name==='time')return bars[i].t*1000;if(name==='bar_index')return i;if(name==='barstate.isconfirmed')return !bars[i].partial;if(name==='barstate.isfirst')return i===0;if(name==='barstate.islast')return i===bars.length-1;
        if(name==='syminfo.tickerid'||name==='syminfo.ticker')return options.symbol||'CHART';if(name==='syminfo.mintick')return options.tickSize||.01;if(name==='timeframe.period')return String((options.interval||3600)/60);
        if(name==='barstate.isrealtime')return !!realtimeState(i)?.realtime;if(name==='barstate.ishistory')return !realtimeState(i)?.realtime;if(name==='barstate.isnew')return realtimeState(i)?.isNew!==false;
        if(Object.hasOwn(GRAPHIC_CONSTANTS,name))return GRAPHIC_CONSTANTS[name];if(name==='yloc.price')return 'price';
        if(name==='order.ascending')return 'ascending';if(name==='order.descending')return 'descending';
        if(name==='strategy.long')return 1;if(name==='strategy.short')return -1;
        if(name.startsWith('strategy.')&&['position_size','position_avg_price','equity','initial_capital','netprofit','openprofit','opentrades','closedtrades','wintrades','losstrades'].includes(name.slice(9)))return brokerSeries[i]?.[name.slice(9)]??(name==='strategy.position_avg_price'?NaN:['strategy.equity','strategy.initial_capital'].includes(name)?options.initial??100000:0);
        if(name.startsWith('color.')&&Object.hasOwn(colors,name.slice(6)))return colors[name.slice(6)];
        if(['plot.style_line','plot.style_histogram','plot.style_columns','plot.style_circles','shape.triangleup','shape.triangledown','shape.circle','location.abovebar','location.belowbar'].includes(name))return name;
        if(vars.has(name))return vars.get(name)[i];
        if(name.includes('.')){const [root,...fields]=name.split('.');let object=value({...node,name:root},i,locals);for(const field of fields){if(object?.kind!=='record'||!Object.hasOwn(object.fields,field))fail(node,'Unknown record field '+field);object=object.fields[field];}return object;}
        fail(node,'Unknown identifier '+name);
      }
      case'history':{const n=value(node.offset,i,locals);if(!Number.isInteger(n)||n<0||n>maxHistory)fail(node,'History offset must be an integer from 0 to 10,000; future references are forbidden');return value(node.arg,i-n,locals);}
      case'unary':{const a=value(node.arg,i,locals);return node.op==='not'?!isTrue(a):node.op==='-'?-Number(a):Number(a);}
      case'binary':{
        const a=value(node.left,i,locals);if(node.op==='and')return isTrue(a)&&isTrue(value(node.right,i,locals));if(node.op==='or')return isTrue(a)||isTrue(value(node.right,i,locals));const b=value(node.right,i,locals);
        switch(node.op){case'+':return typeof a==='string'||typeof b==='string'?boundedString(String(a)+String(b)):a+b;case'-':return a-b;case'*':return a*b;case'/':return b===0?NaN:a/b;case'%':return b===0?NaN:a%b;case'==':return a===b;case'!=':return a!==b;case'>':return a>b;case'<':return a<b;case'>=':return a>=b;case'<=':return a<=b;}break;
      }
      case'ternary':return value(isTrue(value(node.test,i,locals))?node.yes:node.no,i,locals);
      case'call':return call(node,i,locals);
    }
    fail(node,'Unsupported expression');
  }
  function call(node,i,locals){
    const signature=technicalSignature(node.name);
    if(signature&&Object.keys(node.named).length){
      const args=[...node.args];if(args.length>signature.length)fail(node,'Too many function arguments');
      for(const[key,ast]of Object.entries(node.named)){const at=signature.indexOf(key);if(at<0||args[at])fail(node,'Unknown or duplicated '+node.name+' argument '+key);args[at]=ast;}
      node={...node,args,named:{}};
    }
    const name=node.name,arg=k=>node.args[k]?value(node.args[k],i,locals):undefined;
    const named=(k,def)=>node.named[k]?value(node.named[k],i,locals):def;
    const supported=(allowed)=>{for(const k of Object.keys(node.named))if(!allowed.includes(k))fail(node,'Unsupported '+name+' argument: '+k);};
    if(/^(line|box|label|table)\./.test(name)){if(i!==current)fail(node,'Graphic calls cannot re-execute on a past bar; retain a handle in a variable');return graphics.call(name,node.args.map(x=>value(x,i,locals)),Object.fromEntries(Object.entries(node.named).map(([k,x])=>[k,value(x,i,locals)])),i);}
    const builtin=()=>heap.call(name,node.args.map(x=>value(x,i,locals)),node.generics||[]);
    if(/^(array|map|matrix)\./.test(name)){supported([]);return builtin();}
    let functionName=name,methodObject=null;
    if(!functions.has(name)&&name.includes('.')){const dot=name.lastIndexOf('.'),root=name.slice(0,dot),method=name.slice(dot+1);if(vars.has(root)||locals.__series?.has(root)||Object.hasOwn(locals,root)||locals.__scope&&vars.has(locals.__scope+':'+root)){methodObject=value({type:'name',name:root,line:node.line},i,locals);if(['array','map','matrix'].includes(methodObject?.kind))return heap.call(methodObject.kind+'.'+method,[methodObject,...node.args.map(x=>value(x,i,locals))]);if(methodObject?.kind==='record')functionName=methodObject.type+'.'+method;}}
    if(functions.has(functionName)){
      const fn=functions.get(functionName),offset=methodObject?1:0,params=fn.params.slice(offset),bound=new Map();
      if(node.args.length>params.length)fail(node,'Function argument count mismatch');
      node.args.forEach((v,j)=>bound.set(params[j],v));
      for(const[key,v]of Object.entries(node.named)){if(!params.includes(key)||bound.has(key))fail(node,'Unknown or duplicated function argument '+key);bound.set(key,v);}
      if(bound.size!==params.length)fail(node,'Function argument count mismatch');
      const next={__scope:(locals.__scope||'')+'>'+node.id,__series:new Map()};if(offset)next[fn.params[0]]=methodObject;
      for(const [j,param]of params.entries()){
        const ast=bound.get(param),actual=value(ast,i,locals),type=fn.parameters?.[j+offset]?.type;if(type)heap.type(actual,type);
        next.__series.set(param,{node:ast,locals,cache:new Map([[i,actual]])});
      }
      depth++;try{return Array.isArray(fn.body)?execute(fn.body,i,next):value(fn.body,i,next);}finally{depth--;}
    }
    if(name.endsWith('.new')&&types.has(name.slice(0,-4))){const def=types.get(name.slice(0,-4)),fields={},specs={};if(node.args.length>def.fields.length)fail(node,'Too many record constructor values');for(const key of Object.keys(node.named))if(!def.fields.some(f=>f.name===key))fail(node,'Unknown constructor field '+key);def.fields.forEach((f,j)=>{const fallback=f.type==='bool'?false:['string','color'].includes(f.type)?'':NaN;fields[f.name]=node.named[f.name]?value(node.named[f.name],i,locals):node.args[j]?arg(j):f.value?value(f.value,i,locals):fallback;specs[f.name]=f.type;});return heap.record(def.name,fields,specs);}
    if(name==='library')return 0;
    if(name.startsWith('str.')){const a=arg(0);switch(name){case'str.length':return String(a).length;case'str.tonumber':{const n=Number(a);return Number.isFinite(n)?n:NaN;}case'str.contains':return String(a).includes(String(arg(1)));case'str.substring':return String(a).slice(arg(1),arg(2));case'str.lower':return String(a).toLowerCase();case'str.upper':return String(a).toUpperCase();case'str.replace_all':{const text=boundedString(a),search=boundedString(arg(1)),replacement=boundedString(arg(2));const parts=text.split(search);const size=parts.reduce((n,x)=>n+x.length,0)+(parts.length-1)*replacement.length;if(size>100000)fail(node,'String length budget exceeded');return parts.join(replacement);}case'str.split':{const text=boundedString(a),separator=boundedString(arg(1));const parts=text.split(separator,10001);if(parts.length>10000)fail(node,'Split exceeds collection capacity');return heap.array(parts,'string');}}}
    if(name==='indicator'||name==='strategy'){supported(['title','overlay','shorttitle']);if(i===0){meta.title=String(arg(0)??named('title','Untitled'));meta.overlay=!!named('overlay',false);meta.kind=name;}return 0;}
    if(name.startsWith('input.')){
      if(!['input.int','input.float','input.bool','input.string','input.source'].includes(name))fail(node,'Unsupported input type');supported(['defval','title','minval','maxval','step']);const fallback=arg(0)??named('defval',0),title=String(arg(1)??named('title','Input '+node.id));let v=options.inputs?.[title]??fallback;
      if(name==='input.source'){const selected=options.inputs?.[title]??node.args[0]?.name;if(typeof selected!=='string'||!Object.hasOwn(baseFields,selected))fail(node,'input.source requires open, high, low, close or volume');v=bars[i][baseFields[selected]];if(i===0)inputs.set(title,{title,type:name,value:selected});return v;}
      else if(name==='input.bool'){if(typeof v!=='boolean')fail(node,'Boolean input required for '+title);}else if(name==='input.string')v=boundedString(v);else{v=Number(v);if(!Number.isFinite(v)||(name==='input.int'&&!Number.isInteger(v))||v<named('minval',-Infinity)||v>named('maxval',Infinity))fail(node,'Invalid input '+title);}
      if(i===0)inputs.set(title,{title,type:name,value:v});return v;
    }
    if(name==='nz'){const a=arg(0);return a==null||Number.isNaN(a)?(arg(1)??0):a;}
    if(name==='na')return arg(0)==null||Number.isNaN(arg(0));
    if(name==='float'||name==='int'||name==='bool'||name==='str.tostring')return name==='bool'?isTrue(arg(0)):name==='str.tostring'?boundedString(arg(0)):name==='int'?Math.trunc(Number(arg(0))):Number(arg(0));
    if(name==='color.new'){supported([]);const color=String(arg(0)),alpha=Math.max(0,Math.min(100,Number(arg(1))));if(!/^#[a-f\d]{6}$/i.test(color))fail(node,'Invalid color');return color+Math.round(255*(1-alpha/100)).toString(16).padStart(2,'0');}
    if(name.startsWith('math.')){const key=name.slice(5),fns={abs:Math.abs,sqrt:Math.sqrt,log:Math.log,log10:Math.log10,exp:Math.exp,pow:Math.pow,min:Math.min,max:Math.max,round:Math.round,floor:Math.floor,ceil:Math.ceil,sign:Math.sign,sin:Math.sin,cos:Math.cos};if(!Object.hasOwn(fns,key))fail(node,'Unsupported math function');return fns[key](...node.args.map((a)=>value(a,i,locals)));}
    if(['ta.macd','ta.bb','ta.bbw','ta.hma','ta.dema','ta.tema'].includes(name)){
      const n=(suffix,key,args)=>({type:'call',name:'ta.'+key,args,named:{},id:String(node.id)+suffix,line:node.line});
      const binary=(op,left,right)=>({type:'binary',op,left,right,line:node.line}),literal=v=>({type:'literal',value:v,line:node.line});const src=node.args[0];
      if(name==='ta.macd'){const fast=n('f','ema',[src,node.args[1]]),slow=n('s','ema',[src,node.args[2]]),line=binary('-',fast,slow),signal=n('g','ema',[line,node.args[3]]);return [value(line,i,locals),value(signal,i,locals),value(binary('-',line,signal),i,locals)];}
      if(name==='ta.bb'||name==='ta.bbw'){const mid=n('m','sma',[src,node.args[1]]),std=n('d','stdev',[src,node.args[1]]),m=value(mid,i,locals),d=value(std,i,locals)*arg(2);return name==='ta.bbw'?(m?2*d/m:NaN):[m,m+d,m-d];}
      if(name==='ta.hma'){const length=arg(1);if(!Number.isInteger(length)||length<1||length>10000)fail(node,'Invalid HMA period');const a=n('a','wma',[src,literal(Math.max(1,Math.floor(length/2)))]),b=n('b','wma',[src,literal(length)]);return value(n('h','wma',[binary('-',binary('*',literal(2),a),b),literal(Math.max(1,Math.floor(Math.sqrt(length))))]),i,locals);}
      const a=n('a','ema',[src,node.args[1]]),b=n('b','ema',[a,node.args[1]]),av=value(a,i,locals),bv=value(b,i,locals);return name==='ta.dema'?2*av-bv:3*av-3*bv+value(n('c','ema',[b,node.args[1]]),i,locals);
    }
    if(name==='ta.cci'||name==='ta.mfi'){
      const length=arg(1);if(!Number.isInteger(length)||length<1||length>maxHistory)fail(node,'Invalid study period');if(i<length-1)return NaN;
      const sample=j=>Number(value(node.args[0],j,locals));let sum=0,positive=0,negative=0;
      for(let j=i-length+1;j<=i;j++){budget(node);const x=sample(j);if(!Number.isFinite(x))return NaN;sum+=x;if(name==='ta.mfi'&&j>0){const prev=sample(j-1);if(!Number.isFinite(prev))return NaN;if(x>prev)positive+=x*bars[j].v;else if(x<prev)negative+=x*bars[j].v;}}
      if(name==='ta.mfi')return negative===0?(positive===0?50:100):100-100/(1+positive/negative);
      const mean=sum/length;let deviation=0;for(let j=i-length+1;j<=i;j++){budget(node);deviation+=Math.abs(sample(j)-mean);}deviation/=length;return deviation?(sample(i)-mean)/(.015*deviation):0;
    }
    if(['ta.dmi','ta.supertrend','ta.sar'].includes(name)){
      const type={'ta.dmi':'dmi','ta.supertrend':'supertrend','ta.sar':'sar'}[name],params=type==='dmi'?{length:arg(0),smooth:arg(1)}:type==='supertrend'?{mult:arg(0),length:arg(1)}:{step:arg(0),max:arg(2)};
      if(type==='sar'&&arg(0)!==arg(1))fail(node,'This SAR model requires equal start and acceleration increment');
      const key=stateKey(node,locals),signature=JSON.stringify(params);let state=states.get(key);
      if(!state){if(operations+bars.length*40>maxOperations)fail(node,'Operation budget exceeded');operations+=bars.length*40;state={signature,result:computeStudies(bars,[{id:'technical',type,params}])[0]};if(type==='supertrend')state.direction=supertrend(bars,params.length,params.mult).direction;states.set(key,state);}
      if(state.signature!==signature)fail(node,'Study parameters must remain constant');const plots=state.result.plots;if(type==='dmi')return plots.map(p=>p.values[i]);if(type==='supertrend'){const trend=plots[0].values[i];return [trend,Number.isFinite(trend)?-state.direction[i]:NaN];}return plots[0].values[i];
    }
    if(name.startsWith('ta.'))return technical(node,i,locals);
    if(name==='request.security_lower_tf'){
      supported([]);const symbol=String(arg(0)),interval=timeframeSeconds(arg(1)),base=options.interval||3600;if(interval>=base)fail(node,'Lower-timeframe request must be below chart interval');const dataset=options.datasets?.[`${symbol}:${interval}`];if(!dataset)fail(node,'Explicit lower-timeframe dataset required');const key=stateKey(node,locals);let state=states.get(key);if(!state){if(!node.args[2])fail(node,'Requested expression required');const child={nodes:program.nodes,ast:[{type:'assign',name:'requested',op:'=',value:node.args[2],line:node.line}]};const remote=runScript(child,dataset.bars,{...options,beforeBar:undefined,afterBar:undefined,symbol,interval,datasets:{},realtime:false,realtimeStates:{},varipSeedByTime:{},varipSeeds:{},capture:['requested'],maxOperations:Math.max(1,maxOperations-operations)});operations+=remote.operations;state={values:remote.captured.requested};states.set(key,state);}const end=Math.min(bars[i].t+base,options.realtime&&i===bars.length-1?(options.asOf??bars[i].t):Infinity),values=[];let lo=0,hi=dataset.bars.length;while(lo<hi){budget(node);const mid=(lo+hi)>>>1;if(dataset.bars[mid].t<bars[i].t)lo=mid+1;else hi=mid;}for(let j=lo;j<dataset.bars.length&&dataset.bars[j].t+interval<=end;j++){budget(node);if(!dataset.bars[j].partial)values.push(state.values[j]);}return heap.array(values,'float');
    }
    if(name==='request.security'){
      supported(['lookahead','gaps']);if(node.named.lookahead||node.named.gaps)fail(node,'Only closed-bar alignment with gaps carried forward is supported');
      let state=states.get(stateKey(node,locals));if(!state){const symbol=String(arg(0)),tf=String(arg(1)),interval=timeframeSeconds(tf);if(interval<(options.interval||3600))fail(node,'Lower-timeframe security is not supported; supply aligned higher-timeframe data');const ds=options.datasets?.[`${symbol}:${interval}`];if(!ds)fail(node,`Dataset required: ${symbol}:${interval}`);
        const expr=node.args[2];if(!expr)fail(node,'Security requires an expression');const childProgram={nodes:program.nodes,ast:[{type:'expression',value:{type:'call',name:'plot',args:[expr],named:{},id:nextNode+100000+node.id,line:node.line},line:node.line}]};
        const remote=runScript(childProgram,ds.bars,{...options,beforeBar:undefined,afterBar:undefined,symbol,interval,datasets:{},maxOperations:Math.max(1,maxOperations-operations)});operations+=remote.operations;
        state={aligned:alignClosedSeries(bars,ds.bars,remote.plots[0].values,interval,options.interval||3600)};states.set(stateKey(node,locals),state);
      }return state.aligned[i];
    }
    if(name==='plot'||name==='hline'||name==='plotshape'){
      supported(['title','color','linewidth','style','location','text','offset']);if(Number(named('offset',0))!==0)fail(node,'Nonzero plot offsets are not supported');
      if(plots.size>=64&&!plots.has(node.id))fail(node,'Plot count limit is 64');let plot=plots.get(node.id);if(!plot){plot={id:node.id,name:String(arg(1)??named('title',name+' '+(plots.size+1))),values:new Float64Array(bars.length).fill(NaN),colors:new Array(bars.length),color:String(named('color',arg(2)??'#578bfa')),width:Number(named('linewidth',arg(3)??1.5)),style:String(named('style','plot.style_line')),kind:name,location:String(named('location','location.belowbar'))};plots.set(node.id,plot);}
      const x=arg(0);plot.values[i]=name==='plotshape'?(isTrue(x)?(plot.location==='location.abovebar'?bars[i].h:bars[i].l):NaN):Number(x);plot.colors[i]=String(named('color',arg(2)??plot.color));return node.id;
    }
    if(name==='fill'){supported(['color','title']);if(i===0)fills.push({from:arg(0),to:arg(1),color:named('color',arg(2)??'#578bfa33')});return 0;}
    if(name==='bgcolor'||name==='barcolor'){supported(['title']);let record=backgrounds.find(x=>x.id===node.id);if(!record){record={id:node.id,kind:name,values:new Array(bars.length)};backgrounds.push(record);}record.values[i]=arg(0);return 0;}
    if(name==='alertcondition'){supported(['title','message']);let record=alerts.get(node.id);if(!record){record={id:node.id,title:String(arg(1)??named('title','Script alert')),message:String(arg(2)??named('message','Condition met')),values:new Uint8Array(bars.length)};alerts.set(node.id,record);}record.values[i]=isTrue(arg(0))?1:0;return 0;}
    if(['strategy.entry','strategy.close','strategy.close_all','strategy.exit','strategy.cancel','strategy.cancel_all'].includes(name)){
      supported(['qty','when','limit','stop','from_entry']);if(meta.kind!=='strategy')fail(node,'Declare strategy() before order commands');if(!isTrue(named('when',true)))return 0;
      const action=name.slice(9),direction=action==='entry'?Number(arg(1)):0;if(action==='entry'&&![1,-1].includes(direction))fail(node,'Entry direction must be strategy.long or strategy.short');
      const quantity=named('qty',null);if(quantity!=null&&!(Number.isFinite(quantity)&&quantity>0))fail(node,'Order quantity must be positive');const command={index:i,t:bars[i].t,id:boundedString(arg(0)??'all'),action,direction,quantity};
      if(command.id.length>128)fail(node,'Order ID length exceeds 128');for(const key of ['limit','stop']){const price=named(key,null);if(price!=null){if(!Number.isFinite(price)||price<=0)fail(node,'Order price must be positive');command[key]=price;}}
      if(action==='exit'){const from=named('from_entry',arg(1));if(from!=null){command.fromEntry=boundedString(from);if(command.fromEntry.length>128)fail(node,'Entry ID length exceeds 128');}if(command.limit==null&&command.stop==null)fail(node,'Exit requires an explicit stop or limit');}if((command.limit!=null||command.stop!=null)&&!['entry','exit'].includes(action))fail(node,'Prices apply only to entries/exits');commands.push(command);return 0;
    }
    fail(node,'Unsupported function '+name);
  }
  function technical(node,i,locals){
    const key=node.name.slice(3),src=node.args[0],get=(a,j)=>a?Number(value(a,j,locals)):NaN;
    if(!['crossover','crossunder','cross','change','roc','mom','valuewhen','barssince','cum','ema','rma','rsi','atr','sma','wma','highest','lowest','stdev','sum','linreg'].includes(key))fail(node,'Unsupported technical function '+node.name);
    if(Object.keys(node.named).length)fail(node,'Technical functions currently require positional arguments');
    if(key==='crossover'||key==='crossunder'||key==='cross'){const a=get(src,i),b=get(node.args[1],i),ap=get(src,i-1),bp=get(node.args[1],i-1);return key==='crossover'?a>b&&ap<=bp:key==='crossunder'?a<b&&ap>=bp:(a>b&&ap<=bp)||(a<b&&ap>=bp);}
    if(key==='change'||key==='roc'||key==='mom'){const n=node.args[1]?get(node.args[1],i):1;if(!Number.isInteger(n)||n<0||n>maxHistory)fail(node,'Invalid history length');const a=get(src,i),p=get(src,i-n);return key==='roc'?(p?(a/p-1)*100:NaN):a-p;}
    if(key==='valuewhen'){const occurrence=get(node.args[2],i);if(!Number.isInteger(occurrence)||occurrence<0||occurrence>1000)fail(node,'Invalid occurrence');let found=0;for(let j=i;j>=Math.max(0,i-maxHistory);j--){budget(node);if(isTrue(value(src,j,locals))){if(found++===occurrence)return get(node.args[1],j);}}return NaN;}
    if(key==='barssince'){let s=states.get(stateKey(node,locals));if(!s){s={values:new Float64Array(bars.length).fill(NaN),last:-1,count:NaN};states.set(stateKey(node,locals),s);}while(s.last<i){const j=++s.last;s.count=isTrue(value(src,j,locals))?0:Number.isFinite(s.count)?s.count+1:NaN;s.values[j]=s.count;}return s.values[i];}
    if(key==='cum'){let s=states.get(stateKey(node,locals));if(!s){s={values:new Float64Array(bars.length).fill(NaN),last:-1,sum:0};states.set(stateKey(node,locals),s);}while(s.last<i){const j=++s.last;s.sum+=get(src,j);s.values[j]=s.sum;}return s.values[i];}
    const isAtr=key==='atr',n=isAtr?get(src,i):get(node.args[1],i);
    if(!Number.isInteger(n)||n<1||n>maxHistory)fail(node,'Study length must be an integer from 1 to 10,000');
    const sample=j=>isAtr?(j?Math.max(bars[j].h-bars[j].l,Math.abs(bars[j].h-bars[j-1].c),Math.abs(bars[j].l-bars[j-1].c)):bars[j].h-bars[j].l):get(src,j);
    if(['ema','rma','rsi','atr'].includes(key)){
      let s=states.get(stateKey(node,locals));if(!s){s={values:new Float64Array(bars.length).fill(NaN),last:-1,n,sum:0,count:0,prev:NaN,gain:0,loss:0};states.set(stateKey(node,locals),s);}if(s.n!==n)fail(node,'Recursive study lengths must remain constant');
      while(s.last<i){const j=++s.last;budget(node);const x=sample(j);if(key==='rsi'){
        if(j===0)continue;const d=x-sample(j-1);if(!Number.isFinite(d)){s.count=0;s.gain=0;s.loss=0;continue;}const gain=Math.max(0,d),loss=Math.max(0,-d);if(s.count<n){s.gain+=gain;s.loss+=loss;s.count++;if(s.count===n){s.gain/=n;s.loss/=n;}}else{s.gain=(s.gain*(n-1)+gain)/n;s.loss=(s.loss*(n-1)+loss)/n;}if(s.count>=n)s.values[j]=s.loss===0?(s.gain===0?50:100):100-100/(1+s.gain/s.loss);
      }else{if(!Number.isFinite(x)){s.count=0;s.sum=0;s.prev=NaN;continue;}if(!Number.isFinite(s.prev)){s.sum+=x;s.count++;if(s.count===n)s.prev=s.sum/n;}else{const alpha=key==='ema'?2/(n+1):1/n;s.prev+=alpha*(x-s.prev);}s.values[j]=s.prev;}}
      return s.values[i];
    }
    if(i<n-1)return NaN;
    if(!['sma','wma','highest','lowest','stdev','sum','linreg'].includes(key))fail(node,'Unsupported technical function '+node.name);
    let sum=0,weighted=0,min=Infinity,max=-Infinity,mean=0,m2=0;for(let k=0;k<n;k++){budget(node);const x=sample(i-n+1+k);if(!Number.isFinite(x))return NaN;sum+=x;weighted+=(k+1)*x;min=Math.min(min,x);max=Math.max(max,x);const d=x-mean;mean+=d/(k+1);m2+=d*(x-mean);}
    if(key==='sma')return sum/n;if(key==='sum')return sum;if(key==='wma')return weighted/(n*(n+1)/2);if(key==='highest')return max;if(key==='lowest')return min;if(key==='stdev')return Math.sqrt(Math.max(0,m2/n));
    if(n===1)return sum;const sx=n*(n-1)/2,sxx=n*(n-1)*(2*n-1)/6,slope=(n*(weighted-sum)-sx*sum)/(n*sxx-sx*sx);return(sum-slope*sx)/n+slope*(n-1);
  }
  function execute(statements,i,locals={}){let result=NaN;for(const s of statements){budget(s);
    if(s.type==='record'){if(!types.has(s.name))types.set(s.name,s);continue;}
    if(s.type==='function'){if(i===0){const key=s.method?s.parameters[0]?.type+'.'+s.name:s.name;if(s.method&&!s.parameters[0]?.type)fail(s,'Method receiver requires a declared type');if(functions.has(key))fail(s,'Duplicate function');functions.set(key,s);}continue;}
    if(s.type==='expression'){result=value(s.value,i,locals);continue;}
    if(s.type==='if'){result=execute(isTrue(value(s.test,i,locals))?s.yes:s.no,i,locals);continue;}
    if(s.type==='for'){const start=value(s.start,i,locals),end=value(s.end,i,locals);if(!Number.isInteger(start)||!Number.isInteger(end)||Math.abs(end-start)>1000)fail(s,'For-loop limit is 1,001 integer iterations');const delta=end>=start?1:-1;for(let k=start;delta>0?k<=end:k>=end;k+=delta)result=execute(s.body,i,{...locals,[s.name]:k});continue;}
    const qualified=name=>locals.__scope?locals.__scope+':'+name:name;
    if(s.type==='tupleAssign'){const tuple=value(s.value,i,locals);if(!Array.isArray(tuple)||tuple.length!==s.names.length)fail(s,'Tuple arity mismatch');s.names.forEach((name,j)=>{if(name!=='_')array(qualified(name))[i]=tuple[j];});result=tuple.at(-1);continue;}
    if(s.type==='assign'){
      if(s.name.includes('.')){if(s.persistent)fail(s,'Fields cannot be declared var');const parts=s.name.split('.'),field=parts.pop(),object=value({type:'name',name:parts.join('.'),line:s.line},i,locals);if(object?.kind!=='record'||!Object.hasOwn(object.fields,field))fail(s,'Unknown mutable record field');const v=value(s.value,i,locals);heap.type(v,object.specs[field]);heap.preventCycle(object,v);if(!['=',':='].includes(s.op))fail(s,'Use explicit field reassignment');object.fields[field]=v;result=v;continue;}
      if(locals.__series?.has(s.name))fail(s,'Function parameters cannot be reassigned');
      const name=qualified(s.name);if(s.persistent)persistent.add(name);if(s.intrabar)intrabar.add(name);const a=array(name);if(s.persistent&&initialized.has(name))continue;
      if(s.persistent)initialized.add(name);
      const seed=s.intrabar&&Object.hasOwn(intrabarSeeds(i),name)?intrabarSeeds(i)[name]:undefined;
      const v=seed===undefined?value(s.value,i,locals):structuredClone(seed);if(s.op==='='||s.op===':=')a[i]=v;else{const old=a[i];a[i]=s.op==='+='?old+v:s.op==='-='?old-v:s.op==='*='?old*v:v===0?NaN:old/v;}result=a[i];
    }
  }return result;}
  for(current=0;current<bars.length;current++){
    if(current){const names=[...persistent],clones=heap.cloneRoots(names.map(name=>array(name)[current-1]));names.forEach((name,j)=>array(name)[current]=clones[j]);}
    for(const[name,seed]of Object.entries(intrabarSeeds(current)))if(intrabar.has(name))array(name)[current]=structuredClone(seed);
    brokerSeries[current]=options.beforeBar?.(current)??{};
    const commandStart=commands.length;execute(program.ast,current);
    options.afterBar?.(current,commands.slice(commandStart));
  }
  const captured={};for(const name of (options.capture||[]).slice(0,16))if(vars.has(name))captured[name]=vars.get(name);
  return{...meta,plots:[...plots.values()],alerts:[...alerts.values()],commands,inputs:[...inputs.values()],fills,backgrounds,operations,bars:bars.length,captured,
    varip:Object.fromEntries([...intrabar].map(name=>[name,array(name).at(-1)])),profile:[...profile].map(([line,operations])=>({line,operations})).sort((a,b)=>b.operations-a.operations),heap:{elements:heap.elements,objects:heap.objects},
    graphics:graphics.snapshot(),compatibility:'AureonScript 4: original bounded financial-series language'};
}
/** Re-evaluates committed history for each open-bar update: ordinary var state is
 * rolled back; only varip seeds survive successive updates to that same bar. */
export class RealtimeScriptSession {
  constructor(source,options={}){this.source=source;this.options=options;this.closed=[];this.varip={};this.openTime=null;this.varipSeedByTime={};this.realtimeStates={};}
  update(bar,{confirmed=false,asOf=bar.t}={}){
    if(!bar||!Number.isFinite(bar.t)||!Number.isFinite(asOf)||asOf<bar.t)throw new ScriptError('Invalid realtime timestamp');
    if(this.closed.length&&bar.t<=this.closed.at(-1).t)throw new ScriptError('Cannot revise committed realtime history');
    if(this.openTime!==null&&bar.t!==this.openTime)throw new ScriptError('Confirm or discard the open bar before advancing');
    const isNew=this.openTime===null,seed=structuredClone(this.varip);
    const result=runScript(this.source,[...this.closed,{...bar,partial:!confirmed}],{...this.options,realtime:true,isNew,asOf,varipSeeds:seed,varipSeedByTime:this.varipSeedByTime,realtimeStates:this.realtimeStates});
    this.openTime=bar.t;this.varip=result.varip;
    if(confirmed){this.closed.push({...bar,partial:false});this.varipSeedByTime[bar.t]=seed;this.realtimeStates[bar.t]={realtime:true,isNew};this.openTime=null;this.varip={};}
    return result;
  }
  discard(){this.openTime=null;this.varip={};}
  reset(bars=[]){if(bars.some(b=>b.partial))throw new ScriptError('Seed only closed bars');this.closed=structuredClone(bars);this.varip={};this.openTime=null;this.varipSeedByTime={};this.realtimeStates={};}
}
export const SCRIPT_EXAMPLES={
  retained:"indicator(\"Price annotation and status\", overlay=true)\nvar line guide = line.new(0, close, 1, close, color=color.aqua, width=2, extend=extend.right)\nline.set_xy2(guide, bar_index, close)\nvar label priceTag = label.new(0, close, \"Close\", style=label.style_label_down)\nlabel.set_xy(priceTag, bar_index, close)\nlabel.set_text(priceTag, str.tostring(close))\nvar table status = table.new(position.top_right, 2, 2)\ntable.cell(status, 0, 0, \"Symbol\")\ntable.cell(status, 1, 0, syminfo.tickerid)\ntable.cell(status, 0, 1, \"Close\")\ntable.cell(status, 1, 1, str.tostring(close), text_color=color.aqua)\nplot(ta.ema(source=close, length=20), \"EMA 20\")\n",
  feedback:"strategy(\"Position-aware crossover\", overlay=true)\nfast = ta.ema(source=close, length=12)\nslow = ta.ema(source=close, length=26)\nif ta.crossover(fast, slow) and strategy.position_size == 0\n    strategy.entry(\"trend\", strategy.long, qty=1)\nif ta.crossunder(fast, slow) and strategy.position_size > 0\n    strategy.close(\"trend\")\nplot(fast, \"Fast\", color=color.aqua)\nplot(slow, \"Slow\", color=color.orange)\n",
  trend:`// AureonScript 1\nindicator("Adaptive trend", overlay=true)\nlength = input.int(21, "Length", minval=1, maxval=500)\nfast = ta.ema(close, length)\nslow = ta.sma(close, length * 2)\nplot(fast, "Fast EMA", color.blue, 2)\nplot(slow, "Slow SMA", color.orange, 2)\nplotshape(ta.crossover(fast, slow), title="Bull cross", color=color.green, location=location.belowbar)\nalertcondition(ta.crossover(fast, slow), "Bull cross", "Fast EMA crossed above slow SMA")`,
  strategy:`// AureonScript 1\nstrategy("Dual moving-average strategy", overlay=true)\nfastLen = input.int(12, "Fast", minval=1, maxval=100)\nslowLen = input.int(26, "Slow", minval=2, maxval=300)\nfast = ta.ema(close, fastLen)\nslow = ta.ema(close, slowLen)\nplot(fast, "Fast", color.blue)\nplot(slow, "Slow", color.orange)\nif ta.crossover(fast, slow)\n    strategy.entry("Long", strategy.long)\nif ta.crossunder(fast, slow)\n    strategy.entry("Short", strategy.short)`,
  oscillator:`indicator("Relative strength", overlay=false)\nn = input.int(14, "Length", minval=1, maxval=500)\nr = ta.rsi(close, n)\nplot(r, "RSI", color.purple, 2)\nhline(70, "Overbought", color.red)\nhline(30, "Oversold", color.green)\nalertcondition(ta.crossover(r, 30), "RSI recovery", "RSI crossed above 30")`,
  cumulative:`indicator("Cumulative close change", overlay=false)\nvar float total = 0\ntotal := nz(total[1]) + nz(ta.change(close))\nplot(total, "Cumulative delta", color.teal)`
};
