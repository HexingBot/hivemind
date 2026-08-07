# Changelog

All notable changes to Hivemind are recorded here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The single source of version truth is `.claude-plugin/plugin.json`. Because the
plugin installs from this repository's `main` branch via the marketplace, a
release is the `main` HEAD at the tagged version.

## [0.21.0] — 2026-08-06

The headline is a six-week-old silent failure, found by pulling on a user
report that "the plugin can't be found after an update". The context-monitor
hooks written into every consumer project used a hook shape Claude Code
rejects as invalid, so they had **never fired** — context auto-flush and the
HANDOFF.md snapshot have been inert in every install since June. Verified
with `claude doctor`, not inferred from docs.

The rest of the release is hardening: a worktree-disposal data-loss path
closed, generated artifacts no longer merged textually, and the pack layer's
ownership bookkeeping made honest in both directions.

### Fixed
- **Context-monitor hooks never fired in any consumer project** (TASK-210) —
  `buildContextMonitorEntries` emitted a *flat* hook entry (`command` directly
  on the array element) where the documented schema requires a *nested* one
  (`{ matcher?, hooks: [{ type, command }] }`). `claude doctor` rejects the
  flat form outright: `hooks.Stop.0.hooks: Expected array, but received
  undefined`. The writer now emits the nested shape, and a new plugin-level
  `SessionStart` hook (`context-monitor/settings-migrate.mjs`) migrates
  already-broken projects automatically, with no user action and no
  release-notes reading required. Migration is heal-only, idempotent, and
  leaves unrelated hooks and settings byte-identical.
- **Stale plugin paths after an update were only half-repaired** (TASK-209) —
  the existing self-heal (`context-monitor/repin.mjs`, shipped since
  TASK-009) walked only the flat entry shape, so it repaired the statusline
  and silently skipped every nested hook. That is the reported symptom: the
  status bar returns after a restart, the hooks stay dead. It now traverses
  both shapes for **path repair only**, never converting shape, and its
  "all clear" message is computed by a *structurally independent* deep scan
  rather than derived from what the repair pass visited — so it cannot report
  success over its own blind spot. The manual repair command in
  `commands/update.md` also did not run (`CLAUDE_PLUGIN_ROOT` is set only for
  hook subprocesses, never in a user shell); it now resolves the install path
  from `installed_plugins.json`.
- **Worktree disposal destroyed the primary checkout's `node_modules`**
  (TASK-198) — `git worktree remove` recursed through the `node_modules`
  junction. The junction is now severed first; reproduced in both directions.
  Three residual findings from that review — a bare `catch` failing open on a
  non-ENOENT `lstat`, a nested-junction overclaim, and an empirically wrong
  comment — are closed here rather than carried further.
- **Handback merged generated artifacts textually** (TASK-197) — two branches
  each regenerating `dist/*.cjs` merged with no conflict, splicing two builds
  into one file that matched neither. Handback now **refuses** when both sides
  modified the same generated path since diverging. The generated-path list is
  derived from the build script's own entrypoints, via a new zero-import data
  module so a runtime module no longer pulls a bundler into its import graph.
- **Pack-layer ownership** (TASK-202, TASK-203, TASK-207) — same-pack stale
  version edges no longer accumulate un-removably; `assimilateSkill` no longer
  drops a sibling pack's owner edge (which failed toward *deletion* of a
  resource another pack still wanted); and a colliding assimilated
  `resourceId` no longer overwrites a sibling's provenance or downgrades its
  `required: hard` removal brake.
- **`reconcile-apply` could report success over a real failure** (TASK-205) —
  the `ok` predicate compared id-blind sums, so a surplus in one bucket
  offset a shortfall in another. It is now identity-aware per bucket. The fix
  also removed a pre-existing *false alarm* when two packs desired the same
  not-yet-live skill.
- **A failed worktree removal was indistinguishable from a no-op** (TASK-206)
  — the thrown error now carries three-valued post-conditions
  (`present`/`absent`/`unknown`) for registration, directory and junction
  sever, so a caller reads the outcome instead of inferring it.

