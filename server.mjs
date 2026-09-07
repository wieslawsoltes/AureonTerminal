import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createAureonServer} from './server/app.mjs';
const root=fileURLToPath(new URL('.',import.meta.url));
const app=await createAureonServer({root,dataDir:process.env.AUREON_DATA_DIR||resolve(root,'.aureon-data'),origin:process.env.AUREON_ORIGIN||'',key:process.env.APCA_API_KEY_ID||'',secret:process.env.APCA_API_SECRET_KEY||'',feed:process.env.ALPACA_DATA_FEED||'iex',brokerUser:process.env.AUREON_BROKER_USER||'',monitor:process.env.AUREON_MONITOR!=='0',monitorInterval:Number(process.env.AUREON_POLL_MS||15000),registration:process.env.AUREON_REGISTRATION!=='0'});
const host=process.env.HOST||'127.0.0.1',port=Number(process.env.PORT||4173);
if(!['127.0.0.1','::1','localhost'].includes(host)&&!process.env.AUREON_ORIGIN)throw new Error('Network binding requires an explicit AUREON_ORIGIN (and HTTPS reverse proxy for remote access).');
app.server.listen(port,host,()=>console.log(`Aureon Terminal v2: ${process.env.AUREON_ORIGIN||'http://localhost:'+app.server.address().port}\nPrivate store: ${app.store.directory}\nExternal brokerage: PAPER ONLY; ${process.env.AUREON_BROKER_USER?'restricted to configured owner':'disabled'}`));
let stopping=false;for(const sig of['SIGINT','SIGTERM'])process.on(sig,async()=>{if(stopping)return;stopping=true;await app.close();process.exit(0);});
