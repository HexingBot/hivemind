---
module: decisions/006-brain-runtime-fallback
layer: derived
tier: T2
updated: 2026-06-24
files: []
---

## Decision
hivemind **manages the brain's lifecycle** (it can `docker compose up` Qdrant + Neo4j and spawn the wisearcher MCP server) and **degrades gracefully** when the brain's heavy dependencies are absent — falling back to the base's lightweight grep KB.

## Status
Accepted

## Context
The brain needs Docker (Qdrant + Neo4j) and a Voyage API key. Options: manage it with fallback, manage it but hard-require it, or assume it is pre-installed and just connect.

## Rationale
Managing it gives a one-command first run; graceful fallback means a user without Docker/Voyage still gets the rest of the loop instead of a hard wall. Hard-requiring it raises the barrier to first run; assuming pre-installed pushes setup burden onto the user.

## Consequences
- Easier: low barrier to first run; the tool is useful even without the full brain stack.
- Trade-off: every brain-dependent feature must define an explicit offline behavior; more lifecycle + health-check code; two code paths (full vs. fallback) to test.
