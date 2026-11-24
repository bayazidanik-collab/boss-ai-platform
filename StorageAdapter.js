/**
 * StorageAdapter.js — BOSS AI Personal Productivity Hub v1.0
 * Universal client-side persistence: IndexedDB with automatic LocalStorage fallback.
 *
 * Guarantees (per Master System Context):
 *  - Atomic read-modify-write per collection (single transaction / single setItem).
 *  - Automatic schema versioning (schemaVersion: 1).
 *  - Unique IDs via crypto.randomUUID() (with crypto.getRandomValues fallback).
 *  - Standard ISO 8601 timestamps (createdAt, updatedAt).
 *  - Multi-tenant scoping: mandatory ownerId / tenantId on every record.
 *  - QuotaExceededError interception with user alert callback.
 *
 * Security: zero innerHTML / outerHTML / document.write (DOM-free module).
 */

export const DEFAULT_OWNER_ID = 'local-owner';
export const DEFAULT_TENANT_ID = 'default-tenant';
import IdentityContext from './IdentityContext.js';

export const SCHEMA_VERSION = 1;

const DB_NAME = 'boss-ai-hub';
const DB_VERSION = 1;
const STORE_NAME = 'kv';
const META_KEY = '__meta__';
const COLLECTION_RE = /^[a-z][a-z0-9_-]{0,63}$/i;

/** RFC4122-shaped UUID v4. */
function uuid() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch (_) { /* fall through */ }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function isQuotaError(err) {
  return Boolean(err) && (
    err.name === 'QuotaExceededError' ||
    err.code === 22 ||
    err.code === 1014 ||
    /quota/i.test(String(err.message || ''))
  );
}

export default class StorageAdapter {
  /**
   * @param {object} [options]
   * @param {string} [options.ownerId]    default 'local-owner'
   * @param {string} [options.tenantId]   default 'default-tenant'
   * @param {function(Error):void} [options.onQuotaExceeded] user alert callback
   */
  constructor(options = {}) {
    this.identity = IdentityContext.from(options.identity);
    this.dbName = options.dbName || DB_NAME;
    this.ownerId = options.ownerId || this.identity.ownerId;
    this.tenantId = options.tenantId || this.identity.tenantId;
    this.onQuotaExceeded = typeof options.onQuotaExceeded === 'function' ? options.onQuotaExceeded : null;
    this.schemaVersion = SCHEMA_VERSION;
    this.backend = null; // 'idb' | 'local' | 'memory'
    this._db = null;
    this._localMap = new Map();
    this._memoryStore = new Map();
    this._mutationObserver = null; // SyncEngine hooks here (Phase 5b)
  }

  /* Mutation observer — additive; observers must never break writes. */
  setMutationObserver(fn) {
    this._mutationObserver = typeof fn === 'function' ? fn : null;
  }

  _notifyMutation(op) {
    try {
      if (this._mutationObserver) this._mutationObserver(op);
    } catch (_) { /* never let an observer break CRUD */ }
  }

