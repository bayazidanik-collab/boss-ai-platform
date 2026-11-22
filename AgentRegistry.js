/**
 * AgentRegistry.js — BOSS AI Phase 2 · Autonomous Agent Core
 * System registration engine for operational agents (System Architect,
 * Code Builder, Security Auditor, Operations Manager).
 *
 * Stores agent metadata, capabilities, allowed tools list, and context scope.
 * Works standalone (in-memory) or persisted through a StorageAdapter.
 * Every record is multi-tenant tagged (ownerId / tenantId).
 */

import { DEFAULT_OWNER_ID, DEFAULT_TENANT_ID } from './StorageAdapter.js';

export const AGENT_ROLES = ['System Architect', 'Code Builder', 'Security Auditor', 'Operations Manager'];
const ID_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/i;

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

  _strArray(value, label) {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || !v.trim())) {
      throw new TypeError(`${label}: must be an array of non-empty strings`);
    }
    return value.map((v) => v.trim());
  }

  _validate(input, { partial = false } = {}) {
    const errors = [];
    const out = {};

    if (!partial || input.id !== undefined) {
      if (typeof input.id !== 'string' || !ID_RE.test(input.id)) errors.push('id: 2-64 chars, alphanumeric with . _ -');
      else out.id = input.id;
    }
    if (!partial || input.name !== undefined) {
      const name = typeof input.name === 'string' ? input.name.trim() : '';
      if (!name) errors.push('name: non-empty string required');
      else out.name = name.slice(0, 120);
    }
    if (!partial || input.role !== undefined) {
      if (!AGENT_ROLES.includes(input.role)) errors.push(`role: must be one of ${AGENT_ROLES.join(' | ')}`);
      else out.role = input.role;
    }
    for (const [field, label] of [['capabilities', 'capabilities'], ['allowedTools', 'allowedTools'], ['contextScope', 'contextScope']]) {
      if (input[field] !== undefined) {
        out[field] = field === 'contextScope'
          ? String(input[field]).trim().slice(0, 120)
          : this._strArray(input[field], label);
      } else if (!partial) {
        out[field] = field === 'contextScope' ? 'workspace' : [];
      }
    }
    if (input.metadata !== undefined) {
      if (!input.metadata || typeof input.metadata !== 'object' || Array.isArray(input.metadata)) {
        errors.push('metadata: must be a plain object');
      } else out.metadata = { ...input.metadata };
    } else if (!partial) {
      out.metadata = {};
    }

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
      ownerId: record.ownerId || this.ownerId,
      tenantId: record.tenantId || this.tenantId,
      updatedAt: new Date().toISOString(),
    };
    if (this.storage) return this.storage.put(this.collection, stamped);
    const saved = { ...stamped, createdAt: stamped.createdAt || stamped.updatedAt };
    this._memory.set(saved.id, saved);
    return { ...saved };
  }

  /** Register an operational agent. */
  async registerAgent(input) {
    const data = this._validate(input || {});
    const existing = await this.getAgent(data.id);
    if (existing) throw new Error(`Agent already registered: ${data.id}`);
    return this._save({ ...data, registeredAt: new Date().toISOString() });
  }

  async getAgent(id) {
    if (this.storage) return this.storage.get(this.collection, id);
    const found = this._memory.get(id);
    return found ? { ...found } : null;
  }

  async listAgents(filter = {}) {
    let agents = this.storage
      ? await this.storage.list(this.collection)
      : [...this._memory.values()].map((a) => ({ ...a }));
    if (filter.role) agents = agents.filter((a) => a.role === filter.role);
    if (filter.tool) agents = agents.filter((a) => (a.allowedTools || []).includes(filter.tool));
    return agents;
  }

  async updateAgent(id, patch) {
    const existing = await this.getAgent(id);
    if (!existing) throw new Error(`Agent not found: ${id}`);
    const data = this._validate({ ...existing, ...(patch || {}), id });
    return this._save({ ...existing, ...data });
  }

  async deregisterAgent(id) {
    if (this.storage) return this.storage.delete(this.collection, id);
    return this._memory.delete(id);
  }
}
