import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createAureonServer} from './server/app.mjs';
const root=fileURLToPath(new URL('.',import.meta.url));
const objectEnv=name=>{const value=JSON.parse(process.env[name]||'{}');if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(name+' requires a JSON object');return value;};
const app=await createAureonServer({root,dataDir:process.env.AUREON_DATA_DIR||resolve(root,'.aureon-data'),origin:process.env.AUREON_ORIGIN||'',key:process.env.APCA_API_KEY_ID||'',secret:process.env.APCA_API_SECRET_KEY||'',feed:process.env.ALPACA_DATA_FEED||'iex',brokerUser:process.env.AUREON_BROKER_USER||'',monitor:process.env.AUREON_MONITOR!=='0',monitorInterval:Number(process.env.AUREON_POLL_MS||15000),registration:process.env.AUREON_REGISTRATION!=='0',pro:{
 researchUser:process.env.AUREON_RESEARCH_USER||'',moderators:(process.env.AUREON_MODERATORS||'').split(',').filter(Boolean),
 research:{key:process.env.APCA_API_KEY_ID||'',secret:process.env.APCA_API_SECRET_KEY||'',optionFeed:process.env.ALPACA_OPTION_FEED||'indicative',fredKey:process.env.FRED_API_KEY||'',secAgent:process.env.SEC_USER_AGENT||''},
 delivery:{recipients:objectEnv('AUREON_NOTIFICATION_RECIPIENTS'),webhooks:objectEnv('AUREON_WEBHOOKS'),resendKey:process.env.RESEND_API_KEY||'',emailFrom:process.env.AUREON_EMAIL_FROM||'',twilioSid:process.env.TWILIO_ACCOUNT_SID||'',twilioToken:process.env.TWILIO_AUTH_TOKEN||'',smsFrom:process.env.TWILIO_FROM||'',pushSubject:process.env.AUREON_PUSH_CONTACT||''},
 live:{enabled:process.env.AUREON_LIVE_ENABLED==='I_ACCEPT_REAL_MONEY_RISK',owner:process.env.AUREON_LIVE_USER||'',key:process.env.ALPACA_LIVE_KEY||'',secret:process.env.ALPACA_LIVE_SECRET||'',maxNotional:Number(process.env.AUREON_LIVE_MAX_NOTIONAL||1000),dailyNotional:Number(process.env.AUREON_LIVE_DAILY_NOTIONAL||5000)}
 }});
const host=process.env.HOST||'127.0.0.1',port=Number(process.env.PORT||4173);
if(!['127.0.0.1','::1','localhost'].includes(host)&&!process.env.AUREON_ORIGIN)throw new Error('Network binding requires an explicit AUREON_ORIGIN (and HTTPS reverse proxy for remote access).');
app.server.listen(port,host,()=>console.log(`Aureon Terminal v3: ${process.env.AUREON_ORIGIN||'http://localhost:'+app.server.address().port}\nPrivate store: ${app.store.directory}\nExternal paper brokerage: ${process.env.AUREON_BROKER_USER?'restricted to configured owner':'disabled'}\nReal-money route: ${process.env.AUREON_LIVE_ENABLED==='I_ACCEPT_REAL_MONEY_RISK'?'explicitly enabled; restricted MFA owner and HTTPS required':'disabled'}`));
let stopping=false;for(const sig of['SIGINT','SIGTERM'])process.on(sig,async()=>{if(stopping)return;stopping=true;await app.close();process.exit(0);});
