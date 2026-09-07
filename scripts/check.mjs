import {readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const files=['server.mjs','sw.js'];
for(const dir of ['src','server','scripts','tests'])for(const name of await readdir(new URL('../'+dir+'/',import.meta.url)))if(/\.m?js$/.test(name))files.push(dir+'/'+name);
for(const file of files){const r=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});if(r.status)process.exit(r.status);}
console.log(`All ${files.length} JavaScript modules passed syntax validation.`);
