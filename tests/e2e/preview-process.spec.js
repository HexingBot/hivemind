// tests/e2e/preview-process.spec.js
// TASK-066 — Failing specs for src/preview-process.js.
//
// All specs MUST FAIL with "Cannot find module …preview-process.js" or equivalent
// until src/preview-process.js is created (IMPL phase).
//
// Controller contract assumed (IMPL must match exactly):
//
//   import { createPreviewController, LOG_BUFFER_CAP } from '../../src/preview-process.js';
//
//   const ctrl = createPreviewController({ repoRoot });
//   await ctrl.start(config)     — config: { mode, command, cwd, url, ... }
//   await ctrl.stop()            — idempotent; no throw when already stopped
//   await ctrl.restart(config)   — stop then start; returns new running child
//   ctrl.getStatus()             — { state, mode, url, pid, recentLogs }
//
//   States: 'stopped' | 'starting' | 'running' | 'exited' | 'error'
//   LOG_BUFFER_CAP: named numeric constant (lines); oldest lines dropped when exceeded.
//
// URL scan patterns (stdout):
//   - Full URL:  /http:\/\/localhost:\d+/
//   - Port-only: /[Ll]istening on (?:port )?(\d+)/  e.g. "Listening on port 3000"
//                                                   or "listening on 3000"
//
// Fixture scripts are written into a tmpdir at test time — self-contained, no committed
// fixtures needed.  Every test kills its child in a finally/afterEach so no orphan survives.
//
// Disk I/O + real process spawns → slow tier; lives in tests/e2e/.

