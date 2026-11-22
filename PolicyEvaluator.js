/**
 * PolicyEvaluator.js — BOSS AI Phase 2 · Autonomous Agent Core
 * Default-Deny governance evaluator for the Class A/B/C Autonomy Matrix.
 *
 *   Class A — Autonomous Execution (no approval)
 *   Class B — Explicit Owner Approval required (single-use sign-off)
 *   Class C — Strictly Prohibited (never allowed)
 *
 * evaluate(request) -> { allowed, requiresOwnerApproval, actionClass, reason }
 *
 * `allowed` semantics: TRUE only when the agent may proceed WITHOUT further
 * human action. Class B returns allowed=false + requiresOwnerApproval=true —
 * execution becomes permissible only after the owner signs off (the approval
 * token is checked by ToolBroker, not here).
 *
 * Unmatched actions fall to default-deny and escalate to Class B.
 */

export const ACTION_CLASSES = { A: 'A', B: 'B', C: 'C' };

/** Class A — planning, documentation, client-side code, local QA, static analysis. */
export const CLASS_A_ACTIONS = new Set([
  'task_planning', 'system_decomposition', 'documentation_generation', 'documentation',
  'code_generation', 'client_code_generation', 'local_qa_script', 'local_qa',
  'static_security_analysis', 'static_analysis', 'task_decomposition', 'report_generation',
]);

/** Class B — external effects, credentials, deployments, anything that can cost money. */
export const CLASS_B_ACTIONS = new Set([
  'send_email', 'send_webhook', 'external_message', 'create_account', 'third_party_signup',
  'modify_api_key', 'change_secrets', 'key_change', 'production_deploy', 'deploy_production',
  'incur_cost', 'paid_api_call', 'financial_operation', 'external_api_call',
]);

/** Class C — strictly prohibited under any circumstance. */
export const CLASS_C_ACTIONS = new Set([
  'privilege_escalation', 'self_elevation', 'policy_override', 'override_policy',
  'skip_approval_gate', 'bypass_checks', 'audit_log_tamper', 'modify_audit_log',
  'delete_audit_log', 'secret_exfiltration', 'exfiltrate_secrets', 'autonomous_financial_transaction',
  'steal_credentials',
]);

function normalize(action) {
  return String(action || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

export default class PolicyEvaluator {
  /**
   * @param {{extraRules?: Object<string, 'A'|'B'|'C'>}} [options]
   *   extraRules maps additional normalized action names to a class.
   */
  constructor(options = {}) {
    this.extraRules = {};
    if (options.extraRules && typeof options.extraRules === 'object') {
      for (const [action, cls] of Object.entries(options.extraRules)) {
        if (!ACTION_CLASSES[cls]) throw new TypeError(`extraRules: invalid class '${cls}' for action '${action}'`);
        this.extraRules[normalize(action)] = cls;
      }
    }
  }

  /**
   * Evaluate an action request under default-deny rules.
   * @param {{action: string, payload?: object, context?: object}} request
   * @returns {{allowed: boolean, requiresOwnerApproval: boolean, actionClass: 'A'|'B'|'C', reason: string}}
   */
  evaluate(request) {
    const action = normalize(request && request.action);
    if (!action) {
      return {
        allowed: false,
        requiresOwnerApproval: true,
        actionClass: ACTION_CLASSES.B,
        reason: 'Default-deny: empty action name escalated to owner',
      };
    }

    // 1) Class C — hard prohibition wins over everything (including extra rules).
    if (CLASS_C_ACTIONS.has(action)) {
      return {
        allowed: false,
        requiresOwnerApproval: false,
        actionClass: ACTION_CLASSES.C,
        reason: `Prohibited action (Class C): ${action}`,
      };
    }

    // 2) Registered extra rules (explicit permit/deny additions).
    const extra = this.extraRules[action];
    if (extra === 'C') {
      return { allowed: false, requiresOwnerApproval: false, actionClass: ACTION_CLASSES.C, reason: `Prohibited by configured rule: ${action}` };
    }
    if (extra === 'A') {
      return { allowed: true, requiresOwnerApproval: false, actionClass: ACTION_CLASSES.A, reason: `Permitted (Class A by configured rule): ${action}` };
    }
    if (extra === 'B') {
      return { allowed: false, requiresOwnerApproval: true, actionClass: ACTION_CLASSES.B, reason: `Owner approval required (configured rule): ${action}` };
    }

    // 3) Built-in Class B.
    if (CLASS_B_ACTIONS.has(action)) {
      return {
        allowed: false,
        requiresOwnerApproval: true,
        actionClass: ACTION_CLASSES.B,
        reason: `Owner approval required (Class B): ${action}`,
      };
    }

    // 4) Built-in Class A.
    if (CLASS_A_ACTIONS.has(action)) {
      return {
        allowed: true,
        requiresOwnerApproval: false,
        actionClass: ACTION_CLASSES.A,
        reason: `Permitted (Class A): ${action}`,
      };
    }

    // 5) Default-deny: unknown actions escalate to the owner.
    return {
      allowed: false,
      requiresOwnerApproval: true,
      actionClass: ACTION_CLASSES.B,
      reason: `Default-deny: unmatched action '${action}' escalated to owner`,
    };
  }

  isProhibited(action) {
    return this.evaluate({ action }).actionClass === ACTION_CLASSES.C;
  }
}
