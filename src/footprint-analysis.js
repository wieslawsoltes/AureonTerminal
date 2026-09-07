/** Explicit observed-volume definitions; no inferred tape or signals.
 * Diagonal buy compares sell at the immediately lower observed price tick;
 * diagonal sell compares buy at the immediately higher observed price tick.
 * Missing adjacent rows are unknown, not zero. POC ties select the lower row.
 */
export function footprintSettings(options = {}) {
  const settings = {imbalanceRatio: options.imbalanceRatio ?? 3, imbalanceMin: options.imbalanceMin ?? 1, imbalanceStack: options.imbalanceStack ?? 3, valueArea: options.valueArea ?? .7, imbalanceMode: options.imbalanceMode ?? 'diagonal'};
  if (!Number.isFinite(settings.imbalanceRatio) || settings.imbalanceRatio < 1 || settings.imbalanceRatio > 1000 || !Number.isFinite(settings.imbalanceMin) || settings.imbalanceMin < 0 || !Number.isInteger(settings.imbalanceStack) || settings.imbalanceStack < 1 || settings.imbalanceStack > 100 || !Number.isFinite(settings.valueArea) || settings.valueArea <= 0 || settings.valueArea > 1 || !['diagonal','same'].includes(settings.imbalanceMode)) throw new Error('Invalid footprint analysis settings');
  return settings;
}
export function analyzeFootprint(profile, tickSize, options = {}) {
  const settings = footprintSettings(options);
  if (!Number.isFinite(tickSize) || tickSize <= 0 || !Array.isArray(profile?.levels) || profile.levels.length > 50000) throw new Error('Invalid footprint profile');
  const rows = profile.levels.map(row => {
    if (![row.price,row.buy,row.sell,row.unknown].every(Number.isFinite) || row.price <= 0 || Math.min(row.buy,row.sell,row.unknown) < 0) throw new Error('Invalid observed footprint volume');
    const tick = Math.round(row.price / tickSize);
    if (!Number.isSafeInteger(tick)) throw new Error('Footprint price exceeds exact tick domain');
    return {...row, tick, total: row.buy + row.sell + row.unknown, buyImbalance: false, sellImbalance: false, stackedBuy: false, stackedSell: false, inValueArea: false};
  }).sort((a,b) => a.tick - b.tick);
  const lookup = new Map(rows.map(row => [row.tick,row]));
  if (lookup.size !== rows.length) throw new Error('Duplicate footprint price row');
  const qualifies = (volume, opposite) => opposite !== undefined && volume > 0 && volume >= settings.imbalanceMin && volume >= opposite * settings.imbalanceRatio;
  for (const row of rows) {
    const buyAgainst = settings.imbalanceMode === 'same' ? row.sell : lookup.get(row.tick - 1)?.sell;
    const sellAgainst = settings.imbalanceMode === 'same' ? row.buy : lookup.get(row.tick + 1)?.buy;
    row.buyImbalance = qualifies(row.buy,buyAgainst); row.sellImbalance = qualifies(row.sell,sellAgainst);
  }
  const stacks = [];
  for (const side of ['Buy','Sell']) {
    let run = [];
    const flush = () => { if (run.length >= settings.imbalanceStack) { run.forEach(r => r['stacked'+side] = true); stacks.push({side: side.toLowerCase(), low: run[0].price, high: run.at(-1).price, rows: run.length}); } run = []; };
    for (const row of rows) { if (!row[side.toLowerCase()+'Imbalance'] || run.length && row.tick !== run.at(-1).tick + 1) flush(); if (row[side.toLowerCase()+'Imbalance']) run.push(row); } flush();
  }
  const total = rows.reduce((sum,row) => sum + row.total,0);
  if (!Number.isFinite(total)) throw new Error('Footprint volume overflow');
  let poc = rows.length ? 0 : -1;
  for (let i=1;i<rows.length;i++) if (rows[i].total > rows[poc].total) poc = i;
  let low = poc, high = poc, areaVolume = poc < 0 ? 0 : rows[poc].total;
  while (areaVolume < total * settings.valueArea && (low > 0 || high < rows.length - 1)) {
    // Grow a contiguous interval of observed rows; ties expand downward first.
    if (low > 0 && (high === rows.length - 1 || rows[low-1].total >= rows[high+1].total)) areaVolume += rows[--low].total;
    else areaVolume += rows[++high].total;
  }
  if (total > 0) for (let i=low;i<=high;i++) rows[i].inValueArea = true;
  return {...profile, levels: rows, total, poc: total ? rows[poc].price : null, stacks, valueAreaLow: total ? rows[low].price : null, valueAreaHigh: total ? rows[high].price : null, valueAreaVolume: areaVolume, settings};
}
