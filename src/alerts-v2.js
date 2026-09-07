/** Shared condition engine for browser and always-running server monitors.
 * Stateful crossings never synthesize a crossing on the first observation.
 */
import {uid} from './core.js';
const OPS=new Set(['cross','crossAbove','crossBelow','above','below','equal','inside','outside','changeUp','changeDown']);
export function validateAlert(rule){
  if(!rule||typeof rule.symbol!=='string'||!/^[A-Z0-9._/-]{1,40}$/.test(rule.symbol))throw new Error('Invalid alert symbol.');
  if(!Array.isArray(rule.conditions)||!rule.conditions.length||rule.conditions.length>16)throw new Error('Alert requires 1–16 conditions.');
  for(const c of rule.conditions){if(!OPS.has(c.op)||typeof c.source!=='string'||!/^[\w.:-]{1,100}$/.test(c.source))throw new Error('Invalid alert condition.');if(typeof c.target==='string'){if(!/^[\w.:-]{1,100}$/.test(c.target))throw new Error('Invalid target series.');}else if(!Number.isFinite(c.target))throw new Error('Condition target must be a number or series key.');if(['inside','outside'].includes(c.op)&&(!Number.isFinite(c.upper)||c.upper<Number(c.target)))throw new Error('Invalid range.');}
  if(!['all','any'].includes(rule.combine||'all'))throw new Error('Invalid condition combination.');
  if(!['once','every','bar','close'].includes(rule.frequency||'once'))throw new Error('Invalid alert frequency.');
  if(rule.cooldown!=null&&(!Number.isFinite(rule.cooldown)||rule.cooldown<0||rule.cooldown>31536000))throw new Error('Invalid cooldown.');
  if(rule.expires!=null&&!Number.isFinite(rule.expires))throw new Error('Invalid expiration.');
  if(rule.message!=null&&(typeof rule.message!=='string'||rule.message.length>2000))throw new Error('Alert message is too long.');return rule;
}
export function condition(c,current,previous){const a=current[c.source],b=typeof c.target==='string'?current[c.target]:c.target;if(!Number.isFinite(a)||!Number.isFinite(b))return false;const pa=previous?.[c.source],pb=typeof c.target==='string'?previous?.[c.target]:c.target;
  switch(c.op){case'above':return a>b;case'below':return a<b;case'equal':return a===b;case'inside':return a>=b&&a<=c.upper;case'outside':return a<b||a>c.upper;case'cross':return Number.isFinite(pa)&&Number.isFinite(pb)&&((pa<=pb&&a>b)||(pa>=pb&&a<b));case'crossAbove':return Number.isFinite(pa)&&Number.isFinite(pb)&&pa<=pb&&a>b;case'crossBelow':return Number.isFinite(pa)&&Number.isFinite(pb)&&pa>=pb&&a<b;case'changeUp':return Number.isFinite(pa)&&pa!==0&&(a/pa-1)*100>=b;case'changeDown':return Number.isFinite(pa)&&pa!==0&&(pa-a)/Math.abs(pa)*100>=b;default:return false;}}
export class RulesEngine {
  constructor(rules=[]){this.rules=rules.map(x=>({...validateAlert(x)}));this.previous=new Map();this.log=[];}
  add(rule){validateAlert(rule);if(this.rules.length>=500)throw new Error('Maximum 500 alerts.');const value={id:uid(),created:Date.now()/1000,active:true,combine:'all',frequency:'once',cooldown:0,...structuredClone(rule)};this.rules.push(value);return value;}
  remove(id){this.rules=this.rules.filter(r=>r.id!==id);this.previous.delete(id);}
  update(symbol,values,{time=Date.now()/1000,barTime=time,confirmed=false,mode='market',frequency=null}={}){
    const fired=[];for(const r of this.rules){if(r.symbol!==symbol||!r.active||(frequency==='close'&&r.frequency!=='close')||(frequency==='intrabar'&&r.frequency==='close'))continue;if(r.expires!=null&&time>=r.expires){r.active=false;r.status='expired';continue;}
      if(r.mode&&r.mode!==mode)continue;if(r.frequency==='close'&&!confirmed)continue;
      const prev=this.previous.get(r.id),results=r.conditions.map(c=>condition(c,values,prev));this.previous.set(r.id,{...values});
      const yes=r.combine==='any'?results.some(Boolean):results.every(Boolean);if(!yes)continue;
      if(r.lastFired!=null&&time-r.lastFired<(r.cooldown||0))continue;if(['bar','close'].includes(r.frequency)&&r.lastBar===barTime)continue;
      r.lastFired=time;r.lastBar=barTime;if(r.frequency==='once')r.active=false;
      const message=String(r.message||'{{symbol}} alert: {{price}}').replace(/\{\{([\w.:-]+)\}\}/g,(_,key)=>key==='symbol'?symbol:key==='time'?new Date(time*1000).toISOString():String(values[key]??''));
      const event={id:uid(),ruleId:r.id,symbol,time,barTime,message,values:{...values},mode};this.log.push(event);fired.push(event);
    }if(this.log.length>5000)this.log.splice(0,this.log.length-5000);return fired;
  }
}
