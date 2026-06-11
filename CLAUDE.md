# Agentic Software Development Framework

This repository is operated by a multi-agent team built on the Claude Agent SDK. The main thread acts as the **Orchestrator** and delegates all substantive work to specialized subagents defined in `.claude/agents/`.

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
4. **Human-in-the-loop for destructive actions.** Require explicit user approval before Jira transitions that close tickets, force pushes, database migrations, or any irreversible operation.

## Ticket Source

The team's ticket source is currently the **local task store** at `tasks/` (per-task JSON files conforming to `tasks/schema.json`). This is a temporary stand-in for Jira so the workflow can run end-to-end before the Atlassian MCP server is provisioned. Field names mirror Jira issue fields so migration is loss-free. See `tasks/README.md`.

When the Atlassian MCP server is configured, the Orchestrator switches to Jira as the source of truth and the local store becomes an append-only audit log.

## Workflow

The Orchestrator must follow this loop for every unit of work:

1. **Read the ticket.** Load the next `status: todo` task from `tasks/` (or, once Jira is wired up, from the Atlassian MCP server). Extract acceptance criteria. **Assign the `verification_tier` at this step** if the ticket does not already carry one, using the rubric: `tdd` for source logic, state mutation, parsing, or schema changes; `tests-after` for behavior that is provable by running the code with low edge-risk; `uat-only` for glue, config, docs, or prototypes. Record the chosen tier on the ticket.
2. **Plan.** Decompose the ticket into research, implementation, and verification tasks. Record the plan as TODOs.
3. **Research (if needed).** Spawn the `researcher` subagent for any unfamiliar library, API, or pattern. If the researcher discovers a new tech stack, it must produce an Agent Skill under `.claude/skills/<stack-name>/`.
4. **Verify per tier.**
   - `tdd` — Spawn the `developer` subagent in TEST mode first: write failing tests that encode each acceptance criterion **before** any implementation code. No implementation lands without a preceding test commit. Then spawn IMPL mode to make the tests pass.
   - `tests-after` — Spawn the `developer` subagent in a single IMPL phase: implement first, prove the behavior by running the code, then add a **minimal** set of regression locks before hand-off. No TEST-mode phase.
   - `uat-only` — Spawn the `developer` subagent in IMPL mode only; no new specs are written. The ticket is verified via conversational UAT (recorded-UAT mechanism lands with TASK-030).
5. **Implement.** The `developer` subagent writes code until the acceptance criteria are satisfied and existing tests still pass.
6. **Review.** Spawn the `reviewer` subagent in a fresh context. It must use only read-only tools and verification scripts. Block the workflow on any HIGH-severity finding.
7. **Update the ticket.** On a green review, transition the task's `status` to `done`, append a summary comment, append the commit SHAs to `linked_commits` and PR URL to `linked_prs`, refresh `updated_at`, and regenerate `tasks/index.json`. (After Jira migration, mirror the same updates via the Atlassian MCP server.)

## Repository Etiquette

- Conventional Commits (`feat:`, `fix:`, `test:`, `refactor:`, `docs:`, `chore:`).
- One logical change per commit. Tests and implementation may share a commit only when the test is a pure regression check for the same fix.
- Never commit secrets. `.env`, credentials, and tokens are out of scope.
- Never use `--no-verify` or skip hooks.
- Never force-push to `main` or any shared branch.

## Testing

The suite is split into two tiers **by directory** (see `vitest.config.js` for the rationale):

- **Fast tier** — `tests/*.spec.js`: pure logic, no real disk I/O (~2s).
- **Slow tier** — `tests/e2e/**`: real `mkdtemp` disk I/O and process spawns.

### Verification tier rubric

The `verification_tier` field on a ticket controls how the Developer verifies it:

- `tdd` — source logic, state mutation, parsing, schema changes. Tests-first, unchanged from the original policy.
- `tests-after` — behavior provable by running the code with low edge-risk. Implement first, then add a minimal set of regression locks.
- `uat-only` — glue, config, docs, prototypes. No new specs; verified via conversational UAT (recorded-UAT mechanism lands with TASK-030).

Absent `verification_tier` defaults to `tdd` (backward-compatible).

### New-test budget

Every new spec must encode an acceptance criterion or a real regression — nothing else. Redundant or duplicative specs are a LOW finding at review time.

### Which command, when

The Orchestrator and the Developer/Reviewer subagents **must pick the command by situation**, not by habit:

| Situation | Command | What it runs |
|---|---|---|
| Writing code, TDD inner loop | `npm run test:watch` | only specs affected by each save (auto, via import graph) |
| One-shot check of code you just edited | `npm run test:changed` | only specs related to your **uncommitted** changes |
| Fast confidence / pre-deploy smoke | `npm test` | the whole fast tier (~2s) |
| Iterating on one slow spec | `vitest run --config vitest.config.all.js tests/e2e/<file>` | that single e2e spec |
| **Per-ticket hand-off gate** | `npm run test:changed` + named affected e2e specs | changed + targeted slow specs |
| **Release / milestone / publish gate** | `npm run test:all` | everything (fast + slow) |

(`test:changed` compares against `HEAD`. To diff against the last commit instead: `npx vitest run --changed HEAD~1 --config vitest.config.all.js`.)

### Rules

- **The scaled gate applies per ticket:** run `npm run test:changed` plus any affected e2e specs explicitly named at hand-off. This keeps per-ticket verification time roughly constant regardless of project age.
- **`npm run test:all` is reserved for release, milestone, and publish points**, and for any ticket that touches test infrastructure or `tasks/schema.json`. `test:changed` and `test:watch` are inner-loop accelerators — the import graph cannot see fixture / data-file / dynamic-path coupling and would silently skip affected specs, which is why full `test:all` still runs at those checkpoints.
- New slow specs (anything calling `makeTmpDir` or spawning a process) go under `tests/e2e/`; pure-logic specs stay at the top level of `tests/`. The folder *is* the tier — keep the boundary clean so the fast tier stays fast.

## Per-Agent Model Assignment

Each subagent declares its model in the `model:` frontmatter field of its agent definition file:

- **reviewer** → `fable` — the independent quality gate runs on the strongest model; catching bugs and security issues is worth the extra cost.
- **developer** → `sonnet` — high-volume role (spawned twice per ticket); Sonnet delivers strong coding capability at a lower cost tier.
- **researcher** → `sonnet` — also high-volume; Sonnet handles search synthesis and skill authoring well.
- **orchestrator** — no `model:` field; it runs as the main session thread and inherits whatever model the session is started with (Fable 5 in production). TASK-032 will remove the orchestrator agent file entirely.

To override for a specific project, edit the `model:` line in the relevant agent frontmatter file under `.claude/agents/` (and keep the plugin-root `agents/` parity copy in sync — see agents-parity.spec.js).

Valid alias source: Claude Code sub-agents documentation (`model:` frontmatter field; accepted shorthands include `fable` and `sonnet`).

## Knowledge Sharing

- This file (`CLAUDE.md`) is the canonical source of team-wide guidelines. Update it whenever a workflow decision changes.
- Per-stack guidance lives in `.claude/skills/<stack-name>/SKILL.md` using progressive disclosure (lightweight frontmatter, deeper detail in `references/`).
- Persistent session transcripts should be configured via the SDK's `sessionStore` adapter so cross-session context is preserved.
