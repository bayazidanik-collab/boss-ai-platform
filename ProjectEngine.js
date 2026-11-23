/**
 * ProjectEngine.js — BOSS AI Personal Productivity Hub v1.0
 * Project lifecycle, task linking, progress metrics, archive immutability.
 * DOM-free domain module over StorageAdapter + TaskEngine.
 */

export const PROJECT_STATUSES = ['Planning', 'Active', 'Paused', 'Completed', 'Archived'];

export default class ProjectEngine {
  /**
   * @param {import('./StorageAdapter.js').default} storage
   * @param {import('./TaskEngine.js').default} taskEngine
   */
  constructor(storage, taskEngine) {
    if (!storage) throw new TypeError('ProjectEngine requires a StorageAdapter');
    if (!taskEngine) throw new TypeError('ProjectEngine requires a TaskEngine');
    this.storage = storage;
    this.taskEngine = taskEngine;
    this.collection = 'projects';
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

    if (!partial || input.name !== undefined) {
      const name = typeof input.name === 'string' ? input.name.trim() : '';
      if (!name) errors.push('name: non-empty string required');
      else out.name = name.slice(0, 300);
    }
    if (input.description !== undefined) {
      if (typeof input.description !== 'string') errors.push('description: must be a string');
      else out.description = input.description.slice(0, 5000);
    } else if (!partial) {
      out.description = '';
    }
    if (input.status !== undefined) {
      if (!PROJECT_STATUSES.includes(input.status)) errors.push(`status: must be one of ${PROJECT_STATUSES.join(', ')}`);
      else out.status = input.status;
    } else if (!partial) {
      out.status = 'Planning';
    }
    if (input.tags !== undefined) {
      if (!Array.isArray(input.tags) && typeof input.tags !== 'string') errors.push('tags: must be an array or comma string');
      else out.tags = this.parseTags(input.tags);
    } else if (!partial) {
      out.tags = [];
    }

    if (errors.length) {
      const err = new Error(`Invalid project input: ${errors.join('; ')}`);
      err.validationErrors = errors;
      throw err;
    }
    return out;
  }

  _assertMutable(project) {
    if (project.status === 'Archived') {
      throw new Error(`Project is archived and immutable: ${project.id}`);
    }
  }

  /* ---------------- CRUD ---------------- */

  async createProject(input) {
    const data = this._validate(input || {});
    return this.storage.put(this.collection, data);
  }

  async getProjectById(id) {
    return this.storage.get(this.collection, id);
  }

  async updateProject(id, patch) {
    const existing = await this.getProjectById(id);
    if (!existing) throw new Error(`Project not found: ${id}`);
    this._assertMutable(existing);
    const data = this._validate({ ...existing, ...(patch || {}) });
    return this.storage.put(this.collection, { ...existing, ...data });
  }

  /** Archive is the terminal state; the last permitted mutation. */
  async archiveProject(id) {
    return this.updateProject(id, { status: 'Archived' });
  }

  async deleteProject(id) {
    const existing = await this.getProjectById(id);
    if (!existing) return false;
    this._assertMutable(existing);
    // Unlink tasks so no orphan projectId references remain.
    const linked = await this.taskEngine.listTasks({ projectId: id, includeCompleted: true });
    for (const task of linked) {
      await this.taskEngine.updateTask(task.id, { projectId: null });
    }
    return this.storage.delete(this.collection, id);
  }

  async listProjects(filter = {}) {
    let projects = await this.storage.list(this.collection);
    if (filter.status) projects = projects.filter((p) => p.status === filter.status);
    if (filter.tag) projects = projects.filter((p) => (p.tags || []).includes(filter.tag));
    if (filter.search) {
      const q = String(filter.search).toLowerCase();
      projects = projects.filter((p) =>
        String(p.name).toLowerCase().includes(q) ||
        String(p.description || '').toLowerCase().includes(q));
    }
    if (!filter.includeArchived) projects = projects.filter((p) => p.status !== 'Archived');
    // Defensive dedupe by id (preserve order) — never show the same project twice.
    const seen = new Set();
    projects = projects.filter((p) => {
      if (!p || typeof p.id !== 'string' || seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
    return projects;
  }

  /* ---------------- metrics & linking ---------------- */

  /** Task link helper — convenience wrapper over TaskEngine.updateTask. */
  async linkTask(projectId, taskId) {
    const project = await this.getProjectById(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);
    this._assertMutable(project);
    return this.taskEngine.updateTask(taskId, { projectId });
  }

  async listTasksForProject(projectId) {
    return this.taskEngine.listTasks({ projectId, includeCompleted: true });
  }

  /**
   * Percentage (0-100, integer) of linked tasks in status Completed.
   * Projects with zero linked tasks report 0.
   */
  async calculateProgress(projectId) {
    const stats = await this.getProjectStats(projectId);
    return stats.percent;
  }

  async getProjectStats(projectId) {
    const tasks = await this.listTasksForProject(projectId);
    const total = tasks.length;
    const completed = tasks.filter((t) => t.status === 'Completed').length;
    const percent = total === 0 ? 0 : Math.round((completed / total) * 100);
    return { projectId, total, completed, percent };
  }
}
