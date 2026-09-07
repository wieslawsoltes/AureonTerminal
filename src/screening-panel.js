/** Script screening UI; numerical execution lives only in its dedicated pool. */
import {ScreeningClient} from './screening-client.js';
import {validateScreenQuery,queryScreenRows,screenColumns,screeningCSV,SCREEN_FIELDS,SCREEN_OPERATORS} from './screening-query.js';
import {uid} from './core.js';
import {TIMEFRAMES} from './data.js';
import {$,escapeHTML as esc,number as num,select,field,input,button,note,table,empty} from './ui.js';
export class ScreeningPanel {
  constructor(wb) {
    this.wb=wb;this.client=new ScreeningClient();this.result=null;this.progress=null;this.state='Not run';this.offset=0;this.running=false;this.generation=0;
    this.options={workers:Math.max(1,Math.min(4,(globalThis.navigator?.hardwareConcurrency||2)-1)),cutoff:'',maxOperations:2000000};
    this.onChange=e=>{
      const id=e.target.id;
      if(!['script-screen-sort','script-screen-direction','script-screen-combine','script-screen-limit'].includes(id))return;
      try {const key=id.slice('script-screen-'.length),value=key==='limit'?Number(e.target.value):e.target.value;this.setQuery({...this.query,[key]:value});this.update();}
      catch(error){this.wb.app.toast(error.message,true);}
    };
    document.addEventListener('change',this.onChange);
  }
  get query(){return validateScreenQuery(this.wb.config.screenQuery||{});}
  setQuery(value){this.wb.config.screenQuery=validateScreenQuery(value);this.offset=0;this.wb.save();}
  fields(){return [...SCREEN_FIELDS,...screenColumns(this.result?.rows||[]).map(name=>'plot:'+name)];}
  html() {
    const q=this.query,fields=this.fields().map(key=>[key,key.startsWith('plot:')?key.slice(5):key]);
    if(!fields.some(([key])=>key===q.sort))fields.push([q.sort,q.sort.slice(5)]);
    return `<section class="script-screen-section" aria-labelledby="script-screen-heading"><h3 id="script-screen-heading">Parallel script screener</h3>
      ${note('Screens only explicitly imported OHLCV. All symbols and requested datasets share one frozen cutoff; future and provisional bars are excluded. No broker orders or data requests are issued. Up to 100 datasets / 500,000 input bars, with a memory-bounded pool of 1–4 workers.')}
      <form data-v2form="pro-screen-run" class="panel-toolbar screen-controls">
        ${field('UTC cutoff · blank means now',input('cutoff',this.options.cutoff,'datetime-local','step="1"'))}
        ${field('Maximum workers',select('workers',[1,2,3,4],this.options.workers))}
        ${field('Operations per symbol',select('maxOperations',[250000,1000000,2000000,5000000,20000000],this.options.maxOperations))}
        <button id="script-screen-run" class="primary-button" type="submit" ${this.running?'disabled':''}>Run frozen scan</button>
        ${button('Cancel','pro-screen-cancel',`id="script-screen-cancel" ${this.running?'':'disabled'}`)}
        ${button('Filtered CSV + errors','pro-screen-csv',`id="script-screen-csv" ${this.result?.complete?'':'disabled'}`)}
        ${button('Snapshot report JSON','pro-screen-json',`id="script-screen-json" ${this.result?.complete?'':'disabled'}`)}
      </form>
      <div class="panel-toolbar screen-controls">
        ${field('Match',select('combine',['all','any'],q.combine,'id="script-screen-combine"'))}
        ${field('Sort',select('sort',fields,q.sort,'id="script-screen-sort"'))}
        ${field('Direction',select('direction',['asc','desc'],q.direction,'id="script-screen-direction"'))}
        ${field('Rows per page',select('limit',[10,25,50,100],q.limit,'id="script-screen-limit"'))}
        ${select('template',(this.wb.config.screenTemplates||[]).map(t=>[t.id,t.name]),'','id="script-screen-template" aria-label="Saved screening query"')}
        ${button('Load query','pro-screen-load')}${button('Save query','pro-screen-save')}${button('Delete query','pro-screen-delete')}
      </div>
      <form data-v2form="pro-screen-filter" class="panel-toolbar screen-controls">
        ${select('field',fields,'price','aria-label="Filter column"')}
        ${select('op',SCREEN_OPERATORS,'>=','aria-label="Filter operator"')}
        ${input('value',0,'text','aria-label="Literal threshold or text"')}
        ${select('otherField',[['','Compare to literal'],...fields],'' ,'aria-label="Optional comparison column"')}
        <button type="submit" class="secondary-button">Add condition</button>${button('Clear filters','pro-screen-clear')}
      </form><div id="script-screen-output">${this.output()}</div></section>`;
  }
  output() {
    const rows=this.result?.rows||[],q=this.query,r=queryScreenRows(rows,q,this.offset),columns=screenColumns(rows);
    const conditions=q.filters.map((f,i)=>`<span class="screen-condition">${esc(f.field)} ${esc(f.op)} ${esc(f.otherField??f.value??'')}${button('Remove','pro-screen-remove',`data-index="${i}" aria-label="Remove condition ${i+1}"`)}</span>`).join('');
    const progress=this.progress?`<progress max="${this.progress.total}" value="${this.progress.completed}" aria-label="Screening progress"></progress> ${this.progress.completed}/${this.progress.total} datasets`:'';
    const metadata=this.result?`Cutoff ${new Date(this.result.asOf*1000).toISOString()} · ${this.result.workers||0} ${this.result.mode||'starting'} · ${r.total} matches · ${r.errors.length} errors`:'';
    return `<div class="screen-conditions">${conditions}</div><p role="status" id="script-screen-status">${esc(this.state)} ${progress}</p>${note(metadata)}
      ${rows.length?table(['Symbol','Interval','Price','Bar %','Age (s)',...columns,'Source'],r.rows.map(row=>[
        this.result?.complete?button(row.symbol,'pro-screen-open',`data-index="${row.index}" ${TIMEFRAMES.some(t=>t.value===row.interval)&&row.bars<=100000?'':'disabled title="Chart opening requires a supported chart interval and at most 100,000 bars"'}`):esc(row.symbol),row.interval,num(row.price,5),num(row.change),num(row.age,0),...columns.map(name=>num(row.plots.find(p=>p.name===name)?.value,6)),esc(row.source)
      ])):empty('Import a research universe, choose an indicator in the editor, then run a scan.')}
      <div class="panel-toolbar">${button('Previous page','pro-screen-previous',this.offset?'':'disabled')}${note(`${Math.min(this.offset+1,r.total)}–${Math.min(this.offset+q.limit,r.total)} of ${r.total}`)}${button('Next page','pro-screen-next',this.offset+q.limit<r.total?'':'disabled')}</div>
      ${r.errors.length?`<h4>Dataset errors · never converted to zero values</h4>${table(['Symbol','Source','Error'],r.errors.map(x=>[esc(x.symbol),esc(x.source),esc(x.error)]))}`:''}`;
  }
  update() {
    const target=$('script-screen-output');if(target)target.innerHTML=this.output();
    for(const[id,disabled]of[['script-screen-run',this.running],['script-screen-cancel',!this.running],['script-screen-csv',!this.result?.complete],['script-screen-json',!this.result?.complete]])if($(id))$(id).disabled=disabled;
  }
  async start() {
    const generation=++this.generation;this.client.cancel();this.result=null;this.offset=0;this.progress=null;this.state='Preparing frozen inputs';this.running=true;this.update();
    try{
      const cutoff=this.options.cutoff;
      if(cutoff&&!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(cutoff))throw new TypeError('UTC cutoff requires a valid date and time');
      const asOf=cutoff?Date.parse(cutoff+'Z')/1000:Math.floor(Date.now()/1000),script=this.wb.currentScript();
      const result=await this.client.run({source:script?.source,inputs:this.wb.config.scriptInputs,libraries:this.wb.config.libraries,universe:this.wb.config.research.universe,asOf,workers:this.options.workers,maxOperations:this.options.maxOperations},p=>{
        if(generation!==this.generation)return;this.progress=p;this.result={...p,complete:false};this.state='Computing captured script · '+script.name;this.update();
      });
      if(generation!==this.generation)return;this.result={...result,complete:true};this.state='Completed frozen scan';
    }catch(error){if(generation!==this.generation)return;this.state=error.name==='AbortError'?'Canceled · partial results are not a completed scan':'Screen failed: '+error.message;}
    finally{if(generation===this.generation){this.running=false;this.update();}}
    if(generation===this.generation&&this.wb.app.panel==='pro'&&this.wb.pro.tab==='scripts')this.wb.pro.render();
  }
  async submit(name,form) {
    const data=Object.fromEntries(new FormData(form));
    if(name==='pro-screen-run'){this.options={cutoff:data.cutoff,workers:Number(data.workers),maxOperations:Number(data.maxOperations)};return this.start();}
    if(name==='pro-screen-filter'){
      const f={field:data.field,op:data.op};
      if(data.otherField)f.otherField=data.otherField;else if(!['exists','isna'].includes(f.op))f.value=['source','symbol'].includes(f.field)?data.value:Number(data.value);
      this.setQuery({...this.query,filters:[...this.query.filters,f]});this.update();return;
    }
    throw new Error('Unknown screen form');
  }
  async action(name,data={}) {
    const app=this.wb.app,q=this.query,templates=this.wb.config.screenTemplates||(this.wb.config.screenTemplates=[]);
    if(name==='pro-script-screen')return this.start();
    switch(name){
      case'pro-screen-cancel':if(this.client.cancel()){this.state='Canceling workers';this.update();}return;
      case'pro-screen-clear':this.setQuery({...q,filters:[]});break;
      case'pro-screen-remove':{const index=Number(data.index);if(!Number.isInteger(index)||index<0||index>=q.filters.length)throw new Error('Unknown filter');q.filters.splice(index,1);this.setQuery(q);break;}
      case'pro-screen-previous':this.offset=Math.max(0,this.offset-q.limit);break;
      case'pro-screen-next':if(this.offset+q.limit<queryScreenRows(this.result?.rows||[],q).total)this.offset+=q.limit;break;
      case'pro-screen-save':{const name=prompt('Saved query name','My screen');if(!name)return;if(templates.length>=20)throw new Error('At most 20 query templates');templates.push({id:uid(),name:name.slice(0,80),query:structuredClone(q)});this.wb.save();this.wb.pro.render();return;}
      case'pro-screen-load':case'pro-screen-delete':{const index=templates.findIndex(t=>t.id===$('script-screen-template')?.value);if(index<0)throw new Error('Select a saved query');if(name==='pro-screen-load')this.setQuery(templates[index].query);else{templates.splice(index,1);this.wb.save();}this.wb.pro.render();return;}
      case'pro-screen-csv':case'pro-screen-json':if(!this.result?.complete)throw new Error('A completed scan is required for export');app.download(new Blob([name==='pro-screen-csv'?screeningCSV(this.result,q):JSON.stringify({...this.result,query:q},null,2)],{type:name==='pro-screen-csv'?'text/csv':'application/json'}),'aureon-script-screen.'+(name==='pro-screen-csv'?'csv':'json'));return;
      case'pro-screen-open':{if(!this.result?.complete)throw new Error('Finish the scan before opening a snapshot');const dataset=this.client.dataset(Number(data.index)),payload=this.wb.payload(false);if(!TIMEFRAMES.some(t=>t.value===dataset.interval)||dataset.bars.length>100000)throw new Error('Chart opening requires a supported chart interval and at most 100,000 bars');payload.workspace.symbol=dataset.symbol;payload.workspace.interval=dataset.interval;payload.dataset=dataset;await this.wb.importWorkspace(payload);app.toast('Opened the exact closed-bar dataset used by the scan. No live quotes were substituted.');return;}
      default:throw new Error('Unknown screen action');
    }
    this.update();
  }
  destroy(){this.generation++;this.client.destroy();document.removeEventListener('change',this.onChange);}
}
