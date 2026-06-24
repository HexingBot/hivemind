---
module: brain-seam
layer: canonical
tier: T1
updated: 2026-06-24
files: [src/, .mcp.json]
---

## Purpose
The brain-seam is how hivemind (Node plugin) reaches wisearcher (Python research/knowledge engine).
It owns the brain's lifecycle and the graceful-degradation contract. NOT YET IMPLEMENTED — this
module records design intent from decisions 001 and 006.

> CANONICAL: interfaces below are PROPOSED (not in source yet) → marked [ASSUMED]/[MISSING_INFO].
> Switch to [EXPLICIT] with path:line once implemented.

## Decisions
- **Transport = MCP, out-of-process**: wisearcher runs as a stdio MCP server; hivemind is the client.
  One-way: plugin → brain. [INFERRED:strong] (decision 001)
- **Lifecycle owned by hivemind**: the plugin can `docker compose up` (Qdrant + Neo4j) and spawn the
  wisearcher MCP server; it checks health before use. [INFERRED:strong] (decision 006)
- **Graceful fallback**: if Docker / Voyage key / wisearcher are unavailable, fall back to the base's
  lightweight grep KB; research + graph features disable with a clear logged message; the rest of the
  loop still runs. [INFERRED:strong] (decision 006)

## Patterns
The `researcher` subagent's "KB-before-web" contract is satisfied by the brain instead of flat
markdown: it queries the graph first, researches only on a miss, and its findings flow back into the
canonical graph. [INFERRED:strong] (decision 002; base `agents/researcher.md`)

## Constraints
- Never cross the JS↔Python boundary except over MCP. [INFERRED:strong] (decision 001)
- Never block the session on a brain failure — degrade, log, continue. [INFERRED:strong] (decision 006)
- Never set `ANTHROPIC_API_KEY` when spawning the brain (it has its own subscription-CLI calls). [EXPLICIT] (`.claude/skills/claude-headless/SKILL.md`)

## Interfaces
Proposed MCP tool surface the brain must expose (exact names/shapes TBD in Phase 1):
- `research(mission)` — run a loop-until-dry research mission → cited claims into the graph. [ASSUMED]
- `kb_search(query)` / `kb_get(id)` / `kb_neighbors(id)` — read the canonical graph. [ASSUMED]
- `kb_ingest(node|claim)` — write hivemind's task/decision/skill nodes into the graph. [ASSUMED]
- Health/readiness probe for lifecycle management. [MISSING_INFO]

## Files
- `src/<brain-client>.js` — MCP client + lifecycle + fallback (to be created). [MISSING_INFO]
