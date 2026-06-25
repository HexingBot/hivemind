// src/knowledge-graph.js
// TASK-035 — Typed knowledge graph over knowledge entries, tasks, decisions
// and skills stored under knowledge/graph/graph.json.
//
// API:
//   loadGraph({ repoRoot })          → {schema_version, nodes, edges}
//   addNode({ repoRoot, node })      → validates schema + type before writing atomically
//   addEdge({ repoRoot, edge })      → validates schema + referential integrity before writing
//   removeNode({ repoRoot, id })     → cascades edges for that node
//   removeEdge({ repoRoot, edge })   → removes a specific edge by (from, to, relation)
//   neighbors({ repoRoot, id, relation?, direction? }) → connected node objects
//   nodesByType({ repoRoot, type })  → filtered node array
//
// DETERMINISTIC SERIALIZATION:
//   Nodes are sorted by `id` (lexicographic ascending).
//   Edges are sorted by composite key: (from, to, relation).
//   Each node emits keys in fixed order: id, type, ref, label.
//   Each edge emits keys in fixed order: from, to, relation.
//   Trailing newline is appended.
//
// NEIGHBORS DIRECTION SEMANTICS:
//   Default (direction omitted): bidirectional — returns all nodes that share
//     any edge with `id`, regardless of which end `id` is on.
//   direction = 'out': only nodes where `id` is the `from` end of the edge
//     (i.e. nodes reachable by following outgoing edges from id).
//   direction = 'in': only nodes where `id` is the `to` end of the edge
//     (i.e. nodes that have an edge pointing into id).
//   When `relation` is also supplied, the edge must match BOTH the relation
//   AND the direction filter.
//
// VALIDATION:
//   All writes (addNode, addEdge) run full AJV draft-2020-12 validation on the
//   resulting graph document BEFORE any disk mutation. Invalid input throws;
//   the on-disk file is never touched on a validation failure.
//
// REFERENTIAL INTEGRITY:
//   addEdge verifies that both `from` and `to` node ids exist in the current
//   graph BEFORE writing. removeNode cascades all edges that reference the
//   removed id (from OR to).
//
// ATOMIC WRITES:
//   All writes use atomicWriteFile from src/atomic-write.js (same-directory
//   tmp + rename with EBUSY retry — Windows-safe).
//
// SELF-BOOTSTRAP:
//   On the first write to a repo where knowledge/graph/ does not yet exist,
//   the directory is created automatically (mkdirSync, recursive).
//
// CONCURRENCY:
//   Single-writer assumption — the orchestrator is the only writer; writes are
//   read-modify-write without cross-process locking, so concurrent writers
//   could lose updates (acceptable for this harness, same as task-store).

import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { atomicWriteFile } from './atomic-write.js';

// ---------------------------------------------------------------------------
// Inline schema — keeps the module self-contained for bundled (dist/*.cjs)
// deployments where import.meta.url is unavailable. Mirrors knowledge/graph/schema.json
// (modulo `description` annotations); a drift-guard spec in
// tests/knowledge-graph-scaffold.spec.js deep-compares the two with
// description keys stripped, so update both in lock-step.
// Exported for that drift guard only — not part of the store API surface.
// ---------------------------------------------------------------------------
export const GRAPH_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://hivemind/knowledge/graph/schema.json',
  title: 'Knowledge Graph',
  description: 'Typed graph over knowledge entries, tasks, decisions and skills under knowledge/graph/graph.json.',
  type: 'object',
  required: ['schema_version', 'nodes', 'edges'],
  additionalProperties: false,
  properties: {
    schema_version: { const: 1 },
    nodes: { type: 'array', items: { $ref: '#/$defs/node' } },
    edges: { type: 'array', items: { $ref: '#/$defs/edge' } },
  },
  $defs: {
    node: {
      type: 'object',
      required: ['id', 'type', 'ref', 'label'],
      additionalProperties: false,
      properties: {
        id: { type: 'string', minLength: 1 },
        type: { type: 'string', enum: ['knowledge_entry', 'task', 'decision', 'skill'] },
        ref: { type: 'string', minLength: 1 },
        label: { type: 'string', minLength: 1 },
      },
    },
    edge: {
      type: 'object',
      required: ['from', 'to', 'relation'],
      additionalProperties: false,
      properties: {
        from: { type: 'string', minLength: 1 },
        to: { type: 'string', minLength: 1 },
        relation: { type: 'string', enum: ['learned-in', 'blocks', 'supersedes', 'uses', 'produced-by', 'relates-to'] },
      },
    },
  },
};

