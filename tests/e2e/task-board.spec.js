// tests/e2e/task-board.spec.js
// TASK-034 — Kanban task board: local HTTP server for the task store.
//
// DESIGN UNDER TEST (per the TASK-034 tier-assignment comment):
//   src/task-board.js exports `createBoardServer({ repoRoot })` returning a
//   pre-configured http.Server (NOT yet listening). Each test calls
//   server.listen(0, '127.0.0.1') on an ephemeral port, issues real HTTP
//   requests via Node's global fetch, then closes in afterEach.
//
// ENDPOINT CONTRACT (tier-assignment comment §2):
//   GET /           → 200 HTML (inline CSS + inline JS, no external URLs)
//   GET /api/tasks  → 200 JSON array (full task objects from readAllTasks)
//   POST /api/tasks/:key/status  { status } → 200 on success
//                                            → 400 on invalid enum value
//                                            → 404 on unknown key
//   All mutations route through src/task-store.js (atomic write + index regeneration).
//   Server binds 127.0.0.1 ONLY. No caching — on-disk edits reflected on next request.
//
// TESTS-FIRST FAILURE SURFACE:
//   1. src/task-board.js does not exist → import fails (module-not-found).
//      Every test in this file errors at collection time. That is the expected
//      tests-first state for the impl phase to clear.

