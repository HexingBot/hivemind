import { describe, it, expect, vi } from 'vitest';
import { mapNodeToAssert, recordNode, neighborsCanonicalFirst } from '../src/graph-sync.js';
import { UnknownNodeIdError } from '../src/knowledge-graph.js';

describe('mapNodeToAssert', () => {
  it('maps a decision node with explicit defaults and artifact provenance', () => {
    const out = mapNodeToAssert(
      { id: 'DT01', type: 'decision', ref: 'knowledge/decisions/dt01.md', label: 'Use MCP for the brain' },
      { topic: 'proj' },
    );
    expect(out).toEqual({
      topic: 'proj',
      text: 'Use MCP for the brain',
      type: 'Decision',
      marker: 'EXPLICIT',
      source_tier: 'T2',
      source_ref: 'knowledge/decisions/dt01.md',
    });
  });

  it('treats a knowledge_entry as strong inference', () => {
    const out = mapNodeToAssert({ id: 'k1', type: 'knowledge_entry', ref: 'knowledge/entries/k1.md', label: 'lesson' }, { topic: 'p' });
    expect(out.type).toBe('Knowledge');
    expect(out.marker).toBe('INFERRED:strong');
  });

  it('falls back to weak/T3 for an unknown node type and uses ref||id for provenance', () => {
    const out = mapNodeToAssert({ type: 'misc', label: 'x', id: 'm1' }, { topic: 'p' });
    expect(out).toMatchObject({ type: 'misc', marker: 'INFERRED:weak', source_tier: 'T3', source_ref: 'm1' });
  });

  it('honors explicit marker/tier overrides', () => {
    const out = mapNodeToAssert({ type: 'task', label: 't', ref: 'tasks/T.json' }, { topic: 'p', marker: 'ASSUMED', sourceTier: 'T1' });
    expect(out.marker).toBe('ASSUMED');
    expect(out.source_tier).toBe('T1');
  });

  it('throws when the node lacks type/label', () => {
    expect(() => mapNodeToAssert({ id: 'x' }, { topic: 'p' })).toThrow(/type, label/);
  });
});

describe('recordNode', () => {
  it('writes the projection AND mirrors to the canonical graph', async () => {
    const addNode = vi.fn(async () => {});
    const brain = { assert: vi.fn(async () => ({ source: 'brain', claim_id: 'c1', entity_id: 'Task:abc' })) };
    const node = { id: 'TASK-1', type: 'task', ref: 'tasks/TASK-1.json', label: 'do the thing' };

    const out = await recordNode({ brain, repoRoot: '/repo', node, topic: 'proj', addNode });

    expect(addNode).toHaveBeenCalledWith({ repoRoot: '/repo', node });
    expect(brain.assert).toHaveBeenCalledWith(expect.objectContaining({ type: 'Task', text: 'do the thing', source_ref: 'tasks/TASK-1.json' }));
    expect(out).toEqual({ projection: 'ok', canonical: { source: 'brain', claim_id: 'c1', entity_id: 'Task:abc' } });
  });

  it('still records the projection when the brain is down (canonical queued, never lost)', async () => {
    const addNode = vi.fn(async () => {});
    const brain = { assert: vi.fn(async () => ({ source: 'queued', queued: true, pending: 1 })) };
    const node = { id: 'D1', type: 'decision', ref: 'd.md', label: 'pick X' };

    const out = await recordNode({ brain, repoRoot: '/r', node, topic: 'p', addNode });

    expect(out.projection).toBe('ok');
    expect(out.canonical).toMatchObject({ source: 'queued', queued: true });
  });

  it('skips the canonical write when no brain is provided', async () => {
    const addNode = vi.fn(async () => {});
    const out = await recordNode({ repoRoot: '/r', node: { type: 'skill', label: 's' }, topic: 'p', addNode });
    expect(out.canonical).toEqual({ source: 'skipped' });
    expect(addNode).toHaveBeenCalled();
  });

  // TASK-175 item 6 — the failed-canonical shape ({ source: 'failed', error })
  // was only ever exercised indirectly (tests/e2e/mcp-close-task.spec.js's
  // throwing-brain case checks close_task's graph_node string, not this
  // return value directly). Direct lock: the projection write still succeeds
  // and the canonical failure is folded into `out.canonical`, never thrown.
  it('folds a throwing brain.assert into { source: "failed", error } instead of throwing', async () => {
    const addNode = vi.fn(async () => {});
    const brain = { assert: vi.fn(async () => { throw new Error('brain unreachable'); }) };
    const node = { id: 'TASK-2', type: 'task', ref: 'tasks/TASK-2.json', label: 'do another thing' };

    const out = await recordNode({ brain, repoRoot: '/repo', node, topic: 'proj', addNode });

    expect(out.projection).toBe('ok');
    expect(out.canonical).toEqual({ source: 'failed', error: 'brain unreachable' });
  });
});

