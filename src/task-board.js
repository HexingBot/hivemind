// src/task-board.js
// TASK-034 — Kanban task board: zero-dep HTTP server factory.
//
// createBoardServer({ repoRoot }) returns a pre-configured http.Server (not yet
// listening). The caller — bin/task-board.js or an e2e spec — calls server.listen()
// itself, choosing the port. This mirrors the createServer/main split used by
// src/mcp-server.js in TASK-026.
//
// ENDPOINTS:
//   GET /              → 200 HTML (five-column kanban, all assets inline)
//   GET /api/tasks     → 200 JSON array (all task objects, no-cache, live read)
//   POST /api/tasks    → 201 | 400 | 415 | 413 (create a new task)
//   POST /api/tasks/:key/status { status } → 200 | 400 | 404 | 413 | 415
//   GET /graph         → 200 HTML (knowledge graph view)
//   GET /api/graph     → 200 JSON (knowledge graph data)
//   *                  → 404 JSON { error: '...' }   (non-local Host → 403)
//
// ALL mutations flow through src/task-store.js transitionStatus/createTask so the
// atomic-write + index-regeneration invariant is never bypassed. Error-to-HTTP
// mapping:
//   "invalid status"  → 400
//   "unknown task key"→ 404
//   uat-only done-guard / loop-mode close guard / loop-mode uat-delegation
//     guard (UAT_GUARD_REQUIRED / LOOP_CLOSE_GUARD_DENIED /
//     LOOP_UAT_DELEGATION_REQUIRED, TASK-082 / TASK-099) → 403
//
// TASK-099 (AC3) — the status-transition route composes loopModeCloseGuard
// unconditionally (mirroring src/mcp-server.js), so a board POST to `done` in
// an unauthorized loop-mode session is rejected the same way the MCP
// transition_status/close_task tools already reject it, instead of silently
// closing the ticket.
//
// PATH-TRAVERSAL GUARD: the key segment is validated against TASK_FILENAME_RE
// before any store operation (same guard pattern as the MCP get_task handler).
//
// BINDING: the server itself does NOT call listen; the caller decides address +
// port. bin/task-board.js binds 127.0.0.1 only.
//
// REQUEST HARDENING (review follow-ups):
//   - Host header must be 127.0.0.1[:port] or localhost[:port] → otherwise 403
//     (DNS-rebinding/CSRF guard; the page is same-origin so no CORS needed).
//   - POST requires Content-Type: application/json → otherwise 415.
//   - POST body capped at 64 KiB → otherwise 413.
//   - Malformed %-encoding in the key segment → 400, never an uncaught throw.
//
// CORRUPTION POLICY: a corrupt task file (invalid JSON) makes GET /api/tasks
// return 500 — loud by design, per the TASK-009/TASK-018 loud-corruption
// precedent. The board must surface a damaged ticket, never silently skip it.
//
// TASK-074 — removed the web console (chat bridge, skill buttons, status bar,
// mode badge/toggle, app-preview panel). This module now serves ONLY the
// kanban board and the knowledge-graph view.

import http from 'node:http';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { transitionStatus, createTask, TASK_FILENAME_RE } from './task-store.js';
import { loadGraph } from './knowledge-graph.js';
import { loopModeCloseGuard } from './close-guard.js';

