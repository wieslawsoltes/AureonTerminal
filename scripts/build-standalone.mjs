/** Small, deterministic, zero-dependency packer for these native ES modules.
 * The modular source remains the source of truth; this creates a convenient
 * single-file distribution without changing numerical or rendering semantics.
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {posix} from 'node:path';
const root=new URL('../',import.meta.url),read=p=>readFile(new URL(p,root),'utf8');
const names=['core','indicators','data','renderer','chart','compute','icons','app'];
const indicator=(await read('src/indicators.js')).replace(/^export\s+/gm,'');
const worker=(await read('src/indicator-worker.js')).replace(/^import .*?;\s*/m,'');
let js=`/* Aureon Terminal — generated from modular source. MIT license. */\n(()=>{\n'use strict';\nconst factories={},cache={};\nconst workerSource=${JSON.stringify(indicator+'\n'+worker)};\nconst workerUrl=URL.createObjectURL(new Blob([workerSource],{type:'text/javascript'}));\nfunction require(id){if(cache[id])return cache[id];const exports=cache[id]={};factories[id](exports,require);return exports;}\n`;
for(const name of names){const path=`src/${name}.js`;let source=await read(path);const exported=[...source.matchAll(/\bexport\s+(?:async\s+)?(?:function|class|const|let|var)\s+(\w+)/g)].map(m=>m[1]);
 source=source.replace(/^import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"];?\s*/gm,(_,bindings,p)=>`const {${bindings}}=require(${JSON.stringify(posix.normalize(posix.join('src',p)))});\n`);
 source=source.replace(/^export\s+/gm,'').replace("new URL('./indicator-worker.js',import.meta.url)",'workerUrl');
 js+=`factories[${JSON.stringify(path)}]=(exports,require)=>{\n${source}\nObject.assign(exports,{${exported.join(',')}});\n};\n`;
}
js+=`require('src/app.js');\n})();`;
const css=await read('styles.css'),svg=await read('icon.svg');let html=await read('index.html');
html=html.replace('<link rel="icon" href="./icon.svg" type="image/svg+xml">',`<link rel="icon" href="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" type="image/svg+xml">`)
 .replace('<link rel="stylesheet" href="./styles.css">',`<style>${css}</style>`)
 .replace('<script type="module" src="./src/app.js"></script>',`<script>${js.replace(/<\/script/gi,'<\\/script')}</script>`);
await mkdir(new URL('dist/',root),{recursive:true});await writeFile(new URL('dist/AureonTerminal.html',root),html);console.log(`Standalone build: ${Buffer.byteLength(html).toLocaleString()} bytes`);
