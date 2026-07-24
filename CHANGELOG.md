# Changelog

All notable changes to Hivemind are recorded here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The single source of version truth is `.claude-plugin/plugin.json`. Because the
plugin installs from this repository's `main` branch via the marketplace, a
release is the `main` HEAD at the tagged version.

## [0.18.0] — 2026-07-23

Design-pack expansion release. Adds the `watch` video skill as a built-in pack, a generic (non-design) reconciler activation seam, and a tracked, human-consented way for framework consumers to adopt best-in-class third-party design skills/MCPs "out of the box" without vendoring them.

### Added
- **`watch` built-in pack** — the `watch` video skill (`github.com/bradautomates/claude-video`, MIT) assimilated as an owned/vetted copy and registered as a built-in pack so it materializes into `.claude/skills/` via `reconcile-apply`. (TASK-176)
- **Generic reconciler activation seam** — a descriptor resource with `activate_when: "always"` activates independent of the design profile (`src/pack-resources.js#resolveDesired`), decoupling non-design packs from the design-profile map. (TASK-176)
- **Anti-slop design build-workflow guidance** — vendor-neutral process patterns in `packs/design-power/references/design-build-workflow.md`. (TASK-177)
- **Tracked external design tools** — Impeccable, Taste Skill, Higgsfield MCP, 21st.dev Magic MCP registered in the design-power descriptor as non-assimilated, upstream-tracking Wave-2 resources (inert in the reconciler by design). (TASK-178)
- **Consented design-tool install offer** — `/hivemind:design-pack` Step 6 offers to install those tools from upstream on an explicit, per-tool human "yes"; never autonomous, never liftable by any `loop_auth` grant. (TASK-179)

## [0.17.0] — 2026-07-18

Intake-quality and knowledge-graph activation release, produced by a single
autonomous loop drive (10 tickets, zero request-changes loops, epic-gate
deep-review clean). The headline is that the internal knowledge graph is now
*queryable and self-maintaining*: agents get a first-class `kb_graph_query`
MCP tool, a release-gate freshness sensor, and automatic task-node creation at
ticket close.

### Added
- **`kb_graph_query` MCP tool**: deterministic graph queries
  (`{ id?, type?, relation?, direction? }`) over `knowledge/graph/graph.json`,
  built on the `graph-sync` canonical-first merge seam (local projection by
  default, external-brain-ready) with a **total no-silent-drop filter
  contract** — every supplied filter either takes effect or yields a typed
  `E_UNANCHORED_EDGE_FILTER` error.
- **Graph-freshness sensor** (`tests/graph-freshness.spec.js`, fast tier):
  fails the release gate when a `done` ticket has no `task-<n>` graph node;
  landed with a 74-node backfill. It caught real drift twice within hours of
  shipping.
- **Auto task-node creation in `close_task`**: the guarded close path now
  creates the ticket's graph node via `graph-sync.recordNode` (local always,
  best-effort canonical mirror) — removing the manual-convention drift source.
- **Plan-ticket seeding**: `seedBacklog` mints a "Draft an implementation
  plan" ticket carrying the intake-captured problem/goals/scope verbatim, so
  the discovery-first definition finally reaches the backlog.
- **Intake ambiguity checks** (warn-but-allow, TASK-048 optionality
  preserved): all-empty goals/scope reconfirmation, and a scope_in/scope_out
  overlap warning naming the conflicting item.

### Changed
- KB-first contract (researcher + orchestrator-routing) now instructs calling
  `kb_graph_query` alongside `kb_lookup` before any web search — the graph is
  queried via the tool, never hand-read.
- `graph-sync.recordNode`'s canonical mirror is genuinely best-effort: a
  throwing brain is folded into `{ source: 'failed' }` instead of propagating.

### Fixed
- Interactive Enter-skip of goals/scope no longer renders a stray `- null`
  bullet in PROJECT.md (null-normalization at the intake boundary, plus a
  normalization-bypass gate bug when all three fields were skipped).
- `close_task`'s comment param now passes the loop-mode `author:'uat'` guard
  (TASK-163 defense-in-depth, closing the append_comment asymmetry).
- Deep-review epic-gate fixes: `kb_graph_query` forwards an injected brain to
  the merge seam, and the plan ticket's `uat-only` tier is spec-locked.

## [0.16.0] — 2026-07-14

