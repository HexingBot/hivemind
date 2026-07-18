// tests/e2e/kb-graph-query.spec.js
// TASK-168 (KB-GRAPH-1) — kb_graph_query MCP tool: a deterministic, reproducible
// query surface over the internal knowledge graph (knowledge/graph/graph.json),
// mirroring kb_lookup's contract but for neighbors()/nodesByType()
// (src/knowledge-graph.js).
//
// SCOPE REFINEMENT (human decision 2026-07-18, tasks/TASK-168.json comment):
// the read path for id/neighbor queries goes through
// src/graph-sync.js#neighborsCanonicalFirst (the canonical-first / local-fallback
// merge seam) so the SAME tool serves both a brain-absent (shipped default,
// zero infra) and a future brain-present mode without re-touching the tool. The
// shipped server never wires a brain connection, so every call in this spec
// exercises the brain-ABSENT fallback path (source: 'projection') — that is the
// byte-stable/reproducible contract AC2 locks. Brain-present results are
// explicitly OUT of this determinism lock's scope (they depend on live brain
// state) — see the graph-sync unit coverage in tests/graph-sync.spec.js for the
// brain-present branch.
//
// relation/direction-filtered queries have no canonical-first equivalent today
// (brain-contract.md's kb_neighbors is `canonical_id`-only, no relation/direction
// param) so those shapes stay LOCAL-ONLY (documented) — proven below.
//
// TESTS-FIRST FAILURE SURFACE: kb_graph_query is not a registered tool yet, so
// every test below fails TODAY — listTools() omits it, and callTool either
// throws or returns a "Tool kb_graph_query not found" isError result whose
// text is not valid JSON, so parse() throws too. Same "right reason" pattern as
// tests/e2e/kb-lookup-seam.spec.js documents for TASK-106.

import {
  describe, it, expect, beforeEach, afterEach,
} from 'vitest';
import {
  mkdtempSync, rmSync, mkdirSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createServer } from '../../src/mcp-server.js';
import { makeRepoSkeleton } from '../helpers/fixtures.js';

function parse(result) {
  return JSON.parse(result.content[0].text);
}

// Deliberately UNSORTED on-disk node order (task-002 before task-001) so the
// determinism assertions below prove the tool sorts output itself rather than
// relying on graph.json already being pre-sorted (the production write path
// happens to sort, but this fixture writes the raw file directly to isolate
// the tool's own sort guarantee).
function writeGraphFixture(repoRoot) {
  const graphDir = join(repoRoot, 'knowledge', 'graph');
  mkdirSync(graphDir, { recursive: true });
  const graph = {
    schema_version: 1,
    nodes: [
      { id: 'task-002', type: 'task', ref: 'tasks/TASK-002.json', label: 'Second task' },
      { id: 'task-001', type: 'task', ref: 'tasks/TASK-001.json', label: 'First task' },
      { id: 'decision-20260101-x', type: 'decision', ref: 'knowledge/decisions/x.md', label: 'Decision X' },
    ],
    edges: [
      { from: 'task-001', to: 'decision-20260101-x', relation: 'produced-by' },
      { from: 'task-002', to: 'task-001', relation: 'blocks' },
    ],
  };
  writeFileSync(join(graphDir, 'graph.json'), JSON.stringify(graph, null, 2) + '\n', 'utf8');
}

