import {compileScript, ScriptError, colors, baseFields, technicalSignature} from './script.js';
import {validateCandle} from './core.js';

/** Conservative scalar-series planner. Nothing is evaluated as JavaScript.
 * Unsupported syntax selects the original interpreter BEFORE accepting any bars.
 * Technical calls in lazy branches, mutable state and end-relative flags are
 * deliberately excluded: eager graph evaluation would change their semantics.
 */
const WINDOWS = new Set(['sma', 'sum', 'wma', 'highest', 'lowest', 'stdev', 'linreg', 'variance']);
const RECURSIVE = new Set(['ema', 'rma', 'rsi', 'atr']);
const SIMPLE = new Set(['change', 'mom', 'roc', 'cross', 'crossover', 'crossunder', 'cum', 'barssince']);
const OUTPUTS = new Set(['plot', 'hline', 'plotshape', 'alertcondition', 'bgcolor', 'barcolor', 'fill']);
const FLAGS = new Set(['barstate.isfirst', 'barstate.isconfirmed', 'barstate.isrealtime', 'barstate.ishistory', 'barstate.isnew']);
const MATH = Object.freeze({abs:Math.abs, sqrt:Math.sqrt, log:Math.log, log10:Math.log10, exp:Math.exp,
  pow:Math.pow, min:Math.min, max:Math.max, round:Math.round, floor:Math.floor, ceil:Math.ceil,
  sign:Math.sign, sin:Math.sin, cos:Math.cos});
