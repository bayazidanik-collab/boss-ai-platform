/**
 * app.js — BOSS AI Personal Productivity Hub v1.0
 * Main UI orchestrator: links DOM events to TaskEngine, ProjectEngine,
 * NoteEngine, SearchEngine, BackupEngine and StorageAdapter.
 *
 * SECURITY (non-negotiable): every dynamic string is rendered through
 * createElement / textContent / setAttribute. innerHTML, outerHTML and
 * document.write are NEVER used — DOM XSS is structurally impossible.
 */

import StorageAdapter from './StorageAdapter.js';
import TaskEngine from './TaskEngine.js';
import ProjectEngine from './ProjectEngine.js';
import NoteEngine from './NoteEngine.js';
import SearchEngine from './SearchEngine.js';
import BackupEngine from './BackupEngine.js';

/* ================================================================== */
/* Safe DOM helpers                                                    */
/* ================================================================== */

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'text') node.textContent = String(value);
    else if (key === 'className') node.className = String(value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, String(value));
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function fmtDate(value) {
  if (!value) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (!m) return String(value);
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function priorityClass(priority) {
  return `pill priority-${String(priority).toLowerCase()}`;
}

function statusClass(status) {
  return `pill status-${String(status).toLowerCase().replace(/\s+/g, '-')}`;
}

/* ================================================================== */
/* Theme (dark default, persisted)                                     */
/* ================================================================== */

const THEME_KEY = 'boss-ai-theme';

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
  try { localStorage.setItem(THEME_KEY, theme === 'light' ? 'light' : 'dark'); } catch (_) { /* private mode */ }
}

function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch (_) { /* private mode */ }
  applyTheme(saved === 'light' ? 'light' : 'dark');
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  applyTheme(current === 'light' ? 'dark' : 'light');
}

/* ================================================================== */
/* Toasts & banners                                                    */
/* ================================================================== */

function toast(message, type = 'ok') {
  const root = document.getElementById('toast-root');
  const node = el('div', { className: `toast toast-${type}`, role: 'status', text: String(message) });
  root.appendChild(node);
  setTimeout(() => { if (node.parentNode) node.parentNode.removeChild(node); }, 3600);
}

function showBanner(text, actionLabel, actionFn) {
  const slot = document.getElementById('banner-slot');
  clear(slot);
  const children = [el('span', { className: 'banner-text', text: String(text) })];
  if (actionLabel && typeof actionFn === 'function') {
    children.push(el('button', {
      className: 'btn btn-secondary', type: 'button', text: String(actionLabel), onClick: () => { actionFn(); clear(slot); },
    }));
  }
  slot.appendChild(el('div', { className: 'banner' }, children));
}

function clearBanner() {
  clear(document.getElementById('banner-slot'));
}

/* ================================================================== */
/* Modal system (bottom-sheet on mobile)                               */
/* ================================================================== */

let lastFocused = null;

function closeModal() {
  const root = document.getElementById('modal-root');
  clear(root);
  if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
  lastFocused = null;
}

function openModal({ title, node, actions = [] }) {
  const root = document.getElementById('modal-root');
  clear(root);
  lastFocused = document.activeElement;

  const closeBtn = el('button', {
    className: 'icon-btn', type: 'button', 'aria-label': 'Close dialog', text: '✕', onClick: closeModal,
  });
  const head = el('div', { className: 'modal-head' }, [el('h3', { className: 'modal-title', text: String(title) }), closeBtn]);
  const actionRow = el('div', { className: 'modal-actions' }, actions);
  const sheet = el('div', { className: 'modal-sheet', role: 'dialog', 'aria-modal': 'true' }, [head, node, actionRow]);
  const overlay = el('div', {
    className: 'modal-overlay',
    onClick: (event) => { if (event.target === overlay) closeModal(); },
  }, [sheet]);

  overlay.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeModal(); });
  root.appendChild(overlay);

  const firstField = sheet.querySelector('input, textarea, select, button');
  if (firstField && typeof firstField.focus === 'function') firstField.focus();
  return { sheet, closeBtn };
}

