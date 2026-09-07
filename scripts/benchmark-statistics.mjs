/** Reproducible CPU microbenchmark, not a browser/GPU or market-feed benchmark.
 * The quadratic baselines are reference implementations, not production paths.
 */
import {performance} from 'node:perf_hooks';
import {cpus} from 'node:os';
import assert from 'node:assert/strict';
import {rollingMoments,rollingQuantiles,rollingPercentRank} from '../src/rolling-statistics.js';
const count=Number(process.argv[2]??20000),window=Number(process.argv[3]??512);
if(!Number.isInteger(count)||count<1000||count>100000||!Number.isInteger(window)||window<2||window>10000||window>count)throw new RangeError('Usage: node scripts/benchmark-statistics.mjs [bars=20000:1000..100000] [window=512:2..10000]');
const prices=Float64Array.from({length:count},(_,i)=>1e9+Math.sin(i*.173)*10+Math.cos(i*.311)*2+(i%31)/10);
function naiveVariance(){const output=new Float64Array(count).fill(NaN);for(let i=window-1;i<count;i++){const anchor=prices[i-window+1];let mean=0,sum=0;for(let j=i-window+1;j<=i;j++)mean+=prices[j]-anchor;mean/=window;for(let j=i-window+1;j<=i;j++){const d=(prices[j]-anchor)-mean;sum+=d*d;}output[i]=sum/window;}return output;}
function naiveMedian(){const output=new Float64Array(count).fill(NaN);for(let i=window-1;i<count;i++){const a=Array.from(prices.slice(i-window+1,i+1)).sort((a,b)=>a-b),half=(window-1)/2;output[i]=a[Math.floor(half)]*.5+a[Math.ceil(half)]*.5;}return output;}
function naiveRank(){const output=new Float64Array(count).fill(NaN);for(let i=window;i<count;i++){let below=0;for(let j=i-window;j<i;j++)below+=prices[j]<prices[i];output[i]=100*below/window;}return output;}
function measure(fn){let values;fn();const times=[];for(let r=0;r<3;r++){const t=performance.now();values=fn();times.push(performance.now()-t);}times.sort((a,b)=>a-b);return{milliseconds:times[1],values};}
const pairs=[['population variance',()=>rollingMoments(prices,window).variance,naiveVariance,1e-8],['median',()=>rollingQuantiles(prices,window,[.5])[0],naiveMedian,1e-6],['prior-window percentile rank',()=>rollingPercentRank(prices,window),naiveRank,1e-10]];
const rows=[];
for(const[name,optimized,reference,tolerance]of pairs){const fast=measure(optimized),slow=measure(reference);let maxError=0;for(let i=0;i<count;i++){const a=fast.values[i],b=slow.values[i];assert.equal(Number.isNaN(a),Number.isNaN(b),`${name} warm-up ${i}`);if(Number.isFinite(a))maxError=Math.max(maxError,Math.abs(a-b));}assert.ok(maxError<=tolerance,`${name}: ${maxError}`);rows.push({name,bars:count,window,rollingMs:fast.milliseconds,referenceMs:slow.milliseconds,ratio:slow.milliseconds/fast.milliseconds,maxError});}
console.log(JSON.stringify({node:process.version,platform:process.platform,architecture:process.arch,cpu:cpus()[0]?.model,method:'One warm-up + median of three timed runs for each implementation. Synthetic deterministic float64 inputs. No GC control or process isolation. Ratios are machine/workload-specific, not performance guarantees.',rows},null,2));
