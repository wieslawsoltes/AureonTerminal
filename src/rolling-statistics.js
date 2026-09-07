/** Window-local float64 statistics. No display prices, lookahead or gap filling.
 * A fixed-capacity pairwise moment tree avoids subtracting two large raw squares.
 * Anchors stay as original samples; means are offsets from those anchors. Updates
 * and queries have bounded O(log window) / O(1) costs, including abrupt level shifts.
 */
export function rollingPeriod(value) {
  if (!Number.isInteger(value) || value < 1 || value > 10000) throw new RangeError('Window must be an integer in [1, 10000]');
  return value;
}
const missing = size => new Float64Array(size).fill(NaN);
const finite = value => Number.isFinite(value) ? value : NaN;
export class RollingMoments {
  constructor(period) {
    this.period = rollingPeriod(period);
    this.capacity = 2 ** Math.ceil(Math.log2(period));
    this.cursor = 0; this.size = 0;
    this.count = new Uint32Array(this.capacity * 2);
    for (const key of ['anchorX', 'anchorY', 'meanX', 'meanY', 'xx', 'yy', 'xy']) this[key] = new Float64Array(this.capacity * 2);
  }
  push(x, y = x) {
    let index = this.capacity + this.cursor;
    this.cursor = (this.cursor + 1) % this.period;
    this.size = Math.min(this.period, this.size + 1);
    this.count[index] = Number.isFinite(x) && Number.isFinite(y) ? 1 : 0;
    this.anchorX[index] = x; this.anchorY[index] = y;
    this.meanX[index] = this.meanY[index] = this.xx[index] = this.yy[index] = this.xy[index] = 0;
    while ((index >>= 1) > 0) this.combine(index);
    return this;
  }
  combine(index) {
    const left = index * 2, right = left + 1, a = this.count[left], b = this.count[right];
    const n = this.count[index] = a + b;
    if (!n) return;
    if (!a || !b) {
      const child = a ? left : right;
      for (const key of ['anchorX', 'anchorY', 'meanX', 'meanY', 'xx', 'yy', 'xy']) this[key][index] = this[key][child];
      return;
    }
    const dx = (this.anchorX[right] - this.anchorX[left]) + (this.meanX[right] - this.meanX[left]);
    const dy = (this.anchorY[right] - this.anchorY[left]) + (this.meanY[right] - this.meanY[left]);
    const ratio = b / n, weight = a * ratio;
    this.anchorX[index] = this.anchorX[left]; this.anchorY[index] = this.anchorY[left];
    this.meanX[index] = this.meanX[left] + dx * ratio;
    this.meanY[index] = this.meanY[left] + dy * ratio;
    this.xx[index] = this.xx[left] + this.xx[right] + dx * dx * weight;
    this.yy[index] = this.yy[left] + this.yy[right] + dy * dy * weight;
    this.xy[index] = this.xy[left] + this.xy[right] + dx * dy * weight;
  }
  get ready() { return this.size === this.period && this.count[1] === this.period; }
  snapshot(sample = false) {
    if (typeof sample !== 'boolean') throw new TypeError('Sample correction must be boolean');
    const n = this.period, valid = this.ready, denominator = n - Number(sample);
    const x = valid ? finite(this.anchorX[1] + this.meanX[1]) : NaN;
    const y = valid ? finite(this.anchorY[1] + this.meanY[1]) : NaN;
    const varianceX = valid && denominator > 0 ? finite(this.xx[1] / denominator) : NaN;
    const varianceY = valid && denominator > 0 ? finite(this.yy[1] / denominator) : NaN;
    const covariance = valid && denominator > 0 ? finite(this.xy[1] / denominator) : NaN;
    const r = valid && this.xx[1] > 0 && this.yy[1] > 0 ? finite((this.xy[1] / Math.sqrt(this.xx[1])) / Math.sqrt(this.yy[1])) : NaN;
    return {count: valid ? n : this.count[1], ready: valid, mean: x, meanY: y, variance: varianceX, varianceY, covariance, correlation: Number.isFinite(r) ? Math.max(-1, Math.min(1, r)) : NaN};
  }
}

