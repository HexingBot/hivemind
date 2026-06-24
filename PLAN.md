# hivemind — PLAN

> Design-of-record for merging three tools into one agentic development framework.
> **Status: planning. No implementation has started — this document precedes code.**
> Build base: a full clone of `lordiwa/agent-framework` (MIT). Working branch: `feat/agentic`.
> Remotes: `origin` → `wisemancer/hivemind` (private), `upstream` → `lordiwa/agent-framework`.

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

#### Phase 1 — build breakdown (active)
Architecture is settled in `.knowledge/derived/brain-contract.md`: **one** wisearcher MCP server
(single backend), consumed two ways — the `researcher` subagent calls its tools directly (via
`.mcp.json`); hivemind's own Node code calls it through a JS client that wraps every call with
graceful grep-fallback. Sub-slices, in dependency order (each lands behind tests):

- **P1.1 — wisearcher MCP server** (in `wisearcher/`, Python). `wisearcher/mcp_server.py`: a
  `build_engine(cfg)` helper (extracted from the cli wiring) + tool functions `kb_search`,
  `kb_answer`, `kb_neighbors`, `kb_get`, `kb_ingest`, `research`, `kb_assert`, `kb_health`
  wrapping the library; a thin stdio MCP shell over the `mcp` SDK; a `wisearcher-mcp` entrypoint.
  Tool logic lives in plain injectable functions → unit-tested with `tests/fakes.py` (no
  Docker/Voyage). Adds the `mcp` dependency.
- **P1.2 — hivemind brain-client** (`src/brain-client.js`): connects to the wisearcher MCP via
  `@modelcontextprotocol/sdk` Client + a stdio transport (injectable for tests); probes
  `kb_health`; wraps every call so a brain error/absence **falls back to the grep KB**
  (`lookupKnowledge`/`recordKbReuse` in `src/knowledge.js`); emits `brain-query|brain-hit|
  brain-fallback` events (the preview-process subscriber pattern) and a `warn` log on fallback.
  Vitest with a fake transport — the non-negotiable safety property, fully verifiable in-repo.
- **P1.3 — lifecycle/launcher** ✓: `bin/brain-launch.js` (zero-dep) resolves the wisearcher repo
  at runtime (`WISEARCHER_PATH` or sibling discovery), `docker compose up -d`s the brain stack
  (best-effort), then execs `wisearcher-mcp` over stdio — or prints `kb_health` JSON with
  `--health`. `ANTHROPIC_API_KEY` is stripped from the child env. `/hivemind:brain` command
  brings it up + reports brain-on vs grep-fallback. **Deferred to P1.4:** whether to *also*
  register the brain as a second managed server in committed `.mcp.json` — the wisearcher path
  can't be a committed `${CLAUDE_PLUGIN_ROOT}` constant and it would break the deliberate
  single-server invariant, so the choice (subagent calls via brain-client launcher vs static
  registration) is made when the researcher is rewired.
- **P1.4 — rewire researcher** ✓: `agents/researcher.md` (+ the byte-identical `.claude/agents/`
  copy) now does brain-first lookup (`kb_answer`/`kb_search`/`kb_neighbors`/`kb_get`, tools
  `mcp__wisearcher-brain__*`) with the grep three-pass as the guaranteed offline fallback;
  `proposed_kb_entry` is committed by the Orchestrator into the canonical graph
  (`kb_ingest`/`kb_assert`) when the brain is up, else flat markdown. **Registration decision
  (resolved):** the brain is NOT statically registered in committed `.mcp.json` — it is optional,
  heavy (Docker + Voyage), and degrades gracefully, so an always-on second server would spawn and
  noisily fail on every session. It stays opt-in (`/hivemind:brain` + brain-client launcher); the
  researcher uses brain tools only when a human has registered them. Revisit for Phase 6
  distribution if a packaged always-on brain is wanted.
- **P1.5 — nodes into the graph** ✓: `src/graph-sync.js` is the seam — `recordNode()` writes the
  local projection (`knowledge-graph.js`) AND mirrors the node to the canonical graph via
  `kb_assert` (best-effort, queued offline), and `neighborsCanonicalFirst()` reads canonical-first
  with local fallback. brain-client gained `neighbors`/`get`. `src/knowledge-graph.js` is now
  documented (graphify skill, both mirrors) as a read-through **projection/cache**. Call-site
  wiring is prompt-driven via the graphify skill (no single code call-site exists today).

