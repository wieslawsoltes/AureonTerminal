/** Monotonic fencing tokens; ownership checks must occur in the same database
 * transaction as the protected mutation. A lease is not an exactly-once claim.
 */
import {randomUUID} from 'node:crypto';
export class LeaseCoordinator {
  constructor(store,{owner=randomUUID(),clock=Date.now}={}){this.store=store;this.owner=owner;this.clock=clock;}
  async acquire(name,ttl=60000) {
    if(typeof name!=='string'||!/^[a-z0-9:.-]{1,100}$/i.test(name)||!Number.isFinite(ttl)||ttl<100||ttl>3600000)throw new Error('Invalid lease');
    return this.store.transaction(state=>{
      state.leases??={};const previous=state.leases[name],now=this.clock();
      if(previous?.until>now)return null;
      const lease={name,owner:this.owner,token:(previous?.token||0)+1,until:now+ttl};state.leases[name]=lease;return {...lease};
    });
  }
  owns(state,lease){const current=state.leases?.[lease?.name];return !!current&&current.owner===lease.owner&&current.token===lease.token&&current.until>this.clock();}
  async release(lease){if(!lease)return;await this.store.transaction(state=>{if(this.owns(state,lease))state.leases[lease.name].until=this.clock();});}
  async renew(lease,ttl=60000){if(!Number.isFinite(ttl)||ttl<100||ttl>3600000)throw new Error('Invalid lease TTL');return this.store.transaction(state=>{if(!this.owns(state,lease))return false;state.leases[lease.name].until=this.clock()+ttl;return true;});}
}
