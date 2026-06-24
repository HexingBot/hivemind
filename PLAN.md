# hivemind — PLAN

> Design-of-record for merging three tools into one agentic development framework.
> **Status: planning. No implementation has started — this document precedes code.**
> Build base: a full clone of `lordiwa/agent-framework` (MIT). Working branch: `feat/agentic`.
> Remotes: `origin` → `wisemancer/hivemind` (private), `upstream` → `lordiwa/agent-framework`.
>
> **The authority for design intent is the knowledge base in `.knowledge/`** (knowledge-mcp:
> `canonical/architecture.md` + `canonical/modules/` + `derived/conventions.md` + seven
> `derived/decisions/` records). `verify_knowledge` = PASS (17 files, 0 BLOCK). Read it via
> `read_knowledge_base`/`search_knowledge` before any code; this PLAN.md is the phased execution view of it.

## What hivemind is

One Claude Code plugin that **researches, specs, builds, verifies, and teaches** — fusing:

- **Body** — `agent-framework` (this base): orchestrator + developer/reviewer/researcher
  subagents, portable sessions, Jira-shaped tasks + kanban, drive-loop, plugin packaging.
- **Spine** — `wisengine`: calibrated markers + source tiering, language-agnostic manifests,
  observability (OTel→SigNoz) and minimalism standards, marker/tier validators. *Vendored in.*
- **Brain** — `wisearcher`: deep web/doc research → a cited Neo4j + Qdrant knowledge graph →
  generated skills + human lessons. *Called as an out-of-process MCP service.*

`proposal-engine` stays a **separate standalone app** (optional upstream producer of proposal KBs).

```
   proposal-engine ──(optional input: proposal KBs)──┐
   (standalone)                                       ▼
┌───────────────────────── hivemind (plugin) ─────────────────────────┐
│  BODY  : orchestrator · subagents · sessions · tasks+kanban · loop   │
│  SPINE : markers+tiers · manifests (tier-gated) · validators ·       │
│          OTel→SigNoz · minimalism                                    │
│  auth  : subscription CLI (claude -p, key stripped)                  │
└───────────────┬──────────────────────────────────────────────────────┘
                │ MCP (managed · graceful fallback)
                ▼
   wisearcher (BRAIN): research → CANONICAL Neo4j+Qdrant graph
   (hivemind reads AND writes via MCP, from session start) → skills + lessons
```

## Locked decisions

1. **Brain seam** = MCP service (out-of-process Python).
2. **Source of truth** = wisearcher's Neo4j+Qdrant graph; wired into hivemind via MCP from
   session start. hivemind's task/decision/skill nodes are written into that same graph;
   agent-framework's local `knowledge-graph.js` demotes to a thin cache/projection.
3. **Rigor** = tier-gated (scale to risk), reusing the `tdd`/`tests-after`/`uat-only` tiers.
4. **Claude auth** = subscription CLI (`claude -p`, `ANTHROPIC_API_KEY` stripped). Both base
   and brain already do this — they converge for free.
5. **Spine** = vendored into hivemind (implementation-engine logic, engine-tools validators,
   wisengine standards). **`proposal-engine` excepted — stays standalone.**
6. **Brain runtime** = hivemind manages wisearcher (`docker compose up` + spawn MCP) with
   **graceful fallback** to a lightweight grep KB when Docker/Voyage/wisearcher are absent.
7. **Repo strategy** = hivemind plugin is the front door; the rest are vendored libraries or
   called services.
8. **Name** = `hivemind`; repo `wisemancer/hivemind` (private), derived from MIT base.

## Mapping: diagram steps → where each part comes from

| # | Step | Source |
|---|------|--------|
| 1 | Set it up | Body (intake wizard + sessions) |
| 2 | Go learn everything | Brain (research engine) + Body (drive-loop) |
| 3 | Remember it (with proof) | Brain (graph) + Spine (markers/tiers) |
| 4 | Make a plan | Body (tasks + kanban) |
| 5 | Blueprint the hard stuff | Spine (manifests, tier-gated) |
| 6 | Build it | Body (developer + TDD) |
| 7 | Check it (fresh eyes) | Body (reviewer + tiers) + Spine (verifier) + Brain (adversarial refute) |
| 8 | Keep it visible & lean | Spine (OTel→SigNoz + minimalism) |
| 9 | Teach what it learned | Brain (skill + lesson generation) |
| 10 | Ship & share | Body (plugin packaging) + Spine (upstream sync) |

