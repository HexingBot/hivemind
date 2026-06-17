// tests/e2e/preview-panel.spec.js
// TASK-068 — Regression locks: Preview panel in the unified console shell.
//
// tests-after tier — minimal locks encoding each AC:
//
//   Lock 1  GET / HTML contains the Preview tab and its aria attributes.
//           Encodes AC1: Preview panel/tab present in the console.
//   Lock 2  GET / HTML contains preview control buttons (Start, Stop, Restart)
//           and the status indicator element.
//           Encodes AC1: controls wired.
//   Lock 3  GET / HTML contains the iframe element with sandbox attribute.
//           Encodes AC2: web-mode iframe markup path present.
//   Lock 4  GET / HTML contains the log view element and the hint card element.
//           Encodes AC2+AC4: process/none-mode markup paths present.
//   Lock 5  GET / HTML does NOT contain any external http(s):// src/href URLs
//           (offline / no CDN regression for the new preview markup).
//   Lock 6  mode=none: POST /api/preview/start returns 409 and the page still
//           serves correctly (no crash — AC4 graceful absent).
//   Lock 7  XSS: the iframe's sandbox attribute is present in the served HTML
//           (belt-and-suspenders XSS guard check; iframe cannot eval scripts
//           from a sandboxed origin without allow-scripts).
//   Lock 8  Fixtures present: tests/fixtures/preview-web/server.js and
//           tests/fixtures/preview-canvas/server.js exist on disk and both
//           print "Listening on http://localhost:<port>" when launched (AC5).
//           These are the fixtures the UAT uses.
//
// Slow tier (real tmpdir + server spawn) → tests/e2e/.

import {
  describe, it, expect, beforeEach, afterEach,
} from 'vitest';
import {
  mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import http from 'node:http';

import { createBoardServer } from '../../src/task-board.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Start a board server on an ephemeral port; returns { server, baseUrl }. */
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

/** Close the server and await. */
function closeServer(server) {
  return new Promise((res, rej) => {
    server.close((err) => (err ? rej(err) : res()));
  });
}

/** Make a minimal repo skeleton (empty tasks dir + index). */
function makeEmptyRepo(repoRoot) {
  mkdirSync(join(repoRoot, 'tasks'), { recursive: true });
  writeFileSync(join(repoRoot, 'tasks', 'index.json'), JSON.stringify({ tasks: [] }));
}

// Repo root of THIS repo (where the fixture files live).
const THIS_REPO = resolve(join(import.meta.url.replace(/^file:\/\/\//, ''), '..', '..', '..'));
// On Windows file URLs look like file:///D:/... — normalize to an absolute path.
function repoRootFromMeta() {
  const url = import.meta.url;
  // Node: new URL(url).pathname gives /D:/... on Windows — join correctly.
  const pathname = new URL(url).pathname;
  // Drop leading slash on Windows paths (e.g. /D:/ -> D:/).
  const normalized = pathname.replace(/^\/([A-Za-z]:)/, '$1');
  return resolve(join(normalized, '..', '..', '..'));
}

const REPO_ROOT = repoRootFromMeta();

// ===========================================================================
// Lock 1 + 2: HTML contains Preview tab + controls
// ===========================================================================
describe('TASK-068 — GET / HTML: Preview tab and controls present (AC1)', () => {
  let repoRoot;
  let server;
  let baseUrl;

  beforeEach(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), 'preview-panel-spec-'));
    makeEmptyRepo(repoRoot);
    ({ server, baseUrl } = await startServer(repoRoot));
  });

  afterEach(async () => {
    if (server) await closeServer(server);
    if (repoRoot) rmSync(repoRoot, { recursive: true, force: true });
  });

  it('HTML contains a Preview tab button', async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    const html = await res.text();

    // The tab button must exist with the correct label.
    expect(html).toContain('tab-preview');
    expect(html.toLowerCase()).toContain('preview');
  });

  it('HTML contains Start, Stop, Restart buttons and a status indicator', async () => {
    const res = await fetch(`${baseUrl}/`);
    const html = await res.text();

    expect(html).toContain('preview-start-btn');
    expect(html).toContain('preview-stop-btn');
    expect(html).toContain('preview-restart-btn');
    expect(html).toContain('preview-status-chip');
  });

  it('HTML contains the preview panel container', async () => {
    const res = await fetch(`${baseUrl}/`);
    const html = await res.text();
    expect(html).toContain('panel-preview');
  });
});

