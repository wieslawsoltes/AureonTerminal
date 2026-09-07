import {DrawingReplica} from './drawing-crdt.js';
/** Explicitly joined drawing room. Local operations remain queued until the
 * server acknowledges them; retries use the same immutable operation IDs.
 * Polling also works when requests are load-balanced across same-host servers.
 */
export class RoomDrawingSync extends EventTarget {
  constructor(workbench){super();this.wb=workbench;this.pending=[];this.status='Not connected';this.applying=false;this.generation=0;}
  handles(symbol){return !!this.replica&&this.symbol===symbol;}
  async connect(roomId){
    await this.disconnect();
    const profile=await this.wb.server.session();if(!profile.user)throw new Error('Sign in before joining a drawing room');
    const symbol=this.wb.app.state.symbol;
    const response=await this.wb.server.request('pro/rooms/'+encodeURIComponent(roomId)+'/drawings?symbol='+encodeURIComponent(symbol));
    this.roomId=roomId;this.symbol=symbol;this.storageKey='aureon.room.pending.'+profile.user.id+'.'+roomId+'.'+symbol;
    let recovered=null;try{recovered=JSON.parse(sessionStorage.getItem(this.storageKey)||'null');}catch{}
    if(recovered&&(typeof recovered.actor!=='string'||!recovered.actor.startsWith(profile.user.id+'.')||!Array.isArray(recovered.operations)))throw new Error('Invalid saved drawing queue; export or clear its session storage explicitly');
    this.replica=new DrawingReplica(recovered?.actor||profile.user.id+'.'+crypto.randomUUID(),response.document);
    if(recovered)this.replica.merge(recovered.operations);
    this.pending=recovered?.operations||[];this.error=null;this.generation++;
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
  persist(){if(!this.storageKey)return;try{if(this.pending.length)sessionStorage.setItem(this.storageKey,JSON.stringify({actor:this.replica.actor,operations:this.pending}));else sessionStorage.removeItem(this.storageKey);this.storageError=null;}catch{this.storageError='Pending drawing queue could not be saved in this tab; keep the page open';}}
  setStatus(){this.status=this.replica?(this.storageError?this.storageError:this.error?'Not synchronized: '+this.error:this.pending.length?this.pending.length+' drawing operations awaiting acknowledgement':'Drawing room synchronized'):'Not connected';this.dispatchEvent(new Event('change'));}
  failed(error){this.error=error.message;this.setStatus();}
  edit(before,after){
    if(!this.replica||this.applying)return;
    const operations=this.replica.applySnapshot(before,after);this.pending.push(...operations);this.persist();this.error=null;this.setStatus();
    this.synchronize().catch(e=>this.failed(e));
  }
  history(direction){
    const operations=this.replica[direction]();if(!operations.length)return null;
    this.pending.push(...operations);this.persist();this.setStatus();this.synchronize().catch(e=>this.failed(e));
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
        const batch=this.pending.slice(0,256),response=await this.wb.server.request(url,batch.length?{method:'POST',body:{operations:batch}}:{});
        if(generation!==this.generation)return;
        // Merge before dropping acknowledged operations: corrupted replies must
        // never be treated as a successful save.
        const changed=this.replica.merge(response.document.operations);
        if(batch.length){const acknowledged=new Set(batch.map(op=>op.actor+':'+op.clock));this.pending=this.pending.filter(op=>!acknowledged.has(op.actor+':'+op.clock));}
        this.persist();this.error=null;if(changed||batch.length||this.deferredApply)this.apply();this.setStatus();
      }while(this.pending.length&&generation===this.generation);
    })();
    try{await this.inFlight;}finally{this.inFlight=null;}
  }
  destroy(){
    this.persist();clearInterval(this.timer);this.generation++;
    globalThis.removeEventListener?.('beforeunload',this.beforeUnload);
    if(this.wb.app.history===this.historyAdapter)this.wb.app.history=this.originalHistory;
    this.replica=null; // Pending operations stay in session storage for explicit rejoin.
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
