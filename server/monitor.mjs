/** Polling monitor with durable baselines and fenced ownership. Provider errors
 * never fabricate samples; stale owners cannot commit after lease takeover.
 */
import {appendEvent} from './events.mjs';
import {enqueueDelivery} from './delivery-pro.mjs';
import {RulesEngine} from '../src/alerts-v2.js';
import {LeaseCoordinator} from './lease.mjs';
export class AlertMonitor {
  constructor(store,providers,publish,{interval=15000}={}){
    Object.assign(this,{store,providers,publish});this.interval=Math.max(5000,interval);
    this.previous=new Map();this.errors=new Map();this.coordinator=new LeaseCoordinator(store);
  }
  start(){this.timer=setInterval(()=>this.poll().catch(()=>{}),this.interval);this.timer.unref?.();}
  async poll(){
    if(this.busy)return;this.busy=true;let lease;
    try{
      lease=await this.coordinator.acquire('monitors:prices');if(!lease)return;
      const groups=new Map();
      for(const r of this.store.state.alerts.filter(r=>r.active)){
        const key=r.symbol+':'+r.interval;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);
      }
      for(const [key,list]of groups){
        try{
          const sample=await this.providers.alertValues(list[0].symbol,list[0].interval);
          if(!Number.isFinite(sample.time))throw new Error('Provider sample has no valid observation time');
          const engine=new RulesEngine(list.map(r=>({...r,mode:'market'})));
          for(const r of list){const old=r.observation;if(old?.revision===r.updated)engine.previous.set(r.id,old.values);}
          const events=[...engine.update(list[0].symbol,sample.values,{...sample,confirmed:false,mode:'market',frequency:'intrabar'}),
            ...engine.update(list[0].symbol,{...sample.values,price:sample.values.close},{...sample,confirmed:true,mode:'market',frequency:'close'})];
          const committed=await this.store.transaction(state=>{
            if(!this.coordinator.owns(state,lease))return [];
            const valid=new Map();
            for(const r of engine.rules){
              const stored=state.alerts.find(x=>x.id===r.id);
              if(!stored?.active||stored.updated!==r.updated||stored.observation?.time>=sample.time)continue;
              valid.set(r.id,stored.userId);
              Object.assign(stored,{active:r.active,lastFired:r.lastFired,lastBar:r.lastBar,status:r.status,
                observation:{revision:r.updated,time:sample.time,values:engine.previous.get(r.id)}});
            }
            const accepted=events.filter(e=>valid.has(e.ruleId)).map(e=>({...e,userId:valid.get(e.ruleId)}));
            for(const event of accepted){enqueueDelivery(state,event.userId,event);appendEvent(state,event.userId,{type:'alert',event});}
            state.alertLog.push(...accepted);state.alertLog=state.alertLog.slice(-10000);return accepted;
          });
          for(const event of committed)this.publish(event.userId,{type:'alert',event});
          this.errors.delete(key);
        }catch(error){this.errors.set(key,{error:error.message,time:Date.now()});}
      }
    }finally{try{await this.coordinator.release(lease);}finally{this.busy=false;}}
  }
  async stop(){clearInterval(this.timer);while(this.busy)await new Promise(r=>setTimeout(r,10));}
}
