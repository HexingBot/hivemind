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
import { resolveRepoRoot } from '../src/repo-root.js';
import { createBoardServer } from '../src/task-board.js';

// ---------------------------------------------------------------------------
// Argument parsing — strict: unknown tokens throw so typos surface immediately.
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = { port: 0 };
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
    } else {
      throw new Error(`unknown argument: ${tok}`);
    }
  }
  return out;
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
    // eslint-disable-next-line no-console
    console.log(`Task board: http://127.0.0.1:${port}`);
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