describe('TASK-168 — kb_graph_query MCP tool (canonical-first read seam, brain-absent fallback)', () => {
  let repoRoot;
  let client;
  let server;

  beforeEach(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), 'kb-graph-query-'));
    makeRepoSkeleton(repoRoot);
    writeGraphFixture(repoRoot);

    server = createServer({ repoRoot });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'task-168-test', version: '0.0.0' });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
  });

  afterEach(async () => {
    if (client) await client.close();
    if (repoRoot) rmSync(repoRoot, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // AC1 — the tool is registered.
  // ---------------------------------------------------------------------------
  it('kb_graph_query_tool_is_registered_on_the_server', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('kb_graph_query');
  });

  // ---------------------------------------------------------------------------
  // AC1 — id-based neighbor query, bidirectional default, sorted by id.
  // ---------------------------------------------------------------------------
  it('returns_bidirectional_neighbors_for_a_known_id_sorted_by_id', async () => {
    const result = parse(await client.callTool({
      name: 'kb_graph_query',
      arguments: { id: 'task-001' },
    }));
    expect(result.source).toBe('projection');
    expect(result.nodes.map((n) => n.id)).toEqual(['decision-20260101-x', 'task-002']);
    // Full node shape preserved.
    expect(result.nodes[0]).toEqual({
      id: 'decision-20260101-x', type: 'decision', ref: 'knowledge/decisions/x.md', label: 'Decision X',
    });
  });

  // ---------------------------------------------------------------------------
  // AC1 — type-only query uses nodesByType on the local graph, sorted by id
  // despite the on-disk fixture listing task-002 before task-001.
  // ---------------------------------------------------------------------------
  it('returns_all_nodes_of_a_type_via_nodesByType_sorted_by_id', async () => {
    const result = parse(await client.callTool({
      name: 'kb_graph_query',
      arguments: { type: 'task' },
    }));
    expect(result.source).toBe('projection');
    expect(result.nodes.map((n) => n.id)).toEqual(['task-001', 'task-002']);
  });

  // ---------------------------------------------------------------------------
  // AC2 — byte-stable/reproducible for the brain-absent (local) path: identical
  // graph.json + identical args -> byte-identical serialized output, not just
  // deep-equal, on repeat invocation.
  // ---------------------------------------------------------------------------
  it('is_byte_stable_for_identical_graph_and_args_on_repeat_invocation', async () => {
    const first = await client.callTool({ name: 'kb_graph_query', arguments: { id: 'task-001' } });
    expect(first.isError, 'the tool call itself must succeed before byte-stability is meaningful').toBeFalsy();
    const second = await client.callTool({ name: 'kb_graph_query', arguments: { id: 'task-001' } });
    expect(second.content[0].text).toBe(first.content[0].text);
  });

  it('is_byte_stable_for_a_type_only_query_on_repeat_invocation', async () => {
    const first = await client.callTool({ name: 'kb_graph_query', arguments: { type: 'task' } });
    expect(first.isError, 'the tool call itself must succeed before byte-stability is meaningful').toBeFalsy();
    const second = await client.callTool({ name: 'kb_graph_query', arguments: { type: 'task' } });
    expect(second.content[0].text).toBe(first.content[0].text);
  });

  // ---------------------------------------------------------------------------
  // ADDED PER SCOPE REFINEMENT — with no brain configured, kb_graph_query
  // returns the local-graph result via the neighborsCanonicalFirst fallback
  // path (brain injected as absent — the shipped server never wires a brain
  // connection). `source: 'projection'` is the observable proof of the
  // fallback, independent of the other assertions above that happen to check
  // the same field.
  // ---------------------------------------------------------------------------
  it('with_no_brain_configured_returns_the_local_graph_result_via_the_fallback_path', async () => {
    const result = parse(await client.callTool({
      name: 'kb_graph_query',
      arguments: { id: 'task-002' },
    }));
    expect(result.source).toBe('projection');
    expect(result.nodes.map((n) => n.id)).toEqual(['task-001']);
  });

  // ---------------------------------------------------------------------------
  // AC3 — a missing node id yields empty neighbors, not an exception.
  // ---------------------------------------------------------------------------
  it('missing_id_yields_empty_neighbors_not_an_exception', async () => {
    const res = await client.callTool({ name: 'kb_graph_query', arguments: { id: 'does-not-exist' } });
    expect(res.isError).toBeFalsy();
    const result = parse(res);
    expect(result.nodes).toEqual([]);
    expect(result.source).toBe('projection');
  });

  // ---------------------------------------------------------------------------
  // AC3 — empty args (neither id nor type) return an empty, documented result
  // rather than throwing.
  // ---------------------------------------------------------------------------
  it('empty_args_return_an_empty_result_not_an_exception', async () => {
    const res = await client.callTool({ name: 'kb_graph_query', arguments: {} });
    expect(res.isError).toBeFalsy();
    const result = parse(res);
    expect(result.nodes).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // AC3 — an invalid enum value (type/relation/direction) surfaces as a typed
  // error (isError / thrown rejection), never a server crash — and the server
  // keeps responding to subsequent calls afterward.
  // ---------------------------------------------------------------------------
  it('an_invalid_type_enum_value_surfaces_as_a_typed_error_not_a_crash', async () => {
    let surfaced = false;
    try {
      const res = await client.callTool({ name: 'kb_graph_query', arguments: { type: 'not_a_real_type' } });
      if (res && res.isError) surfaced = true;
    } catch {
      surfaced = true;
    }
    expect(surfaced, 'an invalid type enum value must be rejected, not silently accepted').toBe(true);

    // Server survives — a subsequent valid call still works.
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('kb_graph_query');
  });

  // ---------------------------------------------------------------------------
  // Relation/direction-filtered queries — LOCAL-ONLY (documented): the
  // canonical-first seam (graph-sync.js#neighborsCanonicalFirst) has no
  // relation/direction parameter yet (brain-contract.md's kb_neighbors is
  // canonical_id-only), so these shapes stay on the local projection.
  // ---------------------------------------------------------------------------
  it('direction_out_filters_to_only_outgoing_edges_from_the_id', async () => {
    const result = parse(await client.callTool({
      name: 'kb_graph_query',
      arguments: { id: 'task-001', direction: 'out' },
    }));
    expect(result.nodes.map((n) => n.id)).toEqual(['decision-20260101-x']);
  });

  it('relation_filter_narrows_neighbors_to_the_matching_edge', async () => {
    const result = parse(await client.callTool({
      name: 'kb_graph_query',
      arguments: { id: 'task-001', relation: 'blocks' },
    }));
    expect(result.nodes.map((n) => n.id)).toEqual(['task-002']);
  });

  // ---------------------------------------------------------------------------
  // TASK-172 (KB-GRAPH-1a) — fixes a MEDIUM from the TASK-168 review: an
  // unsupported arg combination must never silently drop a supplied filter.
  //
  // { id, type }: BEFORE this ticket, `type` was silently ignored and the call
  // returned ALL neighbors of id (both decision-20260101-x and task-002 for
  // task-001). CHOSEN SEMANTICS: `type` is applied as a post-filter on the
  // neighbor result — only neighbors whose OWN node.type matches are kept. So
  // { id: 'task-001', type: 'task' } must return only task-002, dropping the
  // decision-typed neighbor. This test fails TODAY (pre-fix) because the
  // unfiltered result still includes decision-20260101-x.
  // ---------------------------------------------------------------------------
  it('id_and_type_combination_applies_type_as_a_post_filter_on_the_neighbor_result', async () => {
    const result = parse(await client.callTool({
      name: 'kb_graph_query',
      arguments: { id: 'task-001', type: 'task' },
    }));
    expect(result.nodes.map((n) => n.id)).toEqual(['task-002']);
    expect(result.nodes.every((n) => n.type === 'task')).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // { type, direction } (no id): BEFORE this ticket, `direction` was silently
  // ignored and the call returned every node of that type via nodesByType, as
  // if direction had never been supplied. CHOSEN SEMANTICS: direction (and
  // relation) only mean something relative to an edge anchored at a specific
  // node id — a type-only query has no such anchor, so this combination is
  // REJECTED with a typed error rather than silently ignoring the filter. This
  // test fails TODAY (pre-fix) because the call currently succeeds
  // (isError falsy) and silently returns all task nodes.
  // ---------------------------------------------------------------------------
  it('type_and_direction_without_an_id_is_rejected_as_a_typed_error_not_silently_ignored', async () => {
    let surfaced = false;
    try {
      const res = await client.callTool({
        name: 'kb_graph_query',
        arguments: { type: 'task', direction: 'out' },
      });
      if (res && res.isError) surfaced = true;
    } catch {
      surfaced = true;
    }
    expect(surfaced, 'type + direction without an id must be a typed error, not a silently-accepted call').toBe(true);

    // Server survives — a subsequent valid call still works.
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('kb_graph_query');
  });

  // ---------------------------------------------------------------------------
  // TASK-173 (KB-GRAPH-1b) — CLOSED SCOPE: make the no-silent-drop invariant
  // TOTAL. TASK-172's guard required `type !== undefined`, so { relation }
  // alone or { direction } alone (no id, no type) fell through to the
  // "neither id nor type" branch and returned an EMPTY result with
  // relation/direction SILENTLY IGNORED. These three specs fail TODAY
  // (pre-fix) because the guard's `type !== undefined` conjunct lets these
  // shapes through to the empty-result branch instead of rejecting them.
  // ---------------------------------------------------------------------------
  it('relation_alone_without_an_id_is_rejected_as_a_typed_error_not_silently_ignored', async () => {
    let surfaced = false;
    let errorText = '';
    try {
      const res = await client.callTool({
        name: 'kb_graph_query',
        arguments: { relation: 'blocks' },
      });
      if (res && res.isError) {
        surfaced = true;
        errorText = res.content[0].text;
      }
    } catch (err) {
      surfaced = true;
      errorText = err.message ?? String(err);
    }
    expect(surfaced, 'relation without an id must be a typed error, not a silently-empty result').toBe(true);
    expect(errorText).toContain('E_UNANCHORED_EDGE_FILTER');

    // Server survives — a subsequent valid call still works.
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('kb_graph_query');
  });

  it('direction_alone_without_an_id_is_rejected_as_a_typed_error_not_silently_ignored', async () => {
    let surfaced = false;
    let errorText = '';
    try {
      const res = await client.callTool({
        name: 'kb_graph_query',
        arguments: { direction: 'out' },
      });
      if (res && res.isError) {
        surfaced = true;
        errorText = res.content[0].text;
      }
    } catch (err) {
      surfaced = true;
      errorText = err.message ?? String(err);
    }
    expect(surfaced, 'direction without an id must be a typed error, not a silently-empty result').toBe(true);
    expect(errorText).toContain('E_UNANCHORED_EDGE_FILTER');

    // Server survives — a subsequent valid call still works.
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('kb_graph_query');
  });

  it('relation_and_direction_together_without_an_id_is_rejected_as_a_typed_error', async () => {
    let surfaced = false;
    let errorText = '';
    try {
      const res = await client.callTool({
        name: 'kb_graph_query',
        arguments: { relation: 'blocks', direction: 'out' },
      });
      if (res && res.isError) {
        surfaced = true;
        errorText = res.content[0].text;
      }
    } catch (err) {
      surfaced = true;
      errorText = err.message ?? String(err);
    }
    expect(surfaced, 'relation + direction without an id must be a typed error, not a silently-empty result').toBe(true);
    expect(errorText).toContain('E_UNANCHORED_EDGE_FILTER');

    // Server survives — a subsequent valid call still works.
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('kb_graph_query');
  });
});
