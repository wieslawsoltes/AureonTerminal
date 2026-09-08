/** Explicit, snapshot-based session research UI with an independently cancellable
 * worker. A changed source/replay/config invalidates outputs instead of displaying
 * stale research as a live study. Workspace persistence stores rules, not results.
 */
import {JobClient} from './jobs.js';
import {tradingCalendarTemplate,validateTradingCalendar} from './session-calendar.js';
import {validateSessionSettings,sessionAnalysisStudy,sessionAnalysisCSV} from './session-analysis.js';
import {$,escapeHTML as esc,number as num,select,field,input,button,note,table,empty} from './ui.js';
const pretty=value=>JSON.stringify(value,(_k,v)=>ArrayBuffer.isView(v)?[...v]:typeof v==='number'&&!Number.isFinite(v)?null:v,2);
export class SessionPanel {
  constructor(wb) {
    this.wb=wb;this.client=new JobClient();this.result=null;this.snapshot=null;this.generation=0;this.running=false;
    this.status='Apply an explicit calendar to analyze the current raw history.';this.draft=null;this.offset=0;this.mode='sessions';this.cutoff='';
    this.input=document.createElement('input');this.input.type='file';this.input.accept='.json';this.input.hidden=true;this.input.id='session-calendar-file';document.body.append(this.input);
    this.input.addEventListener('change',async()=>{
      try {const file=this.input.files?.[0];if(!file)return;if(file.size>2000000)throw new RangeError('Calendar JSON is limited to 2 MB');
        const raw=JSON.parse(await file.text());const calendar=validateTradingCalendar(raw);this.draft=pretty(calendar);this.status='Calendar imported as a draft; apply it to calculate.';this.render();
      } catch(error){this.wb.app.toast(error.message,true);} finally{this.input.value='';}
    });
    this.onInput=e=>{if(e.target.id==='session-calendar-json')this.draft=e.target.value;};document.addEventListener('input',this.onInput);
  }
  get settings(){return validateSessionSettings(this.wb.config.sessionResearch??{});}
  capture(){const a=this.wb.app;return{series:a.series,version:a.series.version,symbol:a.state.symbol,interval:a.state.interval,kind:a.kind,endLimit:a.chart.endLimit,replaying:a.replaying,settings:JSON.stringify(this.settings),source:a.exportLabel()};}
  matches(snapshot=this.snapshot){if(!snapshot)return false;const now=this.capture();return Object.keys(now).every(key=>now[key]===snapshot[key]);}
  render(){if(this.wb.app.panel==='pro'&&this.wb.pro.tab==='sessions')this.wb.pro.render();}
  invalidateIfChanged(){if(this.snapshot&&!this.matches()){this.clear('Source, replay or calendar changed. Recalculate the session snapshot.');}}
  clear(message='Session overlays cleared.') {
    this.generation++;if(this.running)this.client.cancel();this.running=false;this.snapshot=null;this.result=null;this.status=message;
    this.wb.applySession();this.wb.applyStudies();this.render();
  }
  studies(){return this.result&&this.matches()&&this.settings.overlay?[sessionAnalysisStudy(this.result)]:[];}
  installShade() {
    if(!this.settings.shade){this.wb.applySession();return;}
    const result=this.result, snapshot=this.snapshot, applied=this.wb.config.sessionResearch, app=this.wb.app, ordered=result.windows.flatMap(s=>s.segments);
    const first=this.wb.bars()[0]?.t??result.asOf;
    this.wb.app.chart.sessionCalendar={contains:time=>{
      if(app.series!==snapshot.series||app.series.version!==snapshot.version||app.chart.endLimit!==snapshot.endLimit||this.wb.config.sessionResearch!==applied||time<first||time>=result.asOf)return true;
      let lo=0,hi=ordered.length;while(lo<hi){const mid=(lo+hi)>>>1;if(ordered[mid].close<=time)lo=mid+1;else hi=mid;}
      return lo<ordered.length&&ordered[lo].open<=time;
    }};
    this.wb.app.chart.invalidate();
  }
  html() {
    const s=this.settings,r=this.result,rows=r?.[this.mode]??[],part=rows.slice(this.offset,this.offset+50);
    const output=r?`${note(`${r.accepted} accepted closed bars · ${Object.entries(r.excluded).map(([k,v])=>`${k}: ${v}`).join(' · ')} · ${r.emptySessions.length} scheduled sessions without observations`)}
      <div class="panel-toolbar">${button('Session summary','pro-session-view','data-mode="sessions"')}${button('Resampled bars','pro-session-view','data-mode="bars"')}${button('Missing sessions','pro-session-view','data-mode="emptySessions"')}${button('Previous','pro-session-page','data-step="-1"')}${button('Next','pro-session-page','data-step="1"')}<span>${rows.length?this.offset+1:0}–${Math.min(rows.length,this.offset+50)} / ${rows.length}</span></div>
      <div id="session-analysis-table">${this.mode==='emptySessions'?table(['Session start date','Trade date','Open UTC','Close UTC'],part.map(x=>[esc(x.session),esc(x.tradeDate),esc(new Date(x.open*1000).toISOString()),esc(new Date(x.close*1000).toISOString())])):table(['Trade date','Open UTC','Open','High','Low','Close','Volume','Coverage','Complete'],part.map(x=>[esc(x.tradeDate),esc(new Date(x.t*1000).toISOString()),num(x.o,6),num(x.h,6),num(x.l,6),num(x.c,6),num(x.v,4),num(x.coverage*100)+'%',x.complete?'Yes':'No · partial']))}</div>`:empty(this.running?'Computing a frozen session snapshot…':'No session snapshot. Raw chart history and order execution are unchanged.');
    return `<section class="session-research" aria-labelledby="session-heading"><h3 id="session-heading">Trading sessions & closed-bar research</h3>
      ${note('Weekdays and closure/override dates refer to the local SESSION START date. Overnight labels can use tradeDateOffset: 1. Templates are editable schedules, not maintained exchange calendars. Missing, partial and boundary-crossing candles are not invented or split.')}
      <div class="panel-toolbar">${select('template',[['utc','Continuous UTC'],['ny','New York core-hours template'],['overnight','Chicago overnight example'],['split','Tokyo split-session example']],'utc','id="session-template" aria-label="Calendar template"')}${button('Use template','pro-session-template')}${button('Import calendar','pro-session-import')}${button('Export applied calendar','pro-session-calendar-export')}</div>
      <form data-v2form="pro-session-run"><div class="pro-split"><label class="v2-field"><span>Explicit calendar JSON · dates YYYY-MM-DD · clocks HH:MM</span><textarea id="session-calendar-json" name="calendar" class="pro-json" rows="12" spellcheck="false">${esc(this.draft??pretty(s.calendar))}</textarea></label><div>
        <div class="v2-form-grid">${field('Opening range · first segment minutes',input('openingMinutes',s.openingMinutes,'number','min="1" max="240" required'))}${field('VWAP deviation multiplier',input('multiplier',s.multiplier,'number','min="0" max="10" step="0.1" required'))}${field('Target candle seconds · multiple of source',input('targetInterval',s.targetInterval,'number','min="1" max="86400" required'))}${field('Cutoff UTC · blank means now; replay is capped',input('cutoff',this.cutoff,'datetime-local','step="1"'))}</div>
        <label><input type="checkbox" name="shade" ${s.shade?'checked':''}> Shade non-session time on the primary chart</label><br><label><input type="checkbox" name="overlay" ${s.overlay?'checked':''}> Show VWAP / deviation bands, confirmed opening range, previous complete session levels</label>
        ${note('Session VWAP uses OHLC typical prices, not a reconstruction of trade VWAP. Previous levels require full coverage of the immediately preceding scheduled session. Outputs are captured research, not live quotes. Source/replay changes clear them.')}
        <button type="submit" class="primary-button" ${this.running?'disabled':''}>Apply calendar & analyze</button> ${button('Cancel','pro-session-cancel',this.running?'':'disabled')} ${button('Clear overlays','pro-session-clear')}
      </div></div></form><p id="session-analysis-status" role="status">${esc(this.status)}</p>
      <div class="panel-toolbar">${button('Candle CSV','pro-session-export','data-kind="bars" '+(!r?'disabled':''))}${button('Session CSV','pro-session-export','data-kind="sessions" '+(!r?'disabled':''))}${button('Snapshot JSON','pro-session-export','data-kind="json" '+(!r?'disabled':''))}</div>${output}</section>`;
  }
  async submit(_name,form) {
    const values=Object.fromEntries(new FormData(form));this.draft=values.calendar;this.cutoff=values.cutoff;
    if(values.calendar.length>2000000)throw new RangeError('Calendar JSON is limited to 2 MB');
    const settings=validateSessionSettings({calendar:JSON.parse(values.calendar),openingMinutes:Number(values.openingMinutes),multiplier:Number(values.multiplier),targetInterval:Number(values.targetInterval),shade:values.shade==='on',overlay:values.overlay==='on'});
    const a=this.wb.app,bars=this.wb.bars();let asOf=values.cutoff?Date.parse(values.cutoff+'Z')/1000:Date.now()/1000;
    if(!Number.isFinite(asOf))throw new RangeError('Invalid UTC cutoff');
    if(a.replaying)asOf=Math.min(asOf,(bars.at(-1)?.t??0)+a.state.interval);
    if(settings.targetInterval<a.state.interval||settings.targetInterval%a.state.interval)throw new RangeError('Target interval must be an integer multiple of the source interval');
    this.clear();this.wb.config.sessionResearch=settings;this.wb.save();this.draft=pretty(settings.calendar);this.snapshot=this.capture();
    const snapshot=this.snapshot,generation=++this.generation;this.running=true;this.offset=0;this.mode='sessions';this.status='Calculating closed raw bars in an isolated worker…';this.render();
    try {
      const result=await this.client.run('sessions',structuredClone(bars),{interval:a.state.interval,asOf,settings});
      if(generation!==this.generation)return;
      if(!this.matches(snapshot)){this.clear('Source changed during calculation. Recalculate.');return;}
      this.result=result;this.status=`Captured ${snapshot.symbol} · ${snapshot.source} · cutoff ${new Date(asOf*1000).toISOString()} · ${result.sessions.length} observed sessions · ${this.client.worker?'dedicated worker':'bounded synchronous fallback'}`;
      this.installShade();this.wb.applyStudies();
    } catch(error){if(generation!==this.generation)return;this.result=null;this.status='Session calculation failed: '+error.message;throw error;}
    finally {if(generation===this.generation){this.running=false;this.render();}}
  }
  async action(name,data={}) {
    const a=this.wb.app;
    if(name==='pro-session-template'){this.draft=pretty(tradingCalendarTemplate($('session-template').value));this.status='Template is a draft. Review its rules and apply.';this.render();return;}
    if(name==='pro-session-import'){this.input.click();return;}
    if(name==='pro-session-calendar-export'){a.download(new Blob([pretty(this.settings.calendar)],{type:'application/json'}),'aureon-calendar.json');return;}
    if(name==='pro-session-cancel'||name==='pro-session-clear'){this.clear(name.endsWith('cancel')?'Session calculation canceled.':'Session overlays cleared.');return;}
    if(name==='pro-session-view'){if(!['sessions','bars','emptySessions'].includes(data.mode))throw new RangeError('Invalid session report');this.mode=data.mode;this.offset=0;this.render();return;}
    if(name==='pro-session-page'){const length=this.result?.[this.mode]?.length??0;this.offset=Math.max(0,Math.min(Math.max(0,Math.floor((length-1)/50)*50),this.offset+Number(data.step)*50));this.render();return;}
    if(name==='pro-session-export'){
      if(!this.result||!this.matches())throw new Error('Recalculate the current source before exporting');
      const json=data.kind==='json',text=json?pretty({application:'Aureon session research',symbol:this.snapshot.symbol,source:this.snapshot.source,...this.result}):sessionAnalysisCSV(this.result,data.kind,this.snapshot.source);
      a.download(new Blob([text],{type:json?'application/json':'text/csv'}),`aureon-sessions-${data.kind}.${json?'json':'csv'}`);return;
    }
    throw new Error('Unknown session action');
  }
  destroy(){this.generation++;this.client.destroy();document.removeEventListener('input',this.onInput);this.input.remove();}
}