import { describe, it, expect, afterAll, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';

afterAll(cleanupAll);

// ---------------------------------------------------------------------------
// Resolve the production module via file URL — fails fast until IMPL ships.
// ---------------------------------------------------------------------------
const __thisDir = dirname(fileURLToPath(import.meta.url));
const __srcDir = join(__thisDir, '..', '..', 'src');
const PREVIEW_PROCESS_URL = pathToFileURL(join(__srcDir, 'preview-process.js')).href;

// ---------------------------------------------------------------------------
// Fixture script sources — written into a tmp dir per test suite.
// ---------------------------------------------------------------------------

/**
 * A server that:
 *   1. Prints "Listening on http://localhost:<port>" on stdout.
 *   2. Actually binds an HTTP server and stays alive until SIGTERM/SIGINT.
 * This exercises URL detection (scanned from stdout) + running state.
 */
const FIXTURE_SERVER_SRC = `
const http = require('http');
const server = http.createServer((_req, res) => { res.end('ok'); });
server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  process.stdout.write('Listening on http://localhost:' + port + '\\n');
});
process.on('SIGTERM', () => { server.close(); process.exit(0); });
process.on('SIGINT',  () => { server.close(); process.exit(0); });
`;

/**
 * A server that announces via the port-only pattern "listening on port <N>"
 * so we can test the alternative URL-detection regex.
 */
const FIXTURE_PORT_ANNOUNCE_SRC = `
const http = require('http');
const server = http.createServer((_req, res) => { res.end('ok'); });
server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  process.stdout.write('listening on port ' + port + '\\n');
});
process.on('SIGTERM', () => { server.close(); process.exit(0); });
process.on('SIGINT',  () => { server.close(); process.exit(0); });
`;

/**
 * A process that exits immediately with code 0.
 * Exercises the 'exited' state transition.
 */
const FIXTURE_EXIT_IMMEDIATELY_SRC = `
process.stdout.write('goodbye\\n');
process.exit(0);
`;

/**
 * A process that floods stdout with many lines then stays alive.
 * Used for buffer-bounding tests.
 */
const FIXTURE_FLOOD_SRC = `
// Print LOG_FLOOD_LINES lines rapidly, then stay alive so the test can check the buffer.
const LINES = parseInt(process.env.LOG_FLOOD_LINES || '500', 10);
for (let i = 0; i < LINES; i++) {
  process.stdout.write('line-' + i + '\\n');
}
// Stay alive so the test can interrogate status before the process exits.
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT',  () => process.exit(0));
`;

/**
 * A process that emits binary/odd bytes (non-UTF8) then stays alive.
 * Exercises the "never throws on odd/binary output" AC.
 */
const FIXTURE_BINARY_SRC = `
// Write a sequence that includes bytes outside valid UTF-8 ranges.
process.stdout.write(Buffer.from([0xff, 0xfe, 0x00, 0x61, 0x62, 0x0a]));
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT',  () => process.exit(0));
`;

// ---------------------------------------------------------------------------
// Helper: write a fixture script file into a directory; return its path.
// ---------------------------------------------------------------------------
function writeFixture(dir, filename, src) {
  const p = join(dir, filename);
  writeFileSync(p, src.trimStart(), 'utf8');
  return p;
}

// ---------------------------------------------------------------------------
// Helper: poll getStatus() until predicate is satisfied or timeout expires.
// Returns the last status on success; throws on timeout.
// ---------------------------------------------------------------------------
async function pollUntil(ctrl, predicate, { timeoutMs = 5000, intervalMs = 50 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = ctrl.getStatus();
    if (predicate(status)) return status;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `pollUntil timed out after ${timeoutMs}ms. Last status: ${JSON.stringify(ctrl.getStatus())}`,
  );
}

// ---------------------------------------------------------------------------
// Test-local controller registry for afterEach cleanup.
// Every test that starts a controller must register it here.
// ---------------------------------------------------------------------------
const activeControllers = new Set();

afterEach(async () => {
  // Stop all controllers that were started in the test (leak-free guarantee).
  for (const ctrl of activeControllers) {
    try {
      await ctrl.stop();
    } catch {
      // Ignore errors during cleanup — the test assertion may have already
      // put the controller in a terminal state.
    }
  }
  activeControllers.clear();
});

function trackCtrl(ctrl) {
  activeControllers.add(ctrl);
  return ctrl;
}

// ---------------------------------------------------------------------------
// AC1 — module exports createPreviewController and LOG_BUFFER_CAP
// ---------------------------------------------------------------------------

describe('AC1 — module exports', () => {
  it('exports createPreviewController as a function', async () => {
    const mod = await import(PREVIEW_PROCESS_URL);
    expect(typeof mod.createPreviewController).toBe('function');
  });

  it('exports LOG_BUFFER_CAP as a positive integer', async () => {
    const { LOG_BUFFER_CAP } = await import(PREVIEW_PROCESS_URL);
    expect(typeof LOG_BUFFER_CAP).toBe('number');
    expect(Number.isInteger(LOG_BUFFER_CAP)).toBe(true);
    expect(LOG_BUFFER_CAP).toBeGreaterThan(0);
  });

  it('createPreviewController returns an object with start/stop/restart/getStatus', async () => {
    const { createPreviewController } = await import(PREVIEW_PROCESS_URL);
    const repoRoot = makeTmpDir('af-pp-exports');
    const ctrl = createPreviewController({ repoRoot });
    expect(typeof ctrl.start).toBe('function');
    expect(typeof ctrl.stop).toBe('function');
    expect(typeof ctrl.restart).toBe('function');
    expect(typeof ctrl.getStatus).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// AC2 — getStatus shape and initial state
// ---------------------------------------------------------------------------

describe('AC2 — getStatus shape', () => {
  it('getStatus returns the required fields with initial state=stopped', async () => {
    const { createPreviewController } = await import(PREVIEW_PROCESS_URL);
    const repoRoot = makeTmpDir('af-pp-status-shape');
    const ctrl = createPreviewController({ repoRoot });

    const status = ctrl.getStatus();

    expect(Object.prototype.hasOwnProperty.call(status, 'state')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(status, 'mode')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(status, 'url')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(status, 'pid')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(status, 'recentLogs')).toBe(true);
  });

  it('initial state is stopped with null pid and null url', async () => {
    const { createPreviewController } = await import(PREVIEW_PROCESS_URL);
    const repoRoot = makeTmpDir('af-pp-initial-state');
    const ctrl = createPreviewController({ repoRoot });

    const status = ctrl.getStatus();

    expect(status.state).toBe('stopped');
    expect(status.pid).toBeNull();
    expect(status.url).toBeNull();
    expect(Array.isArray(status.recentLogs)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC2 — State machine: stopped -> starting -> running
// ---------------------------------------------------------------------------

describe('AC2 — state machine: stopped -> starting -> running', () => {
  it('transitions to running after starting a long-lived server fixture', async () => {
    const { createPreviewController } = await import(PREVIEW_PROCESS_URL);
    const fixtureDir = makeTmpDir('af-pp-sm-running-fixtures');
    const scriptPath = writeFixture(fixtureDir, 'server.js', FIXTURE_SERVER_SRC);

    const repoRoot = makeTmpDir('af-pp-sm-running');
    const ctrl = trackCtrl(createPreviewController({ repoRoot }));

    const config = {
      mode: 'web',
      command: `node ${scriptPath}`,
      cwd: repoRoot,
      url: null,
    };

    // Start must return without throwing.
    await ctrl.start(config);

    // Poll until running (the process needs a moment to bind and print its URL).
    const status = await pollUntil(ctrl, (s) => s.state === 'running', { timeoutMs: 6000 });

    expect(status.state).toBe('running');
    expect(typeof status.pid).toBe('number');
    expect(status.pid).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// AC2 — State machine: -> exited when process exits naturally
// ---------------------------------------------------------------------------

describe('AC2 — state machine: -> exited when process exits', () => {
  it('transitions to exited after a process that exits immediately', async () => {
    const { createPreviewController } = await import(PREVIEW_PROCESS_URL);
    const fixtureDir = makeTmpDir('af-pp-sm-exited-fixtures');
    const scriptPath = writeFixture(fixtureDir, 'exit-immediately.js', FIXTURE_EXIT_IMMEDIATELY_SRC);

    const repoRoot = makeTmpDir('af-pp-sm-exited');
    const ctrl = trackCtrl(createPreviewController({ repoRoot }));

    const config = {
      mode: 'process',
      command: `node ${scriptPath}`,
      cwd: repoRoot,
      url: null,
    };

    await ctrl.start(config);

    // Poll until exited.
    const status = await pollUntil(
      ctrl,
      (s) => s.state === 'exited' || s.state === 'error',
      { timeoutMs: 6000 },
    );

    expect(['exited', 'error']).toContain(status.state);
  });
});

// ---------------------------------------------------------------------------
// AC2 — State machine: -> error on a bad/nonexistent command
// ---------------------------------------------------------------------------

describe('AC2 — state machine: -> error on a bad command', () => {
  it('transitions to error state when the command does not exist', async () => {
    const { createPreviewController } = await import(PREVIEW_PROCESS_URL);
    const repoRoot = makeTmpDir('af-pp-sm-error');
    const ctrl = trackCtrl(createPreviewController({ repoRoot }));

    const config = {
      mode: 'process',
      command: 'this-binary-definitely-does-not-exist-af-066',
      cwd: repoRoot,
      url: null,
    };

    // start() should not throw synchronously — the error surfaces as state transition.
    try {
      await ctrl.start(config);
    } catch {
      // start() MAY throw for a spawn error; that is also acceptable.
    }

    // Either start() threw, or the controller must settle into error/exited.
    const status = await pollUntil(
      ctrl,
      (s) => s.state === 'error' || s.state === 'exited',
      { timeoutMs: 6000 },
    );

    expect(['error', 'exited']).toContain(status.state);
  });
});

// ---------------------------------------------------------------------------
// AC3 — Bounded buffer: recentLogs never exceeds LOG_BUFFER_CAP after a flood
// ---------------------------------------------------------------------------

describe('AC3 — bounded buffer: length never exceeds LOG_BUFFER_CAP', () => {
  it('recentLogs.length <= LOG_BUFFER_CAP after flooding stdout with > cap lines', async () => {
    const { createPreviewController, LOG_BUFFER_CAP } = await import(PREVIEW_PROCESS_URL);
    const floodLines = LOG_BUFFER_CAP + 100; // deliberately exceed the cap

    const fixtureDir = makeTmpDir('af-pp-buf-fixtures');
    const scriptPath = writeFixture(fixtureDir, 'flood.js', FIXTURE_FLOOD_SRC);

    const repoRoot = makeTmpDir('af-pp-buf');
    const ctrl = trackCtrl(createPreviewController({ repoRoot }));

    const config = {
      mode: 'process',
      command: `node ${scriptPath}`,
      cwd: repoRoot,
      url: null,
      env: { LOG_FLOOD_LINES: String(floodLines) },
    };

    await ctrl.start(config);

    // Wait until the flood output has been processed (all lines are short; the process
    // stays alive after printing, so we can poll the buffer length).
    await pollUntil(
      ctrl,
      (s) => s.recentLogs.length >= LOG_BUFFER_CAP,
      { timeoutMs: 8000 },
    );

    const status = ctrl.getStatus();
    expect(status.recentLogs.length).toBeLessThanOrEqual(LOG_BUFFER_CAP);
  });
});

// ---------------------------------------------------------------------------
// AC3 — Bounded buffer: oldest lines are dropped (ring-buffer semantics)
// ---------------------------------------------------------------------------

describe('AC3 — bounded buffer: oldest lines dropped when cap exceeded', () => {
  it('the oldest lines are absent from recentLogs after overflow', async () => {
    const { createPreviewController, LOG_BUFFER_CAP } = await import(PREVIEW_PROCESS_URL);
    const floodLines = LOG_BUFFER_CAP + 50;

    const fixtureDir = makeTmpDir('af-pp-buf-oldest-fixtures');
    const scriptPath = writeFixture(fixtureDir, 'flood.js', FIXTURE_FLOOD_SRC);

    const repoRoot = makeTmpDir('af-pp-buf-oldest');
    const ctrl = trackCtrl(createPreviewController({ repoRoot }));

    const config = {
      mode: 'process',
      command: `node ${scriptPath}`,
      cwd: repoRoot,
      url: null,
      env: { LOG_FLOOD_LINES: String(floodLines) },
    };

    await ctrl.start(config);

    // Wait until the buffer is full.
    await pollUntil(
      ctrl,
      (s) => s.recentLogs.length >= LOG_BUFFER_CAP,
      { timeoutMs: 8000 },
    );

    const status = ctrl.getStatus();

    // The first line ever printed was "line-0".  After LOG_BUFFER_CAP+50 lines,
    // "line-0" must have been evicted from the ring buffer.
    const hasLine0 = status.recentLogs.some((l) => l.includes('line-0'));
    expect(hasLine0).toBe(false);

    // The LAST line printed ("line-<floodLines-1>") must still be present.
    const lastLine = `line-${floodLines - 1}`;
    const hasLastLine = status.recentLogs.some((l) => l.includes(lastLine));
    expect(hasLastLine).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC3 — Bounded buffer: never throws on odd/binary output
// ---------------------------------------------------------------------------

describe('AC3 — bounded buffer: no throw on binary/odd output', () => {
  it('does not throw when the child emits binary bytes on stdout', async () => {
    const { createPreviewController } = await import(PREVIEW_PROCESS_URL);
    const fixtureDir = makeTmpDir('af-pp-binary-fixtures');
    const scriptPath = writeFixture(fixtureDir, 'binary.js', FIXTURE_BINARY_SRC);

    const repoRoot = makeTmpDir('af-pp-binary');
    const ctrl = trackCtrl(createPreviewController({ repoRoot }));

    const config = {
      mode: 'process',
      command: `node ${scriptPath}`,
      cwd: repoRoot,
      url: null,
    };

    // Must not throw.
    await expect(ctrl.start(config)).resolves.not.toThrow();

    // Give it a moment to process the output.
    await new Promise((r) => setTimeout(r, 500));

    // getStatus must also not throw.
    expect(() => ctrl.getStatus()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// AC4 — URL detection: configured url wins (no stdout scan needed)
// ---------------------------------------------------------------------------

describe('AC4 — URL detection: configured url takes precedence', () => {
  it('getStatus().url reflects the configured url when one is supplied', async () => {
    const { createPreviewController } = await import(PREVIEW_PROCESS_URL);
    const fixtureDir = makeTmpDir('af-pp-url-cfg-fixtures');
    // Use the port-announce fixture so stdout differs from configured URL —
    // if the controller uses stdout, it would pick up the wrong URL.
    const scriptPath = writeFixture(fixtureDir, 'server.js', FIXTURE_SERVER_SRC);

    const repoRoot = makeTmpDir('af-pp-url-cfg');
    const ctrl = trackCtrl(createPreviewController({ repoRoot }));

    const CONFIGURED_URL = 'http://localhost:7654';
    const config = {
      mode: 'web',
      command: `node ${scriptPath}`,
      cwd: repoRoot,
      url: CONFIGURED_URL,
    };

    await ctrl.start(config);

    // Poll until running.
    await pollUntil(ctrl, (s) => s.state === 'running', { timeoutMs: 6000 });

    const status = ctrl.getStatus();
    // The configured URL must win regardless of what stdout printed.
    expect(status.url).toBe(CONFIGURED_URL);
  });
});

// ---------------------------------------------------------------------------
// AC4 — URL detection: scanned from stdout when config has no url
// (full http://localhost:<port> pattern)
// ---------------------------------------------------------------------------

describe('AC4 — URL detection: scanned from stdout (full URL pattern)', () => {
  it('detects url from "Listening on http://localhost:<port>" in stdout', async () => {
    const { createPreviewController } = await import(PREVIEW_PROCESS_URL);
    const fixtureDir = makeTmpDir('af-pp-url-scan-fixtures');
    const scriptPath = writeFixture(fixtureDir, 'server.js', FIXTURE_SERVER_SRC);

    const repoRoot = makeTmpDir('af-pp-url-scan');
    const ctrl = trackCtrl(createPreviewController({ repoRoot }));

    const config = {
      mode: 'web',
      command: `node ${scriptPath}`,
      cwd: repoRoot,
      url: null, // no configured URL — must scan stdout
    };

    await ctrl.start(config);

    // Poll until url is detected.
    const status = await pollUntil(
      ctrl,
      (s) => s.state === 'running' && s.url !== null,
      { timeoutMs: 6000 },
    );

    expect(status.url).toMatch(/^http:\/\/localhost:\d+$/);
  });
});

// ---------------------------------------------------------------------------
// AC4 — URL detection: port-only "listening on port <N>" pattern
// ---------------------------------------------------------------------------

describe('AC4 — URL detection: scanned from stdout (port-only pattern)', () => {
  it('detects url from "listening on port <N>" in stdout', async () => {
    const { createPreviewController } = await import(PREVIEW_PROCESS_URL);
    const fixtureDir = makeTmpDir('af-pp-url-port-fixtures');
    const scriptPath = writeFixture(fixtureDir, 'server.js', FIXTURE_PORT_ANNOUNCE_SRC);

    const repoRoot = makeTmpDir('af-pp-url-port');
    const ctrl = trackCtrl(createPreviewController({ repoRoot }));

    const config = {
      mode: 'web',
      command: `node ${scriptPath}`,
      cwd: repoRoot,
      url: null,
    };

    await ctrl.start(config);

    // Poll until url is detected.
    const status = await pollUntil(
      ctrl,
      (s) => s.state === 'running' && s.url !== null,
      { timeoutMs: 6000 },
    );

    // URL must be constructed from the detected port.
    expect(status.url).toMatch(/^http:\/\/localhost:\d+$/);
  });
});

// ---------------------------------------------------------------------------
// AC5 — stop() terminates cleanly; idempotent (no throw when already stopped)
// ---------------------------------------------------------------------------

describe('AC5 — stop(): terminates child, no orphan, idempotent', () => {
  it('stop() transitions from running to stopped without throwing', async () => {
    const { createPreviewController } = await import(PREVIEW_PROCESS_URL);
    const fixtureDir = makeTmpDir('af-pp-stop-fixtures');
    const scriptPath = writeFixture(fixtureDir, 'server.js', FIXTURE_SERVER_SRC);

    const repoRoot = makeTmpDir('af-pp-stop');
    const ctrl = trackCtrl(createPreviewController({ repoRoot }));

    const config = {
      mode: 'web',
      command: `node ${scriptPath}`,
      cwd: repoRoot,
      url: null,
    };

    await ctrl.start(config);
    await pollUntil(ctrl, (s) => s.state === 'running', { timeoutMs: 6000 });

    // stop() must not throw.
    await expect(ctrl.stop()).resolves.not.toThrow();

    // After stop(), state must be stopped and pid must be null.
    const status = await pollUntil(
      ctrl,
      (s) => s.state === 'stopped',
      { timeoutMs: 4000 },
    );
    expect(status.state).toBe('stopped');
    expect(status.pid).toBeNull();
  });

  it('stop() is idempotent: calling twice does not throw', async () => {
    const { createPreviewController } = await import(PREVIEW_PROCESS_URL);
    const fixtureDir = makeTmpDir('af-pp-stop-idem-fixtures');
    const scriptPath = writeFixture(fixtureDir, 'server.js', FIXTURE_SERVER_SRC);

    const repoRoot = makeTmpDir('af-pp-stop-idem');
    const ctrl = trackCtrl(createPreviewController({ repoRoot }));

    const config = {
      mode: 'web',
      command: `node ${scriptPath}`,
      cwd: repoRoot,
      url: null,
    };

    await ctrl.start(config);
    await pollUntil(ctrl, (s) => s.state === 'running', { timeoutMs: 6000 });

    await ctrl.stop();

    // Second stop on already-stopped controller must not throw.
    await expect(ctrl.stop()).resolves.not.toThrow();
  });

  it('stop() on a brand-new controller (never started) does not throw', async () => {
    const { createPreviewController } = await import(PREVIEW_PROCESS_URL);
    const repoRoot = makeTmpDir('af-pp-stop-never-started');
    const ctrl = createPreviewController({ repoRoot });
    // No trackCtrl — never started; stop should be a no-op.
    await expect(ctrl.stop()).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// AC5 — restart() = stop then start; yields a NEW running pid
// ---------------------------------------------------------------------------

describe('AC5 — restart(): stop + start, new pid', () => {
  it('restart() yields a running state with a different pid than before', async () => {
    const { createPreviewController } = await import(PREVIEW_PROCESS_URL);
    const fixtureDir = makeTmpDir('af-pp-restart-fixtures');
    const scriptPath = writeFixture(fixtureDir, 'server.js', FIXTURE_SERVER_SRC);

    const repoRoot = makeTmpDir('af-pp-restart');
    const ctrl = trackCtrl(createPreviewController({ repoRoot }));

    const config = {
      mode: 'web',
      command: `node ${scriptPath}`,
      cwd: repoRoot,
      url: null,
    };

    // First start.
    await ctrl.start(config);
    const firstStatus = await pollUntil(ctrl, (s) => s.state === 'running', { timeoutMs: 6000 });
    const firstPid = firstStatus.pid;

    // Restart.
    await ctrl.restart(config);

    // Must reach running state again.
    const secondStatus = await pollUntil(ctrl, (s) => s.state === 'running', { timeoutMs: 6000 });
    const secondPid = secondStatus.pid;

    // New process — PID must differ.
    expect(secondPid).not.toBe(firstPid);
    expect(typeof secondPid).toBe('number');
    expect(secondPid).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// AC2 — Single active preview: a second start() while running must replace the
// first child (only one live child at a time — no orphan left behind).
// ---------------------------------------------------------------------------

describe('AC2 — single active preview: second start replaces first child', () => {
  it('starting a second time while running terminates the first child', async () => {
    const { createPreviewController } = await import(PREVIEW_PROCESS_URL);
    const fixtureDir = makeTmpDir('af-pp-single-fixtures');
    const scriptPath = writeFixture(fixtureDir, 'server.js', FIXTURE_SERVER_SRC);

    const repoRoot = makeTmpDir('af-pp-single');
    const ctrl = trackCtrl(createPreviewController({ repoRoot }));

    const config = {
      mode: 'web',
      command: `node ${scriptPath}`,
      cwd: repoRoot,
      url: null,
    };

    // First start.
    await ctrl.start(config);
    const firstStatus = await pollUntil(ctrl, (s) => s.state === 'running', { timeoutMs: 6000 });
    const firstPid = firstStatus.pid;

    // Second start (implicit restart by calling start again).
    await ctrl.start(config);
    const secondStatus = await pollUntil(ctrl, (s) => s.state === 'running', { timeoutMs: 6000 });

    // The PID must be different — the old child was replaced.
    expect(secondStatus.pid).not.toBe(firstPid);
  });
});

// ---------------------------------------------------------------------------
// AC2 — mode field in getStatus reflects the config mode passed to start()
// ---------------------------------------------------------------------------

describe('AC2 — getStatus().mode reflects config.mode', () => {
  it('mode in status matches the mode from the config passed to start()', async () => {
    const { createPreviewController } = await import(PREVIEW_PROCESS_URL);
    const fixtureDir = makeTmpDir('af-pp-mode-fixtures');
    const scriptPath = writeFixture(fixtureDir, 'server.js', FIXTURE_SERVER_SRC);

    const repoRoot = makeTmpDir('af-pp-mode');
    const ctrl = trackCtrl(createPreviewController({ repoRoot }));

    const config = {
      mode: 'web',
      command: `node ${scriptPath}`,
      cwd: repoRoot,
      url: null,
    };

    await ctrl.start(config);
    await pollUntil(ctrl, (s) => s.state === 'running', { timeoutMs: 6000 });

    const status = ctrl.getStatus();
    expect(status.mode).toBe('web');
  });
});