import {
  describe, it, expect, beforeEach, afterEach,
} from 'vitest';
import {
  mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';

import { createBoardServer } from '../../src/task-board.js';
import { makeRepoSkeleton } from '../helpers/fixtures.js';

// ---------------------------------------------------------------------------
// Fixture tasks (inline — keeps the e2e spec self-contained).
// ---------------------------------------------------------------------------
const FIXTURE_TASK_001 = {
  key: 'TASK-001',
  title: 'First todo task',
  description: 'Fixture for the board spec.',
  acceptance_criteria: ['Appears on the board.'],
  status: 'todo',
  priority: 'high',
  labels: ['board', 'fixture'],
  assignee: null,
  depends_on: [],
  linked_commits: [],
  linked_prs: [],
  comments: [],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  jira_key: null,
};

const FIXTURE_TASK_002 = {
  key: 'TASK-002',
  title: 'Second task in review',
  description: 'Fixture in a non-todo status.',
  acceptance_criteria: ['Present in the full task list.'],
  status: 'in_review',
  priority: 'medium',
  labels: [],
  assignee: null,
  depends_on: [],
  linked_commits: [],
  linked_prs: [],
  comments: [],
  created_at: '2026-01-02T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
  jira_key: null,
};

// ---------------------------------------------------------------------------
// Helper: start server on a free port, return { server, baseUrl }.
// ---------------------------------------------------------------------------
function startServer(repoRoot) {
  return new Promise((resolve, reject) => {
    const server = createBoardServer({ repoRoot });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

// ---------------------------------------------------------------------------
// Helper: close the server and await.
// ---------------------------------------------------------------------------
function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

// ---------------------------------------------------------------------------
// Helper: read tasks/index.json.
// ---------------------------------------------------------------------------
function readIndex(repoRoot) {
  return JSON.parse(readFileSync(join(repoRoot, 'tasks', 'index.json'), 'utf8'));
}

// ---------------------------------------------------------------------------
// Helper: read a single task file.
// ---------------------------------------------------------------------------
function readTaskFile(repoRoot, key) {
  return JSON.parse(readFileSync(join(repoRoot, 'tasks', `${key}.json`), 'utf8'));
}

// ---------------------------------------------------------------------------
// Helper: snapshot all bytes under tasks/ — returns { filename: bytes } map.
// ---------------------------------------------------------------------------
function snapshotTasksDir(repoRoot) {
  const dir = join(repoRoot, 'tasks');
  const entries = readdirSync(dir).sort();
  const snap = {};
  for (const name of entries) {
    snap[name] = readFileSync(join(dir, name), 'utf8');
  }
  return snap;
}

// ===========================================================================
// Suite setup — one temp repo per test for isolation.
// ===========================================================================
describe('TASK-034 — createBoardServer HTTP surface', () => {
  let repoRoot;
  let server;
  let baseUrl;

  beforeEach(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), 'board-spec-'));
    makeRepoSkeleton(repoRoot, {
      tasks: {
        'TASK-001': FIXTURE_TASK_001,
        'TASK-002': FIXTURE_TASK_002,
      },
    });
    ({ server, baseUrl } = await startServer(repoRoot));
  });

  afterEach(async () => {
    if (server) await closeServer(server);
    if (repoRoot) rmSync(repoRoot, { recursive: true, force: true });
  });

  // =========================================================================
  // AC1 — GET /api/tasks returns the seeded task list as JSON.
  // =========================================================================
  it('GET_api_tasks_returns_seeded_task_list_as_JSON', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`);
    expect(res.status, 'GET /api/tasks must return 200').toBe(200);
    expect(
      res.headers.get('content-type'),
      'content-type must declare application/json',
    ).toMatch(/application\/json/);

    const tasks = await res.json();
    expect(Array.isArray(tasks), 'response body must be an array').toBe(true);
    expect(tasks.length, 'must return both seeded tasks').toBe(2);

    const keys = tasks.map((t) => t.key).sort();
    expect(keys).toEqual(['TASK-001', 'TASK-002']);

    // Each returned task carries the headline fields the board needs.
    const t1 = tasks.find((t) => t.key === 'TASK-001');
    expect(t1, 'TASK-001 must be present').toBeTruthy();
    expect(t1.title).toBe('First todo task');
    expect(t1.status).toBe('todo');
    expect(t1.priority).toBe('high');
    expect(Array.isArray(t1.labels), 'labels must be an array').toBe(true);
    expect(t1.labels).toContain('board');
  });

  // =========================================================================
  // AC2 — POST /api/tasks/:key/status valid transition updates task file and
  //        regenerates index.json.
  // =========================================================================
  it('POST_valid_status_transition_updates_task_file_and_regenerates_index', async () => {
    const beforeTask = readTaskFile(repoRoot, 'TASK-001');
    expect(beforeTask.status).toBe('todo');

    const res = await fetch(`${baseUrl}/api/tasks/TASK-001/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'in_progress' }),
    });
    expect(res.status, 'valid transition must return 200').toBe(200);

    // Task file on disk must reflect the new status.
    const afterTask = readTaskFile(repoRoot, 'TASK-001');
    expect(afterTask.status, 'task file must carry the new status').toBe('in_progress');
    expect(
      afterTask.updated_at,
      'updated_at must advance after a successful transition',
    ).not.toBe(beforeTask.updated_at);

    // tasks/index.json must be regenerated and reflect the new status.
    const idx = readIndex(repoRoot);
    expect(Array.isArray(idx.tasks), 'index must have a tasks array').toBe(true);
    const idxEntry = idx.tasks.find((e) => e.key === 'TASK-001');
    expect(idxEntry, 'TASK-001 must appear in the regenerated index').toBeTruthy();
    expect(idxEntry.status, 'index entry must reflect the new status').toBe('in_progress');
  });

  // =========================================================================
  // AC3 — POST invalid status value → 400, disk byte-unchanged.
  // =========================================================================
  it('POST_invalid_status_value_returns_400_and_leaves_disk_unchanged', async () => {
    const beforeSnap = snapshotTasksDir(repoRoot);

    const res = await fetch(`${baseUrl}/api/tasks/TASK-001/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'not_a_real_status' }),
    });
    expect(res.status, 'invalid status must return 400').toBe(400);

    const afterSnap = snapshotTasksDir(repoRoot);
    expect(
      afterSnap,
      'tasks/ directory contents must be byte-identical after a rejected transition',
    ).toEqual(beforeSnap);
  });

  // =========================================================================
  // AC4 — POST unknown key → 404, nothing written to disk.
  // =========================================================================
  it('POST_unknown_key_returns_404_and_writes_nothing', async () => {
    const beforeSnap = snapshotTasksDir(repoRoot);

    const res = await fetch(`${baseUrl}/api/tasks/TASK-999/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    });
    expect(res.status, 'unknown task key must return 404').toBe(404);

    const afterSnap = snapshotTasksDir(repoRoot);
    expect(
      afterSnap,
      'tasks/ directory must be byte-identical after a 404 response',
    ).toEqual(beforeSnap);
  });

  // =========================================================================
  // TASK-087 AC2 — traversal-shaped key rejected by the KEY_RE guard → 404,
  // nothing written to disk. KEY_RE (`/^TASK-\d{3,}$/`) and the store's own
  // "unknown task key" throw both map to 404 with an identical message
  // shape, so a bare status-code assertion can't tell which one fired. Pair
  // the traversal key with an INVALID status value: if KEY_RE is the guard
  // rejecting it, the request never reaches transitionStatus's status
  // validation and stays 404; if the guard were absent, the invalid status
  // would reach that validation instead and come back 400. See the red-green
  // plant note in the hand-off for how this was proven to actually catch a
  // missing guard.
  // =========================================================================
  it('POST_traversal_shaped_key_returns_404_via_KEY_RE_guard_not_downstream', async () => {
    const beforeSnap = snapshotTasksDir(repoRoot);

    const res = await fetch(`${baseUrl}/api/tasks/..%2f..%2fetc/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'not_a_real_status' }),
    });

    expect(
      res.status,
      'a traversal-shaped key paired with an invalid status must still return 404 ' +
        '(KEY_RE guard fires first) rather than 400 (status validation downstream)',
    ).toBe(404);
    const data = await res.json();
    expect(typeof data.error, '404 body must include an error message').toBe('string');

    const afterSnap = snapshotTasksDir(repoRoot);
    expect(
      afterSnap,
      'tasks/ directory must be byte-identical after the traversal attempt',
    ).toEqual(beforeSnap);
  });

  // =========================================================================
  // AC5 — GET / returns HTML: five status columns, inline <style> and <script>,
  //        and zero external URLs (no http(s):// in src/href attributes).
  // =========================================================================
  it('GET_root_returns_HTML_with_five_status_columns_inline_assets_no_external_URLs', async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status, 'GET / must return 200').toBe(200);
    expect(
      res.headers.get('content-type'),
      'content-type must be text/html',
    ).toMatch(/text\/html/);

    const html = await res.text();
    expect(html.length, 'HTML body must not be empty').toBeGreaterThan(0);

    // The five schema status-enum identifiers must appear in the page.
    const STATUS_COLUMNS = ['todo', 'in_progress', 'in_review', 'blocked', 'done'];
    for (const col of STATUS_COLUMNS) {
      expect(
        html.includes(col),
        `HTML must contain the status column identifier "${col}"`,
      ).toBe(true);
    }

    // Inline <style> block must be present (no external stylesheet URL).
    expect(
      html.includes('<style'),
      'HTML must contain an inline <style> block',
    ).toBe(true);

    // Inline <script> block must be present (no external JS file URL).
    expect(
      html.includes('<script'),
      'HTML must contain an inline <script> block',
    ).toBe(true);

    // No external http(s) URLs in src= or href= attributes (no CDN, works offline).
    const externalUrlRe = /(?:src|href)\s*=\s*["']https?:\/\//gi;
    const matches = html.match(externalUrlRe);
    expect(
      matches,
      `HTML must not reference external URLs via src/href. Found: ${JSON.stringify(matches)}`,
    ).toBeNull();
  });

  // =========================================================================
  // AC6 — Server address is 127.0.0.1 (local-only binding).
  // =========================================================================
  it('server_binds_127_0_0_1_only', () => {
    const addr = server.address();
    expect(addr, 'server.address() must not be null').not.toBeNull();
    expect(
      addr.address,
      'server must bind to 127.0.0.1, not 0.0.0.0 or ::',
    ).toBe('127.0.0.1');
  });

  // =========================================================================
  // AC7 — Refresh semantics: on-disk edit is reflected on the next GET /api/tasks
  //        without a server restart (no caching).
  // =========================================================================
  it('GET_api_tasks_reflects_direct_on_disk_mutation_without_restart', async () => {
    // Confirm initial state.
    const res1 = await fetch(`${baseUrl}/api/tasks`);
    const tasks1 = await res1.json();
    const t1 = tasks1.find((t) => t.key === 'TASK-001');
    expect(t1.status, 'initial status must be todo').toBe('todo');

    // Mutate the task file directly on disk — bypassing all server endpoints.
    const taskPath = join(repoRoot, 'tasks', 'TASK-001.json');
    const mutated = {
      ...FIXTURE_TASK_001,
      status: 'blocked',
      updated_at: '2099-01-01T00:00:00Z',
    };
    writeFileSync(taskPath, JSON.stringify(mutated, null, 2) + '\n', 'utf8');

    // The next GET /api/tasks must reflect the mutation without a server restart.
    const res2 = await fetch(`${baseUrl}/api/tasks`);
    expect(res2.status, 'second GET must return 200').toBe(200);
    const tasks2 = await res2.json();
    const t2 = tasks2.find((t) => t.key === 'TASK-001');
    expect(
      t2.status,
      'server must not cache task data — on-disk mutation must be visible on the next request',
    ).toBe('blocked');
  });

  // =========================================================================
  // M1a (review follow-up) — a request with a non-local Host header → 403.
  // fetch forbids overriding Host, so this uses a raw http.request.
  // =========================================================================
  it('request_with_non_local_Host_header_returns_403', async () => {
    const { port } = server.address();
    const result = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          method: 'GET',
          path: '/api/tasks',
          headers: { Host: 'evil.example.com' },
        },
        (res) => {
          let data = '';
          res.on('data', (c) => { data += c; });
          res.on('end', () => resolve({ status: res.statusCode, body: data }));
        },
      );
      req.on('error', reject);
      req.end();
    });

    expect(
      result.status,
      'a spoofed/non-local Host header must be rejected with 403',
    ).toBe(403);
    const body = JSON.parse(result.body);
    expect(typeof body.error, '403 body must carry a JSON error message').toBe('string');
  });

  // =========================================================================
  // M1b (review follow-up) — POST without Content-Type: application/json → 415
  //                          and the tasks/ directory is byte-unchanged.
  // =========================================================================
  it('POST_with_non_json_content_type_returns_415_and_leaves_disk_unchanged', async () => {
    const beforeSnap = snapshotTasksDir(repoRoot);

    const res = await fetch(`${baseUrl}/api/tasks/TASK-001/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ status: 'done' }),
    });
    expect(
      res.status,
      'POST without Content-Type: application/json must return 415',
    ).toBe(415);

    const afterSnap = snapshotTasksDir(repoRoot);
    expect(
      afterSnap,
      'tasks/ directory must be byte-identical after a 415 rejection',
    ).toEqual(beforeSnap);
  });
});

