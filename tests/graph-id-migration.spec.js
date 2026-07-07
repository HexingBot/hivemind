// tests/graph-id-migration.spec.js
// TASK-104 — pure-logic specs for src/graph-id-migration.js: the canonical id
// convention (AC1 groundwork), the mechanical migration (AC2), and the
// validator the AC4 fast-tier sensor is built on.
//
// TESTS-FIRST FAILURE SURFACE: src/graph-id-migration.js does not exist yet —
// every import below fails as "module not found", the correct tests-first
// failure for every case in this file.

import { describe, it, expect } from 'vitest';

import {
  canonicalIdPattern,
  isCanonicalId,
  deriveCanonicalId,
  migrateGraphIds,
  validateCanonicalGraph,
} from '../src/graph-id-migration.js';

describe('TASK-104 AC1/AC4 — canonicalIdPattern + isCanonicalId', () => {
  it('exposes a canonical id pattern for every locked node type', () => {
    for (const type of ['task', 'decision', 'skill', 'knowledge_entry']) {
      expect(canonicalIdPattern(type), `pattern must exist for type ${type}`).toBeInstanceOf(RegExp);
    }
  });

  it('returns undefined for an unknown node type', () => {
    expect(canonicalIdPattern('not-a-real-type')).toBeUndefined();
  });

  it.each([
    ['task', 'task-104', true],
    ['task', 'TASK-104', false],
    ['task', 'task-04a', false],
    ['decision', 'decision-20260704-release-v0-10-0-minor-bump', true],
    ['decision', '2026-07-04T22:37:28.261Z', false],
    ['decision', 'decision-2026070-missing-a-digit', false],
    ['skill', 'skill-graphify', true],
    ['skill', 'graphify', false],
    ['knowledge_entry', 'ke-windows-atomic-rename', true],
    ['knowledge_entry', 'windows-atomic-rename', false],
  ])('isCanonicalId type=%s id=%s -> %s', (type, id, expected) => {
    expect(isCanonicalId({ id, type })).toBe(expected);
  });
});

describe('TASK-104 AC2 — deriveCanonicalId: mechanical rename rules', () => {
  it('renames an uppercase TASK-<n> key to lowercase task-<n>', () => {
    expect(deriveCanonicalId({ id: 'TASK-063', type: 'task', label: 'x' })).toBe('task-063');
  });

  it('leaves an already-canonical task id untouched', () => {
    expect(deriveCanonicalId({ id: 'task-059', type: 'task', label: 'x' })).toBe('task-059');
  });

  it('derives a decision slug from the raw ISO id + first 6 words of the label', () => {
    const id = deriveCanonicalId({
      id: '2026-07-04T23:07:33.778Z',
      type: 'decision',
      label:
        'Release v0.10.0: minor bump cutting the post-0.9.0 drive (074-094); two-site pin, clean APPROVE, human-approved tag+push',
    });
    expect(id).toBe('decision-20260704-release-v0-10-0-minor-bump');
  });

  it('strips a label-leading YYYY-MM-DD restatement of the same date before slugging', () => {
    const id = deriveCanonicalId({
      id: '2026-07-01T21:20:37.785Z',
      type: 'decision',
      label: '2026-07-01 direction: remove web console, unsupervised loop, agility program, win32 baseline fix',
    });
    expect(id).toBe('decision-20260701-direction-remove-web-console-unsupervised-loop');
  });

  it('leaves an already-canonical decision id untouched', () => {
    expect(
      deriveCanonicalId({ id: 'decision-20260612-graphify-inhouse', type: 'decision', label: 'x' }),
    ).toBe('decision-20260612-graphify-inhouse');
  });

  it('leaves an unhandled shape untouched (sensor will flag it, migration does not guess)', () => {
    expect(deriveCanonicalId({ id: 'weird-id-123', type: 'task', label: 'x' })).toBe('weird-id-123');
  });

  it('is a pure function — same input always produces the same output', () => {
    const node = { id: 'TASK-070', type: 'task', label: 'x' };
    expect(deriveCanonicalId(node)).toBe(deriveCanonicalId({ ...node }));
  });
});

