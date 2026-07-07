---
name: graphify
description: How to build, query, and inspect the project knowledge graph stored under knowledge/graph/graph.json using src/knowledge-graph.js. Load this skill when the user or orchestrator wants to add nodes or edges to the graph, query neighbors or type-filtered nodes, inspect the current graph state, or open the /graph visualization in the board. Triggers on knowledge/graph/, addNode, addEdge, neighbors, nodesByType, loadGraph, or /hivemind:graph.
source_tier: T2
---

# Graphify — Project Knowledge Graph Skill

Incrementally build and query the project's typed knowledge graph via the
`src/knowledge-graph.js` public API, then visualize it at the board's `/graph`
view. The graph is stored at `knowledge/graph/graph.json` in the project root.

## CRITICAL Design Boundary

The graph is an **INCREMENTAL INDEX** over existing artifacts — not a bulk
re-scanner and not a second copy of state. This honors the 2026-06-11 design
decision recorded in the project.

- **Do** add nodes/edges for artifacts as they are created or referenced.
- **Do** query the graph to find relationships between tasks, decisions, skills,
  and knowledge entries.
- **Do NOT** bulk-rescan all artifacts to rebuild the graph from scratch.
- **Do NOT** duplicate artifact content into graph nodes — use `ref` to point at
  the artifact; `label` is a short human-readable name only.

## Graph Storage

- **File:** `<repoRoot>/knowledge/graph/graph.json`
- **Schema version:** `1`
- **Format:** `{ schema_version: 1, nodes: [...], edges: [...] }` — deterministically
  serialized (nodes sorted by `id`, edges sorted by `(from, to, relation)`).
- The directory `knowledge/graph/` is created automatically on first write
  (self-bootstrap); you do not need to `mkdir` it manually.

## Node Types

Each node has four required fields: `id`, `type`, `ref`, `label`.

| `type`            | Intended artifact                        | Example `ref`                          |
|-------------------|------------------------------------------|----------------------------------------|
| `knowledge_entry` | A file under `knowledge/`               | `knowledge/decisions/2026-06-11.md`    |
| `task`            | A task JSON file                        | `tasks/TASK-035.json`                  |
| `decision`        | A recorded design decision              | `knowledge/decisions/graph-design.md`  |
| `skill`           | A skill directory                       | `skills/graphify/SKILL.md`             |

### Canonical id shapes (TASK-104 — the canonical reference, identical to the orchestrator-routing skill's close-protocol section; the two sites must never contradict)

`id` must be unique across all nodes and match its type's canonical shape:

| node type          | id shape                     | example                                          |
|--------------------|-------------------------------|---------------------------------------------------|
| `task`             | `task-<digits>`               | `task-104`                                         |
| `decision`         | `decision-<YYYYMMDD>-<slug>`  | `decision-20260704-release-v0-10-0-minor-bump`     |
| `skill`            | `skill-<slug>`                | `skill-graphify`                                   |
| `knowledge_entry`  | `ke-<slug>`                   | `ke-windows-atomic-rename`                         |

`<slug>` is lowercase, hyphen-separated, `[a-z0-9-]+` only — never a raw ISO
timestamp and never an uppercase task key (e.g. `TASK-104`). Derive/validate
mechanically via `canonicalIdPattern`/`isCanonicalId`/`deriveCanonicalId` in
`src/graph-id-migration.js` rather than hand-rolling the convention. On an
`addNode` slug-collision rejection (the id is already in use), add a
distinguishing word to the `<slug>` rather than reusing or overloading the
existing id.

## Edge Relations (typed)

Each edge has three required fields: `from`, `to`, `relation`.

| `relation`    | Meaning                                              |
|---------------|------------------------------------------------------|
| `learned-in`  | A knowledge entry was learned while working on X     |
| `blocks`      | Task/decision X blocks task Y                        |
| `supersedes`  | Decision X supersedes decision Y                     |
| `uses`        | X uses/depends on skill or knowledge entry Y         |
| `produced-by` | Knowledge entry X was produced by task Y             |
| `relates-to`  | Generic bidirectional association                    |

## Canonical graph (the brain) — this local graph is a PROJECTION

`knowledge/graph/graph.json` is a read-through **projection/cache**. The source of truth is the
wisearcher **brain** graph (Neo4j+Qdrant), written over MCP. Keep them in sync by doing node
writes through `src/graph-sync.js` rather than calling `addNode` directly:

- **`recordNode({ brain, repoRoot, node, topic })`** — writes the local projection AND mirrors the
  node to the canonical graph via `kb_assert` (best-effort; queued when the brain is offline, never
  lost). `task`/`decision`/`skill` map to `[EXPLICIT]`/T2 canonical entities, `knowledge_entry` to
  `[INFERRED:strong]`; `node.ref` becomes the claim's provenance.
- **`neighborsCanonicalFirst({ brain, repoRoot, id, canonicalId })`** — reads the canonical graph
  when the brain is up, else falls back to this local projection.

When no brain is wired (the graceful-fallback case) `recordNode` still writes the local graph, so
the API below remains the offline source of truth. Bring the brain up with `/hivemind:brain`.

## Public API — `src/knowledge-graph.js`

All functions accept a named-parameter object and return a `Promise`.
`repoRoot` is always required and is the absolute path to the project root
(use `process.env.CLAUDE_PROJECT_DIR ?? process.cwd()`).

### `loadGraph({ repoRoot })`

Load the graph from disk. Returns `{ schema_version, nodes, edges }`. If
`knowledge/graph/graph.json` does not exist, returns an empty graph
`{ schema_version: 1, nodes: [], edges: [] }` without throwing. Throws on
corrupt JSON (loud by design).

