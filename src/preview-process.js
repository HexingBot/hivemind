// src/preview-process.js
// TASK-066 — Managed child-process controller for the previewed app.
//
// Exports:
//   createPreviewController({ repoRoot }) → controller
//   LOG_BUFFER_CAP                        → positive integer (ring-buffer cap)
//
// Controller API:
//   await ctrl.start(config)   — spawn child; replaces any existing child (single active preview)
//   await ctrl.stop()          — SIGTERM + fallback kill; idempotent, no throw
//   await ctrl.restart(config) — stop then start
//   ctrl.getStatus()           — synchronous; { state, mode, url, pid, recentLogs }
//
// config = { mode, command, cwd, url, env? }
//
// States: 'stopped' | 'starting' | 'running' | 'exited' | 'error'
//
// Spawn discipline mirrors src/orchestrator-bridge.js:
//   stdio: ['pipe','pipe','pipe'], NOT detached,
//   kill via SIGTERM with fallback child.kill(), no orphan processes.

import { spawn } from 'node:child_process';

// ---------------------------------------------------------------------------
// Ring-buffer cap for stdout/stderr log lines.
// ---------------------------------------------------------------------------
export const LOG_BUFFER_CAP = 200;

// ---------------------------------------------------------------------------
// URL detection patterns (scan stdout when config.url is null).
//   Pattern 1: full URL — http://localhost:<port>
//   Pattern 2: port-only — "Listening on port <N>" or "listening on <N>"
// ---------------------------------------------------------------------------
const RE_FULL_URL = /http:\/\/localhost:\d+/;
const RE_PORT_ONLY = /[Ll]istening on (?:port )?(\d+)/;

