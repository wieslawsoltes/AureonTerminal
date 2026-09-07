/** Dependency-free local server. Optional fixed-host REST proxy; no credentials. */
import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('.',import.meta.url)),port=Number(process.env.PORT||4173);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.md':'text/plain; charset=utf-8'};
const cache=new Map();let nextAllowed=0;
const server=http.createServer(async(req,res)=>{
 try{
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end('Read-only server.');return;}
  const url=new URL(req.url,'http://localhost');
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  if(url.pathname.startsWith('/api/')){
    const p=url.pathname.slice(4);
    if(!/^\/products(?:\/[A-Z0-9.-]{1,32}(?:\/(candles|stats|ticker|book))?)?$/.test(p)){res.writeHead(400);res.end('Unsupported public market endpoint.');return;}
    for(const k of url.searchParams.keys())if(!['granularity','start','end','level'].includes(k)){res.writeHead(400);res.end('Unsupported query.');return;}
    const key=p+url.search,old=cache.get(key);if(old&&old.expires>Date.now()){res.writeHead(200,{'Content-Type':'application/json'});res.end(old.body);return;}
    if(Date.now()<nextAllowed){res.writeHead(429,{'Retry-After':'1'});res.end('Slow down.');return;}nextAllowed=Date.now()+120;
    const r=await fetch('https://api.exchange.coinbase.com'+key,{signal:AbortSignal.timeout(12000),headers:{'User-Agent':'AureonTerminal/1.0','Accept':'application/json'}});
    const body=await r.text();if(r.ok){cache.set(key,{body,expires:Date.now()+(p.endsWith('/candles')?15000:3000)});if(cache.size>300)cache.delete(cache.keys().next().value);}
    res.writeHead(r.status,{'Content-Type':'application/json'});res.end(body);return;
  }
  let pathname=decodeURIComponent(url.pathname);if(pathname==='/'||pathname.endsWith('/'))pathname+='index.html';
  const file=resolve(root,'.'+pathname);if(!file.startsWith(root.endsWith(sep)?root:root+sep)||pathname.split('/').some(x=>x.startsWith('.'))){res.writeHead(403);res.end('Forbidden');return;}
  if(!(await stat(file)).isFile())throw new Error('Not found');
  const body=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:body);
 }catch(e){res.writeHead(e.code==='ENOENT'?404:502,{'Content-Type':'text/plain'});res.end(e.code==='ENOENT'?'Not found':'Request failed. '+e.message);}
});
server.listen(port,'127.0.0.1',()=>console.log(`Aureon Terminal: http://localhost:${port}`));
