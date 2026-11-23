/**
 * BOSS AI — Orchestrator.js
 * Phase 3 (Orchestrator Layer): ties AgentRegistry + ToolBroker + ScopedMemory +
 * WorkflowEngine + ReportBuilder into agent runs: plan -> build -> audit -> report.
 * Agent must be registered + enabled when a registry is supplied. CLASS_B steps pause
 * for explicit owner approval; CLASS_C is denied (zero-spend, no secrets). All memory
 * writes are best-effort. Zero network calls. Clean ES module; data-only output.
 */

import WorkflowEngine from './WorkflowEngine.js';
import ReportBuilder from './ReportBuilder.js';

export default class Orchestrator {
  constructor(options = {}) {
    if (!options.storage) throw new TypeError('Orchestrator requires a StorageAdapter');
    if (!options.broker || typeof options.broker.execute !== 'function') {
      throw new TypeError('Orchestrator requires a ToolBroker');
    }
    this.storage = options.storage;
    this.broker = options.broker;
    this.registry = options.registry || null;
    this.memory = options.memory || null;
    this.ai = options.ai || null;
    this.engine = options.engine || new WorkflowEngine(options.broker);
    this.reportBuilder = options.reportBuilder || new ReportBuilder();
    this.runs = new Map();
  }

  /**
   * @param {{agentId?: string, goal?: string, name?: string, plan: Array,
   *          handlers?: object, context?: object}} options
   * @returns {Promise<{id, goal, agentId, status, startedAt, workflow}>}
   */
  async startRun(options = {}) {
    const agentId = String(options.agentId || 'local-owner');
    const plan = Array.isArray(options.plan) ? options.plan : [];
    if (!plan.length) throw new TypeError('startRun: non-empty plan required');

    if (this.registry) {
      const agent = await this.registry.get(agentId);
      if (!agent) throw new Error('Agent not registered: ' + agentId);
      if (agent.status !== 'enabled') throw new Error('Agent not enabled: ' + agentId);
    }

    const wf = this.engine.createWorkflow({
      name: options.name,
      agentId,
      steps: plan,
      context: options.context,
    });
    const run = {
      id: wf.id,
      goal: String(options.goal || ''),
      agentId,
      status: 'Running',
      startedAt: new Date().toISOString(),
      updatedAt: null,
      workflowId: wf.id,
    };
    this.runs.set(run.id, run);

    if (this.memory) {
      try {
        await this.memory.write(agentId, 'run:' + run.id, { goal: run.goal, steps: plan.length });
      } catch (err) { /* memory is best-effort; never blocks a run */ }
    }

    await this.engine.runWorkflow(wf.id, options.handlers || {});
    run.status = this.engine.getWorkflow(wf.id).status;
    run.updatedAt = new Date().toISOString();
    return this._view(run);
  }

  /** Re-enter a paused run (after approveStep) and continue execution. */
  async continueRun(runId, handlers = {}) {
    const run = this._requireRun(runId);
    await this.engine.runWorkflow(run.workflowId, handlers || {});
    run.status = this.engine.getWorkflow(run.workflowId).status;
    run.updatedAt = new Date().toISOString();
    return this._view(run);
  }

  /** Class B gate: explicit owner approval for a paused step. */
  async approveStep(runId, stepIndex, approval = {}) {
    const run = this._requireRun(runId);
    await this.engine.approveStep(run.workflowId, stepIndex, approval);
    run.status = this.engine.getWorkflow(run.workflowId).status;
    run.updatedAt = new Date().toISOString();
    return this._view(run);
  }

  getRun(runId) {
    return this._view(this._requireRun(runId));
  }

  listRuns() {
    return Array.from(this.runs.values()).map((r) => this._view(r));
  }

  getReport(runId) {
    return this.reportBuilder.build(this._view(this._requireRun(runId)));
  }

  toMarkdown(runId) {
    return this.reportBuilder.toMarkdown(this._view(this._requireRun(runId)));
  }

  _requireRun(runId) {
    const run = this.runs.get(String(runId));
    if (!run) throw new Error('Unknown run: ' + runId);
    return run;
  }

  _view(run) {
    return {
      id: run.id,
      goal: run.goal,
      agentId: run.agentId,
      status: run.status,
      startedAt: run.startedAt,
      workflow: this.engine.getWorkflow(run.workflowId),
    };
  }
}
