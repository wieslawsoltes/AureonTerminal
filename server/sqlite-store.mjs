/** Same-host multi-process storage. WAL requires a local filesystem.
 * Uses the existing transaction contract, with an OS/database write lock held
 * across the callback. Callbacks are never replayed after a conflict.
 * Busy acquisition yields to the event loop rather than blocking other clients.
 */
import {DatabaseSync} from 'node:sqlite';
import {mkdir,chmod,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
const initial=()=>({version:1,users:[],sessions:[],workspaces:[],alerts:[],alertLog:[],ideas:[]});
function validate(s) {
  if(!s || s.version!==1 || ['users','sessions','workspaces','alerts','alertLog','ideas'].some(k=>!Array.isArray(s[k]))) throw new Error('Invalid private database payload');
  return s;
}
export class SQLiteStore {
  constructor(directory,{lockTimeout=10000}={}) {
    this.directory=resolve(directory);this.path=resolve(this.directory,'state.sqlite');
    this.tail=Promise.resolve();this.lockTimeout=lockTimeout;this.cachedRevision=-1;this.closed=false;
  }
  async acquire() {
    const deadline=Date.now()+this.lockTimeout;
    for(;;) {
      try{this.db.exec('BEGIN IMMEDIATE');return;}
      catch(e){if(!/locked|busy/i.test(e.message)||Date.now()>=deadline)throw e;await delay(5+Math.random()*20);}
    }
  }
  async init() {
    await mkdir(this.directory,{recursive:true,mode:0o700});await chmod(this.directory,0o700);
    this.db=new DatabaseSync(this.path,{timeout:0});await chmod(this.path,0o600);
    // Bootstrap PRAGMAs/DDL may encounter another process starting simultaneously.
    const deadline=Date.now()+this.lockTimeout;
    for(;;){try{this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS aureon_state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, payload TEXT NOT NULL);');break;}catch(e){if(!/locked|busy/i.test(e.message)||Date.now()>=deadline){this.db.close();throw e;}await delay(10);}}
    this.select=this.db.prepare('SELECT revision,payload FROM aureon_state WHERE id=1');
    this.revisionQuery=this.db.prepare('SELECT revision FROM aureon_state WHERE id=1');
    this.write=this.db.prepare('UPDATE aureon_state SET revision=revision+1,payload=? WHERE id=1');
    await this.acquire();
    try {
      if(!this.select.get()) {
        let state=initial();try{state=validate(JSON.parse(await readFile(resolve(this.directory,'state.json'),'utf8')));}catch(e){if(e.code!=='ENOENT')throw e;}
        this.db.prepare('INSERT INTO aureon_state VALUES(1,0,?)').run(JSON.stringify(state));
      }
      this.db.exec('COMMIT');this.refresh();return this;
    }catch(e){this.db.exec('ROLLBACK');this.db.close();throw e;}
  }
  refresh() {
    if(this.closed)throw new Error('Store is closed');
    const revision=this.revisionQuery.get()?.revision;
    if(revision!==this.cachedRevision){const row=this.select.get();this.cached=validate(JSON.parse(row.payload));this.cachedRevision=row.revision;}
    return this.cached;
  }
  get state(){return this.refresh();}
  transaction(fn) {
    const task=this.tail.then(async()=>{
      if(this.closed)throw new Error('Store is closed');await this.acquire();
      try {
        const row=this.select.get(),next=validate(JSON.parse(row.payload));
        const result=await fn(next),payload=JSON.stringify(validate(next));
        if(Buffer.byteLength(payload)>200_000_000)throw Object.assign(new Error('Server storage quota exceeded'),{status:507});
        this.write.run(payload);this.db.exec('COMMIT');this.cached=next;this.cachedRevision=row.revision+1;return result;
      }catch(e){this.db.exec('ROLLBACK');throw e;}
    });
    this.tail=task.catch(()=>{});return task;
  }
  async flush(){await this.tail;}
  async close(){await this.flush();if(!this.closed){this.closed=true;this.db.close();}}
}
