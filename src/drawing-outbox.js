import {DrawingDocument} from './drawing-crdt.js';
/** IndexedDB operations, not last-writer-wins snapshots. Acknowledging a batch
 * cannot erase another tab's later edits. Promise resolution means transaction
 * completion, not merely request success. Browser eviction remains possible.
 */
export function operationId(op) { return op.actor + ':' + op.clock; }
export function stableJSON(value) {
  if (Array.isArray(value)) return '[' + value.map(stableJSON).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stableJSON(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export class DrawingOutbox {
  constructor({factory = globalThis.indexedDB, name = 'aureon-drawing-outbox'} = {}) { this.factory = factory; this.name = name; }
  async open() {
    if (this.db) return this.db;
    if (this.opening) return this.opening;
    if (!this.factory) throw new Error('Persistent drawing recovery requires IndexedDB');
    this.opening = new Promise((resolve, reject) => {
      const request = this.factory.open(this.name, 1); let failed = false;
      request.onupgradeneeded = () => request.result.createObjectStore('operations', {keyPath: 'key'}).createIndex('scope', 'scope');
      request.onerror = () => { failed = true; reject(request.error); };
      request.onblocked = () => { failed = true; reject(new Error('Drawing storage is blocked by another application tab')); };
      request.onsuccess = () => {
        if (failed) { request.result.close(); return; }
        this.db = request.result;
        this.db.onversionchange = () => this.close(); resolve(this.db);
      };
    });
    try { return await this.opening; } finally { this.opening = null; }
  }
  async transaction(scope, mode, action) {
    if (typeof scope !== 'string' || !scope.length || scope.length > 500) throw new Error('Invalid outbox scope');
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('operations', mode, {durability: 'strict'}), store = tx.objectStore('operations');
      let result, failure;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(failure || tx.error || new Error('Drawing storage transaction aborted'));
      const read = store.index('scope').getAll(scope);
      read.onsuccess = () => {
        try { result = action(store, read.result); } catch (error) { failure = error; tx.abort(); }
      };
    });
  }
  read(scope) { return this.transaction(scope, 'readonly', (_, rows) => new DrawingDocument({version: 1, operations: rows.map(r => r.operation)}).snapshot().operations); }
  put(scope, operations) {
    const normalized = new DrawingDocument({version: 1, operations}).snapshot().operations;
    return this.transaction(scope, 'readwrite', (store, rows) => {
      const document = new DrawingDocument({version: 1, operations: rows.map(r => r.operation)});
      document.merge(normalized); // capacity and immutable-identity checks before any write
      for (const op of normalized) store.put({key: scope + '\0' + operationId(op), scope, operation: op});
      return document.ops.size;
    });
  }
  acknowledge(scope, operations) {
    const expected = new Map(operations.map(op => [operationId(op), stableJSON(op)]));
    return this.transaction(scope, 'readwrite', (store, rows) => {
      let removed = 0;
      for (const row of rows) if (expected.get(operationId(row.operation)) === stableJSON(row.operation)) { store.delete(row.key); removed++; }
      return removed;
    });
  }
  close() { this.db?.close(); this.db = null; }
}
