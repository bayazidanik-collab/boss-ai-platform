/**
 * BOSS AI — WorkspaceScope.js
 * Phase 4 (Product Factory): ScopedStorage wrapper over a StorageAdapter.
 * Stamps `workspaceId` on writes and filters reads/lists/deletes by workspaceId.
 * Legacy records without a workspaceId are treated as 'ws-default' (backward
 * compatible — existing engines keep working unmodified when wrapped).
 * Storage-interface compatible: init, getMeta, put, get, delete, list,
 * clearCollection, replaceCollection, collectionSize. Zero network; data-only.
 */

const DEFAULT_WORKSPACE_ID = 'ws-default';

export default class WorkspaceScope {
  constructor(storage, workspaceId) {
    if (!storage || typeof storage.put !== 'function' || typeof storage.list !== 'function') {
      throw new TypeError('WorkspaceScope requires a StorageAdapter');
    }
    this.storage = storage;
    this.workspaceId = String(workspaceId || DEFAULT_WORKSPACE_ID);
  }

  static get DEFAULT_WORKSPACE_ID() { return DEFAULT_WORKSPACE_ID; }

  /** Effective workspaceId of any record (legacy/missing -> 'ws-default'). */
  static scopeOf(record) {
    if (record && record.workspaceId != null && String(record.workspaceId) !== '') {
      return String(record.workspaceId);
    }
    return DEFAULT_WORKSPACE_ID;
  }

  async init() {
    return this.storage.init();
  }

  async getMeta() {
    return this.storage.getMeta();
  }

  async put(collection, record) {
    const stamped = { ...(record || {}) };
    stamped.workspaceId = this.workspaceId;
    return this.storage.put(collection, stamped);
  }

  async get(collection, id) {
    const rec = await this.storage.get(collection, id);
    if (!rec) return null;
    return WorkspaceScope.scopeOf(rec) === this.workspaceId ? rec : null;
  }

  async delete(collection, id) {
    const rec = await this.storage.get(collection, id);
    if (!rec || WorkspaceScope.scopeOf(rec) !== this.workspaceId) return false;
    return this.storage.delete(collection, id);
  }

  async list(collection, filter) {
    const rows = await this.storage.list(collection, filter);
    const scoped = [];
    for (let i = 0; i < rows.length; i += 1) {
      if (WorkspaceScope.scopeOf(rows[i]) === this.workspaceId) scoped.push(rows[i]);
    }
    return scoped;
  }

  /** Clears ONLY records of this workspace. Returns removed count. */
  async clearCollection(collection) {
    const rows = await this.list(collection);
    let removed = 0;
    for (let i = 0; i < rows.length; i += 1) {
      if (await this.storage.delete(collection, rows[i].id)) removed += 1;
    }
    return removed;
  }

  /** Replaces ONLY this workspace's records in the collection. */
  async replaceCollection(collection, records) {
    await this.clearCollection(collection);
    const saved = [];
    const rows = Array.isArray(records) ? records : [];
    for (let i = 0; i < rows.length; i += 1) {
      saved.push(await this.put(collection, rows[i]));
    }
    return saved;
  }

  /** Count of records in this workspace. */
  async collectionSize(collection) {
    const rows = await this.list(collection);
    return rows.length;
  }
}
