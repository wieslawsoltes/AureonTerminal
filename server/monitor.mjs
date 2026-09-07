/** Persistent polling monitors. First crossing observation establishes a baseline.
 * Provider failures never fabricate samples. Concurrent edits revoke pending emits.
 */
import {RulesEngine} from '../src/alerts-v2.js';
export class AlertMonitor {
  constructor(store,providers,publish,{interval=15000}={}){this.store=store;this.providers=providers;this.publish=publish;this.interval=Math.max(5000,interval);this.previous=new Map();this.errors=new Map();}
  start(){this.timer=setInterval(()=>this.poll().catch(()=>{}),this.interval);this.timer.unref?.();}
  async poll(){
    if(this.busy)return;this.busy=true;
    try{
      const rules=this.store.state.alerts.filter(r=>r.active),groups=new Map();
      for(const r of rules){const key=r.symbol+':'+r.interval;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
      for(const[key,list]of groups){
        try{
          const sample=await this.providers.alertValues(list[0].symbol,list[0].interval),engine=new RulesEngine(list.map(r=>({...r,mode:'market'})));
          for(const r of list){const old=this.previous.get(r.id);if(old?.revision===r.updated)engine.previous.set(r.id,old.values);}
          const events=[...engine.update(list[0].symbol,sample.values,{...sample,confirmed:false,mode:'market',frequency:'intrabar'}),...engine.update(list[0].symbol,{...sample.values,price:sample.values.close},{...sample,confirmed:true,mode:'market',frequency:'close'})];
          for(const[r,v]of engine.previous)this.previous.set(r,{revision:list.find(x=>x.id===r).updated,values:v});
          if(events.length||engine.rules.some((r,i)=>r.active!==list[i].active)){
            const committed=await this.store.transaction(state=>{
              const valid=new Map();
              for(const r of engine.rules){const stored=state.alerts.find(x=>x.id===r.id);if(stored?.active&&stored.updated===r.updated){valid.set(r.id,stored.userId);stored.active=r.active;stored.lastFired=r.lastFired;stored.lastBar=r.lastBar;stored.status=r.status;}}
              const accepted=events.filter(e=>valid.has(e.ruleId)).map(e=>({...e,userId:valid.get(e.ruleId)}));
              state.alertLog.push(...accepted);state.alertLog=state.alertLog.slice(-10000);return accepted;
            });
            for(const e of committed)this.publish(e.userId,{type:'alert',event:e});
          }
          this.errors.delete(key);
        }catch(e){this.errors.set(key,{error:e.message,time:Date.now()});}
      }
      const active=new Set(this.store.state.alerts.filter(r=>r.active).map(r=>r.id));for(const id of this.previous.keys())if(!active.has(id))this.previous.delete(id);
    }finally{this.busy=false;}
  }
  async stop(){clearInterval(this.timer);while(this.busy)await new Promise(r=>setTimeout(r,10));}
}