const truth = v => typeof v === 'number' ? Number.isFinite(v) && v !== 0 : !!v;
const boundString = v => {const s=String(v); if(s.length>100000)throw new ScriptError('String length budget exceeded'); return s;};
class Unsupported extends Error { constructor(node, reason) {super(`Line ${node?.line || 1}: ${reason}`);} }
const unsupported = (node, reason) => {throw new Unsupported(node, reason);};
function unary(op, a) {return op==='not' ? !truth(a) : op==='-' ? -Number(a) : Number(a);}
function binary(op, a, b) {
  switch(op) {
    case '+': return typeof a==='string'||typeof b==='string' ? boundString(String(a)+String(b)) : a+b;
    case '-': return a-b; case '*': return a*b; case '/': return b===0?NaN:a/b; case '%': return b===0?NaN:a%b;
    case '==': return a===b; case '!=': return a!==b; case '>': return a>b; case '<': return a<b;
    case '>=': return a>=b; case '<=': return a<=b; case 'and': return truth(a)&&truth(b); case 'or': return truth(a)||truth(b);
    default: throw new ScriptError('Unsupported binary operator');
  }
}
function pure(name, args) {
  if(name.startsWith('math.'))return MATH[name.slice(5)](...args);
  switch(name) {
    case 'nz': return args[0]==null||Number.isNaN(args[0]) ? args[1]??0 : args[0];
    case 'na': return args[0]==null||Number.isNaN(args[0]);
    case 'float': return Number(args[0]); case 'int': return Math.trunc(Number(args[0])); case 'bool': return truth(args[0]);
    case 'str.tostring': return boundString(args[0]);
    case 'color.new': {
      const color=String(args[0]),alpha=Math.max(0,Math.min(100,Number(args[1])));
      if(!/^#[a-f\d]{6}$/i.test(color))throw new ScriptError('Invalid color');
      return color+Math.round(255*(1-alpha/100)).toString(16).padStart(2,'0');
    }
    default: throw new ScriptError('Unsupported pure function');
  }
}

export function planIncrementalScript(source, options={}) {
  // Syntax, library and sandbox errors remain errors, not unsupported success.
  const program=typeof source==='string'?compileScript(source,options):source;
  if(!program || !Array.isArray(program.ast))throw new ScriptError('Invalid compiled program');
  const nodes=[],variables=new Map(),inputs=new Map(),outputs=[],meta={title:'Untitled script',kind:'indicator',overlay:false};
  const fail=(n,m)=>{throw new ScriptError(m,n?.line);};
  const add=(ast, type, deps=[], extra={}, calculate) => {
    const constant=type==='literal'||!!calculate&&deps.every(i=>nodes[i].constant);
    const value=type==='literal'?extra.value:constant?calculate(...deps.map(i=>nodes[i].value)):undefined;
    const index=nodes.length;
    nodes.push({index,type,deps,line:ast?.line||1,constant,...extra,...(constant?{value}:{})});
    return index;
  };
  const literal=(v,n)=>add(n,'literal',[],{value:v});
  const staticValue=(i,n,label)=>{if(!nodes[i].constant)unsupported(n,`${label} must be constant for incremental execution`); return nodes[i].value;};
  function expr(ast, lazy=false) {
    try{return expressionNode(ast,lazy);}catch(error){if(lazy&&error instanceof ScriptError)unsupported(ast,'lazy validation requires reference execution');throw error;}
  }
  function expressionNode(ast, lazy=false) {
    if(!ast)fail(ast,'Missing expression');
    switch(ast.type) {
      case 'literal': return literal(ast.value,ast);
      case 'name': {
        const n=ast.name;
        if(n==='true'||n==='false'||n==='na')return literal(n==='na'?NaN:n==='true',ast);
        if(Object.hasOwn(baseFields,n))return add(ast,'field',[],{field:baseFields[n]});
        if(['hl2','hlc3','ohlc4','time','bar_index'].includes(n)||FLAGS.has(n))return add(ast,'builtin',[],{name:n});
        if(n==='syminfo.ticker'||n==='syminfo.tickerid')return literal(options.symbol||'CHART',ast);
        if(n==='syminfo.mintick')return literal(options.tickSize||.01,ast);
        if(n==='timeframe.period')return literal(String((options.interval||3600)/60),ast);
        if(n.startsWith('color.')&&Object.hasOwn(colors,n.slice(6)))return literal(colors[n.slice(6)],ast);
        if(['plot.style_line','plot.style_histogram','plot.style_columns','plot.style_circles','location.abovebar','location.belowbar','shape.circle','shape.triangleup','shape.triangledown'].includes(n))return literal(n,ast);
        if(variables.has(n))return variables.get(n);
        unsupported(ast,`identifier ${n} requires reference execution`); break;
      }
      case 'unary': {const a=expr(ast.arg,lazy);return add(ast,'unary',[a],{op:ast.op},x=>unary(ast.op,x));}
      case 'binary': {
        const a=expr(ast.left,lazy),b=expr(ast.right,lazy||ast.op==='and'||ast.op==='or');
        if(ast.op==='+'&&(!nodes[a].constant||!nodes[b].constant)) {
          // All dynamically-created strings use the reference heap budgets.
          const couldString=i=>nodes[i].constant?typeof nodes[i].value==='string':!!nodes[i].string;
          if(couldString(a)||couldString(b))unsupported(ast,'dynamic string concatenation requires reference execution');
        }
        return add(ast,'binary',[a,b],{op:ast.op},(x,y)=>binary(ast.op,x,y));
      }
      case 'ternary': {
        const deps=[expr(ast.test,lazy),expr(ast.yes,true),expr(ast.no,true)];
        return add(ast,'ternary',deps,{string:deps.slice(1).some(i=>nodes[i].string||typeof nodes[i].value==='string')},(t,a,b)=>truth(t)?a:b);
      }
      case 'history': {
        const offset=staticValue(expr(ast.offset,lazy),ast,'History offset');
        if(!Number.isInteger(offset)||offset<0||offset>10000)fail(ast,'History offset must be an integer from 0 to 10,000');
        const dep=expr(ast.arg,lazy);
        return add(ast,'history',[dep],{offset,string:!!nodes[dep].string||typeof nodes[dep].value==='string'});
      }
      case 'call': return call(ast,lazy);
      default: unsupported(ast,`${ast.type} expressions require reference execution`);
    }
  }
  function allowed(ast, names, maxArgs) {
    if(ast.args.length>maxArgs || Object.keys(ast.named||{}).some(k=>!names.includes(k)))unsupported(ast,`unsupported ${ast.name} signature`);
  }
  function call(ast,lazy) {
    const name=ast.name;
    if(OUTPUTS.has(name)||['indicator','strategy','library'].includes(name))unsupported(ast,`nested ${name} requires reference execution`);
    if(name.startsWith('input.')) {
      if(lazy)unsupported(ast,'conditionally executed inputs require reference execution');
      if(!['input.int','input.float','input.bool','input.string','input.source'].includes(name))unsupported(ast,`unsupported input ${name}`);
      allowed(ast,['defval','title','minval','maxval','step'],2);
      if(ast.args[0]&&ast.named?.defval||ast.args[1]&&ast.named?.title)unsupported(ast,'mixed input metadata precedence requires reference execution');
      const get=(node,def)=>node?staticValue(expr(node),node,'Input metadata'):def;
      const title=String(get(ast.args[1],get(ast.named?.title,'Input '+ast.id)));
      let value;
      if(name==='input.source') {
        const selected=options.inputs?.[title]??ast.args[0]?.name;
        if(typeof selected!=='string'||!Object.hasOwn(baseFields,selected))fail(ast,'input.source requires open, high, low, close or volume');
        inputs.set(title,{title,type:name,value:selected});
        return add(ast,'field',[],{field:baseFields[selected]});
      }
      const fallback=get(ast.args[0],get(ast.named?.defval,0));value=options.inputs?.[title]??fallback;
      if(name==='input.bool'){if(typeof value!=='boolean')fail(ast,'Boolean input required for '+title);}
      else if(name==='input.string')value=boundString(value);
      else {value=Number(value);if(!Number.isFinite(value)||name==='input.int'&&!Number.isInteger(value)||value<get(ast.named?.minval,-Infinity)||value>get(ast.named?.maxval,Infinity))fail(ast,'Invalid input '+title);}
      inputs.set(title,{title,type:name,value});return literal(value,ast);
    }
    if(name.startsWith('ta.')) {
      if(lazy)unsupported(ast,'technical calls in lazy expressions require reference execution');
      const key=name.slice(3);
      if(!WINDOWS.has(key)&&!RECURSIVE.has(key)&&!SIMPLE.has(key))unsupported(ast,`${name} has no incremental kernel`);
      const signature=technicalSignature(name),args=[...ast.args];
      if(args.length>signature.length)unsupported(ast,`unsupported ${name} arity`);
      for(const [k,v] of Object.entries(ast.named||{})) {
        const i=signature.indexOf(k);if(i<0||args[i])fail(ast,'Unknown or duplicated '+name+' argument '+k);args[i]=v;
      }
      const deps=[];
      const parameters={key,period:1,biased:true};
      if(RECURSIVE.has(key)||WINDOWS.has(key)) {
        if(key!=='atr')deps.push(expr(args[0]));
        const n=key==='atr'?args[0]:args[1];
        parameters.period=staticValue(expr(n),ast,'Study length');
        if(!Number.isInteger(parameters.period)||parameters.period<1||parameters.period>10000)fail(ast,'Study length must be an integer from 1 to 10,000');
        if(key==='variance'&&args[2]) {parameters.biased=staticValue(expr(args[2]),ast,'Biased flag');if(typeof parameters.biased!=='boolean')fail(ast,'Biased must be boolean');}
      } else {
        deps.push(expr(args[0]));
        if(['change','mom','roc'].includes(key)&&args[1]) {
          parameters.period=staticValue(expr(args[1]),ast,'History length');
          if(!Number.isInteger(parameters.period)||parameters.period<0||parameters.period>10000)fail(ast,'Invalid history length');
        } else if(key.startsWith('cross'))deps.push(expr(args[1]));
      }
      return add(ast,'kernel',deps,parameters);
    }
    if(name.startsWith('math.')&&Object.hasOwn(MATH,name.slice(5))||['nz','na','float','int','bool','str.tostring','color.new'].includes(name)) {
      allowed(ast,[],name.startsWith('math.')?64:name==='nz'||name==='color.new'?2:1);
      const deps=ast.args.map(n=>expr(n,lazy));
      if((name==='str.tostring'||name==='color.new')&&!deps.every(i=>nodes[i].constant))unsupported(ast,'dynamic string/color construction requires reference execution');
      if(lazy&&['color.new','str.tostring'].includes(name))unsupported(ast,'lazy string construction requires reference execution');
      return add(ast,'pure',deps,{name,string:name==='nz'&&deps.some(i=>nodes[i].string||typeof nodes[i].value==='string')},(...xs)=>pure(name,xs));
    }
    unsupported(ast,`${name} requires reference execution`);
  }
  function output(ast) {
    if(ast.type!=='call'||!OUTPUTS.has(ast.name))unsupported(ast,'only top-level indicator outputs are incrementally supported');
    const name=ast.name;
    if(ast.args[1]&&ast.named?.title||ast.args[2]&&ast.named?.color||ast.args[3]&&ast.named?.linewidth||name==='alertcondition'&&ast.args[2]&&ast.named?.message)unsupported(ast,'mixed output metadata precedence requires reference execution');
    const get=(node,def)=>node?expr(node):literal(def,ast);
    const staticGet=(node,def)=>node?staticValue(expr(node),ast,'Output metadata'):def;
    if(name==='fill') {
      allowed(ast,['color','title'],3);
      // Plot-handle declarations are intentionally not treated as scalar variables.
      unsupported(ast,'fill handles require reference execution');
    }
    if(name==='bgcolor'||name==='barcolor') {
      allowed(ast,['title'],1);outputs.push({kind:name,id:ast.id,value:expr(ast.args[0])});return;
    }
    if(name==='alertcondition') {
      allowed(ast,['title','message'],3);
      outputs.push({kind:name,id:ast.id,value:expr(ast.args[0]),title:String(staticGet(ast.args[1],staticGet(ast.named?.title,'Script alert'))),message:String(staticGet(ast.args[2],staticGet(ast.named?.message,'Condition met')))});return;
    }
    allowed(ast,['title','color','linewidth','style','location','text','offset'],4);
    if(Number(staticGet(ast.named?.offset,0))!==0)fail(ast,'Nonzero plot offsets are not supported');
    const defaultColor=String(staticGet(ast.named?.color&&ast.args[2]?ast.args[2]:null,'#578bfa'));
    const color=get(ast.named?.color??ast.args[2],defaultColor);
    // Initial plot metadata is established from first evaluation, just like runScript.
    const descriptor={kind:name,id:ast.id,value:expr(ast.args[0]),name:String(staticGet(ast.args[1],staticGet(ast.named?.title,name+' '+(outputs.filter(o=>['plot','hline','plotshape'].includes(o.kind)).length+1)))),
      color,width:Number(staticGet(ast.named?.linewidth??ast.args[3],1.5)),style:String(staticGet(ast.named?.style,'plot.style_line')),location:String(staticGet(ast.named?.location,'location.belowbar'))};
    outputs.push(descriptor);
  }
  try {
    for(const s of program.ast) {
      if(s.type==='assign') {
        if(s.persistent||s.intrabar||s.op!=='='||s.name.includes('.')||variables.has(s.name))unsupported(s,'mutable or persistent assignments require reference execution');
        if(Object.hasOwn(baseFields,s.name)||['true','false','na','hl2','hlc3','ohlc4','time','bar_index'].includes(s.name))unsupported(s,'builtin shadowing requires reference execution');
        if(variables.size>=256)fail(s,'Variable count limit exceeded');variables.set(s.name,expr(s.value));
      } else if(s.type==='expression') {
        const n=s.value;
        if(n.type==='call'&&n.name==='indicator') {
          allowed(n,['title','overlay','max_bars_back','shorttitle','initial_capital'],1);
          if(n.args[0]&&n.named?.title)unsupported(n,'mixed indicator metadata precedence requires reference execution');
          const cv=(n,def)=>n?staticValue(expr(n),n,'Indicator metadata'):def;
          meta.title=String(cv(n.args[0],cv(n.named?.title,'Untitled')));meta.overlay=!!cv(n.named?.overlay,false);
        } else output(n);
      } else unsupported(s,`${s.type} statements require reference execution`);
    }
    if(outputs.filter(o=>['plot','hline','plotshape'].includes(o.kind)).length>64)fail(null,'Plot count limit is 64');
    if(nodes.length>5000)fail(null,'Incremental graph limit is 5,000 nodes');
    return {supported:true,nodes,variables:[...variables],inputs:[...inputs.values()],outputs,meta,program};
  } catch(error) {
    if(!(error instanceof Unsupported))throw error;
    return {supported:false,reason:error.message,program};
  }
}

// Persistent aggregate tree. Provisional evaluation copies O(log window) nodes;
// rollback is a root-pointer restore. No rolling-window copy and no inverse
// variance subtraction is needed. Rotating ranges retain chronological weights.
const combine=(a,b)=> {
  if(!a)return b;if(!b)return a;
  const size=a.size+b.size,valid=a.valid+b.valid,d=b.mean-a.mean;
  const mean=a.valid&&b.valid?a.mean+d*b.valid/valid:a.valid?a.mean:b.mean;
  const m2=a.m2+b.m2+(a.valid&&b.valid?d*d*a.valid*b.valid/valid:0);
  return {size,valid,sum:a.sum+b.sum,weighted:a.weighted+b.weighted+a.size*b.sum,mean,m2,min:Math.min(a.min,b.min),max:Math.max(a.max,b.max)};
};
function treeSet(root,left,right,index,value,charge) {
  charge();
  if(right-left===1) {
    const valid=Number.isFinite(value);
    return {size:1,valid:valid?1:0,sum:valid?value:0,weighted:valid?value:0,mean:valid?value:0,m2:0,min:valid?value:Infinity,max:valid?value:-Infinity};
  }
  const mid=(left+right)>>>1;
  const a=index<mid?treeSet(root?.left,left,mid,index,value,charge):root?.left;
  const b=index>=mid?treeSet(root?.right,mid,right,index,value,charge):root?.right;
  return {...combine(a,b),left:a,right:b};
}
function treeRange(root,left,right,start,end,charge) {
  charge();if(!root||start>=right||end<=left)return null;
  if(start<=left&&end>=right)return root;
  const mid=(left+right)>>>1;
  return combine(treeRange(root.left,left,mid,start,end,charge),treeRange(root.right,mid,right,start,end,charge));
}
function kernel(node,state,values,previous,bar,priorBar,index,charge) {
  const {key,period:n}=node,x=Number(values[0]);
  if(key.startsWith('cross')) {
    const y=Number(values[1]),a=Number(previous(0,1)),b=Number(previous(1,1));
    return key==='crossover'?x>y&&a<=b:key==='crossunder'?x<y&&a>=b:(x>y&&a<=b)||(x<y&&a>=b);
  }
  if(['change','mom','roc'].includes(key)) {const p=Number(previous(0,n));return key==='roc'?(p?(x/p-1)*100:NaN):x-p;}
  if(key==='cum') {state.sum+=x;return state.sum;}
  if(key==='barssince') {state.count=truth(values[0])?0:Number.isFinite(state.count)?state.count+1:NaN;return state.count;}
  if(RECURSIVE.has(key)) {
    if(key==='rsi') {
      if(index===0)return NaN;
      const d=x-Number(previous(0,1));if(!Number.isFinite(d)){state.count=0;state.gain=0;state.loss=0;return NaN;}
      const gain=Math.max(0,d),loss=Math.max(0,-d);
      if(state.count<n){state.gain+=gain;state.loss+=loss;if(++state.count===n){state.gain/=n;state.loss/=n;}}
      else {state.gain=(state.gain*(n-1)+gain)/n;state.loss=(state.loss*(n-1)+loss)/n;}
      return state.count<n?NaN:state.loss===0?(state.gain===0?50:100):100-100/(1+state.gain/state.loss);
    }
    const sample=key==='atr'?(priorBar?Math.max(bar.h-bar.l,Math.abs(bar.h-priorBar.c),Math.abs(bar.l-priorBar.c)):bar.h-bar.l):x;
    if(!Number.isFinite(sample)){state.count=0;state.sum=0;state.prev=NaN;return NaN;}
    if(!Number.isFinite(state.prev)){state.sum+=sample;if(++state.count===n)state.prev=state.sum/n;}
    else state.prev+=(key==='ema'?2/(n+1):1/n)*(sample-state.prev);
    return state.prev;
  }
  state.root=treeSet(state.root,0,n,state.cursor,x,charge);state.cursor=(state.cursor+1)%n;state.size=Math.min(n,state.size+1);
  if(state.size<n)return NaN;
  const aggregate=state.cursor===0?state.root:combine(treeRange(state.root,0,n,state.cursor,n,charge),treeRange(state.root,0,n,0,state.cursor,charge));
  if(aggregate.valid!==n)return NaN;
  const {sum,weighted,m2}=aggregate;
  switch(key) {
    case 'sum': return sum; case 'sma': return sum/n; case 'wma': return weighted/(n*(n+1)/2);
    case 'highest': return aggregate.max; case 'lowest': return aggregate.min; case 'stdev': return Math.sqrt(Math.max(0,m2/n));
    case 'variance': return n===1&&!node.biased?NaN:Math.max(0,m2/(n-(node.biased?0:1)));
    case 'linreg': {
      if(n===1)return sum;
      const sx=n*(n-1)/2,sxx=n*(n-1)*(2*n-1)/6,slope=(n*(weighted-sum)-sx*sum)/(n*sxx-sx*sx);
      return (sum-slope*sx)/n+slope*(n-1);
    }
    default: throw new ScriptError('Missing incremental kernel');
  }
}
const newState=n=>({sum:0,count:n.key==='barssince'?NaN:0,prev:NaN,gain:0,loss:0,root:null,cursor:0,size:0});

export class IncrementalScriptSession {
  constructor(source,options={}) {
    this.options=structuredClone(options);
    this.plan=planIncrementalScript(source,this.options);
    if(!this.plan.supported)throw new ScriptError(this.plan.reason);
    this.maxBars=options.maxBars??5000;this.maxOperations=options.maxOperations??1000000;
    this.maxCells=options.maxSeriesCells??2000000;
    if(!Number.isInteger(this.maxBars)||this.maxBars<1||this.maxBars>10000)throw new ScriptError('Incremental history limit is 1–10,000 bars');
    if(!Number.isInteger(this.maxCells)||this.maxCells<1||this.maxCells>4000000)throw new ScriptError('Incremental series limit is 1–4,000,000 cells');
    if(!Number.isInteger(this.maxOperations)||this.maxOperations<1||this.maxOperations>20000000)throw new ScriptError('Invalid incremental operation budget');
    this.cells=(this.maxBars+1)*(this.plan.nodes.length+this.plan.outputs.reduce((s,o)=>s+(['plot','hline','plotshape'].includes(o.kind)?2:1),0));
    // Persistent tree nodes plus the one provisional root path are bounded too.
    this.treeCells=this.plan.nodes.reduce((sum,n)=>sum+(n.type==='kernel'&&WINDOWS.has(n.key)?n.period*32:0),0);
    if(this.cells+this.treeCells>this.maxCells)throw new ScriptError('Incremental series-memory budget exceeded');
    this.reset();
  }
  reset(bars=[]) {
    if(!Array.isArray(bars)||bars.length>this.maxBars)throw new ScriptError('Incremental seed capacity exceeded');
    const copy=bars.map((b,i)=>{const c=validateCandle(b);if(c.partial||i&&c.t<=bars[i-1].t)throw new ScriptError('Seed only ordered closed bars');return {...c,partial:false};});
    this.closed=[];this.openTime=null;this.openBar=null;this.histories=this.plan.nodes.map(()=>new Array(this.maxBars+1).fill(NaN));
    this.states=this.plan.nodes.map(n=>n.type==='kernel'?newState(n):null);this.failed=false;
    this.evaluations=0;this.totalOperations=0;this.lastOperations=0;this.lastProfile=[];
    for(const b of copy){this.evaluate(b,{realtime:false,isNew:true},true);this.closed.push(b);if(this.totalOperations>this.maxOperations){this.failed=true;throw new ScriptError('Incremental seed operation budget exceeded');}}
    return this;
  }
  evaluate(bar,flags,commit) {
    const index=this.closed.length,checkpoint=this.states.map(s=>s?{...s}:null),profile=new Map();
    let operations=0;
    const charge=line=>{operations++;if(operations>this.maxOperations)throw new ScriptError('Incremental operation budget exceeded',line);if(line)profile.set(line,(profile.get(line)||0)+1);};
    try {
      for(const n of this.plan.nodes) {
        charge(n.line);const xs=n.deps.map(d=>this.histories[d][index]);let v;
        if(n.constant)v=n.value;
        else switch(n.type) {
          case 'field':v=bar[n.field];break;
          case 'builtin':switch(n.name) {
            case 'hl2':v=(bar.h+bar.l)/2;break;case 'hlc3':v=(bar.h+bar.l+bar.c)/3;break;case 'ohlc4':v=(bar.o+bar.h+bar.l+bar.c)/4;break;
            case 'time':v=bar.t*1000;break;case 'bar_index':v=index;break;case 'barstate.isfirst':v=index===0;break;
            case 'barstate.isconfirmed':v=!bar.partial;break;case 'barstate.isrealtime':v=!!flags.realtime;break;
            case 'barstate.ishistory':v=!flags.realtime;break;case 'barstate.isnew':v=flags.isNew!==false;break;
          }break;
          case 'history':v=index<n.offset?NaN:this.histories[n.deps[0]][index-n.offset];break;
          case 'unary':v=unary(n.op,xs[0]);break;case 'binary':v=binary(n.op,xs[0],xs[1]);break;
          case 'ternary':v=truth(xs[0])?xs[1]:xs[2];break;case 'pure':v=pure(n.name,xs);break;
          case 'kernel':v=kernel(n,this.states[n.index],xs,(d,offset)=>index<offset?NaN:this.histories[n.deps[d]][index-offset],bar,this.closed.at(-1),index,()=>charge(n.line));break;
          default:throw new ScriptError('Invalid incremental graph node');
        }
        this.histories[n.index][index]=v;
      }
      // Count serialized scalar output separately; never transfer internal arrays.
      this.evaluations++;this.totalOperations+=operations;this.lastOperations=operations;
      this.lastProfile=[...profile].map(([line,operations])=>({line,operations})).sort((a,b)=>b.operations-a.operations);
    } catch(error) {this.states=checkpoint;this.failed=true;throw error;}
    if(!commit)this.states=checkpoint;
  }
  update(bar,{confirmed=false,asOf=bar?.t,from=0}={}) {
    if(this.failed)throw new ScriptError('Incremental session failed; reset it explicitly');
    const b={...validateCandle(bar),partial:!confirmed};
    if(!Number.isFinite(asOf)||asOf<b.t||this.closed.length&&b.t<=this.closed.at(-1).t)throw new ScriptError('Cannot revise committed realtime history');
    if(this.openTime!==null&&b.t!==this.openTime)throw new ScriptError('Confirm or discard the open bar before advancing');
    if(this.closed.length>=this.maxBars)throw new ScriptError('Incremental history capacity reached');
    if(!Number.isInteger(from)||from<0||from>this.closed.length+1)throw new ScriptError('Invalid snapshot start');
    this.evaluate(b,{realtime:true,isNew:this.openTime===null},confirmed);
    this.openBar=b;this.openTime=b.t;
    const result=this.result(from);
    if(confirmed){this.closed.push(b);this.openBar=null;this.openTime=null;}
    return result;
  }
  discard(){this.openTime=null;this.openBar=null;}
  result(from=0) {
    if(this.failed)throw new ScriptError('Incremental session failed; reset it explicitly');
    const count=this.closed.length+(this.openBar?1:0),plots=[],alerts=[],backgrounds=[];
    if(!Number.isInteger(from)||from<0||from>count)throw new ScriptError('Invalid snapshot start');
    const length=count-from;
    const read=(node,i)=>this.histories[node][i];
    let outputCells=0;
    for(const out of this.plan.outputs) {
      if(out.kind==='alertcondition') {alerts.push({id:out.id,title:out.title,message:out.message,values:Uint8Array.from({length},(_,i)=>truth(read(out.value,i+from))?1:0)});outputCells+=length;continue;}
      if(out.kind==='bgcolor'||out.kind==='barcolor'){backgrounds.push({id:out.id,kind:out.kind,values:Array.from({length},(_,i)=>read(out.value,i+from))});outputCells+=length;continue;}
      const color=String(count?read(out.color,0):'#578bfa'),values=new Float64Array(length),rowColors=new Array(length);
      for(let i=from;i<count;i++) {
        const v=read(out.value,i),b=i<this.closed.length?this.closed[i]:this.openBar;
        values[i-from]=out.kind==='plotshape'?(truth(v)?(out.location==='location.abovebar'?b.h:b.l):NaN):Number(v);
        rowColors[i-from]=String(read(out.color,i));
      }
      plots.push({id:out.id,name:out.name,values,colors:rowColors,color,width:out.width,style:out.style,kind:out.kind,location:out.location});outputCells+=length*2;
    }
    const captured={};for(const name of (this.options.capture||[]).slice(0,16)){
      const entry=this.plan.variables.find(([key])=>key===name);if(entry)captured[name]=this.histories[entry[1]].slice(from,count);
    }
    return {...this.plan.meta,plots,alerts,commands:[],inputs:structuredClone(this.plan.inputs),fills:[],backgrounds,
      operations:this.lastOperations,bars:count,captured,varip:{},profile:structuredClone(this.lastProfile),heap:{elements:this.cells+this.treeCells,objects:this.plan.nodes.length},graphics:[],
      compatibility:'AureonScript 4: original bounded financial-series language',
      execution:{engine:'incremental',fallbackReason:null,graphNodes:this.plan.nodes.length,seriesCells:this.cells+this.treeCells,
        evaluatedBars:this.evaluations,lastStepOperations:this.lastOperations,totalStepOperations:this.totalOperations,outputCells,transport:from?'tail patch':'full snapshot'}};
  }
}

/** Small serializable preflight: no candles, provider requests or broker effects. */
export function inspectIncrementalScript(source,options={}) {
  const plan=planIncrementalScript(source,options);
  if(!plan.supported)return {supported:false,engine:'reference',reason:plan.reason,graphNodes:0,kernels:[]};
  return {supported:true,engine:'incremental',reason:null,graphNodes:plan.nodes.length,
    kernels:[...new Set(plan.nodes.filter(n=>n.type==='kernel').map(n=>n.key))],outputs:plan.outputs.length,
    mutableState:false,historyPolicy:'Retain bounded closed scalar history; rollback provisional kernel roots',transport:'Optional sequenced tail patches'};
}
