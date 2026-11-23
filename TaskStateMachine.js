/**
 * TaskStateMachine.js — BOSS AI Phase 2 · Autonomous Agent Core
 * Deterministic task/agent workflow state machine (spec states):
 *
 *   Inbox -> Next Action -> In Progress -> Waiting / Completed / Blocked
 *
 * - Validates allowed transitions; throws clear errors on invalid ones.
 * - Append-only transition event log (no update/delete API exists).
 * - Unknown states and unknown tasks throw clear, actionable errors.
 *
 * Security: DOM-free module (zero innerHTML / outerHTML / document.write).
 * Syntax: ES2017-safe (no ?? / ?. / Object.fromEntries / top-level await).
 */

export const TASK_STATES = ['Inbox', 'Next Action', 'In Progress', 'Waiting', 'Completed', 'Blocked'];

/** Deterministic transition map (source -> allowed destinations). */
export const STATE_TRANSITIONS = {
  'Inbox': ['Next Action', 'In Progress', 'Blocked'],
  'Next Action': ['In Progress', 'Waiting', 'Blocked', 'Inbox'],
  'In Progress': ['Waiting', 'Completed', 'Blocked', 'Next Action'],
  'Waiting': ['Next Action', 'In Progress', 'Completed', 'Blocked'],
  'Blocked': ['Inbox', 'Next Action', 'In Progress'],
  'Completed': ['Next Action', 'In Progress'],
};

export default class TaskStateMachine {
  /**
   * @param {{onTransition?: function(object):void}} [options]
   */
  constructor(options = {}) {
    this.onTransition = typeof options.onTransition === 'function' ? options.onTransition : null;
    this._tasks = new Map();
    this._log = []; // append-only; no update/delete API exists (audit integrity)
  }

  /** Non-throwing check. Same-state is a no-op (returns true). */
  canTransition(from, to) {
    if (from === to) return true;
    return Array.isArray(STATE_TRANSITIONS[from]) && STATE_TRANSITIONS[from].indexOf(to) >= 0;
  }

  /**
   * Validate a transition; throws a clear error when illegal.
   * @throws {Error} unknown state or disallowed transition
   */
  validateTransition(from, to) {
    if (TASK_STATES.indexOf(from) < 0) {
      throw new Error(`Unknown state '${String(from)}' — valid states: ${TASK_STATES.join(', ')}`);
    }
    if (TASK_STATES.indexOf(to) < 0) {
      throw new Error(`Unknown state '${String(to)}' — valid states: ${TASK_STATES.join(', ')}`);
    }
    if (from !== to && !this.canTransition(from, to)) {
      throw new Error(
        `Invalid state transition: '${from}' -> '${to}' — allowed from '${from}': ${(STATE_TRANSITIONS[from] || []).join(', ') || '(none)'}`
      );
    }
    return true;
  }

  /** Register a new task in state 'Inbox'. */
  createTask(input = {}) {
    const id = typeof input.id === 'string' && input.id.trim() ? input.id.trim() : `task-${Date.now()}-${this._tasks.size + 1}`;
    if (this._tasks.has(id)) throw new Error(`Task already exists: ${id}`);
    const record = {
      id,
      title: typeof input.title === 'string' ? input.title.trim().slice(0, 200) : '',
      owner: typeof input.owner === 'string' ? input.owner : 'agent',
      agentId: typeof input.agentId === 'string' ? input.agentId : '',
      state: 'Inbox',
      createdAt: new Date().toISOString(),
    };
    this._tasks.set(id, record);
    this._pushLog({ event: 'create', taskId: id, from: null, to: 'Inbox' });
    return { ...record };
  }

  /**
   * Move a task to its next state (same-state is a no-op).
   * @throws {Error} unknown task, unknown state, or illegal transition
   */
  transition(taskId, to) {
    const record = this._tasks.get(taskId);
    if (!record) throw new Error(`Task not found: ${taskId}`);
    this.validateTransition(record.state, to);
    if (record.state === to) return { ...record };
    const from = record.state;
    record.state = to;
    record.updatedAt = new Date().toISOString();
    const entry = { event: 'transition', taskId, from, to, at: record.updatedAt };
    this._pushLog(entry);
    if (this.onTransition) this.onTransition({ ...entry });
    return { ...record };
  }

  getState(taskId) {
    const record = this._tasks.get(taskId);
    return record ? record.state : null;
  }

  getTask(taskId) {
    const record = this._tasks.get(taskId);
    return record ? { ...record } : null;
  }

  listTasks(filter = {}) {
    let tasks = [...this._tasks.values()].map((t) => ({ ...t }));
    if (filter.state) tasks = tasks.filter((t) => t.state === filter.state);
    if (filter.agentId) tasks = tasks.filter((t) => t.agentId === filter.agentId);
    return tasks;
  }

  /** Append-only transition event log (read-only surface). */
  getLog(taskId = null) {
    return this._log
      .filter((entry) => taskId === null || entry.taskId === taskId)
      .map((entry) => ({ ...entry }));
  }

  _pushLog(entry) {
    this._log.push({ ...entry, at: entry.at || new Date().toISOString() });
  }
}
