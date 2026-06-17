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

import { transitionStatus, createTask, TASK_FILENAME_RE } from './task-store.js';
import { loadGraph } from './knowledge-graph.js';
import { createSessionManager, SESSION_ID_RE } from './orchestrator-bridge.js';
import { listSkills, resolveSkillInvocation } from './skill-catalog.js';
import { projectSessionState } from './session-projection.js';
import { toggleMode } from './operating-mode.js';
import { resolvePreviewConfig } from './preview-resolver.js';
import { createPreviewController, LOG_BUFFER_CAP } from './preview-process.js';

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
// TASK-052: extends the board with a chat panel consuming TASK-051 streaming
// endpoints (/api/chat/:sessionId and /api/chat/:sessionId/stream).
// TASK-053: adds a skills panel with one button per vetted skill from the catalog.
// TASK-054: unified "agentic OS" shell — fuses board, chat, skills into a single
// cohesive console layout; adds "New ticket" form + POST /api/tasks client;
// live board refresh on turn-end SSE; deferred polish from TASK-052/053 review.
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
<title>Agentic OS</title>
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
    --chip-tool: #d29922;
    --chip-subagent: #388bfd;
    --chip-error: #f85149;
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
   * Status bar — compact session-state strip in the header
   * ========================================================================= */
  #session-status-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 0.72rem;
    font-family: var(--mono);
    color: var(--text-muted);
    border-left: 1px solid var(--border);
    padding-left: 12px;
    flex-shrink: 0;
    white-space: nowrap;
    overflow: hidden;
    max-width: 360px;
    text-overflow: ellipsis;
  }

  .status-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 7px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--card-bg);
    font-size: 0.68rem;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .status-chip.idle {
    color: var(--text-muted);
  }

  .status-chip.active {
    color: var(--accent);
    border-color: #1c2a3a;
    background: #0d1a2e;
  }

  .status-chip.warn {
    color: var(--priority-high);
    border-color: #3d2f0a;
    background: #231b06;
  }

  /* Mode badge — HARNESS (default / safe) vs LOOP (autonomous) */
  .mode-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--card-bg);
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    white-space: nowrap;
    flex-shrink: 0;
    text-transform: uppercase;
  }

  .mode-badge.harness {
    color: var(--text-muted);
    border-color: var(--border);
    background: var(--card-bg);
  }

  .mode-badge.loop {
    color: #3fb950;
    border-color: #1a3d26;
    background: #0a1f12;
  }

  /* Mode toggle button */
  #mode-toggle-btn {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text-muted);
    font-family: var(--mono);
    font-size: 0.65rem;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
    transition: border-color 0.15s, color 0.15s;
  }

  #mode-toggle-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  /* =========================================================================
   * Main 3-column console layout:
   *   left sidebar (skills)  |  board (main)  |  right sidebar (chat)
   * ========================================================================= */
  .console {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  /* =========================================================================
   * Left sidebar — Actions (skill buttons) + New Ticket
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

  .sidebar-section + .sidebar-section {
    border-top: 1px solid var(--border);
    flex: 0 0 auto;
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
   * Skills panel
   * ========================================================================= */
  #skills-panel {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  #skills-list {
    flex: 1;
    overflow-y: auto;
    padding: 0 10px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .skill-btn {
    width: 100%;
    text-align: left;
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: 6px;
    color: var(--text);
    font-family: var(--font);
    font-size: 0.82rem;
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

  /* =========================================================================
   * Right sidebar — Chat panel
   * XSS note: all message content goes through .textContent, never innerHTML.
   * ========================================================================= */
  .sidebar-right {
    width: var(--side-width);
    flex-shrink: 0;
    background: var(--surface);
    border-left: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  #chat-panel {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .chat-header {
    padding: 10px 14px 8px;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  }

  .chat-title {
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }

  .chat-status {
    font-size: 0.68rem;
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
    max-width: 92%;
    border-radius: 6px;
    padding: 6px 9px;
    font-size: 0.82rem;
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
    font-size: 0.7rem;
    font-family: var(--mono);
    padding: 2px 7px;
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

  .chat-chip.interrupted {
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
    font-size: 0.82rem;
    padding: 6px 9px;
    resize: none;
    min-height: 34px;
    max-height: 96px;
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
    padding: 6px 12px;
    font-size: 0.82rem;
    font-weight: 700;
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

  /* =========================================================================
   * Preview panel — TASK-068
   * Replaces the right sidebar with a tab switcher: Orchestrator | Preview.
   * The tab bar and content swap are handled client-side via data-tab attributes.
   * ========================================================================= */

  .sidebar-tabs {
    display: flex;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .sidebar-tab {
    flex: 1;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-muted);
    font-family: var(--font);
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 8px 6px;
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s;
  }

  .sidebar-tab:hover {
    color: var(--text);
  }

  .sidebar-tab.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }

  .sidebar-panel {
    display: none;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .sidebar-panel.active {
    display: flex;
  }

  /* Preview header: controls + status indicator */
  #preview-header {
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    flex-wrap: wrap;
  }

  .preview-btn {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 5px;
    color: var(--text-muted);
    font-family: var(--mono);
    font-size: 0.7rem;
    padding: 3px 9px;
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
    white-space: nowrap;
  }

  .preview-btn:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }

  .preview-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .preview-btn.danger:hover:not(:disabled) {
    border-color: var(--priority-critical);
    color: var(--priority-critical);
  }

  #preview-status-chip {
    margin-left: auto;
    font-family: var(--mono);
    font-size: 0.67rem;
    padding: 2px 7px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--card-bg);
    color: var(--text-muted);
    white-space: nowrap;
    flex-shrink: 0;
  }

  #preview-status-chip.running {
    color: #3fb950;
    border-color: #1a3d26;
    background: #0a1f12;
  }

  #preview-status-chip.starting {
    color: var(--priority-high);
    border-color: #3d2f0a;
    background: #231b06;
  }

  #preview-status-chip.error,
  #preview-status-chip.exited {
    color: var(--priority-critical);
    border-color: #3d1a1a;
    background: #1e0d0d;
  }

  /* Preview content area — switches between iframe, log view, hint card */
  #preview-content {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    position: relative;
  }

  /* Web mode: iframe fills the content area */
  #preview-iframe {
    display: none;
    width: 100%;
    height: 100%;
    border: none;
    background: #fff;
    flex: 1;
  }

  #preview-iframe.visible {
    display: block;
  }

  /* Process mode: scrollable log view */
  #preview-log {
    display: none;
    flex: 1;
    overflow-y: auto;
    padding: 8px 10px;
    font-family: var(--mono);
    font-size: 0.72rem;
    color: #a0d0a0;
    background: #0a100a;
    line-height: 1.5;
    word-break: break-all;
  }

  #preview-log.visible {
    display: block;
  }

  .log-line {
    display: block;
    white-space: pre-wrap;
  }

  /* None/hint mode */
  #preview-hint {
    display: none;
    flex: 1;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 10px;
    padding: 24px 16px;
    text-align: center;
    color: var(--text-muted);
    font-size: 0.82rem;
  }

  #preview-hint.visible {
    display: flex;
  }

  .hint-title {
    font-size: 0.88rem;
    font-weight: 700;
    color: var(--text);
  }

  .hint-code {
    font-family: var(--mono);
    font-size: 0.7rem;
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 6px 10px;
    text-align: left;
    width: 100%;
    max-width: 240px;
    color: var(--accent);
    white-space: pre;
  }
