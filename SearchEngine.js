/**
 * SearchEngine.js — BOSS AI Personal Productivity Hub v1.0
 * High-speed real-time cross-entity search across Tasks, Projects, and Notes.
 * Returns structured results grouped by entity type with highlighted match metadata.
 * DOM-free domain module (highlight metadata are plain index ranges — the UI
 * renders snippets with textContent-safe nodes only).
 */

const TASK_FIELDS = ['title', 'description', 'tags'];
const PROJECT_FIELDS = ['name', 'description', 'tags'];
const NOTE_FIELDS = ['title', 'content', 'tags'];

export default class SearchEngine {
  /** @param {import('./StorageAdapter.js').default} storage */
  constructor(storage) {
    if (!storage) throw new TypeError('SearchEngine requires a StorageAdapter');
    this.storage = storage;
  }

  /**
   * @param {string} query
   * @returns {Promise<{
   *   query: string,
   *   counts: {tasks: number, projects: number, notes: number},
   *   results: {tasks: Array, projects: Array, notes: Array}
   * }>}
   */
  async search(query) {
    const q = String(query || '').trim().toLowerCase();
    const empty = {
      query: String(query || ''),
      counts: { tasks: 0, projects: 0, notes: 0 },
      results: { tasks: [], projects: [], notes: [] },
    };
    if (!q) return empty;

    const [tasks, projects, notes] = await Promise.all([
      this.storage.list('tasks'),
      this.storage.list('projects'),
      this.storage.list('notes'),
    ]);

    const results = {
      tasks: this._collect(tasks, TASK_FIELDS, q, 'task'),
      projects: this._collect(projects, PROJECT_FIELDS, q, 'project'),
      notes: this._collect(notes, NOTE_FIELDS, q, 'note'),
    };

    return {
      query: String(query || ''),
      counts: {
        tasks: results.tasks.length,
        projects: results.projects.length,
        notes: results.notes.length,
      },
      results,
    };
  }

  _collect(entities, fields, q, entityType) {
    const out = [];
    for (const entity of entities) {
      const matches = [];
      for (const field of fields) {
        const raw = entity[field];
        const values = Array.isArray(raw) ? raw.map(String) : [String(raw == null ? '' : raw)];
        values.forEach((text, valueIndex) => {
          const found = this._matchText(text, q);
          for (const m of found) {
            matches.push({
              field,
              valueIndex,
              snippet: this._snippet(text, m.start, m.end),
              highlight: { start: m.start, end: m.end },
            });
          }
        });
      }
      if (matches.length) {
        out.push({ entityType, id: entity.id, entity, matches });
      }
    }
    return out;
  }

  /** Case-insensitive occurrence finder. Returns [{start, end}] ranges in original text. */
  _matchText(text, q) {
    const ranges = [];
    const haystack = String(text || '');
    const lower = haystack.toLowerCase();
    let idx = lower.indexOf(q);
    while (idx !== -1) {
      ranges.push({ start: idx, end: idx + q.length });
      idx = lower.indexOf(q, idx + Math.max(q.length, 1));
    }
    return ranges;
  }

  /** Context window around the match (±32 chars) with ellipsis markers. */
  _snippet(text, start, end) {
    const src = String(text || '');
    const from = Math.max(0, start - 32);
    const to = Math.min(src.length, end + 32);
    const prefix = from > 0 ? '…' : '';
    const suffix = to < src.length ? '…' : '';
    return `${prefix}${src.slice(from, to)}${suffix}`;
  }

  /* ---- Backward-compat API (thin delegates; search() is the primary method) ---- */

  async searchByTag(tag) {
    const q = String(tag || '').toLowerCase();
    const [tasks, projects, notes] = await Promise.all([
      this.storage.list('tasks'),
      this.storage.list('projects'),
      this.storage.list('notes'),
    ]);
    const keep = (arr) => arr.filter((it) => (Array.isArray(it.tags) ? it.tags : []).some((t) => String(t).toLowerCase() === q));
    return {
      counts: { tasks: keep(tasks).length, projects: keep(projects).length, notes: keep(notes).length },
      results: { tasks: keep(tasks), projects: keep(projects), notes: keep(notes) },
    };
  }

  async searchByEntity(entityType, query) {
    const res = await this.search(query);
    const key = String(entityType || '').toLowerCase().replace(/s$/, '');
    const buckets = { task: 'tasks', project: 'projects', note: 'notes' };
    const one = buckets[key];
    return {
      counts: one ? { [one]: res.results[one].length } : { tasks: 0, projects: 0, notes: 0 },
      results: {
        tasks: one === 'tasks' ? res.results.tasks : [],
        projects: one === 'projects' ? res.results.projects : [],
        notes: one === 'notes' ? res.results.notes : [],
      },
    };
  }

  async searchByDateRange(from, to) {
    const start = new Date(from).getTime();
    const end = new Date(to).getTime();
    const [tasks, projects, notes] = await Promise.all([
      this.storage.list('tasks'),
      this.storage.list('projects'),
      this.storage.list('notes'),
    ]);
    const inRange = (it) => {
      const t = new Date(it.updatedAt || it.createdAt || 0).getTime();
      return (!isNaN(start) ? t >= start : true) && (!isNaN(end) ? t <= end : true);
    };
    return {
      counts: { tasks: tasks.filter(inRange).length, projects: projects.filter(inRange).length, notes: notes.filter(inRange).length },
      results: { tasks: tasks.filter(inRange), projects: projects.filter(inRange), notes: notes.filter(inRange) },
    };
  }

  async rebuildIndex() {
    // search() scans StorageAdapter live on every call — no prebuilt index to rebuild.
    return { indexed: true };
  }
}