**Phase 1 status: all five sub-slices complete and unit-verified with fakes** (wisearcher suite
83 passed; hivemind 539 default / 1132 full). The Done-when end-to-end check — a research question
populating the cited graph + a ticket consuming it, with offline degradation — needs a live run
(Docker Neo4j+Qdrant + `VOYAGE_API_KEY`); the graceful-fallback half is already proven in unit tests.

### Phase 2 — Spine: truth on tasks
- Extend `tasks/schema.json` with `marker` + `source_tier` + `confidence` (components, not a
  scalar), populated from the brain's confidence model.
- Port `validate_markers` / `validate_tiers` (from `engine-tools-mcp`) into hivemind gates; the
  reviewer **blocks assumption laundering**.
- **Done when:** a ticket AC carries calibration and the reviewer blocks a laundered claim.

#### Phase 2 — build breakdown
Calibration is carried the way the rest of the system does it — **inline markers in prose**
(AC text), not a breaking `string[]`→`object[]` schema change. Sub-slices:

- **P2.1 — port the validators**: `src/calibration.js` ports `validate_markers`,
  `validate_marker_forwarding` (the assumption-laundering BLOCKER: an `[ASSUMED]`/`[INFERRED:weak]`
  claim in the source that loses its marker downstream), and `validate_tiers` (tier→marker ceiling:
  T3/T4 can't be `[EXPLICIT]`, T4 can't be `[INFERRED]`, TX rejected) from `engine-tools-mcp` —
  pure text functions, no deps. Unit-tested.
- **P2.2 — calibration on tasks**: extend `tasks/schema.json` with OPTIONAL task-level `marker`,
  `source_tier` (T1–T4/TX), and `confidence` (the decomposed components from the brain model, not a
  scalar) — additive, existing tickets stay valid. ACs may carry inline markers; `create_task`
  (task-store + mcp-server) accepts/validates them.
- **P2.3 — reviewer gate**: update `agents/reviewer.md` (both mirrors) to run the calibration
  validators and **BLOCK assumption laundering** + tier-ceiling violations as HIGH findings.
- **Done when:** a ticket AC carries calibration and the reviewer blocks a laundered claim.

**Phase 2 status: complete.** `src/calibration.js` + `bin/check-calibration.js` (`npm run
check:calibration`) port the validators; `tasks/schema.json` carries optional `marker` +
`source_tier` + decomposed `confidence` (threaded through `createTask`/MCP `create_task`); the
reviewer runs the gate and blocks laundering + tier-ceiling. Unit + e2e verified (test:all 1160).

### Phase 3 — Spine: tier-gated spec layer
- Vendor implementation-engine's language-agnostic manifest skills (SCREEN_SPECS, API_CONTRACTS,
  STATE_SCHEMAS, COMPONENT_CATALOG, PROJECT_STRUCTURE, BLOCK_TASKS) as hivemind skills.
- Gate by `verification_tier`: core/`tdd` tickets generate/update the relevant manifest before
  code; `uat-only` glue skips it. Add the independent **verifier** role + coverage matrix.
- **Done when:** a core ticket emits a manifest before code; a glue ticket skips it.

#### Phase 3 — build breakdown
The manifest skills are self-contained prompt commands in `implementation-engine/.claude/commands/
impl-*.md`; the verifier is `manifest-verifier` + `scripts/verify_manifests.mjs` (zero-dep, 6
invariants → coverage matrix). impl-engine gates by Category(A/B/C); hivemind gates by its own
`verification_tier` instead. Sub-slices:

- **P3.1 — tier-gate policy** ▶ *first slice*: `src/manifest-policy.js` — the catalog of the six
  manifests + `requiresManifest(verification_tier)` (tdd/tests-after require a manifest before
  code; `uat-only` glue skips) + `gateForTicket()`. The orchestrator/reviewer consult it. Unit-tested.
- **P3.2 — vendor the six manifest skills**: copy `impl-screen-specs|api-contracts|state-schemas|
  component-catalog|project-structure|block-tasks` into hivemind skills (`skills/` + `.claude/skills/`
  byte-identical mirrors), adding `name`/`description` frontmatter and repointing `context/`→the
  project's KB paths. Per-skill parity locks.