let _validate = null;

function getValidator() {
  if (_validate) return _validate;
  const ajv = new Ajv2020({ allErrors: true });
  addFormats(ajv);
  _validate = ajv.compile(GRAPH_SCHEMA);
  return _validate;
}

// ---------------------------------------------------------------------------
// Paths.
// ---------------------------------------------------------------------------
function graphPath(repoRoot) {
  return join(repoRoot, 'knowledge', 'graph', 'graph.json');
}

function graphDir(repoRoot) {
  return join(repoRoot, 'knowledge', 'graph');
}

// ---------------------------------------------------------------------------
// Empty graph sentinel.
// ---------------------------------------------------------------------------
function emptyGraph() {
  return { schema_version: 1, nodes: [], edges: [] };
}

// ---------------------------------------------------------------------------
// Deterministic serialization.
// Keys emitted in fixed order per object type; arrays sorted before emit.
// ---------------------------------------------------------------------------
function serializeNode(n) {
  return { id: n.id, type: n.type, ref: n.ref, label: n.label };
}

function serializeEdge(e) {
  return { from: e.from, to: e.to, relation: e.relation };
}

function edgeSortKey(e) {
  return `${e.from}\x00${e.to}\x00${e.relation}`;
}

function serializeGraph(graph) {
  const nodes = [...graph.nodes]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(serializeNode);
  const edges = [...graph.edges]
    .sort((a, b) => {
      const ka = edgeSortKey(a);
      const kb = edgeSortKey(b);
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    })
    .map(serializeEdge);
  const doc = { schema_version: graph.schema_version, nodes, edges };
  return JSON.stringify(doc, null, 2) + '\n';
}

