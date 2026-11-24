/**
 * SyncEngine.js — BOSS AI Phase 5b (flat-root module)
 * Local file-based sync: outbox/inbox payloads + deterministic last-write-wins
 * merge + auditable outbox history. ZERO network calls — files move by hand.
 *
 * - Outbox: every StorageAdapter mutation is observed and appended as an op
 *   (put/delete/tombstone) with prev snapshot for local undo.
 * - exportOutbox()/importInbox(): exchange ops between devices (merge).
 * - exportState()/mergeState(): full-state exchange for peer bootstrap (merge).
 * - LWW rule (symmetric, deterministic on both sides):
 *   winner = max by (updatedAt, rev, stable-json of the record).
 *
 * DOM-free domain module (file download triggers are orchestrated by app.js).
 */

import IdentityContext from './IdentityContext.js';

export const SYNC_APP_ID = 'boss-ai-sync';
export const SYNC_SCHEMA_VERSION = 2;
export const DEFAULT_MAX_OPS = 500;
const OUTBOX_COLLECTION = 'settings';
const OUTBOX_RECORD_ID = 'sync-outbox';

/** JSON.stringify with recursively sorted keys — stable tie-break basis. */
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) || 'null';
  if (Array.isArray(value)) return '[' + value.map((v) => stableStringify(v)).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

/** Rank tuple for LWW comparison. Returns negative/zero/positive like sort. */
function compareRank(a, b) {
  const at = String((a && a.updatedAt) || '');
  const bt = String((b && b.updatedAt) || '');
  if (at !== bt) return at < bt ? -1 : 1;
  const ar = (a && Number.isInteger(a.rev)) ? a.rev : 0;
  const br = (b && Number.isInteger(b.rev)) ? b.rev : 0;
  if (ar !== br) return ar < br ? -1 : 1;
  const as = stableStringify(a || null);
  const bs = stableStringify(b || null);
  if (as === bs) return 0;
  return as < bs ? -1 : 1;
}

export default class SyncEngine {
  /**
   * @param {import('./StorageAdapter.js').default} storage
   * @param {{identity?: object, maxOps?: number}} [options]
   */
  constructor(storage, options = {}) {
    if (!storage) throw new TypeError('SyncEngine requires a StorageAdapter');
    this.storage = storage;
    this.identity = IdentityContext.from(options.identity || storage.identity);
    this.maxOps = Number.isInteger(options.maxOps) && options.maxOps > 0 ? options.maxOps : DEFAULT_MAX_OPS;
    this._ops = null; // lazy-loaded
    this._buffer = []; // ops recorded before the persisted log finished loading
    this._loading = null;
    this._persisting = false; // re-entrancy guard (outbox writes must not self-record)
    this.storage.setMutationObserver((op) => this._onMutation(op));
  }

  /* ------------------------------------------------------------------ */
  /* Outbox (op log with prev snapshots)                                 */
  /* ------------------------------------------------------------------ */

  _onMutation(op) {
    if (!op || this._persisting) return;
    const entry = {
      opId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      type: op.type,
      collection: op.collection,
      id: op.id,
      rev: op.record ? op.record.rev : undefined,
      at: new Date().toISOString(),
      originDeviceId: this.identity.deviceId,
      record: op.record ? { ...op.record } : null,
      prev: op.prev ? { ...op.prev } : null,
    };
    if (this._ops) {
      this._ops.push(entry);
      if (this._ops.length > this.maxOps) this._ops = this._ops.slice(-this.maxOps);
    } else {
      this._buffer.push(entry);
    }
    this._schedulePersist();
  }

  _schedulePersist() {
    if (this._persistTimer) return;
    this._persistTimer = setTimeout(() => {
      this._persistTimer = null;
      this.flushOutbox().catch(() => { /* never break UI on history persist */ });
    }, 50);
  }

  async _loadOutbox() {
    if (this._ops) return;
    if (!this._loading) {
      this._loading = (async () => {
        let persisted = [];
        try {
          const row = await this.storage.get(OUTBOX_COLLECTION, OUTBOX_RECORD_ID, { includeDeleted: true });
          persisted = row && Array.isArray(row.ops) ? row.ops : [];
        } catch (_) {
          persisted = [];
        }
        this._ops = persisted.concat(this._buffer).slice(-this.maxOps);
        this._buffer = [];
      })();
    }
    await this._loading;
  }

