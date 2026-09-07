/** Serialized, atomic, private JSON store. Suitable for a single Node process.
 * Transactions operate on a copy and commit only after validation + disk rename.
 * A multi-process deployment should replace this interface with a transactional DB.
 */
import {mkdir,readFile,writeFile,rename,chmod} from 'node:fs/promises';
import {resolve} from 'node:path';
export class Store {
  constructor(directory){this.directory=resolve(directory);this.path=resolve(this.directory,'state.json');this.tail=Promise.resolve();}
  async init(){await mkdir(this.directory,{recursive:true,mode:0o700});await chmod(this.directory,0o700);try{this.state=JSON.parse(await readFile(this.path,'utf8'));if(this.state.version!==1||!Array.isArray(this.state.users)||!Array.isArray(this.state.workspaces)||!Array.isArray(this.state.sessions)||!Array.isArray(this.state.alerts)||!Array.isArray(this.state.alertLog)||!Array.isArray(this.state.ideas))throw new Error('Invalid private store; restore a valid backup.');}catch(e){if(e.code!=='ENOENT')throw e;this.state={version:1,users:[],sessions:[],workspaces:[],alerts:[],alertLog:[],ideas:[]};await this.persist(this.state);}return this;}
  async persist(state){const text=JSON.stringify(state);if(Buffer.byteLength(text)>200_000_000)throw Object.assign(new Error('Server storage quota exceeded.'),{status:507});const temp=this.path+'.tmp';await writeFile(temp,text,{mode:0o600});await rename(temp,this.path);}
  transaction(fn){const task=this.tail.then(async()=>{const next=structuredClone(this.state),result=await fn(next);await this.persist(next);this.state=next;return result;});this.tail=task.catch(()=>{});return task;}
  async flush(){await this.tail;}
}
