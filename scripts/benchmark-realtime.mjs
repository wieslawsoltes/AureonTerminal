/** Reproducible synthetic CPU benchmark. No sockets, orders or timing assertions.
 * Includes result construction/accumulation; excludes browser rendering and IPC.
 */
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {LiveScriptRuntime} from '../src/script-live.js';
import {LiveResultAccumulator} from '../src/script-live-result.js';
const source='indicator("CPU benchmark")\nx=ta.ema(close,20)\ny=ta.sma(close,40)\nz=ta.stdev(close,30)\nplot(x)\nplot(y)\nplot(z)\nplot(ta.rsi(close,14))';
const seed=Array.from({length:1200},(_,i)=>({t:1700000000+i*60,o:100+Math.sin(i/9),h:102+Math.sin(i/9),l:98+Math.sin(i/9),c:100+Math.sin(i/9),v:100}));
const iterations=40;
function run(mode) {
  const runtime=new LiveScriptRuntime(),start=performance.now();
  const initial=runtime.run('live-start',seed,{source,interval:60,symbol:'SYNTHETIC',asOf:seed.at(-1).t+1,engine:mode,transport:mode==='incremental'?'tail':'full',sessionId:'benchmark'});
  const accumulator=mode==='incremental'?new LiveResultAccumulator(initial):null,seedMs=performance.now()-start;
  let output=initial,totalCells=0,totalOperations=0;
  const begin=performance.now();
  for(let i=1;i<=iterations;i++) {
    const bar={...seed.at(-1),v:100+i,c:100+Math.sin(i/11)};
    const result=runtime.run('live-update',[],{bar,asOf:bar.t+1+i,sequence:i});
    totalCells+=result.plots.reduce((n,p)=>n+p.values.length,0);totalOperations+=result.operations;
    output=accumulator?accumulator.apply(result):result;
  }
  return {seedMs,updateMs:performance.now()-begin,numericCells:totalCells,kernelOperations:totalOperations,output};
}
run('incremental');run('reference');
const fast=[],reference=[];
for(let i=0;i<3;i++) {
  const a=run('incremental'),b=run('reference');
  a.output.plots.forEach((p,k)=>p.values.forEach((v,j)=>assert.ok(Object.is(v,b.output.plots[k].values[j])||Math.abs(v-b.output.plots[k].values[j])<1e-8,'Differential benchmark check')));
  delete a.output;delete b.output;fast.push(a);reference.push(b);
}
const median=(runs,key)=>runs.map(x=>x[key]).sort((a,b)=>a-b)[1];
const summarize=runs=>Object.fromEntries(Object.keys(runs[0]).map(key=>[key,median(runs,key)]));
console.log(JSON.stringify({source:'Deterministic synthetic OHLCV; no production observations',node:process.version,seedBars:seed.length,updates:iterations,warmups:1,repetitions:3,
  statistic:'median',incremental:summarize(fast),reference:summarize(reference),
  caveat:'CPU in one Node process including snapshots/assembly, excluding IPC/rendering. No GC/CPU isolation, SLA, GPU or feed-throughput claim.'},null,2));