function confirmModal({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; closeModal(); resolve(value); } };
    const body = el('p', { className: 'hint', text: String(message) });
    openModal({
      title,
      node: body,
      actions: [
        el('button', { className: 'btn btn-secondary', type: 'button', text: 'Cancel', onClick: () => finish(false) }),
        el('button', {
          className: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button', text: String(confirmLabel),
          onClick: () => finish(true),
        }),
      ],
    });
    // Closing via overlay/Esc resolves false.
    const overlay = document.querySelector('.modal-overlay');
    if (overlay) overlay.addEventListener('click', (event) => { if (event.target === overlay) finish(false); });
  });
}

/* ================================================================== */
/* Engine boot (top-level await)                                       */
/* ================================================================== */

const storage = new StorageAdapter({
  onQuotaExceeded: () => {
    toast('Storage quota exceeded — export a backup and free space.', 'error');
    showBanner('Client storage is full. Export a JSON backup from More → Data & Backup, then free space.', 'Export now', () => setView('more'));
  },
});

const taskEngine = new TaskEngine(storage);
const projectEngine = new ProjectEngine(storage, taskEngine);
const noteEngine = new NoteEngine(storage);
const searchEngine = new SearchEngine(storage);
const backupEngine = new BackupEngine(storage);

const state = {
  view: 'dashboard',
  taskFilter: { search: '', status: '', priority: '', tag: '' },
};

/* ================================================================== */
/* View switching                                                      */
/* ================================================================== */

const VIEW_IDS = ['dashboard', 'tasks', 'projects', 'notes', 'more'];

function setView(name) {
  if (!VIEW_IDS.includes(name)) return;
  state.view = name;
  for (const view of VIEW_IDS) {
    const section = document.getElementById(`view-${view}`);
    if (section) section.hidden = view !== name;
  }
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    if (btn.dataset.view === name) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });
  closeSearchPanel();
  renderAll();
  window.scrollTo({ top: 0 });
}

/* ================================================================== */
/* Render: shared card pieces                                          */
/* ================================================================== */

function projectLabelMap(projects) {
  const map = new Map();
  for (const p of projects) map.set(p.id, p.name);
  return map;
}

function tagChips(tags) {
  return (tags || []).map((tag) => el('span', { className: 'chip', text: String(tag) }));
}

function taskCard(task, projectNames, { onEdit, onDelete, onToggle }) {
  const isDone = task.status === 'Completed';
  const check = el('input', {
    className: 'task-check', type: 'checkbox', 'aria-label': isDone ? 'Mark as not completed' : 'Mark as completed',
    onChange: () => onToggle(task, check.checked),
  });
  check.checked = isDone;

  const meta = el('div', { className: 'card-meta' }, [
    el('span', { className: priorityClass(task.priority), text: task.priority }),
    el('span', { className: statusClass(task.status), text: task.status }),
    task.dueDate ? el('span', { className: 'pill', text: `Due ${fmtDate(task.dueDate)}` }) : null,
    task.projectId && projectNames.has(task.projectId)
      ? el('span', { className: 'pill', text: projectNames.get(task.projectId) }) : null,
    ...tagChips(task.tags),
  ]);

  return el('li', { className: `card${isDone ? ' done' : ''}` }, [
    el('div', { className: 'card-title-row' }, [
      el('div', { className: 'check-wrap' }, [check]),
      el('div', { className: 'card-title', text: task.title }),
    ]),
    task.description ? el('p', { className: 'card-desc', text: task.description }) : null,
    meta,
    el('div', { className: 'card-actions' }, [
      el('button', { className: 'btn btn-secondary', type: 'button', text: 'Edit', onClick: () => onEdit(task) }),
      el('button', { className: 'btn btn-danger', type: 'button', text: 'Delete', onClick: () => onDelete(task) }),
    ]),
  ]);
}

/* ================================================================== */
/* Render: Dashboard                                                   */
/* ================================================================== */

