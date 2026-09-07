/** AureonScript: original, bounded, Pine-inspired interpreter. Never eval/Function.
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
    else if(t.kind==='name'){left=this.node('name',{name:t.value});}
    else this.fail('Expected expression');
    while(this.pos<this.tokens.length){
      if(this.peek('(')){if(left.type!=='name')this.fail('Only named whitelisted functions can be called');this.take();const args=[],named={};if(!this.peek(')'))do{if(this.tokens[this.pos].kind==='name'&&this.tokens[this.pos+1]?.value==='='){const name=this.take().value;this.take();if(Object.hasOwn(named,name))this.fail('Duplicate named argument '+name);named[name]=this.parse();}else args.push(this.parse());if(!this.peek(','))break;this.take();}while(!this.peek(')'));this.expect(')');left=this.node('call',{name:left.name,args,named});continue;}
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
export function compileScript(source){
  if(typeof source!=='string'||source.length>100000)throw new ScriptError('Script limit is 100,000 characters');nextNode=0;const lines=logicalLines(source);let cursor=0;
  function block(indent){const statements=[];
    while(cursor<lines.length){const l=lines[cursor];if(l.indent<indent)break;if(l.indent>indent)throw new ScriptError('Unexpected indentation',l.line);if(l.text==='else'||l.text.startsWith('else if '))break;cursor++;
      if(l.text.startsWith('if ')){const test=expression(l.text.slice(3),l.line);if(cursor>=lines.length||lines[cursor].indent<=indent)throw new ScriptError('Expected indented if body',l.line);const yes=block(lines[cursor].indent);let no=[];
        if(lines[cursor]?.indent===indent&&lines[cursor].text==='else'){const elseLine=lines[cursor++];if(!lines[cursor]||lines[cursor].indent<=indent)throw new ScriptError('Expected else body',elseLine.line);no=block(lines[cursor].indent);}
        else if(lines[cursor]?.indent===indent&&lines[cursor].text.startsWith('else if ')){lines[cursor]={...lines[cursor],text:lines[cursor].text.slice(5)};no=blockOneIf(indent);}
        statements.push({type:'if',test,yes,no,line:l.line});continue;}
      const loop=l.text.match(/^for\s+([A-Za-z_]\w*)\s*=\s*(.+?)\s+to\s+(.+)$/);
      if(loop){if(!lines[cursor]||lines[cursor].indent<=indent)throw new ScriptError('Expected for body',l.line);statements.push({type:'for',name:loop[1],start:expression(loop[2],l.line),end:expression(loop[3],l.line),body:block(lines[cursor].indent),line:l.line});continue;}
      const fun=l.text.match(/^([A-Za-z_]\w*)\s*\(([^)]*)\)\s*=>\s*(.+)$/);
      if(fun){const params=fun[2].split(',').map(x=>x.trim()).filter(Boolean);if(params.some(x=>!/^\w+$/.test(x)))throw new ScriptError('Only scalar function parameters are supported',l.line);statements.push({type:'function',name:fun[1],params,body:expression(fun[3],l.line),line:l.line});continue;}
      const assign=l.text.match(/^(?:(var)\s+)?(?:(?:float|int|bool|string|color)\s+)?([A-Za-z_]\w*)\s*(:=|\+=|-=|\*=|\/=|=(?!=))\s*(.+)$/);
      if(assign){if(forbidden.has(assign[2]))throw new ScriptError('Forbidden variable',l.line);statements.push({type:'assign',persistent:!!assign[1],name:assign[2],op:assign[3],value:expression(assign[4],l.line),line:l.line});}
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
    if(scope==='function'&&node.type==='history')throw new ScriptError('History inside scalar functions is not supported; compute series at global scope',node.line);
    if(scope!=='global'&&node.type==='call'&&(/^(ta\.|request\.|input\.|strategy\.)/.test(node.name)||['plot','hline','plotshape','fill','bgcolor','barcolor','alertcondition'].includes(node.name)))throw new ScriptError('Stateful series calls must be outside scalar functions and loops',node.line);
    for(const value of Object.values(node))if(value&&typeof value==='object')audit(value,scope);
  }
  audit(ast);return{ast,nodes:nextNode,source};
}
const colors={blue:'#578bfa',red:'#ef6470',green:'#25bd9c',orange:'#efb466',purple:'#b698ed',yellow:'#ead074',white:'#ffffff',black:'#101419',aqua:'#61c7ca',teal:'#25bd9c',gray:'#8792a2',lime:'#78cf84',fuchsia:'#e281b4',maroon:'#a44865',silver:'#c0c5ce',navy:'#34558c',olive:'#8b965b'};
const baseFields={open:'o',high:'h',low:'l',close:'c',volume:'v'};
export function timeframeSeconds(text){const s=String(text);const m=s.match(/^(\d+)?([SDWM])?$/);if(!m)throw new ScriptError('Supported timeframes: minutes, nS, nD, nW');if(m[2]==='M')throw new ScriptError('Calendar-month security requests require an explicit calendar provider');const n=Number(m[1]||1);const v=n*({S:1,D:86400,W:604800}[m[2]]||60);if(!(v>0&&v<=31536000))throw new ScriptError('Invalid timeframe');return v;}
export function runScript(source,bars,options={}){
  const program=typeof source==='string'?compileScript(source):source;
  if(!Array.isArray(bars)||bars.length>250000)throw new ScriptError('Maximum 250,000 source bars');
  if(program.nodes*Math.max(1,bars.length)>24000000)throw new ScriptError('Script series-memory budget exceeded');
  let operations=0;const maxOperations=options.maxOperations??20000000,maxHistory=10000;
  const vars=new Map(),persistent=new Set(),initialized=new Set(),functions=new Map(),states=new Map(),plots=new Map(),alerts=new Map(),commands=[],inputs=new Map(),fills=[],backgrounds=[];
  const meta={title:'Untitled script',overlay:false,kind:'indicator'};let current=0,depth=0;
  function budget(node){if(++operations>maxOperations)throw new ScriptError('Operation budget exceeded',node?.line);if(depth>64)throw new ScriptError('Call depth exceeded',node?.line);}
  function fail(node,text){throw new ScriptError(text,node.line);}
  function array(name){if(!vars.has(name)){if(vars.size>=256)throw new ScriptError('Variable count limit exceeded');vars.set(name,new Array(bars.length).fill(NaN));}return vars.get(name);}
  function value(node,i,locals={}){
    budget(node);if(i<0||i>=bars.length)return NaN;
    switch(node.type){
      case'literal':return node.value;
      case'name':{
        const name=node.name;if(Object.hasOwn(locals,name))return locals[name];if(name==='true')return true;if(name==='false')return false;if(name==='na')return NaN;
        if(Object.hasOwn(baseFields,name))return bars[i][baseFields[name]];
        if(name==='hl2')return(bars[i].h+bars[i].l)/2;if(name==='hlc3')return(bars[i].h+bars[i].l+bars[i].c)/3;if(name==='ohlc4')return(bars[i].o+bars[i].h+bars[i].l+bars[i].c)/4;
        if(name==='time')return bars[i].t*1000;if(name==='bar_index')return i;if(name==='barstate.isconfirmed')return !bars[i].partial;if(name==='barstate.isfirst')return i===0;if(name==='barstate.islast')return i===bars.length-1;
        if(name==='syminfo.tickerid'||name==='syminfo.ticker')return options.symbol||'CHART';if(name==='syminfo.mintick')return options.tickSize||.01;if(name==='timeframe.period')return String((options.interval||3600)/60);
        if(name==='strategy.long')return 1;if(name==='strategy.short')return -1;
        if(name.startsWith('color.')&&Object.hasOwn(colors,name.slice(6)))return colors[name.slice(6)];
        if(['plot.style_line','plot.style_histogram','plot.style_columns','plot.style_circles','shape.triangleup','shape.triangledown','shape.circle','location.abovebar','location.belowbar'].includes(name))return name;
        if(vars.has(name))return vars.get(name)[i];fail(node,'Unknown identifier '+name);
      }
      case'history':{const n=value(node.offset,i,locals);if(!Number.isInteger(n)||n<0||n>maxHistory)fail(node,'History offset must be an integer from 0 to 10,000; future references are forbidden');return value(node.arg,i-n,locals);}
      case'unary':{const a=value(node.arg,i,locals);return node.op==='not'?!isTrue(a):node.op==='-'?-Number(a):Number(a);}
      case'binary':{
        const a=value(node.left,i,locals);if(node.op==='and')return isTrue(a)&&isTrue(value(node.right,i,locals));if(node.op==='or')return isTrue(a)||isTrue(value(node.right,i,locals));const b=value(node.right,i,locals);
        switch(node.op){case'+':return a+b;case'-':return a-b;case'*':return a*b;case'/':return b===0?NaN:a/b;case'%':return b===0?NaN:a%b;case'==':return a===b;case'!=':return a!==b;case'>':return a>b;case'<':return a<b;case'>=':return a>=b;case'<=':return a<=b;}break;
      }
      case'ternary':return value(isTrue(value(node.test,i,locals))?node.yes:node.no,i,locals);
      case'call':return call(node,i,locals);
    }
    fail(node,'Unsupported expression');
  }
  function call(node,i,locals){
    const name=node.name,arg=k=>node.args[k]?value(node.args[k],i,locals):undefined;
    const named=(k,def)=>node.named[k]?value(node.named[k],i,locals):def;
    const supported=(allowed)=>{for(const k of Object.keys(node.named))if(!allowed.includes(k))fail(node,'Unsupported '+name+' argument: '+k);};
    if(functions.has(name)){const fn=functions.get(name);if(node.args.length!==fn.params.length)fail(node,'Function argument count mismatch');const next={...locals};fn.params.forEach((p,j)=>next[p]=arg(j));depth++;try{return value(fn.body,i,next);}finally{depth--;}}
    if(name==='indicator'||name==='strategy'){supported(['title','overlay','shorttitle']);if(i===0){meta.title=String(arg(0)??named('title','Untitled'));meta.overlay=!!named('overlay',false);meta.kind=name;}return 0;}
    if(name.startsWith('input.')){
      if(!['input.int','input.float','input.bool','input.string','input.source'].includes(name))fail(node,'Unsupported input type');supported(['defval','title','minval','maxval','step']);const fallback=arg(0)??named('defval',0),title=String(arg(1)??named('title','Input '+node.id));let v=options.inputs?.[title]??fallback;
      if(name==='input.source'){const selected=options.inputs?.[title]??node.args[0]?.name;if(typeof selected!=='string'||!Object.hasOwn(baseFields,selected))fail(node,'input.source requires open, high, low, close or volume');v=bars[i][baseFields[selected]];if(i===0)inputs.set(title,{title,type:name,value:selected});return v;}
      else if(name==='input.bool'){if(typeof v!=='boolean')fail(node,'Boolean input required for '+title);}else if(name==='input.string')v=String(v);else{v=Number(v);if(!Number.isFinite(v)||(name==='input.int'&&!Number.isInteger(v))||v<named('minval',-Infinity)||v>named('maxval',Infinity))fail(node,'Invalid input '+title);}
      if(i===0)inputs.set(title,{title,type:name,value:v});return v;
    }
    if(name==='nz'){const a=arg(0);return a==null||Number.isNaN(a)?(arg(1)??0):a;}
    if(name==='na')return arg(0)==null||Number.isNaN(arg(0));
    if(name==='float'||name==='int'||name==='bool'||name==='str.tostring')return name==='bool'?isTrue(arg(0)):name==='str.tostring'?String(arg(0)):name==='int'?Math.trunc(Number(arg(0))):Number(arg(0));
    if(name==='color.new'){supported([]);const color=String(arg(0)),alpha=Math.max(0,Math.min(100,Number(arg(1))));if(!/^#[a-f\d]{6}$/i.test(color))fail(node,'Invalid color');return color+Math.round(255*(1-alpha/100)).toString(16).padStart(2,'0');}
    if(name.startsWith('math.')){const key=name.slice(5),fns={abs:Math.abs,sqrt:Math.sqrt,log:Math.log,log10:Math.log10,exp:Math.exp,pow:Math.pow,min:Math.min,max:Math.max,round:Math.round,floor:Math.floor,ceil:Math.ceil,sign:Math.sign,sin:Math.sin,cos:Math.cos};if(!Object.hasOwn(fns,key))fail(node,'Unsupported math function');return fns[key](...node.args.map((a)=>value(a,i,locals)));}
    if(name.startsWith('ta.'))return technical(node,i,locals);
    if(name==='request.security'){
      supported(['lookahead','gaps']);if(node.named.lookahead||node.named.gaps)fail(node,'Only closed-bar alignment with gaps carried forward is supported');
      let state=states.get(node.id);if(!state){const symbol=String(arg(0)),tf=String(arg(1)),interval=timeframeSeconds(tf);if(interval<(options.interval||3600))fail(node,'Lower-timeframe security is not supported; supply aligned higher-timeframe data');const ds=options.datasets?.[`${symbol}:${interval}`];if(!ds)fail(node,`Dataset required: ${symbol}:${interval}`);
        const expr=node.args[2];if(!expr)fail(node,'Security requires an expression');const childProgram={nodes:program.nodes,ast:[{type:'expression',value:{type:'call',name:'plot',args:[expr],named:{},id:nextNode+100000+node.id,line:node.line},line:node.line}]};
        const remote=runScript(childProgram,ds.bars,{...options,interval,datasets:{},maxOperations:Math.max(1,maxOperations-operations)});operations+=remote.operations;
        state={aligned:alignClosedSeries(bars,ds.bars,remote.plots[0].values,interval,options.interval||3600)};states.set(node.id,state);
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
    if(name==='strategy.entry'||name==='strategy.close'||name==='strategy.close_all'){
      supported(['qty','when']);if(meta.kind!=='strategy')fail(node,'Declare strategy() before order commands');if(!isTrue(named('when',true)))return 0;
      const direction=name==='strategy.entry'?Number(arg(1)):0;if(name==='strategy.entry'&&![1,-1].includes(direction))fail(node,'Entry direction must be strategy.long or strategy.short');
      const quantity=named('qty',null);if(quantity!=null&&!(Number.isFinite(quantity)&&quantity>0))fail(node,'Order quantity must be positive');commands.push({index:i,t:bars[i].t,id:String(arg(0)??'all'),action:name==='strategy.entry'?'entry':'close',direction,quantity});return 0;
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
    if(key==='barssince'){let s=states.get(node.id);if(!s){s={values:new Float64Array(bars.length).fill(NaN),last:-1,count:NaN};states.set(node.id,s);}while(s.last<i){const j=++s.last;s.count=isTrue(value(src,j,locals))?0:Number.isFinite(s.count)?s.count+1:NaN;s.values[j]=s.count;}return s.values[i];}
    if(key==='cum'){let s=states.get(node.id);if(!s){s={values:new Float64Array(bars.length).fill(NaN),last:-1,sum:0};states.set(node.id,s);}while(s.last<i){const j=++s.last;s.sum+=get(src,j);s.values[j]=s.sum;}return s.values[i];}
    const isAtr=key==='atr',n=isAtr?get(src,i):get(node.args[1],i);
    if(!Number.isInteger(n)||n<1||n>maxHistory)fail(node,'Study length must be an integer from 1 to 10,000');
    const sample=j=>isAtr?(j?Math.max(bars[j].h-bars[j].l,Math.abs(bars[j].h-bars[j-1].c),Math.abs(bars[j].l-bars[j-1].c)):bars[j].h-bars[j].l):get(src,j);
    if(['ema','rma','rsi','atr'].includes(key)){
      let s=states.get(node.id);if(!s){s={values:new Float64Array(bars.length).fill(NaN),last:-1,n,sum:0,count:0,prev:NaN,gain:0,loss:0};states.set(node.id,s);}if(s.n!==n)fail(node,'Recursive study lengths must remain constant');
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
  function execute(statements,i,locals={}){for(const s of statements){budget(s);
    if(s.type==='function'){if(i===0){if(functions.has(s.name))fail(s,'Duplicate function');functions.set(s.name,s);}continue;}
    if(s.type==='expression'){value(s.value,i,locals);continue;}
    if(s.type==='if'){execute(isTrue(value(s.test,i,locals))?s.yes:s.no,i,locals);continue;}
    if(s.type==='for'){const start=value(s.start,i,locals),end=value(s.end,i,locals);if(!Number.isInteger(start)||!Number.isInteger(end)||Math.abs(end-start)>1000)fail(s,'For-loop limit is 1,001 integer iterations');const delta=end>=start?1:-1;for(let k=start;delta>0?k<=end:k>=end;k+=delta)execute(s.body,i,{...locals,[s.name]:k});continue;}
    if(s.type==='assign'){
      if(s.persistent)persistent.add(s.name);const a=array(s.name);if(s.persistent&&initialized.has(s.name))continue;
      if(s.persistent)initialized.add(s.name);
      const v=value(s.value,i,locals);if(s.op==='='||s.op===':=')a[i]=v;else{const old=a[i];a[i]=s.op==='+='?old+v:s.op==='-='?old-v:s.op==='*='?old*v:v===0?NaN:old/v;}
    }
  }}
  for(current=0;current<bars.length;current++){for(const name of persistent)if(current)array(name)[current]=array(name)[current-1];execute(program.ast,current);}
  return{...meta,plots:[...plots.values()],alerts:[...alerts.values()],commands,inputs:[...inputs.values()],fills,backgrounds,operations,bars:bars.length,compatibility:'AureonScript 1: documented Pine-inspired subset, not Pine Script v6 compatibility'};
}
export const SCRIPT_EXAMPLES={
  trend:`// AureonScript 1\nindicator("Adaptive trend", overlay=true)\nlength = input.int(21, "Length", minval=1, maxval=500)\nfast = ta.ema(close, length)\nslow = ta.sma(close, length * 2)\nplot(fast, "Fast EMA", color.blue, 2)\nplot(slow, "Slow SMA", color.orange, 2)\nplotshape(ta.crossover(fast, slow), title="Bull cross", color=color.green, location=location.belowbar)\nalertcondition(ta.crossover(fast, slow), "Bull cross", "Fast EMA crossed above slow SMA")`,
  strategy:`// AureonScript 1\nstrategy("Dual moving-average strategy", overlay=true)\nfastLen = input.int(12, "Fast", minval=1, maxval=100)\nslowLen = input.int(26, "Slow", minval=2, maxval=300)\nfast = ta.ema(close, fastLen)\nslow = ta.ema(close, slowLen)\nplot(fast, "Fast", color.blue)\nplot(slow, "Slow", color.orange)\nif ta.crossover(fast, slow)\n    strategy.entry("Long", strategy.long)\nif ta.crossunder(fast, slow)\n    strategy.entry("Short", strategy.short)`,
  oscillator:`indicator("Relative strength", overlay=false)\nn = input.int(14, "Length", minval=1, maxval=500)\nr = ta.rsi(close, n)\nplot(r, "RSI", color.purple, 2)\nhline(70, "Overbought", color.red)\nhline(30, "Oversold", color.green)\nalertcondition(ta.crossover(r, 30), "RSI recovery", "RSI crossed above 30")`,
  cumulative:`indicator("Cumulative close change", overlay=false)\nvar float total = 0\ntotal := nz(total[1]) + nz(ta.change(close))\nplot(total, "Cumulative delta", color.teal)`
};
