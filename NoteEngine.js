/**
 * NoteEngine.js — BOSS AI Personal Productivity Hub v1.0
 * Notes with pinning, tags, and bi-directional project/task cross-linking.
 * DOM-free domain module over StorageAdapter.
 */

export default class NoteEngine {
  /** @param {import('./StorageAdapter.js').default} storage */
  constructor(storage) {
    if (!storage) throw new TypeError('NoteEngine requires a StorageAdapter');
    this.storage = storage;
    this.collection = 'notes';
  }

  /* ---------------- validation helpers ---------------- */

  parseTags(input) {
    if (Array.isArray(input)) return [...new Set(input.map((t) => String(t).trim()).filter(Boolean))];
    if (typeof input === 'string') return [...new Set(input.split(',').map((t) => t.trim()).filter(Boolean))];
    return [];
  }

  _validate(input, { partial = false } = {}) {
    const errors = [];
    const out = {};

    if (input.title !== undefined) {
      if (typeof input.title !== 'string') errors.push('title: must be a string');
      else out.title = input.title.trim().slice(0, 300);
    } else if (!partial) {
      out.title = '';
    }
    if (input.content !== undefined) {
      if (typeof input.content !== 'string') errors.push('content: must be a string');
      else out.content = input.content.slice(0, 20000);
    } else if (!partial) {
      out.content = '';
    }
    if (input.tags !== undefined) {
      if (!Array.isArray(input.tags) && typeof input.tags !== 'string') errors.push('tags: must be an array or comma string');
      else out.tags = this.parseTags(input.tags);
    } else if (!partial) {
      out.tags = [];
    }
    if (input.isPinned !== undefined) {
      if (typeof input.isPinned !== 'boolean') errors.push('isPinned: must be a boolean');
      else out.isPinned = input.isPinned;
    } else if (!partial) {
      out.isPinned = false;
    }
    if (input.projectId !== undefined) {
      if (input.projectId !== null && typeof input.projectId !== 'string') errors.push('projectId: must be null or a string id');
      else out.projectId = input.projectId;
    } else if (!partial) {
      out.projectId = null;
    }
    if (input.taskId !== undefined) {
      if (input.taskId !== null && typeof input.taskId !== 'string') errors.push('taskId: must be null or a string id');
      else out.taskId = input.taskId;
    } else if (!partial) {
      out.taskId = null;
    }

    const title = out.title !== undefined ? out.title : (input && input.title) || '';
    const content = out.content !== undefined ? out.content : (input && input.content) || '';
    if (!partial && !String(title).trim() && !String(content).trim()) {
      errors.push('note: requires a non-empty title or content body');
    }

    if (errors.length) {
      const err = new Error(`Invalid note input: ${errors.join('; ')}`);
      err.validationErrors = errors;
      throw err;
    }
    return out;
  }

  /* ---------------- CRUD ---------------- */

  async createNote(input) {
    const data = this._validate(input || {});
    return this.storage.put(this.collection, data);
  }

  async getNoteById(id) {
    return this.storage.get(this.collection, id);
  }

  async updateNote(id, patch) {
    const existing = await this.getNoteById(id);
    if (!existing) throw new Error(`Note not found: ${id}`);
    const data = this._validate({ ...existing, ...(patch || {}) });
    return this.storage.put(this.collection, { ...existing, ...data });
  }

  async deleteNote(id) {
    return this.storage.delete(this.collection, id);
  }

  async togglePin(id) {
    const existing = await this.getNoteById(id);
    if (!existing) throw new Error(`Note not found: ${id}`);
    return this.updateNote(id, { isPinned: !existing.isPinned });
  }

  /**
   * @param {object} [filter]
   * @param {string} [filter.tag] @param {string} [filter.projectId]
   * @param {string} [filter.taskId] @param {string} [filter.search]
   * @param {boolean} [filter.pinnedFirst] default true
   */
  async listNotes(filter = {}) {
    let notes = await this.storage.list(this.collection);
    if (filter.tag) notes = notes.filter((n) => (n.tags || []).includes(filter.tag));
    if (filter.projectId) notes = notes.filter((n) => n.projectId === filter.projectId);
    if (filter.taskId) notes = notes.filter((n) => n.taskId === filter.taskId);
    if (filter.search) {
      const q = String(filter.search).toLowerCase();
      notes = notes.filter((n) =>
        String(n.title).toLowerCase().includes(q) ||
        String(n.content || '').toLowerCase().includes(q) ||
        (n.tags || []).some((tag) => String(tag).toLowerCase().includes(q)));
    }
    const pinnedFirst = filter.pinnedFirst !== false;
    return notes.sort((a, b) => {
      if (pinnedFirst && Boolean(a.isPinned) !== Boolean(b.isPinned)) return a.isPinned ? -1 : 1;
      return String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt));
    });
  }
}
