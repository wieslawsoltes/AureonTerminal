import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {demoCandles} from '../src/core.js';
import {computeIndicators,backtest} from '../src/indicators.js';

/** Exercise the actual browser worker handler with a minimal Node transport shim.
 * Browser-specific worker creation is checked separately by the browser suite. */
async function workerRequest(payload){
  const moduleUrl=new URL('../src/indicator-worker.js',import.meta.url).href;
  const source=`import {parentPort} from 'node:worker_threads';
    globalThis.self={postMessage:(message,transfer)=>parentPort.postMessage(message,transfer)};
    await import(${JSON.stringify(moduleUrl)});
    parentPort.on('message',data=>self.onmessage({data}));`;
  const worker=new Worker(new URL('data:text/javascript,'+encodeURIComponent(source)),{type:'module'});
  try{return await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);worker.postMessage(payload);});}
  finally{await worker.terminate();}
}
test('worker computes and transfers real Float64 indicator outputs',async()=>{const bars=demoCandles(500),message=await workerRequest({id:42,type:'indicators',bars});assert.equal(message.id,42);assert.ok(message.result.rsi instanceof Float64Array);assert.deepEqual(message.result,computeIndicators(bars));});
test('worker backtest equals the synchronous auditable reference',async()=>{const bars=demoCandles(400),options={fast:5,slow:15};const message=await workerRequest({id:1,type:'backtest',bars,options});assert.deepEqual(message.result,backtest(bars,options));});
test('worker errors preserve request identity and do not fake a result',async()=>{const message=await workerRequest({id:7,type:'backtest',bars:[]});assert.equal(message.id,7);assert.equal(typeof message.error,'string');assert.equal(message.result,undefined);});
