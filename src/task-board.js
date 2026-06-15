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
//   POST /api/tasks/:key/status { status } → 200 | 400 | 404 | 413 | 415
//   *                  → 404 JSON { error: '...' }   (non-local Host → 403)
//
// ALL mutations flow through src/task-store.js transitionStatus so the atomic-
// write + index-regeneration invariant is never bypassed. Error-to-HTTP mapping:
//   "invalid status"  → 400
//   "unknown task key"→ 404
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

import http from 'node:http';
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { transitionStatus, TASK_FILENAME_RE } from './task-store.js';
import { loadGraph } from './knowledge-graph.js';
import { createSessionManager, SESSION_ID_RE } from './orchestrator-bridge.js';
import { listSkills, resolveSkillInvocation } from './skill-catalog.js';

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
// TASK-052: extends the board with a side-by-side chat panel that consumes
// the TASK-051 streaming endpoints (/api/chat/:sessionId and /api/chat/:sessionId/stream).
//
// XSS discipline: identical to buildGraphHtml() — all stream/user content is
// rendered via document.createElement + .textContent.  innerHTML is ONLY used
// for the empty-string clear of the board columns (innerHTML = '').  No ${…}
// template-literal interpolation of any untrusted value anywhere in this string.
// The chat panel client-side session id is generated by crypto.randomUUID() and
// stored as a module-scope const — it is never injected server-side.
// ---------------------------------------------------------------------------
function buildHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Task Board</title>
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
    --col-hover: #1f2937;
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
    --chat-width: 360px;
    --chip-tool: #d29922;
    --chip-subagent: #388bfd;
    --chip-error: #f85149;
  }

  body {
    font-family: var(--font);
    background: var(--bg);
    color: var(--text);
    min-height: 100vh;
    padding: 16px;
    display: flex;
    flex-direction: column;
  }

  header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 20px;
    border-bottom: 1px solid var(--border);
    padding-bottom: 12px;
    flex-shrink: 0;
  }

  header h1 {
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--text);
  }

  header .subtitle {
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  #error-banner {
    display: none;
    background: #3d1a1a;
    border: 1px solid var(--priority-critical);
    border-radius: var(--radius);
    color: #fca5a5;
    padding: 10px 14px;
    margin-bottom: 12px;
    font-size: 0.85rem;
    flex-shrink: 0;
  }

  /* Main content area: board + chat side by side */
  .main-layout {
    display: flex;
    gap: 16px;
    flex: 1;
    min-height: 0;
    align-items: flex-start;
  }

  .board-area {
    flex: 1;
    min-width: 0;
  }

  .board {
    display: flex;
    gap: 12px;
    overflow-x: auto;
    align-items: flex-start;
    padding-bottom: 8px;
  }

  .column {
    flex: 0 0 220px;
    min-width: 180px;
    background: var(--col-bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    display: flex;
    flex-direction: column;
    max-height: calc(100vh - 120px);
    transition: background 0.15s, border-color 0.15s;
  }

  .column.drag-over {
    background: var(--col-drag-over);
    border-color: var(--accent);
  }

  .column-header {
    padding: 10px 12px 8px;
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
    font-size: 0.78rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
  }

  .column-count {
    background: var(--border);
    color: var(--text-muted);
    font-size: 0.7rem;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 10px;
    min-width: 20px;
    text-align: center;
  }

  .cards {
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    overflow-y: auto;
    flex: 1;
    min-height: 48px;
  }

  .card {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: 6px;
    padding: 10px 10px 8px;
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
    gap: 6px;
    margin-bottom: 5px;
  }

  .priority-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .priority-dot.critical { background: var(--priority-critical); }
  .priority-dot.high     { background: var(--priority-high); }
  .priority-dot.medium   { background: var(--priority-medium); }
  .priority-dot.low      { background: var(--priority-low); }

  .card-key {
    font-family: var(--mono);
    font-size: 0.7rem;
    color: var(--accent);
    font-weight: 500;
    flex-shrink: 0;
  }

  .card-title {
    font-size: 0.82rem;
    color: var(--text);
    line-height: 1.35;
    word-break: break-word;
  }

  .card-labels {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 6px;
  }

  .label-pill {
    font-size: 0.65rem;
    padding: 1px 6px;
    border-radius: 10px;
    background: #21262d;
    border: 1px solid var(--border);
    color: var(--text-muted);
    white-space: nowrap;
  }

  .empty-col {
    font-size: 0.75rem;
    color: var(--border);
    text-align: center;
    padding: 16px 8px;
    font-style: italic;
  }

  /* -------------------------------------------------------------------------
   * Chat panel — TASK-052
   * XSS note: all message content goes through .textContent, never innerHTML.
   * ------------------------------------------------------------------------- */
  #chat-panel {
    flex: 0 0 var(--chat-width);
    width: var(--chat-width);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    display: flex;
    flex-direction: column;
    height: calc(100vh - 120px);
    position: sticky;
    top: 16px;
  }

  .chat-header {
    padding: 10px 12px 8px;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-radius: var(--radius) var(--radius) 0 0;
    flex-shrink: 0;
  }

  .chat-title {
    font-size: 0.78rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
  }

  .chat-status {
    font-size: 0.7rem;
    color: var(--text-muted);
    font-family: var(--mono);
  }

  .chat-status.streaming {
    color: var(--accent);
  }

  .chat-status.error {
    color: var(--chip-error);
  }

  #chat-messages {
    flex: 1;
    overflow-y: auto;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 0;
  }

  .chat-bubble {
    max-width: 90%;
    border-radius: 6px;
    padding: 7px 10px;
    font-size: 0.83rem;
    line-height: 1.45;
    word-break: break-word;
  }

  .chat-bubble.user {
    background: #1c2a3a;
    border: 1px solid #2a3f56;
    color: var(--text);
    align-self: flex-end;
  }

  .chat-bubble.assistant {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    color: var(--text);
    align-self: flex-start;
  }

  .chat-chip {
    font-size: 0.72rem;
    font-family: var(--mono);
    padding: 3px 8px;
    border-radius: 10px;
    align-self: flex-start;
    border: 1px solid transparent;
  }

  .chat-chip.tool {
    color: var(--chip-tool);
    border-color: #3d2f0a;
    background: #231b06;
  }

  .chat-chip.subagent {
    color: var(--chip-subagent);
    border-color: #1a2a4a;
    background: #0d1a2e;
  }

  .chat-chip.error {
    color: var(--chip-error);
    border-color: #3d1a1a;
    background: #1e0d0d;
  }

  .chat-chip.conn-lost {
    color: var(--text-muted);
    border-color: var(--border);
    background: transparent;
    font-style: italic;
  }

  .chat-input-row {
    padding: 10px;
    border-top: 1px solid var(--border);
    display: flex;
    gap: 8px;
    align-items: flex-end;
    flex-shrink: 0;
  }

  #chat-input {
    flex: 1;
    background: #0d1117;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-family: var(--font);
    font-size: 0.83rem;
    padding: 7px 10px;
    resize: none;
    min-height: 36px;
    max-height: 100px;
    outline: none;
    line-height: 1.4;
  }

  #chat-input:focus {
    border-color: var(--accent);
  }

  #chat-input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  #chat-send {
    background: var(--accent);
    color: #0d1117;
    border: none;
    border-radius: 6px;
    padding: 7px 14px;
    font-size: 0.83rem;
    font-weight: 600;
    cursor: pointer;
    flex-shrink: 0;
    font-family: var(--font);
  }

  #chat-send:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  #chat-send:not(:disabled):hover {
    background: #79b8ff;
  }

  /* -------------------------------------------------------------------------
   * Skills panel — TASK-053
   * Shows one button per vetted skill from the catalog.
   * Clicking a button invokes the skill via POST /api/chat/:sessionId/skill.
   * ------------------------------------------------------------------------- */
  #skills-panel {
    flex: 0 0 var(--chat-width);
    width: var(--chat-width);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    display: flex;
    flex-direction: column;
    max-height: calc(100vh - 120px);
    position: sticky;
    top: 16px;
    overflow: hidden;
  }

  .skills-header {
    padding: 10px 12px 8px;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-radius: var(--radius) var(--radius) 0 0;
    flex-shrink: 0;
  }

  .skills-title {
    font-size: 0.78rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
  }

  #skills-list {
    flex: 1;
    overflow-y: auto;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-height: 0;
  }

  .skill-btn {
    width: 100%;
    text-align: left;
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: 6px;
    color: var(--text);
    font-family: var(--font);
    font-size: 0.83rem;
    padding: 8px 10px;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
    word-break: break-word;
  }

  .skill-btn:hover:not(:disabled) {
    border-color: var(--accent);
    background: #1c2a3a;
  }

  .skill-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  #skills-error {
    font-size: 0.75rem;
    color: var(--chip-error);
    padding: 6px 10px;
    display: none;
    flex-shrink: 0;
    border-top: 1px solid var(--border);
  }
