// tests/e2e/mode-badge-routes.spec.js
// TASK-064 — Regression locks: mode badge + POST /api/session/mode route.
//
// tests-after tier (minimal locks — each encodes an AC or real regression):
//   Lock 1  POST /api/session/mode flips mode (harness→loop) and projection reflects it.
//   Lock 2  POST /api/session/mode second call flips back (loop→harness).
//   Lock 3  POST /api/session/mode rejects wrong Content-Type → 415.
//   Lock 4  POST /api/session/mode rejects oversized body → 413.
//   Lock 5  POST /api/session/mode rejects non-allowlisted Host → 403.
//   Lock 6  GET / HTML contains mode-badge element and toggle button (badge render presence).
//   Lock 7  GET / client code references /api/session/mode (badge wired to projection).
//   Lock 8  toggleMode unit test (harness→loop→harness), covered via import from operating-mode.js.
//   Lock 9  POST /api/session/mode with no active session → 409 (regression: server must not crash).
//
// Note: graceful-absent (mode absent from bundle → HARNESS) is covered by the TASK-063
// AC5 tests in tests/e2e/operating-mode.spec.js (idle projection has mode:harness).
// No duplication needed here.
//
// Slow tier (real tmpdir + server spawn) → tests/e2e/.

import {
  describe, it, expect, beforeEach, afterEach,
} from 'vitest';
import {
  mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';

import { createBoardServer } from '../../src/task-board.js';
import { toggleMode } from '../../src/operating-mode.js';

// ---------------------------------------------------------------------------
// Helpers
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

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

/** Make a minimal repo with an active session bundle. bundleExtra can override bundle fields. */
function makeRepoWithSession(repoRoot, bundleExtra = {}) {
  const sessionId = '20260616T120000Z-modetst1';
  mkdirSync(join(repoRoot, 'state', 'sessions', sessionId), { recursive: true });
  mkdirSync(join(repoRoot, 'tasks'), { recursive: true });
  writeFileSync(join(repoRoot, 'tasks', 'index.json'), JSON.stringify({ tasks: [] }));
  writeFileSync(join(repoRoot, 'state', 'session.json'), JSON.stringify({
    schema_version: 2,
    active_session_id: sessionId,
    updated_at: '2026-06-16T12:00:00Z',
  }));
  writeFileSync(
    join(repoRoot, 'state', 'sessions', sessionId, 'session.json'),
    JSON.stringify({
      schema_version: 2,
      session_id: sessionId,
      lifecycle_state: 'active',
      updated_at: '2026-06-16T12:00:00Z',
      active_task: 'TASK-064',
      workflow_step: 'implement',
      mode: 'harness',
      next_action: 'test mode badge',
      handoff_summary: 'regression lock fixture',
      open_questions: [],
      blockers: [],
      decisions: [],
      subagent_results: [],
      pending_human_confirmation: null,
      ...bundleExtra,
    }),
  );
  return sessionId;
}

/** Make a repo with NO active session (active_session_id: null). */
function makeRepoNoSession(repoRoot) {
  mkdirSync(join(repoRoot, 'state'), { recursive: true });
  mkdirSync(join(repoRoot, 'tasks'), { recursive: true });
  writeFileSync(join(repoRoot, 'tasks', 'index.json'), JSON.stringify({ tasks: [] }));
  writeFileSync(join(repoRoot, 'state', 'session.json'), JSON.stringify({
    schema_version: 2,
    active_session_id: null,
    updated_at: '2026-06-16T12:00:00Z',
  }));
}

// ===========================================================================
// Lock 1-2: POST /api/session/mode flips mode; GET /api/session reflects it.
// ===========================================================================
describe('TASK-064 — POST /api/session/mode flips mode (route + projection)', () => {
  let repoRoot;
  let server;
  let baseUrl;

  beforeEach(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), 'mode-badge-spec-'));
    makeRepoWithSession(repoRoot, { mode: 'harness' });
    ({ server, baseUrl } = await startServer(repoRoot));
  });

  afterEach(async () => {
    if (server) await closeServer(server);
    if (repoRoot) rmSync(repoRoot, { recursive: true, force: true });
  });

  // Lock 1 — harness → loop
  it('POST_mode_returns_200_and_flips_harness_to_loop', async () => {
    const res = await fetch(`${baseUrl}/api/session/mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status, 'must return 200 on first flip').toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.mode, 'mode must be loop after first flip from harness').toBe('loop');

    // Projection must reflect the new mode.
    const sessionRes = await fetch(`${baseUrl}/api/session`);
    const projection = await sessionRes.json();
    expect(projection.mode, 'GET /api/session must return loop after flip').toBe('loop');
  });

  // Lock 2 — loop → harness (second flip)
  it('POST_mode_second_call_flips_loop_back_to_harness', async () => {
    // First flip: harness → loop.
    await fetch(`${baseUrl}/api/session/mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    // Second flip: loop → harness.
    const res = await fetch(`${baseUrl}/api/session/mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status, 'must return 200 on second flip').toBe(200);
    const body = await res.json();
    expect(body.mode, 'mode must be harness after second flip').toBe('harness');

    const sessionRes = await fetch(`${baseUrl}/api/session`);
    const projection = await sessionRes.json();
    expect(projection.mode, 'GET /api/session must return harness after second flip').toBe('harness');
  });
});

// ===========================================================================
// Lock 3-5: Hardening guards on POST /api/session/mode.
// ===========================================================================
describe('TASK-064 — POST /api/session/mode hardening guards', () => {
  let repoRoot;
  let server;
  let baseUrl;

  beforeEach(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), 'mode-hard-spec-'));
    makeRepoWithSession(repoRoot);
    ({ server, baseUrl } = await startServer(repoRoot));
  });

  afterEach(async () => {
    if (server) await closeServer(server);
    if (repoRoot) rmSync(repoRoot, { recursive: true, force: true });
  });

  // Lock 3 — wrong Content-Type → 415
  it('POST_mode_with_non_json_content_type_returns_415', async () => {
    const res = await fetch(`${baseUrl}/api/session/mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: '{}',
    });
    expect(res.status, 'wrong Content-Type must return 415').toBe(415);
    const body = await res.json();
    expect(typeof body.error).toBe('string');
  });

  // Lock 4 — oversized body → 413
  it('POST_mode_with_oversized_body_returns_413', async () => {
    const bigBody = JSON.stringify({ junk: 'x'.repeat(65 * 1024) });
    const res = await fetch(`${baseUrl}/api/session/mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bigBody,
    });
    expect(res.status, 'oversized body must return 413').toBe(413);
    const body = await res.json();
    expect(typeof body.error).toBe('string');
  });

  // Lock 5 — non-allowlisted Host → 403 (raw http.request needed to spoof Host)
  it('POST_mode_with_non_local_Host_returns_403', async () => {
    const { port } = server.address();
    const result = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          method: 'POST',
          path: '/api/session/mode',
          headers: {
            Host: 'evil.example.com',
            'Content-Type': 'application/json',
            'Content-Length': 2,
          },
        },
        (res) => {
          let data = '';
          res.on('data', (c) => { data += c; });
          res.on('end', () => resolve({ status: res.statusCode, body: data }));
        },
      );
      req.on('error', reject);
      req.write('{}');
      req.end();
    });
    expect(result.status, 'spoofed Host must be rejected with 403').toBe(403);
    const body = JSON.parse(result.body);
    expect(typeof body.error).toBe('string');
  });
});

// ===========================================================================
// Lock 6-7: Badge render presence — GET / HTML wired to projection's mode.
// ===========================================================================
describe('TASK-064 — GET / HTML contains mode badge and toggle wired to /api/session/mode', () => {
  let repoRoot;
  let server;
  let baseUrl;

  beforeEach(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), 'mode-html-spec-'));
    makeRepoWithSession(repoRoot);
    ({ server, baseUrl } = await startServer(repoRoot));
  });

  afterEach(async () => {
    if (server) await closeServer(server);
    if (repoRoot) rmSync(repoRoot, { recursive: true, force: true });
  });

  // Lock 6 — badge element and toggle button are present in the served HTML
  it('GET_root_HTML_contains_mode_badge_element_and_toggle_button', async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(
      html.includes('id="mode-badge"'),
      'HTML must contain the mode-badge element',
    ).toBe(true);

    expect(
      html.includes('id="mode-toggle-btn"'),
      'HTML must contain the mode-toggle-btn button',
    ).toBe(true);
  });

  // Lock 7 — client code references /api/session/mode (badge wired to projection)
  it('GET_root_HTML_client_code_references_api_session_mode', async () => {
    const res = await fetch(`${baseUrl}/`);
    const html = await res.text();

    expect(
      html.includes('/api/session/mode'),
      'client JS must reference /api/session/mode for the toggle button',
    ).toBe(true);
  });
});

// ===========================================================================
// Lock 8: toggleMode unit test (harness→loop→harness).
// Pure-logic portion is covered here as an e2e disk test because toggleMode
// requires a real pointer+bundle on disk.
// ===========================================================================
describe('TASK-064 — toggleMode helper (harness→loop→harness)', () => {
  let repoRoot;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'toggle-mode-spec-'));
    makeRepoWithSession(repoRoot, { mode: 'harness' });
  });

  afterEach(() => {
    if (repoRoot) rmSync(repoRoot, { recursive: true, force: true });
  });

  it('toggleMode_flips_harness_to_loop_and_returns_loop', async () => {
    const newMode = await toggleMode({ repoRoot });
    expect(newMode, 'toggleMode must return loop after flipping from harness').toBe('loop');

    // Verify on disk.
    const sessionId = '20260616T120000Z-modetst1';
    const bundlePath = join(repoRoot, 'state', 'sessions', sessionId, 'session.json');
    const onDisk = JSON.parse(readFileSync(bundlePath, 'utf8'));
    expect(onDisk.mode, 'bundle must have mode:loop after toggle').toBe('loop');
  });

  it('toggleMode_flips_loop_to_harness_and_returns_harness', async () => {
    // Set to loop first.
    await toggleMode({ repoRoot });
    // Now flip back.
    const newMode = await toggleMode({ repoRoot });
    expect(newMode, 'toggleMode must return harness after flipping from loop').toBe('harness');

    const sessionId = '20260616T120000Z-modetst1';
    const bundlePath = join(repoRoot, 'state', 'sessions', sessionId, 'session.json');
    const onDisk = JSON.parse(readFileSync(bundlePath, 'utf8'));
    expect(onDisk.mode, 'bundle must have mode:harness after second toggle').toBe('harness');
  });
});

// ===========================================================================
// Lock 9: POST /api/session/mode with no active session → 409, no crash.
// ===========================================================================
describe('TASK-064 — POST /api/session/mode with no active session returns 409', () => {
  let repoRoot;
  let server;
  let baseUrl;

  beforeEach(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), 'mode-no-session-spec-'));
    makeRepoNoSession(repoRoot);
    ({ server, baseUrl } = await startServer(repoRoot));
  });

  afterEach(async () => {
    if (server) await closeServer(server);
    if (repoRoot) rmSync(repoRoot, { recursive: true, force: true });
  });

  it('POST_mode_with_no_active_session_returns_409', async () => {
    const res = await fetch(`${baseUrl}/api/session/mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status, 'no active session must return 409').toBe(409);
    const body = await res.json();
    expect(typeof body.error, 'error body must have an error string').toBe('string');
    expect(body.error).toMatch(/no active session/i);
  });
});
