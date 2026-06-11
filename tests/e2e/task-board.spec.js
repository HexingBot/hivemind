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
  mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
});
