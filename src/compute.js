import {computeIndicators,backtest} from './indicators.js';
export class ComputeClient {
  constructor(){this.next=0;this.pending=new Map();try{this.worker=new Worker(new URL('./indicator-worker.js',import.meta.url),{type:'module'});this.worker.onmessage=({data})=>{const p=this.pending.get(data.id);if(!p)return;this.pending.delete(data.id);clearTimeout(p.timer);data.error?p.reject(new Error(data.error)):p.resolve(data.result);};this.worker.onerror=()=>this.fail();}catch{this.worker=null;}}
  fail(){this.worker?.terminate();this.worker=null;for(const p of this.pending.values()){clearTimeout(p.timer);try{p.resolve(p.type==='backtest'?backtest(p.bars,p.options):computeIndicators(p.bars));}catch(e){p.reject(e);}}this.pending.clear();}
  run(type,bars,options){if(!this.worker)return Promise.resolve().then(()=>type==='backtest'?backtest(bars,options):computeIndicators(bars));return new Promise((resolve,reject)=>{const id=++this.next,timer=setTimeout(()=>this.fail(),20000);this.pending.set(id,{resolve,reject,timer,type,bars,options});this.worker.postMessage({id,type,bars,options});});}
  destroy(){this.worker?.terminate();for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('Compute client disposed.'));}this.pending.clear();}
}
