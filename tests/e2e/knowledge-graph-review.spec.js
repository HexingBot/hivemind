// tests/e2e/knowledge-graph-review.spec.js
// TASK-035 review fixes — specs authorized by the REQUEST-CHANGES verdict:
//
//   HIGH-1(d)  — hostile-label data-island round-trip: a label containing a
//                </script> breakout attempt AND String.replace $-patterns must
//                (a) round-trip exactly through the island's JSON,
//                (b) never appear as a raw "</script><img" in the response,
//                (c) appear HTML-escaped in the SSR-rendered body.
//   MEDIUM-2   — addNode rejects a duplicate node id BEFORE any write.
//   LOW        — /api/graph smoke: 200 + JSON shape; corrupt graph.json → 500.

import {
  describe, it, expect, afterEach,
} from 'vitest';
import {
  mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { addNode, addEdge } from '../../src/knowledge-graph.js';
import { createBoardServer } from '../../src/task-board.js';

// ---------------------------------------------------------------------------
// Helpers (mirror tests/e2e/knowledge-graph.spec.js).
// ---------------------------------------------------------------------------
function makeGraphRepo() {
  const repoRoot = mkdtempSync(join(tmpdir(), 'kg-review-'));
  mkdirSync(join(repoRoot, 'knowledge', 'graph'), { recursive: true });
  mkdirSync(join(repoRoot, 'tasks'), { recursive: true });
  return repoRoot;
}

function startServer(repoRoot) {
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

let repoRoot;
let server;

afterEach(async () => {
  if (server) { await closeServer(server); server = null; }
  if (repoRoot) { rmSync(repoRoot, { recursive: true, force: true }); repoRoot = null; }
});

// ===========================================================================
// HIGH-1(d) — hostile label: island injection + script-context escaping +
//             replacement-function $-semantics + SSR escHtml discipline.
// ===========================================================================
describe('TASK-035 review HIGH-1 — /graph data island round-trips a hostile label', () => {
  const HOSTILE_LABEL = '</script><img src=x onerror=alert(1)> with $& and $\' and $` too';

  it('island_JSON_round_trips_hostile_label_and_response_has_no_script_breakout', async () => {
    repoRoot = makeGraphRepo();
    await addNode({
      repoRoot,
      node: {
        id: 'evil-node',
        type: 'knowledge_entry',
        ref: 'knowledge/entries/evil.md',
        label: HOSTILE_LABEL,
      },
    });
    const started = await startServer(repoRoot);
    server = started.server;

    const res = await fetch(`${started.baseUrl}/graph`);
    expect(res.status, 'GET /graph must return 200').toBe(200);
    const html = await res.text();

    // (a) The data island must JSON.parse back to the EXACT hostile label —
    //     pins both the sentinel/template agreement (injection actually
    //     happens) and the replacement-function $-semantics ($& must not be
    //     expanded into the matched sentinel text).
    const islandRe = /<script id="graph-data" type="application\/json">([\s\S]*?)<\/script>/;
    const m = islandRe.exec(html);
    expect(m, 'the graph-data island must be present in the served HTML').not.toBeNull();
    expect(
      m[1].includes('__GRAPH_DATA__'),
      'the sentinel must have been replaced with real JSON data',
    ).toBe(false);
    const islandGraph = JSON.parse(m[1]);
    const evil = islandGraph.nodes.find((n) => n.id === 'evil-node');
    expect(evil, 'the hostile node must be present in the island JSON').toBeDefined();
    expect(
      evil.label,
      'the island JSON must round-trip the hostile label byte-for-byte',
    ).toBe(HOSTILE_LABEL);

    // (b) The raw breakout sequence must never appear anywhere in the body —
    //     pins the script-context escaping of "<" in the island.
    expect(
      html.includes('</script><img'),
      'raw "</script><img" must never appear in the response body',
    ).toBe(false);

    // (c) The SSR-rendered body must show the label HTML-escaped — pins
    //     buildGraphBody's escHtml discipline (outside the M3 pin slice).
    expect(
      html.includes('&lt;/script&gt;&lt;img'),
      'the SSR body must render the hostile label HTML-escaped',
    ).toBe(true);
  });
});

// ===========================================================================
// MEDIUM-2 — addNode rejects a duplicate node id before any write.
// ===========================================================================
describe('TASK-035 review MEDIUM-2 — addNode rejects duplicate node id before write', () => {
  it('addNode_rejects_duplicate_id_with_clear_error_and_no_disk_mutation', async () => {
    repoRoot = makeGraphRepo();
    const node = {
      id: 'dup-node',
      type: 'task',
      ref: 'tasks/TASK-001.json',
      label: 'Original',
    };
    await addNode({ repoRoot, node });
    const graphPath = join(repoRoot, 'knowledge', 'graph', 'graph.json');
    const bytesBefore = readFileSync(graphPath, 'utf8');

    await expect(
      addNode({
        repoRoot,
        node: { ...node, label: 'Impostor with a different label' },
      }),
      'addNode must reject a node whose id already exists',
    ).rejects.toThrow(/dup-node/);

    const bytesAfter = readFileSync(graphPath, 'utf8');
    expect(
      bytesAfter,
      'graph.json must be byte-identical after a rejected duplicate add (zero disk mutation)',
    ).toBe(bytesBefore);
  });
});

// ===========================================================================
// LOW — /api/graph smoke: 200 + JSON shape, and corrupt graph.json → 500.
// ===========================================================================
describe('TASK-035 review LOW — /api/graph smoke', () => {
  it('GET_api_graph_returns_200_with_graph_shape', async () => {
    repoRoot = makeGraphRepo();
    await addNode({
      repoRoot,
      node: { id: 'n1', type: 'skill', ref: 'skills/example', label: 'Example skill' },
    });
    await addNode({
      repoRoot,
      node: { id: 'n2', type: 'task', ref: 'tasks/TASK-002.json', label: 'Example task' },
    });
    await addEdge({ repoRoot, edge: { from: 'n2', to: 'n1', relation: 'uses' } });
    const started = await startServer(repoRoot);
    server = started.server;

    const res = await fetch(`${started.baseUrl}/api/graph`);
    expect(res.status, 'GET /api/graph must return 200').toBe(200);
    expect(res.headers.get('content-type'), 'content-type must be JSON').toMatch(/application\/json/);
    const body = await res.json();
    expect(body.schema_version, 'schema_version must be 1').toBe(1);
    expect(Array.isArray(body.nodes), 'nodes must be an array').toBe(true);
    expect(body.nodes.length).toBe(2);
    expect(Array.isArray(body.edges), 'edges must be an array').toBe(true);
    expect(body.edges.length).toBe(1);
  });

  it('GET_api_graph_with_corrupt_graph_json_returns_500', async () => {
    repoRoot = makeGraphRepo();
    writeFileSync(
      join(repoRoot, 'knowledge', 'graph', 'graph.json'),
      '{ this is not valid JSON !!!',
      'utf8',
    );
    const started = await startServer(repoRoot);
    server = started.server;

    const res = await fetch(`${started.baseUrl}/api/graph`);
    expect(res.status, 'corrupt graph.json must produce a loud 500').toBe(500);
  });
});