// ===========================================================================
// TASK-099 AC3 — the status-transition route composes loopModeCloseGuard, so
// closing a ticket to `done` via the board in an unauthorized loop-mode
// session is rejected the same way the MCP transition_status/close_task
// tools already reject it (deep-review R4: this was the third write path
// that half-enforced TASK-082's guards — a board POST bypassed both).
// ===========================================================================
const FIXTURE_TASK_IN_REVIEW = {
  key: 'TASK-090',
  title: 'Ticket ready to close',
  description: 'Fixture for the board close-guard specs.',
  acceptance_criteria: ['Closes via the board status endpoint.'],
  status: 'in_review',
  priority: 'medium',
  labels: [],
  assignee: null,
  depends_on: [],
  linked_commits: [],
  linked_prs: [],
  comments: [],
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
  jira_key: null,
  verification_tier: 'tdd',
};

/** Seed a pointer + active bundle with the given mode/loop_auth under repoRoot. */
function seedLoopBundle(repoRoot, { mode, loopAuth, sessionId = '20260706T120000Z-b0a2d3c4' } = {}) {
  writeFileSync(
    join(repoRoot, 'state', 'session.json'),
    JSON.stringify({
      schema_version: 2,
      active_session_id: sessionId,
      updated_at: '2026-07-06T12:00:00Z',
    }, null, 2),
    'utf8',
  );
  const bundleDir = join(repoRoot, 'state', 'sessions', sessionId);
  mkdirSync(bundleDir, { recursive: true });
  writeFileSync(
    join(bundleDir, 'session.json'),
    JSON.stringify({
      schema_version: 2,
      session_id: sessionId,
      lifecycle_state: 'active',
      updated_at: '2026-07-06T12:00:00Z',
      active_task: 'TASK-090',
      workflow_step: 'update',
      next_action: 'board close-guard specs',
      handoff_summary: 'in progress',
      open_questions: [],
      blockers: [],
      decisions: [],
      subagent_results: [],
      pending_human_confirmation: null,
      ...(mode !== undefined ? { mode } : {}),
      ...(loopAuth !== undefined ? { loop_auth: loopAuth } : {}),
    }, null, 2),
    'utf8',
  );
}