// ---------------------------------------------------------------------------
// Validation helper — throws with AJV error details on failure.
// ---------------------------------------------------------------------------
function validateGraph(graph) {
  const validate = getValidator();
  const ok = validate(graph);
  if (!ok) {
    const details = JSON.stringify(validate.errors, null, 2);
    throw new Error(`Graph document failed schema validation:\n${details}`);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load the graph from disk. If the file does not exist, returns an empty graph
 * {schema_version: 1, nodes: [], edges: []} without throwing.
 * If the file exists but is corrupt (invalid JSON), throws (loud corruption).
 *
 * NOTE: read-path validation is parse-only by design — the file is trusted
 * because every write path schema-validates before mutating it. A full AJV
 * pass on every read would be redundant cost on the hot query path.
 *
 * @param {{ repoRoot: string }} opts
 * @returns {Promise<{schema_version: number, nodes: Array, edges: Array}>}
 */
export async function loadGraph({ repoRoot }) {
  const path = graphPath(repoRoot);
  if (!existsSync(path)) return emptyGraph();
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw); // throws on corrupt JSON — loud by design
}

/**
 * Add a node to the graph. Validates the resulting document against the schema
 * and rejects duplicate node ids BEFORE any write. Throws on validation
 * failure (zero disk mutation).
 * Creates knowledge/graph/ directory on first write (self-bootstrap).
 *
 * @param {{ repoRoot: string, node: {id, type, ref, label} }} opts
 */
export async function addNode({ repoRoot, node }) {
  const graph = await loadGraph({ repoRoot });

  // Duplicate-id guard — node ids are the graph's primary key; a silent
  // duplicate would corrupt referential-integrity checks and neighbor queries.
  if (node && node.id !== undefined && graph.nodes.some((n) => n.id === node.id)) {
    throw new Error(`addNode: node id "${node.id}" already exists in the graph`);
  }

  // Build the candidate graph with the new node appended.
  const candidate = {
    schema_version: graph.schema_version,
    nodes: [...graph.nodes, node],
    edges: graph.edges,
  };

  // Full schema validation — throws before any write on failure.
  validateGraph(candidate);

  // Self-bootstrap: ensure directory exists.
  await mkdir(graphDir(repoRoot), { recursive: true });

  await atomicWriteFile(graphPath(repoRoot), serializeGraph(candidate));
}

/**
 * Add an edge to the graph. Validates schema + referential integrity (both
 * from and to node ids must exist) BEFORE any write. Throws on failure.
 *
 * @param {{ repoRoot: string, edge: {from, to, relation} }} opts
 */
export async function addEdge({ repoRoot, edge }) {
  const graph = await loadGraph({ repoRoot });

  // Referential integrity check first (cheaper than full AJV pass).
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  if (!nodeIds.has(edge.from)) {
    throw new Error(
      `addEdge: "from" node id "${edge.from}" does not exist in the graph`,
    );
  }
  if (!nodeIds.has(edge.to)) {
    throw new Error(
      `addEdge: "to" node id "${edge.to}" does not exist in the graph`,
    );
  }

  const candidate = {
    schema_version: graph.schema_version,
    nodes: graph.nodes,
    edges: [...graph.edges, edge],
  };

  // Full schema validation (catches invalid relation enum, missing fields, etc.)
  validateGraph(candidate);

  await mkdir(graphDir(repoRoot), { recursive: true });
  await atomicWriteFile(graphPath(repoRoot), serializeGraph(candidate));
}

/**
 * Remove a node by id. Cascades all edges that reference the removed id
 * (from OR to) before writing. Silently succeeds if the id is not found.
 *
 * @param {{ repoRoot: string, id: string }} opts
 */
export async function removeNode({ repoRoot, id }) {
  const graph = await loadGraph({ repoRoot });

  const nodes = graph.nodes.filter((n) => n.id !== id);
  const edges = graph.edges.filter((e) => e.from !== id && e.to !== id);

  const candidate = { schema_version: graph.schema_version, nodes, edges };
  validateGraph(candidate);

  await mkdir(graphDir(repoRoot), { recursive: true });
  await atomicWriteFile(graphPath(repoRoot), serializeGraph(candidate));
}

/**
 * Remove a specific edge identified by (from, to, relation). Silently
 * succeeds if the edge is not found.
 *
 * @param {{ repoRoot: string, edge: {from, to, relation} }} opts
 */
export async function removeEdge({ repoRoot, edge }) {
  const graph = await loadGraph({ repoRoot });

  const edges = graph.edges.filter(
    (e) => !(e.from === edge.from && e.to === edge.to && e.relation === edge.relation),
  );

  const candidate = { schema_version: graph.schema_version, nodes: graph.nodes, edges };
  validateGraph(candidate);

  await mkdir(graphDir(repoRoot), { recursive: true });
  await atomicWriteFile(graphPath(repoRoot), serializeGraph(candidate));
}

/**
 * Return connected node objects for a given node id.
 *
 * Direction semantics:
 *   default (undefined): bidirectional — nodes connected via any edge where
 *     id appears as from OR to.
 *   'out': only nodes reachable by outgoing edges from id (id is `from`).
 *   'in': only nodes that have an edge pointing into id (id is `to`).
 *
 * When `relation` is supplied, edges must also match that relation value.
 * Duplicate node ids are deduplicated in the result.
 *
 * @param {{ repoRoot: string, id: string, relation?: string, direction?: 'out'|'in' }} opts
 * @returns {Promise<Array<{id, type, ref, label}>>}
 */
export async function neighbors({ repoRoot, id, relation, direction }) {
  const graph = await loadGraph({ repoRoot });
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));

  const connectedIds = new Set();

  for (const edge of graph.edges) {
    // Relation filter (applies to both directions).
    if (relation !== undefined && edge.relation !== relation) continue;

    if (direction === 'out') {
      if (edge.from === id) connectedIds.add(edge.to);
    } else if (direction === 'in') {
      if (edge.to === id) connectedIds.add(edge.from);
    } else {
      // Bidirectional (default).
      if (edge.from === id) connectedIds.add(edge.to);
      if (edge.to === id) connectedIds.add(edge.from);
    }
  }

  const result = [];
  for (const nid of connectedIds) {
    const node = nodeMap.get(nid);
    if (node) result.push(node);
  }
  return result;
}

/**
 * Return all nodes of a given type.
 *
 * @param {{ repoRoot: string, type: string }} opts
 * @returns {Promise<Array<{id, type, ref, label}>>}
 */
export async function nodesByType({ repoRoot, type }) {
  const graph = await loadGraph({ repoRoot });
  return graph.nodes.filter((n) => n.type === type);
}