## Phased build

### Phase 0 — Identity & foundation
- Rebrand base: `agentic-framework` → `hivemind` (plugin.json, package.json, command
  namespace `/agentic-framework:` → `/hivemind:`, README).
- LICENSE + NOTICE in place (done). Baseline `vitest` suite green on `feat/agentic`.
- **Done when:** plugin installs as `hivemind`; existing tests pass; no behavior change yet.

### Phase 1 — Brain seam (the headline) ▶ first build slice
- Give wisearcher an **MCP server** exposing query + ingest tools (e.g. `kb_search`,
  `kb_neighbors`, `kb_get`, `kb_ingest`, `research`).
- hivemind **manages lifecycle** (`docker compose up`, spawn the MCP) with **graceful
  fallback** to the existing grep KB when the brain is unavailable (clear, logged message).
- Rewire the `researcher` subagent to call the brain; its `proposed_kb_entry` flows into the
  canonical graph instead of flat markdown.
- Write hivemind's task/decision/skill nodes into the canonical graph; make `knowledge-graph.js`
  a projection.
- **Done when:** a research question populates the cited graph and a ticket consumes it
  end-to-end; pulling the brain offline degrades gracefully.

### Phase 2 — Spine: truth on tasks
- Extend `tasks/schema.json` with `marker` + `source_tier` + `confidence` (components, not a
  scalar), populated from the brain's confidence model.
- Port `validate_markers` / `validate_tiers` (from `engine-tools-mcp`) into hivemind gates; the
  reviewer **blocks assumption laundering**.
- **Done when:** a ticket AC carries calibration and the reviewer blocks a laundered claim.

### Phase 3 — Spine: tier-gated spec layer
- Vendor implementation-engine's language-agnostic manifest skills (SCREEN_SPECS, API_CONTRACTS,
  STATE_SCHEMAS, COMPONENT_CATALOG, PROJECT_STRUCTURE, BLOCK_TASKS) as hivemind skills.
- Gate by `verification_tier`: core/`tdd` tickets generate/update the relevant manifest before
  code; `uat-only` glue skips it. Add the independent **verifier** role + coverage matrix.
- **Done when:** a core ticket emits a manifest before code; a glue ticket skips it.

### Phase 4 — Spine: observable & lean builds
- Inject the OTel→SigNoz span/log requirement and the Ponytail minimalism ladder into the
  developer + reviewer prompts.
- **Done when:** generated code emits spans/logs; the reviewer flags gold-plating.

### Phase 5 — Brain: wisdom output
- Wire wisearcher's skill generation + teaching layer: knowledge clusters → loadable `SKILL.md`
  for agents, and grounded human lessons (spaced retrieval).
- **Done when:** a knowledge cluster yields a `SKILL.md` and a lesson.

### Phase 6 — Autonomy & distribution polish
- Outer drive-loop wraps inner loop-until-dry research; wisengine phase/consolidation gates
  become first-class hard-stops in the loop.
- esbuild packaging bootstraps the brain; wire `upstream_push`-style contribution back to the
  template.
- **Done when:** an autonomous run respects the hard-stops and the plugin installs clean.

## Cross-cutting
- **Auth:** subscription CLI everywhere; never set `ANTHROPIC_API_KEY` in spawned envs.
- **Testing:** keep vitest two-tier + the dist-parity gate; add brain-fallback tests with fakes.
- **Polyglot:** JS/TS plugin ↔ Python brain only over MCP; no other coupling.
- **Degradation:** every brain-dependent feature must have a defined offline behavior.

## Open questions (resolve as we go)
- Exact MCP tool surface for the brain (query + ingest contract).
- How proposal-engine's KBs feed hivemind's graph (import path / format).
- Where SigNoz/OTel config lives for generated projects vs hivemind itself.
- Empirical tuning still pending in wisearcher (entity-resolution thresholds, load-bearing
  trigger) — inherited, not introduced here.

## First action
Phase 0 rebrand, then Phase 1 brain seam (the chosen first vertical slice). No code until this
plan is accepted.