// ===========================================================================
// Lock 3 + 4: HTML contains iframe, log view, and hint card markup paths
// ===========================================================================
describe('TASK-068 — GET / HTML: mode-switch markup paths present (AC2 + AC4)', () => {
  let repoRoot;
  let server;
  let baseUrl;

  beforeEach(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), 'preview-modes-spec-'));
    makeEmptyRepo(repoRoot);
    ({ server, baseUrl } = await startServer(repoRoot));
  });

  afterEach(async () => {
    if (server) await closeServer(server);
    if (repoRoot) rmSync(repoRoot, { recursive: true, force: true });
  });

  // Lock 3 — web mode: iframe element present.
  it('HTML contains an iframe element for web mode (AC2)', async () => {
    const res = await fetch(`${baseUrl}/`);
    const html = await res.text();
    expect(html).toContain('preview-iframe');
    expect(html.toLowerCase()).toContain('<iframe');
  });

  // Lock 4a — process mode: log view element present.
  it('HTML contains a log view element for process mode (AC2)', async () => {
    const res = await fetch(`${baseUrl}/`);
    const html = await res.text();
    expect(html).toContain('preview-log');
  });

  // Lock 4b — none mode: hint card element present.
  it('HTML contains a hint card element for mode=none (AC4 graceful absent)', async () => {
    const res = await fetch(`${baseUrl}/`);
    const html = await res.text();
    expect(html).toContain('preview-hint');
    // Hint must mention PROJECT.md configuration.
    expect(html).toContain('PROJECT.md');
  });
});

// ===========================================================================
// Lock 5: no external URLs in the preview panel HTML
// ===========================================================================
describe('TASK-068 — GET / HTML: no external http(s) URLs (offline requirement)', () => {
  let repoRoot;
  let server;
  let baseUrl;

  beforeEach(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), 'preview-offline-spec-'));
    makeEmptyRepo(repoRoot);
    ({ server, baseUrl } = await startServer(repoRoot));
  });

  afterEach(async () => {
    if (server) await closeServer(server);
    if (repoRoot) rmSync(repoRoot, { recursive: true, force: true });
  });

  it('HTML has no external http(s) URLs in src/href attributes', async () => {
    const res = await fetch(`${baseUrl}/`);
    const html = await res.text();
    const externalUrlRe = /(?:src|href)\s*=\s*["']https?:\/\//gi;
    const matches = html.match(externalUrlRe);
    expect(
      matches,
      `HTML must not reference external URLs via src/href. Found: ${JSON.stringify(matches)}`,
    ).toBeNull();
  });
});

// ===========================================================================
// Lock 6: mode=none graceful — POST /api/preview/start → 409, no crash
// ===========================================================================
describe('TASK-068 — mode=none: graceful absent, no crash (AC4)', () => {
  let repoRoot;
  let server;
  let baseUrl;

  beforeEach(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), 'preview-none-panel-spec-'));
    makeEmptyRepo(repoRoot);
    ({ server, baseUrl } = await startServer(repoRoot));
  });

  afterEach(async () => {
    if (server) await closeServer(server);
    if (repoRoot) rmSync(repoRoot, { recursive: true, force: true });
  });

  it('POST /api/preview/start with no config returns 409 + hint (no crash)', async () => {
    const res = await fetch(`${baseUrl}/api/preview/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status, 'mode=none must return 409').toBe(409);
    const body = await res.json();
    expect(typeof body.hint, 'hint must be a string').toBe('string');
    expect(body.hint.length, 'hint must not be empty').toBeGreaterThan(0);
  });

  it('server continues to serve GET / after a 409 start (no crash)', async () => {
    await fetch(`${baseUrl}/api/preview/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const res = await fetch(`${baseUrl}/`);
    expect(res.status, 'GET / must still return 200 after 409 start').toBe(200);
  });
});

// ===========================================================================
// Lock 7: XSS guard — iframe has sandbox attribute in served HTML
// ===========================================================================
describe('TASK-068 — XSS: iframe sandbox attribute present in HTML (AC2 XSS-safe)', () => {
  let repoRoot;
  let server;
  let baseUrl;

  beforeEach(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), 'preview-xss-spec-'));
    makeEmptyRepo(repoRoot);
    ({ server, baseUrl } = await startServer(repoRoot));
  });

  afterEach(async () => {
    if (server) await closeServer(server);
    if (repoRoot) rmSync(repoRoot, { recursive: true, force: true });
  });

  it('iframe element carries a sandbox attribute in the HTML source', async () => {
    const res = await fetch(`${baseUrl}/`);
    const html = await res.text();

    // Extract the iframe element from the HTML for inspection.
    const iframeMatch = html.match(/<iframe[^>]*>/i);
    expect(iframeMatch, 'iframe element must be present in HTML').not.toBeNull();

    const iframeTag = iframeMatch[0];
    expect(
      iframeTag.toLowerCase(),
      'iframe must have a sandbox attribute',
    ).toContain('sandbox');
  });
});