### Added
- **MCP bundle-staleness detection** (TASK-204) — a new `mcp_build_status`
  tool reports whether the running server's loaded bundle still matches the
  repo's committed one. Two independent legs: `self_stale` (did my own path
  mutate) and `repo_divergent` (do my bytes differ from the repo's build) —
  the second exists because the server loads from the *installed plugin
  cache*, a version-pinned directory a local rebuild never touches. Documents
  the consequence plainly: closing `repo_divergent` needs a plugin update, and
  the work must be pushed to the marketplace remote first.
- **Tool-documentation drift sensor** (TASK-208) — derives the documented tool
  list from `createServer`'s real registrations rather than trusting prose,
  and caught `mcp_build_status` as undocumented on its first run. Hardcoded
  tool *counts* were removed from the docs entirely rather than policed — a
  count rots by construction; the itemized list is authoritative.

### Changed
- **Release notes rewritten for readability** — every entry on
  `docs/releases.html` now carries a plain-language summary of what the
  release was *for*, above expanded detail. The oldest entries were single
  fragments that told a reader nothing.
- `worktree.baseRef: "head"` is set in this repo's `.claude/settings.json`, so
  isolated worktrees branch from local HEAD rather than a stale remote.

## [0.20.0] — 2026-08-04

Worktree isolation and ticket-integrity hardening release. The headline is
structural: concurrent `developer` spawns each get their own `git worktree`
instead of sharing one working tree and one `.git/index`, removing the
shared-git-index hazard at the source rather than relying solely on
convention to avoid it.

### Added
- **Worktree isolation for concurrent developer spawns** (TASK-195) — the
  Orchestrator can now spawn `isolation: 'worktree'` for concurrent
  `developer` work; each spawn gets its own checkout and its own
  `.git/index`. The pathspec-limited commit protocol (TASK-191) is retained
  as the backstop, in force regardless of isolation mode. Handback out of a
  worktree lands via `src/worktree-handback.js`; provisioning (`node_modules`
  linked, not reinstalled) via `src/worktree-provision.js`.
- **AC-fidelity validation** (TASK-189) — vacuous and invisible acceptance
  criteria are now rejected at intake, closing a calibration-laundering gap
  where a ticket could carry ACs that looked like coverage but asserted
  nothing.
- **Empty-result contract closures** (TASK-192, 194, 199) — `test:since` and
  `test:changed` now print a self-describing marker on zero-spec selection
  instead of reporting an unqualified green, and `reconcile-apply`'s `ok`
  predicate now correctly sees the replace bucket instead of reporting
  success while silently no-op'ing replacements.

### Fixed
- **Worktree `node_modules`-junction data loss** (TASK-198) — `git worktree
  remove` recursing through a `node_modules` junction could recursively
  empty the *primary* checkout's dependency tree, not just the worktree's.
  The handback path now severs the junction before disposal, verified in
  both directions (destruction reproduced without the fix; primary
  `node_modules` left fully intact with it). Three residual findings from
  that review (nested junctions, an over-broad `catch` on the sever's
  `lstat`, and a stale comment) are deliberately deferred — tracked on
  TASK-198, unreachable while worktree-isolated spawns stay paused.
- **Ticket-integrity / close-guard hardening** (TASK-186, 187, 188, 201) — a
  strict allowlist grammar for UAT verdict comments (closing preamble/
  postscript/padded-step evasion of the UAT gate); `done` is now reachable
  only from `in_review`; evidence requirements now scale with
  `verification_tier`; a comment-author enum blocks a `reviewer`-authored
  comment from self-certifying its own closing comment; invisible Unicode
  Tag-block/format characters are stripped from task comments.
- **Pack-layer correctness** (TASK-181, 182, 183, 184, 200) — owned skill
  copies now source from the plugin rather than the consumer repo (the
  previous default silently installed nothing in a real consumer project
  while still reporting `ok:true`); dual-copy precedence prefers the plugin
  copy on an equal-or-newer pin; sibling-pack owner edges now survive a
  re-materialize pass.
- **Path-safety hardening** (TASK-185, 193) — `safeRef` now rejects
  whitespace, newlines, percent-encoding, and unanchored `..` segments that
  previously could bypass the ref guard.

## [0.19.0] — 2026-07-28

Delivery fix: the `watch` video skill now works out of the box on any machine
that installs the plugin.

### Fixed
- **`watch` ships at plugin-root `skills/`** — 0.18.0 delivered `watch` only as
  an addon-pack resource, with files at `assimilated-skills/watch/` (owned copy)
  and `.claude/skills/watch/` (framework dogfood mirror). Claude Code
  auto-discovers plugin skills **only** from plugin-root `skills/`, so a
  consumer install surfaced no `watch` skill at all until someone manually ran
  `pack-ctl reconcile-apply --repo-root <root>`. A third, byte-identical copy now
  ships at `skills/watch/`, so `/hivemind:watch` loads immediately on install
  with zero in-project setup. (TASK-180)

### Added
- **`watch` copy-drift sensor** (`tests/watch-skill-parity.spec.js`) — compares
  the shipped and dogfood copies against the owned copy **file-for-file and
  byte-for-byte**, `scripts/*.py` included, since watch's behavior lives in its
  scripts and a `SKILL.md`-only check would let a modified downloader or Whisper
  client ship unnoticed. Also pins that the pack resource still resolves. (TASK-180)

### Notes
- The addon-pack path is **unchanged and additive**. Removing the pack resource
  would make the reconciler compute a REMOVE op against projects that already
  installed `watch` via `integrations.lock.json`, deleting a working skill from
  existing consumers.
- No pinned third-party script was modified — those files are covered by the
  `source_integrity` / `content_integrity` hashes in the provenance block.
- `watch` still shells out to `python`, `ffmpeg`/`ffprobe` and `yt-dlp`, which
  cannot be bundled into a plugin. Its `scripts/setup.py` preflight detects what
  is missing and prints the exact install command per platform.
- This release also restores the site release mirror (`docs/releases.html`),
  which was not updated when 0.18.0 was cut.

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
