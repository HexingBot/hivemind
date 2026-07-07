// tests/e2e/knowledge-graph-canonical-ids.spec.js
// TASK-104 AC3 — neighbors() fails loudly (typed throw) instead of silently
// returning [] on an unknown node id; addNode's duplicate-id guard is
// case-insensitive; addEdge's existing referential-integrity throw is locked
// as a regression (unchanged behavior — already correct pre-ticket, see
// src/knowledge-graph.js addEdge).
//
// Real disk I/O via mkdtemp (mirrors tests/e2e/knowledge-graph.spec.js), so
// this lives in the slow/e2e tier per the fast/e2e directory split.
//
// TESTS-FIRST FAILURE SURFACE:
//   src/knowledge-graph.js does not export UnknownNodeIdError yet -> the
//   import itself resolves (module exists) but UnknownNodeIdError is
//   undefined, and neighbors() on an unknown id still resolves to [] instead
//   of rejecting -> the .rejects.toThrow() assertions fail for the right
//   reason. addNode's case-variant duplicate is NOT yet rejected (still
//   case-sensitive) -> that assertion fails for the right reason too.

import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  addNode, addEdge, neighbors, UnknownNodeIdError,
} from '../../src/knowledge-graph.js';

function makeGraphRepo() {
  const repoRoot = mkdtempSync(join(tmpdir(), 'kg-canon-'));
  mkdirSync(join(repoRoot, 'knowledge', 'graph'), { recursive: true });
  return repoRoot;
}

describe('TASK-104 AC3 — neighbors() throws a typed error on an unknown node id', () => {
  it('neighbors_throws_UnknownNodeIdError_for_a_nonexistent_id', async () => {
    const repoRoot = makeGraphRepo();
    try {
      await addNode({ repoRoot, node: { id: 'task-001', type: 'task', ref: 'tasks/TASK-001.json', label: 'x' } });
      await expect(
        neighbors({ repoRoot, id: 'task-999-does-not-exist' }),
      ).rejects.toThrow(UnknownNodeIdError);
      await expect(
        neighbors({ repoRoot, id: 'task-999-does-not-exist' }),
      ).rejects.toMatchObject({ code: 'E_GRAPH_UNKNOWN_ID' });
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('neighbors_still_returns_connected_nodes_for_a_known_id_no_regression', async () => {
    const repoRoot = makeGraphRepo();
    try {
      await addNode({ repoRoot, node: { id: 'task-001', type: 'task', ref: 'tasks/TASK-001.json', label: 'x' } });
      await addNode({
        repoRoot,
        node: { id: 'ke-example', type: 'knowledge_entry', ref: 'knowledge/entries/e.md', label: 'y' },
      });
      await addEdge({ repoRoot, edge: { from: 'task-001', to: 'ke-example', relation: 'uses' } });
      const result = await neighbors({ repoRoot, id: 'task-001' });
      expect(result.map((n) => n.id)).toContain('ke-example');
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

describe('TASK-104 AC3 — addNode duplicate-id guard is case-insensitive', () => {
  it('addNode_rejects_a_case_variant_of_an_existing_id', async () => {
    const repoRoot = makeGraphRepo();
    try {
      await addNode({
        repoRoot,
        node: { id: 'task-063', type: 'task', ref: 'tasks/TASK-063.json', label: 'Original' },
      });
      await expect(
        addNode({
          repoRoot,
          node: { id: 'TASK-063', type: 'task', ref: 'tasks/TASK-063.json', label: 'Impostor' },
        }),
      ).rejects.toThrow(/task-063/i);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('addNode_still_rejects_an_exact_duplicate_id_no_regression', async () => {
    const repoRoot = makeGraphRepo();
    try {
      await addNode({
        repoRoot,
        node: { id: 'task-063', type: 'task', ref: 'tasks/TASK-063.json', label: 'Original' },
      });
      await expect(
        addNode({
          repoRoot,
          node: { id: 'task-063', type: 'task', ref: 'tasks/TASK-063.json', label: 'Impostor' },
        }),
      ).rejects.toThrow(/task-063/i);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

describe('TASK-104 AC3 — addEdge endpoint resolution already fails loudly (regression lock, pre-existing behavior)', () => {
  it('addEdge_rejects_when_from_endpoint_is_unknown', async () => {
    const repoRoot = makeGraphRepo();
    try {
      await addNode({ repoRoot, node: { id: 'task-001', type: 'task', ref: 'tasks/TASK-001.json', label: 'x' } });
      await expect(
        addEdge({ repoRoot, edge: { from: 'task-nonexistent', to: 'task-001', relation: 'uses' } }),
      ).rejects.toThrow();
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  // TASK-105 rider R-a — the sibling unknown-`to` endpoint is guarded by the
  // same code path (src/knowledge-graph.js addEdge) but had no direct lock.
  it('addEdge_rejects_when_to_endpoint_is_unknown', async () => {
    const repoRoot = makeGraphRepo();
    try {
      await addNode({ repoRoot, node: { id: 'task-001', type: 'task', ref: 'tasks/TASK-001.json', label: 'x' } });
      await expect(
        addEdge({ repoRoot, edge: { from: 'task-001', to: 'task-nonexistent', relation: 'uses' } }),
      ).rejects.toThrow();
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
