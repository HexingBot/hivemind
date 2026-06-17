// tests/e2e/preview-routes.spec.js
// TASK-067 — Regression locks: preview routes on createBoardServer.
//
// tests-after tier — minimal locks encoding every AC and the critical regressions:
//
//   Lock 1  GET /api/preview/status returns bounded JSON shape
//           { state, mode, url, source, recentLogs } — no unbounded dump.
//   Lock 1b source field is accurate — 'configured' for PROJECT.md preview block,
//           'none' for an empty repo (before start is called).
//   Lock 2  POST /api/preview/start with mode=none → 409 + configure hint (no crash).
//   Lock 3  Guard parity — POST /api/preview/start rejects wrong Content-Type → 415.
//   Lock 4  Guard parity — POST /api/preview/start rejects oversized body → 413.
//   Lock 5  Guard parity — POST /api/preview/start rejects non-local Host → 403.
//   Lock 6  GET /api/preview/stream returns 200 text/event-stream + subscriber count
//           returns to baseline after disconnect (SSE leak regression — asserted via
//           the injected controller's subscribe/unsubscribe count).
//   Lock 7  Space-bearing-command launch: a command given as a string[] (pre-split
//           argv) with a space-bearing path launches correctly (carried constraint
//           from TASK-066 review).
//   Lock 8  Full flow: start (with PROJECT.md-configured preview_command), GET
//           /api/preview/status reflects running + url + source='configured', stop
//           → terminated.
//   Lock 9  SSE stream emits incremental log lines WITHOUT any route call — connect
//           to stream, then cause the running fixture to produce a new log line, and
//           assert the SSE client receives a { type:'log', line } frame. This is the
//           primary AC3 incremental-log regression lock.
//
// Slow tier (real tmpdir + server spawn) → tests/e2e/.

import {
  describe, it, expect, beforeEach, afterEach,
} from 'vitest';
import {
  mkdtempSync, mkdirSync, writeFileSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';

import { createBoardServer } from '../../src/task-board.js';
import { createPreviewController } from '../../src/preview-process.js';

// ---------------------------------------------------------------------------
// Fixture scripts
// ---------------------------------------------------------------------------

/** Server that announces its URL on stdout, stays alive until SIGTERM. */
const FIXTURE_SERVER_SRC = `
const http = require('http');
const server = http.createServer((_req, res) => { res.end('preview ok'); });
server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  process.stdout.write('Listening on http://localhost:' + port + '\\n');
});
process.on('SIGTERM', () => { server.close(); process.exit(0); });
process.on('SIGINT',  () => { server.close(); process.exit(0); });
`;

/**
 * Server that:
 *  1. Announces its URL on stdout.
 *  2. Listens for HTTP requests to /emit-line which causes it to write a NEW
 *     log line on stdout. This lets the test trigger incremental log output
 *     WITHOUT making any route call to the board server.
 */
const FIXTURE_TRIGGERABLE_SRC = `
const http = require('http');
const ctrl = http.createServer((req, res) => {
  if (req.url === '/emit-line') {
    process.stdout.write('incremental-log-line-from-fixture\\n');
    res.end('ok');
  } else {
    res.end('preview ok');
  }
});
ctrl.listen(0, '127.0.0.1', () => {
  const port = ctrl.address().port;
  // Announce the control port so the test knows where to POST /emit-line.
  process.stdout.write('Listening on http://localhost:' + port + '\\n');
});
process.on('SIGTERM', () => { ctrl.close(); process.exit(0); });
process.on('SIGINT',  () => { ctrl.close(); process.exit(0); });
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Start a board server on an ephemeral port with an optional injected controller. */
function startServer(repoRoot, previewController) {
  return new Promise((resolve, reject) => {
    const server = createBoardServer({ repoRoot, previewController });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}`, port });
    });
  });
}

/** Close the server and await. */
function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

/**
 * Make a minimal repo with a PROJECT.md that configures preview_command directly
 * (source='configured'). Using a direct 'node <script>' command avoids the npm
 * wrapper so spawn works reliably cross-platform.
 * scriptPath must not contain spaces (use a plain tmpdir path).
 */
function makeRepoWithFixtureScript(repoRoot, scriptPath) {
  mkdirSync(join(repoRoot, 'tasks'), { recursive: true });
  writeFileSync(join(repoRoot, 'tasks', 'index.json'), JSON.stringify({ tasks: [] }));
  writeFileSync(
    join(repoRoot, 'PROJECT.md'),
    `---\nname: preview-test\npreview_command: node ${scriptPath}\n---\n`,
    'utf8',
  );
}