const height = node => node?.height || 0;
const size = node => node?.size || 0;
const renew = node => {
  node.height = 1 + Math.max(height(node.left), height(node.right));
  node.size = node.count + size(node.left) + size(node.right);
  return node;
};
function rotateRight(node) { const root = node.left; node.left = root.right; root.right = renew(node); return renew(root); }
function rotateLeft(node) { const root = node.right; node.right = root.left; root.left = renew(node); return renew(root); }
function balance(node) {
  renew(node);
  const difference = height(node.left) - height(node.right);
  if (difference > 1) {
    if (height(node.left.left) < height(node.left.right)) node.left = rotateLeft(node.left);
    return rotateRight(node);
  }
  if (difference < -1) {
    if (height(node.right.right) < height(node.right.left)) node.right = rotateRight(node.right);
    return rotateLeft(node);
  }
  return node;
}
function insert(node, value) {
  if (!node) return {value, count: 1, size: 1, height: 1, left: null, right: null};
  if (value === node.value) node.count++;
  else if (value < node.value) node.left = insert(node.left, value);
  else node.right = insert(node.right, value);
  return balance(node);
}
function erase(node, value, all = false) {
  if (value < node.value) node.left = erase(node.left, value, all);
  else if (value > node.value) node.right = erase(node.right, value, all);
  else if (node.count > 1 && !all) node.count--;
  else {
    if (!node.left) return node.right;
    if (!node.right) return node.left;
    let successor = node.right;
    while (successor.left) successor = successor.left;
    node.value = successor.value; node.count = successor.count;
    node.right = erase(node.right, successor.value, true);
  }
  return balance(node);
}
/** Deterministic AVL multiset; duplicates count towards ranks and quantiles. */
export class OrderStatisticsTree {
  constructor() { this.root = null; }
  get size() { return size(this.root); }
  add(value) {
    if (!Number.isFinite(value)) throw new TypeError('Order statistics require finite numbers');
    this.root = insert(this.root, value); return this;
  }
  count(value) {
    let node = this.root;
    while (node) { if (value === node.value) return node.count; node = value < node.value ? node.left : node.right; }
    return 0;
  }
  remove(value) {
    if (!Number.isFinite(value) || !this.count(value)) return false;
    this.root = erase(this.root, value); return true;
  }
  at(rank) {
    if (!Number.isInteger(rank) || rank < 0 || rank >= this.size) throw new RangeError('Rank outside multiset');
    let node = this.root;
    while (node) {
      const left = size(node.left);
      if (rank < left) node = node.left;
      else if (rank < left + node.count) return node.value;
      else { rank -= left + node.count; node = node.right; }
    }
    throw new Error('Order-statistic invariant failed');
  }
  lessThan(value, inclusive = false) {
    if (!Number.isFinite(value)) return NaN;
    let node = this.root, rank = 0;
    while (node) {
      if (value > node.value || inclusive && value === node.value) { rank += size(node.left) + node.count; node = node.right; }
      else node = node.left;
    }
    return rank;
  }
  quantile(q, method = 'linear') {
    if (!Number.isFinite(q) || q < 0 || q > 1) throw new RangeError('Quantile must be in [0, 1]');
    if (!['linear', 'nearest'].includes(method)) throw new TypeError('Quantile method must be linear or nearest');
    if (!this.size) return NaN;
    if (method === 'nearest') return this.at(Math.max(0, Math.ceil(q * this.size) - 1));
    const position = (this.size - 1) * q, lower = Math.floor(position), fraction = position - lower, a = this.at(lower);
    if (!fraction) return a;
    // Weighted endpoints avoid overflow in b-a for opposite-signed finite values.
    return a * (1 - fraction) + this.at(lower + 1) * fraction;
  }
}
export class RollingOrderStatistics {
  constructor(period) {
    this.period = rollingPeriod(period); this.values = missing(period);
    this.cursor = 0; this.size = 0; this.tree = new OrderStatisticsTree();
  }
  push(value) {
    const old = this.values[this.cursor];
    if (Number.isFinite(old)) this.tree.remove(old);
    this.values[this.cursor] = value;
    if (Number.isFinite(value)) this.tree.add(value);
    this.cursor = (this.cursor + 1) % this.period; this.size = Math.min(this.period, this.size + 1);
    return this;
  }
  get ready() { return this.size === this.period && this.tree.size === this.period; }
  quantile(q, method = 'linear') {
    // Validate options even during the warm-up prefix.
    const value = this.tree.quantile(q, method);
    return this.ready ? value : NaN;
  }
  rank(value, inclusive = false) { return this.ready ? 100 * this.tree.lessThan(value, inclusive) / this.period : NaN; }
}
export function rollingMoments(values, period, sample = false) {
  const window = new RollingMoments(period), mean = missing(values.length), variance = missing(values.length);
  for (let i = 0; i < values.length; i++) { const state = window.push(values[i]).snapshot(sample); mean[i] = state.mean; variance[i] = state.variance; }
  return {mean, variance};
}
export function rollingPairs(a, b, period, sample = false) {
  if (a.length !== b.length) throw new RangeError('Paired series must have equal lengths');
  const window = new RollingMoments(period), out = {};
  for (const key of ['mean', 'meanY', 'variance', 'varianceY', 'covariance', 'correlation']) out[key] = missing(a.length);
  for (let i = 0; i < a.length; i++) { const state = window.push(a[i], b[i]).snapshot(sample); for (const key of Object.keys(out)) out[key][i] = state[key]; }
  return out;
}
export function rollingQuantiles(values, period, probabilities = [.25, .5, .75], method = 'linear') {
  if (!Array.isArray(probabilities) || !probabilities.length || probabilities.length > 16) throw new RangeError('Require 1–16 quantiles');
  const window = new RollingOrderStatistics(period), outputs = probabilities.map(q => { window.quantile(q, method); return missing(values.length); });
  for (let i = 0; i < values.length; i++) { window.push(values[i]); probabilities.forEach((q, j) => { outputs[j][i] = window.quantile(q, method); }); }
  return outputs;
}
export function rollingPercentRank(values, period, previous = true) {
  const window = new RollingOrderStatistics(period), out = missing(values.length);
  for (let i = 0; i < values.length; i++) { if (!previous) window.push(values[i]); out[i] = window.rank(values[i]); if (previous) window.push(values[i]); }
  return out;
}
export function rollingRegression(values, period) {
  const window = new RollingMoments(period), out = {fit: missing(values.length), slope: missing(values.length), r2: missing(values.length), error: missing(values.length)};
  for (let i = 0; i < values.length; i++) {
    const state = window.push(i, values[i]).snapshot();
    if (!state.ready) continue;
    if (period === 1) { out.fit[i] = values[i]; out.slope[i] = 0; out.error[i] = 0; continue; }
    const slope = state.covariance / state.variance;
    const r2 = state.varianceY === 0 ? 1 : state.correlation ** 2;
    out.fit[i] = finite(state.meanY + slope * (i - state.mean));
    out.slope[i] = finite(slope); out.r2[i] = r2;
    out.error[i] = finite(Math.sqrt(Math.max(0, state.varianceY * (1 - r2))));
  }
  return out;
}