- **P3.3 — verifier + coverage matrix**: port `verify_manifests.mjs` into `scripts/` + a testable JS
  module of the six invariants; vendor the `manifest-verifier` agent (both mirrors); emit a VERIFY
  matrix. Independent of the (judgement-based) reviewer.
- **Done when:** a `tdd` ticket is gated to emit a manifest before code; a `uat-only` ticket skips.

**Phase 3 status: complete.** P3.1 `src/manifest-policy.js` (tier gate) + P3.2 the six vendored
manifest skills (both mirrors) + P3.3 `src/manifest-verify.js` + `scripts/verify-manifests.mjs`
(`npm run check:manifests`, writes `reviews/VERIFY.md`) + the `manifest-verifier` skill. The gate
decides required-vs-skip by `verification_tier`; the skills emit manifests; the verifier checks
coverage independently of the reviewer. Unit + CLI verified (test:all 1196).

### Phase 4 — Spine: observable & lean builds
- Inject the OTel→SigNoz span/log requirement and the Ponytail minimalism ladder into the
  developer + reviewer prompts.
- **Done when:** generated code emits spans/logs; the reviewer flags gold-plating.

#### Phase 4 — build breakdown
- **P4.1 — vendor the standards**: copy `.claude/shared/OBSERVABILITY.md` (OTel→SigNoz; span +
  correlated structured log on every functionality, metric on key paths only) and `MINIMALISM.md`
  (Ponytail 6-rung ladder + "no invented detail") from implementation-engine into hivemind
  `.claude/shared/`. Doc-existence + content locks.
- **P4.2 — inject into the agents**: `agents/developer.md` (both mirrors) gains an "Observability &
  minimalism" step — instrument each functionality with a span + correlated structured log (metric
  on key paths), and walk the minimalism ladder before adding anything. `agents/reviewer.md` (both
  mirrors) flags a **missing span/log as a BLOCKER** and **gold-plating / unsourced complexity as a
  HIGH** (minimalism "what can be removed?"). Prose locks.
- **Done when:** the developer prompt requires spans/logs; the reviewer flags gold-plating.

**Phase 4 status: complete.** `.claude/shared/OBSERVABILITY.md` + `MINIMALISM.md` vendored; the
developer prompt (both mirrors) requires a span + correlated structured log per functionality
(metric on key paths) and walks the Ponytail ladder; the reviewer (both mirrors) blocks missing
observability and flags gold-plating as HIGH. Prose-locked (test:all 1200).

### Phase 5 — Brain: wisdom output
- Wire wisearcher's skill generation + teaching layer: knowledge clusters → loadable `SKILL.md`
  for agents, and grounded human lessons (spaced retrieval).
- **Done when:** a knowledge cluster yields a `SKILL.md` and a lesson.

#### Phase 5 — build breakdown
**Scope reality (verified):** wisearcher's skill/teach layers are `[ASSUMED]` design docs only —
no code exists. Phase 5 **builds** them (minimal-viable), it does not wire existing features. Full
community-detection clustering is wisearcher's Phase 3 (deferred) — a "cluster" here is an entity's
neighbourhood (its claims + neighbours), which is enough for the Done-when.

- **P5.1 — the generator** (in `wisearcher/`, Python) ▶ *first slice*: `wisearcher/wisdom.py` —
  `build_cluster(graph, name)` (entity + neighbours + claims, split into AFFIRMS / `ANTI_PATTERN`+
  `EXCLUDES` / `CONTRASTS_WITH`+`MISCONCEPTION` + source ids); `generate_skill(cluster, complete)`
  (LLM prose for how-to + a **deterministic, cited** "When NOT to use" section + Sources — so the
  provenance/anti-pattern rule is testable without a live LLM); `generate_lesson(cluster, complete,
  mission)` (mission-grounded body + deterministic discriminating quiz + Sources). `complete` and
  `graph` injectable → unit-tested with fakes.
- **P5.2 — expose + consume**: add `kb_generate_skill` / `kb_generate_lesson` to the wisearcher MCP;
  hivemind writes the generated `SKILL.md` into `.claude/skills/<name>/` and the lesson into a
  lessons dir, via the brain-client (with graceful fallback).
- **Done when:** a cluster yields a `SKILL.md` (with a cited "when NOT to use") and a lesson.