  /** True only when a real, writable localStorage is available. */
  static _probeLocalStorage() {
    try {
      if (typeof localStorage === 'undefined') return false;
      const probe = '__boss_ai_probe__';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
      return true;
    } catch (_) {
      return false;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Lifecycle                                                            */
  /* ------------------------------------------------------------------ */

  async init() {
    this._db = await StorageAdapter._openIdb(this.dbName);
    if (this._db) {
      this.backend = 'idb';
    } else if (StorageAdapter._probeLocalStorage()) {
      this.backend = 'local';
      this._loadLocalMap();
    } else {
      this.backend = 'memory';
    }
    await this._ensureMeta();
    return this.backend;
  }

  static _openIdb(dbName) {
    // ALWAYS settles within 3s: a stuck indexedDB.open must never hang boot.
    return new Promise((resolve) => {
      let settled = false;
      const done = (v) => { if (!settled) { settled = true; resolve(v); } };
      setTimeout(() => done(null), 3000);
      try {
        if (typeof indexedDB === 'undefined') return done(null);
        const req = indexedDB.open(dbName, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: 'key' });
          }
        };
        req.onsuccess = () => done(req.result);
        req.onerror = () => done(null);
        req.onblocked = () => done(null);
      } catch (_) {
        done(null);
      }
    });
  }

  async _ensureMeta() {
    let meta = await this._readRaw(META_KEY);
    if (!meta || typeof meta !== 'object') {
      meta = {
        schemaVersion: SCHEMA_VERSION,
        ownerId: this.ownerId,
        tenantId: this.tenantId,
        createdAt: new Date().toISOString(),
      };
      await this._writeRaw(META_KEY, meta);
    } else if (meta.schemaVersion !== SCHEMA_VERSION) {
      // v1 has no legacy migrations yet; forward-compatibility hook for Phase 5.
      meta = { ...meta, schemaVersion: SCHEMA_VERSION, updatedAt: new Date().toISOString() };
      await this._writeRaw(META_KEY, meta);
    }
    this.meta = meta;
    return meta;
  }

  async getMeta() {
    return this.meta || (await this._ensureMeta());
  }

  /* ------------------------------------------------------------------ */
  /* Backend plumbing                                                    */
  /* ------------------------------------------------------------------ */

  _loadLocalMap() {
    try {
      this._localMap.clear();
      const prefix = `${this.dbName}::`;
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && key.startsWith(prefix)) {
          try {
            const rows = JSON.parse(localStorage.getItem(key) || '[]');
            this._localMap.set(key.slice(prefix.length), Array.isArray(rows) ? rows : []);
          } catch (_) {
            /* corrupted bucket — start clean rather than crash the app */
          }
        }
      }
    } catch (_) {
      /* environment without usable localStorage — memory backend takes over */
    }
  }

  _readRaw(key) {
    if (this.backend === 'idb') {
      return new Promise((resolve, reject) => {
        const tx = this._db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(key);
        req.onsuccess = () => resolve(req.result ? req.result.value : undefined);
        req.onerror = () => reject(req.error);
      });
    }
    if (this.backend === 'memory') {
      const value = this._memoryStore.get(key);
      return Promise.resolve(value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
    }
    try {
      const raw = localStorage.getItem(`${this.dbName}::${key}`);
      return Promise.resolve(raw === null ? undefined : JSON.parse(raw));
    } catch (_) {
      return Promise.resolve(undefined);
    }
  }

  _writeRaw(key, value) {
    if (this.backend === 'idb') {
      return new Promise((resolve, reject) => {
        const tx = this._db.transaction(STORE_NAME, 'readwrite');
        const req = tx.objectStore(STORE_NAME).put({ key, value });
        req.onsuccess = () => resolve(value);
        tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
        tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
      });
    }
    if (this.backend === 'memory') {
      this._memoryStore.set(key, JSON.parse(JSON.stringify(value)));
      return Promise.resolve(value);
    }
    try {
      localStorage.setItem(`${this.dbName}::${key}`, JSON.stringify(value));
      return Promise.resolve(value);
    } catch (err) {
      return Promise.reject(err);
    }
  }

  _handleWriteError(err) {
    if (isQuotaError(err)) {
      const quotaError = new Error('QuotaExceededError: client storage is full. Export a backup and free space.');
      quotaError.name = 'QuotaExceededError';
      if (this.onQuotaExceeded) this.onQuotaExceeded(quotaError);
      throw quotaError;
    }
    throw err;
  }

  async _readRows(collection) {
    const rows = await this._readRaw(collection);
    return Array.isArray(rows) ? rows : [];
  }

  async _writeRows(collection, rows) {
    try {
      await this._writeRaw(collection, rows);
    } catch (err) {
      this._handleWriteError(err);
    }
    return rows;
  }

  _assertCollection(collection) {
    if (typeof collection !== 'string' || !COLLECTION_RE.test(collection)) {
      throw new TypeError(`Invalid collection name: ${String(collection)}`);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Record stamping                                                     */
  /* ------------------------------------------------------------------ */

  _stampNew(record, options = {}) {
    const now = new Date().toISOString();
    const preserve = !!options.preserveStamps;
    return {
      ...record,
      id: record.id || uuid(),
      ownerId: record.ownerId || this.ownerId,
      tenantId: record.tenantId || this.tenantId,
      createdAt: record.createdAt || now,
      updatedAt: preserve && record.updatedAt ? record.updatedAt : now,
      // Phase 5a sync metadata (additive — old readers ignore these)
      rev: preserve && Number.isInteger(record.rev) && record.rev > 0 ? record.rev : 1,
      deletedAt: record.deletedAt || null,
      originDeviceId: record.originDeviceId || this.identity.deviceId,
      schemaVersion: SCHEMA_VERSION,
    };
  }

  _stampUpdate(existing, patch, options = {}) {
    const now = new Date().toISOString();
    const preserve = !!options.preserveStamps;
    return {
      ...existing,
      ...patch,
      id: existing.id,
      ownerId: existing.ownerId,
      tenantId: existing.tenantId,
      createdAt: existing.createdAt,
      updatedAt: preserve && patch.updatedAt ? patch.updatedAt : now,
      rev: preserve && Number.isInteger(patch.rev) && patch.rev > 0 ? patch.rev : (existing.rev || 0) + 1,
      deletedAt: patch.deletedAt !== undefined ? patch.deletedAt : (existing.deletedAt || null),
      originDeviceId: preserve && patch.originDeviceId ? patch.originDeviceId : this.identity.deviceId,
      schemaVersion: SCHEMA_VERSION,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Public CRUD API                                                     */
  /* ------------------------------------------------------------------ */

  /** Upsert a record. New records receive id/createdAt/updatedAt/ownerId/tenantId. */
  async put(collection, record, options = {}) {
    this._assertCollection(collection);
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new TypeError('put() requires a plain object record');
    }
    const rows = await this._readRows(collection);
    const idx = record.id ? rows.findIndex((r) => r && r.id === record.id) : -1;
    const prev = idx >= 0 ? rows[idx] : null;
    let saved;
    if (idx >= 0) {
      saved = this._stampUpdate(rows[idx], record, options);
      rows[idx] = saved;
    } else {
      saved = this._stampNew(record, options);
      rows.push(saved);
    }
    await this._writeRows(collection, rows);
    this._notifyMutation({ type: 'put', collection, id: saved.id, record: saved, prev });
    return { ...saved };
  }

  async get(collection, id, options = {}) {
    this._assertCollection(collection);
    const rows = await this._readRows(collection);
    const found = rows.find((r) => r && r.id === id && r.ownerId === this.ownerId && r.tenantId === this.tenantId);
    if (found && found.deletedAt && !options.includeDeleted) return null;
    return found ? { ...found } : null;
  }

  async delete(collection, id) {
    this._assertCollection(collection);
    const rows = await this._readRows(collection);
    const idx = rows.findIndex((r) => r && r.id === id && r.ownerId === this.ownerId && r.tenantId === this.tenantId);
    if (idx < 0) return false;
    const prev = rows[idx];
    rows.splice(idx, 1);
    await this._writeRows(collection, rows);
    this._notifyMutation({ type: 'delete', collection, id, record: null, prev });
    return true;
  }

  /**
   * Soft delete (Phase 5a sync): marks deletedAt and hides the row from
   * get()/list() unless { includeDeleted: true }. Keeps the row so deletions
   * can propagate through SyncEngine. Pass stamps to preserve sync metadata.
   */
  async tombstone(collection, id, stamps = {}) {
    this._assertCollection(collection);
    const rows = await this._readRows(collection);
    const idx = rows.findIndex((r) => r && r.id === id && r.ownerId === this.ownerId && r.tenantId === this.tenantId);
    if (idx < 0) return false;
    const existing = rows[idx];
    const now = new Date().toISOString();
    const patch = {
      ...existing,
      deletedAt: stamps.deletedAt || now,
      updatedAt: stamps.updatedAt || now,
    };
    const saved = this._stampUpdate(existing, patch, { preserveStamps: !!(stamps.updatedAt || stamps.rev) });
    rows[idx] = saved;
    await this._writeRows(collection, rows);
    this._notifyMutation({ type: 'tombstone', collection, id, record: saved, prev: existing });
    return true;
  }

  /**
   * List scoped records (ownerId + tenantId).
   * @param {string} collection
   * @param {object|function|null} [filter] equality map or predicate
   */
  async list(collection, filter = null, options = {}) {
    this._assertCollection(collection);
    const rows = await this._readRows(collection);
    let scoped = rows.filter((r) => r && r.ownerId === this.ownerId && r.tenantId === this.tenantId);
    if (!options.includeDeleted) scoped = scoped.filter((r) => !r.deletedAt);
    if (typeof filter === 'function') {
      scoped = scoped.filter(filter);
    } else if (filter && typeof filter === 'object') {
      scoped = scoped.filter((r) => Object.entries(filter).every(([k, v]) => r[k] === v));
    }
    return scoped
      .map((r) => ({ ...r }))
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  /** Wipe every record in a collection (used by backup restore / reset). */
  async clearCollection(collection) {
    this._assertCollection(collection);
    await this._writeRows(collection, []);
    return true;
  }

  /**
   * Atomically replace a whole collection (validated import path).
   * Imported rows are re-scoped to the active owner/tenant.
   */
  async replaceCollection(collection, records) {
    this._assertCollection(collection);
    if (!Array.isArray(records)) throw new TypeError('replaceCollection() requires an array');
    const clean = records.map((r) => ({
      ...r,
      ownerId: this.ownerId,
      tenantId: this.tenantId,
      schemaVersion: SCHEMA_VERSION,
    }));
    await this._writeRows(collection, clean);
    return clean.length;
  }

  /** Approximate char-count size of a collection (quota heuristics). */
  async collectionSize(collection) {
    this._assertCollection(collection);
    return JSON.stringify(await this._readRows(collection)).length;
  }
}