describe('neighborsCanonicalFirst', () => {
  it('prefers the canonical graph when a canonical id is known and the brain is up', async () => {
    const brain = { neighbors: vi.fn(async () => ({ source: 'brain', neighbors: ['b', 'c'] })) };
    const neighbors = vi.fn();
    const out = await neighborsCanonicalFirst({ brain, repoRoot: '/r', id: 'n1', canonicalId: 'Task:abc', neighbors });
    expect(out).toEqual({ source: 'brain', neighbors: ['b', 'c'] });
    expect(neighbors).not.toHaveBeenCalled();
  });

  it('falls back to the local projection when the brain is unavailable', async () => {
    const brain = { neighbors: vi.fn(async () => ({ source: 'unavailable', neighbors: null })) };
    const neighbors = vi.fn(async () => [{ id: 'x', type: 'task' }]);
    const out = await neighborsCanonicalFirst({ brain, repoRoot: '/r', id: 'n1', canonicalId: 'Task:abc', neighbors });
    expect(out.source).toBe('projection');
    expect(out.neighbors).toEqual([{ id: 'x', type: 'task' }]);
    expect(neighbors).toHaveBeenCalledWith({ repoRoot: '/r', id: 'n1' });
  });

  it('uses the projection directly when no canonical id is known', async () => {
    const brain = { neighbors: vi.fn() };
    const neighbors = vi.fn(async () => []);
    await neighborsCanonicalFirst({ brain, repoRoot: '/r', id: 'n1', neighbors });
    expect(brain.neighbors).not.toHaveBeenCalled();
    expect(neighbors).toHaveBeenCalled();
  });

  // TASK-104 — neighbors() now throws UnknownNodeIdError instead of silently
  // returning [] for an id absent from the LOCAL projection. This fallback
  // path is the one documented exception: a node can exist canonically but
  // not yet be mirrored locally, so the degradation to an empty array here
  // must stay intentional and explicit, not an accidental regression.
  it('treats a local UnknownNodeIdError as an expected degradation and returns empty neighbors', async () => {
    const brain = { neighbors: vi.fn(async () => ({ source: 'unavailable', neighbors: null })) };
    const neighbors = vi.fn(async () => { throw new UnknownNodeIdError('n1'); });
    const out = await neighborsCanonicalFirst({ brain, repoRoot: '/r', id: 'n1', canonicalId: 'Task:abc', neighbors });
    expect(out).toEqual({ source: 'projection', neighbors: [] });
  });

  it('rethrows a non-UnknownNodeIdError local failure (no swallowing real errors)', async () => {
    const brain = { neighbors: vi.fn(async () => ({ source: 'unavailable', neighbors: null })) };
    const neighbors = vi.fn(async () => { throw new Error('disk boom'); });
    await expect(
      neighborsCanonicalFirst({ brain, repoRoot: '/r', id: 'n1', canonicalId: 'Task:abc', neighbors }),
    ).rejects.toThrow('disk boom');
  });
});
