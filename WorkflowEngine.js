/**
 * BOSS AI — WorkflowEngine.js
 * Phase 3 (Orchestrator Layer): sequential workflow runner for agent jobs.
 * Kinds: plan -> build -> audit -> report. Tool actions route through a ToolBroker
 * (policy-gated, append-only audit). CLASS_B steps pause for explicit owner approval
 * (ownerApproved: true) before anything external/destructive runs; CLASS_C steps are
 * denied by default-deny (zero-spend, no secrets). Zero network calls. Clean ES module;
 * data-only output (no innerHTML / outerHTML / document.write).
 */

const WORKFLOW_KINDS = ['plan', 'build', 'audit', 'report'];
const RUN_STATUSES = ['Draft', 'Running', 'AwaitingOwner', 'Completed', 'Failed'];
const STEP_STATUSES = ['Pending', 'Running', 'AwaitingOwner', 'Completed', 'Denied', 'Failed'];

let _seq = 0;
function newId() {
  _seq += 1;
  return 'wf_' + Date.now().toString(36) + '_' + _seq;
}

function approvedFlag(step) {
  return Boolean(step && step.approval && step.approval.ownerApproved === true);
}

export default class WorkflowEngine {
  constructor(broker) {
    if (!broker || typeof broker.execute !== 'function') {
      throw new TypeError('WorkflowEngine requires a ToolBroker');
    }
    this.broker = broker;
    this.workflows = new Map();
  }

  static get KINDS() { return WORKFLOW_KINDS.slice(); }
  static get STATUSES() { return RUN_STATUSES.slice(); }
  static get STEP_STATUSES() { return STEP_STATUSES.slice(); }

  createWorkflow(options = {}) {
    const rawSteps = Array.isArray(options.steps) ? options.steps : [];
    if (!rawSteps.length) throw new TypeError('createWorkflow: at least one step required');
    const steps = rawSteps.map((s, i) => {
      const src = s || {};
      return {
        index: i,
        kind: WORKFLOW_KINDS.indexOf(src.kind) !== -1 ? src.kind : 'build',
        action: String(src.action || ('step-' + (i + 1))),
        tool: src.tool == null ? null : String(src.tool),
        payload: src.payload == null ? null : src.payload,
        class: (src.class === 'CLASS_B' || src.class === 'CLASS_C') ? src.class : 'CLASS_A',
        status: 'Pending',
        output: null,
        policy: null,
        audit: null,
        error: null,
        approval: null,
      };
    });
    const wf = {
      id: newId(),
      name: String(options.name || 'workflow'),
      agentId: String(options.agentId || 'local-owner'),
      context: options.context == null ? {} : options.context,
      status: 'Draft',
      currentStep: -1,
      steps,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.workflows.set(wf.id, wf);
    return wf;
  }

  getWorkflow(id) {
    return this.workflows.get(String(id)) || null;
  }

  listWorkflows() {
    return Array.from(this.workflows.values());
  }

  /**
   * Run steps in order. Tool steps call `broker.execute(agentId, tool, payload, context)`;
   * local steps call handlers[action](context, step, workflow). Re-entrant: already
   * Completed/Denied steps are skipped, so calling again resumes after an approval.
   */
  async runWorkflow(id, handlers = {}) {
    const wf = this.getWorkflow(id);
    if (!wf) throw new Error('Unknown workflow: ' + id);
    if (wf.status === 'Completed' || wf.status === 'Failed') return wf;
    wf.status = 'Running';

    for (let i = 0; i < wf.steps.length; i += 1) {
      const step = wf.steps[i];
      if (step.status === 'Completed' || step.status === 'Denied') continue;

      // CLASS_C — deny immediately (default-deny, zero-spend, no secrets).
      if (step.class === 'CLASS_C') {
        step.status = 'Denied';
        step.policy = { actionClass: 'CLASS_C', allowed: false, decision: 'deny' };
        step.error = 'CLASS_C denied by default-deny policy (zero-spend, no secrets)';
        wf.status = 'Failed';
        wf.currentStep = i;
        wf.updatedAt = new Date().toISOString();
        return wf;
      }

      // CLASS_B — pause for explicit owner approval BEFORE execution.
      if (step.class === 'CLASS_B' && !approvedFlag(step)) {
        step.status = 'AwaitingOwner';
        wf.status = 'AwaitingOwner';
        wf.currentStep = i;
        wf.updatedAt = new Date().toISOString();
        return wf;
      }

      step.status = 'Running';
      wf.currentStep = i;
      try {
        let result;
        if (step.tool) {
          const context = {};
          if (approvedFlag(step)) {
            context.ownerApproved = true;
            context.ownerApproval = { approved: true, approvedBy: step.approval.approvedBy || 'owner' };
          }
          const exec = await this.broker.execute(wf.agentId, step.tool, step.payload, context);
          step.policy = exec.policy;
          step.audit = exec.audit;
          if (exec.status === 'ok') {
            result = exec.result;
          } else if (exec.status === 'blocked' && exec.requiresApproval) {
            step.status = 'AwaitingOwner';
            step.error = exec.reason || 'owner approval required';
            wf.status = 'AwaitingOwner';
            wf.updatedAt = new Date().toISOString();
            return wf;
          } else {
            step.status = (exec.status === 'denied') ? 'Denied' : 'Failed';
            step.error = exec.reason || exec.status;
            wf.status = 'Failed';
            wf.updatedAt = new Date().toISOString();
            return wf;
          }
        } else {
          const handler = handlers[step.action];
          if (typeof handler !== 'function') throw new Error('No handler for action: ' + step.action);
          result = await handler(wf.context, step, wf);
        }
        step.output = (result === undefined) ? null : result;
        step.status = 'Completed';
      } catch (err) {
        step.status = 'Failed';
        step.error = String((err && err.message) || err);
        wf.status = 'Failed';
        wf.updatedAt = new Date().toISOString();
        return wf;
      }
      wf.updatedAt = new Date().toISOString();
    }

    wf.status = 'Completed';
    wf.currentStep = wf.steps.length - 1;
    wf.updatedAt = new Date().toISOString();
    return wf;
  }

  /**
   * Owner explicitly approves a paused CLASS_B step (Class B gate).
   * Requires approval.ownerApproved === true; then re-run the workflow to continue.
   */
  async approveStep(id, stepIndex, approval = {}) {
    const wf = this.getWorkflow(id);
    if (!wf) throw new Error('Unknown workflow: ' + id);
    const step = wf.steps[Number(stepIndex)];
    if (!step) throw new Error('Unknown step: ' + stepIndex);
    if (step.status !== 'AwaitingOwner') throw new Error('Step is not awaiting owner approval');
    if (approval.ownerApproved !== true) throw new Error('ownerApproved: true is required for Class B steps');
    step.approval = {
      ownerApproved: true,
      approvedBy: String(approval.approvedBy || 'owner'),
      note: String(approval.note || ''),
      at: new Date().toISOString(),
    };
    step.status = 'Pending'; // re-queued; runWorkflow() will continue from here
    wf.status = 'Running';
    wf.updatedAt = new Date().toISOString();
    return wf;
  }
}

