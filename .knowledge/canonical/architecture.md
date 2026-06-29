---
module: architecture
layer: canonical
tier: T1
updated: 2026-06-24
files: [src/drive-loop.js, src/mcp-server.js, src/knowledge-graph.js, src/task-store.js, tasks/schema.json, package.json]
---

## Purpose
hivemind is one Claude Code plugin that **researches, specs, builds, verifies, and teaches** —
a single agentic development framework fusing three tools into a Body / Spine / Brain whole.
It exists to collapse the proposal→implementation→knowledge loop into one front door that
scales rigor to risk and grounds every claim in a cited knowledge graph.

> **SOURCE STATE (2026-06-24).** The **Body** (agent-framework base) is fully present in this
> repo on branch `feat/agentic` — `src/*`, `tasks/`, `package.json` are real, citable source
> (`[EXPLICIT]` allowed). The **Spine** (wisengine standards) is **not yet vendored** and the
> **Brain** (wisearch) is **not yet wired** — claims about those integrations are design intent
> from PLAN.md, capped at `[INFERRED:strong]`. wisearch and proposal-engine are real source in
> *sibling* repos, not under this tree; claims they ground are `[INFERRED:strong]` citing the
> external path as the *signal*, never `[EXPLICIT]` (an EXPLICIT claim must cite an in-repo
> `path:line`). See [[meta/source-tiers]].

## Decisions
The eight locked decisions (signal: PLAN.md § "Locked decisions"):

- **Three-part fusion**: Body = `agent-framework` (orchestrator + developer/reviewer/researcher
  subagents, portable sessions, Jira-shaped tasks + kanban, drive-loop, plugin packaging) —
  present at `src/drive-loop.js`, `src/task-store.js`, `tasks/schema.json` [EXPLICIT]; Spine =
  `wisengine` standards, **vendored in** [INFERRED:strong]; Brain = `wisearch`, **called as an
  out-of-process MCP service** [INFERRED:strong].
- **Brain seam = MCP service** (out-of-process Python); polyglot coupling is MCP-only. The base
  already ships a Node stdio MCP server at `src/mcp-server.js` [EXPLICIT]; the brain MCP is a
  **separate Python server that does not yet exist** — wisearch is a library + CLI today
  [INFERRED:strong] (signal: `wisearch/wisearch/cli.py`) — so Phase 1 builds it. See [[brain-contract]].
- **Source of truth = wisearch's Neo4j+Qdrant graph**, wired in from session start; hivemind's
  task/decision/skill nodes are written into that same graph, and the base's
  `src/knowledge-graph.js` demotes to a thin cache/projection. [INFERRED:strong]
- **Rigor is tier-gated** (scale to risk), reusing the `tdd` / `tests-after` / `uat-only` tiers. [INFERRED:strong]
- **Claude auth = subscription CLI** (`claude -p`, `ANTHROPIC_API_KEY` stripped). Both base and
  wisearch already shell out to the local `claude` CLI rather than an SDK. [INFERRED:strong]
- **Spine is vendored** into hivemind; **`proposal-engine` is excepted — stays a standalone app**
  (optional upstream producer of proposal KBs, imported per [[proposal-import]]). [INFERRED:strong]
- **Brain runtime is managed by hivemind** (`docker compose up` + spawn MCP) with **graceful
  fallback** to a lightweight grep KB. This matters because wisearch has **no internal
  fallback** — Voyage/Neo4j/Qdrant are hard deps that raise on absence [INFERRED:strong] (signal:
  `wisearch/wisearch/embed.py`, `store/qdrant_store.py`); the fallback is entirely hivemind's
  responsibility at the MCP-client boundary. [INFERRED:strong]
- **Repo strategy**: the hivemind plugin is the front door; everything else is a vendored library
  or a called service. Repo `wisemancer/hivemind` (private), `upstream` = lordiwa/agent-framework.
  [INFERRED:strong] (signal: `git remote -v`)

## Patterns
Primary data flow (signal: PLAN.md diagram + verified component presence):

```
proposal-engine ──(optional input: proposal KBs, see proposal-import)──┐
(standalone)                                                           ▼
┌───────────────────── hivemind (plugin, this repo) ───────────────────┐
│ BODY  : orchestrator · subagents · sessions · tasks+kanban · loop    │ ← src/* present
│ SPINE : markers+tiers · manifests (tier-gated) · validators ·        │ ← to vendor
│         OTel→SigNoz · minimalism                                     │
│ auth  : subscription CLI (claude -p, key stripped)                   │
└───────────────┬───────────────────────────────────────────────────────┘
                │ MCP (managed · graceful fallback to grep KB)
                ▼
   wisearch (BRAIN): research → CANONICAL Neo4j+Qdrant graph
   (Entity / Source / Claim nodes; CITES / MENTIONS / RELATION edges;
    decomposed ConfidenceComponents) → skills + lessons
```

The brain seam is the headline first build slice (Phase 1): a research question populates the
cited graph and a ticket consumes it end-to-end; pulling the brain offline degrades to grep. [INFERRED:strong]

## Constraints
- **Never set `ANTHROPIC_API_KEY` in spawned envs** — subscription CLI auth everywhere. [INFERRED:strong]
- **Polyglot coupling is MCP-only**: JS/TS plugin ↔ Python brain communicate solely over MCP. [INFERRED:strong]
- **Every brain-dependent feature must define an offline behavior** — the brain has no internal
  fallback, so hivemind must probe health and degrade, logged at `warn`. [INFERRED:strong]
- **`proposal-engine` must not be vendored** — it remains a separate standalone app. [INFERRED:strong]
- **Never overwrite the canonical graph from a projection** — `src/knowledge-graph.js` is a cache. [INFERRED:weak]

## Tech Stack
- **JS/TS** — the plugin/Body, tested with vitest (two-tier + dist-parity gate), packaged with
  esbuild. `package.json`, `vitest.config.js`, `src/bundle.js` present. [EXPLICIT]
- **Python 3.11+** — the Brain (wisearch), today a library + CLI; gains an MCP server in Phase 1.
  [INFERRED:strong] (signal: `wisearch/pyproject.toml`)
- **Neo4j + Qdrant** — the canonical knowledge graph; defined in wisearch's `docker-compose.yml`. [INFERRED:strong]
- **Voyage embeddings (`voyage-3`)** — brain embedding provider; absence raises, triggering the
  hivemind-side grep fallback. [INFERRED:strong] (signal: `wisearch/wisearch/embed.py`)
- **OTel → SigNoz** — observability target; standard already written at
  `implementation-engine/.claude/shared/OBSERVABILITY.md` (to vendor). See [[conventions]] § Observability. [INFERRED:strong]
- **MCP (stdio)** — the only seam between plugin and brain; base MCP server uses
  `@modelcontextprotocol/sdk` at `src/mcp-server.js`. [INFERRED:strong]
