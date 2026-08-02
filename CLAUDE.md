# Hivemind

This repository is operated by a multi-agent team built on the Claude Agent SDK. The main thread **is** the Orchestrator — equipped with the orchestrator-routing skill — and delegates substantive work to specialist subagents (`developer`, `reviewer`, `researcher`) defined in `.claude/agents/`.

## First-chat routing

Before reading the RESUME FIRST section: if `PROJECT.md` does not exist in the repo root, the framework has not been initialized for this project. Direct the human to run `node bin/init.js` (the project intake wizard) before any other workflow step.

`bin/init.js` will scaffold `PROJECT.md` (capturing project name, type, primary use cases, target users, and stack), create a fresh session bundle under `state/sessions/<id>/`, and leave the repo ready for orchestrator-driven work. If `PROJECT.md` already exists, init prints a one-line summary and exits without mutation.

## RESUME FIRST (do this before anything else in every new chat)

Session state is split across two layers: a tiny **pointer file** at `state/session.json` (three fields: `schema_version`, `active_session_id`, `updated_at`) and a self-contained **bundle directory** at `state/sessions/<active_session_id>/`. The bundle holds the substantive orchestrator state (`workflow_step`, `handoff_summary`, `next_action`, `open_questions`, `blockers`, `decisions`, `subagent_results`, etc.) in its own `session.json`.

The very first action of every new chat is:

1. Read `state/session.json` (the pointer). If it doesn't exist or `active_session_id` is null, the orchestrator is idle — confirm with the human before starting a new session.
2. If `active_session_id` is non-null, read `state/sessions/<active_session_id>/session.json` for the actual handoff state.
3. If that bundle's `active_task` is non-null, read `tasks/<active_task>.json` to load the work item.
4. Restate `handoff_summary` and `next_action` to the human in one short paragraph and confirm before acting.

This four-step sequence is non-negotiable — skipping it loses the prior session's progress. See `state/README.md` for the full bundle layout, lifecycle operations (pause / resume / end), atomic-write recipe, and v1→v2 migration rule.

## Operating Principles

1. **Agent = Model + Harness.** Always rely on the harness — subagents, skills, MCP servers, and verification scripts — rather than trying to do everything in the main context.
2. **Context hygiene.** Spawn a subagent (via the `Agent` tool) whenever a task involves heavy reading, web research, or speculative exploration. Never bloat the orchestrator's context with raw search output or full file dumps.
3. **Feedforward + feedback.** Steer subagents up front with explicit instructions, then verify their output with sensors (linters, tests, the Reviewer subagent).
4. **Human-in-the-loop for destructive actions.** Require explicit user approval before Jira transitions that close tickets, force pushes, database migrations, or any irreversible operation — unless a standing `loop_auth` authorization covers the action (see the `/hivemind:loop` gates below).

## Ticket Source

The team's ticket source is currently the **local task store** at `tasks/` (per-task JSON files conforming to `tasks/schema.json`). This is a temporary stand-in for Jira so the workflow can run end-to-end before the Atlassian MCP server is provisioned. Field names mirror Jira issue fields so migration is loss-free. See `tasks/README.md`.

When the Atlassian MCP server is configured, the Orchestrator switches to Jira as the source of truth and the local store becomes an append-only audit log.

## Workflow

The Orchestrator must follow this loop for every unit of work:

