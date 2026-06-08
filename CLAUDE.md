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

1. **Read the ticket.** Load the next `status: todo` task from `tasks/` (or, once Jira is wired up, from the Atlassian MCP server). Extract acceptance criteria.
2. **Plan.** Decompose the ticket into research, implementation, and verification tasks. Record the plan as TODOs.
3. **Research (if needed).** Spawn the `researcher` subagent for any unfamiliar library, API, or pattern. If the researcher discovers a new tech stack, it must produce an Agent Skill under `.claude/skills/<stack-name>/`.
4. **Tests first.** Spawn the `developer` subagent and instruct it to write failing tests that encode the acceptance criteria **before** writing implementation code. No implementation lands without a preceding test commit.
5. **Implement.** The same `developer` subagent writes code until the new tests pass and existing tests still pass.
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

### Which command, when

The Orchestrator and the Developer/Reviewer subagents **must pick the command by situation**, not by habit:

| Situation | Command | What it runs |
|---|---|---|
| Writing code, TDD inner loop | `npm run test:watch` | only specs affected by each save (auto, via import graph) |
| One-shot check of code you just edited | `npm run test:changed` | only specs related to your **uncommitted** changes |
| Fast confidence / pre-deploy smoke | `npm test` | the whole fast tier (~2s) |
| Iterating on one slow spec | `vitest run --config vitest.config.all.js tests/e2e/<file>` | that single e2e spec |
| **Pre-hand-off & review gate** | `npm run test:all` | everything (fast + slow) |

(`test:changed` compares against `HEAD`. To diff against the last commit instead: `npx vitest run --changed HEAD~1 --config vitest.config.all.js`.)

### Rules

- **The gate is always `npm run test:all`.** `test:changed` and `test:watch` are inner-loop accelerators — never a substitute for the gate, because the import graph cannot see fixture / data-file / dynamic-path coupling and would silently skip affected specs. The Developer runs `npm run test:all` before hand-off; the Reviewer re-runs it from a clean state.
- New slow specs (anything calling `makeTmpDir` or spawning a process) go under `tests/e2e/`; pure-logic specs stay at the top level of `tests/`. The folder *is* the tier — keep the boundary clean so the fast tier stays fast.

## Knowledge Sharing

- This file (`CLAUDE.md`) is the canonical source of team-wide guidelines. Update it whenever a workflow decision changes.
- Per-stack guidance lives in `.claude/skills/<stack-name>/SKILL.md` using progressive disclosure (lightweight frontmatter, deeper detail in `references/`).
- Persistent session transcripts should be configured via the SDK's `sessionStore` adapter so cross-session context is preserved.
