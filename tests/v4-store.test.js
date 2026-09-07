import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {SQLiteStore} from '../server/sqlite-store.mjs';
import {LeaseCoordinator} from '../server/lease.mjs';
async function stores(fn){const dir=await mkdtemp(join(tmpdir(),'aureon-sqlite-'));const a=await new SQLiteStore(dir).init(),b=await new SQLiteStore(dir).init();try{await fn(a,b,dir);}finally{await a.close();await b.close();await rm(dir,{recursive:true,force:true});}}
test('SQLite clients see committed revisions and never lose concurrent writes',()=>stores(async(a,b)=>{await a.transaction(s=>s.counter=0);await Promise.all(Array.from({length:40},(_,i)=>(i%2?a:b).transaction(async s=>{const n=s.counter;await new Promise(r=>setTimeout(r,1));s.counter=n+1;})));assert.equal(a.state.counter,40);assert.equal(b.state.counter,40);}));
test('SQLite mutation rollback does not poison the queue',()=>stores(async(a,b)=>{await assert.rejects(a.transaction(s=>{s.counter=99;throw new Error('test rollback');}),/rollback/);assert.equal(b.state.counter,undefined);await a.transaction(s=>s.counter=1);assert.equal(b.state.counter,1);}));
test('SQLite survives restart and imports legacy JSON only once',async()=>{const dir=await mkdtemp(join(tmpdir(),'aureon-migrate-'));let db;try{await writeFile(join(dir,'state.json'),JSON.stringify({version:1,users:[],sessions:[],workspaces:[],alerts:[],alertLog:[],ideas:[],counter:5}));db=await new SQLiteStore(dir).init();assert.equal(db.state.counter,5);await db.transaction(s=>s.counter=8);await db.close();db=await new SQLiteStore(dir).init();assert.equal(db.state.counter,8);}finally{await db?.close();await rm(dir,{recursive:true,force:true});}});
test('SQLite serializes actual independent Node processes',()=>stores(async(a,b,dir)=>{await a.transaction(s=>s.counter=0);const run=()=>new Promise((resolve,reject)=>{const code=`import {SQLiteStore} from ${JSON.stringify(new URL('../server/sqlite-store.mjs',import.meta.url).href)};const s=await new SQLiteStore(${JSON.stringify(dir)}).init();for(let i=0;i<25;i++)await s.transaction(x=>x.counter++);await s.close();`;const child=spawn(process.execPath,['--input-type=module','-e',code]);let error='';child.stderr.on('data',d=>error+=d);child.on('error',reject);child.on('close',n=>n?reject(new Error(error)):resolve());});await Promise.all([run(),run(),run()]);assert.equal(b.state.counter,75);}));
test('leases exclude a concurrent owner and fence expired owners after takeover',()=>stores(async(a,b)=>{let now=1000;const x=new LeaseCoordinator(a,{owner:'a',clock:()=>now}),y=new LeaseCoordinator(b,{owner:'b',clock:()=>now});const one=await x.acquire('task',100);assert.equal(await y.acquire('task',100),null);now=1101;const two=await y.acquire('task',100);assert.equal(two.token,one.token+1);assert.equal(x.owns(a.state,one),false);assert.equal(await x.renew(one),false);await x.release(one);assert.ok(y.owns(b.state,two));await y.release(two);assert.equal(y.owns(b.state,two),false);}));

test('durable quotas cannot be multiplied by changing server instances',()=>stores(async(a,b)=>{
  const {sharedThrottle}=await import('../server/rate-limit.mjs');
  for(let i=0;i<4;i++)await sharedThrottle(i%2?a:b,'login-client',{max:4,now:1000,window:100});
  await assert.rejects(sharedThrottle(a,'login-client',{max:4,now:1099,window:100}),e=>e.status===429);
  await sharedThrottle(b,'login-client',{max:4,now:1100,window:100});
}));
test('SQLite logical backup includes current state, not an obsolete migrated JSON file',()=>stores(async(a,b,dir)=>{
  const {backup,restore}=await import('../scripts/backup.mjs');const {PrivateVault}=await import('../server/security-pro.mjs');
  await PrivateVault.open(dir);await a.transaction(s=>s.marker='sqlite-current');const file=join(dir,'encrypted.backup'),dest=join(dir,'restore');
  const output=await backup(dir,file,'test backup passphrase 1234');assert.equal(output.sourceStorage,'sqlite');await restore(file,dest,'test backup passphrase 1234');
  const restored=await new SQLiteStore(dest).init();try{assert.equal(restored.state.marker,'sqlite-current');}finally{await restored.close();}
}));
test('concurrent vault initialization never observes a partially written key',()=>stores(async(a,b,dir)=>{
  const {PrivateVault}=await import('../server/security-pro.mjs');const vaults=await Promise.all(Array.from({length:12},()=>PrivateVault.open(dir)));
  const encrypted=vaults[0].seal({fixture:1},'test');for(const vault of vaults)assert.deepEqual(vault.open(encrypted,'test'),{fixture:1});
}));
