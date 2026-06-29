---
module: conventions
layer: derived
tier: T2
updated: 2026-06-24
files: []
---

## Purpose
Coding standards and patterns for hivemind. These rules apply to all source files and are
non-negotiable. The Body source is present; Spine standards are vendored from
`implementation-engine/.claude/shared/` and the Brain is reached over MCP (see [[architecture]],
[[brain-contract]]).

## Agent Workflow
- **Knowledge-first — no code without a plan**: Before suggesting or writing any code, write or
  update the relevant `.knowledge/` files and call `write_plan` to produce `PLAN.md`. Hard gate.
- **Knowledge base only**: During planning, read `.knowledge/` via `read_knowledge_base` and
  `search_knowledge`. Never read raw source for planning. Source is for the compiler.
- **Observability is non-negotiable**: Every feature defines its logging/tracing/metrics in
  `.knowledge/` before implementation. No code for an unobserved feature.
- **Docker over local installs**: The brain runs via `docker compose up`. Never suggest host installs.

## Observability
Target stack: **OpenTelemetry → SigNoz**. The binding standard already exists at
`implementation-engine/.claude/shared/OBSERVABILITY.md` (every functionality emits a span +
structured log; metric on key paths; **reviewer BLOCKER** if missing) and is **vendored into
hivemind with the Spine** (Phase 4). [INFERRED:strong]

**Config lives in three distinct places** (resolves the PLAN.md open question):
1. **hivemind's own observability** (plugin startup, agent-loop iterations, MCP calls to the brain,
   tier gates) — config in the plugin; follows the vendored Spine standard, **does not invent a new
   convention**. Spans around each loop iteration / brain call / gate; structured JSON logs that
   record **brain-hit vs grep-KB fallback**; levels: `error` failed gate, `warn` fallback
   activation, `info` phase/consolidation transitions. [INFERRED:strong]
2. **Generated projects' observability** — governed by the same `OBSERVABILITY.md`, **injected into
   the developer + reviewer prompts and manifests** (BLOCK_TASKS ACs name the span); the config
   lives in the **generated project**, not in hivemind. Phase 4. [INFERRED:strong]
3. **The Brain (wisearch)** — owns its own observability: `wisearch/obs.py` uses `structlog`
   JSON + metric-as-event helpers (`counter/histogram/gauge`); OTel **tracing is deliberately
   deferred** there ("not required at current scale"). [INFERRED:strong] (signal:
   `wisearch/wisearch/obs.py:9`) hivemind consumes its structured logs over the seam; it does
   **not** impose OTel tracing on the brain.

**Metrics** hivemind emits: tickets-by-tier, brain-hit vs fallback, gate blocks (assumption
laundering), research rounds-until-dry. [INFERRED:weak]
**Deployment**: no SigNoz / OTel collector is in any `docker-compose` yet (greenfield); when added,
extend the brain stack's compose file (Phase 6 packaging). [INFERRED:strong] (signal:
`wisearch/docker-compose.yml` has only qdrant + neo4j)

## Patterns
- **Marker discipline**: every claim carries a calibrated marker; markers must survive downstream
  (dropping one = assumption laundering, [[meta/guardrails]] KG2). [INFERRED:strong]
- **Source tiering**: `[EXPLICIT]` requires T1/T2; never raise a claim above its file's `tier`
  ([[meta/source-tiers]]). [INFERRED:strong]
- **Tier-gated rigor**: `tdd` / `tests-after` / `uat-only` by risk; core tickets emit a manifest
  before code, glue skips it. [INFERRED:strong]
- **Manifests before code on core tickets**: SCREEN_SPECS, API_CONTRACTS, STATE_SCHEMAS,
  COMPONENT_CATALOG, PROJECT_STRUCTURE, BLOCK_TASKS (Phase 3). [INFERRED:strong]
- **Minimalism ladder (Ponytail)**: the 6-rung hierarchy in
  `implementation-engine/.claude/shared/MINIMALISM.md`; reviewer flags gold-plating as a
  first-class blocker. [INFERRED:strong]
- **Graceful degradation**: every brain-dependent feature has a defined offline path; the brain has
  no internal fallback, so hivemind owns it (see [[brain-contract]] § fallback). [INFERRED:strong]
- **Error handling**: fail gates loudly (block the ticket), fail the brain seam softly (fall back).

## Decisions
- **Subscription CLI auth, never API keys**: spawn `claude -p` with `ANTHROPIC_API_KEY` stripped. [INFERRED:strong]
- **Vendored Spine, called Brain**: Spine code in-tree; Brain only over MCP. [INFERRED:strong]
- **Canonical graph over local cache**: write nodes to wisearch's graph; `knowledge-graph.js` is
  a projection. [INFERRED:strong]
- **Import, don't vendor, proposal KBs**: see [[proposal-import]]. [INFERRED:strong]

## Constraints
- Never set `ANTHROPIC_API_KEY` in any spawned environment.
- Never couple plugin↔brain by anything other than MCP.
- Never ship a brain-dependent feature without a tested offline fallback.
- Always keep the vitest two-tier suite + dist-parity gate green; add brain-fallback tests with fakes.
- Never vendor `proposal-engine`; never re-extract a marked proposal claim (preserve its marker).

## Files
```
src/            — Body: orchestrator, subagents, sessions, tasks/kanban, drive-loop (PRESENT)
  mcp-server.js — base Node stdio MCP (task-store backend)
  knowledge-graph.js — local graph; demotes to a projection over the canonical graph
  drive-loop.js — outer autonomy loop
tasks/schema.json — Jira-shaped tickets (gain marker + source_tier + confidence in Phase 2)
src/spine/      — vendored Spine: markers/tiers, manifest skills, validators, observability (TO ADD)
```
[INFERRED:strong] (src/* verified present; src/spine/ is the planned vendor target)