1. **Read the ticket.** Load the next `status: todo` task from `tasks/` (or, once Jira is wired up, from the Atlassian MCP server). Extract acceptance criteria. **Assign the `verification_tier` at this step** if the ticket does not already carry one, biasing toward the **lightest defensible tier**: `tdd` is RESERVED for security-sensitive logic, parsing, schema/state-schema changes, or state mutation with real edge-risk; `tests-after` is the DEFAULT for behavior that is provable by running the code with low edge-risk; `uat-only` for glue, config, docs, or prototypes. Record the chosen tier on the ticket. (Absent `verification_tier` on an already-existing ticket still defaults to `tdd` — see the Testing section's rubric; this bias governs new tier assignment, not that fallback.)
2. **Plan.** Decompose the ticket into research, implementation, and verification tasks. Record the plan as TODOs.
3. **Research (if needed).** Spawn the `researcher` subagent for any unfamiliar library, API, or pattern. If the researcher discovers a new tech stack, it must produce an Agent Skill under `.claude/skills/<stack-name>/`.
4. **Verify per tier.**
   - `tdd` — Spawn the `developer` subagent **once**. Within that single spawn: write failing tests that encode each acceptance criterion, run them and capture the red output verbatim as evidence they fail for the right reason, then implement until the tests (and all existing tests) pass, run the per-ticket gate, and commit test(s) and implementation together in a **single commit** (a separate `test:`-before-impl commit remains allowed but is no longer required). The captured red-run evidence — not commit ordering — is the tests-first proof: the Reviewer verifies the evidence is present in the hand-off, and when the hand-off looks suspicious, reproduces the red state by reverting or stashing the implementation hunks of the committed diff (not by checking out a prior test-only commit) and re-running the tests.
   - `tests-after` — Spawn the `developer` subagent in a single spawn: implement first, prove the behavior by running the code, then add a **minimal** set of regression locks before hand-off. When ACs describe human-observable behavior, also run the UAT step below after the regression locks land.
   - `uat-only` — Spawn the `developer` subagent for implementation only; no new specs are written. After implementation, run the UAT step below.

   **UAT step** (mandatory for `uat-only`; mandatory for `tests-after` when ACs are human-observable):
   - Derive a short numbered script from the acceptance criteria — one or more "run/do X, expect Y" steps per AC so every AC is covered. Keep it terse: one line per step, no walls of evidence — show supporting evidence only when the human asks.
   - Present the script to the human. Collect a PASS or FAIL verdict per step, plus optional notes. The human may delegate any step's verification back to the Orchestrator; record such steps as PASS with a "verified by Orchestrator at the human's request" note instead of a bare PASS.
   - Record the outcome as a ticket comment: author `uat`, body listing each step with its expected result, observed result, and per-step verdict, plus an overall result.
   - A `uat-only` ticket **cannot** transition to `done` without a `uat` comment whose steps cover every AC with all steps PASS. A failed step sends the ticket back to the Developer.
5. **Implement.** The `developer` subagent writes code until the acceptance criteria are satisfied and existing tests still pass.
6. **Review.** Spawn the `reviewer` subagent in a fresh context, stating the computed `review_depth` (`light` or `full`) and the rubric inputs (changed-line count, touched surfaces) that produced it — see the orchestrator-routing skill's "Review depth rubric" section. It must use only read-only tools and verification scripts. Block the workflow on any HIGH-severity finding.
7. **Update the ticket.** On a green review, call the `close_task` MCP tool (`mcp__plugin_hivemind_hivemind-tasks__close_task` — see the orchestrator-routing skill's "Ticket-update protocol" section) to atomically transition the task's `status` to `done`, append a summary comment that also records the review depth and its rubric inputs, record the commit SHAs in `linked_commits` and PR URL in `linked_prs`, refresh `updated_at`, and regenerate `tasks/index.json`. A direct `Edit` of the task file is a documented, degraded fallback only, used when the MCP server is unavailable — it bypasses the uat-only done-guard and the loop-mode close guard (TASK-082). (After Jira migration, mirror the same updates via the Atlassian MCP server.) **Knowledge capture (TASK-105):** as part of this same step, if the gating review recorded any HIGH-severity finding, or the ticket needed one or more REQUEST-CHANGES (RC) loops before landing, the Orchestrator writes a draft knowledge entry via `writeKnowledgeEntry({ repoRoot, entry, draft: true })` (`src/knowledge.js`) to `knowledge/proposed/` — without per-entry human approval. See the orchestrator-routing skill's "Knowledge capture at ticket close" section for the exact trigger and field mapping, and Gate 5 below for how proposed drafts get promoted or discarded in batch.

To self-drive this loop across multiple tickets toward a stated goal instead of repeating these steps by hand, use `/hivemind:loop` — see the README's "Run the loop" section for the goal syntax, the five hard-stop gates, and the unattended-mode preset (`commands/loop.md` and the orchestrator-routing SKILL.md carry the full gate contract).

## Repository Etiquette

- Conventional Commits (`feat:`, `fix:`, `test:`, `refactor:`, `docs:`, `chore:`).
- One logical change per commit. Tests and implementation may share a commit when the test is a pure regression check for the same fix, or — for `tdd`-tier tickets under the single-commit discipline (Workflow step 4) — when the captured red-run evidence stands in for commit separation as the tests-first proof.
- Never commit secrets. `.env`, credentials, and tokens are out of scope.
- Never use `--no-verify` or skip hooks.
- Never force-push to `main` or any shared branch.

## Testing

The suite is split into two tiers **by directory** (see `vitest.config.js` for the rationale):

- **Fast tier** — `tests/*.spec.js`: pure logic, no real disk I/O (~2s test-execution; ~7s wall-clock once process startup and collect are counted — collect scales with spec-file count).
- **Slow tier** — `tests/e2e/**`: real `mkdtemp` disk I/O and process spawns.

### Verification tier rubric

The `verification_tier` field on a ticket controls how the Developer verifies it. Assign the **lightest defensible tier**:

- `tdd` — RESERVED for security-sensitive logic, parsing, schema/state-schema changes, or state mutation with real edge-risk. Tests-first, single-commit discipline: write failing tests, capture the red-run evidence, then implement — test(s) and implementation may land in one commit (see the orchestrator-routing skill's "Single developer spawn, single-commit discipline" section).
- `tests-after` — the DEFAULT for behavior provable by running the code with low edge-risk. Implement first, then add a minimal set of regression locks.
- `uat-only` — glue, config, docs, prototypes. No new specs; verified via conversational UAT (see the UAT step in Workflow step 4).

Absent `verification_tier` defaults to `tdd` (backward-compatible) — unchanged; the lightest-defensible-tier bias above governs new tier assignment, not this fallback.

### New-test budget

Every new spec must encode an acceptance criterion or a real regression — nothing else. Redundant or duplicative specs are a LOW finding at review time.

### Which command, when

The Orchestrator and the Developer/Reviewer subagents **must pick the command by situation**, not by habit:

| Situation | Command | What it runs |
|---|---|---|
| Writing code, TDD inner loop | `npm run test:watch` | only specs affected by each save (auto, via import graph) |
| One-shot check of code you just edited | `npm run test:changed` | only specs related to your **uncommitted** changes |
| Fast confidence / pre-deploy smoke | `npm test` | the whole fast tier (~2s test-execution; ~7s wall-clock) |
| Iterating on one slow spec | `vitest run --config vitest.config.all.js tests/e2e/<file>` | that single e2e spec |
| Re-verifying a committed diff (Reviewer) | `npm run test:since -- <base-ref>` | specs affected since `<base-ref>`, including committed changes |
| **Per-ticket hand-off gate** | `npm run test:changed` (or `test:since` post-commit) + `npm test` + named affected e2e specs | changed + fast tier + targeted slow specs |
| **Release / milestone / publish gate** | `npm run test:all` | everything (fast + slow) |

(`test:changed` compares against `HEAD`, which means **uncommitted** changes only — it selects zero specs once the diff is committed. `test:since` is the committed-range equivalent: `npm run test:since -- <base-ref>` runs `scripts/test-since.mjs`, a validating wrapper — NOT a raw `vitest --changed <ref>` — because vitest's CLI parser coerces an all-digit ref like `7627532` to a JS number, which vitest's git module then silently drops (falls back to staged+unstaged only, empty on a clean tree); the wrapper resolves the ref with `git rev-parse --verify` first and forwards a guaranteed-non-numeric `<full-sha>~0` form, failing loudly (non-zero exit) on an unresolvable ref instead of silently selecting zero specs. Use `test:changed` while iterating locally; use `test:since` to reproduce that selection against a base ref — this is what the Reviewer runs at hand-off, since by the time it re-verifies, the Developer's diff is already committed. **A "No test files found" / zero-specs result from `test:since` is a gate FAILURE to investigate, never a green** — it means the ref didn't resolve or nothing was actually diffed, not that nothing changed.)

A third, distinct blind-spot class (TASK-109, found during TASK-101's fix round): **computed dynamic imports**. `tests/framework-bug-report.spec.js` loads its module under test via `await import(pathToFileURL(join(REPO_ROOT, 'src', 'framework-bug-report.js')).href)` — a runtime-computed specifier vitest's static import graph cannot resolve. This defeats **both** `test:changed` (an uncommitted src-only change selects ZERO specs) **and** `test:since` (a COMMITTED src-only change selects ZERO specs whenever the spec file itself sits outside the diff range) — separate from the fs-read blind spot noted in the Rules section below (agent/skill parity sensors, doc-lock specs), which is a fs-read/import distinction rather than a static/dynamic-specifier one. Compensation: run the affected spec file directly (`npx vitest run <spec>`) in addition to the mandatory `npm test` fast tier; a zero-specs result stays a gate FAILURE to investigate, never a green, exactly as above.

### Empty-result contract (TASK-192)

**The rule:** an operation that can return an empty/zero result MUST let the caller distinguish "nothing needed doing" from "the thing that finds work is broken and found nothing" — and the caller must never have to infer which. This is NOT "reject empty": plenty of empty results are legitimate and unambiguous (`list_todos` on a drained board; a diff that genuinely touches nothing). The failure mode this closes is an operation that reports **unqualified success** for the ambiguous case, so absence of evidence renders as evidence of absence.

**Motivating evidence — the same defect class, confirmed three times in one day (2026-08-02) in three unrelated subsystems:**

1. **`test:since` zero-spec selection.** A resolved ref that selects zero specs and an unresolvable ref both used to be indistinguishable from "nothing needed testing" — the warning two paragraphs above was prose-only. See "Mechanical closure" below for the fix.
2. **`reconcile-apply` returning `installed: []` with `ok: true`.** Every built-in pack skill soft-failed to materialize, nothing installed, CLI reported unqualified success — shipped through at least two releases before being caught. **Fixed and verified CONFORMING** (TASK-181, TASK-183): `bin/pack-ctl.js`'s `reconcile-apply` case now always returns `planned_install_count` and `installed_count` alongside `ok`; `ok` requires every planned install to have landed AND no pack to have hard-aborted (`bin/pack-ctl.js` around the `plannedInstallCount`/`installedCount`/`failureKind` block), and any `ok:false` result exits non-zero with `code`/`message` on stderr (same file, `main()`'s `payload.ok === false` branch). Zero installed is fine when zero were planned; a hard failure when some were planned but didn't land.
3. **The design-pack doc-lock's empty checked-set.** The spec derived its checked field names from a SUCCESS-path fixture run only, so failure-only fields (`code`, `message`) formed an empty set that was dutifully checked, passed, and reported green while the doc it guarded was wrong. **Fixed and verified CONFORMING** (TASK-184): `tests/e2e/design-pack-doc-lock.spec.js` now derives its checked-field set from a real FAILURE-path `reconcile-apply` run too, and hardened the doc-membership predicate to a word-boundary match (a bare substring check made `code` vacuously "documented" via unrelated words like "hardcoded").

**Mechanical closure for instance 1 (TASK-192 AC4):** `scripts/test-since.mjs` now runs `hasAnyChangedFiles` — its own git-diff check mirroring vitest's exact `--changed` algorithm (`<ref>...HEAD` diff + staged + unstaged) — independently of vitest's own exit code (vitest's `passWithNoTests` defaults to `true`, so `vitest run` exits 0 on zero-spec selection regardless of cause). Before running the real (slow) test, the wrapper prints one of two distinctly-labeled `TEST_SINCE_ZERO_SELECTION` markers to stderr:

- `reason=empty-diff` — the committed diff, staged set, and unstaged set are ALL empty. Legitimate; nothing to investigate.
- `reason=no-spec-matched` — the diff is non-empty (real files changed) but a `vitest list` pre-check found zero matching specs. **Deliberately NOT a hard failure**: a docs-only, config-only, or fs-read-only change (the import graph can't see any of those) legitimately produces this too, and several real docs-only tickets hit exactly this shape the same day this AC was implemented — a blanket non-zero exit here would turn every one of those into a red gate needing manual override, which is alarm fatigue that weakens the control rather than strengthening it (the exact "empty is always false" over-application this contract explicitly warns against). The marker instead makes the reason self-describing in the output and points the reader at `npm test` (the fs-read sensors) and the named affected e2e specs as the actual coverage check for that case.

Either way the real `vitest run` still executes afterward and its own exit code is passed through unchanged — this wrapper never turns a legitimate zero-selection into a broken gate; it only ever removes the need to infer why the selection was zero.

**In-flight, not fixed here:** `src/task-store.js`'s `checkUatGuard` is a presence-only check feeding the uat-only close gate — the same class, on a close-guard path. Per this ticket's own escalation clause (a close-guard/state-mutation seam is out of scope for a `tests-after` ticket), it is not touched here; it is being reworked directly under TASK-186.

### Use-case suite

`tests/use-cases/USE-CASES.md` is the project's primary-flow manifest. Each entry maps a named use case to the spec file(s) covering it. This suite is part of the release gate and runs automatically within `npm run test:all` (vitest.config.all.js includes `tests/**/*.spec.js`). It can also be run in isolation with `npm run test:use-cases`.

Rules:
- **Tickets modify `tests/use-cases/` ONLY when a primary use case changes** (new, changed, or removed use case). Per-ticket spec accretion inside `tests/use-cases/` is not permitted — suite size tracks product surface, not ticket count.
- The manifest is generated once by `generateUseCaseSuite` (wired into `bin/init.js`). Existing files are never overwritten (idempotent). A second `bin/init.js` run on an initialized project skips the generator entirely (`already_initialized` branch).
- For JS/node projects, `generateUseCaseSuite` also emits skeleton `.spec.js` files with `describe` + `it.todo` stubs under `tests/use-cases/<slug>.spec.js`, one per primary use case. Non-JS projects receive the manifest only.
- A meta-spec in `tests/use-case-policy.spec.js` validates that every spec path referenced in `USE-CASES.md` exists on disk. This is a permanent sensor that blocks the gate if the manifest rots.

### Rules

- **The scaled gate applies per ticket:** the Developer runs `npm run test:changed` plus `npm test` (fast tier, ~2s test-execution / ~7s wall-clock) plus any affected e2e specs explicitly named at hand-off. The Reviewer re-runs the equivalent selection against the committed diff with `npm run test:since -- <base-ref>` plus `npm test` plus the named e2e specs — a green Developer hand-off must reproduce as green here. Because the fast tier runs once at hand-off and again at review, budget roughly its wall-clock figure twice per ticket, not once. The Developer proposes the affected-e2e list; the Reviewer independently assesses its sufficiency and may expand it or escalate to the Orchestrator if under-scoped. `npm test` is mandatory at both steps because the `--changed`/`--since` import graph is blind to files read via `fs` rather than imported (agent/skill parity sensors, doc-lock specs) — an md-only ticket would otherwise run zero sensors. Scoped test selection (`test:changed` / `test:since`) is what keeps per-ticket verification time bounded to the affected specs; the fast tier's own startup/collect cost still scales with spec-file count as the suite grows, so its wall-clock figure is not fixed forever.
- **`npm run test:all` is reserved for release, milestone, and publish points**, and for any ticket that touches test infrastructure or `tasks/schema.json`. `test:changed` and `test:watch` are inner-loop accelerators — the import graph cannot see fixture / data-file / dynamic-path coupling and would silently skip affected specs, which is why full `test:all` still runs at those checkpoints.
- New slow specs (anything calling `makeTmpDir` or spawning a process) go under `tests/e2e/`; pure-logic specs stay at the top level of `tests/`. The folder *is* the tier — keep the boundary clean so the fast tier stays fast.

### dist/ artifact freshness (TASK-049)

`dist/*.cjs` are committed build artifacts bundled by `npm run build:plugin`. Any source change in `bin/` or `src/` that is not followed by a rebuild ships a stale bundle silently. The automated gate is `tests/e2e/dist-parity.spec.js` (runs under `npm run test:all`): it rebuilds all four bundles into a temp dir using the same esbuild config and byte-compares them against committed `dist/`. If they differ, the gate fails with the bundle name and the instruction to run `npm run build:plugin`. **No manual `git diff --stat dist/` check is needed** — `test:all` catches stale dist/ automatically. Remember to commit updated `dist/` after every `npm run build:plugin` that changes the bundles.

### graph-freshness sensor (TASK-169)

Nothing keeps `knowledge/graph/graph.json` synced to `tasks/` except the manual write-at-close convention — a done ticket can land with no corresponding graph node and nothing catches it. The automated gate is `tests/graph-freshness.spec.js` (fast tier — reads the repo's own `tasks/*.json` + `knowledge/graph/graph.json`, same precedent as `tests/use-case-policy.spec.js` reading `USE-CASES.md`, so it runs in both `npm test` and `npm run test:all`): it fails naming every ticket with `status: "done"` that has no `task-<digits>` node in the graph. Tickets in any other status (`todo`/`in_progress`/`blocked`/`in_review`) are never required to have a node. The pure detection logic lives in `src/graph-freshness.js` (`findDoneTicketsMissingGraphNodes`); a fix is landing the missing node via `src/knowledge-graph.js`'s `addNode` (never a hand-edit of `graph.json`).

## Per-Agent Model Assignment

Each subagent declares its model in the `model:` frontmatter field of its agent definition file:

- **reviewer** → `fable` — the independent quality gate runs on **Fable 5**, the most capable model, regardless of the session's main model, so the gate stays on the strongest available model and gains model-diversity from the Opus-run orchestrator. Pinned via `PROJECT.md`'s `agent_models` map (`node bin/init.js --apply-models`). (History: TASK-042 had retired the `fable` pin to `inherit` while Fable 5 was unavailable to this account; it is available again as of 2026-07-14, so the explicit pin was restored on human directive.)
- **developer** → `sonnet` — high-volume role (spawned once per ticket; `tdd`-tier work uses a single-commit discipline where captured red-run evidence, not commit ordering, is the tests-first proof); Sonnet delivers strong coding capability at a lower cost tier.
- **researcher** → `sonnet` — also high-volume; Sonnet handles search synthesis and skill authoring well.
- **orchestrator** — no agent file; it runs as the main session thread and inherits whatever model the session is started with (Opus 4.8 in production). TASK-032 removed the orchestrator agent file — the role is the session itself, equipped with the orchestrator-routing skill.

**Canonical knob: `PROJECT.md`.**  The `agent_models` map in `PROJECT.md` frontmatter is the single source of truth for per-agent model overrides in a given project. To change the model for reviewer, developer, or researcher, edit the `agent_models` block in `PROJECT.md` and re-apply with `node bin/init.js --apply-models`. The `--apply-models` flag reads `PROJECT.md` and surgically patches only the `model:` frontmatter line of each mapped agent file (both `.claude/agents/` and the plugin-root `agents/` parity copies in the dev repo) without re-running the wizard or touching any other content.

Valid model aliases: `sonnet`, `opus`, `haiku`, `fable`, `inherit`. Full model IDs matching `/^claude-[a-z0-9-]+$/` (e.g. `claude-opus-4-5`) are also accepted. Invalid aliases or unknown agent names are rejected before any file is written.

Valid alias source: Claude Code sub-agents documentation (`model:` frontmatter field; accepted shorthands include `fable` and `sonnet`).

## Knowledge Sharing

- This file (`CLAUDE.md`) is the canonical source of team-wide guidelines. Update it whenever a workflow decision changes.
- Per-stack guidance lives in `.claude/skills/<stack-name>/SKILL.md` using progressive disclosure (lightweight frontmatter, deeper detail in `references/`).
- Persistent session transcripts should be configured via the SDK's `sessionStore` adapter so cross-session context is preserved.
- **Framework-only vs current-project skills:** `hive-self-improve`, `hive-adversarial-improve`, and `hivemind-assimilate-skill` operate on the hivemind framework repo itself and live in `.claude/skills/` only (never shipped to consumers); their `-current-project` counterparts (`hive-self-improve-current-project`, `hive-adversarial-improve-current-project`, `assimilate-current-project`) are the consumer-project entry points and ship at plugin-root `skills/`. The split is enforced at load time by `isFrameworkRepo` (`src/framework-context.js`) — see the orchestrator-routing skill's "Framework-only vs current-project skill variants" section for the routing table.