Security-hardening and self-improvement release. The headline is the
Fable-friendly self-improvement split and framework-vs-consumer skill scoping;
it also folds in the `bin/init.js` intake trust-boundary hardening, a reviewer
model re-pin, and a backlog-polish sweep.

### Added
- **Constructive self-improvement skill** `hive-self-improve` (quality,
  simplification, dead-code and coverage gaps) as a distinct counterpart to the
  security-focused `hive-adversarial-improve`, with a hard step-5 hand-off gate
  routing any trust-boundary finding to the adversarial skill.
- **Framework-vs-consumer skill scoping** (`isFrameworkRepo`): framework-only
  skills stay in `.claude/skills/`; their `-current-project` variants ship to
  consumer projects from the plugin root.
- **Bounded `loop_state` growth** with lossless rotation into the session
  archive (`beta_findings` / `note` caps).

### Changed
- **Reviewer subagent re-pinned to Fable 5** (the most capable model) via
  `PROJECT.md` `agent_models`, so the independent quality gate runs on the
  strongest model regardless of the session's main model.
- Narrowed the tests-first (`tdd`) tier to security/parsing/schema/state work
  with a single test+impl commit discipline; `tests-after` is now the default.
- `listReady` now fails loudly on a dangling `depends_on` instead of silently
  stranding the ticket.

### Fixed
- **Init intake trust-boundary hardening** (`src/intake-sanitizer.js`): reject
  control chars, strip invisible/Unicode-tag chars, and escape Markdown
  structure (ATX + setext + fences) so attacker-controlled answers can no longer
  forge frontmatter keys, headings, or directives in generated `PROJECT.md` /
  context files; bounded the use-case count against an answers-file DoS.
- Loop-mode `author:'uat'` comment fabrication channel closed at the
  `append_comment` write seam (requires a delegation grant).
- Symmetric comma/brace escaping in inline-object frontmatter maps
  (`agent_models` / `perfil_proyecto`).
- KB seam polish: deterministic lookup cut, partial `recordKbReuse` reporting,
  `promoteDraftEntry` id-guard and landed-state errors, calibration
  enum-vocabulary exemption.

## [0.15.0] — 2026-07-12
Wargame security hardening of the assimilate supply-chain and design-pack
surfaces (default-deny verdict gate, dual-hash integrity + TOCTOU re-verify,
provenance-spoof refusal, first-class security-reviewer agent).

## [0.14.2] — 2026-07-09
Design-pack usability fix.

## [0.14.1] — 2026-07-09
`hooks.json` hotfix.

## [0.14.0] — 2026-07-09
Phase G addon surface: shipped `pack-ctl` CLI, `hivemind-assimilate-skill`, and
the design-power install flow.

## [0.13.0] — 2026-07-08
Diseño Poderoso design-power pack (design profiling + reconciled skill
resources).

## [0.12.0] — 2026-07-08
Skills & packs sub-page on the site; packaging polish.

## [0.11.0] — 2026-07-07
goal-sweep2 drive: loop selection fix, shipped `dist/loop-ctl.cjs`, revived
calibration gate, guarded ticket-close path, crash-resume correctness, and the
knowledge-base lookup/capture seam.

## [0.10.0] — 2026-07-04
Post-0.9.0 drive: session-lock hardening (exclusive acquire + CAS steal),
loop crash-resume via `loop_state`, deterministic close gate + atomic
`close_task`, and state-resilience wiring.

## [0.9.0] — 2026-06-23
Session-lock and state-store robustness.

## [0.8.0] — 2026-06-23
Context auto-flush + path-healing.

## [0.7.0] — 2026-06-17
Promoted the beta line to the agentic framework: loop engine, harness/loop
operating modes, and app-preview.

## [0.6.0] — 2026-06-16
OS-ergonomics trio: console launcher into projects, `/update`, and the graphify
skill + `/graph`.

## [0.5.0] — 2026-06-15
Web-console epic (later removed): one-click launcher + `/console`.

## [0.4.0] — 2026-06-15
Discovery-first init + the `dist/` parity gate.

## [0.3.0] — 2026-06-12
Deep-workflows (deep-review / deep-research) + `--apply-workflows` retrofit;
reviewer model set to `inherit`.

## [0.2.0] — 2026-06-11
Refinement epic.

## [0.1.1] — 2026-06-08
Early packaging fixes.

## [0.1.0]
Initial plugin: intake wizard, seeded backlog, orchestrator + developer /
reviewer / researcher subagents, portable session state, local task store.
