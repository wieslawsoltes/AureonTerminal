/** Independent, bounded worker pool. Cancellation never touches chart workers. */
import {JobClient} from './jobs.js';
import {prepareScreenSnapshot} from './script-screening.js';
import {screenColumns} from './screening-query.js';
function canceled(){const error=new Error('Screening canceled');error.name='AbortError';return error;}
export class ScreeningClient {
  constructor({createClient=()=>new JobClient(),hardware=globalThis.navigator?.hardwareConcurrency||2}={}){this.createClient=createClient;this.hardware=hardware;this.next=0;this.active=null;this.disposed=false;}
  cancel(){const session=this.active;if(!session)return false;session.canceled=true;this.active=null;for(const client of session.clients)client.destroy();return true;}
  destroy(){this.cancel();this.lastSnapshot=null;this.disposed=true;}
  dataset(index){if(!this.lastSnapshot||!Number.isInteger(index)||index<0||index>=this.lastSnapshot.universe.length)throw new Error('No completed dataset for this index');return structuredClone(this.lastSnapshot.universe[index]);}
  async run(options,onProgress=()=>{}) {
    if(this.disposed)throw new Error('Screening client disposed');
    this.cancel();this.lastSnapshot=null;const snapshot=prepareScreenSnapshot(options),requested=options.workers??Math.max(1,Math.min(4,this.hardware-1));
    if(!Number.isInteger(requested)||requested<1||requested>4)throw new RangeError('Screen worker count must be 1–4');
    const desired=Math.max(1,Math.min(requested,snapshot.universe.length,Math.floor(1000000/Math.max(1,snapshot.totalBars))));
    const session={id:'scan-'+(++this.next),clients:[],canceled:false};this.active=session;
    const rows=new Array(snapshot.universe.length);let next=0,completed=0,mode='workers';
    const assertCurrent=()=>{if(session.canceled||this.active!==session)throw canceled();};
    const progress=()=>{assertCurrent();onProgress({completed,total:rows.length,asOf:snapshot.asOf,workers:session.clients.length,mode,rows:structuredClone(rows.filter(Boolean))});};
    try{
      for(let i=0;i<desired;i++){
        const client=this.createClient();session.clients.push(client);
        if(!client.worker){
          if(i>0||snapshot.totalBars>10000)throw new Error('Worker unavailable; synchronous screening is limited to 10,000 total bars');
          mode='synchronous-limited';snapshot.maxOperations=Math.min(snapshot.maxOperations,250000);break;
        }
      }
      await Promise.all(session.clients.map(c=>c.run('screen-init',[],{...snapshot,session:session.id})));assertCurrent();progress();
      await Promise.all(session.clients.map(async client=>{
        while(next<rows.length){
          assertCurrent();const index=next++;
          const row=await client.run('screen-symbol',[],{session:session.id,index});assertCurrent();
          if(row.index!==index)throw new Error('Mismatched screening worker response');
          row.excluded=snapshot.universe[index].excluded;rows[index]=row;completed++;screenColumns(rows.filter(Boolean));progress();
          // Yield between symbols, including when Worker is unavailable.
          await new Promise(resolve=>setTimeout(resolve,0));
        }
      }));
      assertCurrent();
      this.lastSnapshot=snapshot;
      return{version:1,asOf:snapshot.asOf,source:snapshot.source,inputs:snapshot.inputs,libraries:snapshot.libraries,rows,workers:session.clients.length,mode,maxOperations:snapshot.maxOperations,totalBars:snapshot.totalBars,columns:screenColumns(rows)};
    }catch(error){if(session.canceled)throw canceled();throw error;}
    finally{for(const client of session.clients)client.destroy();if(this.active===session)this.active=null;}
  }
}
