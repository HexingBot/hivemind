// tests/e2e/knowledge-graph.spec.js
// TASK-035 — Knowledge graph store API: typed graph over knowledge entries, tasks,
// decisions and skills stored under knowledge/graph/graph.json.
//
// DESIGN UNDER TEST (per the TASK-035 tier-assignment comment):
//   src/knowledge-graph.js exports:
//     loadGraph({ repoRoot })          → {schema_version, nodes, edges}; absent file → empty graph
//     addNode({ repoRoot, node })      → validates schema + type before writing atomically
//     addEdge({ repoRoot, edge })      → validates schema + referential integrity before writing
//     removeNode({ repoRoot, id })     → cascades edges for that node
//     removeEdge({ repoRoot, edge })   → removes a specific edge
//     neighbors({ repoRoot, id, relation?, direction? }) → connected node ids
//     nodesByType({ repoRoot, type })  → filtered node array
//
//   GET /graph on createBoardServer:
//     → 200 HTML, grouped-by-type list view with edges per node, inline assets
//     → graph file absent → still 200 with an empty-state message (no crash)
//
// TESTS-FIRST FAILURE SURFACE:
//   All imports resolve to "module not found" for src/knowledge-graph.js until
//   implementation lands. GET /graph returns 404 until the route is added.
//   This is the correct tests-first failure for every case below.