</style>
</head>
<body>
<header>
  <div>
    <h1>Task Board</h1>
    <div class="subtitle">Drag cards between columns to update status</div>
  </div>
</header>
<div id="error-banner"></div>
<div class="main-layout">
  <div class="board-area">
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
  </div>
  <!-- TASK-053: Skills panel — vetted catalog of orchestrator actions -->
  <div id="skills-panel">
    <div class="skills-header">
      <span class="skills-title">Actions</span>
    </div>
    <div id="skills-list"></div>
    <div id="skills-error"></div>
  </div>
  <!-- TASK-052: Chat panel — layout placeholder; full unified OS layout is TASK-054 -->
  <div id="chat-panel">
    <div class="chat-header">
      <span class="chat-title">Orchestrator</span>
      <span class="chat-status" id="chat-status">idle</span>
    </div>
    <div id="chat-messages"></div>
    <div class="chat-input-row">
      <textarea id="chat-input" rows="1" placeholder="Send a message..." aria-label="Chat message"></textarea>
      <button id="chat-send">Send</button>
    </div>
  </div>
</div>
<script>
  // ---------------------------------------------------------------------------
  // Board logic (unchanged from original)
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
    const res = await fetch('/api/tasks');
    if (!res.ok) { showError('Failed to fetch tasks: ' + res.status); return; }
    const tasks = await res.json();
    render(tasks);
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
  // Chat panel — TASK-052
  //
  // XSS discipline: all message/event text is rendered via document.createElement
  // + .textContent.  innerHTML is NEVER used with stream or user content.
  // Per-tab session id: generated once via crypto.randomUUID() and reused for
  // the lifetime of this tab so conversation continuity is preserved.
  // ---------------------------------------------------------------------------

  // Per-tab session id — matches SESSION_ID_RE /^[A-Za-z0-9_-]{1,64}$/
  // crypto.randomUUID() returns xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx (36 chars)
  // Prefix "tab-" makes it 40 chars total, well within the 64-char limit.
  const sessionId = 'tab-' + crypto.randomUUID();

  const chatMessages = document.getElementById('chat-messages');
  const chatInput = document.getElementById('chat-input');
  const chatSend = document.getElementById('chat-send');
  const chatStatusEl = document.getElementById('chat-status');

  // Current streaming assistant bubble (created on first text chunk of a turn,
  // appended to on subsequent text chunks, finalized on turn-end).
  var currentAssistantBubble = null;

  function setChatStatus(text, cls) {
    chatStatusEl.textContent = text;
    chatStatusEl.className = 'chat-status' + (cls ? ' ' + cls : '');
  }

  function setInputBusy(busy) {
    chatInput.disabled = busy;
    chatSend.disabled = busy;
    if (busy) {
      setChatStatus('streaming…', 'streaming');
    } else {
      setChatStatus('idle', '');
    }
  }

  // Append a message bubble or chip to the chat history and scroll to bottom.
  // NEVER sets innerHTML with content — only textContent is used.
  function appendBubble(text, cls) {
    var el = document.createElement('div');
    el.className = cls;
    el.textContent = text;
    chatMessages.appendChild(el);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return el;
  }

  // Handle a normalized SSE event from /api/chat/:sessionId/stream.
  // All branches render via textContent only — XSS safe.
  function handleStreamEvent(evt) {
    var type = evt.type;

    if (type === 'text') {
      // Incremental text: create bubble on first chunk, append on subsequent.
      if (!currentAssistantBubble) {
        currentAssistantBubble = appendBubble('', 'chat-bubble assistant');
      }
      currentAssistantBubble.textContent += evt.text || '';
      chatMessages.scrollTop = chatMessages.scrollHeight;

    } else if (type === 'tool') {
      // Tool-use activity chip — compact, distinct from assistant text.
      appendBubble('▸ ' + (evt.name || 'tool'), 'chat-chip tool');

    } else if (type === 'subagent') {
      // Subagent-spawn activity chip — visually distinct accent color.
      appendBubble('▸ spawned ' + (evt.name || 'agent'), 'chat-chip subagent');

    } else if (type === 'turn-end') {
      // Finalize: clear the in-progress bubble pointer, unblock input.
      currentAssistantBubble = null;
      setInputBusy(false);

    } else if (type === 'error') {
      // Inline error — never a silent stall or infinite spinner.
      appendBubble('⚠ ' + (evt.message || 'stream error'), 'chat-chip error');
      currentAssistantBubble = null;
      setInputBusy(false);

    } else if (type === 'session') {
      // Optional session-init event — log for diagnostics, do not render.
      // (No content rendered — safe to ignore or console.log if needed.)
    }
  }

  // Open the SSE stream for this tab's session.  EventSource auto-reconnects
  // on network interruption — we only need to handle the error state visually.
  var sseConnected = false;
  var connLostChip = null;

  var evtSource = new EventSource('/api/chat/' + encodeURIComponent(sessionId) + '/stream');

  evtSource.onopen = function() {
    sseConnected = true;
    if (connLostChip) {
      connLostChip.remove();
      connLostChip = null;
    }
  };

  evtSource.onmessage = function(e) {
    var evt;
    try { evt = JSON.parse(e.data); } catch { return; }
    handleStreamEvent(evt);
  };

  evtSource.onerror = function() {
    // Show a subtle inline state — do NOT lock the UI (EventSource auto-reconnects).
    if (!connLostChip) {
      connLostChip = appendBubble('connection lost — reconnecting…', 'chat-chip conn-lost');
    }
    // Always unblock input so the user is never stuck.
    if (chatInput.disabled) {
      currentAssistantBubble = null;
      setInputBusy(false);
    }
    sseConnected = false;
  };

  // Send a user turn: append the user bubble immediately, POST to the server.
  async function sendMessage() {
    var message = chatInput.value.trim();
    if (!message) return;

    // Append user bubble immediately (optimistic) — textContent only, XSS safe.
    appendBubble(message, 'chat-bubble user');
    chatInput.value = '';
    currentAssistantBubble = null;
    setInputBusy(true);

    try {
      var res = await fetch('/api/chat/' + encodeURIComponent(sessionId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message }),
      });
      if (!res.ok) {
        var errText = 'Send failed (' + res.status + ')';
        try { var b = await res.json(); errText = b.error || errText; } catch {}
        appendBubble('⚠ ' + errText, 'chat-chip error');
        setInputBusy(false);
      }
      // On success: the streamed reply arrives via the EventSource.
    } catch (err) {
      appendBubble('⚠ ' + (err.message || 'network error'), 'chat-chip error');
      setInputBusy(false);
    }
  }

  chatSend.addEventListener('click', sendMessage);

  chatInput.addEventListener('keydown', function(e) {
    // Enter without Shift sends; Shift+Enter inserts a newline.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // ---------------------------------------------------------------------------
  // Skills panel — TASK-053
  //
  // On load: fetch /api/skills → render one button per skill.
  // Click → POST /api/chat/:sessionId/skill { skillId: id }.
  // The server maps id → canonical invocation server-side; the client never
  // posts an arbitrary command string through this path.
  //
  // XSS discipline: label and description come from disk (trusted data),
  // but they are always set via .textContent / title attribute — never innerHTML.
  // ---------------------------------------------------------------------------
  var skillsList = document.getElementById('skills-list');
  var skillsError = document.getElementById('skills-error');

  function showSkillsError(msg) {
    skillsError.textContent = msg;
    skillsError.style.display = 'block';
    setTimeout(function() { skillsError.style.display = 'none'; }, 5000);
  }

  async function runSkill(id) {
    try {
      var res = await fetch('/api/chat/' + encodeURIComponent(sessionId) + '/skill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skillId: id }),
      });
      if (!res.ok) {
        var errText = 'Skill failed (' + res.status + ')';
        try { var b = await res.json(); errText = b.error || errText; } catch {}
        showSkillsError(errText);
      }
      // On success: the streamed reply arrives via the EventSource automatically.
    } catch (err) {
      showSkillsError(err.message || 'network error');
    }
  }

  async function loadSkills() {
    try {
      var res = await fetch('/api/skills');
      if (!res.ok) {
        showSkillsError('Failed to load skills (' + res.status + ')');
        return;
      }
      var skills = await res.json();
      skillsList.innerHTML = '';
      for (var i = 0; i < skills.length; i++) {
        var skill = skills[i];
        var btn = document.createElement('button');
        btn.className = 'skill-btn';
        btn.textContent = skill.label;
        if (skill.description) btn.title = skill.description;
        // Capture id in closure via a local binding.
        (function(skillId) {
          btn.addEventListener('click', function() { runSkill(skillId); });
        }(skill.id));
        skillsList.appendChild(btn);
      }
    } catch (err) {
      showSkillsError('Failed to load skills: ' + (err.message || 'unknown error'));
    }
  }

  loadSkills();
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
//   repoRoot  {string}               — project root for task reads + session cwd
//   bridge    {object|undefined}     — injected session manager (for tests);
//                                      when omitted, the real createSessionManager
//                                      is constructed with repoRoot.
// ---------------------------------------------------------------------------
export function createBoardServer({ repoRoot, bridge } = {}) {
  // Use the injected bridge, or construct the real one lazily.
  const sessionManager = bridge || createSessionManager({ repoRoot });
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
          await transitionStatus({ repoRoot, key: rawKey, status });
          sendJson(res, 200, { ok: true, key: rawKey, status });
        } catch (err) {
          const msg = (err && err.message) || 'transition failed';
          // Map store errors to HTTP status codes:
          //   "invalid status ..."  → 400
          //   "unknown task key: ..." → 404
          if (/invalid status/.test(msg)) {
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

      // -----------------------------------------------------------------------
      // Skills routes — TASK-053
      // -----------------------------------------------------------------------

      // GET /api/skills — return the vetted skill catalog as JSON.
      // Response omits `invocation` (the client sends only an id; the server
      // maps id→invocation for security — the client never needs the raw command).
      if (req.method === 'GET' && pathname === '/api/skills') {
        const skills = await listSkills({ repoRoot });
        const clientSkills = skills.map(({ id, label, description }) => ({ id, label, description }));
        const payload = JSON.stringify(clientSkills, null, 2);
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(payload),
          'Cache-Control': 'no-cache',
        });
        res.end(payload);
        return;
      }

      // POST /api/chat/:sessionId/skill — invoke a vetted skill by id.
      // The client sends { skillId }, the server maps id→invocation server-side.
      // Unknown ids are rejected without calling session.send().
      const chatSkillRe = /^\/api\/chat\/([^/]+)\/skill$/;
      const chatSkillMatch = chatSkillRe.exec(pathname);
      if (req.method === 'POST' && chatSkillMatch) {
        // CONTENT-TYPE GUARD
        const contentType = req.headers['content-type'] || '';
        if (!/application\/json/i.test(contentType)) {
          sendJson(res, 415, {
            error: `Content-Type must be application/json, got: ${contentType || '(missing)'}`,
          });
          return;
        }

        // Decode and validate the session id.
        let rawId;
        try {
          rawId = decodeURIComponent(chatSkillMatch[1]);
        } catch {
          sendJson(res, 400, { error: 'malformed percent-encoding in session id' });
          return;
        }
        if (!SESSION_ID_RE.test(rawId)) {
          sendJson(res, 400, { error: `invalid session id: ${rawId}` });
          return;
        }

        // Read and validate the request body.
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

        const { skillId } = body;
        if (!skillId || typeof skillId !== 'string') {
          sendJson(res, 400, { error: 'body must include a non-empty `skillId` string' });
          return;
        }

        // Resolve skill id → invocation. REJECT unknown ids (no send on unknown).
        const invocation = await resolveSkillInvocation(repoRoot, skillId);
        if (invocation === null) {
          sendJson(res, 400, { error: `unknown skill id: ${skillId}` });
          return;
        }

        // Ensure the session exists (same auto-create as the chat POST).
        if (!sessionManager.has(rawId)) {
          sessionManager.create(rawId);
        }
        const session = sessionManager.get(rawId);
        session.send(invocation);

        sendJson(res, 200, { ok: true });
        return;
      }

      // -----------------------------------------------------------------------
      // Chat routes — all behind the Host allowlist (already checked above).
      // -----------------------------------------------------------------------

      // POST /api/chat/:sessionId/stop — stop a session (idempotent).
      const chatStopRe = /^\/api\/chat\/([^/]+)\/stop$/;
      const chatStopMatch = chatStopRe.exec(pathname);
      if (req.method === 'POST' && chatStopMatch) {
        let rawId;
        try {
          rawId = decodeURIComponent(chatStopMatch[1]);
        } catch {
          sendJson(res, 400, { error: 'malformed percent-encoding in session id' });
          return;
        }
        // Idempotent — stop regardless of whether id is valid or session exists.
        if (SESSION_ID_RE.test(rawId) && sessionManager.has(rawId)) {
          sessionManager.stop(rawId);
        }
        sendJson(res, 200, { ok: true });
        return;
      }

      // GET /api/chat/:sessionId/stream — SSE relay.
      const chatStreamRe = /^\/api\/chat\/([^/]+)\/stream$/;
      const chatStreamMatch = chatStreamRe.exec(pathname);
      if (req.method === 'GET' && chatStreamMatch) {
        let rawId;
        try {
          rawId = decodeURIComponent(chatStreamMatch[1]);
        } catch {
          sendJson(res, 400, { error: 'malformed percent-encoding in session id' });
          return;
        }
        if (!SESSION_ID_RE.test(rawId)) {
          sendJson(res, 400, { error: `invalid session id: ${rawId}` });
          return;
        }

        // Create session if it doesn't exist yet (lazy creation on first stream).
        if (!sessionManager.has(rawId)) {
          sessionManager.create(rawId);
        }
        const session = sessionManager.get(rawId);

        // SSE response headers — keep alive, no buffering.
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });
        res.flushHeaders();

        // Subscribe to session events and relay as SSE data frames.
        function onEvent(ev) {
          try {
            res.write(`data: ${JSON.stringify(ev)}\n\n`);
          } catch { /* socket may be closed */ }
        }
        session.subscribe(onEvent);

        // Clean up when the client disconnects — remove the subscriber so the
        // closed connection does not accumulate in the broadcast set.
        req.socket.on('close', () => {
          if (typeof session.unsubscribe === 'function') session.unsubscribe(onEvent);
        });

        return;
      }

      // POST /api/chat/:sessionId — send a user turn.
      const chatSendRe = /^\/api\/chat\/([^/]+)$/;
      const chatSendMatch = chatSendRe.exec(pathname);
      if (req.method === 'POST' && chatSendMatch) {
        // CONTENT-TYPE GUARD
        const contentType = req.headers['content-type'] || '';
        if (!/application\/json/i.test(contentType)) {
          sendJson(res, 415, {
            error: `Content-Type must be application/json, got: ${contentType || '(missing)'}`,
          });
          return;
        }

        // Decode and validate the session id.
        let rawId;
        try {
          rawId = decodeURIComponent(chatSendMatch[1]);
        } catch {
          sendJson(res, 400, { error: 'malformed percent-encoding in session id' });
          return;
        }
        if (!SESSION_ID_RE.test(rawId)) {
          sendJson(res, 400, { error: `invalid session id: ${rawId}` });
          return;
        }

        // Read and validate the request body.
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

        const { message } = body;
        if (!message || typeof message !== 'string') {
          sendJson(res, 400, { error: 'body must include a non-empty `message` string' });
          return;
        }

        // Ensure the session exists (create if absent). Auto-creation on send is
        // intentional — resurrection-on-send lets a POST arrive before /stream opens.
        if (!sessionManager.has(rawId)) {
          sessionManager.create(rawId);
        }
        const session = sessionManager.get(rawId);
        session.send(message);

        sendJson(res, 200, { ok: true });
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
