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
//
// TASK-184 addendum — the live-repo assertion's failure message now calls
// buildMissingMessage (below) to distinguish a derivable-but-missing key
// (backfill adds it) from a malformed key (backfill throws on it), so the
// advice given always matches what scripts/backfill-graph-task-nodes.mjs
// actually does. See the "TASK-184 AC4" describe block for the seeded-fixture
// regression lock on that message split.

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

describe('TASK-175 item 13 — a malformed done-ticket key fails closed, not silently skipped', () => {
  it('flags a done ticket whose key does not match TASK-<digits>, alongside a real drift', () => {
    const tasks = [
      { key: 'NOT-A-KEY', status: 'done' },
      { key: 'TASK-001', status: 'done' },
    ];
    const graph = {
      nodes: [
        { id: 'task-001', type: 'task', ref: 'tasks/TASK-001.json', label: 'x' },
      ],
    };
    // Before this fix, taskKeyToNodeId('NOT-A-KEY') === null made the old
    // guard (`nodeId !== null && ...`) skip the ticket entirely — it never
    // reached `missing`, even though the sensor could not prove a graph node
    // existed for it. Fail closed instead: name it.
    expect(findDoneTicketsMissingGraphNodes({ tasks, graph })).toEqual(['NOT-A-KEY']);
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
// TASK-184 AC4 — the sensor message distinguishes the two cases
// findDoneTicketsMissingGraphNodes now folds into `missing`
// (src/graph-freshness.js:61, TASK-175 item 13): (a) a derivable
// task-<digits> id with no matching graph node — the backfill script adds
// it; and (b) a key that does not even match TASK-<digits> — no node id can
// be derived, and scripts/backfill-graph-task-nodes.mjs:60-70 deliberately
// THROWS on that exact case. buildMissingMessage is shared by the live-repo
// assertion below and the seeded-fixture unit tests, so both prove the same
// per-case advice.
// ---------------------------------------------------------------------------

function buildMissingMessage(missing) {
  const malformed = missing.filter((key) => taskKeyToNodeId(key) === null);
  const missingNode = missing.filter((key) => taskKeyToNodeId(key) !== null);

  const messages = [];
  if (missingNode.length > 0) {
    messages.push(
      `${missingNode.length} done ticket(s) have a derivable task-<digits> id but no ` +
        `matching node in knowledge/graph/graph.json: ${missingNode.join(', ')}\n` +
        'Run scripts/backfill-graph-task-nodes.mjs to add the missing node(s) (or add the ' +
        'node via src/knowledge-graph.js addNode) before landing a done transition.',
    );
  }
  if (malformed.length > 0) {
    messages.push(
      `${malformed.length} done ticket(s) have a malformed key that does not match ` +
        `TASK-<digits>, so no node id can be derived: ${malformed.join(', ')}\n` +
        'scripts/backfill-graph-task-nodes.mjs deliberately THROWS on this exact case — fix ' +
        'the ticket key first, then re-run the backfill (or add the node manually via ' +
        'src/knowledge-graph.js addNode) before landing a done transition.',
    );
  }
  return messages.join('\n\n');
}

describe('TASK-184 AC4 — buildMissingMessage gives per-case advice that matches the backfill script', () => {
  it('a derivable-but-missing key gets the "run the backfill" advice, not the malformed-key one', () => {
    const message = buildMissingMessage(['TASK-999']);
    expect(message).toMatch(/derivable task-<digits> id but no/);
    expect(message).toMatch(/Run scripts\/backfill-graph-task-nodes\.mjs to add the missing node/);
    expect(message).not.toMatch(/deliberately THROWS/);
  });

  it('a malformed key gets the "fix the key first, backfill throws" advice, not the run-it-normally one', () => {
    const message = buildMissingMessage(['NOT-A-KEY']);
    expect(message).toMatch(/malformed key that does not match/);
    expect(message).toMatch(/deliberately THROWS on this exact case — fix the ticket key first/);
    expect(message).not.toMatch(/Run scripts\/backfill-graph-task-nodes\.mjs to add the missing node/);
  });

  it('a mix of both surfaces BOTH pieces of advice, one per case', () => {
    const message = buildMissingMessage(['TASK-999', 'NOT-A-KEY']);
    expect(message).toMatch(/Run scripts\/backfill-graph-task-nodes\.mjs to add the missing node/);
    expect(message).toMatch(/deliberately THROWS on this exact case/);
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

    expect(missing, buildMissingMessage(missing)).toEqual([]);
  });
});
