import {readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
for(const dir of['src','server','scripts'])for(const name of await readdir(new URL('../'+dir+'/',import.meta.url)))if(/\.m?js$/.test(name)){const r=spawnSync(process.execPath,['--check',dir+'/'+name],{stdio:'inherit'});if(r.status)process.exit(r.status);}console.log('All JavaScript modules passed syntax validation.');
