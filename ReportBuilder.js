/**
 * BOSS AI — ReportBuilder.js
 * Phase 3: turns a workflow run into an honest, text-only report (JSON + Markdown).
 * Runtime lifecycle statuses are kept strictly separate from the release status
 * vocabulary (Proposed/Approved/Implemented/Tested/Released/Verified) and never
 * presented as release or deployment claims. No HTML output (XSS-safe).
 */

const STATUS_VOCABULARY = ['Proposed', 'Approved', 'Implemented', 'Tested', 'Released', 'Verified'];

export default class ReportBuilder {
  static get STATUS_VOCABULARY() { return STATUS_VOCABULARY.slice(); }

  build(run) {
    if (!run || !run.workflow || !Array.isArray(run.workflow.steps)) {
      throw new TypeError('build: run with workflow steps required');
    }
    const steps = run.workflow.steps;
    const counts = { total: steps.length, completed: 0, awaitingOwner: 0, denied: 0, failed: 0, pending: 0 };
    for (let i = 0; i < steps.length; i += 1) {
      const s = steps[i];
      if (s.status === 'Completed') counts.completed += 1;
      else if (s.status === 'AwaitingOwner') counts.awaitingOwner += 1;
      else if (s.status === 'Denied') counts.denied += 1;
      else if (s.status === 'Failed') counts.failed += 1;
      else counts.pending += 1;
    }
    return {
      runId: run.id,
      goal: run.goal,
      agentId: run.agentId,
      status: run.status,
      counts,
      steps: steps.map((s) => ({
        index: s.index,
        kind: s.kind,
        action: s.action,
        class: s.class,
        status: s.status,
        tool: s.tool,
        error: s.error,
        approval: s.approval ? { ownerApproved: true, approvedBy: s.approval.approvedBy || 'owner' } : null,
      })),
      generatedAt: new Date().toISOString(),
    };
  }

  toMarkdown(run) {
    const r = this.build(run);
    const lines = [];
    lines.push('# BOSS AI — Workflow Run Report');
    lines.push('');
    lines.push('- Run: `' + r.runId + '`');
    lines.push('- Goal: ' + r.goal);
    lines.push('- Agent: `' + r.agentId + '`');
    lines.push('- Runtime status: **' + r.status + '**');
    lines.push('- Steps: ' + r.counts.completed + ' completed / ' + r.counts.total + ' total' +
      ' (' + r.counts.awaitingOwner + ' awaiting owner, ' + r.counts.denied + ' denied, ' + r.counts.failed + ' failed)');
    lines.push('');
    lines.push('| # | Kind | Action | Class | Runtime status | Note |');
    lines.push('|---|---|---|---|---|---|');
    for (let i = 0; i < r.steps.length; i += 1) {
      const s = r.steps[i];
      const note = s.error ? String(s.error).split('|').join('/') : (s.approval ? 'owner approved' : '');
      lines.push('| ' + s.index + ' | ' + s.kind + ' | ' + s.action.split('|').join('/') +
        ' | ' + s.class + ' | ' + s.status + ' | ' + note + ' |');
    }
    lines.push('');
    lines.push('Generated: ' + r.generatedAt);
    lines.push('');
    lines.push('> Honesty note: statuses above are RUNTIME lifecycle labels only.');
    lines.push('> Release vocabulary stays separate: ' + STATUS_VOCABULARY.join(', ') + '.');
    lines.push('> This report makes no release or deployment claim.');
    return lines.join('\n');
  }
}