**Phase 5 status: complete (built from scratch).** wisearcher gained `wisdom.py` (build_cluster +
generate_skill/lesson) + MCP tools `kb_generate_skill`/`kb_generate_lesson`; hivemind's brain-client
gained `generateSkill`/`generateLesson` and `src/wisdom-sink.js` `persistWisdom` writes the
generated `SKILL.md` into `.claude/skills/<slug>/` and the lesson into `knowledge/lessons/`, skipping
gracefully when the brain is down. Unit-verified both sides (wisearcher 91; hivemind test:all 1208).
Live end-to-end needs Docker + Voyage + `claude` CLI.

### Phase 6 — Autonomy & distribution polish
- Outer drive-loop wraps inner loop-until-dry research; wisengine phase/consolidation gates
  become first-class hard-stops in the loop.
- esbuild packaging bootstraps the brain; wire `upstream_push`-style contribution back to the
  template.
- **Done when:** an autonomous run respects the hard-stops and the plugin installs clean.

#### Phase 6 — build breakdown
The drive-loop is pure helpers (`selectNextTicket`/`shouldStop`/…) driven by `commands/loop.md`,
with 4 documented hard-stop gates (all default OFF). No phase/consolidation hard-stop and no
loop-until-dry exist yet.

- **P6.1 — autonomy** ▶ *first slice*: `src/drive-loop.js` gains `consolidationGate({completedThisRun,
  consolidateEvery,autoConsolidate})` — a first-class phase/consolidation hard-stop (pause every
  N completed tickets for human consolidation; conservative by default, lifted only via
  `auto_consolidate`, mirroring the loop_auth gates) — and `loopUntilDry({runRound,maxDryRounds,
  maxRounds})` for the inner research loop. Unit-tested; `commands/loop.md` references them as the
  consolidation checkpoint.
- **P6.2 — distribution**: ensure `bin/brain-launch.js` ships and a bootstrap brings the brain up on
  install (esbuild packaging); wire an engine-only `upstream_push`-style contribution path back to
  `lordiwa/agent-framework` (the MIT template).
- **Done when:** an autonomous run respects the hard-stops (incl. consolidation) and the plugin
  installs clean.

## Cross-cutting
- **Auth:** subscription CLI everywhere; never set `ANTHROPIC_API_KEY` in spawned envs.
- **Testing:** keep vitest two-tier + the dist-parity gate; add brain-fallback tests with fakes.
- **Polyglot:** JS/TS plugin ↔ Python brain only over MCP; no other coupling.
- **Degradation:** every brain-dependent feature must have a defined offline behavior.

## Resolved pre-build (design pinned in `.knowledge/`)
- **Brain MCP tool surface** — pinned in `.knowledge/derived/brain-contract.md`: a Python MCP
  server *inside wisearcher* exposing `kb_search`, `kb_answer`, `kb_neighbors`, `kb_get`,
  `kb_ingest`, `research`, `kb_assert`, `kb_health`, each wrapping a real wisearcher function.
  wisearcher has no MCP server and no internal fallback today — Phase 1 builds the server;
  hivemind owns the grep fallback at the client boundary (probe `kb_health` at session start).
- **proposal-engine KB import** — pinned in `.knowledge/derived/proposal-import.md`: a
  *deterministic* markdown→graph importer (NOT LLM re-extraction, to preserve markers) takes the
  `project_knowledge_base/` directory and maps files→Source, marked statements→Claim, embedded
  IDs→Entity, traceability rows→RELATION; marker×tier → wisearcher's decomposed confidence.
- **OTel/SigNoz config location** — pinned in `.knowledge/derived/conventions.md` § Observability:
  three places — (1) hivemind's own obs in the plugin, (2) generated-project obs injected into
  developer/reviewer prompts + manifests (lives in the generated project), (3) the brain owns its
  own (`obs.py` structlog; OTel deferred there). Standard vendored from
  `implementation-engine/.claude/shared/OBSERVABILITY.md`. No SigNoz in any compose yet (Phase 6).

## Open questions (resolve as we go)
- Empirical tuning still pending in wisearcher (entity-resolution thresholds, load-bearing
  trigger) — inherited, not introduced here; needs runtime data, not a design call.
- Streaming vs request/response for the long-running `research` brain tool (decide at build).

## First action
Phase 0 rebrand, then Phase 1 brain seam (the chosen first vertical slice). No code until this
plan is accepted.