// ---------------------------------------------------------------------------
// Internal: read all task files from tasks/ without any caching.
// ---------------------------------------------------------------------------
async function readAllTasksForBoard(repoRoot) {
  const tasksDir = join(repoRoot, 'tasks');
  let entries;
  try {
    entries = await readdir(tasksDir);
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw err;
  }
  const taskFiles = entries.filter((name) => TASK_FILENAME_RE.test(name));
  const out = [];
  for (const name of taskFiles) {
    const raw = await readFile(join(tasksDir, name), 'utf8');
    out.push(JSON.parse(raw));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Internal: send a JSON response.
// ---------------------------------------------------------------------------
function sendJson(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

// ---------------------------------------------------------------------------
// Internal: parse the request body as JSON, resolve with the object or reject
// with a syntax error. Bodies over MAX_BODY_BYTES reject with code
// BODY_TOO_LARGE (mapped to 413 by the handler) — the remaining stream is
// ignored, not destroyed, so the 413 response can still be written.
// ---------------------------------------------------------------------------
const MAX_BODY_BYTES = 64 * 1024;

function readBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      if (tooLarge) return;
      total += chunk.length;
      if (total > maxBytes) {
        tooLarge = true;
        const err = new Error(`request body exceeds ${maxBytes} bytes`);
        err.code = 'BODY_TOO_LARGE';
        reject(err);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) return;
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Internal: Host-header allowlist — local-only names, optional port suffix.
// ---------------------------------------------------------------------------
const ALLOWED_HOST_RE = /^(127\.0\.0\.1|localhost)(:\d+)?$/i;

// ---------------------------------------------------------------------------
// Internal: the inline kanban HTML page (all CSS and JS embedded).
// TASK-054 unified the board with a "New ticket" form + POST /api/tasks client.
// TASK-074 removed the chat/skills/status-bar/preview console shell — this is
// now a plain kanban board page.
//
// XSS discipline: identical to buildGraphHtml() — all task content is rendered
// via document.createElement + .textContent.  innerHTML is ONLY used for the
// empty-string clear of the board columns (innerHTML = '').  No ${…}
// template-literal interpolation of any untrusted value anywhere in this string.
// ---------------------------------------------------------------------------
function buildHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Hivemind Task Board</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: #0d1117;
    --surface: #161b22;
    --border: #30363d;
    --text: #c9d1d9;
    --text-muted: #8b949e;
    --accent: #58a6ff;
    --col-bg: #161b22;
    --col-drag-over: #1c2a3a;
    --card-bg: #21262d;
    --card-border: #30363d;
    --card-drag-border: #58a6ff;
    --priority-critical: #f85149;
    --priority-high: #d29922;
    --priority-medium: #388bfd;
    --priority-low: #8b949e;
    --radius: 8px;
    --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    --mono: ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
    --side-width: 320px;
  }

  body {
    font-family: var(--font);
    background: var(--bg);
    color: var(--text);
    height: 100vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  /* =========================================================================
   * Header bar — branding + nav links
   * ========================================================================= */
  .app-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
    flex-shrink: 0;
    height: 48px;
  }

  .app-header h1 {
    font-size: 1rem;
    font-weight: 700;
    color: var(--text);
    letter-spacing: -0.01em;
  }

  .app-header .tagline {
    font-size: 0.75rem;
    color: var(--text-muted);
    margin-right: auto;
  }

  .header-link {
    font-size: 0.78rem;
    color: var(--accent);
    text-decoration: none;
    padding: 4px 8px;
    border-radius: 4px;
    border: 1px solid var(--border);
  }

  .header-link:hover {
    background: var(--card-bg);
  }

  /* =========================================================================
   * Main layout: sidebar (New Ticket) | board (main)
   * ========================================================================= */
  .console {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  /* =========================================================================
   * Left sidebar — New Ticket
   * ========================================================================= */
  .sidebar-left {
    width: var(--side-width);
    flex-shrink: 0;
    background: var(--surface);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .sidebar-section {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .sidebar-heading {
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    padding: 10px 14px 6px;
    flex-shrink: 0;
  }

  /* =========================================================================
   * New Ticket button + form
   * ========================================================================= */
  .new-ticket-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    width: calc(100% - 28px);
    margin: 0 14px 10px;
    background: var(--accent);
    color: #0d1117;
    border: none;
    border-radius: 6px;
    padding: 8px 12px;
    font-size: 0.83rem;
    font-weight: 700;
    cursor: pointer;
    flex-shrink: 0;
    font-family: var(--font);
    text-align: left;
    transition: background 0.15s;
  }

  .new-ticket-btn:hover {
    background: #79b8ff;
  }

  /* Modal overlay */
  #new-ticket-overlay {
    display: none;
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.65);
    z-index: 100;
    align-items: center;
    justify-content: center;
  }

  #new-ticket-overlay.open {
    display: flex;
  }

  #new-ticket-modal {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 20px;
    width: 480px;
    max-width: 95vw;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .modal-title {
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--text);
  }

  .form-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .form-label {
    font-size: 0.75rem;
    color: var(--text-muted);
    font-weight: 600;
  }

  .form-input,
  .form-select,
  .form-textarea {
    background: #0d1117;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-family: var(--font);
    font-size: 0.83rem;
    padding: 7px 10px;
    outline: none;
    width: 100%;
  }

  .form-input:focus,
  .form-select:focus,
  .form-textarea:focus {
    border-color: var(--accent);
  }

  .form-textarea {
    resize: vertical;
    min-height: 72px;
    line-height: 1.45;
  }

  .form-select {
    cursor: pointer;
  }

  #new-ticket-error {
    font-size: 0.78rem;
    color: var(--priority-critical);
    display: none;
    padding: 6px 10px;
    background: #1e0d0d;
    border: 1px solid #3d1a1a;
    border-radius: 4px;
  }

  .modal-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }

  .btn-cancel {
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-muted);
    font-family: var(--font);
    font-size: 0.83rem;
    padding: 7px 16px;
    cursor: pointer;
  }

  .btn-cancel:hover {
    background: var(--card-bg);
    color: var(--text);
  }

  .btn-submit {
    background: var(--accent);
    border: none;
    border-radius: 6px;
    color: #0d1117;
    font-family: var(--font);
    font-size: 0.83rem;
    font-weight: 700;
    padding: 7px 16px;
    cursor: pointer;
  }

  .btn-submit:hover:not(:disabled) {
    background: #79b8ff;
  }

  .btn-submit:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* =========================================================================
   * Board — centre scrollable kanban
   * ========================================================================= */
  .board-area {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .board-toolbar {
    padding: 8px 14px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .board-toolbar-title {
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }

  #error-banner {
    display: none;
    background: #3d1a1a;
    border-bottom: 1px solid var(--priority-critical);
    color: #fca5a5;
    padding: 8px 14px;
    font-size: 0.83rem;
    flex-shrink: 0;
  }

  .board {
    display: flex;
    gap: 10px;
    padding: 14px;
    overflow-x: auto;
    align-items: flex-start;
    flex: 1;
    min-height: 0;
  }

  .column {
    flex: 0 0 200px;
    min-width: 160px;
    background: var(--col-bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    display: flex;
    flex-direction: column;
    max-height: 100%;
    transition: background 0.15s, border-color 0.15s;
  }

  .column.drag-over {
    background: var(--col-drag-over);
    border-color: var(--accent);
  }

  .column-header {
    padding: 8px 10px 6px;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    position: sticky;
    top: 0;
    background: inherit;
    border-radius: var(--radius) var(--radius) 0 0;
  }

  .column-title {
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
  }

  .column-count {
    background: var(--border);
    color: var(--text-muted);
    font-size: 0.68rem;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 10px;
    min-width: 20px;
    text-align: center;
  }

  .cards {
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 5px;
    overflow-y: auto;
    flex: 1;
    min-height: 40px;
  }

  .card {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: 6px;
    padding: 8px 8px 6px;
    cursor: grab;
    transition: border-color 0.15s, box-shadow 0.15s, opacity 0.15s;
    user-select: none;
  }

  .card:hover {
    border-color: #484f58;
    box-shadow: 0 1px 6px rgba(0,0,0,0.4);
  }

  .card.dragging {
    opacity: 0.45;
    border-color: var(--card-drag-border);
    cursor: grabbing;
  }

  .card-top {
    display: flex;
    align-items: center;
    gap: 5px;
    margin-bottom: 4px;
  }

  .priority-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .priority-dot.critical { background: var(--priority-critical); }
  .priority-dot.high     { background: var(--priority-high); }
  .priority-dot.medium   { background: var(--priority-medium); }
  .priority-dot.low      { background: var(--priority-low); }

  .card-key {
    font-family: var(--mono);
    font-size: 0.68rem;
    color: var(--accent);
    font-weight: 500;
    flex-shrink: 0;
  }

  .card-title {
    font-size: 0.8rem;
    color: var(--text);
    line-height: 1.35;
    word-break: break-word;
  }

  .card-labels {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    margin-top: 5px;
  }

  .label-pill {
    font-size: 0.62rem;
    padding: 1px 5px;
    border-radius: 10px;
    background: #21262d;
    border: 1px solid var(--border);
    color: var(--text-muted);
    white-space: nowrap;
  }

  .empty-col {
    font-size: 0.72rem;
    color: var(--border);
    text-align: center;
    padding: 14px 6px;
    font-style: italic;
  }
</style>
</head>
<body>

<!-- ========================================================================
  Header bar
  ======================================================================== -->
<header class="app-header">
  <h1>Hivemind Task Board</h1>
  <span class="tagline">hivemind · agentic development framework</span>
  <a href="/graph" class="header-link">Knowledge graph</a>
</header>

<!-- ========================================================================
  Board layout
  ======================================================================== -->
<div class="console">

  <!-- LEFT SIDEBAR: New Ticket -->
  <aside class="sidebar-left">
    <div class="sidebar-section" style="flex: 0 0 auto;">
      <div class="sidebar-heading">Tickets</div>
      <button class="new-ticket-btn" id="new-ticket-btn" aria-label="New ticket">+ New ticket</button>
    </div>
  </aside>

  <!-- CENTRE: Kanban board -->
  <main class="board-area">
    <div class="board-toolbar">
      <span class="board-toolbar-title">Board</span>
    </div>
    <div id="error-banner"></div>
    <div class="board" id="board">
      <div class="column" data-status="todo" id="col-todo">
        <div class="column-header">
          <span class="column-title">Todo</span>
          <span class="column-count" id="count-todo">0</span>
        </div>
        <div class="cards" id="cards-todo"></div>
      </div>
      <div class="column" data-status="in_progress" id="col-in_progress">
        <div class="column-header">
          <span class="column-title">In Progress</span>
          <span class="column-count" id="count-in_progress">0</span>
        </div>
        <div class="cards" id="cards-in_progress"></div>
      </div>
      <div class="column" data-status="in_review" id="col-in_review">
        <div class="column-header">
          <span class="column-title">In Review</span>
          <span class="column-count" id="count-in_review">0</span>
        </div>
        <div class="cards" id="cards-in_review"></div>
      </div>
      <div class="column" data-status="blocked" id="col-blocked">
        <div class="column-header">
          <span class="column-title">Blocked</span>
          <span class="column-count" id="count-blocked">0</span>
        </div>
        <div class="cards" id="cards-blocked"></div>
      </div>
      <div class="column" data-status="done" id="col-done">
        <div class="column-header">
          <span class="column-title">Done</span>
          <span class="column-count" id="count-done">0</span>
        </div>
        <div class="cards" id="cards-done"></div>
      </div>
    </div>
  </main>

</div>

<!-- ========================================================================
  New Ticket modal
  ======================================================================== -->
<div id="new-ticket-overlay" role="dialog" aria-modal="true" aria-labelledby="modal-title">
  <div id="new-ticket-modal">
    <div class="modal-title" id="modal-title">New Ticket</div>
    <div class="form-row">
      <label class="form-label" for="nt-title">Title <span style="color:var(--priority-critical)">*</span></label>
      <input class="form-input" id="nt-title" type="text" placeholder="Short description of the work" autocomplete="off">
    </div>
    <div class="form-row">
      <label class="form-label" for="nt-description">Description</label>
      <textarea class="form-textarea" id="nt-description" placeholder="What needs to be done, and why?"></textarea>
    </div>
    <div class="form-row">
      <label class="form-label" for="nt-priority">Priority</label>
      <select class="form-select" id="nt-priority">
        <option value="medium" selected>Medium</option>
        <option value="low">Low</option>
        <option value="high">High</option>
        <option value="critical">Critical</option>
      </select>
    </div>
    <div class="form-row">
      <label class="form-label" for="nt-acs">Acceptance criteria <span style="color:var(--text-muted);font-weight:400">(optional — one per line)</span></label>
      <textarea class="form-textarea" id="nt-acs" placeholder="The feature works as described.&#10;Edge cases are handled."></textarea>
    </div>
    <div id="new-ticket-error"></div>
    <div class="modal-actions">
      <button class="btn-cancel" id="nt-cancel">Cancel</button>
      <button class="btn-submit" id="nt-submit">Create ticket</button>
    </div>
  </div>
</div>

<script>
  // ---------------------------------------------------------------------------
  // Board logic
  // ---------------------------------------------------------------------------
  const STATUSES = ['todo', 'in_progress', 'in_review', 'blocked', 'done'];

  const errBanner = document.getElementById('error-banner');
  function showError(msg) {
    errBanner.textContent = msg;
    errBanner.style.display = 'block';
    setTimeout(() => { errBanner.style.display = 'none'; }, 5000);
  }

  function priorityClass(p) {
    return ['critical', 'high', 'medium', 'low'].includes(p) ? p : 'low';
  }

  function buildCard(task) {
    const card = document.createElement('div');
    card.className = 'card';
    card.draggable = true;
    card.dataset.key = task.key;

    const top = document.createElement('div');
    top.className = 'card-top';

    const dot = document.createElement('span');
    dot.className = 'priority-dot ' + priorityClass(task.priority);
    top.appendChild(dot);

    const key = document.createElement('span');
    key.className = 'card-key';
    key.textContent = task.key;
    top.appendChild(key);

    card.appendChild(top);

    const title = document.createElement('div');
    title.className = 'card-title';
    title.textContent = task.title || '(no title)';
    card.appendChild(title);

    if (Array.isArray(task.labels) && task.labels.length > 0) {
      const labels = document.createElement('div');
      labels.className = 'card-labels';
      for (const lbl of task.labels) {
        const pill = document.createElement('span');
        pill.className = 'label-pill';
        pill.textContent = lbl;
        labels.appendChild(pill);
      }
      card.appendChild(labels);
    }

    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', task.key);
      e.dataTransfer.effectAllowed = 'move';
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
    });

    return card;
  }

  function render(tasks) {
    for (const status of STATUSES) {
      const container = document.getElementById('cards-' + status);
      const counter = document.getElementById('count-' + status);
      container.innerHTML = '';
      const group = tasks.filter((t) => t.status === status);
      counter.textContent = group.length;
      if (group.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-col';
        empty.textContent = 'Drop cards here';
        container.appendChild(empty);
      } else {
        for (const t of group) {
          container.appendChild(buildCard(t));
        }
      }
    }
  }

  async function fetchAndRender() {
    try {
      const res = await fetch('/api/tasks');
      if (!res.ok) { showError('Failed to fetch tasks: ' + res.status); return; }
      const tasks = await res.json();
      render(tasks);
    } catch (err) {
      showError('Failed to fetch tasks: ' + (err.message || 'network error'));
    }
  }

  async function postTransition(key, status) {
    const res = await fetch('/api/tasks/' + encodeURIComponent(key) + '/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      let msg = 'Transition failed (' + res.status + ')';
      try { const b = await res.json(); msg = b.error || msg; } catch {}
      showError(msg);
    }
    await fetchAndRender();
  }

  // Wire columns: dragover + drop.
  for (const status of STATUSES) {
    const col = document.getElementById('col-' + status);
    col.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      col.classList.add('drag-over');
    });
    col.addEventListener('dragleave', (e) => {
      if (!col.contains(e.relatedTarget)) col.classList.remove('drag-over');
    });
    col.addEventListener('drop', (e) => {
      e.preventDefault();
      col.classList.remove('drag-over');
      const key = e.dataTransfer.getData('text/plain');
      if (key) postTransition(key, status);
    });
  }

  fetchAndRender();

  // ---------------------------------------------------------------------------
  // New Ticket form — TASK-054
  //
  // XSS discipline: form values are sent as JSON to POST /api/tasks; the minted
  // key returned by the server is set via .textContent — never innerHTML.
  // ---------------------------------------------------------------------------
  var overlay = document.getElementById('new-ticket-overlay');
  var ntTitle = document.getElementById('nt-title');
  var ntDesc = document.getElementById('nt-description');
  var ntPriority = document.getElementById('nt-priority');
  var ntAcs = document.getElementById('nt-acs');
  var ntError = document.getElementById('new-ticket-error');
  var ntSubmit = document.getElementById('nt-submit');

  function openNewTicketModal() {
    ntTitle.value = '';
    ntDesc.value = '';
    ntPriority.value = 'medium';
    ntAcs.value = '';
    ntError.style.display = 'none';
    ntError.textContent = '';
    ntSubmit.disabled = false;
    overlay.classList.add('open');
    ntTitle.focus();
  }

  function closeNewTicketModal() {
    overlay.classList.remove('open');
  }

  document.getElementById('new-ticket-btn').addEventListener('click', openNewTicketModal);
  document.getElementById('nt-cancel').addEventListener('click', closeNewTicketModal);
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) closeNewTicketModal();
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && overlay.classList.contains('open')) closeNewTicketModal();
  });

  async function submitNewTicket() {
    var title = ntTitle.value.trim();
    if (!title) {
      ntError.textContent = 'Title is required.';
      ntError.style.display = 'block';
      ntTitle.focus();
      return;
    }

    // Parse acceptance criteria: split by newline, drop empty lines.
    var acsRaw = ntAcs.value.trim();
    var acceptance_criteria = acsRaw
      ? acsRaw.split('\\n').map(function(s) { return s.trim(); }).filter(Boolean)
      : [];

    ntSubmit.disabled = true;
    ntError.style.display = 'none';

    try {
      var res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title,
          description: ntDesc.value.trim(),
          priority: ntPriority.value,
          acceptance_criteria: acceptance_criteria.length ? acceptance_criteria : undefined,
        }),
      });
      var data = await res.json();
      if (!res.ok) {
        ntError.textContent = data.error || ('Create failed (' + res.status + ')');
        ntError.style.display = 'block';
        ntSubmit.disabled = false;
        return;
      }
      // Success: close modal, refresh board.
      closeNewTicketModal();
      await fetchAndRender();
    } catch (err) {
      ntError.textContent = err.message || 'network error';
      ntError.style.display = 'block';
      ntSubmit.disabled = false;
    }
  }

  ntSubmit.addEventListener('click', submitNewTicket);
  document.getElementById('new-ticket-modal').addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submitNewTicket();
  });
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Internal: the inline graph view HTML page (all CSS and JS embedded).
// XSS discipline: this is a static template — no ${ interpolation anywhere.
// The route handler injects graph data by replacing the __GRAPH_DATA__ sentinel
// (bare, exactly as it appears inside the <script> data island in the template)
// with the JSON-serialized graph object. The JSON is script-context-escaped
// before injection: every "<" becomes the JSON string escape backslash-u003c,
// which keeps the JSON valid but makes a "</script>" or "<!--" breakout
// impossible inside the island.
// Both sentinel replacements use replacement FUNCTIONS so String.replace's
// special $-patterns ($&, $`, $') in node labels cannot corrupt the output.
// The client-side script reads from that island using textContent (safe) and
// builds the DOM exclusively with document.createElement and .textContent.
// innerHTML is used only for the empty-string clear (root.innerHTML = '').
// ---------------------------------------------------------------------------
const GRAPH_DATA_SENTINEL = '__GRAPH_DATA__';

function buildGraphHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Knowledge Graph</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0d1117;
    --surface: #161b22;
    --border: #30363d;
    --text: #c9d1d9;
    --text-muted: #8b949e;
    --accent: #58a6ff;
    --card-bg: #21262d;
    --radius: 8px;
    --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    --mono: ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
  }
  body {
    font-family: var(--font);
    background: var(--bg);
    color: var(--text);
    min-height: 100vh;
    padding: 16px;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 20px;
    border-bottom: 1px solid var(--border);
    padding-bottom: 12px;
  }
  header h1 { font-size: 1.25rem; font-weight: 600; }
  header a { font-size: 0.85rem; color: var(--accent); text-decoration: none; }
  header a:hover { text-decoration: underline; }
  .empty-state {
    text-align: center;
    color: var(--text-muted);
    margin-top: 60px;
    font-size: 0.95rem;
  }
  .type-group { margin-bottom: 28px; }
  .type-heading {
    font-size: 0.78rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
    margin-bottom: 10px;
    border-bottom: 1px solid var(--border);
    padding-bottom: 6px;
  }
  .node-card {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 10px 14px;
    margin-bottom: 8px;
  }
  .node-id { font-family: var(--mono); font-size: 0.75rem; color: var(--accent); font-weight: 500; }
  .node-label { font-size: 0.88rem; color: var(--text); margin-top: 2px; }
  .node-ref { font-size: 0.72rem; color: var(--text-muted); margin-top: 2px; font-family: var(--mono); }
  .edges-heading {
    font-size: 0.72rem; color: var(--text-muted); margin-top: 8px; margin-bottom: 4px;
    font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;
  }
  .edge-item {
    font-size: 0.78rem; color: var(--text);
    padding: 2px 0 2px 10px; border-left: 2px solid var(--border); margin-bottom: 2px;
  }
  .edge-relation { font-family: var(--mono); color: var(--accent); font-size: 0.72rem; }
  .edge-peer { color: var(--text-muted); font-family: var(--mono); font-size: 0.72rem; }
