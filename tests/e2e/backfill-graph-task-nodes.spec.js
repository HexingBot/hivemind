// tests/e2e/backfill-graph-task-nodes.spec.js
// TASK-175 item 10 — scripts/backfill-graph-task-nodes.mjs had no test at
// all, including its own header-comment idempotency claim ("re-running it
// against an already-backfilled graph adds nothing further"). This is a
// minimal regression lock, not a full behavioral rewrite of the script:
// exercises `main({ repoRoot })` (TASK-175's injectable-repoRoot refactor)
// against a disposable tmp-dir fixture — never the framework's own tasks/ +
// graph.json.

import { describe, it, expect, vi, afterAll, afterEach, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { makeRepoSkeleton } from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';

afterAll(cleanupAll);

function loadGraphJson(repoRoot) {
  const path = join(repoRoot, 'knowledge', 'graph', 'graph.json');
  // addNode only creates the file when there is at least one node to write —
  // a run with nothing missing (e.g. no done tickets at all) never touches
  // disk, same as knowledge-graph.js#loadGraph's own documented ENOENT ->
  // empty-graph default.
  if (!existsSync(path)) return { schema_version: 1, nodes: [], edges: [] };
  return JSON.parse(readFileSync(path, 'utf8'));
}

describe('backfill-graph-task-nodes main() — adds missing nodes and is idempotent', () => {
  let logSpy;
  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it('adds a task-<digits> node for a done ticket missing one, then a second run adds nothing further', async () => {
    const { main } = await import('../../scripts/backfill-graph-task-nodes.mjs');

    const repoRoot = makeTmpDir('af-backfill-graph');
    makeRepoSkeleton(repoRoot, {
      tasks: {
        'TASK-201': {
          key: 'TASK-201', title: 'Backfill fixture ticket', status: 'done',
        },
      },
    });

    await main({ repoRoot });

    const afterFirst = loadGraphJson(repoRoot);
    const nodes = afterFirst.nodes.filter((n) => n.id === 'task-201');
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      id: 'task-201', type: 'task', ref: 'tasks/TASK-201.json', label: 'Backfill fixture ticket',
    });

    // Idempotency claim (header comment): re-running against an
    // already-backfilled graph adds nothing further — no duplicate node,
    // and the "already fresh" notice fires.
    await main({ repoRoot });

    const afterSecond = loadGraphJson(repoRoot);
    expect(afterSecond.nodes.filter((n) => n.id === 'task-201')).toHaveLength(1);
    const allLogs = logSpy.mock.calls.map((args) => args.join(' ')).join('\n');
    expect(allLogs).toMatch(/no missing nodes — graph already fresh/);
  });

  it('does not touch a todo ticket (no node created)', async () => {
    const { main } = await import('../../scripts/backfill-graph-task-nodes.mjs');

    const repoRoot = makeTmpDir('af-backfill-graph-todo');
    makeRepoSkeleton(repoRoot, {
      tasks: {
        'TASK-202': { key: 'TASK-202', title: 'Not done yet', status: 'todo' },
      },
    });

    await main({ repoRoot });

    const graph = loadGraphJson(repoRoot);
    expect(graph.nodes.filter((n) => n.id === 'task-202')).toHaveLength(0);
  });

  it('fails loudly on a malformed done-ticket key instead of writing a garbage node (TASK-175 item 13)', async () => {
    const { main } = await import('../../scripts/backfill-graph-task-nodes.mjs');

    const repoRoot = makeTmpDir('af-backfill-graph-malformed');
    makeRepoSkeleton(repoRoot, {
      tasks: {
        'TASK-203': { key: 'NOT-A-VALID-KEY', title: 'Malformed key fixture', status: 'done' },
      },
    });

    await expect(main({ repoRoot })).rejects.toThrow(/malformed key/);
  });
});
