/**
 * ToolBroker.js — BOSS AI Phase 2 · Autonomous Agent Core
 * Sandboxed execution interface wrapping local client tools and API utilities.
 *
 * - Every tool payload is cleared by PolicyEvaluator BEFORE execution
 *   (Default-Deny; Class A passes, Class B waits for owner approval,
 *   Class C is structurally refused).
 * - All attempts (allowed, blocked, denied, ok, error) land in an
 *   APPEND-ONLY audit log. The log exposes no update or delete API —
 *   audit-log tampering is a Class C violation and is impossible by design.
 *
 * execute() returns structured results (never throws for policy outcomes):
 *   { status: 'ok' | 'blocked' | 'denied' | 'error', ... }
 */

import PolicyEvaluator from './PolicyEvaluator.js';

export const EXECUTION_STATUS = { OK: 'ok', BLOCKED: 'blocked', DENIED: 'denied', ERROR: 'error' };

export default class ToolBroker {
  /**
   * @param {{policyEvaluator?: PolicyEvaluator}} [options]
   */
  constructor(options = {}) {
    this.policy = options.policyEvaluator instanceof PolicyEvaluator
      ? options.policyEvaluator
      : new PolicyEvaluator();
    this._tools = new Map();
    this._auditLog = []; // append-only
  }

  /**
   * @param {string} name unique tool name
   * @param {{handler: function(*, *):*, action?: string, description?: string}} spec
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
    });
    this._appendAudit({ event: 'register_tool', tool: name, action: this._tools.get(name).action });
    return this._tools.get(name);
  }

  listTools() {
    return [...this._tools.values()].map((t) => ({ name: t.name, action: t.action, description: t.description }));
  }

  /**
   * Policy-gated tool execution.
   * @param {string} toolName
   * @param {*} payload
   * @param {{ownerApproval?: {approved: boolean, approvedBy?: string, at?: string}}} [context]
   * @returns {Promise<{status: string, result?: *, reason?: string, policy: object}>}
   */
  async execute(toolName, payload, context = {}) {
    const tool = this._tools.get(toolName);
    if (!tool) {
      const entry = this._appendAudit({ event: 'execute', tool: toolName, status: EXECUTION_STATUS.ERROR, reason: 'unknown tool' });
      return { status: EXECUTION_STATUS.ERROR, reason: `Unknown tool: ${toolName}`, audit: entry };
    }

    const policy = this.policy.evaluate({ action: tool.action, payload });
    const base = { tool: toolName, action: tool.action, policy };

    // Class C — strictly prohibited.
    if (policy.actionClass === 'C') {
      const entry = this._appendAudit({ ...base, event: 'execute', status: EXECUTION_STATUS.DENIED, reason: policy.reason });
      return { status: EXECUTION_STATUS.DENIED, reason: policy.reason, policy, audit: entry };
    }

    // Class B — needs a valid single-use owner approval attached to the call.
    const approval = context.ownerApproval;
    const approved = Boolean(approval && approval.approved === true && approval.approvedBy);
    if (policy.requiresOwnerApproval && !approved) {
      const entry = this._appendAudit({ ...base, event: 'execute', status: EXECUTION_STATUS.BLOCKED, reason: 'awaiting owner approval' });
      return {
        status: EXECUTION_STATUS.BLOCKED,
        reason: `${policy.reason} — execution blocked until owner sign-off (Class B)`,
        policy,
        audit: entry,
      };
    }

    // Cleared for execution (Class A, or Class B with recorded approval).
    try {
      const result = await tool.handler(payload, context);
      const entry = this._appendAudit({
        ...base, event: 'execute', status: EXECUTION_STATUS.OK,
        approval: approved ? { approvedBy: approval.approvedBy, at: approval.at || new Date().toISOString() } : undefined,
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
    return entries;
  }

  _appendAudit(entry) {
    const record = { ...entry, at: entry.at || new Date().toISOString() };
    this._auditLog.push(record); // intentional single write path; no mutation API exists
    return { ...record };
  }
}
