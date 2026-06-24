---
module: knowledge-graph
layer: canonical
tier: T1
updated: 2026-06-24
files: [src/knowledge-graph.js]
---

## Purpose
Defines the single source of truth for knowledge in hivemind and how the base's local graph relates
to it. Design intent from decision 002.

> The base SHIPS a typed JSON knowledge graph (`src/knowledge-graph.js`: loadGraph/addNode/addEdge/
> neighbors/nodesByType, AJV-validated, deterministic). [EXPLICIT] (`src/knowledge-graph.js`)
> hivemind REPOSITIONS it as a projection of the brain's graph. [INFERRED:strong] (decision 002)

## Decisions
- **Canonical store = wisearcher's Neo4j + Qdrant** (cited claims, semantic retrieval, entity
  resolution). [INFERRED:strong] (decision 002)
- **Base JSON graph → cache/projection**: `src/knowledge-graph.js` becomes a thin local view of the
  subset the orchestrator needs (task/decision/skill nodes), not a competing truth. [INFERRED:strong] (decision 002)
- **hivemind writes into the canonical graph**: task/decision/skill nodes the base creates are
  persisted into the brain's graph via MCP `kb_ingest`, so there is ONE graph. [INFERRED:strong] (decision 002)
- **Wired from session start**: the graph is reachable to the orchestrator + subagents at the
  RESUME-FIRST step, before the first ticket. [INFERRED:strong] (decisions 002; user clarification)

## Patterns
Node types carry calibration: every knowledge node gets a marker + source tier; the brain's
confidence components (credibility × assertion strength × corroboration × verification) map onto
those markers. Edges encode the traceability that today lives in prose. [INFERRED:strong] (decision 002; wisengine markers)

## Constraints
- Do not treat the JSON graph as authoritative — on conflict, the brain's graph wins. [INFERRED:strong] (decision 002)
- When the brain is offline, the projection is read-only and clearly flagged stale. [INFERRED:strong] (decision 006)

## Interfaces
- Base (exists): `loadGraph`, `addNode`, `addEdge`, `removeNode`, `removeEdge`, `neighbors`,
  `nodesByType`. [EXPLICIT] (`src/knowledge-graph.js`)
- New (proposed): a sync/bridge that mirrors base nodes into the brain and hydrates the projection
  from it. [ASSUMED]

## Files
- `src/knowledge-graph.js` — base typed JSON graph; to be repositioned as a projection. [EXPLICIT]
- `src/<graph-bridge>.js` — projection↔canonical sync (to be created). [MISSING_INFO]
