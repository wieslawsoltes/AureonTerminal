/** RFC 6238 TOTP, authenticated private-state encryption and tamper-evident audit.
 * MFA secrets never leave the enrollment endpoint and are encrypted at rest.
 * The audit chain detects edits/reordering, not deletion of an unanchored tail.
 */
import {createHmac,createHash,randomBytes,timingSafeEqual,createCipheriv,createDecipheriv} from 'node:crypto';
import {readFile,writeFile,chmod} from 'node:fs/promises';
import {join} from 'node:path';
export const digest=value=>createHash('sha256').update(String(value)).digest('hex');
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(bytes){let bits=0,value=0,out='';for(const b of bytes){value=(value<<8)|b;bits+=8;while(bits>=5){out+=alphabet[(value>>>(bits-5))&31];bits-=5;}}if(bits)out+=alphabet[(value<<(5-bits))&31];return out;}
export function base32Decode(text){if(typeof text!=='string'||text.length>256||!/^[A-Z2-7]+=*$/.test(text))throw new Error('Invalid base32 secret');let value=0,bits=0,out=[];for(const c of text.replace(/=+$/,'')){value=(value<<5)|alphabet.indexOf(c);bits+=5;if(bits>=8){out.push((value>>>(bits-8))&255);bits-=8;}}return Buffer.from(out);}
export function totp(secret,{time=Date.now(),step=30,digits=6,algorithm='sha1'}={}){if(!Number.isFinite(time)||time<0||!Number.isInteger(step)||step<1||![6,8].includes(digits)||!['sha1','sha256','sha512'].includes(algorithm))throw new Error('Invalid TOTP parameters');const counter=BigInt(Math.floor(time/1000/step)),buffer=Buffer.alloc(8);buffer.writeBigUInt64BE(counter);const mac=createHmac(algorithm,Buffer.isBuffer(secret)?secret:base32Decode(secret)).update(buffer).digest(),offset=mac.at(-1)&15;return String((mac.readUInt32BE(offset)&0x7fffffff)%10**digits).padStart(digits,'0');}
export function verifyTOTP(secret,code,{time=Date.now(),lastStep=-1,window=1}={}){if(typeof code!=='string'||!/^\d{6}$/.test(code)||![0,1,2].includes(window))return null;const step=Math.floor(time/30000);let found=null;for(let offset=-window;offset<=window;offset++){const current=step+offset;if(current<0||current<=lastStep)continue;const expected=totp(secret,{time:current*30000});if(timingSafeEqual(Buffer.from(expected),Buffer.from(code)))found=current;}return found;}
export class PrivateVault {
  constructor(key){if(!Buffer.isBuffer(key)||key.length!==32)throw new Error('Vault requires a 256-bit key');this.key=key;}
  static async open(directory){const file=join(directory,'vault.key');let key;try{key=await readFile(file);}catch(e){if(e.code!=='ENOENT')throw e;key=randomBytes(32);try{await writeFile(file,key,{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;key=await readFile(file);}}await chmod(file,0o600);return new PrivateVault(key);}
  seal(value,purpose){const nonce=randomBytes(12),c=createCipheriv('aes-256-gcm',this.key,nonce);c.setAAD(Buffer.from(purpose));const bytes=Buffer.concat([c.update(JSON.stringify(value),'utf8'),c.final()]);return{nonce:nonce.toString('base64'),tag:c.getAuthTag().toString('base64'),data:bytes.toString('base64')};}
  open(value,purpose){const d=createDecipheriv('aes-256-gcm',this.key,Buffer.from(value.nonce,'base64'));d.setAAD(Buffer.from(purpose));d.setAuthTag(Buffer.from(value.tag,'base64'));return JSON.parse(Buffer.concat([d.update(Buffer.from(value.data,'base64')),d.final()]).toString('utf8'));}
}
export function audit(state,userId,action,subject='',now=Date.now()){const p=state.pro;const previous=p.audit.at(-1)?.hash||p.auditAnchor||'0'.repeat(64),entry={sequence:(p.audit.at(-1)?.sequence||p.auditSequence||0)+1,time:now,userId,action,subject,previous};entry.hash=digest(JSON.stringify(entry));p.audit.push(entry);if(p.audit.length>10000){const old=p.audit.shift();p.auditAnchor=old.hash;p.auditSequence=old.sequence;}return entry;}
export function verifyAudit(entries,anchor='0'.repeat(64)){let previous=anchor;for(const entry of entries){const {hash,...data}=entry;if(data.previous!==previous||digest(JSON.stringify(data))!==hash)return false;previous=hash;}return true;}
export function recoveryCodes(){return Array.from({length:10},()=>randomBytes(12).toString('hex'));}