```js
import { loadGraph } from './src/knowledge-graph.js';
const graph = await loadGraph({ repoRoot });
// graph.nodes  → array of node objects
// graph.edges  → array of edge objects
```

### `addNode({ repoRoot, node })`

Add a node to the graph. Validates schema + rejects a duplicate `id`
(case-insensitive — TASK-104) before any disk write. Creates `knowledge/graph/`
on first use. Throws on validation failure (zero disk mutation on error).

```js
import { addNode } from './src/knowledge-graph.js';
await addNode({
  repoRoot,
  node: {
    id: 'task-059',
    type: 'task',
    ref: 'tasks/TASK-059.json',
    label: 'graphify skill + /graph command',
  },
});
```

### `addEdge({ repoRoot, edge })`

Add a typed edge. Validates referential integrity (both `from` and `to` must
exist) and full schema before any write. Throws on failure.

```js
import { addEdge } from './src/knowledge-graph.js';
await addEdge({
  repoRoot,
  edge: { from: 'task-059', to: 'skill-graphify', relation: 'produced-by' },
});
```

### `removeNode({ repoRoot, id })`

Remove a node by `id`. Cascades all edges referencing that `id` (as `from` or
`to`). Silently succeeds if `id` is not found.

```js
import { removeNode } from './src/knowledge-graph.js';
await removeNode({ repoRoot, id: 'task-059' });
```

### `removeEdge({ repoRoot, edge })`

Remove a specific edge identified by `(from, to, relation)`. Silently
succeeds if the edge is not found.

```js
import { removeEdge } from './src/knowledge-graph.js';
await removeEdge({
  repoRoot,
  edge: { from: 'task-059', to: 'skill-graphify', relation: 'produced-by' },
});
```

### `neighbors({ repoRoot, id, relation?, direction? })`

Return connected node objects for a given `id`. Deduplicated.

- `relation` (optional string): filter to edges with this relation value.
- `direction` (optional `'out'` | `'in'`): filter by edge direction.
  - omitted (default): bidirectional — all nodes sharing any edge with `id`.
  - `'out'`: nodes reachable by outgoing edges from `id` (`id` is `from`).
  - `'in'`: nodes that have an edge pointing into `id` (`id` is `to`).

Throws `UnknownNodeIdError` (`err.code === 'E_GRAPH_UNKNOWN_ID'`) when `id`
does not exist in the graph (TASK-104) — no more silent `[]` for a typo'd or
stale id. Callers that treat a missing id as an expected degradation (e.g.
`graph-sync.js`'s canonical-first fallback) must catch this explicitly.

```js
import { neighbors } from './src/knowledge-graph.js';

// All neighbors of 'task-059' (any direction, any relation):
const all = await neighbors({ repoRoot, id: 'task-059' });

// Only nodes task-059 USES (outgoing 'uses' edges):
const used = await neighbors({ repoRoot, id: 'task-059', relation: 'uses', direction: 'out' });

// All tasks that block task-059 (incoming 'blocks' edges):
const blockers = await neighbors({ repoRoot, id: 'task-059', relation: 'blocks', direction: 'in' });
```

### `nodesByType({ repoRoot, type })`

Return all nodes with the given `type` value.

```js
import { nodesByType } from './src/knowledge-graph.js';
const allTasks = await nodesByType({ repoRoot, type: 'task' });
const allDecisions = await nodesByType({ repoRoot, type: 'decision' });
```

## How-To Recipes

### BUILD — Add a node and connect it

```js
import { addNode, addEdge } from './src/knowledge-graph.js';

const repoRoot = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

// 1. Add the artifact node.
await addNode({
  repoRoot,
  node: {
    id: 'skill-graphify',
    type: 'skill',
    ref: 'skills/graphify/SKILL.md',
    label: 'graphify',
  },
});

// 2. Connect it to the task that produced it.
await addEdge({
  repoRoot,
  edge: { from: 'skill-graphify', to: 'task-059', relation: 'produced-by' },
});
```

### QUERY — Find neighbors and filter by type

```js
import { neighbors, nodesByType } from './src/knowledge-graph.js';

const repoRoot = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

// What does skill-graphify depend on?
const deps = await neighbors({ repoRoot, id: 'skill-graphify', relation: 'uses', direction: 'out' });

// List every decision in the graph:
const decisions = await nodesByType({ repoRoot, type: 'decision' });
```

### INSPECT — Load and pretty-print the full graph

```js
import { loadGraph } from './src/knowledge-graph.js';

const repoRoot = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const graph = await loadGraph({ repoRoot });

console.log(`Nodes: ${graph.nodes.length}`);
console.log(`Edges: ${graph.edges.length}`);
console.log(JSON.stringify(graph, null, 2));
```

## Visualization

Run the `/hivemind:graph` slash command to launch the board server and
open the graph view at `http://127.0.0.1:4517/graph`. The page renders all nodes
and edges as an interactive force-directed diagram. The same data is available
as JSON at `http://127.0.0.1:4517/api/graph`.

## Validation

All write operations (`addNode`, `addEdge`, `removeNode`, `removeEdge`) run
full AJV draft-2020-12 validation on the resulting document **before** any disk
mutation. An invalid write throws; the on-disk file is never touched on a
validation failure.

## Provenance

- **Authored by:** Developer subagent on behalf of ticket `TASK-059`.
- **API source:** `src/knowledge-graph.js` (TASK-035).
- **Design boundary:** 2026-06-11 decision — incremental index, not bulk re-scanner.
