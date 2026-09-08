/** Explicit civil-time trading schedules. All public timestamps are UTC seconds.
 * Holiday keys and weekdays refer to the local session START date. No network,
 * inferred holidays, OS-local timezone defaults, or fixed UTC-offset arithmetic.
 */
const DAY = 86400;
const FORMATTERS = new Map();
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 3660;
function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError(`${label} must be a plain object`);
  return value;
}
function keys(value, allowed, label) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new TypeError(`Unknown ${label} field: ${key}`);
}
function integer(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(`Invalid ${label}`);
  return value;
}
function utcDate(text) {
  if (typeof text !== 'string' || !DATE_PATTERN.test(text)) throw new RangeError('Use a YYYY-MM-DD session date');
  const epoch = Date.parse(text + 'T00:00:00Z') / 1000;
  if (!Number.isFinite(epoch) || new Date(epoch * 1000).toISOString().slice(0, 10) !== text || text < '1900-01-01' || text > '2200-12-31') throw new RangeError('Invalid session date (supported years: 1900–2200)');
  return epoch;
}
export function shiftSessionDate(date, days) {
  integer(days, -MAX_DAYS, MAX_DAYS, 'date shift');
  return new Date((utcDate(date) + days * DAY) * 1000).toISOString().slice(0, 10);
}
function clock(text, end = false) {
  if (typeof text !== 'string' || !/^\d{2}:\d{2}$/.test(text)) throw new RangeError('Session times must be HH:MM');
  const [h, m] = text.split(':').map(Number);
  if (m > 59 || h > 23 && !(end && h === 24 && m === 0)) throw new RangeError('Invalid session clock time');
  return h * 60 + m;
}
function formatter(zone) {
  if (typeof zone !== 'string' || !zone || zone.length > 100) throw new RangeError('An explicit IANA timezone is required');
  if (FORMATTERS.has(zone)) return FORMATTERS.get(zone);
  const value = new Intl.DateTimeFormat('en-GB-u-ca-gregory-nu-latn', {
    timeZone: zone, calendar: 'gregory', numberingSystem: 'latn',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  });
  if (FORMATTERS.size >= 32) FORMATTERS.delete(FORMATTERS.keys().next().value);
  FORMATTERS.set(zone, value);
  return value;
}
function validTime(time) {
  if (!Number.isFinite(time) || time < -2208816000 || time > 7289481600) throw new RangeError('Timestamp outside supported calendar years');
  return time;
}
export function sessionLocalParts(time, zone) {
  validTime(time);
  const values = Object.fromEntries(formatter(zone).formatToParts(new Date(time * 1000)).filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
  const date = `${values.year}-${values.month}-${values.day}`;
  return {date, hour: Number(values.hour), minute: Number(values.minute), second: Number(values.second), weekday: new Date(utcDate(date) * 1000).getUTCDay()};
}
/** Resolve a wall-clock boundary by round-tripping possible offsets. Gaps always
 * reject; folds reject unless the caller explicitly chooses earlier or later.
 * Offset sampling is bounded around the requested civil date; never advances a
 * nonexistent local boundary to a different clock time silently.
 */
export function sessionBoundary(date, time, zone, disambiguation = 'reject') {
  if (!['reject', 'earlier', 'later'].includes(disambiguation)) throw new RangeError('Invalid DST disambiguation');
  const minute = clock(time, true), wall = utcDate(date) + minute * 60;
  const targetDate = new Date(wall * 1000).toISOString().slice(0, 10), targetMinute = minute % 1440;
  formatter(zone);
  const offsets = new Set();
  for (const hours of [-36, -24, -12, 0, 12, 24, 36]) {
    const sample = wall + hours * 3600, p = sessionLocalParts(sample, zone);
    offsets.add(utcDate(p.date) + p.hour * 3600 + p.minute * 60 + p.second - sample);
  }
  const candidates = [...offsets].map(offset => wall - offset).filter(candidate => {
    const p = sessionLocalParts(candidate, zone);
    return p.date === targetDate && p.hour * 60 + p.minute === targetMinute && p.second === 0;
  }).sort((a, b) => a - b);
  if (!candidates.length) throw new RangeError(`Nonexistent local boundary: ${date} ${time} ${zone}`);
  if (candidates.length > 1 && disambiguation === 'reject') throw new RangeError(`Ambiguous local boundary: ${date} ${time} ${zone}; choose earlier or later`);
  return disambiguation === 'later' ? candidates.at(-1) : candidates[0];
}
function segments(value, allowEmpty = false) {
  if (!Array.isArray(value) || value.length > 8 || !allowEmpty && !value.length) throw new RangeError('A schedule needs 1–8 segments; a date override may be empty');
  let first = null, previous = -1;
  return value.map(item => {
    record(item, 'Session segment'); keys(item, ['open', 'close', 'openDay', 'closeDay'], 'segment');
    const a = clock(item.open), b = clock(item.close, true);
    const openDay = integer(item.openDay ?? 0, 0, 1, 'openDay');
    const closeDay = integer(item.closeDay ?? (openDay + (b <= a ? 1 : 0)), 0, 1, 'closeDay');
    const start = openDay * 1440 + a, end = closeDay * 1440 + b;
    if (first === null) { if (openDay !== 0) throw new RangeError('First segment must open on the session date'); first = start; }
    if (start < previous || end <= start || end - first > 1440) throw new RangeError('Segments must be ordered, nonoverlapping, and span at most 24 civil hours');
    previous = end;
    return Object.freeze({open: item.open, close: item.close, openDay, closeDay});
  });
}
export function validateTradingCalendar(raw = {}) {
  record(raw, 'Trading calendar');
  keys(raw, ['version', 'name', 'timezone', 'weekdays', 'segments', 'holidays', 'overrides', 'tradeDateOffset', 'disambiguation'], 'calendar');
  if (raw.version != null && raw.version !== 1) throw new RangeError('Unsupported calendar version');
  const name = raw.name ?? 'Explicit UTC schedule';
  if (typeof name !== 'string' || !name.trim() || name.length > 120) throw new RangeError('Calendar name must contain 1–120 characters');
  const timezone = raw.timezone ?? 'UTC'; formatter(timezone);
  const weekdays = raw.weekdays ?? [0, 1, 2, 3, 4, 5, 6];
  if (!Array.isArray(weekdays) || !weekdays.length || weekdays.length > 7) throw new RangeError('Select 1–7 session-start weekdays');
  weekdays.forEach(x => integer(x, 0, 6, 'weekday'));
  const holidays = raw.holidays ?? [];
  if (!Array.isArray(holidays) || holidays.length > 4096) throw new RangeError('At most 4,096 explicit closure dates');
  holidays.forEach(utcDate);
  const overrides = raw.overrides ?? {}; record(overrides, 'Date overrides');
  if (Object.keys(overrides).length > 4096) throw new RangeError('At most 4,096 date overrides');
  const normalized = Object.create(null);
  for (const [date, schedule] of Object.entries(overrides)) {
    utcDate(date);
    if (holidays.includes(date)) throw new RangeError('A date cannot be both a holiday and an override');
    normalized[date] = Object.freeze(segments(schedule, true));
  }
  const disambiguation = raw.disambiguation ?? 'reject';
  if (!['reject', 'earlier', 'later'].includes(disambiguation)) throw new RangeError('Invalid DST disambiguation');
  return Object.freeze({version: 1, name, timezone, weekdays: Object.freeze([...new Set(weekdays)].sort()),
    segments: Object.freeze(segments(raw.segments ?? [{open: '00:00', close: '24:00'}])),
    holidays: Object.freeze([...new Set(holidays)].sort()), overrides: Object.freeze(normalized),
    tradeDateOffset: integer(raw.tradeDateOffset ?? 0, 0, 1, 'tradeDateOffset'), disambiguation});
}
export class TradingCalendar {
  #days = new Map();
  #holidays;
  #weekdays;
  constructor(spec = {}) {
    this.spec = validateTradingCalendar(spec);
    this.#holidays = new Set(this.spec.holidays); this.#weekdays = new Set(this.spec.weekdays);
    Object.defineProperty(this, 'spec', {writable: false});
  }
  session(date) {
    utcDate(date);
    if (this.#days.has(date)) return this.#days.get(date);
    const p = this.spec, explicit = Object.hasOwn(p.overrides, date);
    const source = explicit ? p.overrides[date] : this.#holidays.has(date) || !this.#weekdays.has(new Date(utcDate(date) * 1000).getUTCDay()) ? [] : p.segments;
    const windows = source.map((s, index) => {
      const open = sessionBoundary(shiftSessionDate(date, s.openDay), s.open, p.timezone, p.disambiguation);
      const close = sessionBoundary(shiftSessionDate(date, s.closeDay), s.close, p.timezone, p.disambiguation);
      if (close <= open) throw new RangeError('Session segment reverses across timezone transition');
      return Object.freeze({index, open, close});
    });
    for (let i = 1; i < windows.length; i++) if (windows[i].open < windows[i - 1].close) throw new RangeError('Session segments overlap in UTC');
    const value = windows.length ? Object.freeze({id: date, date, tradeDate: shiftSessionDate(date, p.tradeDateOffset),
      open: windows[0].open, close: windows.at(-1).close, seconds: windows.reduce((n, s) => n + s.close - s.open, 0),
      segments: Object.freeze(windows), override: explicit}) : null;
    if (this.#days.size >= 512) this.#days.delete(this.#days.keys().next().value);
    this.#days.set(date, value);
    return value;
  }
  between(start, end) {
    validTime(start); validTime(end);
    if (end < start) throw new RangeError('Reversed session range');
    if (end === start) return [];
    const first = shiftSessionDate(sessionLocalParts(start, this.spec.timezone).date, -1);
    const last = sessionLocalParts(end, this.spec.timezone).date;
    const count = Math.round((utcDate(last) - utcDate(first)) / DAY) + 1;
    if (count > MAX_DAYS) throw new RangeError(`Calendar expansion limit is ${MAX_DAYS} days`);
    const result = []; let previous = null;
    for (let i = 0; i < count; i++) {
      const window = this.session(shiftSessionDate(first, i));
      if (!window) continue;
      if (previous && window.open < previous.close) throw new RangeError('Adjacent session schedules overlap; correct the date override');
      previous = window;
      if (window.open < end && window.close > start) result.push(window);
    }
    return result;
  }
  at(time) {
    const date = sessionLocalParts(time, this.spec.timezone).date;
    const previous = this.session(shiftSessionDate(date, -1)), current = this.session(date);
    if (previous && current && previous.close > current.open) throw new RangeError('Adjacent session schedules overlap');
    for (const window of [previous, current]) if (window) for (const segment of window.segments) {
      if (time >= segment.open && time < segment.close) return {session: window, segment};
    }
    return null;
  }
  contains(time) { return this.at(time) !== null; }
  filter(bars) { return bars.filter(bar => this.contains(bar.t)); }
  bucket(time, seconds) {
    integer(seconds, 1, DAY, 'bucket seconds');
    const match = this.at(time); if (!match) return null;
    const open = match.segment.open + Math.floor((time - match.segment.open) / seconds) * seconds;
    return {session: match.session.id, segment: match.segment.index, open, close: Math.min(open + seconds, match.segment.close)};
  }
}
/** Schedule templates, NOT maintained exchange calendars. No holiday claims. */
export function tradingCalendarTemplate(id = 'utc') {
  const templates = {
    utc: {name: 'Continuous UTC · explicit schedule', timezone: 'UTC', weekdays: [0,1,2,3,4,5,6], segments: [{open:'00:00',close:'24:00'}]},
    ny: {name: 'New York core-hours template · holidays not loaded', timezone:'America/New_York', weekdays:[1,2,3,4,5], segments:[{open:'09:30',close:'16:00'}]},
    overnight: {name:'Chicago overnight example · not an exchange calendar', timezone:'America/Chicago', weekdays:[0,1,2,3,4], tradeDateOffset:1, segments:[{open:'18:00',close:'17:00'}]},
    split: {name:'Tokyo split-session example · not an exchange calendar', timezone:'Asia/Tokyo', weekdays:[1,2,3,4,5], segments:[{open:'09:00',close:'11:30'},{open:'12:30',close:'15:00'}]}
  };
  if (!Object.hasOwn(templates, id)) throw new RangeError('Unknown calendar template');
  return validateTradingCalendar(templates[id]);
}
