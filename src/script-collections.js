/** Capability-free collection heap for AureonScript. Values are tagged records,
 * not arbitrary JS objects. All indexing, types, mutations and growth are checked.
 */
export const UNHANDLED_COLLECTION = Symbol('unhandled collection call');
const primitives=new Set(['float','int','bool','string','color','any']);
const unsafe=new Set(['__proto__','prototype','constructor']);
export class ScriptHeap {
  constructor({maxElements=1000000,maxObjects=100000,maxLength=10000,budget=()=>{}}={}) {
    this.maxElements=maxElements;this.maxObjects=maxObjects;this.maxLength=maxLength;this.budget=budget;this.elements=0;this.objects=0;
  }
  count(n,objects=0){this.budget();if(!Number.isSafeInteger(n)||n<0||this.elements+n>this.maxElements||this.objects+objects>this.maxObjects)throw new RangeError('Script collection memory budget exceeded');this.elements+=n;this.objects+=objects;}
  length(n){if(!Number.isInteger(n)||n<0||n>this.maxLength)throw new RangeError('Collection length must be 0..'+this.maxLength);return n;}
  type(value,type='any') {
    if(type==='any')return this.safe(value);
    if(type==='float'||type==='int'){if(typeof value!=='number'||(!Number.isFinite(value)&&!Number.isNaN(value))||(type==='int'&&Number.isFinite(value)&&!Number.isInteger(value)))throw new TypeError('Expected '+type);return value;}
    if(type==='bool'){if(typeof value!=='boolean')throw new TypeError('Expected bool');return value;}
    if(type==='string'||type==='color'){if(typeof value!=='string'||value.length>100000)throw new TypeError('Expected bounded string');return value;}
    if(value==null||typeof value==='number'&&Number.isNaN(value))return value;
    if(value?.kind!=='record'||value.type!==type)throw new TypeError('Expected record '+type);return value;
  }
  safe(v,visited=new Set(),depth=0){if(depth>64)throw new RangeError('Collection nesting limit');if(v===null||['number','boolean','string'].includes(typeof v)){if(typeof v==='number'&&!Number.isFinite(v)&&!Number.isNaN(v))throw new TypeError('Infinity is not a collection value');if(typeof v==='string'&&v.length>100000)throw new RangeError('String limit');return v;}if(!v||typeof v!=='object'||!['array','map','matrix','record'].includes(v.kind))throw new TypeError('Only script-owned values are allowed');if(visited.has(v))throw new RangeError('Cyclic collection reference');visited.add(v);for(const x of this.children(v))this.safe(x,visited,depth+1);visited.delete(v);return v;}
  children(v){return v.kind==='record'?Object.values(v.fields):v.kind==='map'?[...v.items.values()]:v.items;}
  preventCycle(container,value){const seen=new Set(),visit=(v,depth=0)=>{if(depth>64)throw new RangeError('Nesting limit');if(v===container)throw new RangeError('Cyclic collection reference');if(!v||typeof v!=='object'||seen.has(v))return;seen.add(v);for(const x of this.children(v))visit(x,depth+1);};visit(value);}
  array(items=[],type='any'){this.length(items.length);for(const v of items)this.type(v,type);this.count(items.length,1);return {kind:'array',type,items:[...items]};}
  record(type,fields,specs){for(const[k,v]of Object.entries(fields)){if(unsafe.has(k)||!Object.hasOwn(specs,k))throw new TypeError('Invalid record field');this.type(v,specs[k]);}this.count(Object.keys(fields).length,1);return {kind:'record',type,fields:{...fields},specs:{...specs}};}
  clone(value){this.safe(value);const seen=new Set();let elements=0,objects=0;const visit=v=>{if(!v||typeof v!=='object'||seen.has(v))return;seen.add(v);objects++;const children=this.children(v);elements+=children.length;for(const x of children)visit(x);};visit(value);this.count(elements,objects);return structuredClone(value);}
  cloneRoots(values){const seen=new Set();let count=0,objects=0;const visit=v=>{this.safe(v);if(!v||typeof v!=='object'||seen.has(v))return;seen.add(v);objects++;const children=this.children(v);count+=children.length;children.forEach(visit);};values.forEach(visit);this.count(count,objects);return structuredClone(values);}
  index(index,length,allowEnd=false){if(!Number.isInteger(index)||index<0||index>length-(allowEnd?0:1))throw new RangeError('Collection index out of range');return index;}
  key(key,type){if(!primitives.has(type)||type==='any'||type==='color')throw new TypeError('Map keys require float/int/bool/string');this.type(key,type);if(typeof key==='number'&&!Number.isFinite(key))throw new TypeError('Map key cannot be na');return key;}
  call(name,args,generics=[]) {
    this.budget();const [prefix,method]=name.split('.');if(!['array','map','matrix'].includes(prefix))return UNHANDLED_COLLECTION;
    if(prefix==='array'){
      if(method==='from')return this.array(args,args.length?(typeof args[0]==='number'?'float':typeof args[0]==='boolean'?'bool':typeof args[0]==='string'?'string':args[0]?.type||'any'):'any');
      if(method==='new'||method.startsWith('new_')){const type=method==='new'?(generics[0]||'float'):method.slice(4),n=this.length(args[0]??0),v=args.length>1?args[1]:type==='bool'?false:type==='string'||type==='color'?'':NaN;this.type(v,type);return this.array(Array(n).fill(v),type);}
      const a=args[0];if(a?.kind!=='array')throw new TypeError('Expected script array');const x=a.items;
      const element=v=>{this.type(v,a.type);this.preventCycle(a,v);return v;};
      switch(method){
        case'size':return x.length;case'get':return x[this.index(args[1],x.length)];
        case'set':{const index=this.index(args[1],x.length);x[index]=element(args[2]);return 0;}
        case'push':this.length(x.length+1);element(args[1]);this.count(1);x.push(args[1]);return 0;
        case'unshift':this.length(x.length+1);element(args[1]);this.count(1);x.unshift(args[1]);return 0;
        case'pop':if(!x.length)throw new RangeError('Cannot pop empty array');return x.pop();
        case'shift':if(!x.length)throw new RangeError('Cannot shift empty array');return x.shift();
        case'insert':{const i=this.index(args[1],x.length,true);this.length(x.length+1);element(args[2]);this.count(1);x.splice(i,0,args[2]);return 0;}
        case'remove':return x.splice(this.index(args[1],x.length),1)[0];
        case'clear':x.length=0;return 0;case'copy':return this.array(x,a.type);
        case'slice':{const start=this.index(args[1],x.length,true),end=this.index(args[2]??x.length,x.length,true);if(end<start)throw new RangeError('Invalid slice');return this.array(x.slice(start,end),a.type);}
        case'concat':{const b=args[1];if(b?.kind!=='array'||b.type!==a.type)throw new TypeError('Array types must match');return this.array([...x,...b.items],a.type);}
        case'includes':return x.includes(args[1]);case'indexof':return x.indexOf(args[1]);case'lastindexof':return x.lastIndexOf(args[1]);
        case'reverse':x.reverse();return 0;
        case'sort':if(x.some(v=>!['number','string'].includes(typeof v)))throw new TypeError('Sort requires scalar values');this.count(0);x.sort((a,b)=>(args[1]==='descending'?-1:1)*(typeof a==='number'?a-b:String(a).localeCompare(String(b))));return 0;
        case'sum':case'avg':case'min':case'max':case'stdev':case'variance':case'median':{if(x.some(v=>typeof v!=='number'))throw new TypeError('Numeric array required');if(!x.length)return method==='sum'?0:NaN;let mean=0,m2=0,total=0,min=Infinity,max=-Infinity;for(let i=0;i<x.length;i++){this.budget();const v=x[i],d=v-mean;mean+=d/(i+1);m2+=d*(v-mean);total+=v;min=Math.min(min,v);max=Math.max(max,v);}if(method==='median'){const s=[...x].sort((a,b)=>a-b),i=Math.floor(s.length/2);return s.length%2?s[i]:(s[i-1]+s[i])/2;}return {sum:total,avg:mean,min,max,variance:m2/x.length,stdev:Math.sqrt(Math.max(0,m2/x.length))}[method];}
        case'join':{const separator=String(args[1]??',');let size=Math.max(0,x.length-1)*separator.length;for(const value of x){this.budget();size+=String(value).length;if(size>100000)throw new RangeError('String length budget exceeded');}return x.join(separator);}
        default:throw new TypeError('Unsupported array operation '+method);
      }
    }
    if(prefix==='map'){
      if(method==='new'){const [keyType='string',type='float']=generics;if(!['string','float','int','bool'].includes(keyType))throw new TypeError('Invalid map key type');this.count(0,1);return {kind:'map',keyType,type,items:new Map()};}
      const m=args[0];if(m?.kind!=='map')throw new TypeError('Expected script map');const key=()=>this.key(args[1],m.keyType);
      switch(method){case'size':return m.items.size;case'contains':return m.items.has(key());case'get':return m.items.has(key())?m.items.get(key()):NaN;
        case'put':{const k=key(),v=this.type(args[2],m.type);this.preventCycle(m,v);const old=m.items.get(k);if(!m.items.has(k)){this.length(m.items.size+1);this.count(1);}m.items.set(k,v);return old??NaN;}
        case'remove':{const k=key(),old=m.items.get(k);m.items.delete(k);return old??NaN;}
        case'clear':m.items.clear();return 0;case'copy':this.count(m.items.size,1);return {...m,items:new Map(m.items)};
        case'keys':return this.array([...m.items.keys()],m.keyType);case'values':return this.array([...m.items.values()],m.type);
        default:throw new TypeError('Unsupported map operation '+method);
      }
    }
    if(method==='new'){const rows=this.length(args[0]??0),cols=this.length(args[1]??0),n=this.length(rows*cols),type=generics[0]||'float',v=args.length>2?args[2]:type==='bool'?false:['string','color'].includes(type)?'':NaN;this.type(v,type);this.count(n,1);return {kind:'matrix',type,rows,cols,items:Array(n).fill(v)};}
    const m=args[0];if(m?.kind!=='matrix')throw new TypeError('Expected script matrix');
    const idx=()=>this.index(args[1],m.rows)*m.cols+this.index(args[2],m.cols);
    switch(method){case'rows':return m.rows;case'columns':return m.cols;case'elements_count':return m.items.length;case'get':return m.items[idx()];case'set':{const i=idx(),v=this.type(args[3],m.type);this.preventCycle(m,v);m.items[i]=v;return 0;}
      case'row':{const r=this.index(args[1],m.rows);return this.array(m.items.slice(r*m.cols,(r+1)*m.cols),m.type);}
      case'col':{const c=this.index(args[1],m.cols);return this.array(Array.from({length:m.rows},(_,r)=>m.items[r*m.cols+c]),m.type);}
      case'copy':return this.clone(m);
      case'transpose':{this.count(m.items.length,1);return {...m,rows:m.cols,cols:m.rows,items:Array.from({length:m.items.length},(_,i)=>m.items[(i%m.rows)*m.cols+Math.floor(i/m.rows)])};}
      case'mult':{const n=args[1];if(n?.kind!=='matrix'||m.cols!==n.rows||!['float','int'].includes(m.type)||!['float','int'].includes(n.type))throw new RangeError('Matrix dimensions/types do not conform');this.length(m.rows*n.cols);this.count(m.rows*n.cols,1);const out={kind:'matrix',type:'float',rows:m.rows,cols:n.cols,items:Array(m.rows*n.cols).fill(0)};for(let i=0;i<m.rows;i++)for(let j=0;j<n.cols;j++)for(let k=0;k<m.cols;k++){this.budget();out.items[i*n.cols+j]+=m.items[i*m.cols+k]*n.items[k*n.cols+j];}return out;}
      default:throw new TypeError('Unsupported matrix operation '+method);
    }
  }
}