</style>
</head>
<body>
<header>
  <div><h1>Knowledge Graph</h1></div>
  <a href="/">Task Board</a>
</header>
<script id="graph-data" type="application/json">__GRAPH_DATA__</script>
<div id="graph-root"><!--__GRAPH_BODY__--></div>
<script>
  var graph = JSON.parse(document.getElementById('graph-data').textContent);
  var root = document.getElementById('graph-root');

  function makeEl(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function render(g) {
    root.innerHTML = '';
    var nodes = g.nodes || [];
    var edges = g.edges || [];

    if (nodes.length === 0) {
      root.appendChild(makeEl('div', 'empty-state',
        'No nodes in graph. Add knowledge entries, tasks, decisions, or skills to get started.'));
      return;
    }

    var typeOrder = ['knowledge_entry', 'task', 'decision', 'skill'];
    var types = [];
    var seen = {};
    for (var i = 0; i < typeOrder.length; i++) {
      var t = typeOrder[i];
      for (var j = 0; j < nodes.length; j++) {
        if (nodes[j].type === t && !seen[t]) { types.push(t); seen[t] = true; break; }
      }
    }
    for (var k = 0; k < nodes.length; k++) {
      if (!seen[nodes[k].type]) { types.push(nodes[k].type); seen[nodes[k].type] = true; }
    }

    for (var ti = 0; ti < types.length; ti++) {
      var typeName = types[ti];
      var group = nodes.filter(function(n) { return n.type === typeName; });
      if (group.length === 0) continue;

      var section = makeEl('div', 'type-group');
      section.appendChild(makeEl('div', 'type-heading', typeName));

      for (var ni = 0; ni < group.length; ni++) {
        var node = group[ni];
        var card = makeEl('div', 'node-card');
        card.appendChild(makeEl('div', 'node-id', node.id));
        if (node.label) card.appendChild(makeEl('div', 'node-label', node.label));
        if (node.ref) card.appendChild(makeEl('div', 'node-ref', node.ref));

        var nodeEdges = edges.filter(function(e) { return e.from === node.id || e.to === node.id; });
        if (nodeEdges.length > 0) {
          card.appendChild(makeEl('div', 'edges-heading', 'Edges'));
          for (var ei = 0; ei < nodeEdges.length; ei++) {
            var edge = nodeEdges[ei];
            var item = makeEl('div', 'edge-item');
            var isOut = edge.from === node.id;
            var peer = isOut ? edge.to : edge.from;
            var arrow = isOut ? 'out: ' : 'in: ';
            var relSpan = makeEl('span', 'edge-relation', arrow + edge.relation + ' ');
            var peerSpan = makeEl('span', 'edge-peer', peer);
            item.appendChild(relSpan);
            item.appendChild(peerSpan);
            card.appendChild(item);
          }
        }
        section.appendChild(card);
      }
      root.appendChild(section);
    }
  }

  render(graph);
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Internal: build a server-side pre-rendered body for the graph view.
// This output is safe (no user-controlled HTML injection) because all node
// ids, labels, refs, and edge relation values are controlled by the store's
// schema validation. We escape < and & as a belt-and-suspenders measure.
// ---------------------------------------------------------------------------
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildGraphBody(graphObj) {
  const nodes = (graphObj && graphObj.nodes) || [];
  const edges = (graphObj && graphObj.edges) || [];

  if (nodes.length === 0) {
    return '<div class="empty-state">No nodes in graph. Add knowledge entries, tasks, decisions, or skills to get started.</div>';
  }

  const typeOrder = ['knowledge_entry', 'task', 'decision', 'skill'];
  const seen = new Set();
  const types = [];
  for (const t of typeOrder) {
    if (nodes.some((n) => n.type === t)) { types.push(t); seen.add(t); }
  }
  for (const n of nodes) {
    if (!seen.has(n.type)) { types.push(n.type); seen.add(n.type); }
  }

  let html = '';
  for (const typeName of types) {
    const group = nodes.filter((n) => n.type === typeName);
    if (group.length === 0) continue;
    html += '<div class="type-group">';
    html += '<div class="type-heading">' + escHtml(typeName) + '</div>';
    for (const node of group) {
      html += '<div class="node-card">';
      html += '<div class="node-id">' + escHtml(node.id) + '</div>';
      if (node.label) html += '<div class="node-label">' + escHtml(node.label) + '</div>';
      if (node.ref) html += '<div class="node-ref">' + escHtml(node.ref) + '</div>';
      const nodeEdges = edges.filter((e) => e.from === node.id || e.to === node.id);
      if (nodeEdges.length > 0) {
        html += '<div class="edges-heading">Edges</div>';
        for (const edge of nodeEdges) {
          const isOut = edge.from === node.id;
          const peer = isOut ? edge.to : edge.from;
          const arrow = isOut ? 'out: ' : 'in: ';
          html += '<div class="edge-item">';
          html += '<span class="edge-relation">' + escHtml(arrow + edge.relation) + ' </span>';
          html += '<span class="edge-peer">' + escHtml(peer) + '</span>';
          html += '</div>';
        }
      }
      html += '</div>';
    }
    html += '</div>';
  }
  return html;
}

const GRAPH_BODY_SENTINEL = '<!--__GRAPH_BODY__-->';

// ---------------------------------------------------------------------------
// Internal: inject graph data into the graph HTML template by replacing the
// sentinel placeholder with the serialized graph JSON and pre-rendering the
// body content server-side so node ids / edge relations appear in the raw HTML
// (required by AC8 tests which fetch the HTML without executing JS).
//
// SCRIPT-CONTEXT ESCAPING: the serialized JSON has every "<" replaced with
// the JSON string escape backslash-u003c BEFORE injection. The JSON stays
// byte-for-byte semantically identical after JSON.parse, but the island can
// never contain a literal "</script>" or "<!--" sequence, so a hostile node
// label cannot break out of the data island's script element.
//
// REPLACEMENT FUNCTIONS: both .replace calls pass a function, not a string.
// String-form replacements interpret $-patterns ($&, $`, $') in the
// replacement text, which would corrupt the output for labels containing "$".
// ---------------------------------------------------------------------------
function injectGraphData(graphObj) {
  const template = buildGraphHtml();
  const json = JSON.stringify(graphObj).replace(/</g, '\\u003c');
  const body = buildGraphBody(graphObj);
  return template
    .replace(GRAPH_DATA_SENTINEL, () => json)
    .replace(GRAPH_BODY_SENTINEL, () => body);
}

// ---------------------------------------------------------------------------
// Public factory — returns an http.Server (pre-listen).
//
// Options:
//   repoRoot  {string}  — project root for task reads + mutations
// ---------------------------------------------------------------------------
export function createBoardServer({ repoRoot } = {}) {
  const html = buildHtml();
  const htmlBytes = Buffer.from(html, 'utf8');

  const server = http.createServer(async (req, res) => {
    try {
      // HOST GUARD — reject anything not addressed to a local-only hostname
      // (DNS-rebinding/CSRF hardening). Checked before any routing.
      const hostHeader = req.headers.host || '';
      if (!ALLOWED_HOST_RE.test(hostHeader)) {
        sendJson(res, 403, { error: `forbidden host: ${hostHeader || '(missing)'}` });
        return;
      }

      // URL parse inside the try so a malformed request line maps to the
      // catch-all error response instead of an uncaught throw.
      const url = new URL(req.url, 'http://localhost');
      const pathname = url.pathname;

      // GET / — serve the kanban HTML.
      if (req.method === 'GET' && pathname === '/') {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Length': htmlBytes.length,
        });
        res.end(htmlBytes);
        return;
      }

      // GET /api/tasks — return all tasks as JSON (no caching).
      if (req.method === 'GET' && pathname === '/api/tasks') {
        const tasks = await readAllTasksForBoard(repoRoot);
        sendJson(res, 200, tasks);
        return;
      }

      // POST /api/tasks — create a new task via the task-store.
      // Body: { title, description, priority, acceptance_criteria? }
      // Validation mirrors the status-transition route hardening pattern.
      if (req.method === 'POST' && pathname === '/api/tasks') {
        // CONTENT-TYPE GUARD
        const contentType = req.headers['content-type'] || '';
        if (!/application\/json/i.test(contentType)) {
          sendJson(res, 415, {
            error: `Content-Type must be application/json, got: ${contentType || '(missing)'}`,
          });
          return;
        }

        let body;
        try {
          body = await readBody(req);
        } catch (err) {
          if (err && err.code === 'BODY_TOO_LARGE') {
            sendJson(res, 413, { error: err.message });
          } else {
            sendJson(res, 400, { error: 'invalid JSON body' });
          }
          return;
        }

        // Server-side validation — fail fast before touching disk.
        const { title, description = '', priority, acceptance_criteria } = body;

        if (!title || typeof title !== 'string' || !title.trim()) {
          sendJson(res, 400, { error: 'title must be a non-empty string' });
          return;
        }

        const VALID_PRIORITIES = ['low', 'medium', 'high', 'critical'];
        if (!priority || !VALID_PRIORITIES.includes(priority)) {
          sendJson(res, 400, {
            error: `priority must be one of ${VALID_PRIORITIES.join(', ')}; got: ${JSON.stringify(priority)}`,
          });
          return;
        }

        // Apply AC default when acceptance_criteria absent or empty.
        const DEFAULT_AC = ['The task is complete when the described work is done.'];
        const resolvedACs =
          Array.isArray(acceptance_criteria) && acceptance_criteria.length > 0
            ? acceptance_criteria
            : DEFAULT_AC;

        try {
          const { key } = await createTask({
            repoRoot,
            title: title.trim(),
            description: typeof description === 'string' ? description : '',
            priority,
            acceptance_criteria: resolvedACs,
          });
          sendJson(res, 201, { ok: true, key });
        } catch (err) {
          // createTask throws for validation errors (bad priority, empty AC, etc.)
          // as well as disk errors. Only bubble disk errors to 500; validation
          // errors (which should have been caught above) stay 400.
          const msg = (err && err.message) || 'create failed';
          if (/invalid priority|acceptance_criteria|invalid verification_tier/.test(msg)) {
            sendJson(res, 400, { error: msg });
          } else {
            sendJson(res, 500, { error: msg });
          }
        }
        return;
      }

      // POST /api/tasks/:key/status — transition status.
      const statusRouteRe = /^\/api\/tasks\/([^/]+)\/status$/;
      const statusMatch = statusRouteRe.exec(pathname);
      if (req.method === 'POST' && statusMatch) {
        // CONTENT-TYPE GUARD — the mutation endpoint only speaks JSON.
        const contentType = req.headers['content-type'] || '';
        if (!/application\/json/i.test(contentType)) {
          sendJson(res, 415, {
            error: `Content-Type must be application/json, got: ${contentType || '(missing)'}`,
          });
          return;
        }

        // Malformed %-encoding in the key segment → 400, never a throw.
        let rawKey;
        try {
          rawKey = decodeURIComponent(statusMatch[1]);
        } catch {
          sendJson(res, 400, { error: 'malformed percent-encoding in task key' });
          return;
        }

        // PATH-TRAVERSAL GUARD: key must match TASK_FILENAME_RE-compatible pattern.
        // TASK_FILENAME_RE is /^TASK-(\d{3,})\.json$/ — we strip the .json suffix
        // to get the key shape TASK-NNN.
        const KEY_RE = /^TASK-\d{3,}$/;
        if (!KEY_RE.test(rawKey)) {
          sendJson(res, 404, { error: `unknown task key: ${rawKey}` });
          return;
        }

        let body;
        try {
          body = await readBody(req);
        } catch (err) {
          if (err && err.code === 'BODY_TOO_LARGE') {
            sendJson(res, 413, { error: err.message });
          } else {
            sendJson(res, 400, { error: 'invalid JSON body' });
          }
          return;
        }

        const { status } = body;
        if (!status || typeof status !== 'string') {
          sendJson(res, 400, { error: 'body must include a `status` string' });
          return;
        }

        try {
          // TASK-099 (AC3) — loopModeCloseGuard is composed unconditionally,
          // mirroring src/mcp-server.js's transition_status/close_task tools:
          // it decides for itself whether loop mode is even active (getMode
          // defaults to 'harness', a no-op), so this is safe in harness mode
          // / with no active session and only bites when status === 'done'
          // AND loop mode is active AND unauthorized.
          await transitionStatus({
            repoRoot, key: rawKey, status, closeGuard: loopModeCloseGuard,
          });
          sendJson(res, 200, { ok: true, key: rawKey, status });
        } catch (err) {
          const code = err && err.code;
          const msg = (err && err.message) || 'transition failed';
          // Map store errors to HTTP status codes:
          //   "invalid status ..."  → 400
          //   "unknown task key: ..." → 404
          //   UAT_GUARD_REQUIRED / LOOP_CLOSE_GUARD_DENIED /
          //     LOOP_UAT_DELEGATION_REQUIRED (TASK-082 / TASK-099 guards) → 403
          if (
            code === 'UAT_GUARD_REQUIRED'
            || code === 'LOOP_CLOSE_GUARD_DENIED'
            || code === 'LOOP_UAT_DELEGATION_REQUIRED'
          ) {
            sendJson(res, 403, { error: msg });
          } else if (/invalid status/.test(msg)) {
            sendJson(res, 400, { error: msg });
          } else if (/unknown task key/.test(msg)) {
            sendJson(res, 404, { error: msg });
          } else {
            sendJson(res, 500, { error: msg });
          }
        }
        return;
      }

      // GET /graph — serve the knowledge graph HTML page with server-side graph data.
      // Absent graph.json → empty graph (200, never crash).
      // Corrupt graph.json → 500 (loud by design, same precedent as /api/tasks).
      if (req.method === 'GET' && pathname === '/graph') {
        const graph = await loadGraph({ repoRoot });
        const page = injectGraphData(graph);
        const pageBytes = Buffer.from(page, 'utf8');
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Length': pageBytes.length,
        });
        res.end(pageBytes);
        return;
      }

      // GET /api/graph — return the graph as JSON (absent file → empty graph; corrupt → 500).
      if (req.method === 'GET' && pathname === '/api/graph') {
        const graph = await loadGraph({ repoRoot });
        sendJson(res, 200, graph);
        return;
      }

      // 404 for everything else.
      sendJson(res, 404, { error: `not found: ${pathname}` });
    } catch (err) {
      const msg = (err && err.message) || 'internal server error';
      sendJson(res, 500, { error: msg });
    }
  });

  return server;
}