/** Make a minimal repo with NO package.json and NO PROJECT.md (mode=none, source=none). */
function makeEmptyRepo(repoRoot) {
  mkdirSync(join(repoRoot, 'tasks'), { recursive: true });
  writeFileSync(join(repoRoot, 'tasks', 'index.json'), JSON.stringify({ tasks: [] }));
}

/** Write the standard fixture server script into dir; return its path. */
function writeFixtureScript(dir, src = FIXTURE_SERVER_SRC) {
  const scriptPath = join(dir, 'fixture-server.js');
  writeFileSync(scriptPath, src.trimStart(), 'utf8');
  return scriptPath;
}

/** Low-level HTTP helper (allows setting arbitrary Host headers). */
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

/** Poll ctrl.getStatus() until predicate resolves or timeout. */
async function pollUntil(ctrl, predicate, { timeoutMs = 6000, intervalMs = 50 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = ctrl.getStatus();
    if (predicate(status)) return status;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `pollUntil timed out after ${timeoutMs}ms. Last: ${JSON.stringify(ctrl.getStatus())}`,
  );
}

// ===========================================================================
// Lock 1 + 1b: GET /api/preview/status — bounded JSON shape + accurate source
// ===========================================================================
describe('TASK-067 — GET /api/preview/status returns bounded JSON shape', () => {
  let repoRoot;
  let server;
  let baseUrl;

  beforeEach(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), 'preview-status-spec-'));
    makeEmptyRepo(repoRoot);
    ({ server, baseUrl } = await startServer(repoRoot));
  });

  afterEach(async () => {
    if (server) await closeServer(server);
    if (repoRoot) rmSync(repoRoot, { recursive: true, force: true });
  });

  it('returns 200 with all required shape fields', async () => {
    const res = await fetch(`${baseUrl}/api/preview/status`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Object.prototype.hasOwnProperty.call(body, 'state')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(body, 'mode')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(body, 'url')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(body, 'source')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(body, 'recentLogs')).toBe(true);
  });

  it('recentLogs is an array bounded to at most 50 items', async () => {
    const res = await fetch(`${baseUrl}/api/preview/status`);
    const body = await res.json();

    expect(Array.isArray(body.recentLogs)).toBe(true);
    expect(body.recentLogs.length).toBeLessThanOrEqual(50);
  });

  // Lock 1b — source is 'none' for an empty repo (resolver fallback).
  it('source is "none" for an empty repo before any start call', async () => {
    const res = await fetch(`${baseUrl}/api/preview/status`);
    const body = await res.json();
    // An empty repo (no PROJECT.md, no package.json) returns source='none' from
    // the resolver. The status route must fall back to the resolver and return
    // the actual value, not null.
    expect(body.source).toBe('none');
  });
});

