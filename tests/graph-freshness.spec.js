// tests/graph-freshness.spec.js
// TASK-169 — graph-freshness sensor: fails test:all when a done ticket in
// tasks/ has no corresponding task-<digits> node in
// knowledge/graph/graph.json, converting silent drift into a caught defect.
//
// TIER: fast (tests/*.spec.js, no real disk I/O beyond reading committed
// files) — same precedent as tests/use-case-policy.spec.js reading
// USE-CASES.md: this sensor reads the repo's own tasks/ + graph.json, but
// that's a synchronous read of already-on-disk committed files, not mkdtemp
// / process-spawn I/O, so it belongs in the fast tier per vitest.config.js's
// tier boundary (folder = tier).
//
// AC coverage:
//   AC1 — findDoneTicketsMissingGraphNodes fails (returns non-empty) on a
//         seeded drift fixture, naming the missing ticket key(s).
//   AC2 — non-done statuses (todo/in_progress/blocked/in_review) are never
//         flagged even when their node is absent.
//   AC3 — red-green planted: the live-repo assertion below IS the red-green
//         proof — see the RED-GREEN EVIDENCE block.
//   AC4 — this spec runs within `npm test`/`npm run test:all` (fast tier,
//         included by both vitest.config.js and vitest.config.all.js); the
//         CLAUDE.md doc addition documents it.
//   AC5 — backfill is verified by the live-repo assertion passing (see
//         scripts/backfill-graph-task-nodes.mjs).
//
// RED-GREEN EVIDENCE (do not remove — documents non-vacuity proof):
//   RED:  ran this spec BEFORE the TASK-169 backfill landed — the live-repo
//         assertion failed, naming all 74 done tickets that lacked a
//         task-<digits> node (TASK-001, TASK-002, TASK-004, ... TASK-172).
//         Captured verbatim in the TASK-169 hand-off.
//   GREEN: ran scripts/backfill-graph-task-nodes.mjs (adds the 74 missing
//         nodes via the real addNode API) → re-ran this spec → PASSED.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './helpers/repoRoot.js';
import { TASK_FILENAME_RE } from '../src/task-store.js';
import {
  findDoneTicketsMissingGraphNodes,
  taskKeyToNodeId,
} from '../src/graph-freshness.js';

// ---------------------------------------------------------------------------
// AC1/AC2 — pure-function unit tests on seeded fixtures
// ---------------------------------------------------------------------------

describe('taskKeyToNodeId', () => {
  it('derives task-<digits> from a TASK-<digits> key, digits verbatim', () => {
    expect(taskKeyToNodeId('TASK-001')).toBe('task-001');
    expect(taskKeyToNodeId('TASK-104')).toBe('task-104');
    expect(taskKeyToNodeId('TASK-169')).toBe('task-169');
  });

  it('returns null for a key that does not match TASK-<digits>', () => {
    expect(taskKeyToNodeId('NOT-A-KEY')).toBeNull();
    expect(taskKeyToNodeId('')).toBeNull();
  });
});

describe('AC1 — findDoneTicketsMissingGraphNodes: seeded drift fixture fails, naming keys', () => {
  it('flags a done ticket whose task-<digits> node is absent from the graph', () => {
    const tasks = [
      { key: 'TASK-001', status: 'done' },
      { key: 'TASK-002', status: 'done' },
    ];
    const graph = {
      nodes: [
        { id: 'task-001', type: 'task', ref: 'tasks/TASK-001.json', label: 'x' },
        // task-002 node deliberately absent — the seeded drift.
      ],
    };
    const missing = findDoneTicketsMissingGraphNodes({ tasks, graph });
    expect(missing).toEqual(['TASK-002']);
  });

  it('names all missing keys when multiple done tickets lack nodes', () => {
    const tasks = [
      { key: 'TASK-010', status: 'done' },
      { key: 'TASK-011', status: 'done' },
      { key: 'TASK-012', status: 'done' },
    ];
    const graph = { nodes: [] };
    const missing = findDoneTicketsMissingGraphNodes({ tasks, graph });
    expect(missing).toEqual(['TASK-010', 'TASK-011', 'TASK-012']);
  });
});

describe('AC2 — findDoneTicketsMissingGraphNodes: only done status is required to have a node', () => {
  it('passes (empty) when the node is present for a done ticket', () => {
    const tasks = [{ key: 'TASK-001', status: 'done' }];
    const graph = {
      nodes: [{ id: 'task-001', type: 'task', ref: 'tasks/TASK-001.json', label: 'x' }],
    };
    expect(findDoneTicketsMissingGraphNodes({ tasks, graph })).toEqual([]);
  });

  it('does NOT flag todo/in_progress/blocked/in_review tickets missing a node', () => {
    const tasks = [
      { key: 'TASK-100', status: 'todo' },
      { key: 'TASK-101', status: 'in_progress' },
      { key: 'TASK-102', status: 'blocked' },
      { key: 'TASK-103', status: 'in_review' },
    ];
    const graph = { nodes: [] };
    expect(findDoneTicketsMissingGraphNodes({ tasks, graph })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC1/AC3/AC5 — live-repo assertion: THIS is the permanent sensor.
// Reads the repo's own tasks/*.json + knowledge/graph/graph.json (committed
// files, sync read — same precedent as tests/use-case-policy.spec.js reading
// USE-CASES.md) and fails naming any done ticket lacking a graph node.
// ---------------------------------------------------------------------------

function loadAllTasks() {
  const tasksDir = join(REPO_ROOT, 'tasks');
  const files = readdirSync(tasksDir).filter((f) => TASK_FILENAME_RE.test(f));
  return files.map((f) => JSON.parse(readFileSync(join(tasksDir, f), 'utf8')));
}

function loadGraph() {
  const graphPath = join(REPO_ROOT, 'knowledge', 'graph', 'graph.json');
  return JSON.parse(readFileSync(graphPath, 'utf8'));
}

describe('graph-freshness sensor — every done ticket in tasks/ has a graph node', () => {
  it('no_done_ticket_is_missing_its_task_node_in_graph_json', () => {
    const tasks = loadAllTasks();
    const graph = loadGraph();
    const missing = findDoneTicketsMissingGraphNodes({ tasks, graph });

    expect(
      missing,
      `${missing.length} done ticket(s) have no task-<digits> node in ` +
        `knowledge/graph/graph.json: ${missing.join(', ')}\n` +
        'Run the backfill (or add the node via src/knowledge-graph.js addNode) ' +
        'before landing a done transition.',
    ).toEqual([]);
  });
});
