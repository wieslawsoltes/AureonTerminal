/** Offline encrypted backup/restore. Stop the server before either operation.
 * AES-256-GCM + scrypt, authenticated format header, exclusive output creation.
 * Backups include the MFA/VAPID vault key; protect passphrase independently.
 */
import {readFile,writeFile,mkdir,stat,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,scryptSync,createCipheriv,createDecipheriv} from 'node:crypto';
const MAGIC=Buffer.from('AUREONBK3\0'),MAX=210_000_000;
function password(value){if(typeof value!=='string'||value.length<16||value.length>1000)throw new Error('Backup passphrase must contain 16–1000 characters');return value;}
export function encryptBackup(payload,passphrase){password(passphrase);const bytes=Buffer.from(JSON.stringify(payload));if(bytes.length>MAX)throw new Error('Backup capacity exceeded');const salt=randomBytes(16),nonce=randomBytes(12),key=scryptSync(passphrase,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024}),cipher=createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(MAGIC);return Buffer.concat([MAGIC,salt,nonce,cipher.update(bytes),cipher.final(),cipher.getAuthTag()]);}
export function decryptBackup(buffer,passphrase){password(passphrase);if(!Buffer.isBuffer(buffer)||buffer.length<60||buffer.length>MAX+100||!buffer.subarray(0,MAGIC.length).equals(MAGIC))throw new Error('Invalid backup envelope');const n=MAGIC.length,salt=buffer.subarray(n,n+16),nonce=buffer.subarray(n+16,n+28),key=scryptSync(passphrase,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024}),d=createDecipheriv('aes-256-gcm',key,nonce);d.setAAD(MAGIC);d.setAuthTag(buffer.subarray(-16));const payload=JSON.parse(Buffer.concat([d.update(buffer.subarray(n+28,-16)),d.final()]));if(payload.version!==3||typeof payload.state!=='string'||typeof payload.vaultKey!=='string')throw new Error('Invalid backup payload');const state=JSON.parse(payload.state),vault=Buffer.from(payload.vaultKey,'base64');if(state.version!==1||!Array.isArray(state.users)||vault.length!==32)throw new Error('Invalid state or vault key');return payload;}
export async function backup(directory,file,passphrase){
  const path=resolve(directory);let state,sourceStorage='json';
  let sqlite=false;try{await stat(join(path,'state.sqlite'));sqlite=true;}catch(e){if(e.code!=='ENOENT')throw e;}
  if(sqlite){
    const {DatabaseSync}=await import('node:sqlite'),db=new DatabaseSync(join(path,'state.sqlite'),{readOnly:true,timeout:5000});
    try{state=db.prepare('SELECT payload FROM aureon_state WHERE id=1').get()?.payload;sourceStorage='sqlite';}finally{db.close();}
    if(typeof state!=='string')throw new Error('Invalid SQLite backup source');
  }else{const info=await stat(join(path,'state.json'));if(info.size>200_000_000)throw new Error('State exceeds supported capacity');state=await readFile(join(path,'state.json'),'utf8');}
  if(Buffer.byteLength(state)>200_000_000)throw new Error('State exceeds supported capacity');
  const key=await readFile(join(path,'vault.key'));if(key.length!==32)throw new Error('Invalid vault key');
  const payload={version:3,created:new Date().toISOString(),state,sourceStorage,vaultKey:key.toString('base64')},encrypted=encryptBackup(payload,passphrase);
  await writeFile(file,encrypted,{flag:'wx',mode:0o600});return{bytes:encrypted.length,created:payload.created,sourceStorage};
}
export async function restore(file,directory,passphrase){const info=await stat(file);if(info.size>MAX+100)throw new Error('Backup capacity exceeded');const p=decryptBackup(await readFile(file),passphrase),path=resolve(directory);await mkdir(path,{recursive:false,mode:0o700});try{await writeFile(join(path,'state.json'),p.state,{flag:'wx',mode:0o600});await writeFile(join(path,'vault.key'),Buffer.from(p.vaultKey,'base64'),{flag:'wx',mode:0o600});}catch(e){await rm(path,{recursive:true,force:true});throw e;}return{directory:path,created:p.created};}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const[operation,from,to]=process.argv.slice(2);if(!['backup','restore'].includes(operation)||!from||!to||process.env.AUREON_OFFLINE_CONFIRM!=='SERVER_IS_STOPPED')throw new Error('Stop the server; set AUREON_OFFLINE_CONFIRM=SERVER_IS_STOPPED and AUREON_BACKUP_PASSPHRASE; then: node scripts/backup.mjs backup DATA_DIR FILE | restore FILE NEW_DIRECTORY');console.log(await(operation==='backup'?backup:restore)(from,to,process.env.AUREON_BACKUP_PASSPHRASE));}