describe('TASK-099 AC3 — board POST to done composes loopModeCloseGuard', () => {
  let repoRoot;
  let server;
  let baseUrl;

  beforeEach(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), 'board-closeguard-'));
    makeRepoSkeleton(repoRoot, { tasks: { 'TASK-090': FIXTURE_TASK_IN_REVIEW } });
    ({ server, baseUrl } = await startServer(repoRoot));
  });

  afterEach(async () => {
    if (server) await closeServer(server);
    if (repoRoot) rmSync(repoRoot, { recursive: true, force: true });
  });

  it('POST_to_done_in_unauthorized_loop_mode_is_rejected_and_leaves_disk_unchanged', async () => {
    seedLoopBundle(repoRoot, { mode: 'loop', loopAuth: {} });
    const beforeSnap = snapshotTasksDir(repoRoot);

    const res = await fetch(`${baseUrl}/api/tasks/TASK-090/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    });
    expect(
      res.status,
      'a close-to-done in unauthorized loop mode must not succeed silently — expected the guard rejection',
    ).toBe(403);

    const afterSnap = snapshotTasksDir(repoRoot);
    expect(
      afterSnap,
      'tasks/ directory must be byte-identical after the guard rejects the close',
    ).toEqual(beforeSnap);
  });

  it('POST_to_done_in_loop_mode_succeeds_once_auto_close_on_green_review_is_true', async () => {
    seedLoopBundle(repoRoot, { mode: 'loop', loopAuth: { auto_close_on_green_review: true } });

    const res = await fetch(`${baseUrl}/api/tasks/TASK-090/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    });
    expect(res.status, 'authorized loop-mode close must still succeed').toBe(200);

    const after = readTaskFile(repoRoot, 'TASK-090');
    expect(after.status).toBe('done');
  });

  it('POST_to_done_in_harness_mode_still_succeeds_with_no_active_session', async () => {
    // No pointer/bundle seeded at all — getMode defaults to 'harness', so
    // composing loopModeCloseGuard unconditionally must remain a no-op here.
    const res = await fetch(`${baseUrl}/api/tasks/TASK-090/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    });
    expect(res.status, 'harness mode / no session must not be affected by composing the guard').toBe(200);

    const after = readTaskFile(repoRoot, 'TASK-090');
    expect(after.status).toBe('done');
  });
});