async function renderDashboard() {
  const dateNode = document.getElementById('dash-date');
  dateNode.textContent = new Date().toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });

  const counts = await taskEngine.countByStatus();
  const statsNode = document.getElementById('dash-stats');
  clear(statsNode);
  const stats = [
    ['Total', counts.total],
    ['Inbox', counts.Inbox],
    ['Next Action', counts['Next Action']],
    ['In Progress', counts['In Progress']],
    ['Waiting', counts.Waiting],
    ['Completed', counts.Completed],
  ];
  for (const [label, value] of stats) {
    statsNode.appendChild(el('div', { className: 'stat-card' }, [
      el('div', { className: 'stat-value', text: String(value) }),
      el('div', { className: 'stat-label', text: label }),
    ]));
  }

  const focus = await taskEngine.getDailyFocus();
  const list = document.getElementById('dash-focus-list');
  clear(list);
  if (!focus.length) {
    list.appendChild(el('li', { className: 'empty-state', text: 'Nothing urgent today — enjoy the calm or add a task.' }));
    return;
  }
  const projects = await projectEngine.listProjects({ includeArchived: true });
  const names = projectLabelMap(projects);
  for (const task of focus) {
    list.appendChild(taskCard(task, names, {
      onEdit: openTaskForm,
      onDelete: deleteTaskFlow,
      onToggle: toggleTaskDone,
    }));
  }
}

/* ================================================================== */
/* Render: Tasks                                                       */
/* ================================================================== */

async function renderTasks() {
  const filter = state.taskFilter;
  const tasks = await taskEngine.listTasks({
    search: filter.search || undefined,
    status: filter.status || undefined,
    priority: filter.priority || undefined,
    tag: filter.tag || undefined,
    includeCompleted: true,
  });
  const projects = await projectEngine.listProjects({ includeArchived: true });
  const names = projectLabelMap(projects);
  const list = document.getElementById('task-list');
  clear(list);
  if (!tasks.length) {
    list.appendChild(el('li', { className: 'empty-state', text: 'No tasks match. Add one with the + Task button.' }));
    return;
  }
  for (const task of tasks) {
    list.appendChild(taskCard(task, names, {
      onEdit: openTaskForm,
      onDelete: deleteTaskFlow,
      onToggle: toggleTaskDone,
    }));
  }
}

async function toggleTaskDone(task, checked) {
  try {
    await taskEngine.updateTask(task.id, { status: checked ? 'Completed' : 'Inbox' });
    toast(checked ? 'Task completed.' : 'Task reopened.');
  } catch (err) {
    toast(err.message || 'Could not change task status.', 'error');
  }
  renderAll();
}

async function deleteTaskFlow(task) {
  const yes = await confirmModal({
    title: 'Delete task?',
    message: `"${task.title}" will be permanently removed from this device.`,
    confirmLabel: 'Delete', danger: true,
  });
  if (!yes) return;
  await taskEngine.deleteTask(task.id);
  toast('Task deleted.');
  renderAll();
}

/* ================================================================== */
/* Render: Projects                                                    */
/* ================================================================== */

async function renderProjects() {
  const projects = await projectEngine.listProjects();
  const list = document.getElementById('project-list');
  clear(list);
  if (!projects.length) {
    list.appendChild(el('li', { className: 'empty-state', text: 'No projects yet — create one to group related tasks.' }));
    return;
  }
  for (const project of projects) {
    const stats = await projectEngine.getProjectStats(project.id);
    const fill = el('div', { className: `meter-fill${stats.percent >= 100 ? '' : ''}`, style: `width:${stats.percent}%` });
    const card = el('li', { className: 'card' }, [
      el('div', { className: 'card-title-row' }, [
        el('div', { className: 'card-title', text: project.name }),
        el('span', { className: statusClass(project.status), text: project.status }),
      ]),
      project.description ? el('p', { className: 'card-desc', text: project.description }) : null,
      el('div', { className: 'card-meta' }, [
        el('span', { className: 'pill', text: `${stats.completed}/${stats.total} tasks · ${stats.percent}%` }),
        ...tagChips(project.tags),
      ]),
      el('div', { className: 'meter' }, [fill]),
      el('div', { className: 'card-actions' }, [
        el('button', { className: 'btn btn-secondary', type: 'button', text: 'Open', onClick: () => openProjectDetail(project) }),
        el('button', {
          className: 'btn btn-secondary', type: 'button', text: 'Edit',
          onClick: () => openProjectForm(project),
        }),
        project.status !== 'Archived'
          ? el('button', { className: 'btn btn-secondary', type: 'button', text: 'Archive', onClick: () => archiveProjectFlow(project) })
          : null,
        el('button', { className: 'btn btn-danger', type: 'button', text: 'Delete', onClick: () => deleteProjectFlow(project) }),
      ]),
    ]);
    list.appendChild(card);
  }
}

