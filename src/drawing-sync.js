import {DrawingOutbox,operationId,stableJSON} from './drawing-outbox.js';
import {DrawingDocument,DrawingReplica} from './drawing-crdt.js';
/** Explicitly joined drawing room. Local operations remain queued until the
 * server acknowledges them; retries use the same immutable operation IDs.
 * Polling also works when requests are load-balanced across same-host servers.
 */
export class RoomDrawingSync extends EventTarget {
  constructor(workbench,{outbox=new DrawingOutbox()}={}){super();this.wb=workbench;this.pending=[];this.status='Not connected';this.applying=false;this.generation=0;this.outbox=outbox;this.persistence=Promise.resolve();this.unsaved=new Map();}
  handles(symbol){return !!this.replica&&this.symbol===symbol;}
  async connect(roomId){
    await this.disconnect();
    const profile=await this.wb.server.session();if(!profile.user)throw new Error('Sign in before joining a drawing room');
    const symbol=this.wb.app.state.symbol;
    const response=await this.wb.server.request('pro/rooms/'+encodeURIComponent(roomId)+'/drawings?symbol='+encodeURIComponent(symbol));
    this.roomId=roomId;this.symbol=symbol;this.storageKey='aureon.room.pending.'+profile.user.id+'.'+roomId+'.'+symbol;
    let recovered=null;try{recovered=JSON.parse(sessionStorage.getItem(this.storageKey)||'null');}catch{}
    if(recovered&&(typeof recovered.actor!=='string'||!recovered.actor.startsWith(profile.user.id+'.')||!Array.isArray(recovered.operations)))throw new Error('Invalid saved drawing queue; export or clear its session storage explicitly');
    this.scope=JSON.stringify([profile.user.id,roomId,symbol]);
    if(recovered){await this.outbox.put(this.scope,recovered.operations);sessionStorage.removeItem(this.storageKey);}
    const operations=await this.outbox.read(this.scope);
    if(operations.some(op=>!op.actor.startsWith(profile.user.id+'.')))throw new Error('Drawing queue account mismatch');
    // Every tab/reload gets its own actor. Recovered operations keep their IDs.
    this.replica=new DrawingReplica(profile.user.id+'.'+crypto.randomUUID(),response.document);
    this.replica.merge(operations);
    this.pending=operations;this.unsaved=new Map();this.error=null;this.storageError=null;this.generation++;
    const app=this.wb.app,previous=this.originalHistory=app.history;
    this.historyAdapter={
      push:(before,after)=>{if(this.applying)return;if(this.handles(after.symbol))this.edit(before.drawings,after.drawings);else previous.push(before,after);},
      undo:()=>this.handles(app.state.symbol)?this.history('undo'):previous.undo(),
      redo:()=>this.handles(app.state.symbol)?this.history('redo'):previous.redo()
    };
    app.history=this.historyAdapter;this.apply();this.setStatus();
    this.timer=setInterval(()=>{this.synchronize().catch(e=>this.failed(e));},2000);
    this.beforeUnload=e=>{if(this.pending.length){e.preventDefault();e.returnValue='';}};
    globalThis.addEventListener?.('beforeunload',this.beforeUnload);
  }
  persist(operations=this.pending){
    if(!this.replica)return this.persistence;
    const scope=this.scope,unsaved=this.unsaved;operations=structuredClone(operations);this.saving=true;
    for(const op of operations)unsaved.set(operationId(op),op);
    const task=this.persistence.catch(()=>{}).then(async()=>{const batch=[...unsaved.values()];if(!batch.length)return;await this.outbox.put(scope,batch);for(const op of batch)if(stableJSON(unsaved.get(operationId(op)))===stableJSON(op))unsaved.delete(operationId(op));});
    this.persistence=task;
    task.then(()=>{if(this.persistence===task){this.saving=false;this.storageError=null;this.setStatus();}},error=>{if(this.persistence===task){this.saving=false;this.storageError='Drawing recovery not saved: '+error.message;this.setStatus();}});
    return task;
  }
  setStatus(){this.status=this.replica?(this.storageError?this.storageError:this.saving?'Saving drawing recovery…':this.error?'Not synchronized: '+this.error:this.pending.length?this.pending.length+' drawing operations awaiting acknowledgement':'Drawing room synchronized'):'Not connected';this.dispatchEvent(new Event('change'));}
  failed(error){this.error=error.message;this.setStatus();}
  edit(before,after){
    if(!this.replica||this.applying)return;
    const operations=this.replica.applySnapshot(before,after);this.pending.push(...operations);this.persist(operations);this.error=null;this.setStatus();
    this.synchronize().catch(e=>this.failed(e));
  }
  history(direction){
    const operations=this.replica[direction]();if(!operations.length)return null;
    this.pending.push(...operations);this.persist(operations);this.setStatus();this.synchronize().catch(e=>this.failed(e));
    return {symbol:this.symbol,drawings:this.replica.drawings};
  }
  apply(){
    if(!this.replica)return;this.applying=true;
    try{
      const app=this.wb.app,drawings=this.replica.drawings;
      app.state.drawings[this.symbol]=drawings;
      if(app.state.symbol===this.symbol){if(app.chart.pointer){this.deferredApply=true;return;}this.deferredApply=false;app.chart.drawings=drawings;if(!drawings.some(d=>d.id===app.chart.selected))app.chart.selected=null;app.chart.invalidate();app.renderDepth();}
      if(this.wb.config.syncDrawings)for(const tile of this.wb.extraCharts)if(tile.settings.symbol===this.symbol){tile.settings.drawings=structuredClone(drawings);tile.chart.drawings=tile.settings.drawings;tile.chart.selected=null;tile.chart.invalidate();}
      app.save(false);this.wb.save();
    }finally{this.applying=false;}
  }
  async synchronize(){
    if(!this.replica)return;if(this.inFlight)return this.inFlight;
    const generation=this.generation,url='pro/rooms/'+encodeURIComponent(this.roomId)+'/drawings?symbol='+encodeURIComponent(this.symbol);
    this.inFlight=(async()=>{
      do {
        if(this.unsaved.size)await this.persist([]);else await this.persistence;
        const batch=this.pending.slice(0,256),response=await this.wb.server.request(url,batch.length?{method:'POST',body:{operations:batch}}:{});
        if(generation!==this.generation)return;
        // Merge before dropping acknowledged operations: corrupted replies must
        // never be treated as a successful save.
        const remote=new DrawingDocument(response.document),received=new Map(remote.snapshot().operations.map(op=>[operationId(op),stableJSON(op)]));
        if(batch.some(op=>received.get(operationId(op))!==stableJSON(op)))throw new Error('Server did not acknowledge the exact drawing operations');
        const changed=this.replica.merge(response.document.operations);
        await this.outbox.acknowledge(this.scope,batch);
        if(generation!==this.generation)return;
        if(batch.length){const acknowledged=new Set(batch.map(op=>op.actor+':'+op.clock));this.pending=this.pending.filter(op=>!acknowledged.has(op.actor+':'+op.clock));}
        this.error=null;if(changed||batch.length||this.deferredApply)this.apply();this.setStatus();
      }while(this.pending.length&&generation===this.generation);
    })();
    try{await this.inFlight;}finally{this.inFlight=null;}
  }
  destroy(){
    clearInterval(this.timer);this.generation++;
    globalThis.removeEventListener?.('beforeunload',this.beforeUnload);
    if(this.wb.app.history===this.historyAdapter)this.wb.app.history=this.originalHistory;
    this.replica=null; // Persisted operations survive tab closure for explicit rejoin.
    this.persistence.finally(()=>this.outbox.close()).catch(()=>{});
  }
  async disconnect(){
    if(!this.replica)return;
    await this.synchronize(); // Failed delivery leaves the connection and queue intact.
    clearInterval(this.timer);this.generation++;
    globalThis.removeEventListener?.('beforeunload',this.beforeUnload);
    if(this.wb.app.history===this.historyAdapter)this.wb.app.history=this.originalHistory;
    this.replica=null;this.roomId=null;this.symbol=null;this.pending=[];this.error=null;this.setStatus();
  }
}
