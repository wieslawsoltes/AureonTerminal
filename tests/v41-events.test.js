import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {appendEvent,readEvents,canDeliver,EventHub,EVENT_LIMIT,EVENT_TTL} from '../server/events.mjs';
import {SQLiteStore} from '../server/sqlite-store.mjs';
import {backup,decryptBackup} from '../scripts/backup.mjs';
const state=()=>({version:1,users:[{id:'alice'},{id:'bob'}],sessions:[{tokenHash:'token',userId:'alice',expires:100000}],workspaces:[],alerts:[],alertLog:[],ideas:[],pro:{rooms:[],messages:[],blocks:[]}});
test('Event cursors replay private and public events only to their authorized audience',()=>{
 const s=state();const first=appendEvent(s,'alice',{type:'test',value:0},100);appendEvent(s,'bob',{type:'test',value:1},101);appendEvent(s,'alice',{type:'test',value:2},102);appendEvent(s,null,{type:'idea',id:'shared'},103);
 const r=readEvents(s,'alice',first,104);assert.deepEqual(r.entries.map(x=>x.event),[{type:'test',value:2},{type:'idea',id:'shared'}]);assert.equal(r.reset,null);
});
test('New connections establish a tail cursor without replaying prior private data',()=>{
 const s=state(),id=appendEvent(s,'alice',{type:'test'},100);assert.deepEqual(readEvents(s,'alice',null,101),{cursor:id,entries:[],reset:null});
});
test('Expired, future and foreign cursors explicitly require resynchronization',()=>{
 const s=state(),id=appendEvent(s,'alice',{type:'test'},100);
 for(const cursor of ['bad',id.replace(/:1$/,':999'),id.replace(/^[^:]+/,'00000000-0000-0000-0000-000000000000')])assert.equal(readEvents(s,'alice',cursor,101).reset,'cursor-invalid');
 assert.equal(readEvents(s,'alice',id.replace(/:1$/,':0'),EVENT_TTL+200).reset,'cursor-expired');
});
test('Event retention is bounded and does not silently conceal cursor gaps',()=>{
 const s=state(),id=appendEvent(s,'alice',{type:'test'},100);for(let i=0;i<EVENT_LIMIT+1;i++)appendEvent(s,'alice',{type:'test'},101+i);
 assert.equal(s.eventJournal.entries.length,EVENT_LIMIT);assert.equal(readEvents(s,'alice',id,5000).reset,'cursor-expired');
});
test('Room membership and message blocking are checked at delivery, not just publication',()=>{
 const s=state();s.pro.rooms.push({id:'room',members:['alice']});const row={userId:'alice',event:{type:'drawings',id:'room'}};assert.equal(canDeliver(s,row,'alice'),true);s.pro.rooms[0].members=[];assert.equal(canDeliver(s,row,'alice'),false);
 s.pro.messages.push({id:'msg',from:'bob',to:'alice'});row.event={type:'message',id:'msg'};assert.equal(canDeliver(s,row,'alice'),true);s.pro.blocks.push({from:'alice',to:'bob'});assert.equal(canDeliver(s,row,'alice'),false);
});
test('Public broadcasts cannot carry arbitrary private event types',()=>{
 const s=state();assert.throws(()=>appendEvent(s,null,{type:'message'}),/recipient/);assert.throws(()=>appendEvent(s,'missing',{type:'test'}),/recipient/);assert.throws(()=>appendEvent(s,'alice',{type:'test',data:'x'.repeat(17000)}),/capacity/);
});
class Response extends EventEmitter{constructor(){super();this.output='';this.writableLength=0;}writeHead(){}write(s){this.output+=s;return true;}end(){this.ended=true;this.emit('close');}destroy(){this.destroyed=true;this.end();}}
test('Event streams close on session revocation even when no new event is published',()=>{
 const s=state(),hub=new EventHub({state:s},{clock:()=>1000,interval:60000}),res=new Response();try{hub.attach({headers:{}},res,'alice',s.sessions[0]);s.sessions=[];hub.pump();assert.equal(res.ended,true);assert.equal(hub.clients.size,0);}finally{hub.close();}
});
test('Slow event streams are disconnected before unbounded buffer accumulation',()=>{
 const s=state(),hub=new EventHub({state:s},{clock:()=>1000,interval:60000}),res=new Response();try{hub.attach({headers:{}},res,'alice',s.sessions[0]);res.writableLength=300000;hub.pump();assert.equal(res.destroyed,true);}finally{hub.close();}
});
test('Durable event publication shares the domain transaction and rolls back with it',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'aureon-events-')),a=await new SQLiteStore(dir).init(),b=await new SQLiteStore(dir).init();try{
 await a.transaction(s=>Object.assign(s,state()));await assert.rejects(a.transaction(s=>{s.counter=1;appendEvent(s,'alice',{type:'test'});throw new Error('rollback');}),/rollback/);assert.equal(b.state.eventJournal,undefined);assert.equal(b.state.counter,undefined);
 await a.transaction(s=>{s.counter=2;appendEvent(s,'alice',{type:'test'});});assert.equal(b.state.counter,2);assert.equal(b.state.eventJournal.entries.length,1);
 }finally{await a.close();await b.close();await rm(dir,{recursive:true,force:true});}
});
test('Backup refuses ambiguous stores and explicit JSON selection preserves newer JSON data',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'aureon-backup-select-')),db=await new SQLiteStore(dir).init(),pass='explicit backup passphrase 123';try{
 await db.transaction(s=>s.marker='sqlite');await writeFile(join(dir,'state.json'),JSON.stringify({...state(),marker:'newer-json'}));await writeFile(join(dir,'vault.key'),Buffer.alloc(32,8));
 await assert.rejects(backup(dir,join(dir,'ambiguous'),pass),/Ambiguous/);
 for(const storage of ['json','sqlite']){const file=join(dir,storage+'.backup');const result=await backup(dir,file,pass,{storage});assert.equal(result.sourceStorage,storage);assert.equal(JSON.parse(decryptBackup(await readFile(file),pass).state).marker,storage==='json'?'newer-json':'sqlite');}
 await assert.rejects(backup(dir,join(dir,'bad'),pass,{storage:'guess'}),/Unsupported/);
 }finally{await db.close();await rm(dir,{recursive:true,force:true});}
});

test('Restoring a pre-journal backup clears the SSE resume cursor rather than emitting literal null',()=>{
 const s=state(),hub=new EventHub({state:s},{clock:()=>1000,interval:60000}),res=new Response();try{
 hub.attach({headers:{'last-event-id':'11111111-1111-1111-1111-111111111111:1'}},res,'alice',s.sessions[0]);assert.match(res.output,/id: \ndata: .*resync/);assert.ok(!res.output.includes('id: null'));
 }finally{hub.close();}
});
