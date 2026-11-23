/**
 * AgentRegistry.js — BOSS AI Phase 2 · Autonomous Agent Core
 * System registration + permission gate for operational agents.
 *
 * Agent definition fields (spec):
 *   id, name, role, allowedClasses, allowedTools, memoryScope, status
 *
 * - Register, list, enable/disable, inspect agent definitions.
 * - assertCanExecute() PREVENTS unregistered or disabled agents from executing
 *   any action, and enforces allowedClasses / allowedTools per call.
 * - Works standalone (in-memory) or persisted through a StorageAdapter.
 * - Every record is multi-tenant tagged (ownerId / tenantId).
 *
 * Security: DOM-free module (zero innerHTML / outerHTML / document.write).
 * Syntax: ES2017-safe (no ?? / ?. / Object.fromEntries / top-level await).
 */

import { DEFAULT_OWNER_ID, DEFAULT_TENANT_ID } from './StorageAdapter.js';

export const CLASS_VALUES = ['CLASS_A', 'CLASS_B', 'CLASS_C'];
export const STATUSES = ['enabled', 'disabled'];
/** Suggested roles (guidance only — any non-empty role string is accepted). */
export const SUGGESTED_ROLES = ['System Architect', 'Code Builder', 'Security Auditor', 'Operations Manager'];

const ID_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/i;
const TOOL_RE = /^[a-z0-9][a-z0-9._:-]{0,63}$/i;

function normClass(value) {
  const up = String(value || '').trim().toUpperCase();
  if (up.indexOf('CLASS_') === 0) return up;
  if (up === 'A' || up === 'B' || up === 'C') return 'CLASS_' + up;
  return '';
}

export default class AgentRegistry {
  /**
   * @param {import('./StorageAdapter.js').default|null} [storage]
   * @param {{ownerId?: string, tenantId?: string}} [scope]
   */
  constructor(storage = null, scope = {}) {
    this.storage = storage;
    this.collection = 'agents';
    this.ownerId = scope.ownerId || DEFAULT_OWNER_ID;
    this.tenantId = scope.tenantId || DEFAULT_TENANT_ID;
    this._memory = new Map();
  }

  _validate(input) {
    const errors = [];
    const out = {};

    if (typeof input.id !== 'string' || !ID_RE.test(input.id)) {
      errors.push('id: 2-64 chars, alphanumeric with . _ -');
    } else {
      out.id = input.id;
    }

    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name) errors.push('name: non-empty string required');
    else out.name = name.slice(0, 120);

    const role = typeof input.role === 'string' ? input.role.trim() : '';
    if (!role) errors.push('role: non-empty string required');
    else out.role = role.slice(0, 80);

    // allowedClasses — subset of CLASS_A/CLASS_B/CLASS_C
    const rawClasses = input.allowedClasses === undefined ? ['CLASS_A'] : input.allowedClasses;
    if (!Array.isArray(rawClasses) || rawClasses.length === 0) {
      errors.push('allowedClasses: non-empty array of CLASS_A/CLASS_B/CLASS_C required');
    } else {
      const classes = [];
      for (const value of rawClasses) {
        const norm = normClass(value);
        if (!norm || classes.indexOf(norm) >= 0) {
          errors.push(`allowedClasses: invalid or duplicate entry '${String(value)}'`);
        } else {
          classes.push(norm);
        }
      }
      out.allowedClasses = classes;
    }

    // allowedTools — string array (entry '*' = all tools)
    const rawTools = input.allowedTools === undefined ? [] : input.allowedTools;
    if (!Array.isArray(rawTools) || rawTools.some((v) => typeof v !== 'string' || (v.trim() !== '*' && !TOOL_RE.test(v.trim())))) {
      errors.push("allowedTools: array of tool names (or ['*']) required");
    } else {
      out.allowedTools = rawTools.map((v) => v.trim());
    }

    const scope = typeof input.memoryScope === 'string' && input.memoryScope.trim()
      ? input.memoryScope.trim().slice(0, 60) : 'workspace';
    out.memoryScope = scope;

    const status = input.status === undefined ? 'enabled' : input.status;
    if (STATUSES.indexOf(status) < 0) errors.push(`status: must be one of ${STATUSES.join(' | ')}`);
    else out.status = status;

