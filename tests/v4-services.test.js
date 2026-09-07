import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createAureonServer} from '../server/app.mjs';
import {defaultExtensions} from '../src/workspace-v2.js';
import {DrawingDocument,DrawingReplica} from '../src/drawing-crdt.js';
import {AlertMonitor} from '../server/monitor.mjs';
import {RulesEngine} from '../src/alerts-v2.js';
const payload=()=>({application:'Aureon Terminal',version:2,workspace:{version:1,symbol:'BTC-USD',interval:3600,drawings:{},indicators:['ema'],watchlist:['BTC-USD'],style:'candles'},extensions:defaultExtensions()});
test('Two SQLite-backed servers share sessions and safely merge member drawing operations',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'aureon-v4-http-'));const apps=[];
  try{
    for(let i=0;i<2;i++){const app=await createAureonServer({root:resolve('.'),dataDir:directory,storage:'sqlite',monitor:false});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));apps.push(app);}
    const bases=apps.map(a=>'http://127.0.0.1:'+a.server.address().port);
    function client(){return {cookie:'',csrf:'',id:'',async call(path,{method='GET',body,server=0}={}){const base=bases[server],r=await fetch(base+'/v2/'+path,{method,headers:{Origin:base,Cookie:this.cookie,'X-CSRF-Token':this.csrf,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});if(r.headers.get('set-cookie'))this.cookie=r.headers.get('set-cookie').split(';')[0];return {status:r.status,data:await r.json()};},async register(name){const r=await this.call('register',{method:'POST',body:{username:name,password:'v4-test-long-password'}});assert.equal(r.status,200,JSON.stringify(r.data));const s=await this.call('session');this.csrf=s.data.csrf;this.id=s.data.user.id;}};}
    const a=client(),b=client(),outsider=client();await a.register('alice');await b.register('bob');await outsider.register('mallory');
    await t.test('a session from server one authenticates on server two',async()=>{const s=await a.call('session',{server:1});assert.equal(s.data.user.id,a.id);});
    const create=await a.call('pro/rooms',{method:'POST',body:{name:'CRDT room',members:[b.id],payload:payload()}});assert.equal(create.status,201,JSON.stringify(create.data));const url='pro/rooms/'+create.data.id+'/drawings?symbol=BTC-USD';
    const alice=new DrawingReplica(a.id+'.device'),bob=new DrawingReplica(b.id+'.device');
    const seed=alice.applySnapshot([],[{id:'line',type:'hline',points:[{t:100,p:101}],color:'#ff0000',width:1}]);
    await t.test('outsiders cannot read or write shared drawings',async()=>{assert.equal((await outsider.call(url)).status,404);assert.equal((await outsider.call(url,{method:'POST',body:{operations:[]}})).status,404);});
    await t.test('accounts cannot forge another account actor or undo it',async()=>{assert.equal((await b.call(url,{method:'POST',body:{operations:seed}})).status,403);const own=await a.call(url,{method:'POST',body:{operations:seed}});assert.equal(own.status,200,JSON.stringify(own.data));bob.merge(own.data.document.operations);});
    await t.test('concurrent disjoint edits survive requests to different servers',async()=>{
      const x=alice.applySnapshot(alice.drawings,[{...alice.drawings[0],color:'#00ff00'}]),y=bob.applySnapshot(bob.drawings,[{...bob.drawings[0],width:3}]);
      const responses=await Promise.all([a.call(url,{method:'POST',body:{operations:x},server:0}),b.call(url,{method:'POST',body:{operations:y},server:1})]);responses.forEach(r=>assert.equal(r.status,200,JSON.stringify(r.data)));
      const final=(await b.call(url)).data.document;alice.merge(final.operations);bob.merge(final.operations);assert.equal(alice.drawings[0].color,'#00ff00');assert.equal(alice.drawings[0].width,3);assert.deepEqual(alice.drawings,bob.drawings);
      const undo=alice.undo();assert.equal((await a.call(url,{method:'POST',body:{operations:undo}})).status,200);const d=new DrawingDocument((await b.call(url,{server:1})).data.document).materialize()[0];assert.equal(d.color,'#ff0000');assert.equal(d.width,3);
    });
    await t.test('duplicate operation retry is idempotent; equivocation is rejected',async()=>{const repeat=await a.call(url,{method:'POST',body:{operations:seed}});assert.equal(repeat.status,200);assert.equal(repeat.data.added,0);const forged={...seed[0],fields:{$alive:false}};assert.equal((await a.call(url,{method:'POST',body:{operations:[forged]}})).status,400);});
    await t.test('revoked membership prevents subsequent queued writes',async()=>{await apps[0].store.transaction(s=>{s.pro.rooms.find(r=>r.id===create.data.id).members=[a.id];});assert.equal((await b.call(url,{method:'POST',body:{operations:[]},server:1})).status,404);});
    await t.test('price crossing baseline survives monitor handoff between server processes',async()=>{
      const rule=new RulesEngine().add({symbol:'BTC-USD',interval:60,conditions:[{source:'price',op:'crossAbove',target:100}],frequency:'once'});Object.assign(rule,{userId:a.id,updated:1});
      await apps[0].store.transaction(s=>s.alerts.push(rule));
      let price=99,time=60;const providers={alertValues:async()=>({time,barTime:time-60,values:{price,close:price}})},events=[];
      const m1=new AlertMonitor(apps[0].store,providers,(_u,e)=>events.push(e)),m2=new AlertMonitor(apps[1].store,providers,(_u,e)=>events.push(e));
      await m1.poll();price=101;time=120;await m2.poll();assert.equal(events.length,1);await m1.poll();assert.equal(events.length,1);assert.equal(apps[0].store.state.alertLog.length,1);
    });
  }finally{for(const app of apps)await app.close();await rm(directory,{recursive:true,force:true});}
});