// ===========================================================================
// Lock 2: POST /api/preview/start with mode=none → 409 + configure hint
// ===========================================================================
describe('TASK-067 — POST /api/preview/start with mode=none returns 409 + hint', () => {
  let repoRoot;
  let server;
  let baseUrl;

  beforeEach(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), 'preview-none-spec-'));
    makeEmptyRepo(repoRoot);
    ({ server, baseUrl } = await startServer(repoRoot));
  });

  afterEach(async () => {
    if (server) await closeServer(server);
    if (repoRoot) rmSync(repoRoot, { recursive: true, force: true });
  });

  it('returns 409 when no preview is configured', async () => {
    const res = await fetch(`${baseUrl}/api/preview/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status, 'mode=none must return 409').toBe(409);
  });

  it('includes a configure hint in the response body', async () => {
    const res = await fetch(`${baseUrl}/api/preview/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const body = await res.json();
    expect(typeof body.error).toBe('string');
    expect(typeof body.hint).toBe('string');
    expect(body.hint.length).toBeGreaterThan(0);
  });

  it('does not crash the server (subsequent /api/preview/status still works)', async () => {
    await fetch(`${baseUrl}/api/preview/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const statusRes = await fetch(`${baseUrl}/api/preview/status`);
    expect(statusRes.status).toBe(200);
  });
});

// ===========================================================================
// Lock 3-5: Hardening guard parity on POST /api/preview/start
// ===========================================================================
describe('TASK-067 — POST /api/preview/start hardening guards', () => {
  let repoRoot;
  let server;
  let baseUrl;
  let port;

  beforeEach(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), 'preview-guard-spec-'));
    makeEmptyRepo(repoRoot);
    ({ server, baseUrl, port } = await startServer(repoRoot));
  });

  afterEach(async () => {
    if (server) await closeServer(server);
    if (repoRoot) rmSync(repoRoot, { recursive: true, force: true });
  });

  // Lock 3 — wrong Content-Type → 415
  it('POST /api/preview/start with wrong Content-Type returns 415', async () => {
    const res = await fetch(`${baseUrl}/api/preview/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: '{}',
    });
    expect(res.status, 'wrong Content-Type must return 415').toBe(415);
    const body = await res.json();
    expect(typeof body.error).toBe('string');
  });

  // Lock 4 — oversized body → 413
  it('POST /api/preview/start with body over 64 KiB returns 413', async () => {
    const bigBody = JSON.stringify({ junk: 'x'.repeat(65 * 1024) });
    const res = await fetch(`${baseUrl}/api/preview/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bigBody,
    });
    expect(res.status, 'oversized body must return 413').toBe(413);
    const body = await res.json();
    expect(typeof body.error).toBe('string');
  });

  // Lock 5 — non-local Host → 403
  it('POST /api/preview/start with non-local Host returns 403', async () => {
    const result = await rawRequest(
      {
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: '/api/preview/start',
        headers: {
          Host: 'evil.example.com',
          'Content-Type': 'application/json',
          'Content-Length': 2,
        },
      },
      '{}',
    );
    expect(result.status, 'non-local Host must return 403').toBe(403);
    const body = JSON.parse(result.body);
    expect(typeof body.error).toBe('string');
  });
});

// ===========================================================================
// Lock 6: GET /api/preview/stream — SSE content-type + subscriber-count leak
//
// The leak regression assertion works as follows:
//   1. Record baseline = getSubscriberCount() before any SSE connection.
//   2. Open an SSE connection → count must increase by exactly 1.
//   3. Destroy the socket (simulate client disconnect).
//   4. Poll until count returns to baseline → proves the route's
//      `req.socket.on('close', () => { unsubscribePreview(); ... })` path ran.
//
// If the unsubscribe-on-close line were removed, step 4 would time out because
// the route's onPreviewEvent function would remain in _subs indefinitely.
// ===========================================================================
describe('TASK-067 — GET /api/preview/stream SSE content-type + subscriber-count cleanup', () => {
  let repoRoot;
  let server;
  let baseUrl;
  let port;
  let previewController;

  beforeEach(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), 'preview-sse-spec-'));
    makeEmptyRepo(repoRoot);
    previewController = createPreviewController({ repoRoot });
    ({ server, baseUrl, port } = await startServer(repoRoot, previewController));
  });

  afterEach(async () => {
    if (server) await closeServer(server);
    if (previewController) {
      try { await previewController.stop(); } catch { /* ignore */ }
    }
    if (repoRoot) rmSync(repoRoot, { recursive: true, force: true });
  });

  it('returns 200 with Content-Type text/event-stream', async () => {
    const result = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          method: 'GET',
          path: '/api/preview/stream',
          headers: { Host: `127.0.0.1:${port}` },
        },
        (res) => {
          const status = res.statusCode;
          const contentType = res.headers['content-type'] || '';
          req.socket.destroy();
          resolve({ status, contentType });
        },
      );
      req.on('error', (err) => {
        if (err.code === 'ECONNRESET') return;
        reject(err);
      });
      req.end();
    });

    expect(result.status, 'SSE endpoint must return 200').toBe(200);
    expect(result.contentType, 'SSE endpoint must return text/event-stream').toMatch(/text\/event-stream/);
  });

  it('subscriber count returns to baseline after client disconnects (no leak)', async () => {
    // Step 1: record the baseline subscriber count before any SSE connection.
    const baseline = previewController.getSubscriberCount();

    // Step 2: open an SSE connection and wait for headers (confirms the route
    // has run and called subscribe() before we measure).
    let sseSocket;
    await new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          method: 'GET',
          path: '/api/preview/stream',
          headers: { Host: `127.0.0.1:${port}` },
        },
        (res) => {
          // Headers received → route has subscribed. Capture socket for later destroy.
          sseSocket = req.socket;
          // Assert count increased by exactly 1 (the route's subscribe() call).
          expect(
            previewController.getSubscriberCount(),
            'subscriber count must increase by 1 while SSE client is connected',
          ).toBe(baseline + 1);
          resolve();
        },
      );
      req.on('error', (err) => {
        if (err.code === 'ECONNRESET') return;
        reject(err);
      });
      req.end();
    });

    // Step 3: destroy the socket to simulate client disconnect.
    sseSocket.destroy();

    // Step 4: poll until the count returns to baseline.
    // The route's `req.socket.on('close', () => { unsubscribePreview(); ... })`
    // is asynchronous — give it up to 2 s to fire.
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      if (previewController.getSubscriberCount() === baseline) break;
      await new Promise((r) => setTimeout(r, 20));
    }

    expect(
      previewController.getSubscriberCount(),
      'subscriber count must return to baseline after disconnect (no leak)',
    ).toBe(baseline);
  });
});

// ===========================================================================
// Lock 7: space-bearing-command launch via string[] argv (carried constraint)
// ===========================================================================
describe('TASK-067 — space-bearing command path via string[] argv', () => {
  let repoRoot;
  let ctrl;
  let fixtureDir;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'preview-argv-spec-'));
    fixtureDir = mkdtempSync(join(tmpdir(), 'preview-argv-fixtures-'));
  });

  afterEach(async () => {
    if (ctrl) {
      try { await ctrl.stop(); } catch { /* ignore */ }
      ctrl = null;
    }
    if (repoRoot) rmSync(repoRoot, { recursive: true, force: true });
    if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
  });

  it('launches correctly when command is a string[] with a space-bearing path segment', async () => {
    const spacedDir = join(fixtureDir, 'path with space');
    mkdirSync(spacedDir, { recursive: true });
    const scriptPath = join(spacedDir, 'server.js');
    writeFileSync(scriptPath, FIXTURE_SERVER_SRC.trimStart(), 'utf8');

    ctrl = createPreviewController({ repoRoot });

    const config = {
      mode: 'web',
      command: ['node', scriptPath], // pre-split argv: handles spaces in path
      cwd: repoRoot,
      url: null,
    };

    await ctrl.start(config);

    const status = await pollUntil(ctrl, (s) => s.state === 'running', { timeoutMs: 8000 });
    expect(status.state).toBe('running');
    expect(typeof status.pid).toBe('number');
    expect(status.pid).toBeGreaterThan(0);
  });
});

// ===========================================================================
// Lock 8: Full flow — start, status (running + url + source='configured'), stop
// ===========================================================================
describe('TASK-067 — full flow: start → running + url + source → stop → terminated', () => {
  let repoRoot;
  let fixtureDir;
  let server;
  let baseUrl;
  let previewController;

  beforeEach(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), 'preview-flow-spec-'));
    fixtureDir = mkdtempSync(join(tmpdir(), 'preview-flow-fixtures-'));

    const scriptPath = writeFixtureScript(fixtureDir);
    // PROJECT.md-configured command → source='configured'.
    makeRepoWithFixtureScript(repoRoot, scriptPath);

    previewController = createPreviewController({ repoRoot });
    ({ server, baseUrl } = await startServer(repoRoot, previewController));
  });

  afterEach(async () => {
    if (server) await closeServer(server);
    if (previewController) {
      try { await previewController.stop(); } catch { /* ignore */ }
    }
    if (repoRoot) rmSync(repoRoot, { recursive: true, force: true });
    if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
  });

  it('POST start → status shows running + url + source=configured; POST stop → stopped', async () => {
    const startRes = await fetch(`${baseUrl}/api/preview/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(startRes.status, 'start must return 200').toBe(200);

    // Wait until the controller reflects running + url detected from stdout.
    await pollUntil(
      previewController,
      (s) => s.state === 'running' && s.url !== null,
      { timeoutMs: 10000 },
    );

    const statusRes = await fetch(`${baseUrl}/api/preview/status`);
    expect(statusRes.status).toBe(200);
    const statusBody = await statusRes.json();

    expect(statusBody.state, 'status must be running').toBe('running');
    expect(statusBody.url, 'url must be non-null after start').not.toBeNull();
    expect(statusBody.url).toMatch(/^http:\/\/localhost:\d+$/);
    // Lock 1b strengthened: source must be 'configured' (from PROJECT.md block).
    expect(statusBody.source, 'source must be configured for PROJECT.md preview_command').toBe('configured');

    const stopRes = await fetch(`${baseUrl}/api/preview/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(stopRes.status, 'stop must return 200').toBe(200);

    await pollUntil(previewController, (s) => s.state === 'stopped', { timeoutMs: 6000 });

    const finalStatusRes = await fetch(`${baseUrl}/api/preview/status`);
    const finalBody = await finalStatusRes.json();
    expect(finalBody.state, 'status must be stopped after stop').toBe('stopped');
  });
});

// ===========================================================================
// Lock 9: SSE stream emits incremental log lines WITHOUT a route call (AC3)
// Primary AC3 regression lock — the critical one the reviewer flagged as missing.
// ===========================================================================
describe('TASK-067 — SSE stream emits incremental log lines (AC3)', () => {
  let repoRoot;
  let fixtureDir;
  let server;
  let port;
  let previewController;

  beforeEach(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), 'preview-log-sse-spec-'));
    fixtureDir = mkdtempSync(join(tmpdir(), 'preview-log-sse-fixtures-'));

    // Write the triggerable fixture (announces URL + serves /emit-line).
    const scriptPath = writeFixtureScript(fixtureDir, FIXTURE_TRIGGERABLE_SRC);
    makeRepoWithFixtureScript(repoRoot, scriptPath);

    previewController = createPreviewController({ repoRoot });
    ({ server, port } = await startServer(repoRoot, previewController));
  });

  afterEach(async () => {
    if (server) await closeServer(server);
    if (previewController) {
      try { await previewController.stop(); } catch { /* ignore */ }
    }
    if (repoRoot) rmSync(repoRoot, { recursive: true, force: true });
    if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
  });

  it('SSE client receives a log frame when fixture emits a new line (no route call)', async () => {
    const boardBaseUrl = `http://127.0.0.1:${port}`;

    // 1. Start the fixture process via the board route.
    const startRes = await fetch(`${boardBaseUrl}/api/preview/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(startRes.status).toBe(200);

    // 2. Wait until the controller is running and URL is known (control port).
    const startStatus = await pollUntil(
      previewController,
      (s) => s.state === 'running' && s.url !== null,
      { timeoutMs: 10000 },
    );
    const fixtureControlUrl = startStatus.url; // http://localhost:<port>

    // 3. Connect an SSE client to the board's /api/preview/stream.
    //    Collect received SSE frames.
    const receivedFrames = [];
    let resolveLogFrame;
    const logFramePromise = new Promise((resolve) => { resolveLogFrame = resolve; });

    const sseReq = http.request(
      {
        host: '127.0.0.1',
        port,
        method: 'GET',
        path: '/api/preview/stream',
        headers: { Host: `127.0.0.1:${port}` },
      },
      (sseRes) => {
        let buffer = '';
        sseRes.on('data', (chunk) => {
          buffer += chunk.toString('utf8');
          // Parse complete SSE frames (delimited by \n\n).
          const parts = buffer.split('\n\n');
          buffer = parts.pop(); // last part may be incomplete
          for (const part of parts) {
            const dataLine = part.split('\n').find((l) => l.startsWith('data: '));
            if (!dataLine) continue;
            try {
              const ev = JSON.parse(dataLine.slice(6));
              receivedFrames.push(ev);
              // Resolve as soon as we see a log frame for our sentinel line.
              if (
                ev.type === 'log' &&
                typeof ev.line === 'string' &&
                ev.line.includes('incremental-log-line-from-fixture')
              ) {
                resolveLogFrame(ev);
              }
            } catch { /* ignore bad JSON */ }
          }
        });
      },
    );
    sseReq.on('error', (err) => {
      if (err.code !== 'ECONNRESET') {
        // Non-fatal; log frame may already have been received.
      }
    });
    sseReq.end();

    // 4. Give the SSE connection time to establish (receive the initial snapshot).
    await new Promise((r) => setTimeout(r, 200));

    // 5. Trigger a NEW log line from the fixture WITHOUT calling any board route.
    //    POST to the fixture's own control endpoint directly.
    await fetch(`${fixtureControlUrl}/emit-line`);

    // 6. Wait for the SSE client to receive the incremental log frame (5 s timeout).
    const logFrame = await Promise.race([
      logFramePromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(
        'timed out waiting for incremental log frame from SSE stream. ' +
        `Received frames: ${JSON.stringify(receivedFrames)}`,
      )), 5000)),
    ]);

    // 7. Clean up SSE connection.
    sseReq.socket?.destroy();

    // Assertions.
    expect(logFrame.type).toBe('log');
    expect(logFrame.line).toContain('incremental-log-line-from-fixture');
  });
});
