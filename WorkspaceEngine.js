/**
 * BOSS AI — WorkspaceEngine.js
 * Phase 4 (Product Factory): multi-product workspace lifecycle + scoped engines.
 * Workspaces are plain records in the 'workspaces' collection (global, unscoped);
 * product data lives in tasks/projects/notes stamped with `workspaceId` via
 * WorkspaceScope. scopedEngines(workspaceId) returns Task/Project/Note/Search
 * engine instances bound to a WorkspaceScope — engine internals are never mutated.
 * deleteWorkspace / resetWorkspace are CLASS_B (require ownerApproved: true).
 * Active workspace selection persists in the 'settings' collection. Zero network.
 */

import WorkspaceScope from './WorkspaceScope.js';
import TaskEngine from './TaskEngine.js';
import ProjectEngine from './ProjectEngine.js';
import NoteEngine from './NoteEngine.js';
import SearchEngine from './SearchEngine.js';

const WORKSPACE_COLLECTION = 'workspaces';
const SETTINGS_COLLECTION = 'settings';
const ACTIVE_STATE_ID = 'active-workspace';
const DATA_COLLECTIONS = ['tasks', 'projects', 'notes'];

let _seq = 0;
function newWorkspaceId() {
  _seq += 1;
  return 'ws_' + Date.now().toString(36) + '_' + _seq;
}

export default class WorkspaceEngine {
  constructor(storage, options = {}) {
    if (!storage || typeof storage.put !== 'function') {
      throw new TypeError('WorkspaceEngine requires a StorageAdapter');
    }
    this.storage = storage;
    this.activeWorkspaceId = WorkspaceScope.DEFAULT_WORKSPACE_ID;
    this._bundles = new Map();
    this._makeTask = options.taskEngineFactory || ((s) => new TaskEngine(s));
    this._makeProject = options.projectEngineFactory || ((s, t) => new ProjectEngine(s, t));
    this._makeNote = options.noteEngineFactory || ((s) => new NoteEngine(s));
    this._makeSearch = options.searchEngineFactory || ((s) => new SearchEngine(s));
  }

  async createWorkspace(input = {}) {
    const name = String(input.name || '').trim();
    if (!name) throw new TypeError('createWorkspace: name required');
    const record = await this.storage.put(WORKSPACE_COLLECTION, {
      id: newWorkspaceId(),
      name,
      description: String(input.description || ''),
      status: 'active',
      packId: input.packId == null ? null : String(input.packId),
      workflows: Array.isArray(input.workflows) ? input.workflows : [],
    });
    return record;
  }

  async getWorkspace(id) {
    return this.storage.get(WORKSPACE_COLLECTION, String(id));
  }

  async listWorkspaces() {
    return this.storage.list(WORKSPACE_COLLECTION);
  }

  /** Activate a workspace for subsequent scopedEngines() default. Persists choice. */
  async activateWorkspace(id) {
    const target = String(id);
    if (target === WorkspaceScope.DEFAULT_WORKSPACE_ID) {
      this.activeWorkspaceId = WorkspaceScope.DEFAULT_WORKSPACE_ID;
      await this.storage.put(SETTINGS_COLLECTION, { id: ACTIVE_STATE_ID, workspaceId: this.activeWorkspaceId });
      return { id: this.activeWorkspaceId, name: 'Default', description: 'Built-in default workspace', status: 'active' };
    }
    const ws = await this.getWorkspace(id);
    if (!ws) throw new Error('Unknown workspace: ' + id);
    if (ws.status === 'archived') throw new Error('Workspace is archived: ' + id);
    this.activeWorkspaceId = ws.id;
    await this.storage.put(SETTINGS_COLLECTION, { id: ACTIVE_STATE_ID, workspaceId: ws.id });
    return ws;
  }

  /** Restore the persisted active workspace (falls back to 'ws-default'). */
  async restoreActiveWorkspace() {
    const state = await this.storage.get(SETTINGS_COLLECTION, ACTIVE_STATE_ID);
    if (state && state.workspaceId) {
      const ws = await this.getWorkspace(state.workspaceId);
      if (ws && ws.status !== 'archived') {
        this.activeWorkspaceId = ws.id;
        return ws;
      }
    }
    this.activeWorkspaceId = WorkspaceScope.DEFAULT_WORKSPACE_ID;
    return null;
  }

  async archiveWorkspace(id) {
    const ws = await this.getWorkspace(id);
    if (!ws) throw new Error('Unknown workspace: ' + id);
    ws.status = 'archived';
    return this.storage.put(WORKSPACE_COLLECTION, ws);
  }

  /**
   * CLASS_B — deletes a workspace AND all of its scoped product data.
   * Requires approval.ownerApproved === true (explicit Owner action).
   */
  async deleteWorkspace(id, approval = {}) {
    if (approval.ownerApproved !== true) {
      throw new Error('deleteWorkspace is a Class B action: ownerApproved: true required');
    }
    const ws = await this.getWorkspace(id);
    if (!ws) throw new Error('Unknown workspace: ' + id);
    const scope = new WorkspaceScope(this.storage, ws.id);
    const removed = {};
    for (let i = 0; i < DATA_COLLECTIONS.length; i += 1) {
      removed[DATA_COLLECTIONS[i]] = await scope.clearCollection(DATA_COLLECTIONS[i]);
    }
    await this.storage.delete(WORKSPACE_COLLECTION, ws.id);
    if (this.activeWorkspaceId === ws.id) {
      this.activeWorkspaceId = WorkspaceScope.DEFAULT_WORKSPACE_ID;
      await this.storage.put(SETTINGS_COLLECTION, { id: ACTIVE_STATE_ID, workspaceId: this.activeWorkspaceId });
    }
    this._bundles.delete(ws.id);
    return { deleted: true, id: ws.id, removed };
  }

  /**
   * CLASS_B — clears a workspace's product data but keeps the workspace record.
   * Requires approval.ownerApproved === true.
   */
  async resetWorkspace(id, approval = {}) {
    if (approval.ownerApproved !== true) {
      throw new Error('resetWorkspace is a Class B action: ownerApproved: true required');
    }
    const ws = await this.getWorkspace(id);
    if (!ws) throw new Error('Unknown workspace: ' + id);
    const scope = new WorkspaceScope(this.storage, ws.id);
    const removed = {};
    for (let i = 0; i < DATA_COLLECTIONS.length; i += 1) {
      removed[DATA_COLLECTIONS[i]] = await scope.clearCollection(DATA_COLLECTIONS[i]);
    }
    return { reset: true, id: ws.id, removed };
  }

  /**
   * Engine bundle (Task/Project/Note/Search) bound to one workspace via
   * WorkspaceScope. Engine classes are constructed fresh — no internals mutated.
   */
  scopedEngines(workspaceId) {
    const id = String(workspaceId || this.activeWorkspaceId || WorkspaceScope.DEFAULT_WORKSPACE_ID);
    if (!this._bundles.has(id)) {
      const scope = new WorkspaceScope(this.storage, id);
      const taskEngine = this._makeTask(scope);
      const projectEngine = this._makeProject(scope, taskEngine);
      const noteEngine = this._makeNote(scope);
      const searchEngine = this._makeSearch(scope);
      this._bundles.set(id, { workspaceId: id, scope, taskEngine, projectEngine, noteEngine, searchEngine });
    }
    return this._bundles.get(id);
  }
}