async function openProjectDetail(project) {
  const stats = await projectEngine.getProjectStats(project.id);
  const tasks = await projectEngine.listTasksForProject(project.id);
  const body = el('div', {}, [
    el('p', { className: 'hint', text: `${stats.completed} of ${stats.total} linked tasks completed (${stats.percent}%).` }),
    el('ul', { className: 'card-list' }, tasks.length
      ? tasks.map((task) => el('li', { className: 'card' }, [
        el('div', { className: 'card-title-row' }, [
          el('div', { className: 'card-title', text: task.title }),
          el('span', { className: statusClass(task.status), text: task.status }),
        ]),
      ]))
      : [el('li', { className: 'empty-state', text: 'No tasks linked yet. Link one from the task editor.' })]),
  ]);
  openModal({
    title: project.name,
    node: body,
    actions: [
      el('button', {
        className: 'btn btn-secondary', type: 'button', text: 'Close', onClick: closeModal,
      }),
    ],
  });
}

async function archiveProjectFlow(project) {
  const yes = await confirmModal({
    title: 'Archive project?',
    message: `"${project.name}" becomes read-only. Archived projects cannot be modified or deleted.`,
    confirmLabel: 'Archive',
  });
  if (!yes) return;
  try {
    await projectEngine.archiveProject(project.id);
    toast('Project archived.');
  } catch (err) {
    toast(err.message || 'Could not archive project.', 'error');
  }
  renderAll();
}

async function deleteProjectFlow(project) {
  if (project.status === 'Archived') {
    toast('Archived projects are immutable and cannot be deleted.', 'error');
    return;
  }
  const yes = await confirmModal({
    title: 'Delete project?',
    message: `"${project.name}" will be removed. Linked tasks are kept but unlinked.`,
    confirmLabel: 'Delete', danger: true,
  });
  if (!yes) return;
  try {
    await projectEngine.deleteProject(project.id);
    toast('Project deleted.');
  } catch (err) {
    toast(err.message || 'Could not delete project.', 'error');
  }
  renderAll();
}

/* ================================================================== */
/* Render: Notes                                                       */
/* ================================================================== */

async function renderNotes() {
  const notes = await noteEngine.listNotes();
  const projects = await projectEngine.listProjects({ includeArchived: true });
  const names = projectLabelMap(projects);
  const list = document.getElementById('note-list');
  clear(list);
  if (!notes.length) {
    list.appendChild(el('li', { className: 'empty-state', text: 'No notes yet — capture an idea with + Note.' }));
    return;
  }
  for (const note of notes) {
    const preview = (note.content || '').slice(0, 160);
    list.appendChild(el('li', { className: 'card' }, [
      el('div', { className: 'card-title-row' }, [
        el('div', { className: 'card-title', text: note.title || (preview.split('\n')[0] || 'Untitled note') }),
        note.isPinned ? el('span', { className: 'pin-flag', text: 'PINNED' }) : null,
      ]),
      preview ? el('p', { className: 'card-desc', text: preview }) : null,
      el('div', { className: 'card-meta' }, [
        note.projectId && names.has(note.projectId)
          ? el('span', { className: 'pill', text: names.get(note.projectId) }) : null,
        ...tagChips(note.tags),
      ]),
      el('div', { className: 'card-actions' }, [
        el('button', { className: 'btn btn-secondary', type: 'button', text: 'Edit', onClick: () => openNoteForm(note) }),
        el('button', {
          className: 'btn btn-secondary', type: 'button', text: note.isPinned ? 'Unpin' : 'Pin',
          onClick: async () => { await noteEngine.togglePin(note.id); renderAll(); },
        }),
        el('button', {
          className: 'btn btn-danger', type: 'button', text: 'Delete', onClick: () => deleteNoteFlow(note),
        }),
      ]),
    ]));
  }
}

