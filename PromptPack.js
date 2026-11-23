/**
 * BOSS AI — PromptPack.js
 * Phase 4 (Product Factory): local JSON prompt-pack model driving product
 * workspaces. Strict schema validation (unknown keys rejected, types enforced);
 * built-in starter packs; instantiate(packId, name) is CLASS_A (purely local);
 * importPack(json, approval) is CLASS_B (requires ownerApproved: true) and is
 * strictly validated BEFORE any registration — a rejected pack mutates nothing.
 * Zero network, zero spend. Data-only (no DOM).
 */

const PACK_KEYS = ['id', 'name', 'version', 'description', 'seed', 'workflows', 'tags'];
const SEED_KEYS = ['tasks', 'projects', 'notes'];
const TASK_KEYS = ['title', 'description', 'tags', 'status', 'priority', 'dueDate'];
const PROJECT_KEYS = ['name', 'description', 'tags'];
const NOTE_KEYS = ['title', 'content', 'tags'];
const WORKFLOW_KEYS = ['name', 'steps'];
const STEP_KEYS = ['kind', 'action', 'class', 'tool', 'payload'];
const KINDS = ['plan', 'build', 'audit', 'report'];
const CLASSES = ['CLASS_A', 'CLASS_B', 'CLASS_C'];

function isStr(v) { return typeof v === 'string'; }
function isStrArr(v) { return Array.isArray(v) && v.every(isStr); }
function unknownKeys(obj, allowed) {
  return Object.keys(obj).filter((k) => allowed.indexOf(k) === -1);
}

function validateItem(item, allowed, requiredField, label, errors) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    errors.push(label + ': must be an object');
    return;
  }
  const extra = unknownKeys(item, allowed);
  if (extra.length) errors.push(label + ': unknown keys [' + extra.join(', ') + ']');
  const req = item[requiredField];
  if (!isStr(req) || !req.trim() || req.length > 200) errors.push(label + ': ' + requiredField + ' required (string, 1-200 chars)');
  for (const k of allowed) {
    if (k === requiredField) continue;
    const v = item[k];
    if (v == null) continue;
    if (k === 'tags') { if (!isStrArr(v) || v.length > 20) errors.push(label + ': tags must be string array (<=20)'); }
    else if (k === 'payload') { if (typeof v !== 'object' || Array.isArray(v)) errors.push(label + ': payload must be an object'); }
    else if (!isStr(v) || v.length > 2000) errors.push(label + ': ' + k + ' must be a string (<=2000 chars)');
  }
}

export default class PromptPack {
  constructor(options = {}) {
    this.workspaceEngine = options.workspaceEngine || null;
    this._packs = new Map();
    const builtin = PromptPack.BUILTIN_PACKS;
    for (let i = 0; i < builtin.length; i += 1) {
      this._packs.set(builtin[i].id, builtin[i]);
    }
  }

