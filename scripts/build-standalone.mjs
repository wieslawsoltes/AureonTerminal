/** Deterministic zero-dependency bundler for the local named-export ES modules.
 * No minification, remote libraries, eval or Function constructor. Native modules
 * remain canonical. Both workers contain the same source as the modular build.
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {posix} from 'node:path';
const root=new URL('../',import.meta.url),read=p=>readFile(new URL(p,root),'utf8');
// Keep native/standalone labels and offline cache release identity in sync.
const productVersion=JSON.parse(await read('package.json')).version;
if(!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(productVersion))throw new Error('Invalid product release version');
await writeFile(new URL('src/release.js',root),`// Generated from package.json by npm run build; not a workspace schema version.\nexport const PRODUCT_VERSION=${JSON.stringify(productVersion)};\n`);
const shell=await read('index.html'),serviceWorker=await read('sw.js');
if((shell.match(/<span class="version">[^<]*<\/span>/g)||[]).length!==1||!serviceWorker.includes("CACHE=PREFIX+"))throw new Error('Missing release identity marker');
await writeFile(new URL('index.html',root),shell.replace(/<span class="version">[^<]*<\/span>/,`<span class="version">v${productVersion}</span>`));
await writeFile(new URL('sw.js',root),serviceWorker.replace(/CACHE=PREFIX\+'[^']*'/,`CACHE=PREFIX+'v${productVersion}'`));
const importPattern=/^import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"];?\s*/gm;
async function graph(entry,seen=new Map()){
  if(seen.has(entry))return seen;const source=await read(entry);seen.set(entry,source);
  for(const m of source.matchAll(importPattern))await graph(posix.normalize(posix.join(posix.dirname(entry),m[2])),seen);
  return seen;
}
function factory(path,source,worker=false){
  const exported=[...source.matchAll(/\bexport\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g)].map(m=>m[1]);
  source=source.replace(importPattern,(_,bindings,p)=>`const {${bindings.replace(/\b(\w+)\s+as\s+(\w+)\b/g,'$1:$2')}}=require(${JSON.stringify(posix.normalize(posix.join(posix.dirname(path),p)))});\n`);
  source=source.replace(/\bexport\s+(?=(?:async\s+)?(?:function|class|const|let|var)\b)/g,'');
  source=source.replace(/new URL\('\.\/(indicator-worker|engine-worker)\.js',import\.meta\.url\)/g,(_,name)=>worker?'null':`workerURLs[${JSON.stringify(name)}]`);
  return `factories[${JSON.stringify(path)}]=(exports,require)=>{\n${source}\nObject.assign(exports,{${[...new Set(exported)].join(',')}});\n};\n`;
}
async function bundle(entry,{workers=false}={}){
  let code=`(()=>{\n'use strict';\nconst factories=Object.create(null),cache=Object.create(null);\nfunction require(id){if(cache[id])return cache[id];const exports=cache[id]={};if(!factories[id])throw new Error('Missing module '+id);factories[id](exports,require);return exports;}\n`;
  if(workers){const sources={};for(const name of['indicator-worker','engine-worker'])sources[name]=await bundle('src/'+name+'.js');code+=`const workerURLs={};\nfor(const[name,source]of Object.entries(${JSON.stringify(sources)}))workerURLs[name]=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));\n`;}
  for(const[path,source]of await graph(entry))code+=factory(path,source,!workers);
  return code+`require(${JSON.stringify(entry)});\n})();`;
}
const js=await bundle('src/app.js',{workers:true}),css=await read('styles.css'),svg=await read('icon.svg');let html=await read('index.html');
html=html.replace('<link rel="icon" href="./icon.svg" type="image/svg+xml">',`<link rel="icon" href="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" type="image/svg+xml">`)
 .replace('<link rel="stylesheet" href="./styles.css">',`<style>${css}</style>`)
 .replace('<script type="module" src="./src/app.js"></script>',`<script>${js.replace(/<\/script/gi,'<\\/script')}</script>`);
await mkdir(new URL('dist/',root),{recursive:true});await writeFile(new URL('dist/AureonTerminal.html',root),html);console.log(`Standalone build: ${Buffer.byteLength(html).toLocaleString()} bytes`);