async function deleteNoteFlow(note) {
  const yes = await confirmModal({
    title: 'Delete note?',
    message: `"${note.title || 'Untitled note'}" will be permanently removed.`,
    confirmLabel: 'Delete', danger: true,
  });
  if (!yes) return;
  await noteEngine.deleteNote(note.id);
  toast('Note deleted.');
  renderAll();
}

/* ================================================================== */
/* Render: More (storage meter)                                        */
/* ================================================================== */

async function refreshStorageMeter() {
  const usage = await backupEngine.calculateStorageUsage();
  const fill = document.getElementById('storage-fill');
  const text = document.getElementById('storage-text');
  const pct = Math.round(usage.ratio * 100);
  fill.style.width = `${pct}%`;
  fill.className = `meter-fill${usage.warning ? ' warn' : ''}`;
  const mb = (n) => `${(n / (1024 * 1024)).toFixed(2)} MB`;
  text.textContent = `${mb(usage.usedBytes)} used of ~${mb(usage.quotaBytes)} (${pct}%) · source: ${usage.source}`
    + (usage.warning ? ' · WARNING: above 80% — export a backup now.' : '');
  if (usage.warning) {
    showBanner('Storage usage is above 80%. Export a JSON backup and free space to avoid data loss.', 'Export now', () => setView('more'));
  }
}

/* ================================================================== */
/* Forms: Task / Project / Note                                        */
/* ================================================================== */

function formField(labelText, inputNode) {
  return el('div', { className: 'form-field' }, [el('label', { text: labelText }), inputNode]);
}

function selectNode(options, value, ariaLabel) {
  return el('select', { 'aria-label': ariaLabel }, options.map(([v, label]) =>
    el('option', { value: v, text: label, selected: v === value || undefined })));
}

async function openTaskForm(task) {
  const projects = await projectEngine.listProjects();
  const errorLine = el('p', { className: 'form-error', hidden: true });

  const titleInput = el('input', { type: 'text', maxlength: '500', value: task ? task.title : '', 'aria-label': 'Task title' });
  const descInput = el('textarea', { 'aria-label': 'Task description', text: task ? task.description || '' : '' });
  const prioritySel = selectNode([['Urgent', 'Urgent'], ['High', 'High'], ['Medium', 'Medium'], ['Low', 'Low']], task ? task.priority : 'Medium', 'Priority');
  const statusSel = selectNode(
    [['Inbox', 'Inbox'], ['Next Action', 'Next Action'], ['In Progress', 'In Progress'], ['Waiting', 'Waiting'], ['Completed', 'Completed']],
    task ? task.status : 'Inbox', 'Status');
  const dueInput = el('input', { type: 'date', value: task && task.dueDate ? task.dueDate : '', 'aria-label': 'Due date' });
  const tagsInput = el('input', { type: 'text', value: task ? (task.tags || []).join(', ') : '', placeholder: 'comma, separated', 'aria-label': 'Tags' });
  const projectSel = selectNode(
    [['', 'No project'], ...projects.map((p) => [p.id, p.name])],
    task && task.projectId ? task.projectId : '', 'Project');

  const body = el('div', {}, [
    errorLine,
    formField('Title', titleInput),
    formField('Description', descInput),
    formField('Priority', prioritySel),
    formField('Status', statusSel),
    formField('Due date', dueInput),
    formField('Tags', tagsInput),
    formField('Project', projectSel),
  ]);

  const save = async () => {
    try {
      const payload = {
        title: titleInput.value,
        description: descInput.value,
        priority: prioritySel.value,
        status: statusSel.value,
        dueDate: dueInput.value || null,
        tags: taskEngine.parseTags(tagsInput.value),
        projectId: projectSel.value || null,
      };
      if (task) await taskEngine.updateTask(task.id, payload);
      else await taskEngine.createTask(payload);
      closeModal();
      toast(task ? 'Task updated.' : 'Task created.');
      renderAll();
    } catch (err) {
      errorLine.textContent = err.message || 'Invalid input.';
      errorLine.hidden = false;
    }
  };

  openModal({
    title: task ? 'Edit task' : 'New task',
    node: body,
    actions: [
      el('button', { className: 'btn btn-secondary', type: 'button', text: 'Cancel', onClick: closeModal }),
      el('button', { className: 'btn btn-primary', type: 'button', text: 'Save', onClick: save }),
    ],
  });
}

