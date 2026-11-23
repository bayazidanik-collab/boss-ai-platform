/**
 * PolicyEvaluator.js — BOSS AI Phase 2 · Autonomous Agent Core
 * Default-Deny governance evaluator for the Class A/B/C Autonomy Matrix.
 *
 *   CLASS_A — Automatic / safe local execution (no approval needed).
 *   CLASS_B — Explicit Owner Approval required (ownerApproved: true).
 *   CLASS_C — Prohibited by default: paid/cost operations, secrets/credentials
 *             access, background auto-publish, UNAPPROVED external network calls.
 *             Always blocked — never ask the Owner to paste secrets/keys.
 *
 * evaluate(request) -> { allowed, actionClass, reason, requiresApproval, scope }
 *
 * Zero-Spend Imperative (hard rule): costEstimate > 0 or requiresPaidSpend === true
 * is ALWAYS CLASS_C — blocked unconditionally, even with owner approval.
 *
 * Security: DOM-free module (zero innerHTML / outerHTML / document.write).
 * Syntax: ES2017-safe (no ?? / ?. / Object.fromEntries / top-level await).
 */

import { DEFAULT_OWNER_ID, DEFAULT_TENANT_ID } from './StorageAdapter.js';

export const CLASS_A = 'CLASS_A';
export const CLASS_B = 'CLASS_B';
export const CLASS_C = 'CLASS_C';

export const ACTION_CLASSES = [CLASS_A, CLASS_B, CLASS_C];

/** Action names that are always CLASS_C (never allowed under any approval). */
export const PROHIBITED_ACTIONS = new Set([
  'privilege_escalation', 'self_elevation', 'policy_override', 'override_policy',
  'skip_approval_gate', 'bypass_checks', 'audit_log_tamper', 'modify_audit_log',
  'delete_audit_log', 'secret_exfiltration', 'exfiltrate_secrets', 'steal_credentials',
  'access_secrets', 'autonomous_financial_transaction', 'background_auto_publish',
]);

/** Action names that touch passwords / API keys / secrets / credentials (CLASS_C). */
export const SECRET_ACTIONS = new Set([
  'modify_api_key', 'change_secrets', 'key_change', 'access_passwords', 'access_api_keys',
  'store_secret', 'read_secret', 'secret_access', 'credential_access', 'handle_credentials',
]);

/** Action names requiring Owner Approval (CLASS_B). */
export const APPROVAL_ACTIONS = new Set([
  'delete_data', 'delete', 'reset', 'reset_all_data', 'overwrite',
  'backup_restore', 'import_backup', 'external_storage_write',
  'repo_visibility_change', 'repo_config_change',
  'send_email', 'send_webhook', 'external_message', 'create_account', 'third_party_signup',
  'production_deploy', 'deploy_production', 'external_api_call',
  'import_pack', 'delete_workspace', 'reset_workspace',
]);

/** Known-safe local action names (CLASS_A). */
export const LOCAL_ACTIONS = new Set([
  'task_planning', 'system_decomposition', 'task_decomposition',
  'documentation', 'documentation_generation', 'report_generation',
  'code_generation', 'client_code_generation',
  'local_qa', 'local_qa_script', 'static_analysis', 'static_security_analysis',
  'local_read', 'local_search', 'local_query', 'local_write', 'memory_read', 'memory_write',
  'task_transition', 'echo', 'status_check', 'health_check',
  'instantiate_pack', 'create_workspace', 'archive_workspace',
]);

