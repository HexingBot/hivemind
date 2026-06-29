---
module: brain-contract
layer: derived
tier: T2
updated: 2026-06-24
files: []
---

## Purpose
The MCP tool contract for the **Brain seam** (Phase 1 headline). hivemind calls wisearch as an
out-of-process MCP service. This file resolves PLAN.md open question *"Exact MCP tool surface for
the brain (query + ingest contract)."* It is grounded in wisearch's **real** library functions
(in the sibling repo `wisearch/`); the MCP server wrapping them **does not exist yet** and is
built in Phase 1. So every claim here is `[INFERRED:strong]` — tool names/shapes are design, and
the wrapped capabilities cite wisearch source as their *signal* (external repo, not an in-repo
`path:line`, so not EXPLICIT). See [[meta/source-tiers]].

## Where the server lives
A **Python MCP (stdio) server inside wisearch**, wrapping the engine library. [INFERRED:strong]
(PLAN.md Phase 1: "Give wisearch an MCP server".) wisearch is currently a pure library + CLI
with **no server** — entry point `wisearch/wisearch/cli.py:28`. hivemind manages its lifecycle
(`docker compose up` for Neo4j+Qdrant, then spawn the MCP) and owns the fallback. [INFERRED:strong]

## Tool surface
All `[INFERRED:strong]` — design names wrapping the cited wisearch function:

| Tool | Params | Returns | Wraps (signal: wisearch) |
|------|--------|---------|----------------------------|
| `kb_search` | `topic, query, top_k=8, min_score=0.0` | `[{text, source_id, origin, title, score}]` | `Retriever.retrieve()` `query/retrieve.py:30` — dense vector search |
| `kb_answer` | `topic, question, top_k=8, min_score=0.3` | `{text, grounded, citations[]}` | `answer_question()` `query/answer.py:41` — grounded synthesis |
| `kb_neighbors` | `canonical_id` | `[canonical_id]` (one RELATION hop) | `Neo4jGraphStore.neighbors()` `store/graph_store.py:131` |
| `kb_get` | `name, type?` | `{canonical_id, canonical_name, type, aliases[], description, source_ids[], topics[]} \| null` | `find_entity_by_alias()` `store/graph_store.py:121` |
| `kb_ingest` | `topic, origin, kind:"web"\|"file"` | `{admitted, source_id, chunks, claims}` | `ingest_file()`/`ingest_url()` (CLI `cli.py:119`) |
| `research` | `topic, mission, max_sources=8, model="sonnet"` | `ResearchResult` (sources + grounded answer) | `research_topic()` `research.py:41` — web research loop |
| `kb_assert` | `topic, text, type, marker, source_tier, source_ref` | `{claim_id}` | `upsert_source/upsert_entity/upsert_claim` `store/graph_store.py:53-104` — hivemind's own nodes |
| `kb_health` | — | `{neo4j, qdrant, voyage, ok}` | `Neo4jGraphStore` connectivity check `store/graph_store.py:32`; CLI exits 2 on fail `cli.py:89` |

## Writing hivemind's own nodes (decision 2)
hivemind's task/decision/skill nodes go into the **same** canonical graph, not a side store.
Map each onto the existing schema rather than inventing node labels: an **Entity** with
`type ∈ {Task, Decision, Skill}`, plus a **Claim** carrying its assertion, **CITES** a Source =
the hivemind session, and **MENTIONS** related entities. [INFERRED:strong] This reuses
`kb_assert` and keeps one MCP surface. The base's `src/knowledge-graph.js` (`addNode/addEdge/
neighbors/nodesByType`) becomes a **read-through projection/cache** over this graph.

## Confidence model (feeds Phase 2)
wisearch already stores **decomposed** confidence, not a scalar — `ConfidenceComponents`
(`source_credibility, assertion_strength, corroboration, verification_status`) [INFERRED:strong]
(signal: `wisearch/wisearch/extract/models.py:80`). This is exactly PLAN.md Phase 2's
"confidence (components, not a scalar)". The Spine `marker` + `source_tier` map onto it:
marker→`assertion_strength` (ASSERTED/HEDGED), tier→`source_credibility`,
corroboration/verification from the graph. [INFERRED:strong]

## Error & fallback semantics (non-negotiable)
wisearch has **no internal fallback** — `embed.py:56` raises `ConfigError` without
`VOYAGE_API_KEY`; Qdrant/Neo4j ops raise typed `StoreError`. [INFERRED:strong] (signal: wisearch
source). Therefore:
- hivemind probes `kb_health` **at session start**. If not `ok` → enter **grep-KB fallback mode**,
  logged once at `warn` (never silent). [INFERRED:strong]
- Every brain tool call is wrapped client-side: a transport error or `StoreError`/`ConfigError`
  degrades that operation to the grep KB and logs it. The loop never crashes on a brain outage.
- `kb_ingest`/`research`/`kb_assert` in fallback mode queue or no-op with a logged warning; reads
  fall back to grep over the flat KB.

## Open (deferred to build)
- Streaming vs request/response for `research` (long-running). [MISSING_INFO]
- Whether `kb_assert` should run wisearch's verification pipeline or write a raw asserted claim. [INFERRED:weak]
