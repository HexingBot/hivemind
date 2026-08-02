#!/usr/bin/env node
// scripts/backfill-graph-task-nodes.mjs
// TASK-169 — ONE-TIME backfill: adds a task-<digits> graph node for every
// currently-done ticket in tasks/ that lacks one. Landing the new
// graph-freshness sensor (tests/graph-freshness.spec.js) green on main
// requires this backfill — see src/graph-freshness.js for the drift-detection
// logic and the ticket's explicit mandate to do a one-time structural backfill
// of missing index nodes (not a bulk re-derivation of graph content, which
// remains banned by the graphify skill).
//
// Writes go through the real src/knowledge-graph.js addNode API (schema
// validated, deterministic serialization, atomic write) — never a hand-edit
// of graph.json.
//
// This script is idempotent — re-running it against an already-backfilled
// graph adds nothing further (findDoneTicketsMissingGraphNodes returns []).
//
// Usage: node scripts/backfill-graph-task-nodes.mjs

import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';

import { loadGraph, addNode } from '../src/knowledge-graph.js';
import { TASK_FILENAME_RE } from '../src/task-store.js';
import { findDoneTicketsMissingGraphNodes, taskKeyToNodeId } from '../src/graph-freshness.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dir, '..');

function loadAllTasks(repoRoot) {
  const tasksDir = join(repoRoot, 'tasks');
  const files = readdirSync(tasksDir).filter((f) => TASK_FILENAME_RE.test(f));
  return files.map((f) => JSON.parse(readFileSync(join(tasksDir, f), 'utf8')));
}

// TASK-175 item 10 — repoRoot is now an injectable option (defaulting to
// this script's own repo, unchanged for the real one-time-backfill usage)
// so tests/e2e/backfill-graph-task-nodes.spec.js can exercise this against a
// disposable tmp-dir fixture (incl. the idempotency claim in the header
// comment above) instead of the framework's own tasks/ + graph.json.
export async function main({ repoRoot = REPO_ROOT } = {}) {
  const tasks = loadAllTasks(repoRoot);
  const graph = await loadGraph({ repoRoot });
  const missingKeys = findDoneTicketsMissingGraphNodes({ tasks, graph });

  if (missingKeys.length === 0) {
    // eslint-disable-next-line no-console
    console.log('backfill-graph-task-nodes: no missing nodes — graph already fresh.');
    return;
  }

  const byKey = new Map(tasks.map((t) => [t.key, t]));

  // eslint-disable-next-line no-console
  console.log(`backfilling ${missingKeys.length} missing task node(s):`);
  for (const key of missingKeys) {
    const task = byKey.get(key);
    const id = taskKeyToNodeId(key);
    if (id === null) {
      // TASK-175 item 13 — findDoneTicketsMissingGraphNodes now folds a
      // malformed done-ticket key into `missing` too (fail closed) instead
      // of silently skipping it. There is no node id to derive here, so
      // fail loudly with a clear message rather than calling addNode with a
      // null id (which would otherwise surface as an opaque AJV dump).
      throw new Error(
        `backfill-graph-task-nodes: done ticket "${key}" has a malformed key `
          + '(does not match TASK-<digits>) — fix the key before backfilling.',
      );
    }
    const node = {
      id,
      type: 'task',
      ref: `tasks/${key}.json`,
      label: task.title,
    };
    // eslint-disable-next-line no-await-in-loop
    await addNode({ repoRoot, node });
    // eslint-disable-next-line no-console
    console.log(`  + ${id} (${key}: ${task.title})`);
  }

  // eslint-disable-next-line no-console
  console.log(`backfill-graph-task-nodes: added ${missingKeys.length} node(s).`);
}

// Only auto-run when invoked directly (`node scripts/backfill-graph-task-nodes.mjs`);
// importing `main` for testing must not trigger a real run against this repo's
// own tasks/ + graph.json.
const __isEntryScript = Boolean(process.argv[1])
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (__isEntryScript) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