</style>
</head>
<body>

<!-- ========================================================================
  Header bar
  ======================================================================== -->
<header class="app-header">
  <h1>Agentic OS</h1>
  <span class="tagline">agentic software development framework</span>
  <div id="session-status-bar" aria-label="Session status"></div>
  <span id="mode-badge" class="mode-badge harness" aria-label="Operating mode">HARNESS</span>
  <button id="mode-toggle-btn" aria-label="Toggle operating mode">flip</button>
  <a href="/graph" class="header-link">Knowledge graph</a>
</header>

<!-- ========================================================================
  3-column console
  ======================================================================== -->
<div class="console">

  <!-- LEFT SIDEBAR: New Ticket + Skills/Actions -->
  <aside class="sidebar-left">
    <!-- New Ticket section -->
    <div class="sidebar-section" style="flex: 0 0 auto;">
      <div class="sidebar-heading">Tickets</div>
      <button class="new-ticket-btn" id="new-ticket-btn" aria-label="New ticket">+ New ticket</button>
    </div>

    <!-- Skills/Actions section -->
    <div class="sidebar-section" id="skills-panel">
      <div class="sidebar-heading">Actions</div>
      <div id="skills-list"></div>
      <div id="skills-error"></div>
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

  <!-- RIGHT SIDEBAR: Chat/Orchestrator + Preview tabs -->
  <aside class="sidebar-right">
    <!-- Tab bar -->
    <div class="sidebar-tabs" role="tablist">
      <button class="sidebar-tab active" id="tab-orchestrator" role="tab" aria-selected="true" aria-controls="panel-orchestrator">Orchestrator</button>
      <button class="sidebar-tab" id="tab-preview" role="tab" aria-selected="false" aria-controls="panel-preview">Preview</button>
    </div>

    <!-- Orchestrator panel -->
    <div id="panel-orchestrator" class="sidebar-panel active" role="tabpanel" aria-labelledby="tab-orchestrator">
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

    <!-- Preview panel -->
    <div id="panel-preview" class="sidebar-panel" role="tabpanel" aria-labelledby="tab-preview">
      <!-- Controls + status indicator -->
      <div id="preview-header" aria-label="Preview controls">
        <button class="preview-btn" id="preview-start-btn" aria-label="Start preview">Start</button>
        <button class="preview-btn danger" id="preview-stop-btn" aria-label="Stop preview" disabled>Stop</button>
        <button class="preview-btn" id="preview-restart-btn" aria-label="Restart preview" disabled>Restart</button>
        <span id="preview-status-chip" aria-live="polite">stopped</span>
      </div>
      <!-- Content area: web iframe | process log | hint card -->
      <div id="preview-content">
        <!-- Web mode: iframe — src is set ONLY to a validated localhost http URL -->
        <iframe id="preview-iframe" title="App preview" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>
        <!-- Process mode: live log view -->
        <div id="preview-log" aria-label="Preview process log" aria-live="polite"></div>
        <!-- None mode: hint card -->
        <div id="preview-hint">
          <div class="hint-title">No preview configured</div>
          <div>Add a preview block to your <strong>PROJECT.md</strong> frontmatter:</div>
          <pre class="hint-code">preview_command: npm start