function normalize(action) {
  return String(action || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

export default class PolicyEvaluator {
  /**
   * @param {{ownerId?: string, tenantId?: string,
   *          extraRules?: Object<string, 'CLASS_A'|'CLASS_B'|'CLASS_C'|'A'|'B'|'C'>}} [options]
   */
  constructor(options = {}) {
    this.ownerId = options.ownerId || DEFAULT_OWNER_ID;
    this.tenantId = options.tenantId || DEFAULT_TENANT_ID;
    this.extraRules = {};
    if (options.extraRules && typeof options.extraRules === 'object') {
      for (const [action, cls] of Object.entries(options.extraRules)) {
        const norm = String(cls).toUpperCase().replace('CLASS_', '');
        if (ACTION_CLASSES.indexOf('CLASS_' + norm) < 0) {
          throw new TypeError(`extraRules: invalid class '${cls}' for action '${action}'`);
        }
        this.extraRules[normalize(action)] = 'CLASS_' + norm;
      }
    }
  }

  /**
   * Pure classification (no approval logic).
   * @param {object} request
   * @returns {{actionClass: string, reason: string}}
   */
  classify(request) {
    const req = request || {};
    const action = normalize(req.action);

    if (!action) {
      return { actionClass: CLASS_B, reason: 'Default-deny: empty action name escalated to owner' };
    }

    // 1) Secrets / credentials — prohibited outright (never ask the Owner for secrets).
    if (PROHIBITED_ACTIONS.has(action) || SECRET_ACTIONS.has(action) || req.involvesSecrets === true) {
      return {
        actionClass: CLASS_C,
        reason: `Prohibited (Class C): secrets/credentials or hard-banned action '${action}'`,
      };
    }

    // 2) Zero-Spend Imperative — any cost is blocked unconditionally.
    const cost = typeof req.costEstimate === 'number' ? req.costEstimate : 0;
    if (req.requiresPaidSpend === true || cost > 0) {
      return {
        actionClass: CLASS_C,
        reason: `Prohibited (Class C): zero-spend policy — costEstimate ${cost} / requiresPaidSpend ${String(req.requiresPaidSpend)}`,
      };
    }

    // 3) Background auto-publish — prohibited.
    if (req.backgroundPublish === true) {
      return { actionClass: CLASS_C, reason: 'Prohibited (Class C): background auto-publish is never allowed' };
    }

    // 4) External network / webhooks — Class C when unapproved, Class B when approved.
    if (req.externalNetwork === true) {
      if (req.ownerApproved === true || (req.ownerApproval && req.ownerApproval.approved === true)) {
        return { actionClass: CLASS_B, reason: `Owner-approved external network action '${action}' (Class B)` };
      }
      return {
        actionClass: CLASS_C,
        reason: `Prohibited (Class C): unapproved external network/webhook call '${action}'`,
      };
    }

    // 5) Registered extra rules (explicit local overrides).
    const extra = this.extraRules[action];
    if (extra) return { actionClass: extra, reason: `Classified by configured rule: '${action}' -> ${extra}` };

    // 6) Destructive / backup / external-storage / repo-config effects (Class B).
    if (
      req.destructive === true || req.backupRestore === true ||
      req.externalStorageWrite === true || req.repoConfigChange === true ||
      APPROVAL_ACTIONS.has(action)
    ) {
      return { actionClass: CLASS_B, reason: `Owner approval required (Class B): '${action}'` };
    }

    // 7) Known-safe local actions (Class A).
    if (LOCAL_ACTIONS.has(action)) {
      return { actionClass: CLASS_A, reason: `Permitted (Class A): local action '${action}'` };
    }

    // 8) Default-deny: unmatched actions escalate to the owner.
    return { actionClass: CLASS_B, reason: `Default-deny: unmatched action '${action}' escalated to owner` };
  }

  /**
   * Full evaluation with approval + scope.
   * @param {object} request { action, costEstimate?, requiresPaidSpend?, externalNetwork?,
   *                           backgroundPublish?, involvesSecrets?, destructive?, backupRestore?,
   *                           externalStorageWrite?, repoConfigChange?, ownerApproved? }
   * @returns {{allowed: boolean, actionClass: string, reason: string,
   *            requiresApproval: boolean, scope: {ownerId: string, tenantId: string}}}
   */
  evaluate(request) {
    const verdict = this.classify(request || {});
    const req = request || {};
    const ownerApproved = req.ownerApproved === true || (req.ownerApproval && req.ownerApproval.approved === true);

    let allowed = false;
    let requiresApproval = false;
    let reason = verdict.reason;

    if (verdict.actionClass === CLASS_A) {
      allowed = true;
    } else if (verdict.actionClass === CLASS_B) {
      requiresApproval = true;
      if (ownerApproved) {
        allowed = true;
        reason = verdict.reason + ' — owner approval recorded';
      } else {
        reason = verdict.reason + ' — blocked until ownerApproved: true';
      }
    }
    // CLASS_C stays blocked unconditionally.

    return {
      allowed,
      actionClass: verdict.actionClass,
      reason,
      requiresApproval,
      scope: { ownerId: this.ownerId, tenantId: this.tenantId },
    };
  }

  /** True when the action can NEVER run (Class C). */
  isProhibited(action) {
    return this.classify({ action }).actionClass === CLASS_C;
  }
}