  /** Built-in starter packs (deep-copied per instance). */
  static get BUILTIN_PACKS() {
    return JSON.parse(JSON.stringify([
      {
        id: 'starter-hub', name: 'Starter Hub', version: 1,
        description: 'Personal productivity starter: tasks, one project, one note.',
        tags: ['starter', 'productivity'],
        seed: {
          tasks: [
            { title: 'Welcome — complete your first task', description: 'Tap a task checkbox when done.', tags: ['getting-started'] },
            { title: 'Explore the More tab', description: 'Storage meter, backup, agent status.', tags: ['getting-started'] },
          ],
          projects: [{ name: 'Getting Started', description: 'Your first workspace project.', tags: ['starter'] }],
          notes: [{ title: 'About this workspace', content: 'Created from the Starter Hub prompt pack.', tags: ['info'] }],
        },
        workflows: [
          { name: 'weekly-review', steps: [
            { kind: 'plan', action: 'plan_week', class: 'CLASS_A' },
            { kind: 'audit', action: 'audit_week', class: 'CLASS_A' },
            { kind: 'report', action: 'report_week', class: 'CLASS_A' },
          ] },
        ],
      },
      {
        id: 'content-planner', name: 'Content Planner', version: 1,
        description: 'Plan and ship content: calendar tasks, pipeline project, style note.',
        tags: ['content', 'planning'],
        seed: {
          tasks: [
            { title: 'Draft content calendar', description: 'Pick themes for the next 4 weeks.', tags: ['calendar'] },
            { title: 'Write first post', description: 'From idea to publish-ready draft.', tags: ['writing'] },
          ],
          projects: [{ name: 'Content Pipeline', description: 'Ideas -> drafts -> published.', tags: ['content'] }],
          notes: [{ title: 'Style guide', content: 'Voice, tone, and formatting rules.', tags: ['style'] }],
        },
        workflows: [
          { name: 'content-cycle', steps: [
            { kind: 'plan', action: 'plan_content', class: 'CLASS_A' },
            { kind: 'build', action: 'draft_content', class: 'CLASS_A' },
            { kind: 'audit', action: 'review_content', class: 'CLASS_A' },
            { kind: 'report', action: 'report_content', class: 'CLASS_A' },
          ] },
        ],
      },
      {
        id: 'client-tracker', name: 'Client Tracker', version: 1,
        description: 'Track client work: onboarding tasks, delivery project, contact log.',
        tags: ['client', 'delivery'],
        seed: {
          tasks: [
            { title: 'Log client requirements', description: 'Capture scope and constraints.', tags: ['intake'] },
            { title: 'Prepare kickoff document', description: 'Timeline, roles, deliverables.', tags: ['kickoff'] },
          ],
          projects: [{ name: 'Client Onboarding', description: 'From signed to started.', tags: ['client'] }],
          notes: [{ title: 'Contact log', content: 'Calls, decisions, follow-ups.', tags: ['contacts'] }],
        },
        workflows: [
          { name: 'client-delivery', steps: [
            { kind: 'plan', action: 'plan_delivery', class: 'CLASS_A' },
            { kind: 'build', action: 'do_delivery', class: 'CLASS_A' },
            { kind: 'audit', action: 'audit_delivery', class: 'CLASS_A' },
            { kind: 'report', action: 'report_delivery', class: 'CLASS_A' },
          ] },
        ],
      },
    ]));
  }

  /** Strict schema validation. Returns { valid, errors: [] } — never throws. */
  validatePack(pack) {
    const errors = [];
    if (!pack || typeof pack !== 'object' || Array.isArray(pack)) {
      return { valid: false, errors: ['pack: must be an object'] };
    }
    const extra = unknownKeys(pack, PACK_KEYS);
    if (extra.length) errors.push('pack: unknown keys [' + extra.join(', ') + ']');
    if (!isStr(pack.id) || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(pack.id)) errors.push('id: required (a-z0-9-_ , max 64)');
    if (!isStr(pack.name) || !pack.name.trim() || pack.name.length > 120) errors.push('name: required (1-120 chars)');
    if (typeof pack.version !== 'number' || pack.version < 1 || pack.version !== Math.floor(pack.version)) errors.push('version: required (integer >= 1)');
    if (pack.description != null && (!isStr(pack.description) || pack.description.length > 500)) errors.push('description: string (<=500)');
    if (pack.tags != null && (!isStrArr(pack.tags) || pack.tags.length > 20)) errors.push('tags: string array (<=20)');

    const seed = pack.seed == null ? {} : pack.seed;
    if (typeof seed !== 'object' || Array.isArray(seed)) errors.push('seed: must be an object');
    else {
      const seedExtra = unknownKeys(seed, SEED_KEYS);
      if (seedExtra.length) errors.push('seed: unknown keys [' + seedExtra.join(', ') + ']');
      const lists = [
        ['tasks', TASK_KEYS, 'title'],
        ['projects', PROJECT_KEYS, 'name'],
        ['notes', NOTE_KEYS, 'title'],
      ];
      for (let i = 0; i < lists.length; i += 1) {
        const key = lists[i][0];
        const arr = seed[key] == null ? [] : seed[key];
        if (!Array.isArray(arr)) { errors.push('seed.' + key + ': must be an array'); continue; }
        if (arr.length > 50) errors.push('seed.' + key + ': max 50 items');
        for (let j = 0; j < arr.length; j += 1) {
          validateItem(arr[j], lists[i][1], lists[i][2], 'seed.' + key + '[' + j + ']', errors);
        }
      }
    }

    const workflows = pack.workflows == null ? [] : pack.workflows;
    if (!Array.isArray(workflows)) errors.push('workflows: must be an array');
    else {
      if (workflows.length > 10) errors.push('workflows: max 10');
      for (let i = 0; i < workflows.length; i += 1) {
        const wf = workflows[i];
        const label = 'workflows[' + i + ']';
        if (!wf || typeof wf !== 'object' || Array.isArray(wf)) { errors.push(label + ': must be an object'); continue; }
        const wfExtra = unknownKeys(wf, WORKFLOW_KEYS);
        if (wfExtra.length) errors.push(label + ': unknown keys [' + wfExtra.join(', ') + ']');
        if (!isStr(wf.name) || !wf.name.trim() || wf.name.length > 120) errors.push(label + ': name required');
        const steps = wf.steps;
        if (!Array.isArray(steps) || !steps.length || steps.length > 20) { errors.push(label + ': steps must be 1-20 items'); continue; }
        for (let j = 0; j < steps.length; j += 1) {
          const st = steps[j];
          const sLabel = label + '.steps[' + j + ']';
          if (!st || typeof st !== 'object' || Array.isArray(st)) { errors.push(sLabel + ': must be an object'); continue; }
          const stExtra = unknownKeys(st, STEP_KEYS);
          if (stExtra.length) errors.push(sLabel + ': unknown keys [' + stExtra.join(', ') + ']');
          if (KINDS.indexOf(st.kind) === -1) errors.push(sLabel + ': kind must be one of ' + KINDS.join('/'));
          if (!isStr(st.action) || !st.action.trim() || st.action.length > 120) errors.push(sLabel + ': action required');
          if (st.class != null && CLASSES.indexOf(st.class) === -1) errors.push(sLabel + ': class must be CLASS_A/B/C');
          if (st.tool != null && (!isStr(st.tool) || st.tool.length > 120)) errors.push(sLabel + ': tool must be a string');
          if (st.payload != null && (typeof st.payload !== 'object' || Array.isArray(st.payload))) errors.push(sLabel + ': payload must be an object');
        }
      }
    }
    return { valid: errors.length === 0, errors };
  }