preview_port: 3000</pre>
          <div style="color: var(--text-muted); font-size: 0.75rem;">or add a <code>dev</code>/<code>start</code>/<code>serve</code> script to package.json</div>
        </div>
      </div>
    </div>
  </aside>

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
      // TASK-054: also refresh the board so orchestrator-driven changes appear live.
      currentAssistantBubble = null;
      setInputBusy(false);
      fetchAndRender();

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
  // TASK-054 polish: removed dead sseConnected variable.
  var connLostChip = null;

  var evtSource = new EventSource('/api/chat/' + encodeURIComponent(sessionId) + '/stream');

  evtSource.onopen = function() {
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
    // TASK-054 polish: mark any orphaned assistant bubble as interrupted if
    // the SSE drops mid-stream, then unblock input.
    if (chatInput.disabled) {
      if (currentAssistantBubble) {
        var interrupted = document.createElement('div');
        interrupted.className = 'chat-chip interrupted';
        interrupted.textContent = '⌛ interrupted';
        chatMessages.insertBefore(interrupted, currentAssistantBubble.nextSibling);
        currentAssistantBubble = null;
      }
      setInputBusy(false);
    }
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

  // ---------------------------------------------------------------------------
  // Status bar — TASK-055
  //
  // Fetches /api/session on load and on each SSE turn-end event to show the
  // orchestrator's current workflow step + active task in the header.
  //
  // TASK-064: also renders the mode badge (HARNESS/LOOP) from session.mode.
  // Graceful when mode is absent — defaults to HARNESS, no crash.
  //
  // XSS discipline: all content rendered via document.createElement + .textContent.
  // No innerHTML with content.
  // ---------------------------------------------------------------------------
  var statusBar = document.getElementById('session-status-bar');
  var modeBadge = document.getElementById('mode-badge');
  var modeToggleBtn = document.getElementById('mode-toggle-btn');

  function renderModeBadge(mode) {
    // Graceful absent: default to 'harness' if mode is missing or invalid.
    var m = (mode === 'loop') ? 'loop' : 'harness';
    modeBadge.textContent = m.toUpperCase();
    modeBadge.className = 'mode-badge ' + m;
  }

  function renderStatusBar(data) {
    while (statusBar.firstChild) statusBar.removeChild(statusBar.firstChild);

    // Render mode badge — always, regardless of idle/active state.
    // data may be null (fetch failed) or missing mode field (older bundle).
    renderModeBadge(data && data.mode);

    if (!data || data.idle) {
      var idleChip = document.createElement('span');
      idleChip.className = 'status-chip idle';
      idleChip.textContent = 'idle';
      statusBar.appendChild(idleChip);
      return;
    }

    // Workflow step chip.
    if (data.workflow_step) {
      var stepChip = document.createElement('span');
      stepChip.className = 'status-chip active';
      stepChip.textContent = data.workflow_step;
      statusBar.appendChild(stepChip);
    }

    // Active task chip.
    if (data.active_task) {
      var taskChip = document.createElement('span');
      taskChip.className = 'status-chip active';
      taskChip.textContent = data.active_task;
      statusBar.appendChild(taskChip);
    }

    // Open questions / blockers count hint (only if non-zero).
    var oqCount = Array.isArray(data.open_questions) ? data.open_questions.length : 0;
    var blCount = Array.isArray(data.blockers) ? data.blockers.length : 0;
    if (oqCount > 0 || blCount > 0) {
      var hintChip = document.createElement('span');
      hintChip.className = 'status-chip warn';
      var parts = [];
      if (oqCount > 0) parts.push(oqCount + 'Q');
      if (blCount > 0) parts.push(blCount + 'B');
      hintChip.textContent = parts.join(' ');
      statusBar.appendChild(hintChip);
    }
  }

  async function fetchSessionStatus() {
    try {
      var res = await fetch('/api/session');
      if (!res.ok) return;
      var data = await res.json();
      renderStatusBar(data);
    } catch (e) {
      // Silently ignore — status bar is best-effort.
    }
  }

  // ---------------------------------------------------------------------------
  // Mode toggle button — TASK-064
  //
  // POSTs to /api/session/mode (no body needed — route calls toggleMode server-
  // side) then refreshes the session status so the badge updates live.
  //
  // Briefly disables the button during the request to prevent double-clicks.
  // Shows an inline error chip if the route returns a non-2xx or the fetch fails.
  // ---------------------------------------------------------------------------
  modeToggleBtn.addEventListener('click', async function() {
    modeToggleBtn.disabled = true;
    try {
      var res = await fetch('/api/session/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        var errText = 'Mode flip failed (' + res.status + ')';
        try { var b = await res.json(); errText = b.error || errText; } catch {}
        showError(errText);
      } else {
        // Refresh badge live.
        await fetchSessionStatus();
      }
    } catch (err) {
      showError('Mode flip failed: ' + (err.message || 'network error'));
    } finally {
      modeToggleBtn.disabled = false;
    }
  });

  // Initial load.
  fetchSessionStatus();

  // Polling interval — catches out-of-band mode changes (e.g. the autonomous loop
  // writing setMode('loop') to the bundle file with no chat turn occurring).
  // 4000 ms: live enough that a mode flip surfaces within one poll cycle (~4 s),
  // but not so frequent as to be chatty on a local loopback.  We guard against
  // accidental double-registration (e.g. if this script block were ever eval'd
  // more than once) by storing the interval ID on a module-scope sentinel; if
  // the sentinel is already set we skip registering a second interval.
  if (!window.__statusPollId) {
    window.__statusPollId = setInterval(fetchSessionStatus, 4000);
  }

  // Refresh on each turn-end SSE event — hook into the existing handleStreamEvent.
  var _origHandleStreamEvent = handleStreamEvent;
  handleStreamEvent = function(evt) {
    _origHandleStreamEvent(evt);
    if (evt.type === 'turn-end') {
      fetchSessionStatus();
    }
  };

  // ---------------------------------------------------------------------------
  // Tab switcher — TASK-068
  // Toggles .active on .sidebar-tab and .sidebar-panel pairs.
  // ---------------------------------------------------------------------------
  var tabOrchestrator = document.getElementById('tab-orchestrator');
  var tabPreview = document.getElementById('tab-preview');
  var panelOrchestrator = document.getElementById('panel-orchestrator');
  var panelPreview = document.getElementById('panel-preview');

  function activateTab(tabId) {
    var isPreview = tabId === 'preview';
    tabOrchestrator.classList.toggle('active', !isPreview);
    tabOrchestrator.setAttribute('aria-selected', String(!isPreview));
    tabPreview.classList.toggle('active', isPreview);
    tabPreview.setAttribute('aria-selected', String(isPreview));
    panelOrchestrator.classList.toggle('active', !isPreview);
    panelPreview.classList.toggle('active', isPreview);
  }

  tabOrchestrator.addEventListener('click', function() { activateTab('orchestrator'); });
  tabPreview.addEventListener('click', function() { activateTab('preview'); });

  // ---------------------------------------------------------------------------
  // Preview panel — TASK-068
  //
  // XSS discipline:
  //   - Log lines appended via createElement + textContent only (never innerHTML).
  //   - iframe src is validated to be a localhost http URL before assignment.
  //     The validation regex allows ONLY http://localhost:<port> or
  //     http://127.0.0.1:<port> — never user-controlled HTML.
  //   - Status chip text set via textContent.
  //
  // Live update: connects to GET /api/preview/stream (SSE) for incremental log
  // lines ({type:'log',line}) and state changes ({type:'state',...} or
  // {type:'status',...}). No page reload needed.
  //
  // Ring-buffer cap: the log view retains at most MAX_LOG_LINES DOM nodes,
  // dropping the oldest when the cap is reached.
  // ---------------------------------------------------------------------------

  var previewStartBtn = document.getElementById('preview-start-btn');
  var previewStopBtn = document.getElementById('preview-stop-btn');
  var previewRestartBtn = document.getElementById('preview-restart-btn');
  var previewStatusChip = document.getElementById('preview-status-chip');
  var previewIframe = document.getElementById('preview-iframe');
  var previewLog = document.getElementById('preview-log');
  var previewHint = document.getElementById('preview-hint');

  var MAX_LOG_LINES = 200;

  // Validate a URL is a safe localhost http URL before assigning to iframe.src.
  // Accepts only http://localhost:<port> or http://127.0.0.1:<port>.
  // Returns the validated URL string or null if invalid.
  function validateLocalhostUrl(url) {
    if (typeof url !== 'string') return null;
    if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+/.test(url)) return null;
    // Extra safety: parse as URL and confirm protocol + hostname.
    try {
      var parsed = new URL(url);
      if (parsed.protocol !== 'http:') return null;
      if (parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') return null;
      if (!parsed.port) return null;
      return url;
    } catch {
      return null;
    }
  }

  // Append a single log line to the log view (XSS-safe via textContent).
  function appendLogLine(text) {
    var line = document.createElement('span');
    line.className = 'log-line';
    line.textContent = text;
    previewLog.appendChild(line);
    // Trim oldest lines if over cap.
    while (previewLog.childNodes.length > MAX_LOG_LINES) {
      previewLog.removeChild(previewLog.firstChild);
    }
    previewLog.scrollTop = previewLog.scrollHeight;
  }

  // Switch the preview content area based on mode + state.
  // mode: 'web' | 'process' | 'none' | null
  // state: 'running' | 'starting' | 'stopped' | 'exited' | 'error' | null
  // url: string | null
  function applyPreviewMode(mode, state, url) {
    var isRunning = state === 'running' || state === 'starting';

    // Update status chip.
    var chipText = state || 'stopped';
    if (mode && isRunning) chipText = state + ' · ' + mode;
    previewStatusChip.textContent = chipText;
    previewStatusChip.className = (state && isRunning) ? state : (state || '');

    // Update button states.
    var canStart = !isRunning;
    var canStop = state === 'running' || state === 'starting';
    var canRestart = state === 'running';
    previewStartBtn.disabled = !canStart;
    previewStopBtn.disabled = !canStop;
    previewRestartBtn.disabled = !canRestart;

    // Hide all content areas first.
    previewIframe.classList.remove('visible');
    previewLog.classList.remove('visible');
    previewHint.classList.remove('visible');

    if (mode === 'web' && state === 'running') {
      // Web mode running: show iframe with validated localhost URL.
      var safeUrl = validateLocalhostUrl(url);
      if (safeUrl) {
        // Only set src if the URL has changed (avoids pointless reload).
        if (previewIframe.getAttribute('data-preview-url') !== safeUrl) {
          previewIframe.src = safeUrl;
          previewIframe.setAttribute('data-preview-url', safeUrl);
        }
        previewIframe.classList.add('visible');
      } else {
        // URL missing or invalid — fall back to log view.
        previewLog.classList.add('visible');
      }
    } else if (mode === 'process' || (mode === 'web' && state !== 'running' && isRunning)) {
      // Process mode, or web starting (url not yet resolved): show log view.
      previewLog.classList.add('visible');
    } else if (!mode || mode === 'none' || state === 'stopped' || !state) {
      if (mode === 'none' || !mode) {
        // No preview configured: show hint card.
        previewHint.classList.add('visible');
      } else {
        // Stopped/exited/error with a known mode: show log view (last output visible).
        previewLog.classList.add('visible');
      }
    } else {
      // Fallback for any other combination.
      previewLog.classList.add('visible');
    }

    // If stopped/exited, clear iframe src to free the embedded page.
    if (state === 'stopped' || state === 'exited' || state === 'error') {
      if (previewIframe.src) {
        previewIframe.removeAttribute('src');
        previewIframe.removeAttribute('data-preview-url');
      }
    }
  }

  // Handle an incoming preview SSE event.
  function handlePreviewEvent(ev) {
    if (!ev || typeof ev !== 'object') return;

    if (ev.type === 'log' && typeof ev.line === 'string') {
      appendLogLine(ev.line);
      return;
    }

    // State change events: both 'state' (from controller) and 'status' (from
    // the initial snapshot + route broadcasts) are handled identically.
    if (ev.type === 'state' || ev.type === 'status') {
      applyPreviewMode(ev.mode || null, ev.state || null, ev.url || null);
      // On a status event, also seed recent logs if provided (initial snapshot).
      if (ev.type === 'status' && Array.isArray(ev.recentLogs)) {
        previewLog.innerHTML = '';
        for (var i = 0; i < ev.recentLogs.length; i++) {
          appendLogLine(ev.recentLogs[i]);
        }
      }
    }
  }

  // Open SSE stream for preview events.
  var previewEvtSource = new EventSource('/api/preview/stream');

  previewEvtSource.onmessage = function(e) {
    var ev;
    try { ev = JSON.parse(e.data); } catch { return; }
    handlePreviewEvent(ev);
  };

  previewEvtSource.onerror = function() {
    // Non-fatal: EventSource auto-reconnects. Status chip keeps its last value.
  };

  // Control button handlers.
  previewStartBtn.addEventListener('click', async function() {
    previewStartBtn.disabled = true;
    try {
      var res = await fetch('/api/preview/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        var err = 'Start failed (' + res.status + ')';
        try { var b = await res.json(); err = b.error || err; } catch {}
        previewStatusChip.textContent = 'error: ' + err;
        previewStatusChip.className = 'error';
        previewStartBtn.disabled = false;
        // Show hint if mode=none (409 = not configured).
        if (res.status === 409) {
          previewHint.classList.add('visible');
          previewIframe.classList.remove('visible');
          previewLog.classList.remove('visible');
        }
      }
      // On success: SSE stream will deliver the state change.
    } catch (e2) {
      previewStatusChip.textContent = 'error: ' + (e2.message || 'network error');
      previewStatusChip.className = 'error';
      previewStartBtn.disabled = false;
    }
  });

  previewStopBtn.addEventListener('click', async function() {
    previewStopBtn.disabled = true;
    try {
      await fetch('/api/preview/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      // SSE will deliver stopped state.
    } catch (e2) {
      previewStopBtn.disabled = false;
    }
  });

  previewRestartBtn.addEventListener('click', async function() {
    previewRestartBtn.disabled = true;
    try {
      await fetch('/api/preview/restart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      // SSE will deliver updated state.
    } catch (e2) {
      previewRestartBtn.disabled = false;
    }
  });

  // Initial preview status fetch to seed the UI on page load
  // (the SSE stream sends a snapshot on connect, but fetch ensures
  // we reflect the correct mode even if the SSE is slow to connect).
  async function fetchPreviewStatus() {
    try {
      var res = await fetch('/api/preview/status');
      if (!res.ok) return;
      var data = await res.json();
      applyPreviewMode(data.mode || null, data.state || null, data.url || null);
      // Seed the log view with recent logs.
      if (Array.isArray(data.recentLogs) && data.recentLogs.length > 0) {
        for (var i = 0; i < data.recentLogs.length; i++) {
          appendLogLine(data.recentLogs[i]);
        }
      }
    } catch {
      // Best-effort: ignore errors, SSE will sync the state.
    }
  }

  fetchPreviewStatus();
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
export function createBoardServer({ repoRoot, bridge, previewController } = {}) {
  // Use the injected bridge, or construct the real one lazily.
  const sessionManager = bridge || createSessionManager({ repoRoot });
  const html = buildHtml();

  // ---------------------------------------------------------------------------
  // Single module-level preview controller (single active preview per server,
  // matching the TASK-066 single-process design). Can be injected for tests.
  // ---------------------------------------------------------------------------
  const _preview = previewController || createPreviewController({ repoRoot });

  // SSE subscriber set for the preview stream.
  const _previewSubs = new Set();

  // Broadcast an event to all active SSE preview stream subscribers.
  function broadcastPreviewEvent(ev) {
    for (const sub of _previewSubs) {
      try {
        sub(ev);
      } catch { /* subscriber's socket may be closed */ }
    }
  }

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

      // GET /api/session — return bounded session-state projection (no-cache).
      // Never 500 on absent/idle state; projectSessionState already guarantees this.
      if (req.method === 'GET' && pathname === '/api/session') {
        try {
          const projection = projectSessionState({ repoRoot });
          const payload = JSON.stringify(projection, null, 2);
          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Length': Buffer.byteLength(payload),
            'Cache-Control': 'no-cache',
          });
          res.end(payload);
        } catch (err) {
          // Belt-and-suspenders: projectSessionState should never throw, but guard anyway.
          sendJson(res, 200, {
            idle: true,
            workflow_step: 'idle',
            active_task: null,
            open_questions: [],
            blockers: [],
            next_action: null,
            recent_decisions: [],
            error: (err && err.message) || 'projection failed',
          });
        }
        return;
      }

      // POST /api/session/mode — flip the operating mode (harness ↔ loop).
      // Calls toggleMode from src/operating-mode.js.  Same hardening guards as
      // every other POST route: Host allowlist (already checked above),
      // Content-Type: application/json required (→ 415), body capped at 64 KiB (→ 413).
      // Returns 200 { ok: true, mode: <new mode> } on success.
      // Returns 409 if there is no active session (setMode requirement).
      if (req.method === 'POST' && pathname === '/api/session/mode') {
        // CONTENT-TYPE GUARD
        const contentType = req.headers['content-type'] || '';
        if (!/application\/json/i.test(contentType)) {
          sendJson(res, 415, {
            error: `Content-Type must be application/json, got: ${contentType || '(missing)'}`,
          });
          return;
        }

        // BODY-CAP GUARD (body is accepted but not required to carry any fields).
        try {
          await readBody(req);
        } catch (err) {
          if (err && err.code === 'BODY_TOO_LARGE') {
            sendJson(res, 413, { error: err.message });
          } else {
            sendJson(res, 400, { error: 'invalid JSON body' });
          }
          return;
        }

        try {
          const newMode = await toggleMode({ repoRoot });
          sendJson(res, 200, { ok: true, mode: newMode });
        } catch (err) {
          const msg = (err && err.message) || 'mode toggle failed';
          // No active session → cannot toggle (409 Conflict is the most accurate status).
          if (/no active session/i.test(msg)) {
            sendJson(res, 409, { error: msg });
          } else {
            sendJson(res, 500, { error: msg });
          }
        }
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

      // -----------------------------------------------------------------------
      // Preview routes — TASK-067
      // All routes inherit the Host allowlist (already checked above).
      // POST routes additionally require Content-Type: application/json and
      // a body ≤ 64 KiB — the same guards as every other mutation endpoint.
      // -----------------------------------------------------------------------

      // GET /api/preview/status — bounded snapshot from the process manager + resolver.
      // Never returns unbounded logs (capped to LOG_BUFFER_CAP items, but the response
      // further clips to 50 most-recent lines to keep the payload bounded).
      // source: taken from the controller when running (plumbed from config.source in
      // start()); falls back to a fresh resolvePreviewConfig call when stopped/never
      // started so the field is accurate before start is ever called.
      if (req.method === 'GET' && pathname === '/api/preview/status') {
        const status = _preview.getStatus();
        const RECENT_CAP = 50;
        const recentLogs = Array.isArray(status.recentLogs)
          ? status.recentLogs.slice(-RECENT_CAP)
          : [];

        // Determine source: use the controller's stored value when available,
        // otherwise fall back to the resolver so the field is always informative.
        let source = status.source !== null && status.source !== undefined
          ? status.source
          : null;
        if (source === null) {
          try {
            const cfg = await resolvePreviewConfig({ repoRoot });
            source = cfg.source;
          } catch {
            // Resolver failure is non-fatal for the status route.
            source = null;
          }
        }

        const body = {
          state: status.state,
          mode: status.mode,
          url: status.url !== undefined ? status.url : null,
          source,
          recentLogs,
        };
        sendJson(res, 200, body);
        return;
      }

      // GET /api/preview/stream — SSE channel.
      // Emits incremental log lines ({ type:'log', line }) and state changes
      // ({ type:'state', state, mode, url, source }) from the controller's
      // subscribe hook. Mirrors the TASK-051 unsubscribe-on-disconnect pattern
      // exactly — the unsubscribe fn returned by ctrl.subscribe() is called on
      // socket close so no listener leaks.
      if (req.method === 'GET' && pathname === '/api/preview/stream') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });
        res.flushHeaders();

        function onPreviewEvent(ev) {
          try {
            res.write(`data: ${JSON.stringify(ev)}\n\n`);
          } catch { /* socket may be closed */ }
        }

        // Send current status immediately so the client has an initial snapshot.
        const RECENT_CAP = 50;
        const initStatus = _preview.getStatus();
        onPreviewEvent({
          type: 'status',
          state: initStatus.state,
          mode: initStatus.mode,
          url: initStatus.url !== undefined ? initStatus.url : null,
          source: initStatus.source !== undefined ? initStatus.source : null,
          recentLogs: Array.isArray(initStatus.recentLogs)
            ? initStatus.recentLogs.slice(-RECENT_CAP)
            : [],
        });

        // Subscribe to the controller for incremental log lines + state changes.
        // The returned unsubscribe function is called on client disconnect.
        const unsubscribePreview = _preview.subscribe(onPreviewEvent);

        // Also register in the legacy _previewSubs set (kept for broadcastPreviewEvent
        // calls from route handlers that fire before the controller's own emit).
        _previewSubs.add(onPreviewEvent);

        // Clean up listener when the client disconnects — no leak.
        // Mirrors the TASK-051 chat /stream unsubscribe fix exactly.
        req.socket.on('close', () => {
          unsubscribePreview();
          _previewSubs.delete(onPreviewEvent);
        });

        return;
      }

      // POST /api/preview/start — resolve config (065) and launch (066).
      if (req.method === 'POST' && pathname === '/api/preview/start') {
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

        // Resolve config from the repo.
        let config;
        try {
          config = await resolvePreviewConfig({ repoRoot });
        } catch (err) {
          sendJson(res, 500, { error: `resolver error: ${(err && err.message) || 'unknown'}` });
          return;
        }

        // mode=none → no preview configured; return a clear 409 with a configure hint.
        if (config.mode === 'none') {
          sendJson(res, 409, {
            error: 'no preview configured',
            hint: 'Add preview_command, preview_url, or preview_port to PROJECT.md frontmatter, or add a dev/start/serve script to package.json.',
          });
          return;
        }

        // Pass the config object directly — the resolver always returns command as a
        // string, and the controller's start() handles both string and string[] forms.
        try {
          await _preview.start(config);
        } catch (err) {
          sendJson(res, 500, { error: `start failed: ${(err && err.message) || 'unknown'}` });
          return;
        }

        // Notify SSE subscribers of the state change.
        const newStatus = _preview.getStatus();
        broadcastPreviewEvent({
          type: 'status',
          state: newStatus.state,
          mode: newStatus.mode,
          url: newStatus.url !== undefined ? newStatus.url : null,
        });

        sendJson(res, 200, { ok: true, state: newStatus.state, mode: newStatus.mode, url: newStatus.url });
        return;
      }

      // POST /api/preview/stop — terminate the preview process (idempotent).
      if (req.method === 'POST' && pathname === '/api/preview/stop') {
        // CONTENT-TYPE GUARD
        const contentType = req.headers['content-type'] || '';
        if (!/application\/json/i.test(contentType)) {
          sendJson(res, 415, {
            error: `Content-Type must be application/json, got: ${contentType || '(missing)'}`,
          });
          return;
        }

        try {
          await readBody(req);
        } catch (err) {
          if (err && err.code === 'BODY_TOO_LARGE') {
            sendJson(res, 413, { error: err.message });
          } else {
            sendJson(res, 400, { error: 'invalid JSON body' });
          }
          return;
        }

        try {
          await _preview.stop();
        } catch (err) {
          sendJson(res, 500, { error: `stop failed: ${(err && err.message) || 'unknown'}` });
          return;
        }

        // Notify SSE subscribers.
        broadcastPreviewEvent({ type: 'status', state: 'stopped', mode: null, url: null });

        sendJson(res, 200, { ok: true, state: 'stopped' });
        return;
      }

      // POST /api/preview/restart — stop then start.
      if (req.method === 'POST' && pathname === '/api/preview/restart') {
        // CONTENT-TYPE GUARD
        const contentType = req.headers['content-type'] || '';
        if (!/application\/json/i.test(contentType)) {
          sendJson(res, 415, {
            error: `Content-Type must be application/json, got: ${contentType || '(missing)'}`,
          });
          return;
        }

        try {
          await readBody(req);
        } catch (err) {
          if (err && err.code === 'BODY_TOO_LARGE') {
            sendJson(res, 413, { error: err.message });
          } else {
            sendJson(res, 400, { error: 'invalid JSON body' });
          }
          return;
        }

        // Resolve config from the repo.
        let config;
        try {
          config = await resolvePreviewConfig({ repoRoot });
        } catch (err) {
          sendJson(res, 500, { error: `resolver error: ${(err && err.message) || 'unknown'}` });
          return;
        }

        if (config.mode === 'none') {
          sendJson(res, 409, {
            error: 'no preview configured',
            hint: 'Add preview_command, preview_url, or preview_port to PROJECT.md frontmatter, or add a dev/start/serve script to package.json.',
          });
          return;
        }

        try {
          await _preview.restart(config);
        } catch (err) {
          sendJson(res, 500, { error: `restart failed: ${(err && err.message) || 'unknown'}` });
          return;
        }

        const newStatus = _preview.getStatus();
        broadcastPreviewEvent({
          type: 'status',
          state: newStatus.state,
          mode: newStatus.mode,
          url: newStatus.url !== undefined ? newStatus.url : null,
        });

        sendJson(res, 200, { ok: true, state: newStatus.state, mode: newStatus.mode, url: newStatus.url });
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
