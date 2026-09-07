/** Native Node service with explicit storage-driver selection: per-user data, CSRF-protected writes,
 * scrypt credentials, hashed opaque sessions, optimistic workspace revisions,
 * SSE notifications and optional fixed-host paper brokerage. No third-party deps.
 */
import http from 'node:http';
import {EventHub,appendEvent} from './events.mjs';
import {sharedThrottle} from './rate-limit.mjs';
import {ProServices} from './services-pro.mjs';
import {enqueueDelivery} from './delivery-pro.mjs';
import {audit} from './security-pro.mjs';
import {readFile,stat,realpath} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {randomBytes,randomUUID,createHash,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {Store} from './store.mjs';
import {Providers,validatePaperOrder} from './providers.mjs';
import {AlertMonitor} from './monitor.mjs';
import {validateWorkspace,normalizeCandles} from '../src/core.js';
import {validateExtensions} from '../src/workspace-v2.js';
import {validateAlert} from '../src/alerts-v2.js';
const scrypt=promisify(scryptCallback),sha=s=>createHash('sha256').update(s).digest('hex'),token=()=>randomBytes(32).toString('base64url');
const problem=(status,message)=>Object.assign(new Error(message),{status});
const json=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
const string=(value,name,max,min=1)=>{if(typeof value!=='string'||value.trim().length<min||value.length>max)throw problem(400,'Invalid '+name);return value.trim();};
const UUID=/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const SESSION_MS=8*3600_000;
async function passwordHash(password,salt=token()){const derived=await scrypt(password,salt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024});return{salt,hash:Buffer.from(derived).toString('hex')};}
async function verifyPassword(password,user){const candidate=await passwordHash(password,user?.salt||'aureon-timing-equalization');return !!user&&timingSafeEqual(Buffer.from(candidate.hash,'hex'),Buffer.from(user.hash,'hex'));}
async function body(req,max=15_000_000){if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw problem(415,'JSON content type required.');if(Number(req.headers['content-length']||0)>max)throw problem(413,'Request body too large.');const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>max)throw problem(413,'Request body too large.');chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw problem(400,'Malformed JSON.');}}
export function validatePayload(raw){if(!raw||raw.application!=='Aureon Terminal')throw problem(400,'Unsupported workspace payload.');const workspace=validateWorkspace(raw.workspace),extensions=validateExtensions(raw.extensions);extensions.layouts=[];const out={application:'Aureon Terminal',version:2,workspace,extensions};if(raw.dataset){const bars=normalizeCandles(raw.dataset.bars);if(bars.length>100000||raw.dataset.interval!==workspace.interval||raw.dataset.symbol!==workspace.symbol)throw problem(400,'Invalid dataset metadata or capacity.');out.dataset={symbol:workspace.symbol,interval:workspace.interval,source:String(raw.dataset.source||'User upload').slice(0,300),bars};}return out;}
export async function createAureonServer({root=resolve('.'),dataDir=resolve(root,'.aureon-data'),origin='',fetcher=fetch,key='',secret='',feed='iex',brokerUser='',monitor=true,monitorInterval=15000,registration=true,storage='json',pro={}}={}){
  root=await realpath(root);if(!['json','sqlite'].includes(storage))throw new Error('Unsupported storage driver');
  const StoreType=storage==='sqlite'?(await import('./sqlite-store.mjs')).SQLiteStore:Store;
  const store=await new StoreType(dataDir).init(),providers=new Providers({fetcher,key,secret,feed}),rate=new Map();let server;
  const eventHub=new EventHub(store),clients=eventHub.clients;
  const emit=(userId,event)=>eventHub.publish(userId,event),notify=()=>eventHub.pump();
  const proServices=await new ProServices(store,providers,notify,{...pro,fetcher,monitorInterval}).init();
  const alertMonitor=new AlertMonitor(store,providers,notify,{interval:monitorInterval});
  const throttle=async(id,max=120,window=60000)=>{if(storage==='sqlite')return sharedThrottle(store,id,{max,window});const now=Date.now();let r=rate.get(id);if(!r||r.until<now){r={count:0,until:now+window};rate.set(id,r);}if(++r.count>max)throw problem(429,'Too many requests; retry later.');if(rate.size>10000)for(const[k,v]of rate)if(v.until<now)rate.delete(k);};
  const getSession=req=>{const raw=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('aureon_session='))?.slice(15);if(!raw||!/^[\w-]{43}$/.test(raw))return null;const session=store.state.sessions.find(s=>s.tokenHash===sha(raw)&&s.expires>Date.now());if(!session)return null;const user=store.state.users.find(u=>u.id===session.userId);return user?{session,user}:null;};
  const authority=req=>{if(origin){const allowed=new URL(origin);if(req.headers.host!==allowed.host)throw problem(421,'Unexpected Host header.');return allowed.origin;}const port=server.address()?.port,host=req.headers.host;if(![`localhost:${port}`,`127.0.0.1:${port}`,`[::1]:${port}`].includes(host))throw problem(421,'Unexpected Host header.');return'http://'+host;};
  const cookie=(value,maxAge,secure)=>`aureon_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure?'; Secure':''}`;
  // Resolve the configured owner only from pre-existing accounts. A public registration
  // must never claim broker privileges during this process lifetime. Bootstrap locally,
  // then restart with credentials and the chosen owner name.
  const brokerOwnerId=store.state.users.find(u=>u.username===brokerUser)?.id;
  const brokerAllowed=user=>providers.configured&&!!brokerOwnerId&&user?.id===brokerOwnerId;
  async function handle(req,res){
    try{
      res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');res.setHeader('Cross-Origin-Resource-Policy','same-origin');
      res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline' blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://api.exchange.coinbase.com wss://ws-feed.exchange.coinbase.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
      const expected=authority(req),url=new URL(req.url,expected),method=req.method;
      if(req.headers.origin&&req.headers.origin!==expected)throw problem(403,'Origin not allowed.');
      if(!['GET','HEAD'].includes(method)&&req.headers.origin!==expected)throw problem(403,'Same-origin request required.');
      if(url.pathname.startsWith('/v2/')){
        await throttle(req.socket.remoteAddress+':api',600);
        const path=url.pathname.slice(4).replace(/\/$/,''),auth=getSession(req),user=auth?.user;
        if(method==='GET'&&path==='session'){json(res,200,{user:user?{id:user.id,username:user.username}:null,csrf:auth?.session.csrf||null,capabilities:{broker:brokerAllowed(user),monitor,registration,pro:proServices.capabilities(user)}});return;}
        if(['register','login'].includes(path)&&method==='POST'){
          await throttle(req.socket.remoteAddress+':auth',12);const b=await body(req,2000),username=string(b.username,'username',40,3).toLowerCase();if(!/^[a-z0-9_.-]{3,40}$/.test(username))throw problem(400,'Username must contain lowercase letters, digits, dot, dash or underscore.');if(typeof b.password!=='string'||b.password.length<12||b.password.length>200)throw problem(400,'Password must contain 12–200 characters.');const password=b.password;let account;
          if(path==='register'){
            if(!registration)throw problem(403,'Registration disabled by administrator.');const credential=await passwordHash(password);account=await store.transaction(s=>{if(s.users.some(u=>u.username===username))throw problem(409,'Username already exists.');if(s.users.length>=1000)throw problem(507,'Server account limit reached.');const u={id:randomUUID(),username,...credential,created:Date.now()};s.users.push(u);return u;});
          }else{account=store.state.users.find(u=>u.username===username);if(!await verifyPassword(password,account))throw problem(401,'Invalid username or password.');}
          const raw=token(),session={tokenHash:sha(raw),userId:account.id,csrf:token(),expires:Date.now()+SESSION_MS};await store.transaction(s=>{const current=s.users.find(u=>u.id===account.id);if(!current||current.hash!==account.hash)throw problem(409,'Account changed; retry login');if(path==='login')proServices.consumeMFA(s,current,String(b.code||''));audit(s,current.id,path);s.sessions=s.sessions.filter(x=>x.expires>Date.now());const own=s.sessions.filter(x=>x.userId===account.id);if(own.length>=10){const remove=new Set(own.slice(0,own.length-9).map(x=>x.tokenHash));s.sessions=s.sessions.filter(x=>!remove.has(x.tokenHash));}s.sessions.push(session);});res.setHeader('Set-Cookie',cookie(raw,SESSION_MS/1000,expected.startsWith('https:')));json(res,200,{ok:true,user:{id:account.id,username:account.username}});return;
        }
        if(!user)throw problem(401,'Sign in required.');
        if(!['GET','HEAD'].includes(method)){if(req.headers['x-csrf-token']!==auth.session.csrf)throw problem(403,'Invalid CSRF token.');await throttle(user.id+':writes',120);}
        if(path.startsWith('pro/security/'))await throttle(user.id+':security',20);if(path==='pro/scripts/run')await throttle(user.id+':scripts',20);if(path.startsWith('pro/research/'))await throttle(user.id+':research',30);if(path.startsWith('pro/live/'))await throttle(user.id+':live',20);
        const proResult=await proServices.handle({path,method,url,req,user,body,validatePayload,verifyPassword,passwordHash,session:auth.session,expected});if(proResult){json(res,proResult.status,proResult.data);return;}
        if(path==='logout'&&method==='POST'){await store.transaction(s=>{s.sessions=s.sessions.filter(x=>x.tokenHash!==auth.session.tokenHash);});for(const[r,c]of clients)if(c.sessionHash===auth.session.tokenHash){r.end();clients.delete(r);}res.setHeader('Set-Cookie',cookie('',0,expected.startsWith('https:')));json(res,200,{ok:true});return;}
        if(path==='events'&&method==='GET'){
          eventHub.attach(req,res,user.id,auth.session);return;
        }
        if(path==='workspaces'&&method==='GET'){json(res,200,{items:store.state.workspaces.filter(w=>w.userId===user.id).map(({id,name,revision,updated})=>({id,name,revision,updated}))});return;}
        const workspaceMatch=/^workspaces\/([^/]+)$/.exec(path);
        if(workspaceMatch){const id=workspaceMatch[1];if(!UUID.test(id))throw problem(400,'Invalid workspace ID');const existing=store.state.workspaces.find(w=>w.id===id&&w.userId===user.id);
          if(method==='GET'){if(!existing)throw problem(404,'Workspace not found.');json(res,200,existing);return;}
          if(method==='PUT'){
            const b=await body(req),name=string(b.name,'workspace name',100),payload=validatePayload(b.payload),revision=Number(req.headers['if-match']);if(!Number.isInteger(revision)||revision<0)throw problem(428,'If-Match revision is required.');const saved=await store.transaction(s=>{const w=s.workspaces.find(w=>w.id===id);if(w&&w.userId!==user.id)throw problem(404,'Workspace not found.');if((w?.revision||0)!==revision)throw problem(409,'Workspace changed. Reload before saving; your draft was not overwritten.');if(!w&&s.workspaces.filter(x=>x.userId===user.id).length>=50)throw problem(507,'Maximum 50 server workspaces per user.');const value={id,userId:user.id,name,payload,revision:revision+1,updated:Date.now()};if(w)Object.assign(w,value);else s.workspaces.push(value);appendEvent(s,user.id,{type:'workspace',id,revision:value.revision});return value;});notify();json(res,200,{id,revision:saved.revision,updated:saved.updated});return;
          }
          if(method==='DELETE'){if(!existing)throw problem(404,'Workspace not found.');await store.transaction(s=>{s.workspaces=s.workspaces.filter(w=>w.id!==id||w.userId!==user.id);appendEvent(s,user.id,{type:'workspace',id,deleted:true});});notify();json(res,200,{ok:true});return;}
        }
        if(path==='alerts'){
          if(method==='GET'){json(res,200,{items:store.state.alerts.filter(r=>r.userId===user.id),log:store.state.alertLog.filter(r=>r.userId===user.id).slice(-200),feedErrors:[...new Set(store.state.alerts.filter(r=>r.userId===user.id).map(r=>r.symbol+':'+r.interval))].map(k=>alertMonitor.errors.get(k)).filter(Boolean)});return;}
          if(method==='POST'){
            const raw=await body(req,10000);validateAlert(raw);if(!/^[A-Z0-9.-]+-USD$/.test(raw.symbol)||![60,300,900,3600,14400,21600,86400,604800].includes(raw.interval))throw problem(400,'Server monitor requires a supported Coinbase USD product and interval.');const allowed=new Set(['price','close','volume','rsi','ema','sma']);for(const c of raw.conditions)if(!allowed.has(c.source)||(typeof c.target==='string'&&!allowed.has(c.target)))throw problem(400,'Server supports price, close, volume, RSI14, EMA20 and SMA50 conditions. Use Pro monitors for isolated server-side scripts.');const r={id:randomUUID(),userId:user.id,symbol:raw.symbol,interval:raw.interval,conditions:raw.conditions,combine:raw.combine||'all',frequency:raw.frequency||'once',cooldown:raw.cooldown||0,expires:raw.expires??null,message:String(raw.message||''),active:true,mode:'market',created:Date.now(),updated:Date.now()};await store.transaction(s=>{if(s.alerts.filter(r=>r.userId===user.id).length>=50)throw problem(507,'Maximum 50 server alerts.');s.alerts.push(r);});json(res,201,r);return;
          }
        }
        const alertMatch=/^alerts\/([^/]+)$/.exec(path);
        if(alertMatch&&['DELETE','PATCH'].includes(method)){const id=alertMatch[1],b=method==='PATCH'?await body(req,1000):{};if(method==='PATCH'&&typeof b.active!=='boolean')throw problem(400,'active must be boolean.');await store.transaction(s=>{const r=s.alerts.find(r=>r.id===id&&r.userId===user.id);if(!r)throw problem(404,'Alert not found.');if(method==='DELETE')s.alerts=s.alerts.filter(x=>x!==r);else{r.active=b.active;r.updated=Date.now();delete r.lastFired;delete r.lastBar;}});alertMonitor.previous.delete(id);json(res,200,{ok:true});return;}
        if(path==='ideas'){
          if(method==='GET'){json(res,200,{items:store.state.ideas.filter(i=>!i.hidden).slice(-100).reverse().map(({workspace,...i})=>i)});return;}
          if(method==='POST'){const raw=await body(req,15_000_000),title=string(raw.title,'idea title',200),text=string(raw.text,'idea body',10000),symbol=string(raw.symbol,'symbol',40);const idea={id:randomUUID(),userId:user.id,username:user.username,title,text,symbol,workspace:raw.workspace?validatePayload(raw.workspace):null,created:Date.now(),likes:[],comments:[]};await store.transaction(s=>{if(s.ideas.length>=5000)throw problem(507,'Server idea quota exceeded.');s.ideas.push(idea);appendEvent(s,null,{type:'idea',id:idea.id});});notify();json(res,201,{id:idea.id});return;}
        }
        const ideaMatch=/^ideas\/([^/]+)(?:\/(like|comments))?$/.exec(path);
        if(ideaMatch){const[id,operation]=ideaMatch.slice(1);if(method==='GET'&&!operation){const idea=store.state.ideas.find(i=>i.id===id&&!i.hidden);if(!idea)throw problem(404,'Idea not found.');json(res,200,idea);return;}if(method==='DELETE'&&!operation){await store.transaction(s=>{const i=s.ideas.find(i=>i.id===id&&i.userId===user.id);if(!i)throw problem(404,'Idea not found.');s.ideas=s.ideas.filter(x=>x!==i);appendEvent(s,null,{type:'idea',id,deleted:true});});notify();json(res,200,{ok:true});return;}if(method==='POST'&&operation){const raw=await body(req,3000);await store.transaction(s=>{const idea=s.ideas.find(i=>i.id===id&&!i.hidden);if(!idea)throw problem(404,'Idea not found.');if(operation==='like'){const pos=idea.likes.indexOf(user.id);pos<0?idea.likes.push(user.id):idea.likes.splice(pos,1);}else{if(idea.comments.length>=500)throw problem(507,'Comment limit reached.');idea.comments.push({id:randomUUID(),userId:user.id,username:user.username,text:string(raw.text,'comment',2000),created:Date.now()});}appendEvent(s,null,{type:'idea',id});});notify();json(res,200,{ok:true});return;}}
        if(path.startsWith('broker/')||path==='market/bars'){
          if(!brokerAllowed(user))throw problem(403,'Paper brokerage/data access is not enabled for this user.');await throttle(user.id+':provider',60);
          if(path==='broker/account'&&method==='GET'){json(res,200,await providers.alpaca('/v2/account'));return;}
          if(path==='broker/orders'&&method==='GET'){json(res,200,await providers.alpaca('/v2/orders?status=all&limit=100&direction=desc'));return;}
          if(path==='broker/orders'&&method==='POST'){const order=validatePaperOrder(await body(req,4000));json(res,201,await providers.alpaca('/v2/orders',{method:'POST',body:order}));return;}
          const cancel=/^broker\/orders\/([^/]+)$/.exec(path);if(cancel&&method==='DELETE'){json(res,200,await providers.cancelPaper(cancel[1]));return;}
          if(path==='market/bars'&&method==='GET'){json(res,200,await providers.history(Object.fromEntries(url.searchParams)));return;}
        }
        throw problem(404,'API route not found.');
      }
      if(!['GET','HEAD'].includes(method))throw problem(405,'Method not allowed.');
      if(url.pathname.startsWith('/api/')){await throttle(req.socket.remoteAddress+':market',120);const data=await providers.coinbase(url.pathname.slice(4)+url.search);json(res,200,data);return;}
      const pathname=decodeURIComponent(url.pathname)==='/'?'/index.html':decodeURIComponent(url.pathname);
      // Explicit static allowlist: private state, .env, server implementation and
      // arbitrary files are never exposed, regardless of chosen data directory.
      if(!/^\/(?:index\.html|styles\.css|icon\.svg|manifest\.webmanifest|sw\.js|src\/[a-z0-9-]+\.js|dist\/AureonTerminal\.html|(?:README|ARCHITECTURE|TESTING|SCRIPTING|SECURITY|FEATURE_MATRIX|DATA_PROVIDERS)\.md)$/.test(pathname))throw problem(404,'Not found.');
      const file=await realpath(resolve(root,'.'+pathname));if(!file.startsWith(root+sep)||!(await stat(file)).isFile())throw problem(404,'Not found.');const data=await readFile(file),mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json','.md':'text/plain; charset=utf-8'};res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(method==='HEAD'?undefined:data);
    }catch(e){if(res.headersSent){res.end();return;}const status=e.status|| (e.code==='ENOENT'?404:e instanceof TypeError||/Invalid|Unsupported|requires|must|Unknown|limit|Maximum/i.test(e.message)?400:500);json(res,status,{error:status>=500?'Server or provider request failed. '+(e.status?e.message:'See server configuration and private storage permissions.'):e.message});}
  }
  server=http.createServer(handle);server.requestTimeout=30000;server.headersTimeout=10000;server.keepAliveTimeout=5000;server.maxHeadersCount=100;
  if(monitor){alertMonitor.start();proServices.start();}
  return{server,store,providers,alertMonitor,proServices,eventHub,emit,async close(){eventHub.close();await alertMonitor.stop();await proServices.close();for(const res of clients.keys())res.end();clients.clear();server.closeIdleConnections?.();if(server.listening)await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));await store.flush();await store.close?.();}};
}