async function openProjectForm(project) {
  const errorLine = el('p', { className: 'form-error', hidden: true });
  const nameInput = el('input', { type: 'text', maxlength: '300', value: project ? project.name : '', 'aria-label': 'Project name' });
  const descInput = el('textarea', { 'aria-label': 'Project description', text: project ? project.description || '' : '' });
  const statusSel = selectNode(
    [['Planning', 'Planning'], ['Active', 'Active'], ['Paused', 'Paused'], ['Completed', 'Completed'], ['Archived', 'Archived']],
    project ? project.status : 'Planning', 'Project status');
  const tagsInput = el('input', { type: 'text', value: project ? (project.tags || []).join(', ') : '', placeholder: 'comma, separated', 'aria-label': 'Tags' });

  const body = el('div', {}, [
    errorLine,
    formField('Name', nameInput),
    formField('Description', descInput),
    formField('Status', statusSel),
    formField('Tags', tagsInput),
  ]);

  const save = async () => {
    try {
      const payload = {
        name: nameInput.value,
        description: descInput.value,
        status: statusSel.value,
        tags: projectEngine.parseTags(tagsInput.value),
      };
      if (project) await projectEngine.updateProject(project.id, payload);
      else await projectEngine.createProject(payload);
      closeModal();
      toast(project ? 'Project updated.' : 'Project created.');
      renderAll();
    } catch (err) {
      errorLine.textContent = err.message || 'Invalid input.';
      errorLine.hidden = false;
    }
  };

  openModal({
    title: project ? 'Edit project' : 'New project',
    node: body,
    actions: [
      el('button', { className: 'btn btn-secondary', type: 'button', text: 'Cancel', onClick: closeModal }),
      el('button', { className: 'btn btn-primary', type: 'button', text: 'Save', onClick: save }),
    ],
  });
}

async function openNoteForm(note) {
  const projects = await projectEngine.listProjects();
  const tasks = await taskEngine.listTasks({ includeCompleted: true });
  const errorLine = el('p', { className: 'form-error', hidden: true });

  const titleInput = el('input', { type: 'text', maxlength: '300', value: note ? note.title : '', 'aria-label': 'Note title' });
  const contentInput = el('textarea', { 'aria-label': 'Note body', text: note ? note.content || '' : '' });
  const tagsInput = el('input', { type: 'text', value: note ? (note.tags || []).join(', ') : '', placeholder: 'comma, separated', 'aria-label': 'Tags' });
  const pinWrap = el('input', { type: 'checkbox', 'aria-label': 'Pin note' });
  pinWrap.checked = Boolean(note && note.isPinned);
  const projectSel = selectNode(
    [['', 'No project'], ...projects.map((p) => [p.id, p.name])],
    note && note.projectId ? note.projectId : '', 'Linked project');
  const taskSel = selectNode(
    [['', 'No task'], ...tasks.map((t) => [t.id, t.title])],
    note && note.taskId ? note.taskId : '', 'Linked task');

  const body = el('div', {}, [
    errorLine,
    formField('Title', titleInput),
    formField('Body', contentInput),
    formField('Tags', tagsInput),
    formField('Pinned', el('div', { className: 'check-wrap' }, [pinWrap])),
    formField('Linked project', projectSel),
    formField('Linked task', taskSel),
  ]);

  const save = async () => {
    try {
      const payload = {
        title: titleInput.value,
        content: contentInput.value,
        tags: noteEngine.parseTags(tagsInput.value),
        isPinned: pinWrap.checked,
        projectId: projectSel.value || null,
        taskId: taskSel.value || null,
      };
      if (note) await noteEngine.updateNote(note.id, payload);
      else await noteEngine.createNote(payload);
      closeModal();
      toast(note ? 'Note updated.' : 'Note created.');
      renderAll();
    } catch (err) {
      errorLine.textContent = err.message || 'Invalid input.';
      errorLine.hidden = false;
    }
  };

  openModal({
    title: note ? 'Edit note' : 'New note',
    node: body,
    actions: [
      el('button', { className: 'btn btn-secondary', type: 'button', text: 'Cancel', onClick: closeModal }),
      el('button', { className: 'btn btn-primary', type: 'button', text: 'Save', onClick: save }),
    ],
  });
}

