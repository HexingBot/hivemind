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

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';

import { loadGraph, addNode } from '../src/knowledge-graph.js';
import { TASK_FILENAME_RE } from '../src/task-store.js';
import { findDoneTicketsMissingGraphNodes, taskKeyToNodeId } from '../src/graph-freshness.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dir, '..');

function loadAllTasks() {
  const tasksDir = join(REPO_ROOT, 'tasks');
  const files = readdirSync(tasksDir).filter((f) => TASK_FILENAME_RE.test(f));
  return files.map((f) => JSON.parse(readFileSync(join(tasksDir, f), 'utf8')));
}

async function main() {
  const tasks = loadAllTasks();
  const graph = await loadGraph({ repoRoot: REPO_ROOT });
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
    const node = {
      id,
      type: 'task',
      ref: `tasks/${key}.json`,
      label: task.title,
    };
    // eslint-disable-next-line no-await-in-loop
    await addNode({ repoRoot: REPO_ROOT, node });
    // eslint-disable-next-line no-console
    console.log(`  + ${id} (${key}: ${task.title})`);
  }

  // eslint-disable-next-line no-console
  console.log(`backfill-graph-task-nodes: added ${missingKeys.length} node(s).`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
