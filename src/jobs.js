import {computeStudies} from './studies.js';
import {runScript} from './script.js';
import {runBacktest,parameterSweep} from './execution.js';
import {runPortfolioBacktest} from './execution-pro.js';
import {scanPatterns} from './patterns.js';
import {ema} from './indicators.js';
export function movingAverageSignals(bars,fast=12,slow=26){if(!Number.isInteger(fast)||!Number.isInteger(slow)||fast<1||fast>=slow||slow>10000)throw new Error('Require 1 ≤ fast < slow ≤ 10,000.');const close=bars.map(x=>x.c),a=ema(close,fast),b=ema(close,slow),commands=[];for(let i=1;i<bars.length;i++){if(bars[i].partial)continue;if(a[i]>b[i]&&a[i-1]<=b[i-1])commands.push({index:i,action:'entry',direction:1});if(a[i]<b[i]&&a[i-1]>=b[i-1])commands.push({index:i,action:'entry',direction:-1});}return commands;}
export function performJob(type,bars,options={}){switch(type){case'patterns':return scanPatterns(bars,options);case'portfolio':{const commands=options.source?runScript(options.source,bars,options).commands:movingAverageSignals(bars,options.fast,options.slow);return runPortfolioBacktest(bars,{...options,commands});}case'studies':return computeStudies(bars,options.specs);case'script':return runScript(options.source,bars,options);case'backtest':{const commands=options.source?runScript(options.source,bars,options).commands:movingAverageSignals(bars,options.fast,options.slow);return runBacktest(bars,{...options,commands});}case'sweep':return parameterSweep(bars,movingAverageSignals,options);default:throw new Error('Unknown job '+type);}}
export class JobClient {
  constructor(){this.jobs=new Map();this.next=0;this.spawn();}
  spawn(){try{this.worker=new Worker(new URL('./engine-worker.js',import.meta.url),{type:'module'});this.worker.onmessage=({data})=>{const job=this.jobs.get(data.id);if(!job)return;this.jobs.delete(data.id);clearTimeout(job.timer);data.error?job.reject(new Error(data.error)):job.resolve(data.result);};this.worker.onerror=e=>this.failWorker(e.message||'Worker unavailable or blocked by browser policy');}catch{this.worker=null;}}
  failWorker(reason){this.failureReason=reason;this.worker?.terminate();this.worker=null;const pending=[...this.jobs.values()];this.jobs.clear();for(const job of pending){clearTimeout(job.timer);if(job.bars.length>10000)job.reject(new Error('Worker unavailable; synchronous fallback is limited to 10,000 bars.'));else Promise.resolve().then(()=>performJob(job.type,job.bars,job.options)).then(job.resolve,job.reject);}}
  reset(reason){this.worker?.terminate();this.worker=null;for(const job of this.jobs.values()){clearTimeout(job.timer);job.reject(new Error(reason));}this.jobs.clear();}
  run(type,bars,options={}){if(!this.worker){if(bars.length>10000)return Promise.reject(new Error('Worker unavailable; synchronous fallback is limited to 10,000 bars.'));return Promise.resolve().then(()=>performJob(type,bars,options));}return new Promise((resolve,reject)=>{const id=++this.next,timer=setTimeout(()=>{this.reset('Computation timed out and was terminated.');this.spawn();},30000);this.jobs.set(id,{resolve,reject,timer,type,bars,options});this.worker.postMessage({id,type,bars,options});});}
  cancel(){this.reset('Computation canceled.');this.spawn();}
  destroy(){this.reset('Worker disposed.');}
}
