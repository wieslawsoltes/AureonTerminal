/** Closed-source-bar session research. Never changes raw market history or sends
 * orders. Missing source slots remain gaps; no OHLC is divided across a boundary.
 */
import {TradingCalendar, validateTradingCalendar, tradingCalendarTemplate} from './session-calendar.js';
function bounded(value, low, high, name, whole = false) {
  if (!Number.isFinite(value) || value < low || value > high || whole && !Number.isInteger(value)) throw new RangeError(`Invalid ${name}`);
  return value;
}
export function validateSessionSettings(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('Invalid session settings');
  const allowed = ['calendar','openingMinutes','multiplier','targetInterval','shade','overlay'];
  for (const key of Object.keys(raw)) if (!allowed.includes(key)) throw new TypeError(`Unknown session setting: ${key}`);
  if (raw.shade != null && typeof raw.shade !== 'boolean' || raw.overlay != null && typeof raw.overlay !== 'boolean') throw new TypeError('Session visibility must be boolean');
  return {calendar: validateTradingCalendar(raw.calendar ?? tradingCalendarTemplate()),
    openingMinutes: bounded(raw.openingMinutes ?? 30, 1, 240, 'opening-range minutes', true),
    multiplier: bounded(raw.multiplier ?? 2, 0, 10, 'VWAP deviation multiplier'),
    targetInterval: bounded(raw.targetInterval ?? 3600, 1, 86400, 'resample interval', true),
    shade: raw.shade ?? false, overlay: raw.overlay ?? true};
}
function rawBars(bars, interval) {
  if (!Array.isArray(bars) || !bars.length || bars.length > 200000) throw new RangeError('Session research needs 1–200,000 raw OHLCV bars');
  let previous = -Infinity;
  for (const b of bars) {
    if (!b || !Number.isSafeInteger(b.t) || ![b.o,b.h,b.l,b.c,b.v].every(Number.isFinite) || b.v < 0 || b.l > Math.min(b.o,b.c) || b.h < Math.max(b.o,b.c) || b.h < b.l || b.t < previous + interval) throw new RangeError('Use finite, ordered, nonoverlapping raw OHLCV bars');
    if (b.synthetic || b.sourceIndex != null || b.derived) throw new RangeError('Derived display bars cannot be used for session research');
    if (b.partial != null && typeof b.partial !== 'boolean') throw new TypeError('Partial-bar flag must be boolean');
    previous = b.t;
  }
}
function aggregate(bar, t, end, window, segment) {
  return {t, end, o:bar.o, h:bar.h, l:bar.l, c:bar.c, v:bar.v, session:window.id, tradeDate:window.tradeDate,
    segment, count:1, observedSeconds:0, complete:false, partial:true, firstObserved:bar.t, lastObserved:bar.t};
}
function append(target, bar) {
  target.h = Math.max(target.h, bar.h); target.l = Math.min(target.l, bar.l); target.c = bar.c;
  target.v += bar.v; target.count++; target.lastObserved = bar.t;
  if (!Number.isFinite(target.v)) throw new RangeError('Session volume overflow');
}
export function analyzeTradingSessions(bars, options = {}) {
  const interval = bounded(options.interval, 1, 86400, 'source interval', true);
  const asOf = bounded(options.asOf, -2208816000, 7289481600, 'closed-bar cutoff');
  const settings = validateSessionSettings(options.settings ?? {});
  if (settings.targetInterval < interval || settings.targetInterval % interval !== 0) throw new RangeError('Target interval must be an integer multiple of the source interval');
  rawBars(bars, interval);
  const calendar = new TradingCalendar(settings.calendar);
  const plots = Object.fromEntries(['VWAP','Upper','Lower','Opening high','Opening low','Previous high','Previous low','Previous close'].map(name => [name,new Float64Array(bars.length).fill(NaN)]));
  const excluded = {future:0, partial:0, outside:0, boundary:0, misaligned:0};
  // A future input is counted but cannot expand the historical calendar window.
  const eligible = bars.map((b,index) => ({b,index})).filter(({b}) => {
    if (b.t + interval > asOf) { excluded.future++; return false; }
    if (b.partial) { excluded.partial++; return false; }
    return true;
  });
  const base = {version:1, calendar:settings.calendar, settings, interval, asOf, excluded, plots, breaks:new Uint8Array(bars.length), sessions:[], bars:[], windows:[], emptySessions:[], accepted:0,
    assumptions:{price:'OHLC typical price (H/3 + L/3 + C/3), not tick VWAP', boundaries:'Half-open UTC segments derived from explicit local rules',
      source:'Only closed, aligned, fully contained source candles', previous:'Immediately preceding scheduled session; full coverage required',
      opening:'First segment only; published after complete opening-window coverage', resampling:'Buckets reset at each segment open; no invented bars or volume'}};
  if (!eligible.length) return base;
  const windows = calendar.between(eligible[0].b.t, eligible.at(-1).b.t + interval);
  base.windows = windows;
  let cursor = 0, current = null, prior = null, previousAccepted = null;
  for (const {b,index} of eligible) {
    while (cursor < windows.length && b.t >= windows[cursor].close) cursor++;
    const window = windows[cursor];
    if (!window || b.t < window.open) { excluded.outside++; continue; }
    const segment = window.segments.find(s => b.t >= s.open && b.t < s.close);
    if (!segment) { excluded.outside++; continue; }
    if (b.t + interval > segment.close) { excluded.boundary++; continue; }
    if ((b.t - segment.open) % interval !== 0) { excluded.misaligned++; continue; }
    if (!previousAccepted || previousAccepted.session !== window.id || previousAccepted.segment !== segment.index || previousAccepted.time + interval !== b.t) base.breaks[index] = 1;
    previousAccepted = {session:window.id,segment:segment.index,time:b.t};
    if (!current || current.window !== window) {
      if (current) finishSession(current, asOf);
      // Empty scheduled sessions in between invalidate previous-session levels.
      prior = current && windows[cursor - 1] === current.window && current.summary.complete ? current.summary : null;
      const summary = {...aggregate(b, window.open, window.close, window, null), count:0, v:0, coverage:0, expectedSeconds:window.seconds,
        missingSeconds:window.seconds, openingEnd:Math.min(window.open + settings.openingMinutes * 60,window.segments[0].close),
        openingComplete:false, openingHigh:null, openingLow:null, override:window.override};
      current = {window, summary, weight:0, anchor:0, mean:0, variance:0, openingSeconds:0, openingHigh:-Infinity, openingLow:Infinity, bucket:null};
      base.sessions.push(summary);
    }
    if (current.summary.count === 0) { current.summary.o=b.o;current.summary.h=b.h;current.summary.l=b.l;current.summary.c=b.c;current.summary.v=b.v;current.summary.count=1;current.summary.firstObserved=b.t;current.summary.lastObserved=b.t; }
    else append(current.summary,b);
    current.summary.observedSeconds += interval;
    base.accepted++;
    const price = b.h/3+b.l/3+b.c/3;
    if (!Number.isFinite(price)) throw new RangeError('Session price overflow');
    if (b.v > 0) {
      if (!current.weight) current.anchor = price;
      const weight = current.weight+b.v;
      if (!Number.isFinite(weight)) throw new RangeError('Session weight overflow');
      const alpha=b.v/weight, delta=price-current.anchor-current.mean;
      const between=delta*Math.sqrt(alpha)*Math.sqrt(1-alpha);
      current.mean+=alpha*delta; current.variance=(1-alpha)*current.variance+between*between; current.weight=weight;
      if (!Number.isFinite(current.mean)||!Number.isFinite(current.variance)) throw new RangeError('Session moments overflow');
    }
    if (current.weight>0) {
      const mid=current.anchor+current.mean, spread=settings.multiplier*Math.sqrt(current.variance);
      if (![mid,mid+spread,mid-spread].every(Number.isFinite)) throw new RangeError('Session band overflow');
      plots.VWAP[index]=mid;plots.Upper[index]=mid+spread;plots.Lower[index]=mid-spread;
    }
    const openingEnd=current.summary.openingEnd;
    if (segment.index===0&&b.t+interval<=openingEnd) {
      current.openingSeconds+=interval;current.openingHigh=Math.max(current.openingHigh,b.h);current.openingLow=Math.min(current.openingLow,b.l);
    }
    if (b.t+interval>=openingEnd&&current.openingSeconds===openingEnd-window.open) {
      plots['Opening high'][index]=current.openingHigh;plots['Opening low'][index]=current.openingLow;
      current.summary.openingComplete=true;current.summary.openingHigh=current.openingHigh;current.summary.openingLow=current.openingLow;
    }
    if (prior) {plots['Previous high'][index]=prior.h;plots['Previous low'][index]=prior.l;plots['Previous close'][index]=prior.c;}
    const t=segment.open+Math.floor((b.t-segment.open)/settings.targetInterval)*settings.targetInterval;
    const end=Math.min(t+settings.targetInterval,segment.close);
    // An aligned source is still never divided across a shortened bucket edge.
    if (b.t+interval>end) throw new RangeError('Source candle crosses a resampling boundary');
    if (!current.bucket||current.bucket.t!==t) {
      current.bucket=aggregate(b,t,end,window,segment.index);base.bars.push(current.bucket);
    } else append(current.bucket,b);
    current.bucket.observedSeconds+=interval;
  }
  if (current) finishSession(current, asOf);
  const observedSessions = new Set(base.sessions.map(s => s.session));
  base.emptySessions = windows.filter(s => !observedSessions.has(s.id)).map(s => ({session:s.id,tradeDate:s.tradeDate,open:s.open,close:s.close,expectedSeconds:s.seconds}));
  for (const b of base.bars) {
    b.coverage=b.observedSeconds/(b.end-b.t);b.complete=b.end<=asOf&&b.observedSeconds===b.end-b.t;b.partial=!b.complete;
    b.knownAt=b.lastObserved+interval;
  }
  return base;
}
function finishSession(state, asOf) {
  const s=state.summary;
  s.coverage=s.observedSeconds/s.expectedSeconds;s.missingSeconds=s.expectedSeconds-s.observedSeconds;
  s.complete=s.end<=asOf&&s.missingSeconds===0;s.partial=!s.complete;
  s.vwap=state.weight>0?state.anchor+state.mean:null;s.deviation=state.weight>0?Math.sqrt(state.variance):null;
}
export function sessionAnalysisStudy(result) {
  const palette=['#eeb34f','#ca9de9','#ca9de9','#39cda9','#f17c87','#7ea8ed','#7ea8ed','#b8c0d4'];
  return {id:'session-research',name:`Session research · ${result.calendar.name}`,overlay:true,levels:[],
    plots:Object.entries(result.plots).map(([name,values],i)=>({name,values,breaks:result.breaks,color:palette[i],width:i===0?2:1}))};
}
/** CSV exports include explicit completion/coverage metadata; no executable quote
 * contract. Every textual cell is spreadsheet-formula guarded and quoted.
 */
export function sessionAnalysisCSV(result, kind='bars', provenance='Explicit source') {
  if (!['bars','sessions'].includes(kind)) throw new RangeError('Unknown session export kind');
  const columns=['t','end','tradeDate','session','o','h','l','c','v','count','coverage','complete','partial'];
  if (kind==='sessions') columns.push('openingEnd','openingComplete','openingHigh','openingLow','vwap','deviation','missingSeconds');
  const cell=value=>{
    if(value==null||typeof value==='number'&&!Number.isFinite(value))return '';
    let text=String(value);if(typeof value==='string'&&/^[\s]*[=+\-@\t\r\n]/.test(text))text="'"+text;
    return '"'+text.replace(/"/g,'""')+'"';
  };
  return [['source','calendar','timezone','asOf',...columns],...result[kind].map(row=>[provenance,result.calendar.name,result.calendar.timezone,result.asOf,...columns.map(k=>row[k])])].map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
}