describe('TASK-104 AC2 — migrateGraphIds: mechanical whole-graph rename', () => {
  const nodes = [
    { id: 'TASK-063', type: 'task', ref: 'tasks/TASK-063.json', label: 'Op-mode' },
    { id: 'task-032', type: 'task', ref: 'tasks/TASK-032.json', label: 'Demotion' },
    {
      id: '2026-06-16T23:08:38.712Z',
      type: 'decision',
      ref: 'state/sessions/x/session.json',
      label: 'BETA-TEST GOAL goal-mode-switch minted',
    },
  ];
  const edges = [
    { from: 'TASK-063', to: '2026-06-16T23:08:38.712Z', relation: 'produced-by' },
  ];

  it('renames every node id to its canonical form and rewrites edge endpoints', () => {
    const { nodes: migratedNodes, edges: migratedEdges } = migrateGraphIds({ nodes, edges });
    const ids = migratedNodes.map((n) => n.id);
    expect(ids).toContain('task-063');
    expect(ids).toContain('task-032'); // already canonical, unchanged
    expect(ids).toContain('decision-20260616-beta-test-goal-goal-mode-switch');
    expect(migratedEdges[0]).toEqual({
      from: 'task-063',
      to: 'decision-20260616-beta-test-goal-goal-mode-switch',
      relation: 'produced-by',
    });
  });

  it('preserves node and edge counts (a pure rename, not an add/remove)', () => {
    const { before, after } = migrateGraphIds({ nodes, edges });
    expect(before).toEqual({ nodeCount: 3, edgeCount: 1 });
    expect(after).toEqual({ nodeCount: 3, edgeCount: 1 });
  });

  it('reports every rename in the returned renameMap', () => {
    const { renameMap } = migrateGraphIds({ nodes, edges });
    expect(renameMap.get('TASK-063')).toBe('task-063');
    expect(renameMap.get('2026-06-16T23:08:38.712Z')).toBe('decision-20260616-beta-test-goal-goal-mode-switch');
    expect(renameMap.has('task-032'), 'already-canonical ids must not appear in the rename map').toBe(false);
  });

  it('never mutates ref, label, or type fields', () => {
    const { nodes: migratedNodes } = migrateGraphIds({ nodes, edges });
    const original = nodes.find((n) => n.id === 'TASK-063');
    const migrated = migratedNodes.find((n) => n.ref === original.ref);
    expect(migrated.ref).toBe(original.ref);
    expect(migrated.label).toBe(original.label);
    expect(migrated.type).toBe(original.type);
  });

  it('produces no case-variant duplicate ids after migration', () => {
    const { nodes: migratedNodes } = migrateGraphIds({ nodes, edges });
    const lower = migratedNodes.map((n) => n.id.toLowerCase());
    expect(new Set(lower).size).toBe(lower.length);
  });

  it('drops a genuine rename collision (kept: first node encountered) without dangling any edge', () => {
    const collidingNodes = [
      { id: 'TASK-001', type: 'task', ref: 'tasks/TASK-001.json', label: 'first' },
      { id: 'task-001', type: 'task', ref: 'tasks/TASK-001-dup.json', label: 'second (collides)' },
    ];
    const collidingEdges = [
      { from: 'TASK-001', to: 'task-001', relation: 'relates-to' },
    ];
    const { nodes: migratedNodes, edges: migratedEdges } = migrateGraphIds({
      nodes: collidingNodes,
      edges: collidingEdges,
    });
    expect(migratedNodes.length, 'the colliding duplicate must be dropped, not duplicated').toBe(1);
    expect(migratedNodes[0].id).toBe('task-001');
    // The edge references both original ids; both resolve to the single kept node —
    // no dangling endpoint.
    expect(migratedEdges[0]).toEqual({ from: 'task-001', to: 'task-001', relation: 'relates-to' });
  });
});

describe('TASK-104 AC4 — validateCanonicalGraph: flags non-canonical ids and dangling edges', () => {
  it('flags a node id that does not match its type pattern', () => {
    const violations = validateCanonicalGraph({
      nodes: [{ id: 'TASK-063', type: 'task', ref: 'x', label: 'x' }],
      edges: [],
    });
    expect(violations.some((v) => v.includes('TASK-063'))).toBe(true);
  });

  it('flags an edge endpoint that does not resolve to an existing node', () => {
    const violations = validateCanonicalGraph({
      nodes: [{ id: 'task-001', type: 'task', ref: 'x', label: 'x' }],
      edges: [{ from: 'task-001', to: 'task-999', relation: 'uses' }],
    });
    expect(violations.some((v) => v.includes('task-999'))).toBe(true);
  });

  it('returns no violations for a fully canonical, referentially-sound graph', () => {
    const violations = validateCanonicalGraph({
      nodes: [
        { id: 'task-001', type: 'task', ref: 'x', label: 'x' },
        { id: 'decision-20260101-example', type: 'decision', ref: 'x', label: 'x' },
      ],
      edges: [{ from: 'task-001', to: 'decision-20260101-example', relation: 'produced-by' }],
    });
    expect(violations).toEqual([]);
  });

  it('the output of migrateGraphIds on the mixed-convention fixture nodes validates cleanly', () => {
    const nodes = [
      { id: 'TASK-063', type: 'task', ref: 'tasks/TASK-063.json', label: 'Op-mode' },
      {
        id: '2026-06-16T23:08:38.712Z',
        type: 'decision',
        ref: 'state/sessions/x/session.json',
        label: 'BETA-TEST GOAL goal-mode-switch minted',
      },
    ];
    const edges = [{ from: 'TASK-063', to: '2026-06-16T23:08:38.712Z', relation: 'produced-by' }];
    const migrated = migrateGraphIds({ nodes, edges });
    expect(validateCanonicalGraph(migrated)).toEqual([]);
  });
});
