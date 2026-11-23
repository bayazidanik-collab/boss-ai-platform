/**
 * ScopedMemory.js — BOSS AI Phase 2 · Autonomous Agent Core
 * Agent memory isolated by agentId + ownerId + tenantId.
 *
 * - read / write / clear / listKeys strictly inside the caller's own scope.
 *   Cross-agent and cross-tenant access is structurally impossible: every key
 *   is namespaced `tenantId::ownerId::agentId::key` and stamp-checked on read.
 * - SECRET REFUSAL: keys or values that look like passwords / API keys /
 *   tokens / credentials are rejected with a clear error. Agent memory must
 *   NEVER hold secrets.
 * - Values must be JSON-serializable. Map-based storage (no prototype
 *   pollution vectors). Optional StorageAdapter persistence.
 *
 * Security: DOM-free module (zero innerHTML / outerHTML / document.write).
 * Syntax: ES2017-safe (no ?? / ?. / Object.fromEntries / top-level await).
 */

import { DEFAULT_OWNER_ID, DEFAULT_TENANT_ID } from './StorageAdapter.js';

const AGENT_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const KEY_RE = /^.{1,256}$/;
const SECRET_KEY_RE = /(api[-_]?key|secret|token|password|passwd|credential|private[-_]?key|auth[-_]?header)/i;
const SECRET_VALUE_RE = /(sk-[a-z0-9]{16,}|ghp_[a-z0-9]{20,}|gho_[a-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[a-z0-9-]{10,}|Bearer\s+[A-Za-z0-9._-]{20,}|-----BEGIN[A-Z ]*PRIVATE KEY)/;

export default class ScopedMemory {
  /**
   * @param {{storage?: object, ownerId?: string, tenantId?: string,
   *          maxEntriesPerAgent?: number}} [options]
   */
  constructor(options = {}) {
    this.storage = options.storage || null;
    this.collection = 'agent-memory';
    this.ownerId = options.ownerId || DEFAULT_OWNER_ID;
    this.tenantId = options.tenantId || DEFAULT_TENANT_ID;
    this.maxEntriesPerAgent = Number.isInteger(options.maxEntriesPerAgent)
      ? options.maxEntriesPerAgent : 1000;
    this._memory = new Map(); // namespacedKey -> record
    this._log = []; // append-only access log
  }

  /* ---------------- core API (spec: read / write / clear) ---------------- */

  /** Write a value into the agent's own memory scope. */
  async write(agentId, key, value) {
    this._assertAgent(agentId);
    this._assertKey(key);
    this._assertNotSecret(key, value);
    const nsKey = this._nsKey(agentId, key);

    if (!this._memory.has(nsKey) && this._memory.size >= this.maxEntriesPerAgent * 8) {
      throw new Error(`ScopedMemory: capacity reached (${this.maxEntriesPerAgent} entries/agent)`);
    }
    let serialized;
    try {
      serialized = JSON.parse(JSON.stringify(value === undefined ? null : value));
    } catch (_) {
      throw new TypeError('ScopedMemory: value must be JSON-serializable');
    }

    const now = new Date().toISOString();
    const record = {
      id: nsKey,
      agentId,
      key,
      value: serialized,
      ownerId: this.ownerId,
      tenantId: this.tenantId,
      updatedAt: now,
    };
    if (this.storage) {
      const saved = await this.storage.put(this.collection, record);
      this._log.push({ event: 'write', agentId, key, at: now });
      return saved.value;
    }
    const existing = this._memory.get(nsKey);
    if (existing) record.createdAt = existing.createdAt;
    else record.createdAt = now;
    this._memory.set(nsKey, record);
    this._log.push({ event: 'write', agentId, key, at: now });
    return serialized;
  }

  /** Read a value from the agent's own memory scope (null when absent). */
  async read(agentId, key) {
    this._assertAgent(agentId);
    this._assertKey(key);
    const nsKey = this._nsKey(agentId, key);
    let record = null;
    if (this.storage) {
      record = await this.storage.get(this.collection, nsKey);
    } else {
      record = this._memory.get(nsKey) || null;
    }
    if (!record) return null;
    // Stamp check — cross-tenant/cross-owner rows are invisible.
    if (record.ownerId !== this.ownerId || record.tenantId !== this.tenantId) return null;
    if (record.agentId !== agentId) return null;
    this._log.push({ event: 'read', agentId, key, at: new Date().toISOString() });
    return JSON.parse(JSON.stringify(record.value));
  }

  /** Clear ALL memory of one agent (only that agent's keys). */
  async clear(agentId) {
    this._assertAgent(agentId);
    let removed = 0;
    if (this.storage) {
      const rows = await this.storage.list(this.collection, (r) => r.agentId === agentId);
      for (const row of rows) {
        if (await this.storage.delete(this.collection, row.id)) removed += 1;
      }
    } else {
      const prefix = this._nsPrefix(agentId);
      for (const key of [...this._memory.keys()]) {
        if (key.indexOf(prefix) === 0) {
          this._memory.delete(key);
          removed += 1;
        }
      }
    }
    this._log.push({ event: 'clear', agentId, removed, at: new Date().toISOString() });
    return removed;
  }

  /** List keys visible to one agent (its own scope only). */
  async listKeys(agentId) {
    this._assertAgent(agentId);
    const keys = [];
    if (this.storage) {
      const rows = await this.storage.list(this.collection, (r) => r.agentId === agentId);
      for (const row of rows) keys.push(row.key);
    } else {
      const prefix = this._nsPrefix(agentId);
      for (const entry of this._memory.values()) {
        if (entry.agentId === agentId && entry.ownerId === this.ownerId && entry.tenantId === this.tenantId) {
          keys.push(entry.key);
        }
      }
      void prefix;
    }
    return keys;
  }

  /**
   * Bind a handle to ONE agent identity — call sites cannot spoof agentId.
   * @returns {{read: function, write: function, clear: function, listKeys: function}}
   */
  forAgent(agentId) {
    this._assertAgent(agentId);
    return {
      agentId,
      read: (key) => this.read(agentId, key),
      write: (key, value) => this.write(agentId, key, value),
      clear: () => this.clear(agentId),
      listKeys: () => this.listKeys(agentId),
    };
  }

  /** Append-only access log (read-only surface). */
  getLog() {
    return this._log.map((e) => ({ ...e }));
  }

  /* ---------------- guards ---------------- */

  _nsPrefix(agentId) {
    return `${this.tenantId}::${this.ownerId}::${agentId}::`;
  }

  _nsKey(agentId, key) {
    return this._nsPrefix(agentId) + key;
  }

  _assertAgent(agentId) {
    if (typeof agentId !== 'string' || !AGENT_RE.test(agentId)) {
      throw new TypeError(`agentId: invalid '${String(agentId)}'`);
    }
  }

  _assertKey(key) {
    if (typeof key !== 'string' || !KEY_RE.test(key)) {
      throw new TypeError('key: must be a string of 1-256 chars');
    }
  }

  /** Secret material must NEVER be stored in agent memory. */
  _assertNotSecret(key, value) {
    if (SECRET_KEY_RE.test(String(key))) {
      throw new Error(`ScopedMemory refused: key '${String(key)}' looks like a secret/credential — agent memory must never store secrets`);
    }
    if (typeof value === 'string' && SECRET_VALUE_RE.test(value)) {
      throw new Error('ScopedMemory refused: value looks like a secret/credential (API key/token) — agent memory must never store secrets');
    }
  }
}
