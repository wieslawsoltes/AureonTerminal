/** Append-only, operation-set drawing CRDT.
 * Each property is a Lamport/actor ordered register. Undo is an authored toggle
 * of a previous operation, not a compensating overwrite of someone else's edit.
 * No history is discarded: capacity exhaustion fails before mutation.
 */
import {DRAWING_TOOLS} from './drawings.js';
const MAX_CLOCK = 1_000_000_000;
const FIELDS = new Set(['type','points','color','width','text','locked','hidden','group','z','fill','opacity','name','ratios','quantity','intervals','$alive']);
const unsafe = new Set(['__proto__','constructor','prototype']);
const text = (v, max=160) => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\x00-\x1f]/.test(v);
const compare = (a,b) => a.clock-b.clock || (a.actor < b.actor ? -1 : a.actor > b.actor ? 1 : 0);
const id = op => op.actor+':'+op.clock;
function bounded(value, depth=0) {
  if(depth>8) throw new Error('Drawing data nesting limit');
  if(value===null || typeof value==='boolean') return;
  if(typeof value==='number' && Number.isFinite(value)) return;
  if(typeof value==='string' && value.length<=4000) return;
  if(Array.isArray(value) && value.length<=4000) { value.forEach(x=>bounded(x,depth+1)); return; }
  if(value && Object.getPrototypeOf(value)===Object.prototype && Object.keys(value).length<=16) {
    for(const [k,v] of Object.entries(value)) { if(unsafe.has(k)) throw new Error('Unsafe drawing field'); bounded(v,depth+1); } return;
  }
  throw new Error('Invalid drawing data');
}
function canonical(value) {
  if(Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if(value && typeof value==='object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
function operation(raw) {
  if(!raw || !text(raw.actor,128) || !/^[A-Za-z0-9_.-]+$/.test(raw.actor) || !Number.isSafeInteger(raw.clock) || raw.clock<1 || raw.clock>=MAX_CLOCK) throw new Error('Invalid drawing operation identity');
  const out={actor:raw.actor,clock:raw.clock,kind:raw.kind};
  if(raw.kind==='toggle') {
    if(!Number.isSafeInteger(raw.target) || raw.target<1 || raw.target>=raw.clock || typeof raw.enabled!=='boolean') throw new Error('Invalid authored undo operation');
    return {...out,target:raw.target,enabled:raw.enabled};
  }
  if(raw.kind!=='set' || !text(raw.drawing) || !raw.fields || Object.getPrototypeOf(raw.fields)!==Object.prototype) throw new Error('Invalid drawing operation');
  const fields=Object.entries(raw.fields); if(!fields.length || fields.length>FIELDS.size) throw new Error('Invalid drawing patch capacity');
  for(const [key,v] of fields) {
    if(!FIELDS.has(key)) throw new Error('Unknown drawing property '+key); bounded(v);
    if(key==='intervals' && v!==null && (!Array.isArray(v)||v.length>32||v.some(x=>!Number.isSafeInteger(x)||x<1||x>31536000)))throw new Error('Invalid drawing intervals');
    if(['text','name','group'].includes(key)&&v!==null&&typeof v!=='string')throw new Error('Drawing text fields must be strings');
    if(key==='opacity'&&v!==null&&(!Number.isFinite(v)||v<0||v>1))throw new Error('Invalid drawing opacity');
    if(key==='quantity'&&v!==null&&(!Number.isFinite(v)||v<0))throw new Error('Invalid drawing quantity');
    if(key==='z'&&v!==null&&(!Number.isSafeInteger(v)||Math.abs(v)>1000000))throw new Error('Invalid drawing order');
    if(key==='ratios'&&v!==null&&(!Array.isArray(v)||v.length>100||v.some(x=>!Number.isFinite(x))))throw new Error('Invalid drawing ratios');
    if(key==='$alive' && typeof v!=='boolean') throw new Error('Membership must be boolean');
    if(key==='type' && !Object.hasOwn(DRAWING_TOOLS,v)) throw new Error('Unknown drawing tool');
    if(key==='points' && (!Array.isArray(v) || v.length>4000 || v.some(p=>!p || !Number.isFinite(p.t) || p.t<0 || !Number.isFinite(p.p)))) throw new Error('Invalid drawing anchors');
    if(['locked','hidden'].includes(key) && v!==null && typeof v!=='boolean') throw new Error('Invalid drawing flag');
    if(key==='width' && v!==null && (!Number.isFinite(v)||v<.5||v>10)) throw new Error('Drawing width must be 0.5..10');
    if(['color','fill'].includes(key) && v!==null && (typeof v!=='string'||!/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v))) throw new Error('Invalid drawing color');
  }
  return {...out,drawing:raw.drawing,fields:structuredClone(raw.fields)};
}
export class DrawingDocument {
  constructor(snapshot={version:1,operations:[]}, {maxOperations=10000,maxBytes=8_000_000}={}) {
    if(snapshot.version!==1 || !Array.isArray(snapshot.operations)) throw new Error('Unsupported drawing document');
    this.maxOperations=maxOperations;this.maxBytes=maxBytes;this.ops=new Map();this.clock=0;this.revision=0;this.merge(snapshot.operations);
  }
  merge(batch) {
    if(!Array.isArray(batch)||batch.length>this.maxOperations) throw new Error('Drawing operation capacity exceeded');
    const next=new Map(this.ops);let clock=this.clock,added=0;
    for(const raw of batch) {
      const op=operation(raw),key=id(op),old=next.get(key);
      if(old && canonical(old)!==canonical(op)) throw new Error('Drawing operation identity reused with different content');
      if(!old){next.set(key,op);added++;}clock=Math.max(clock,op.clock);
    }
    if(next.size>this.maxOperations || new TextEncoder().encode(canonical([...next.values()])).byteLength>this.maxBytes) throw new Error('Drawing document capacity exceeded; export a checkpoint before continuing');
    if(added){this.ops=next;this.clock=clock;this.revision++;this.cached=null;}return added;
  }
  snapshot() { return {version:1,operations:[...this.ops.values()].sort(compare).map(x=>structuredClone(x))}; }
  materialize() {
    if(this.cached) return structuredClone(this.cached);
    const flags=new Map(),objects=new Map(),ordered=[...this.ops.values()].sort(compare);
    for(const op of ordered) if(op.kind==='toggle') flags.set(op.actor+':'+op.target,op.enabled);
    for(const op of ordered) {
      if(op.kind!=='set' || flags.get(id(op))===false) continue;
      if(!objects.has(op.drawing)) objects.set(op.drawing,{id:op.drawing});
      Object.assign(objects.get(op.drawing),op.fields);
    }
    const result=[];
    for(const o of objects.values()) {
      const def=DRAWING_TOOLS[o.type];
      if(o.$alive!==true||!def||!Array.isArray(o.points)||(def.points ? o.points.length!==def.points : o.points.length<2)) continue;
      const {$alive,...drawing}=o;for(const key of Object.keys(drawing))if(drawing[key]===null)delete drawing[key];result.push(drawing);
    }
    result.sort((a,b)=>(a.z||0)-(b.z||0)||(a.id<b.id?-1:a.id>b.id?1:0));this.cached=result;
    return structuredClone(result);
  }
}
export class DrawingReplica {
  constructor(actor,snapshot,options) {
    if(!text(actor,128)||!/^[A-Za-z0-9_.-]+$/.test(actor)) throw new Error('Invalid replica actor');
    this.actor=actor;this.document=new DrawingDocument(snapshot,options);this.undoStack=[];this.redoStack=[];
  }
  merge(batch){return this.document.merge(batch);}
  get drawings(){return this.document.materialize();}
  applySnapshot(before,after) {
    if(!Array.isArray(before)||!Array.isArray(after)||after.length>1000) throw new Error('Drawing snapshot capacity exceeded');
    if(new Set(after.map(d=>d.id)).size!==after.length) throw new Error('Duplicate drawing ID');
    const old=new Map(before.map(d=>[d.id,d])),next=new Map(after.map(d=>[d.id,d])),batch=[];let clock=this.document.clock;
    for(const [key,d] of next) {
      if(!text(key)) throw new Error('Drawing ID is required');
      const previous=old.get(key),fields={};if(!previous){fields.$alive=true;fields.z=after.indexOf(d);}
      for(const [field,value] of Object.entries(d)) if(field!=='id' && value!==undefined) {
        if(!FIELDS.has(field)) throw new Error('Unsupported shared drawing property '+field);
        if(!previous || canonical(value)!==canonical(previous[field])) fields[field]=value;
      }
      if(previous) for(const field of Object.keys(previous)) if(field!=='id'&&FIELDS.has(field)&&!Object.hasOwn(d,field)) fields[field]=null;
      if(before.map(x=>x.id).filter(x=>next.has(x)).join('\0')!==after.map(x=>x.id).filter(x=>old.has(x)).join('\0'))fields.z=after.indexOf(d);
      if(Object.keys(fields).length) batch.push({kind:'set',actor:this.actor,clock:++clock,drawing:key,fields});
    }
    for(const key of old.keys()) if(!next.has(key)) batch.push({kind:'set',actor:this.actor,clock:++clock,drawing:key,fields:{$alive:false}});
    this.document.merge(batch);
    if(batch.length){this.undoStack.push(batch.map(x=>x.clock));this.redoStack=[];}return batch;
  }
  toggle(from,to,enabled) {
    const group=from.at(-1);if(!group)return [];
    let clock=this.document.clock;const batch=group.map(target=>({kind:'toggle',actor:this.actor,clock:++clock,target,enabled}));
    this.document.merge(batch);from.pop();to.push(group);return batch;
  }
  undo(){return this.toggle(this.undoStack,this.redoStack,false);}
  redo(){return this.toggle(this.redoStack,this.undoStack,true);}
}
