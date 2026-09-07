/** Guard current source/build names without modifying historical commits. */
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
const retired=String.fromCharCode(116,114,97,100,105,110,103,118,105,101,119);
const paths=execFileSync('git',['ls-files','-z','--cached','--others','--exclude-standard'],{encoding:'utf8'}).split('\0').filter(Boolean);
const hits=[];
for(const path of new Set(paths)){
  let bytes;try{bytes=await readFile(path);}catch(error){if(error.code==='ENOENT')continue;throw error;}
  if(path.toLowerCase().includes(retired)||bytes.toString('utf8').toLowerCase().includes(retired))hits.push(path);
}
if(hits.length){console.error('Retired product reference found in: '+hits.join(', '));process.exitCode=1;}
else console.log(`Independent product reference guard passed across ${new Set(paths).size} current files.`);
