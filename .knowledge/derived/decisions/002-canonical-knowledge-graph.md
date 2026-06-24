---
module: decisions/002-canonical-knowledge-graph
layer: derived
tier: T2
updated: 2026-06-24
files: [src/knowledge-graph.js]
---

## Decision
wisearcher's Neo4j + Qdrant graph is the **single source of truth** for knowledge. It is wired into hivemind via MCP from session start, hivemind writes its own task/decision/skill nodes into it, and the base's local JSON graph demotes to a thin projection/cache.

## Status
Accepted

## Context
Three candidate stores existed: wisengine's prose canonical/derived files, the base's typed JSON graph (`src/knowledge-graph.js`), and wisearcher's Neo4j+Qdrant. The user required that agent-framework's process retain access to the graph from the start, not just wisearcher.

## Rationale
wisearcher's graph is the richest — cited claims, semantic retrieval, entity resolution — and the others can be projected from it. Keeping all three in sync would drift. Making it canonical and accessible over MCP (decision 001) gives one truth that the whole system reads and writes.

## Consequences
- Easier: one authoritative, queryable, cited graph; cross-topic correlation; no triple-sync drift.
- Trade-off: the base JSON graph must be repositioned (not authoritative); needs a projection/bridge; when the brain is offline the projection is read-only + stale-flagged (see decision 006).
