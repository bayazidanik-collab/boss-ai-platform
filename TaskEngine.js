/**
 * TaskEngine.js — BOSS AI Personal Productivity Hub v1.0
 * Task lifecycle domain model. Pure logic over StorageAdapter; DOM-free.
 *
 * Workflow statuses: Inbox -> Next Action -> In Progress -> Waiting -> Completed,
 * plus Blocked (Phase 2 alignment with TaskStateMachine; see HUB_STATUS_MAP).
 * (transitions validated; see canTransition()).
 * Priorities: Low | Medium | High | Urgent.
 */

export const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];
export const STATUSES = ['Inbox', 'Next Action', 'In Progress', 'Waiting', 'Completed', 'Blocked'];

/**
 * Allowed status transitions (self-transitions are no-op allowed).
 * ADDITIVE Phase 2 change: 'Blocked' appended to open states + new 'Blocked'
 * key. Every pre-existing path is unchanged (existing tasks/UI unbroken).
 * Hub stays permissive on purpose (checkbox quick-complete = ANY -> Completed
 * / Completed -> Inbox); TaskStateMachine keeps the strict agent-execution map.
 */
export const STATUS_TRANSITIONS = {
  Inbox: ['Inbox', 'Next Action', 'In Progress', 'Waiting', 'Completed', 'Blocked'],
  'Next Action': ['Next Action', 'In Progress', 'Waiting', 'Completed', 'Inbox', 'Blocked'],
  'In Progress': ['In Progress', 'Waiting', 'Completed', 'Inbox', 'Blocked'],
  Waiting: ['Waiting', 'Next Action', 'In Progress', 'Completed', 'Inbox', 'Blocked'],
  Completed: ['Completed', 'Inbox', 'Next Action'],
  Blocked: ['Blocked', 'Inbox', 'Next Action', 'In Progress', 'Waiting', 'Completed'],
};

const PRIORITY_RANK = { Urgent: 0, High: 1, Medium: 2, Low: 3 };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Priority sort rank (9 = unknown). ES2017-safe: no ?? operator. */
function pRank(task) {
  const r = PRIORITY_RANK[task.priority];
  return r === undefined ? 9 : r;
}

export default class TaskEngine {
  /** @param {import('./StorageAdapter.js').default} storage */
  constructor(storage) {
    if (!storage) throw new TypeError('TaskEngine requires a StorageAdapter');
    this.storage = storage;
    this.collection = 'tasks';
  }

  /* ---------------- validation helpers ---------------- */

  parseTags(input) {
    if (Array.isArray(input)) {
      return [...new Set(input.map((t) => String(t).trim()).filter(Boolean))];
    }
    if (typeof input === 'string') {
      return [...new Set(input.split(',').map((t) => t.trim()).filter(Boolean))];
    }
    return [];
  }

  canTransition(from, to) {
    const allowed = STATUS_TRANSITIONS[from];
    return Array.isArray(allowed) && allowed.includes(to);
  }