// ---------------------------------------------------------------------------
// createPreviewController — factory for a single managed preview process.
// ---------------------------------------------------------------------------
export function createPreviewController({ repoRoot }) {
  // Internal state.
  let _state = 'stopped';   // 'stopped'|'starting'|'running'|'exited'|'error'
  let _mode = null;         // string | null
  let _url = null;          // string | null
  let _pid = null;          // number | null
  let _logs = [];           // ring buffer (array of strings)
  let _child = null;        // ChildProcess | null
  let _configuredUrl = null; // the url field from the last start() config

  // -------------------------------------------------------------------------
  // Ring buffer helpers
  // -------------------------------------------------------------------------
  function pushLog(line) {
    _logs.push(line);
    if (_logs.length > LOG_BUFFER_CAP) {
      // Drop oldest entries to maintain cap.
      _logs = _logs.slice(_logs.length - LOG_BUFFER_CAP);
    }
  }

  // -------------------------------------------------------------------------
  // Process stdout/stderr chunk: split on newlines, push each line.
  // Never throws — handles binary/odd bytes by falling back to latin1.
  // -------------------------------------------------------------------------
  function handleChunk(chunk) {
    let text;
    try {
      text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    } catch {
      try {
        text = chunk.toString('latin1');
      } catch {
        // Last-resort: ignore chunk that cannot be decoded.
        return;
      }
    }

    // Split on newlines; each fragment becomes a log entry.
    const lines = text.split('\n');
    for (const line of lines) {
      if (line.length === 0) continue; // skip empty fragments
      pushLog(line);

      // URL detection: only scan when no URL is known yet AND config has no URL.
      if (_url === null && _configuredUrl === null) {
        // Pattern 1: full URL.
        const fullMatch = RE_FULL_URL.exec(line);
        if (fullMatch) {
          _url = fullMatch[0];
          // A URL being printed signals the server is ready — transition to running.
          if (_state === 'starting') {
            _state = 'running';
          }
          continue;
        }
        // Pattern 2: port-only.
        const portMatch = RE_PORT_ONLY.exec(line);
        if (portMatch) {
          _url = `http://localhost:${portMatch[1]}`;
          if (_state === 'starting') {
            _state = 'running';
          }
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // _teardown — kill the current child cleanly; resolve when it exits.
  // Does NOT update _state (caller's responsibility).
  // -------------------------------------------------------------------------
  function _teardown() {
    return new Promise((resolve) => {
      if (_child === null) {
        resolve();
        return;
      }

      const child = _child;
      _child = null;

      // Already exited.
      if (child.exitCode !== null || child.killed) {
        resolve();
        return;
      }

      // Listen for exit once; resolve regardless of code.
      function onExit() {
        resolve();
      }
      child.once('exit', onExit);

      // SIGTERM first; if it doesn't respond in 3 s, fallback kill.
      let killed = false;
      try {
        child.kill('SIGTERM');
        killed = true;
      } catch {
        // Sending SIGTERM failed (process may have already exited).
      }

      if (killed) {
        // Fallback: force-kill after 3 s.
        const fallback = setTimeout(() => {
          try { child.kill(); } catch { /* ignore */ }
        }, 3000);
        // Clear the fallback timer once the process exits normally.
        child.once('exit', () => clearTimeout(fallback));
      } else {
        // SIGTERM send failed — try kill() immediately as fallback.
        try { child.kill(); } catch { /* ignore */ }
      }
    });
  }

  // -------------------------------------------------------------------------
  // start(config) — spawn a new child.
  // If a child is already running, it is stopped first (single active preview).
  // -------------------------------------------------------------------------
  async function start(config) {
    // Stop any existing child first.
    if (_child !== null) {
      await _teardown();
    }

    // Reset state for the new launch.
    _state = 'starting';
    _mode = config.mode ?? null;
    _configuredUrl = config.url ?? null;
    _url = _configuredUrl; // configured URL wins immediately
    _pid = null;
    _logs = [];

    // Build child environment: merge process.env with config.env (if supplied).
    const childEnv = config.env
      ? { ...process.env, ...config.env }
      : { ...process.env };

    // Parse the command string into executable + args.
    // Simple shell-like split: split on whitespace, no quoting support needed
    // for the fixture commands used by tests (node <path>).
    const parts = config.command.trim().split(/\s+/);
    const executable = parts[0];
    const args = parts.slice(1);

    let child;
    try {
      child = spawn(executable, args, {
        cwd: config.cwd || repoRoot,
        env: childEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
        // NOT detached — explicit requirement; guarantees parent can kill child.
      });
    } catch (spawnErr) {
      _state = 'error';
      _pid = null;
      _child = null;
      throw spawnErr;
    }

    _child = child;
    _pid = child.pid ?? null;

    // Wire stdout into the ring buffer + URL detection.
    child.stdout.on('data', (chunk) => {
      handleChunk(chunk);
    });

    // Wire stderr into the SAME ring buffer (AC3: stdout/stderr captured together).
    child.stderr.on('data', (chunk) => {
      handleChunk(chunk);
    });

    // Spawn error (e.g. command not found on some platforms fires 'error').
    child.on('error', (err) => {
      if (_child === child) {
        _state = 'error';
        _pid = null;
        // Log the error message into the ring buffer.
        pushLog(`[spawn error] ${err.message}`);
      }
    });

    // Child exit handler.
    child.on('exit', (code, signal) => {
      if (_child === child) {
        // Only update state if this child is still the active one.
        if (_state !== 'stopped') {
          _state = 'exited';
        }
        _pid = null;
        _child = null;
        pushLog(`[exit] code=${code} signal=${signal}`);
      }
    });

    // If configuredUrl is set, wait briefly for the process to at least start,
    // then transition to 'running' after stdout/stderr wiring is complete.
    // We use a tiny async tick so callers get a consistent experience.
    if (_configuredUrl !== null) {
      // Configured URL: transition to running once the process is alive.
      // Poll briefly until pid is confirmed or error/exited.
      await new Promise((resolve) => {
        // Already transitioned above if the process errored synchronously.
        if (_state === 'error' || _state === 'exited') {
          resolve();
          return;
        }
        // Wait one tick then set running (process is spawned).
        setImmediate(() => {
          if (_child === child && _state === 'starting') {
            _state = 'running';
          }
          resolve();
        });
      });
    }
    // For null-URL configs, state transitions to 'running' happen inside
    // handleChunk() when a URL pattern is matched in stdout.
    // We do not block start() waiting for the URL — callers use pollUntil().
  }

  // -------------------------------------------------------------------------
  // stop() — idempotent; no throw when already stopped/never started.
  // -------------------------------------------------------------------------
  async function stop() {
    if (_child === null && _state === 'stopped') {
      return; // already stopped — no-op
    }

    await _teardown();

    _state = 'stopped';
    _mode = null;
    _url = null;
    _pid = null;
    _configuredUrl = null;
  }

  // -------------------------------------------------------------------------
  // restart(config) — stop then start.
  // -------------------------------------------------------------------------
  async function restart(config) {
    await stop();
    await start(config);
  }

  // -------------------------------------------------------------------------
  // getStatus() — synchronous snapshot.
  // -------------------------------------------------------------------------
  function getStatus() {
    return {
      state: _state,
      mode: _mode,
      url: _url,
      pid: _pid,
      // Return a shallow copy to prevent external mutation.
      recentLogs: _logs.slice(),
    };
  }

  return { start, stop, restart, getStatus };
}
