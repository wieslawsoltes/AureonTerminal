/** Durable, bounded event journal shared by JSON or same-host SQLite stores.
 * appendEvent must run inside the domain mutation's storage transaction. SSE
 * consumers use a replay cursor, recheck authorization, and never block writers.
 */
import {randomUUID} from 'node:crypto';
export const EVENT_LIMIT = 4096;
export const EVENT_TTL = 24 * 3600_000;
const MAX_EVENT_BYTES = 16_384;
const cursorPattern = /^([a-f0-9-]{36}):([0-9]{1,16})$/;

export function appendEvent(state, userId, event, now = Date.now()) {
  if (userId !== null && (typeof userId !== 'string' || !state.users.some(u => u.id === userId))) throw new Error('Invalid event recipient');
  if (!event || typeof event.type !== 'string' || (userId === null && event.type !== 'idea')) throw new Error('Private event requires a recipient');
  const text = JSON.stringify(event);
  if (Buffer.byteLength(text) > MAX_EVENT_BYTES) throw new Error('Event capacity exceeded');
  const journal = state.eventJournal ??= {version: 1, epoch: randomUUID(), sequence: 0, entries: []};
  if (journal.version !== 1 || !Number.isSafeInteger(journal.sequence + 1)) throw new Error('Invalid event journal');
  const row = {sequence: ++journal.sequence, userId, time: now, event: JSON.parse(text)};
  journal.entries = journal.entries.filter(e => e.time > now - EVENT_TTL).slice(-(EVENT_LIMIT - 1));
  journal.entries.push(row);
  return `${journal.epoch}:${row.sequence}`;
}

export function canDeliver(state, row, userId) {
  if (row.userId !== null && row.userId !== userId) return false;
  const e = row.event;
  if (e.type === 'room' || e.type === 'drawings') return !!state.pro?.rooms.some(r => r.id === e.id && r.members.includes(userId));
  if (e.type === 'message') {
    const message = state.pro?.messages.find(m => m.id === e.id && m.to === userId && !m.hidden);
    return !!message && !state.pro.blocks.some(b => b.from === userId && b.to === message.from || b.to === userId && b.from === message.from);
  }
  return true;
}

export function readEvents(state, userId, cursor, now = Date.now()) {
  const j = state.eventJournal;
  if (!j) return {cursor: null, entries: [], reset: cursor ? 'journal-unavailable' : null};
  const latest = `${j.epoch}:${j.sequence}`, entries = j.entries.filter(e => e.time > now - EVENT_TTL);
  if (!cursor) return {cursor: latest, entries: [], reset: null};
  const m = cursorPattern.exec(cursor), n = m ? Number(m[2]) : NaN;
  if (!m || !Number.isSafeInteger(n) || m[1] !== j.epoch || n > j.sequence) return {cursor: latest, entries: [], reset: 'cursor-invalid'};
  const floor = entries.length ? entries[0].sequence - 1 : j.sequence;
  if (n < floor) return {cursor: latest, entries: [], reset: 'cursor-expired'};
  return {cursor: latest, entries: entries.filter(e => e.sequence > n && canDeliver(state, e, userId)).map(e => ({id: `${j.epoch}:${e.sequence}`, event: e.event})), reset: null};
}

export class EventHub {
  constructor(store, {interval = 250, clock = Date.now} = {}) {
    this.store = store; this.clock = clock; this.clients = new Map();
    this.timer = setInterval(() => { try { this.pump(); } catch { this.endAll(); } }, interval);
    this.timer.unref?.();
  }
  attach(req, res, userId, session) {
    if ([...this.clients.values()].filter(c => c.userId === userId).length >= 5) throw Object.assign(new Error('Maximum five event streams per user per process'), {status: 429});
    const last = req.headers['last-event-id'];
    if (last && (typeof last !== 'string' || last.length > 80 || !cursorPattern.test(last))) throw Object.assign(new Error('Invalid event cursor'), {status: 400});
    const cursor = last || readEvents(this.store.state, userId, null, this.clock()).cursor;
    const client = {userId, sessionHash: session.tokenHash, expires: session.expires, cursor, heartbeat: this.clock()};
    res.writeHead(200, {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no'});
    res.write('retry: 1000\n' + (cursor && !last ? `id: ${cursor}\n` : '') + 'data: {"type":"connected"}\n\n');
    this.clients.set(res, client);
    res.on('close', () => this.clients.delete(res));
    this.pump();
  }
  pump() {
    if (!this.clients.size) return;
    const now = this.clock(), state = this.store.state;
    for (const [res, c] of this.clients) {
      if (res.destroyed || now >= c.expires || !state.sessions.some(s => s.tokenHash === c.sessionHash && s.userId === c.userId && s.expires > now)) {
        res.end(); this.clients.delete(res); continue;
      }
      if (res.writableLength > 256 * 1024) { res.destroy(); this.clients.delete(res); continue; }
      if (res.writableNeedDrain) continue;
      // A newly initialized journal must include its first event, not skip it.
      if (!c.cursor && state.eventJournal) c.cursor = `${state.eventJournal.epoch}:0`;
      const batch = readEvents(state, c.userId, c.cursor, now);
      if (batch.reset) {
        res.write(`id: ${batch.cursor ?? ''}\ndata: ${JSON.stringify({type: 'resync', reason: batch.reset})}\n\n`);
        c.cursor = batch.cursor; continue;
      }
      let blocked = false;
      for (const item of batch.entries.slice(0, 64)) {
        const accepted = res.write(`id: ${item.id}\ndata: ${JSON.stringify(item.event)}\n\n`);
        c.cursor = item.id; if (!accepted) { blocked = true; break; }
      }
      if (!blocked && batch.entries.length <= 64) c.cursor = batch.cursor;
      if (now - c.heartbeat >= 15000) {
        res.write((c.cursor ? `id: ${c.cursor}\n` : '') + ': heartbeat\n\n'); c.heartbeat = now;
      }
    }
  }
  async publish(userId, event) {
    const id = await this.store.transaction(s => appendEvent(s, userId, event, this.clock())); this.pump(); return id;
  }
  endAll() { for (const res of this.clients.keys()) res.end(); this.clients.clear(); }
  close() { clearInterval(this.timer); this.endAll(); }
}
