/** Visit each finite line run's ordered first/extrema/last samples per LOD bucket.
 * A gap or explicit break starts a new path even INSIDE a decimation bucket.
 * O(visible samples), constant auxiliary storage, no fabricated bridging segment.
 */
export function visitLineEnvelope(values, first, last, stride, breaks, emit) {
  if (!Number.isInteger(stride)||stride<1||!Number.isInteger(first)||first<0||!Number.isInteger(last)||last<first||typeof emit!=='function') throw new RangeError('Invalid line decimation range');
  last=Math.min(last,values.length);let connected=false;
  for(let block=first;block<last;block+=stride) {
    const end=Math.min(last,block+stride);let i=block;
    while(i<end) {
      if(!Number.isFinite(values[i])) {connected=false;i++;continue;}
      if(breaks?.[i])connected=false;
      const start=i;let low=i,high=i;i++;
      while(i<end&&Number.isFinite(values[i])&&!breaks?.[i]) {
        if(values[i]<values[low])low=i;if(values[i]>values[high])high=i;i++;
      }
      const points=[...new Set([start,low,high,i-1])].sort((a,b)=>a-b);
      for(const index of points){emit(index,!connected);connected=true;}
      if(i<end)connected=false;
    }
  }
}