  _validate(input, { partial = false } = {}) {
    const errors = [];
    const out = {};

    if (!partial || input.title !== undefined) {
      const title = typeof input.title === 'string' ? input.title.trim() : '';
      if (!title) errors.push('title: non-empty string required');
      else out.title = title.slice(0, 500);
    }
    if (input.description !== undefined) {
      if (typeof input.description !== 'string') errors.push('description: must be a string');
      else out.description = input.description.slice(0, 5000);
    } else if (!partial) {
      out.description = '';
    }
    if (input.priority !== undefined) {
      if (!PRIORITIES.includes(input.priority)) errors.push(`priority: must be one of ${PRIORITIES.join(', ')}`);
      else out.priority = input.priority;
    } else if (!partial) {
      out.priority = 'Medium';
    }
    if (input.status !== undefined) {
      if (!STATUSES.includes(input.status)) errors.push(`status: must be one of ${STATUSES.join(', ')}`);
      else out.status = input.status;
    } else if (!partial) {
      out.status = 'Inbox';
    }
    if (input.tags !== undefined) {
      if (!Array.isArray(input.tags) && typeof input.tags !== 'string') errors.push('tags: must be an array of strings or a comma string');
      else out.tags = this.parseTags(input.tags);
    } else if (!partial) {
      out.tags = [];
    }
    if (input.dueDate !== undefined) {
      if (input.dueDate !== null && !(typeof input.dueDate === 'string' && DATE_RE.test(input.dueDate))) {
        errors.push('dueDate: must be null or YYYY-MM-DD');
      } else {
        out.dueDate = input.dueDate;
      }
    } else if (!partial) {
      out.dueDate = null;
    }
    if (input.projectId !== undefined) {
      if (input.projectId !== null && typeof input.projectId !== 'string') errors.push('projectId: must be null or a string id');
      else out.projectId = input.projectId;
    } else if (!partial) {
      out.projectId = null;
    }

    if (errors.length) {
      const err = new Error(`Invalid task input: ${errors.join('; ')}`);
      err.validationErrors = errors;
      throw err;
    }
    return out;
  }

  /* ---------------- CRUD ---------------- */

  async createTask(input) {
    const data = this._validate(input || {});
    return this.storage.put(this.collection, data);
  }

  async getTaskById(id) {
    return this.storage.get(this.collection, id);
  }

  async updateTask(id, patch) {
    const existing = await this.getTaskById(id);
    if (!existing) throw new Error(`Task not found: ${id}`);
    if (patch && patch.status && patch.status !== existing.status && !this.canTransition(existing.status, patch.status)) {
      throw new Error(`Invalid status transition: ${existing.status} -> ${patch.status}`);
    }
    const data = this._validate({ ...existing, ...(patch || {}) });
    return this.storage.put(this.collection, { ...existing, ...data });
  }

  async deleteTask(id) {
    return this.storage.delete(this.collection, id);
  }

  /**
   * @param {object} [filter]
   * @param {string} [filter.status] @param {string} [filter.priority]
   * @param {string} [filter.tag] @param {string} [filter.projectId]
   * @param {string} [filter.search] @param {boolean} [filter.includeCompleted]
   */
  async listTasks(filter = {}) {
    let tasks = await this.storage.list(this.collection);
    if (!filter.includeCompleted) tasks = tasks.filter((t) => t.status !== 'Completed');
    if (filter.status) tasks = tasks.filter((t) => t.status === filter.status);
    if (filter.priority) tasks = tasks.filter((t) => t.priority === filter.priority);
    if (filter.tag) tasks = tasks.filter((t) => (t.tags || []).includes(filter.tag));
    if (filter.projectId) tasks = tasks.filter((t) => t.projectId === filter.projectId);
    if (filter.search) {
      const q = String(filter.search).toLowerCase();
      tasks = tasks.filter((t) =>
        String(t.title).toLowerCase().includes(q) ||
        String(t.description || '').toLowerCase().includes(q) ||
        (t.tags || []).some((tag) => String(tag).toLowerCase().includes(q)));
    }
    return tasks.sort((a, b) => pRank(a) - pRank(b));
  }

  /** Daily Focus: due today OR High/Urgent priority, excluding Completed. */
  async getDailyFocus() {
    const today = new Date().toISOString().slice(0, 10);
    const tasks = await this.storage.list(this.collection);
    return tasks
      .filter((t) => t.status !== 'Completed' && (t.dueDate === today || t.priority === 'High' || t.priority === 'Urgent'))
      .sort((a, b) => {
        const due = String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999'));
        return due !== 0 ? due : pRank(a) - pRank(b);
      });
  }

  /** Dashboard counters. */
  async countByStatus() {
    const tasks = await this.storage.list(this.collection);
    const counts = {};
    for (const s of STATUSES) counts[s] = 0;
    for (const t of tasks) {
      if (counts[t.status] !== undefined) counts[t.status] += 1;
    }
    counts.total = tasks.length;
    return counts;
  }
}