  registerPack(pack) {
    const result = this.validatePack(pack);
    if (!result.valid) throw new Error('registerPack: invalid pack — ' + result.errors.join('; '));
    this._packs.set(String(pack.id), JSON.parse(JSON.stringify(pack)));
    return { id: String(pack.id), registered: true };
  }

  getPack(id) {
    const pack = this._packs.get(String(id));
    return pack ? JSON.parse(JSON.stringify(pack)) : null;
  }

  listPacks() {
    return Array.from(this._packs.keys()).map((id) => {
      const p = this._packs.get(id);
      return { id: p.id, name: p.name, version: p.version, description: p.description, tags: (p.tags || []).slice() };
    });
  }

  /**
   * CLASS_A — create a workspace from a pack and seed it (purely local).
   * @returns {Promise<{workspace, seeded: {tasks, projects, notes}, workflows}>}
   */
  async instantiate(packId, options = {}) {
    const pack = this._packs.get(String(packId));
    if (!pack) throw new Error('Unknown pack: ' + packId);
    if (!this.workspaceEngine || typeof this.workspaceEngine.createWorkspace !== 'function') {
      throw new TypeError('PromptPack requires a WorkspaceEngine to instantiate');
    }
    const ws = await this.workspaceEngine.createWorkspace({
      name: String(options.name || pack.name),
      description: pack.description,
      packId: pack.id,
      workflows: pack.workflows || [],
    });
    const eng = this.workspaceEngine.scopedEngines(ws.id);
    const seeded = { tasks: [], projects: [], notes: [] };
    const t = pack.seed && pack.seed.tasks ? pack.seed.tasks : [];
    const p = pack.seed && pack.seed.projects ? pack.seed.projects : [];
    const n = pack.seed && pack.seed.notes ? pack.seed.notes : [];
    for (let i = 0; i < t.length; i += 1) seeded.tasks.push(await eng.taskEngine.createTask(t[i]));
    for (let i = 0; i < p.length; i += 1) seeded.projects.push(await eng.projectEngine.createProject(p[i]));
    for (let i = 0; i < n.length; i += 1) seeded.notes.push(await eng.noteEngine.createNote(n[i]));
    return { workspace: ws, seeded, workflows: pack.workflows || [] };
  }

  /**
   * CLASS_B — import an external pack JSON (string or object). Requires
   * approval.ownerApproved === true; strict validation runs BEFORE any
   * registration, so a rejected pack mutates nothing.
   */
  async importPack(json, approval = {}) {
    if (approval.ownerApproved !== true) {
      throw new Error('importPack is a Class B action: ownerApproved: true required');
    }
    let pack = json;
    if (isStr(json)) {
      try { pack = JSON.parse(json); } catch (e) {
        throw new Error('importPack: invalid JSON — ' + String(e && e.message || e));
      }
    }
    const result = this.validatePack(pack);
    if (!result.valid) throw new Error('importPack: invalid pack — ' + result.errors.join('; '));
    return this.registerPack(pack);
  }
         }