    if (errors.length) {
      const err = new Error(`Invalid agent registration: ${errors.join('; ')}`);
      err.validationErrors = errors;
      throw err;
    }
    return out;
  }

  async _save(record) {
    const stamped = {
      ...record,
      ownerId: this.ownerId,
      tenantId: this.tenantId,
      updatedAt: new Date().toISOString(),
    };
    if (this.storage) return this.storage.put(this.collection, stamped);
    const saved = { ...stamped, createdAt: stamped.createdAt || stamped.updatedAt };
    this._memory.set(saved.id, saved);
    return { ...saved };
  }

  /** Register an agent (throws on duplicate id or invalid fields). */
  async register(input) {
    const data = this._validate(input || {});
    const existing = await this.get(data.id);
    if (existing) throw new Error(`Agent already registered: ${data.id}`);
    return this._save({ ...data, registeredAt: new Date().toISOString() });
  }

  async get(id) {
    if (this.storage) return this.storage.get(this.collection, id);
    const found = this._memory.get(id);
    return found ? { ...found } : null;
  }

  async list(filter = {}) {
    let agents = this.storage
      ? await this.storage.list(this.collection)
      : [...this._memory.values()].map((a) => ({ ...a }));
    if (filter.status) agents = agents.filter((a) => a.status === filter.status);
    if (filter.role) agents = agents.filter((a) => a.role === filter.role);
    return agents;
  }

  /** Detailed view of one registered agent. */
  async inspect(id) {
    const agent = await this.get(id);
    if (!agent) throw new Error(`Agent not found: ${id}`);
    return {
      id: agent.id,
      name: agent.name,
      role: agent.role,
      status: agent.status,
      allowedClasses: [...(agent.allowedClasses || [])],
      allowedTools: [...(agent.allowedTools || [])],
      memoryScope: agent.memoryScope,
      ownerId: agent.ownerId,
      tenantId: agent.tenantId,
      registeredAt: agent.registeredAt,
      updatedAt: agent.updatedAt,
    };
  }

  async enable(id) {
    const agent = await this.get(id);
    if (!agent) throw new Error(`Agent not found: ${id}`);
    return this._save({ ...agent, status: 'enabled' });
  }

  async disable(id) {
    const agent = await this.get(id);
    if (!agent) throw new Error(`Agent not found: ${id}`);
    return this._save({ ...agent, status: 'disabled' });
  }

  async unregister(id) {
    if (this.storage) return this.storage.delete(this.collection, id);
    return this._memory.delete(id);
  }

  /**
   * Non-throwing execution guard.
   * @returns {{ok: boolean, reason: string}}
   */
  async canExecute(agentId, actionClass, toolName) {
    const agent = await this.get(agentId);
    if (!agent) return { ok: false, reason: `Agent not registered: ${String(agentId)}` };
    if (agent.status !== 'enabled') {
      return { ok: false, reason: `Agent '${agentId}' is ${agent.status} — execution refused` };
    }
    const cls = normClass(actionClass);
    if (cls && (agent.allowedClasses || []).indexOf(cls) < 0) {
      return { ok: false, reason: `Agent '${agentId}' lacks class permission: ${cls} (allowed: ${(agent.allowedClasses || []).join(', ')})` };
    }
    if (toolName && (agent.allowedTools || []).indexOf('*') < 0 && (agent.allowedTools || []).indexOf(toolName) < 0) {
      return { ok: false, reason: `Agent '${agentId}' lacks tool permission: ${toolName} (allowed: ${(agent.allowedTools || []).join(', ') || 'none'})` };
    }
    return { ok: true, reason: `Agent '${agentId}' cleared for ${cls || 'any class'}${toolName ? ' / ' + toolName : ''}` };
  }

  /**
   * Throwing execution guard — call BEFORE any tool execution.
   * @throws {Error} unregistered, disabled, or permission-missing agent
   */
  async assertCanExecute(agentId, actionClass, toolName) {
    const verdict = await this.canExecute(agentId, actionClass, toolName);
    if (!verdict.ok) throw new Error(verdict.reason);
    return verdict;
  }
}
