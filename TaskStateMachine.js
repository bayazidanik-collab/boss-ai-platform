/**
 * TaskStateMachine.js — BOSS AI Phase 2 · Autonomous Agent Core
 * Strict execution state machine for agent work items:
 *   Pending -> PolicyCheck -> Executing -> AwaitingOwnerApproval -> Completed / Failed
 *
 * - Rejects invalid state transitions with an explicit error.
 * - Logs every transition event to an append-only event log.
 * - Terminal states (Completed / Failed) accept no further transitions.
 */

export const TASK_STATES = ['Pending', 'PolicyCheck', 'Executing', 'AwaitingOwnerApproval', 'Completed', 'Failed'];

export const STATE_TRANSITIONS = {
  Pending: ['PolicyCheck'],
  PolicyCheck: ['Executing', 'Failed'],
  Executing: ['AwaitingOwnerApproval', 'Completed', 'Failed'],
  AwaitingOwnerApproval: ['Completed', 'Failed'],
  Completed: [],
  Failed: [],
};

export default class TaskStateMachine {
  /**
   * @param {{onTransition?: function(object):void}} [options]
   */
  constructor(options = {}) {
    this.onTransition = typeof options.onTransition === 'function' ? options.onTransition : null;
    this._tasks = new Map();
    this._log = []; // append-only; no update/delete API exists (Class C control)
  }

  canTransition(from, to) {
    return Array.isArray(STATE_TRANSITIONS[from]) && STATE_TRANSITIONS[from].includes(to);
  }

  /** Register a new execution task in state Pending. */
  createTask(input = {}) {
    const id = typeof input.id === 'string' && input.id.trim() ? input.id.trim() : `task-${Date.now()}-${this._tasks.size + 1}`;
    if (this._tasks.has(id)) throw new Error(`Task already exists: ${id}`);
    const record = {
      id,
      title: typeof input.title === 'string' ? input.title.trim().slice(0, 200) : '',
      owner: typeof input.owner === 'string' ? input.owner : 'agent',
      state: 'Pending',
      createdAt: new Date().toISOString(),
    };
    this._tasks.set(id, record);
    this._pushLog({ event: 'create', taskId: id, to: 'Pending' });
    return { ...record };
  }

  /**
   * Move a task to its next state.
   * @throws on unknown task or illegal transition.
   */
  transition(taskId, to) {
    const record = this._tasks.get(taskId);
    if (!record) throw new Error(`Task not found: ${taskId}`);
    if (!TASK_STATES.includes(to)) throw new Error(`Unknown state: ${to}`);
    if (!this.canTransition(record.state, to)) {
      const err = new Error(`Invalid state transition: ${record.state} -> ${to}`);
      this._pushLog({ event: 'rejected', taskId, from: record.state, to });
      throw err;
    }
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
    return tasks;
  }

  /** Append-only transition event log (immutable surface: read only). */
  getLog(taskId = null) {
    return this._log
      .filter((entry) => taskId === null || entry.taskId === taskId)
      .map((entry) => ({ ...entry }));
  }

  _pushLog(entry) {
    this._log.push({ ...entry, at: entry.at || new Date().toISOString() });
  }
}
