import {createHash} from 'node:crypto';
/** Durable fixed-window quotas. Return the decision from the transaction before
 * throwing: rolling back on denial would also roll back quota bookkeeping.
 */
export async function sharedThrottle(store,id,{max=120,window=60000,now=Date.now()}={}){
  const key=createHash('sha256').update(id).digest('hex');
  const allowed=await store.transaction(state=>{
    state.rateBuckets??={};const buckets=state.rateBuckets;
    for(const[name,b]of Object.entries(buckets))if(b.until<=now)delete buckets[name];
    if(!Object.hasOwn(buckets,key)&&Object.keys(buckets).length>=10000)return false;
    const b=buckets[key]??={count:0,until:now+window};
    if(b.count>=max)return false;b.count++;return true;
  });
  if(!allowed)throw Object.assign(new Error('Too many requests; retry later.'),{status:429});
}
