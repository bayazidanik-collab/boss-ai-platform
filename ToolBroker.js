/**
 * ToolBroker.js — BOSS AI Phase 2 · Autonomous Agent Core
 * Single execution gateway between agents and tools/storage.
 *
 * - EVERY execution path calls PolicyEvaluator.evaluate(...) AND
 *   AgentRegistry permission checks BEFORE any tool handler runs.
 * - CLASS_C actions are refused immediately (denied).
 * - CLASS_B actions without explicit owner approval are blocked immediately.
 * - All attempts (ok / blocked / denied / error) land in an APPEND-ONLY audit
 *   log. No update/delete API exists — audit tampering is structurally
 *   impossible (a Class C violation by design).
 *
 * execute() returns structured results (never throws for policy outcomes):
 *   { status: 'ok' | 'blocked' | 'denied' | 'error', result?, reason?, policy, audit }
 *
 * Security: DOM-free module (zero innerHTML / outerHTML / document.write).
 * Syntax: ES2017-safe (no ?? / ?. / Object.fromEntries / top-level await).
 */

import PolicyEvaluator from './PolicyEvaluator.js';
import AgentRegistry from './AgentRegistry.js';

export const EXECUTION_STATUS = { OK: 'ok', BLOCKED: 'blocked', DENIED: 'denied', ERROR: 'error' };

export default class ToolBroker {
  /**
   * @param {{policyEvaluator?: PolicyEvaluator, registry?: AgentRegistry,
   *          memory?: object, ownerId?: string, tenantId?: string}} [options]
   */
  constructor(options = {}) {
    this.policy = options.policyEvaluator instanceof PolicyEvaluator
      ? options.policyEvaluator
      : new PolicyEvaluator({ ownerId: options.ownerId, tenantId: options.tenantId });
    this.registry = options.registry instanceof AgentRegistry
      ? options.registry
      : new AgentRegistry(null, { ownerId: options.ownerId, tenantId: options.tenantId });
    this.memory = options.memory || null;
    this._tools = new Map();
    this._auditLog = []; // append-only
  }

  /**
   * @param {string} name unique tool name
   * @param {{handler: function(*, *):*, action?: string, description?: string,
   *          effects?: object}} spec
   *   effects: static action flags merged into the policy request
   *   (e.g. { destructive: true }, { externalNetwork: true }).
   */
  registerTool(name, spec) {
    if (typeof name !== 'string' || !name.trim()) throw new TypeError('registerTool: name required');
    if (!spec || typeof spec.handler !== 'function') throw new TypeError(`registerTool(${name}): handler function required`);
    if (this._tools.has(name)) throw new Error(`Tool already registered: ${name}`);
    this._tools.set(name, {
      name,
      handler: spec.handler,
      action: typeof spec.action === 'string' && spec.action.trim() ? spec.action.trim() : name,
      description: String(spec.description || ''),
      effects: spec.effects && typeof spec.effects === 'object' ? { ...spec.effects } : {},
    });
    this._appendAudit({ event: 'register_tool', tool: name, action: this._tools.get(name).action });
    return { name, action: this._tools.get(name).action };
  }

  listTools() {
    return [...this._tools.values()].map((t) => ({ name: t.name, action: t.action, description: t.description }));
  }

  /**
   * Policy-gated + registry-gated tool execution.
   * @param {string} agentId  the calling agent (must be registered + enabled)
   * @param {string} toolName
   * @param {*} payload
   * @param {{ownerApproved?: boolean|{approved: boolean, approvedBy?: string},
   *          effects?: object}} [context]
   * @returns {Promise<{status: string, result?: *, reason?: string, policy: object, audit: object}>}
   */
  async execute(agentId, toolName, payload, context = {}) {
    const tool = this._tools.get(toolName);
    if (!tool) {
      const entry = this._appendAudit({ event: 'execute', agentId, tool: toolName, status: EXECUTION_STATUS.ERROR, reason: 'unknown tool' });
      return { status: EXECUTION_STATUS.ERROR, reason: `Unknown tool: ${toolName}`, policy: null, audit: entry };
    }

    const approvalObj = context.ownerApproval || null;
    const ownerApproved = context.ownerApproved === true || Boolean(approvalObj && approvalObj.approved === true);

    // 1) Policy evaluation FIRST (default-deny governance).
    const policy = this.policy.evaluate({
      action: tool.action,
      ...tool.effects,
      ...(context.effects || {}),
      ownerApproved,
    });
    const base = { agentId, tool: toolName, action: tool.action, policy };

    // 2) CLASS_C — refused IMMEDIATELY (before any registry/tool lookup).
    if (policy.actionClass === 'CLASS_C') {
      const entry = this._appendAudit({ ...base, event: 'execute', status: EXECUTION_STATUS.DENIED, reason: policy.reason });
      return { status: EXECUTION_STATUS.DENIED, reason: policy.reason, policy, audit: entry };
    }

    // 3) AgentRegistry permission checks (registered? enabled? class? tool?).
    try {
      await this.registry.assertCanExecute(agentId, policy.actionClass, toolName);
    } catch (err) {
      const entry = this._appendAudit({ ...base, event: 'execute', status: EXECUTION_STATUS.DENIED, reason: String(err && err.message) });
      return { status: EXECUTION_STATUS.DENIED, reason: String(err && err.message), policy, audit: entry };
    }

    // 4) CLASS_B without approval — blocked immediately.
    if (!policy.allowed) {
      const entry = this._appendAudit({ ...base, event: 'execute', status: EXECUTION_STATUS.BLOCKED, reason: policy.reason });
      return {
        status: EXECUTION_STATUS.BLOCKED,
        reason: policy.reason,
        requiresApproval: true,
        policy,
        audit: entry,
      };
    }

    // 5) Cleared for execution (Class A, or Class B with recorded approval).
    try {
      const result = await tool.handler(payload, {
        agentId,
        ownerApproved,
        approvedBy: approvalObj && approvalObj.approvedBy ? approvalObj.approvedBy : (ownerApproved ? 'owner' : ''),
        memory: this.memory,
      });
      const entry = this._appendAudit({
        ...base, event: 'execute', status: EXECUTION_STATUS.OK,
        approval: ownerApproved ? { approvedBy: approvalObj && approvalObj.approvedBy ? approvalObj.approvedBy : 'owner', at: new Date().toISOString() } : undefined,
      });
      return { status: EXECUTION_STATUS.OK, result, policy, audit: entry };
    } catch (err) {
      const entry = this._appendAudit({ ...base, event: 'execute', status: EXECUTION_STATUS.ERROR, reason: String(err && err.message) });
      return { status: EXECUTION_STATUS.ERROR, reason: String(err && err.message), policy, audit: entry };
    }
  }

  /** Read-only view of the append-only audit log. */
  getAuditLog(filter = {}) {
    let entries = this._auditLog.map((e) => ({ ...e }));
    if (filter.tool) entries = entries.filter((e) => e.tool === filter.tool);
    if (filter.status) entries = entries.filter((e) => e.status === filter.status);
    if (filter.agentId) entries = entries.filter((e) => e.agentId === filter.agentId);
    return entries;
  }

  _appendAudit(entry) {
    const record = { ...entry, at: entry.at || new Date().toISOString() };
    this._auditLog.push(record); // intentional single write path; no mutation API exists
    return { ...record };
  }
}
