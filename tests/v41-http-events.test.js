import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {defaultExtensions} from '../src/workspace-v2.js';

const payload=()=>({application:'Aureon Terminal',version:2,workspace:{version:1,symbol:'BTC-USD',interval:3600,drawings:{},indicators:['ema'],watchlist:['BTC-USD'],style:'candles'},extensions:defaultExtensions()});
async function launch(directory){
 const program=`import {createAureonServer} from './server/app.mjs';const a=await createAureonServer({root:process.cwd(),dataDir:process.argv[1],storage:'sqlite',monitor:false});a.server.listen(0,'127.0.0.1',()=>console.log(a.server.address().port));process.on('SIGTERM',async()=>{await a.close();process.exit(0);});`;
 const child=spawn(process.execPath,['--input-type=module','-e',program,directory],{cwd:resolve('.'),stdio:['ignore','pipe','pipe']});let errors='';child.stderr.on('data',s=>errors+=s);
 const port=await new Promise((yes,no)=>{const timer=setTimeout(()=>{child.kill();no(new Error('Server launch timeout: '+errors));},10000);let text='';child.stdout.on('data',chunk=>{text+=chunk;if(text.includes('\n')){clearTimeout(timer);yes(Number(text.trim().split('\n')[0]));}});child.once('error',e=>{clearTimeout(timer);no(e);});child.once('exit',code=>{clearTimeout(timer);no(new Error('Server exited '+code+': '+errors));});});
 return{base:'http://127.0.0.1:'+port,child,async close(){if(child.exitCode!==null)return;const exited=new Promise(r=>child.once('exit',r));child.kill();const force=setTimeout(()=>child.kill('SIGKILL'),5000);await exited;clearTimeout(force);}};
}
function client(){return{cookie:'',csrf:'',async call(base,path,{method='GET',body,revision}={}){const response=await fetch(base+'/v2/'+path,{method,headers:{Origin:base,Cookie:this.cookie,'X-CSRF-Token':this.csrf,'Content-Type':'application/json',...(revision===undefined?{}:{'If-Match':String(revision)})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(5000)});const cookie=response.headers.get('set-cookie');if(cookie)this.cookie=cookie.split(';')[0];const data=await response.json();return{status:response.status,data};},async register(base,name){assert.equal((await this.call(base,'register',{method:'POST',body:{username:name,password:'integration-test-password'}})).status,200);this.csrf=(await this.call(base,'session')).data.csrf;}};}
async function stream(base,cookie,last){
 const controller=new AbortController(),response=await fetch(base+'/v2/events',{headers:{Cookie:cookie,...(last?{'Last-Event-ID':last}:{})},signal:controller.signal});assert.equal(response.status,200);
 const reader=response.body.getReader(),decoder=new TextDecoder();let text='',frames=[];
 return{close(){controller.abort();},async next(){const timer=setTimeout(()=>controller.abort(new Error('SSE event timeout')),5000);try{while(!frames.length){const r=await reader.read();if(r.done)return null;text+=decoder.decode(r.value,{stream:true});let p;while((p=text.indexOf('\n\n'))>=0){const frame=text.slice(0,p);text=text.slice(p+2);const data=frame.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trim()).join('\n');if(data)frames.push({id:frame.split('\n').find(l=>l.startsWith('id:'))?.slice(3).trim(),event:JSON.parse(data)});}}return frames.shift();}finally{clearTimeout(timer);}}};
}
test('Real separate SQLite processes replay authorized SSE and revoke streams across instances',{timeout:20000},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'aureon-event-process-')),apps=[],streams=[];
 try{
  apps.push(await launch(directory));apps.push(await launch(directory));const [a,b]=apps,alice=client(),bob=client();await alice.register(a.base,'aliceevents');await bob.register(a.base,'bobevents');
  const s=await stream(b.base,alice.cookie);streams.push(s);assert.equal((await s.next()).event.type,'connected');
  const first=randomUUID();assert.equal((await alice.call(a.base,'workspaces/'+first,{method:'PUT',revision:0,body:{name:'First',payload:payload()}})).status,200);
  const delivered=await s.next();assert.equal(delivered.event.id,first);assert.equal(delivered.event.type,'workspace');assert.ok(delivered.id);s.close();
  const hidden=randomUUID(),second=randomUUID();assert.equal((await bob.call(a.base,'workspaces/'+hidden,{method:'PUT',revision:0,body:{name:'Private',payload:payload()}})).status,200);assert.equal((await alice.call(a.base,'workspaces/'+second,{method:'PUT',revision:0,body:{name:'Second',payload:payload()}})).status,200);
  const resumed=await stream(b.base,alice.cookie,delivered.id);streams.push(resumed);assert.equal((await resumed.next()).event.type,'connected');const replayed=await resumed.next();assert.equal(replayed.event.id,second);assert.notEqual(replayed.event.id,hidden);
  assert.equal((await alice.call(a.base,'logout',{method:'POST',body:{}})).status,200);assert.equal(await resumed.next(),null);
 }finally{streams.forEach(s=>s.close());for(const app of apps)await app.close();await rm(directory,{recursive:true,force:true});}
});
