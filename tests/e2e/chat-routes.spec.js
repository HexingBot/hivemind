// tests/e2e/chat-routes.spec.js
// TASK-051 — Orchestrator-session bridge: slow-tier route specs.
//
// Tests the new chat routes added to createBoardServer (not yet implemented).
// Spins up the server in-process via createBoardServer({ repoRoot, bridge })
// where `bridge` is a stubbed session manager so no real `claude` is spawned.
//
// Routes under test:
//   POST /api/chat/:sessionId          → 200 ok (or guard codes: 400/403/413/415)
//   GET  /api/chat/:sessionId/stream   → 200 text/event-stream (stays open)
//   POST /api/chat/:sessionId/stop     → 200 ok (idempotent)
//
// The dependency-injection seam: createBoardServer({ repoRoot, bridge }) where
// `bridge` is the injected session manager. IMPL must accept this parameter;
// when omitted, the real bridge is used.
//
// Real-spawn smoke test: it.skip — requires interactive `claude` login.

import {
  describe, it, expect, beforeEach, afterEach,
} from 'vitest';
import {
  mkdtempSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';

import { createBoardServer } from '../../src/task-board.js';
import { makeRepoSkeleton } from '../helpers/fixtures.js';

// ===========================================================================
// Fake bridge (stub session manager) — lets route tests run without a real
// `claude` child process.
// ===========================================================================
function makeFakeBridge() {
  const sessions = new Map();

  return {
    sessions,
    create(sessionId) {
      if (sessions.has(sessionId)) throw new Error(`duplicate session: ${sessionId}`);
      const subs = [];
      const session = {
        id: sessionId,
        stopped: false,
        send(text) { this._lastSent = text; },
        subscribe(cb) { subs.push(cb); },
        _subs: subs,
        _lastSent: null,
      };
      sessions.set(sessionId, session);
      return session;
    },
    get(sessionId) { return sessions.get(sessionId); },
    has(sessionId) { return sessions.has(sessionId); },
    stop(sessionId) { sessions.delete(sessionId); },
  };
}

// ===========================================================================
// Helper: start server, return { server, baseUrl, port }.
// ===========================================================================
function startServer(repoRoot, bridge) {
  return new Promise((resolve, reject) => {
    const server = createBoardServer({ repoRoot, bridge });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}`, port });
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

// Low-level HTTP request helper so we can set arbitrary headers (fetch blocks Host override).
function rawRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, headers: res.headers, body: text });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ===========================================================================
// Suite
// ===========================================================================
describe('TASK-051 — chat routes on createBoardServer', () => {
  let repoRoot;
  let server;
  let baseUrl;
  let port;
  let bridge;

  beforeEach(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), 'chat-routes-spec-'));
    makeRepoSkeleton(repoRoot, {});
    bridge = makeFakeBridge();
    ({ server, baseUrl, port } = await startServer(repoRoot, bridge));
  });

  afterEach(async () => {
    if (server) await closeServer(server);
    if (repoRoot) rmSync(repoRoot, { recursive: true, force: true });
  });

  // =========================================================================
  // POST /api/chat/:sessionId — happy path
  // =========================================================================
  it('POST /api/chat/:sessionId with valid JSON body returns 200', async () => {
    const sessionId = 'test-session-001';
    bridge.create(sessionId);

    const res = await fetch(`${baseUrl}/api/chat/${sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hello' }),
    });
    expect(res.status, 'valid POST to chat endpoint must return 200').toBe(200);
  });

  // =========================================================================
  // POST — missing/wrong Content-Type → 415
  // =========================================================================
  it('POST /api/chat/:sessionId without application/json Content-Type returns 415', async () => {
    const sessionId = 'ct-test-session';
    bridge.create(sessionId);

    const res = await fetch(`${baseUrl}/api/chat/${sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'hello',
    });
    expect(res.status, 'wrong Content-Type must return 415').toBe(415);
  });

  // =========================================================================
  // POST — body > 64 KiB → 413
  // =========================================================================
  it('POST /api/chat/:sessionId with body over 64 KiB returns 413', async () => {
    const sessionId = 'body-cap-session';
    bridge.create(sessionId);

    const bigMessage = 'x'.repeat(65 * 1024); // 65 KiB
    const res = await fetch(`${baseUrl}/api/chat/${sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: bigMessage }),
    });
    expect(res.status, 'body over 64 KiB must return 413').toBe(413);
  });

  // =========================================================================
  // POST — invalid JSON body → 400
  // =========================================================================
  it('POST /api/chat/:sessionId with invalid JSON body returns 400', async () => {
    const sessionId = 'bad-json-session';
    bridge.create(sessionId);

    const res = await rawRequest(
      {
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: `/api/chat/${sessionId}`,
        headers: {
          'Content-Type': 'application/json',
          Host: `127.0.0.1:${port}`,
        },
      },
      '{not valid json',
    );
    expect(res.status, 'invalid JSON body must return 400').toBe(400);
  });

  // =========================================================================
  // POST — missing/empty message field → 400
  // =========================================================================
  it('POST /api/chat/:sessionId with missing message field returns 400', async () => {
    const sessionId = 'no-msg-session';
    bridge.create(sessionId);

    const res = await fetch(`${baseUrl}/api/chat/${sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ other: 'field' }),
    });
    expect(res.status, 'missing message field must return 400').toBe(400);
  });

  it('POST /api/chat/:sessionId with empty message string returns 400', async () => {
    const sessionId = 'empty-msg-session';
    bridge.create(sessionId);

    const res = await fetch(`${baseUrl}/api/chat/${sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '' }),
    });
    expect(res.status, 'empty message string must return 400').toBe(400);
  });

  // =========================================================================
  // POST — sessionId failing SESSION_ID_RE → 400 or 404
  // =========================================================================
  it('POST /api/chat/:sessionId with invalid sessionId returns 400 or 404', async () => {
    const res = await rawRequest(
      {
        host: '127.0.0.1',
        port,
        method: 'POST',
        // Embed a traversal attempt in the path; URL encodes .. as %2e%2e
        path: '/api/chat/%2e%2e/message',
        headers: {
          'Content-Type': 'application/json',
          Host: `127.0.0.1:${port}`,
        },
      },
      JSON.stringify({ message: 'hi' }),
    );
    // Route guard should reject with 400 or 404 — not 200.
    expect(
      [400, 404],
      `invalid sessionId in path must return 400 or 404, got ${res.status}`,
    ).toContain(res.status);
  });

  it('POST /api/chat/:sessionId with path-separator sessionId returns 400 or 404', async () => {
    // Deliberately construct a sessionId with a slash (encoded)
    const res = await rawRequest(
      {
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: '/api/chat/bad%2Fid',
        headers: {
          'Content-Type': 'application/json',
          Host: `127.0.0.1:${port}`,
        },
      },
      JSON.stringify({ message: 'hi' }),
    );
    expect([400, 404]).toContain(res.status);
  });

  // =========================================================================
  // POST — non-local Host header → 403 (reuse existing allowlist)
  // =========================================================================
  it('POST /api/chat/:sessionId with non-local Host returns 403', async () => {
    const res = await rawRequest(
      {
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: '/api/chat/some-session',
        headers: {
          'Content-Type': 'application/json',
          Host: 'evil.example.com',
        },
      },
      JSON.stringify({ message: 'hi' }),
    );
    expect(res.status, 'non-local Host must return 403').toBe(403);
  });

  // =========================================================================
  // GET /api/chat/:sessionId/stream → text/event-stream, 200
  // =========================================================================
  it('GET /api/chat/:sessionId/stream returns 200 with Content-Type text/event-stream', async () => {
    const sessionId = 'stream-session';
    bridge.create(sessionId);

    // Use a raw http.request so we can destroy the socket without waiting for body end.
    const result = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          method: 'GET',
          path: `/api/chat/${sessionId}/stream`,
          headers: { Host: `127.0.0.1:${port}` },
        },
        (res) => {
          // Capture status and headers immediately without consuming body.
          const status = res.statusCode;
          const contentType = res.headers['content-type'] || '';
          // Destroy socket so the test doesn't hang waiting for a streaming body.
          req.socket.destroy();
          resolve({ status, contentType });
        },
      );
      req.on('error', (err) => {
        // ECONNRESET is expected after socket.destroy() — that's fine.
        if (err.code === 'ECONNRESET') return;
        reject(err);
      });
      req.end();
    });

    expect(result.status, 'SSE endpoint must return 200').toBe(200);
    expect(
      result.contentType,
      'SSE endpoint must return text/event-stream',
    ).toMatch(/text\/event-stream/);
  });

  // =========================================================================
  // POST /api/chat/:sessionId/stop → 200 ok (idempotent)
  // =========================================================================
  it('POST /api/chat/:sessionId/stop returns 200', async () => {
    const sessionId = 'stop-session';
    bridge.create(sessionId);

    const res = await fetch(`${baseUrl}/api/chat/${sessionId}/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Host: `127.0.0.1:${port}` },
      body: '{}',
    });
    expect(res.status, 'stop endpoint must return 200').toBe(200);
  });

  it('POST /api/chat/:sessionId/stop is idempotent for unknown session', async () => {
    const res = await fetch(`${baseUrl}/api/chat/unknown-session/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    // Idempotent — 200 regardless of whether the session exists.
    expect(res.status, 'stop endpoint must be idempotent (200 for unknown session)').toBe(200);
  });

  // =========================================================================
  // Existing routes still work after adding the new bridge parameter
  // =========================================================================
  it('existing GET /api/tasks endpoint still returns 200', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`);
    expect(res.status, 'existing /api/tasks endpoint must still return 200').toBe(200);
  });

  it('existing GET / endpoint still returns HTML', async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status, 'existing / endpoint must still return 200').toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
  });

  // =========================================================================
  // Real-spawn smoke test — SKIPPED: requires interactive `claude` login and
  // would spawn a nested orchestrator session, burning Agent-SDK credit in CI.
  // Run manually: node -e "... spawn test ..."
  // =========================================================================
  it.skip('real spawn smoke test — spawns actual claude process (manual only)', async () => {
    // This test is intentionally skipped.
    // To test manually: spawn claude -p --input-format stream-json
    //   --output-format stream-json --verbose, write one user message,
    //   assert a result event is received within 30s.
  });
});
