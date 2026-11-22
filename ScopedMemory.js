/**
 * ScopedMemory.js — BOSS AI Phase 2 · Autonomous Agent Core
 * Namespace-isolated key-value memory manager.
 *
 * - Agents can only access namespaces explicitly granted to them.
 * - Every record is multi-tenant tagged (ownerId / tenantId).
 * - Values must be JSON-serializable (defense against object injection).
 * - Namespace names and keys are validated strings; no prototype pollution
 *   vectors (Map-based storage, never plain-object property access).
 */

import { DEFAULT_OWNER_ID, DEFAULT_TENANT_ID } from './StorageAdapter.js';

const NS_RE = /^[a-z][a-z0-9._-]{0,63}$/i;
const KEY_RE = /^.{1,256}$/;

export default class ScopedMemory {
  /**
   * @param {{ownerId?: string, tenantId?: string, maxEntriesPerNamespace?: number}} [options]
   */
  constructor(options = {}) {
    this.ownerId = options.ownerId || DEFAULT_OWNER_ID;
    this.tenantId = options.tenantId || DEFAULT_TENANT_ID;
    this.maxEntriesPerNamespace = Number.isInteger(options.maxEntriesPerNamespace)
      ? options.maxEntriesPerNamespace
      : 1000;
    this._grants = new Map();   // agentId -> Set(namespace)
    this._namespaces = new Map(); // namespace -> Map(key -> record)
    this._log = [];
  }

  /* ---------------- grants ---------------- */

  /** Grant an agent read/write access to one or more namespaces. */
  grant(agentId, namespaces) {
    this._assertAgent(agentId);
    const list = Array.isArray(namespaces) ? namespaces : [namespaces];
    const set = this._grants.get(agentId) || new Set();
    for (const ns of list) {
      this._assertNamespace(ns);
      set.add(ns);
      if (!this._namespaces.has(ns)) this._namespaces.set(ns, new Map());
    }
    this._grants.set(agentId, set);
    this._pushLog({ event: 'grant', agentId, namespaces: [...set] });
    return [...set];
  }

  revoke(agentId, namespace) {
    this._assertAgent(agentId);
    this._assertNamespace(namespace);
    const set = this._grants.get(agentId);
    if (set) set.delete(namespace);
    this._pushLog({ event: 'revoke', agentId, namespace });
    return true;
  }

  namespacesFor(agentId) {
    this._assertAgent(agentId);
    return [...(this._grants.get(agentId) || new Set())];
  }

  /* ---------------- core operations ---------------- */

  set(agentId, namespace, key, value) {
    this._authorize(agentId, namespace);
    this._assertKey(key);
    const bucket = this._namespaces.get(namespace);
    if (!bucket.has(key) && bucket.size >= this.maxEntriesPerNamespace) {
      throw new Error(`ScopedMemory: namespace '${namespace}' is full (${this.maxEntriesPerNamespace} entries)`);
    }
    let serialized;
    try {
      serialized = JSON.parse(JSON.stringify(value === undefined ? null : value));
    } catch (_) {
      throw new TypeError('ScopedMemory: value must be JSON-serializable');
    }
    const now = new Date().toISOString();
    const existing = bucket.get(key);
    bucket.set(key, {
      value: serialized,
      ownerId: this.ownerId,
      tenantId: this.tenantId,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
      updatedBy: agentId,
    });
    this._pushLog({ event: 'set', agentId, namespace, key });
    return serialized;
  }

  get(agentId, namespace, key) {
    this._authorize(agentId, namespace);
    this._assertKey(key);
    const record = this._namespaces.get(namespace).get(key);
    if (!record) return null;
    if (record.ownerId !== this.ownerId || record.tenantId !== this.tenantId) return null;
    return JSON.parse(JSON.stringify(record.value));
  }

  has(agentId, namespace, key) {
    this._authorize(agentId, namespace);
    this._assertKey(key);
    return this._namespaces.get(namespace).has(key);
  }

  delete(agentId, namespace, key) {
    this._authorize(agentId, namespace);
    this._assertKey(key);
    const removed = this._namespaces.get(namespace).delete(key);
    if (removed) this._pushLog({ event: 'delete', agentId, namespace, key });
    return removed;
  }

  listKeys(agentId, namespace) {
    this._authorize(agentId, namespace);
    return [...this._namespaces.get(namespace).keys()];
  }

  /** Read-only access log (append-only surface). */
  getLog() {
    return this._log.map((e) => ({ ...e }));
  }

  /* ---------------- guards ---------------- */

  _authorize(agentId, namespace) {
    this._assertAgent(agentId);
    this._assertNamespace(namespace);
    const set = this._grants.get(agentId);
    if (!set || !set.has(namespace)) {
      throw new Error(`ScopedMemory: agent '${agentId}' is not authorized for namespace '${namespace}'`);
    }
    if (!this._namespaces.has(namespace)) this._namespaces.set(namespace, new Map());
  }

  _assertAgent(agentId) {
    if (typeof agentId !== 'string' || !agentId.trim()) throw new TypeError('agentId: non-empty string required');
  }

  _assertNamespace(namespace) {
    if (typeof namespace !== 'string' || !NS_RE.test(namespace)) {
      throw new TypeError(`namespace: invalid name '${String(namespace)}'`);
    }
  }

  _assertKey(key) {
    if (typeof key !== 'string' || !KEY_RE.test(key)) throw new TypeError('key: must be a string of 1-256 chars');
  }

  _pushLog(entry) {
    this._log.push({ ...entry, at: new Date().toISOString() });
  }
}
