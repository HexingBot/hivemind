---
module: architecture
layer: canonical
tier: T1
updated: 2026-06-24
files: [.claude/agents/, src/mcp-server.js, src/knowledge-graph.js, tasks/schema.json, .mcp.json]
---

## Purpose
hivemind is a single Claude Code plugin that takes a software goal from research to shipped,
verified, observable code — and teaches what it learned. It fuses three tools: the **Body**
(agent-framework, this repo's base — orchestration, sessions, tasks, dev loop), the **Spine**
(wisengine — epistemic discipline + language-agnostic specs), and the **Brain** (wisearcher —
deep research → a cited knowledge graph → skills + lessons). It is a derivative of
agent-framework (MIT). [EXPLICIT] (`NOTICE.md`, `LICENSE`)

> CANONICAL layer: claims about the *base* cite real source and use [EXPLICIT].
> Claims about the *merge* (not yet built) are design intent from the locked decisions in
> `derived/decisions/` — marked [INFERRED:strong] (decided, not yet coded) or [ASSUMED].

## Decisions
- **Body = agent-framework base**: the main thread is the Orchestrator; it delegates to
  `developer`, `reviewer`, `researcher` subagents. [EXPLICIT] (`.claude/agents/`, `CLAUDE.md`)
- **Brain seam = MCP service (out-of-process Python)**: hivemind calls wisearcher as an MCP
  server; no in-process coupling across the JS/Python boundary. [INFERRED:strong] (decision 001)
- **Single source of truth = wisearcher's Neo4j+Qdrant graph**: wired into the orchestrator and
  subagents via MCP from session start; hivemind's own task/decision/skill nodes are written
  into that same canonical graph. [INFERRED:strong] (decision 002)
- **Rigor is tier-gated**: full markers/specs/research on core work, light touch on glue —
  reusing the base's `tdd`/`tests-after`/`uat-only` verification tiers. [INFERRED:strong] (decision 003)
- **Claude auth = subscription CLI** (`claude -p`, `ANTHROPIC_API_KEY` stripped). Both base and
  brain already do this. [EXPLICIT] (`.claude/skills/claude-headless/SKILL.md`, `tests/orchestrator-bridge.spec.js`)
- **Spine is vendored in**; `proposal-engine` stays a standalone app. [INFERRED:strong] (decision 005)

## Patterns
Primary lifecycle of one unit of work (the 10 steps; source organ in brackets):

```
[Body]  intake/session ─► [Brain] research (loop-until-dry) ─► [Brain+Spine] cited graph (+markers)
   ─► [Body] ticket ─► [Spine] spec/manifest (tier-gated) ─► [Body] build (TDD)
   ─► [Body+Spine+Brain] review/verify ─► [Spine] observe+lean ─► [Brain] skills+lessons
   ─► [Body+Spine] ship & upstream
```

Cross-boundary calls go ONE way over MCP: the JS/TS plugin (client) → wisearcher (Python MCP
server). The plugin manages the brain's lifecycle (`docker compose up` + spawn) and degrades
gracefully to a lightweight grep KB when the brain is unavailable. [INFERRED:strong] (decisions 001, 006)

## Constraints
- Never set `ANTHROPIC_API_KEY` in any spawned subprocess env — it overrides subscription auth
  and bills API rates. [EXPLICIT] (`.claude/skills/claude-headless/SKILL.md`)
- Never read raw project source during planning; read `.knowledge/` instead (this KB's gate).
- The JS↔Python boundary is crossed ONLY over MCP — no other transport, no shared process.
- Every brain-dependent feature MUST define an offline (brain-absent) behavior. [INFERRED:strong] (decision 006)

## Tech Stack
- **Plugin runtime**: Node.js (esbuild-bundled `dist/*.cjs`), distributed as a Claude Code
  plugin. [EXPLICIT] (`package.json`, `.claude-plugin/plugin.json`)
- **Brain**: Python (wisearcher), Qdrant + Neo4j via Docker, Voyage `voyage-3` embeddings —
  called over MCP. [INFERRED:strong] (decision 001; wisearcher's own KB)
- **Reasoning**: Claude via subscription CLI — Haiku for bulk, Opus for synthesis/adjudication
  and the reviewer gate. [EXPLICIT] (`CLAUDE.md` per-agent model assignment)
