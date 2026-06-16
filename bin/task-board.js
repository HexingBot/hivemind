#!/usr/bin/env node
// bin/task-board.js
// TASK-034 — Thin shell: parse argv, start the board server on a free port,
// print the URL, and handle SIGINT cleanly. Zero runtime deps beyond the
// Node built-ins and src/task-board.js (which itself uses only Node built-ins
// plus src/task-store.js for mutations).
//
// Usage:
//   node bin/task-board.js
//   node bin/task-board.js --port 3000
//
// The server binds 127.0.0.1 only (local-only). Passing --port 0 (the default)
// lets the OS choose a free ephemeral port.

import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { resolveRepoRoot } from '../src/repo-root.js';
import { createBoardServer } from '../src/task-board.js';

// ---------------------------------------------------------------------------
// Argument parsing — strict: unknown tokens throw so typos surface immediately.
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = { port: 0, open: false };
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === '--port') {
      const raw = argv[++i];
      if (raw === undefined) throw new Error('--port requires a value');
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0 || n > 65535) {
        throw new Error(`--port value must be an integer 0-65535, got: ${raw}`);
      }
      out.port = n;
    } else if (tok === '--open') {
      out.open = true;
    } else {
      throw new Error(`unknown argument: ${tok}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// openBrowser — best-effort: never throws, never crashes the server.
// Picks the right OS opener: `start ""` on Windows, `open` on macOS, `xdg-open`
// on Linux. The spawned child is detached so it does not block the server.
// ---------------------------------------------------------------------------
export function openBrowser(url, spawnFn = spawn) {
  try {
    let cmd, args;
    if (process.platform === 'win32') {
      // On Windows, `start ""` is a cmd.exe built-in; we must use cmd.exe /c.
      cmd = 'cmd.exe';
      args = ['/c', 'start', '', url];
    } else if (process.platform === 'darwin') {
      cmd = 'open';
      args = [url];
    } else {
      cmd = 'xdg-open';
      args = [url];
    }
    const child = spawnFn(cmd, args, { detached: true, stdio: 'ignore' });
    child.unref();
  } catch (_err) {
    // Best-effort: swallow all errors — the server keeps running.
  }
}

// Only run when invoked directly (not on import from tests).
const __isEntryScript = import.meta.url
  ? Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href
  : (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module);

if (__isEntryScript) {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err.message);
    process.exit(1);
  }

  const repoRoot = resolveRepoRoot(process.env, process.cwd());
  const server = createBoardServer({ repoRoot });

  server.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error('Server error:', err.message);
    process.exit(1);
  });

  server.listen(opts.port, '127.0.0.1', () => {
    const { port } = server.address();
    const url = `http://127.0.0.1:${port}`;
    // eslint-disable-next-line no-console
    console.log(`Task board: ${url}`);
    if (opts.open) {
      openBrowser(url);
    }
  });

  process.on('SIGINT', () => {
    // Drop any keep-alive sockets first so close() can't hang waiting on an
    // idle browser connection (closeAllConnections: Node >= 18.2).
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }
    server.close(() => {
      process.exit(0);
    });
  });
}