import {
  describe, it, expect, beforeEach, afterEach,
} from 'vitest';
import {
  mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Dynamic imports so "module not found" surfaces as test-runtime errors (correct
// tests-first failure), rather than collection-time errors that abort the file.
// We re-import before each test suite that needs a fresh module cache entry
// (vitest caches ESM modules by URL, so we use a stable URL and accept caching).

let loadGraph;
let addNode;
let addEdge;
let removeNode;
let removeEdge;
let neighbors;
let nodesByType;

// ---------------------------------------------------------------------------
// One-time dynamic import — fails at test start if src/knowledge-graph.js
// is absent (correct tests-first surface).
// ---------------------------------------------------------------------------
async function importGraph() {
  if (loadGraph) return; // already loaded
  const mod = await import('../../src/knowledge-graph.js');
  loadGraph = mod.loadGraph;
  addNode = mod.addNode;
  addEdge = mod.addEdge;
  removeNode = mod.removeNode;
  removeEdge = mod.removeEdge;
  neighbors = mod.neighbors;
  nodesByType = mod.nodesByType;
}

// ---------------------------------------------------------------------------
// Helper: create an isolated tmp repo root with knowledge/graph/ layout.
// ---------------------------------------------------------------------------
function makeGraphRepo(opts = {}) {
  const repoRoot = mkdtempSync(join(tmpdir(), 'kg-spec-'));
  mkdirSync(join(repoRoot, 'knowledge', 'graph'), { recursive: true });
  if (opts.graphJson !== undefined) {
    writeFileSync(
      join(repoRoot, 'knowledge', 'graph', 'graph.json'),
      JSON.stringify(opts.graphJson, null, 2) + '\n',
      'utf8',
    );
  }
  return repoRoot;
}

// ---------------------------------------------------------------------------
// Fixture node builders.
// ---------------------------------------------------------------------------
function makeNode(overrides = {}) {
  return {
    id: 'ke-windows-atomic',
    type: 'knowledge_entry',
    ref: 'knowledge/entries/windows-atomic-rename-not-truly-atomic.md',
    label: 'Windows atomic rename',
    ...overrides,
  };
}

function makeNode2(overrides = {}) {
  return {
    id: 'task-001',
    type: 'task',
    ref: 'tasks/TASK-001.json',
    label: 'First task',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Server helpers (mirrors task-board.spec.js pattern).
// ---------------------------------------------------------------------------
async function startServer(repoRoot) {
  const { createBoardServer } = await import('../../src/task-board.js');
  return new Promise((resolve, reject) => {
    const server = createBoardServer({ repoRoot });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

// ===========================================================================
// AC1 — loadGraph on absent file → empty graph {schema_version:1,nodes:[],edges:[]}.
// ===========================================================================
describe('TASK-035 AC1 — loadGraph: absent file returns empty graph', () => {
  it('loadGraph_on_absent_file_returns_empty_graph', async () => {
    await importGraph();
    const repoRoot = makeGraphRepo(); // no graphJson written
    let graph;
    try {
      graph = await loadGraph({ repoRoot });
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
    expect(graph.schema_version, 'schema_version must be 1').toBe(1);
    expect(Array.isArray(graph.nodes), 'nodes must be an array').toBe(true);
    expect(graph.nodes.length, 'nodes must be empty for absent file').toBe(0);
    expect(Array.isArray(graph.edges), 'edges must be an array').toBe(true);
    expect(graph.edges.length, 'edges must be empty for absent file').toBe(0);
  });
});

// ===========================================================================
// AC2 — addNode persists; reload round-trips; nodes sorted by id on disk;
//        deterministic byte output (write twice → identical bytes).
// ===========================================================================
describe('TASK-035 AC2 — addNode: persist, round-trip, sorted, deterministic', () => {
  it('addNode_persists_and_round_trips_on_reload', async () => {
    await importGraph();
    const repoRoot = makeGraphRepo();
    const node = makeNode();
    try {
      await addNode({ repoRoot, node });
      const graph = await loadGraph({ repoRoot });
      expect(graph.nodes.length, 'graph must have exactly one node after addNode').toBe(1);
      expect(graph.nodes[0].id).toBe(node.id);
      expect(graph.nodes[0].type).toBe(node.type);
      expect(graph.nodes[0].ref).toBe(node.ref);
      expect(graph.nodes[0].label).toBe(node.label);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('addNode_sorts_nodes_by_id_on_disk', async () => {
    await importGraph();
    const repoRoot = makeGraphRepo();
    try {
      // Add in reverse alphabetical order.
      await addNode({ repoRoot, node: makeNode2() }); // 'task-001'
      await addNode({ repoRoot, node: makeNode() });   // 'ke-windows-atomic'
      const raw = readFileSync(join(repoRoot, 'knowledge', 'graph', 'graph.json'), 'utf8');
      const onDisk = JSON.parse(raw);
      const ids = onDisk.nodes.map((n) => n.id);
      expect(ids, 'nodes on disk must be sorted by id').toEqual([...ids].sort());
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('addNode_produces_deterministic_byte_output_on_double_write', async () => {
    await importGraph();
    const repoRoot = makeGraphRepo();
    const node = makeNode();
    try {
      await addNode({ repoRoot, node });
      const bytes1 = readFileSync(join(repoRoot, 'knowledge', 'graph', 'graph.json'), 'utf8');
      // Remove and re-add to force a second write starting from the same state.
      await removeNode({ repoRoot, id: node.id });
      await addNode({ repoRoot, node });
      const bytes2 = readFileSync(join(repoRoot, 'knowledge', 'graph', 'graph.json'), 'utf8');
      expect(bytes2, 'serialization must be deterministic — identical bytes on double-write').toBe(bytes1);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

// ===========================================================================
// AC3 — addNode rejects invalid type / missing ref BEFORE any write.
// ===========================================================================
describe('TASK-035 AC3 — addNode: rejects invalid input before write', () => {
  it.each([
    ['invalid_type', makeNode({ type: 'banana' }), 'invalid type'],
    ['missing_ref',  makeNode({ ref: undefined }),  'missing ref'],
    ['missing_id',   makeNode({ id: undefined }),   'missing id'],
  ])('addNode_rejects_%s_before_write', async (_name, badNode, _reason) => {
    await importGraph();
    const repoRoot = makeGraphRepo();
    const graphPath = join(repoRoot, 'knowledge', 'graph', 'graph.json');
    try {
      await expect(
        addNode({ repoRoot, node: badNode }),
        'addNode must reject an invalid node',
      ).rejects.toThrow();
      // File must not have been created.
      expect(
        existsSync(graphPath),
        'graph.json must not be created when addNode rejects',
      ).toBe(false);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

// ===========================================================================
// AC4 — addEdge rejects when from/to node ids don't exist (referential integrity);
//        valid edge persists sorted by (from, to, relation).
// ===========================================================================
describe('TASK-035 AC4 — addEdge: referential integrity + valid edge persists sorted', () => {
  it('addEdge_rejects_when_from_node_does_not_exist', async () => {
    await importGraph();
    const repoRoot = makeGraphRepo();
    try {
      // Only add the "to" node; "from" is absent.
      await addNode({ repoRoot, node: makeNode2() });
      await expect(
        addEdge({ repoRoot, edge: { from: 'nonexistent-id', to: 'task-001', relation: 'uses' } }),
        'addEdge must reject when "from" node id does not exist',
      ).rejects.toThrow();
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('addEdge_rejects_when_to_node_does_not_exist', async () => {
    await importGraph();
    const repoRoot = makeGraphRepo();
    try {
      await addNode({ repoRoot, node: makeNode() });
      await expect(
        addEdge({ repoRoot, edge: { from: 'ke-windows-atomic', to: 'nonexistent-id', relation: 'uses' } }),
        'addEdge must reject when "to" node id does not exist',
      ).rejects.toThrow();
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('addEdge_valid_edge_persists_and_edges_sorted_on_disk', async () => {
    await importGraph();
    const repoRoot = makeGraphRepo();
    try {
      await addNode({ repoRoot, node: makeNode() });
      await addNode({ repoRoot, node: makeNode2() });
      // Add two edges in reverse order so sort is observable.
      await addEdge({ repoRoot, edge: { from: 'task-001', to: 'ke-windows-atomic', relation: 'uses' } });
      await addEdge({ repoRoot, edge: { from: 'ke-windows-atomic', to: 'task-001', relation: 'learned-in' } });
      const raw = readFileSync(join(repoRoot, 'knowledge', 'graph', 'graph.json'), 'utf8');
      const onDisk = JSON.parse(raw);
      expect(onDisk.edges.length, 'both edges must persist').toBe(2);
      // Edges must be sorted: sort key is (from, to, relation).
      const sorted = [...onDisk.edges].sort((a, b) => {
        const ka = `${a.from}\x00${a.to}\x00${a.relation}`;
        const kb = `${b.from}\x00${b.to}\x00${b.relation}`;
        return ka < kb ? -1 : ka > kb ? 1 : 0;
      });
      expect(onDisk.edges, 'edges on disk must be sorted by (from, to, relation)').toEqual(sorted);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

// ===========================================================================
// AC5 — addEdge rejects invalid relation value.
// ===========================================================================
describe('TASK-035 AC5 — addEdge: rejects invalid relation', () => {
  it('addEdge_rejects_invalid_relation_value', async () => {
    await importGraph();
    const repoRoot = makeGraphRepo();
    try {
      await addNode({ repoRoot, node: makeNode() });
      await addNode({ repoRoot, node: makeNode2() });
      await expect(
        addEdge({ repoRoot, edge: { from: 'ke-windows-atomic', to: 'task-001', relation: 'invalid-relation-xyz' } }),
        'addEdge must reject a relation value not in the enum',
      ).rejects.toThrow();
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

// ===========================================================================
// AC6 — removeNode cascades its edges (no orphan edges on disk).
// ===========================================================================
describe('TASK-035 AC6 — removeNode cascades edges', () => {
  it('removeNode_cascades_its_edges_leaving_no_orphans', async () => {
    await importGraph();
    const repoRoot = makeGraphRepo();
    try {
      await addNode({ repoRoot, node: makeNode() });
      await addNode({ repoRoot, node: makeNode2() });
      await addEdge({ repoRoot, edge: { from: 'ke-windows-atomic', to: 'task-001', relation: 'relates-to' } });
      await addEdge({ repoRoot, edge: { from: 'task-001', to: 'ke-windows-atomic', relation: 'learned-in' } });
      // Remove one node — both edges must disappear.
      await removeNode({ repoRoot, id: 'task-001' });
      const graph = await loadGraph({ repoRoot });
      expect(graph.nodes.length, 'only one node must remain').toBe(1);
      expect(graph.nodes[0].id).toBe('ke-windows-atomic');
      expect(graph.edges.length, 'all edges referencing the removed node must be cascaded').toBe(0);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

// ===========================================================================
// AC7 — neighbors returns connected nodes; relation filter works; nodesByType filters.
// ===========================================================================
describe('TASK-035 AC7 — query functions: neighbors, relation filter, nodesByType', () => {
  let repoRoot;

  beforeEach(async () => {
    await importGraph();
    repoRoot = makeGraphRepo();
    // Build a small graph: ke-node -(learned-in)-> task-node, task-node -(uses)-> ke-node
    await addNode({ repoRoot, node: makeNode() });
    await addNode({ repoRoot, node: makeNode2() });
    await addEdge({ repoRoot, edge: { from: 'ke-windows-atomic', to: 'task-001', relation: 'learned-in' } });
    await addEdge({ repoRoot, edge: { from: 'task-001', to: 'ke-windows-atomic', relation: 'uses' } });
  });

  afterEach(() => {
    if (repoRoot) rmSync(repoRoot, { recursive: true, force: true });
  });

  it('neighbors_returns_all_connected_nodes_by_default', async () => {
    const result = await neighbors({ repoRoot, id: 'task-001' });
    const ids = result.map((n) => n.id);
    expect(ids, 'neighbors of task-001 must include ke-windows-atomic').toContain('ke-windows-atomic');
  });

  it('neighbors_filters_by_relation', async () => {
    // From ke-windows-atomic with relation learned-in — should return task-001.
    const result = await neighbors({ repoRoot, id: 'ke-windows-atomic', relation: 'learned-in' });
    const ids = result.map((n) => n.id);
    expect(ids, 'relation filter must return only nodes connected via that relation').toContain('task-001');
    // The "uses" relation goes the other direction; 'ke-windows-atomic' is a TO node for uses.
    const resultUses = await neighbors({ repoRoot, id: 'ke-windows-atomic', relation: 'uses' });
    const idsUses = resultUses.map((n) => n.id);
    expect(idsUses, 'neighbors with relation=uses from ke-windows-atomic must include task-001 (incoming uses edge)').toContain('task-001');
  });

  it('nodesByType_filters_nodes_by_type', async () => {
    const keNodes = await nodesByType({ repoRoot, type: 'knowledge_entry' });
    expect(keNodes.length, 'nodesByType(knowledge_entry) must return exactly one node').toBe(1);
    expect(keNodes[0].id).toBe('ke-windows-atomic');

    const taskNodes = await nodesByType({ repoRoot, type: 'task' });
    expect(taskNodes.length, 'nodesByType(task) must return exactly one node').toBe(1);
    expect(taskNodes[0].id).toBe('task-001');

    const decisionNodes = await nodesByType({ repoRoot, type: 'decision' });
    expect(decisionNodes.length, 'nodesByType(decision) must return empty array when no decisions exist').toBe(0);
  });
});

// ===========================================================================
// AC8 (route) — GET /graph on createBoardServer → 200 HTML, inline assets,
//               groups nodes by type, shows edges.
// ===========================================================================
describe('TASK-035 AC8a — GET /graph serves grouped HTML with edges', () => {
  let repoRoot;
  let server;
  let baseUrl;

  beforeEach(async () => {
    await importGraph();
    repoRoot = makeGraphRepo();
    // Seed a two-node, one-edge graph so the HTML can group and show edges.
    mkdirSync(join(repoRoot, 'tasks'), { recursive: true });
    await addNode({ repoRoot, node: makeNode() });
    await addNode({ repoRoot, node: makeNode2() });
    await addEdge({ repoRoot, edge: { from: 'ke-windows-atomic', to: 'task-001', relation: 'relates-to' } });
    ({ server, baseUrl } = await startServer(repoRoot));
  });

  afterEach(async () => {
    if (server) await closeServer(server);
    if (repoRoot) rmSync(repoRoot, { recursive: true, force: true });
  });

  it('GET_graph_returns_200_HTML_with_inline_assets_no_external_URLs', async () => {
    const res = await fetch(`${baseUrl}/graph`);
    expect(res.status, 'GET /graph must return 200').toBe(200);
    expect(res.headers.get('content-type'), 'content-type must be text/html').toMatch(/text\/html/);
    const html = await res.text();
    expect(html.length, 'HTML body must not be empty').toBeGreaterThan(0);

    // Inline assets: must have <style or <script block; no external URLs.
    const hasInlineAsset = html.includes('<style') || html.includes('<script');
    expect(hasInlineAsset, 'HTML must contain inline <style> or <script> — no CDN dependencies').toBe(true);

    const externalUrlRe = /(?:src|href)\s*=\s*["']https?:\/\//gi;
    expect(
      html.match(externalUrlRe),
      'HTML must not reference external URLs via src/href',
    ).toBeNull();
  });

  it('GET_graph_groups_nodes_by_type_and_shows_edges', async () => {
    const res = await fetch(`${baseUrl}/graph`);
    const html = await res.text();
    // The node types and the seeded node ids must appear.
    expect(html, 'page must mention knowledge_entry type group').toMatch(/knowledge.?entry|knowledge_entry/i);
    expect(html, 'page must mention task type group').toMatch(/\btask\b/i);
    expect(html, 'seeded node id ke-windows-atomic must appear').toContain('ke-windows-atomic');
    expect(html, 'seeded node id task-001 must appear').toContain('task-001');
    // Edge relation must appear.
    expect(html, 'seeded edge relation relates-to must appear').toContain('relates-to');
  });
});

// ===========================================================================
// AC8 (route) — GET /graph with NO graph.json → still 200, empty-state message.
// ===========================================================================
describe('TASK-035 AC8b — GET /graph with absent graph.json still 200', () => {
  let repoRoot;
  let server;
  let baseUrl;

  beforeEach(async () => {
    repoRoot = makeGraphRepo(); // no graphJson written
    mkdirSync(join(repoRoot, 'tasks'), { recursive: true });
    ({ server, baseUrl } = await startServer(repoRoot));
  });

  afterEach(async () => {
    if (server) await closeServer(server);
    if (repoRoot) rmSync(repoRoot, { recursive: true, force: true });
  });

  it('GET_graph_with_absent_graph_file_returns_200_with_empty_state_message', async () => {
    const res = await fetch(`${baseUrl}/graph`);
    expect(res.status, 'GET /graph must return 200 even when graph.json is absent').toBe(200);
    const html = await res.text();
    expect(html.length, 'HTML body must not be empty').toBeGreaterThan(0);
    // Must indicate empty/no-graph state, not crash with a 500.
    const hasEmptyMessage = /no nodes|empty|no graph|graph is empty/i.test(html);
    expect(hasEmptyMessage, 'page must render an empty-state message when no graph file exists').toBe(true);
  });
});
