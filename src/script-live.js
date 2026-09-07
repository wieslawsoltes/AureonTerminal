import {RealtimeScriptSession,runScript} from './script.js';
import {normalizeCandles} from './core.js';
/** One explicitly started, bounded indicator session per worker. Histories are
 * re-evaluated for rollback correctness; this is not an incremental compiler.
 * Every accepted observation is sequenced. Failure requires an explicit restart.
 */
export class LiveScriptRuntime {
  run(type, bars, options = {}) {
    if (type === 'live-stop') { this.active = null; return {stopped: true}; }
    if (type === 'live-start') return this.start(bars, options);
    if (type !== 'live-update') throw new Error('Unknown live script operation');
    try { return this.update(options); } catch (error) { this.active = null; throw error; }
  }
  start(bars, options) {
    this.active = null;
    const {source, symbol, interval, asOf} = options, maxBars = options.maxBars ?? 5000;
    if (!Number.isInteger(maxBars) || maxBars < 1 || maxBars > 10000 || !Array.isArray(bars) || !bars.length || bars.length > maxBars) throw new Error('Realtime history limit is 1–10,000 bars');
    if (!Number.isInteger(interval) || interval < 1 || !Number.isFinite(asOf)) throw new Error('Invalid realtime context');
    const normalized = normalizeCandles(bars);
    if (normalized.length !== bars.length || normalized.some((b,i) => b.t !== bars[i].t || b.t > asOf) || bars.slice(0,-1).some(b => b.partial || b.t + interval > asOf)) throw new Error('Realtime seed must be ascending closed history with at most one open bar');
    const config = {source, symbol, interval, inputs: options.inputs, libraries: options.libraries, datasets: options.datasets, maxOperations: 1_000_000};
    const session = new RealtimeScriptSession(source, config), last = bars.at(-1), open = !!last.partial || last.t + interval > asOf;
    session.reset(bars.slice(0, open ? -1 : undefined));
    const result = open ? session.update(last, {asOf}) : runScript(source, bars, config);
    this.indicatorOnly(result);
    this.active = {session, sequence: 0, asOf, maxBars, interval, previous: open ? structuredClone(last) : null};
    return {...result, live: {sequence: 0, asOf, confirmed: !open}};
  }
  indicatorOnly(result) {
    if (result.kind !== 'indicator' || result.commands.length) throw new Error('Realtime editor accepts indicators only; use the portfolio tester for strategy orders');
  }
  validateObservation(bar, previous) {
    normalizeCandles([bar]);
    if (previous && (bar.t !== previous.t || bar.o !== previous.o || bar.h < previous.h || bar.l > previous.l || bar.v < previous.v)) throw new Error('Observed history changed; restart the realtime script');
  }
  update({bar, closedBar, asOf, sequence}) {
    const a = this.active;
    if (!a) throw new Error('Realtime session is unavailable; start it explicitly');
    if (sequence !== a.sequence + 1 || !Number.isFinite(asOf) || asOf < a.asOf || asOf < bar?.t) throw new Error('Realtime observation sequence or time regressed');
    this.validateObservation(bar);
    if (a.session.openTime !== null && bar.t !== a.session.openTime) {
      if (!closedBar || closedBar.t !== a.session.openTime || bar.t < closedBar.t + a.interval || asOf < closedBar.t + a.interval) throw new Error('A rollover requires the actual completed source bar');
      this.validateObservation(closedBar, a.previous);
      this.indicatorOnly(a.session.update(closedBar, {confirmed: true, asOf}));
      a.previous = null;
    }
    if (a.session.closed.length >= a.maxBars) throw new Error('Realtime history capacity reached; restart on an explicit shorter history');
    this.validateObservation(bar, a.previous);
    const result = a.session.update(bar, {confirmed: false, asOf}); this.indicatorOnly(result);
    a.previous = structuredClone(bar); a.sequence = sequence; a.asOf = asOf;
    return {...result, live: {sequence, asOf, confirmed: false}};
  }
}
