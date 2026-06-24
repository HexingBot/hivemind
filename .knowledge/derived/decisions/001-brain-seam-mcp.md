---
module: decisions/001-brain-seam-mcp
layer: derived
tier: T2
updated: 2026-06-24
files: []
---

## Decision
wisearcher (the Brain) is integrated as an out-of-process **MCP service** that hivemind calls; it is not rewritten in JS or embedded in-process.

## Status
Accepted

## Context
hivemind's plugin runtime is Node/JS; wisearcher is Python with Qdrant + Neo4j + Voyage clients. The two must talk without merging runtimes. Options weighed: MCP service, local HTTP microservice, CLI subprocess, or porting wisearcher to TS.

## Rationale
The base already wires MCP servers, and wisearcher was built with a clean `store/` seam intended for exactly this. MCP keeps Python where it is, gives structured tool calls (vs. brittle CLI parsing), and adds no second protocol. Porting to TS would discard a working engine and its DB/embedding clients.

## Consequences
- Easier: reuse wisearcher untouched; structured, typed tool calls; one integration style.
- Trade-off: a polyglot system (JS plugin + Python service); the MCP tool surface must be defined (Phase 1); a running Python process to manage (see decision 006).