// ===========================================================================
// Lock 8: Fixtures present on disk and produce a "Listening on" line (AC5)
// ===========================================================================
describe('TASK-068 — Sample fixtures present and launchable (AC5)', () => {
  it('tests/fixtures/preview-web/server.js exists on disk', () => {
    const fixturePath = join(REPO_ROOT, 'tests', 'fixtures', 'preview-web', 'server.js');
    expect(existsSync(fixturePath), `fixture must exist: ${fixturePath}`).toBe(true);
  });

  it('tests/fixtures/preview-canvas/server.js exists on disk', () => {
    const fixturePath = join(REPO_ROOT, 'tests', 'fixtures', 'preview-canvas', 'server.js');
    expect(existsSync(fixturePath), `fixture must exist: ${fixturePath}`).toBe(true);
  });

  it('web fixture prints "Listening on http://localhost:<port>" on stdout', async () => {
    const fixturePath = join(REPO_ROOT, 'tests', 'fixtures', 'preview-web', 'server.js');
    const line = await spawnFixtureAndReadFirstLine(fixturePath);
    expect(line, 'web fixture must announce localhost URL').toMatch(/Listening on http:\/\/localhost:\d+/);
  });

  it('canvas fixture prints "Listening on http://localhost:<port>" on stdout', async () => {
    const fixturePath = join(REPO_ROOT, 'tests', 'fixtures', 'preview-canvas', 'server.js');
    const line = await spawnFixtureAndReadFirstLine(fixturePath);
    expect(line, 'canvas fixture must announce localhost URL').toMatch(/Listening on http:\/\/localhost:\d+/);
  });
});

// ===========================================================================
// Lock 9: Single-source injection — validateLocalhostUrl function body is
// present in the served HTML (the browser runs the exact same guard the tests
// import; regression lock for the .toString() injection in buildHtml()).
// ===========================================================================
describe('TASK-068 — single-source: validateLocalhostUrl injected into GET / HTML', () => {
  let repoRoot;
  let server;
  let baseUrl;

  beforeEach(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), 'preview-inject-spec-'));
    makeEmptyRepo(repoRoot);
    ({ server, baseUrl } = await startServer(repoRoot));
  });

  afterEach(async () => {
    if (server) await closeServer(server);
    if (repoRoot) rmSync(repoRoot, { recursive: true, force: true });
  });

  it('GET / HTML contains the validateLocalhostUrl function declaration', async () => {
    const res = await fetch(`${baseUrl}/`);
    const html = await res.text();
    expect(
      html,
      'validateLocalhostUrl function must be present in the served HTML (single-source injection)',
    ).toContain('function validateLocalhostUrl(');
  });

  it('GET / HTML does NOT contain the raw sentinel comment (sentinel was replaced)', async () => {
    const res = await fetch(`${baseUrl}/`);
    const html = await res.text();
    expect(
      html,
      'sentinel comment must not appear literally in the served HTML (must be replaced by fn source)',
    ).not.toContain('// INJECTED_VALIDATE_LOCALHOST_URL');
  });

  it('injected validateLocalhostUrl contains the localhost regex', async () => {
    const res = await fetch(`${baseUrl}/`);
    const html = await res.text();
    // The anchored regex pattern must be present in the injected function body.
    expect(html).toContain('localhost|127\\.0\\.0\\.1');
  });
});

/**
 * Spawn a fixture node server, read its first stdout line, kill it, return the line.
 * Times out after 6 s.
 */
function spawnFixtureAndReadFirstLine(scriptPath) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let buf = '';
    const timeout = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      reject(new Error(`fixture timed out after 6 s: ${scriptPath}`));
    }, 6000);

    child.stdout.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      const nl = buf.indexOf('\n');
      if (nl !== -1) {
        const line = buf.slice(0, nl).trim();
        clearTimeout(timeout);
        try { child.kill('SIGTERM'); } catch { /* ignore */ }
        resolve(line);
      }
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}