  /** Persist the in-memory op log to storage (explicit; also used by tests). */
  async flushOutbox() {
    await this._loadOutbox();
    this._persisting = true;
    try {
      await this.storage.put(OUTBOX_COLLECTION, { id: OUTBOX_RECORD_ID, ops: this._ops.slice(-this.maxOps) });
    } finally {
      this._persisting = false;
    }
    return this._ops.length;
  }

  /** Auditable copy of the local op history (for review / undo). */
  async auditHistory() {
    await this._loadOutbox();
    return this._ops.map((op) => ({ ...op }));
  }

  /** Undo one recorded op locally using its prev snapshot. */
  async undoOp(opId) {
    await this._loadOutbox();
    const op = this._ops.find((o) => o && o.opId === opId);
    if (!op) return { ok: false, reason: 'op not found' };
    try {
      if (op.prev) {
        await this.storage.put(op.collection, op.prev, { preserveStamps: true });
      } else if (op.type === 'put') {
        await this.storage.delete(op.collection, op.id);
      } else {
        return { ok: false, reason: 'nothing to restore' };
      }
      return { ok: true, restored: { collection: op.collection, id: op.id } };
    } catch (err) {
      return { ok: false, reason: err && err.message ? err.message : 'undo failed' };
    }
  }

  /** Clear the local outbox history (local, non-destructive to records). */
  async clearOutbox() {
    this._ops = [];
    await this.flushOutbox();
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Export payloads (files — hand-carried, zero network)                */
  /* ------------------------------------------------------------------ */

  _meta(kind, count) {
    return {
      app: SYNC_APP_ID,
      kind,
      schemaVersion: SYNC_SCHEMA_VERSION,
      deviceId: this.identity.deviceId,
      exportedAt: new Date().toISOString(),
      count: typeof count === 'number' ? count : undefined,
    };
  }

  /** Outbox payload JSON string: recorded ops since the beginning. */
  async exportOutbox() {
    await this._loadOutbox();
    await this.flushOutbox();
    return JSON.stringify({ meta: this._meta('outbox', this._ops.length), ops: this._ops.slice(-this.maxOps) }, null, 2);
  }

  /** Full-state payload JSON string (all records incl. tombstones). */
  async exportState() {
    const collections = {};
    const names = await this._knownCollections();
    for (const name of names) {
      collections[name] = await this.storage.list(name, null, { includeDeleted: true });
    }
    return JSON.stringify({ meta: this._meta('state'), data: collections }, null, 2);
  }

  async _knownCollections() {
    // Mirrors BackupEngine.BACKUP_COLLECTIONS without importing it (no dep cycle).
    return ['tasks', 'projects', 'notes', 'settings', 'workspaces'];
  }

  /* ------------------------------------------------------------------ */
  /* Import / merge (deterministic LWW)                                  */
  /* ------------------------------------------------------------------ */

  /** Dispatch import by payload kind: 'outbox' → inbox merge, 'state' → state merge. */
  async importPayload(jsonString) {
    let parsed;
    try {
      parsed = JSON.parse(String(jsonString));
    } catch (_) {
      return { ok: false, merged: 0, kept: 0, errors: ['payload: not valid JSON'] };
    }
    const errors = this._validate(parsed);
    if (errors.length) return { ok: false, merged: 0, kept: 0, errors };
    if (parsed.meta.kind === 'outbox') return this._mergeOps(parsed.ops || []);
    return this._mergeState(parsed.data || {});
  }

  /** Inbox: merge an exported outbox payload. */
  async importInbox(jsonString) {
    const result = await this.importPayload(jsonString);
    return result;
  }

  /** Merge a full-state payload. */
  async mergeState(jsonString) {
    const result = await this.importPayload(jsonString);
    return result;
  }

  _validate(parsed) {
    const errors = [];
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      errors.push('payload: root must be a JSON object');
      return errors;
    }
    const meta = parsed.meta;
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
      errors.push('meta: missing or not an object');
    } else {
      if (meta.app !== SYNC_APP_ID) errors.push(`meta.app: must be '${SYNC_APP_ID}'`);
      if (meta.kind !== 'outbox' && meta.kind !== 'state') errors.push("meta.kind: must be 'outbox' or 'state'");
      if (!Number.isInteger(meta.schemaVersion) || meta.schemaVersion < 1) {
        errors.push('meta.schemaVersion: positive integer required');
      } else if (meta.schemaVersion > SYNC_SCHEMA_VERSION) {
        errors.push(`meta.schemaVersion: payload ${meta.schemaVersion} is newer than runtime ${SYNC_SCHEMA_VERSION} — refusing to merge`);
      }
      if (typeof meta.exportedAt !== 'string' || Number.isNaN(Date.parse(meta.exportedAt))) {
        errors.push('meta.exportedAt: ISO 8601 date string required');
      }
    }
    if (meta && meta.kind === 'outbox' && !Array.isArray(parsed.ops)) errors.push('ops: must be an array');
    if (meta && meta.kind === 'state') {
      const data = parsed.data;
      if (!data || typeof data !== 'object' || Array.isArray(data)) errors.push('data: missing or not an object');
    }
    return errors;
  }

  async _mergeOps(ops) {
    let merged = 0;
    let kept = 0;
    for (const op of ops) {
      if (!op || typeof op !== 'object' || typeof op.id !== 'string' || typeof op.collection !== 'string') continue;
      const candidate = this._candidateFromOp(op);
      if (!candidate) continue;
      const result = await this.applyLWW(op.collection, candidate);
      if (result.applied) merged += 1; else kept += 1;
    }
    return { ok: true, merged, kept, errors: [] };
  }

  async _mergeState(data) {
    let merged = 0;
    let kept = 0;
    for (const [collection, rows] of Object.entries(data)) {
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        if (!row || typeof row !== 'object' || typeof row.id !== 'string') continue;
        const result = await this.applyLWW(collection, row);
        if (result.applied) merged += 1; else kept += 1;
      }
    }
    return { ok: true, merged, kept, errors: [] };
  }

  _candidateFromOp(op) {
    if (op.type === 'put' && op.record && typeof op.record === 'object') return { ...op.record };
    if (op.type === 'delete' || op.type === 'tombstone') {
      return {
        id: op.id,
        tombstoneOnly: true,
        deletedAt: typeof op.at === 'string' ? op.at : new Date().toISOString(),
        updatedAt: typeof op.at === 'string' ? op.at : new Date().toISOString(),
        rev: Number.isInteger(op.rev) ? op.rev : 1,
        originDeviceId: op.originDeviceId || 'remote',
      };
    }
    return null;
  }

  /**
   * Deterministic last-write-wins merge of one record.
   * @returns {Promise<{winner: 'incoming'|'existing', applied: boolean}>}
   */
  async applyLWW(collection, incoming) {
    if (!incoming || typeof incoming !== 'object' || typeof incoming.id !== 'string' || !incoming.id.trim()) {
      return { winner: 'invalid', applied: false };
    }
    const existing = await this.storage.get(collection, incoming.id, { includeDeleted: true });
    if (!existing) {
      await this._writeMerged(collection, incoming, null);
      return { winner: 'incoming', applied: true };
    }
    if (compareRank(existing, incoming) < 0) {
      await this._writeMerged(collection, incoming, existing);
      return { winner: 'incoming', applied: true };
    }
    return { winner: 'existing', applied: false };
  }

  async _writeMerged(collection, incoming, existing) {
    if (incoming.tombstoneOnly && existing) {
      await this.storage.tombstone(collection, incoming.id, {
        deletedAt: incoming.deletedAt,
        updatedAt: incoming.updatedAt,
        rev: incoming.rev,
      });
      return;
    }
    if (incoming.tombstoneOnly && !existing) {
      await this.storage.put(collection, { ...incoming }, { preserveStamps: true });
      return;
    }
    await this.storage.put(collection, { ...incoming }, { preserveStamps: true });
  }
}