/* ================================================================== */
/* Global search                                                       */
/* ================================================================== */

let searchTimer = null;

function openSearchPanel() {
  const panel = document.getElementById('search-panel');
  panel.hidden = false;
  document.getElementById('btn-search').setAttribute('aria-expanded', 'true');
  document.getElementById('search-input').focus();
}

function closeSearchPanel() {
  const panel = document.getElementById('search-panel');
  if (panel) panel.hidden = true;
  const btn = document.getElementById('btn-search');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

function renderSnippet(container, snippet, query) {
  const lower = String(snippet).toLowerCase();
  const q = String(query).toLowerCase();
  let idx = lower.indexOf(q);
  let cursor = 0;
  while (idx !== -1) {
    if (idx > cursor) container.appendChild(document.createTextNode(snippet.slice(cursor, idx)));
    const mark = el('mark', { className: 'hit-mark', text: snippet.slice(idx, idx + q.length) });
    container.appendChild(mark);
    cursor = idx + q.length;
    idx = lower.indexOf(q, cursor);
  }
  if (cursor < snippet.length) container.appendChild(document.createTextNode(snippet.slice(cursor)));
}

async function runSearch(query) {
  const container = document.getElementById('search-results');
  clear(container);
  const result = await searchEngine.search(query);
  if (!String(query).trim()) return;

  const groups = [
    ['Tasks', result.results.tasks, 'tasks'],
    ['Projects', result.results.projects, 'projects'],
    ['Notes', result.results.notes, 'notes'],
  ];
  let total = 0;
  for (const [label, hits, targetView] of groups) {
    if (!hits.length) continue;
    total += hits.length;
    container.appendChild(el('p', { className: 'search-group-title', text: `${label} (${hits.length})` }));
    for (const hit of hits.slice(0, 8)) {
      const titleText = hit.entity.title || hit.entity.name
        || String(hit.entity.content || '').split('\n')[0] || 'Untitled';
      const first = hit.matches[0];
      const snippetNode = el('span', { className: 'hit-snippet' });
      renderSnippet(snippetNode, first ? first.snippet : '', query);
      container.appendChild(el('button', {
        className: 'search-hit', type: 'button',
        onClick: () => {
          closeSearchPanel();
          setView(targetView === 'projects' ? 'projects' : targetView === 'notes' ? 'notes' : 'tasks');
        },
      }, [
        el('span', { className: 'hit-title', text: String(titleText) }),
        snippetNode,
      ]));
    }
  }
  if (!total) {
    container.appendChild(el('p', { className: 'hint', text: 'No matches across tasks, projects, or notes.' }));
  }
}

/* ================================================================== */
/* Backup: export / import / reset                                     */
/* ================================================================== */

async function exportFlow() {
  try {
    const { fileName, text } = await backupEngine.exportAsFile();
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = el('a', { href: url, download: fileName });
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast(`Backup exported as ${fileName}`);
  } catch (err) {
    toast(err.message || 'Export failed.', 'error');
  }
}

function importFlow(file) {
  const reader = new FileReader();
  reader.onerror = () => toast('Could not read the selected file.', 'error');
  reader.onload = async () => {
    const yes = await confirmModal({
      title: 'Import backup?',
      message: 'Restoring REPLACES all current tasks, projects, notes and settings with the backup contents. Malformed files are rejected without touching your data.',
      confirmLabel: 'Import & replace',
    });
    if (!yes) return;
    const report = await backupEngine.importData(String(reader.result));
    if (report.ok) {
      const n = report.imported || {};
      toast(`Import complete — ${n.tasks || 0} tasks, ${n.projects || 0} projects, ${n.notes || 0} notes restored.`);
      renderAll();
    } else {
      const body = el('div', {}, [
        el('p', { className: 'hint', text: 'Import rejected — active data untouched. Problems found:' }),
        el('ul', { className: 'card-list' }, report.errors.slice(0, 12).map((msg) =>
          el('li', { className: 'card' }, [el('p', { className: 'card-desc', text: msg })]))),
      ]);
      openModal({
        title: 'Import rejected',
        node: body,
        actions: [el('button', { className: 'btn btn-secondary', type: 'button', text: 'Close', onClick: closeModal })],
      });
    }
  };
  reader.readAsText(file);
}

async function resetFlow() {
  const yes = await confirmModal({
    title: 'Reset ALL data?',
    message: 'Every task, project, note and setting on this device will be permanently erased. This cannot be undone. Export a backup first.',
    confirmLabel: 'Erase everything', danger: true,
  });
  if (!yes) return;
  await backupEngine.resetAllData();
  clearBanner();
  toast('All local data erased.');
  renderAll();
}

/* ================================================================== */
/* Wire static events + boot                                           */
/* ================================================================== */

function renderAll() {
  renderDashboard();
  renderTasks();
  renderProjects();
  renderNotes();
  refreshStorageMeter();
}

function wireEvents() {
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => setView(btn.dataset.view));
  });

  document.getElementById('btn-theme').addEventListener('click', toggleTheme);
  document.getElementById('btn-search').addEventListener('click', () => {
    const panel = document.getElementById('search-panel');
    if (panel.hidden) openSearchPanel();
    else closeSearchPanel();
  });
  document.getElementById('btn-search-close').addEventListener('click', closeSearchPanel);

  const searchInput = document.getElementById('search-input');
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => runSearch(searchInput.value), 160);
  });

  document.getElementById('dash-add-task').addEventListener('click', () => openTaskForm(null));
  document.getElementById('task-add').addEventListener('click', () => openTaskForm(null));
  document.getElementById('project-add').addEventListener('click', () => openProjectForm(null));
  document.getElementById('note-add').addEventListener('click', () => openNoteForm(null));

  const taskSearch = document.getElementById('task-search');
  taskSearch.addEventListener('input', () => {
    state.taskFilter.search = taskSearch.value;
    renderTasks();
  });
  document.getElementById('task-filter-status').addEventListener('change', (event) => {
    state.taskFilter.status = event.target.value;
    renderTasks();
  });
  document.getElementById('task-filter-priority').addEventListener('change', (event) => {
    state.taskFilter.priority = event.target.value;
    renderTasks();
  });
  const taskTag = document.getElementById('task-filter-tag');
  taskTag.addEventListener('input', () => {
    state.taskFilter.tag = taskTag.value.trim();
    renderTasks();
  });

  document.getElementById('btn-export').addEventListener('click', exportFlow);
  document.getElementById('btn-import').addEventListener('click', () => {
    document.getElementById('file-import').click();
  });
  document.getElementById('file-import').addEventListener('change', (event) => {
    const file = event.target.files && event.target.files[0];
    if (file) importFlow(file);
    event.target.value = '';
  });
  document.getElementById('btn-refresh-storage').addEventListener('click', refreshStorageMeter);
  document.getElementById('btn-reset').addEventListener('click', resetFlow);
}

function registerServiceWorker() {
  try {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {
        /* offline shell unavailable (e.g. private mode) — app still works online */
      });
    }
  } catch (_) { /* non-fatal */ }
}

async function boot() {
  const backend = await storage.init();
  initTheme();
  wireEvents();
  renderAll();
  setView('dashboard');
  registerServiceWorker();

  // Storage backend transparency for the About panel / debugging.
  console.info(`[BOSS AI Hub v1.0] ready · storage backend: ${backend} · schemaVersion: ${storage.schemaVersion}`);
}

function showFatal(err) {
  const msg = 'BOSS AI startup error: ' + (err && err.message ? err.message : String(err));
  try {
    const slot = document.getElementById('banner-slot');
    if (slot) {
      clear(slot);
      slot.appendChild(el('div', { className: 'banner' }, [el('span', { className: 'banner-text', text: msg })]));
    }
  } catch (_) { /* ignore */ }
  if (typeof console !== 'undefined') console.error(msg);
}

boot().catch(showFatal);
