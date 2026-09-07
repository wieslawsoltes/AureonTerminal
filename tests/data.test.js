import test from 'node:test';
import assert from 'node:assert/strict';
import {MarketData} from '../src/data.js';
import {CandleSeries,bucketTime,validateWorkspace,demoCandles} from '../src/core.js';
const originalWS=globalThis.WebSocket;
class SocketFixture {
  static instances=[];
  constructor(url){this.url=url;this.sent=[];SocketFixture.instances.push(this);}
  send(message){this.sent.push(JSON.parse(message));}
  close(){this.onclose?.();}
  open(){this.onopen?.();}
  receive(message){this.onmessage?.({data:JSON.stringify(message)});}
}
function ticker(overrides={}){return{type:'ticker',product_id:'BTC-USD',price:'100',time:'2025-01-01T00:00:10.000Z',trade_id:1,last_size:'2',side:'sell',best_bid:'99',best_ask:'101',open_24h:'95',high_24h:'105',low_24h:'90',volume_24h:'1000',...overrides};}

test('public WebSocket subscription uses documented ticker and heartbeat channels',()=>{globalThis.WebSocket=SocketFixture;const m=new MarketData();try{m.connect(['BTC-USD','ETH-USD']);const s=SocketFixture.instances.at(-1);s.open();assert.equal(s.url,'wss://ws-feed.exchange.coinbase.com');assert.deepEqual(s.sent[0],{type:'subscribe',product_ids:['BTC-USD','ETH-USD'],channels:['ticker','heartbeat']});}finally{m.dispose();globalThis.WebSocket=originalWS;}});
test('ticker protocol parses numeric fields, trades, timestamps and 24h statistics',()=>{globalThis.WebSocket=SocketFixture;const m=new MarketData();try{let quote,trade;m.addEventListener('quote',e=>quote=e.detail);m.addEventListener('trade',e=>trade=e.detail);m.connect(['BTC-USD']);const s=SocketFixture.instances.at(-1);s.open();s.receive(ticker());assert.equal(quote.price,100);assert.equal(quote.bid,99);assert.equal(quote.ask,101);assert.equal(quote.volume,1000);assert.equal(trade.size,2);assert.equal(trade.time,1735689610);assert.equal(trade.id,1);}finally{m.dispose();globalThis.WebSocket=originalWS;}});
test('ticker snapshots cannot produce duplicate executions or regress trade time',()=>{globalThis.WebSocket=SocketFixture;const m=new MarketData();try{let count=0;m.addEventListener('trade',()=>count++);m.connect(['BTC-USD']);const s=SocketFixture.instances.at(-1);s.open();s.receive(ticker());s.receive(ticker());s.receive(ticker({time:'2025-01-01T00:00:05Z',trade_id:0,price:'90'}));assert.equal(count,1);assert.equal(m.quotes.get('BTC-USD').price,100);}finally{m.dispose();globalThis.WebSocket=originalWS;}});
test('malformed WebSocket JSON and invalid price events do not corrupt state',()=>{globalThis.WebSocket=SocketFixture;const m=new MarketData();try{m.connect(['BTC-USD']);const s=SocketFixture.instances.at(-1);s.open();s.onmessage({data:'{not json'});s.receive(ticker({price:'NaN'}));s.receive(ticker({time:'invalid'}));assert.equal(m.quotes.size,0);}finally{m.dispose();globalThis.WebSocket=originalWS;}});
test('REST pagination requests provider-supported granularities and resamples 4h',async()=>{const m=new MarketData(),seen=[];m.json=async path=>{seen.push(path);const offset=seen.length===1?10800:0;return Array.from({length:3},(_,i)=>[offset+i*3600,9,12,10,11,2]);};try{const r=await m.history('BTC-USD',14400,{pages:2});assert.ok(seen.every(p=>p.includes('granularity=3600')));assert.ok(seen[1].includes('start=')&&seen[1].includes('end='));assert.equal(r.bars[0].t,0);assert.equal(r.bars[0].v,8);assert.equal(r.bars.length,2);}finally{m.dispose();}});
test('weekly aggregation and live trades use Monday 00:00 UTC',()=>{const monday=Date.parse('2025-01-06T00:00:00Z')/1000;assert.equal(bucketTime(monday+3600,604800),monday);assert.equal(bucketTime(monday-1,604800),monday-604800);const s=new CandleSeries([],604800);s.tick({time:monday+3600,price:10,size:1,id:1});assert.equal(s.bars[0].t,monday);});
test('historical reconciliation preserves timestamp ordering metadata on untouched live bars',()=>{const b=demoCandles(2,60),s=new CandleSeries(b,60);const t=b[1].t;s.tick({time:t+20,price:70000,size:1,id:1});s.merge([{...b[0],v:999}]);s.tick({time:t+10,price:60000,size:1,id:2});assert.equal(s.bars.at(-1).c,70000);assert.equal(s.bars.at(-1).l,60000);});
test('workspace rejects incomplete two-point drawings and prototype layer names',()=>{const base={version:1,symbol:'BTC-USD',interval:3600};assert.throws(()=>validateWorkspace({...base,drawings:{'BTC-USD':[{id:'x',type:'measure',points:[{t:1,p:2}]}]}}));assert.throws(()=>validateWorkspace({...base,drawings:JSON.parse('{"__proto__":[]}')}));});
