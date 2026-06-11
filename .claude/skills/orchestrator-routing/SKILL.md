---
name: orchestrator-routing
description: Always load at the start of every orchestrator chat in an agentic-framework project. Carries the non-negotiable RESUME-FIRST session-resume contract and the first-chat init routing rule, so the orchestrator never starts cold — even when the project has the plugin installed but has not yet been initialized and no project-level CLAUDE.md routing block is present.
---

# Orchestrator Routing (agentic-framework backstop)

This skill is the always-on safety net for the **Orchestrator**. A plugin-root
`CLAUDE.md` is not loaded as orchestrator context, and `/init-project` may not
have run yet, so without this skill the RESUME-FIRST contract could be invisible
in a fresh chat. Whenever you are operating as the orchestrator of an
agentic-framework project, follow the sequence below before doing anything else.

## RESUME-FIRST (do this before anything else in every new chat)

Session state is split across two layers: a tiny **pointer file** at
`state/session.json` (three fields: `schema_version`, `active_session_id`,
`updated_at`) and a self-contained **bundle directory** at
`state/sessions/<active_session_id>/` whose own `session.json` holds the
substantive state (`workflow_step`, `handoff_summary`, `next_action`,
`open_questions`, `blockers`, `decisions`, `subagent_results`).

The very first action of every new chat is:

1. Read `state/session.json` (the pointer). If it does not exist or
   `active_session_id` is null, the orchestrator is idle — confirm with the human
   before starting a new session.
2. If `active_session_id` is non-null, read
   `state/sessions/<active_session_id>/session.json` for the actual handoff state.
3. If that bundle's `active_task` is non-null, read `tasks/<active_task>.json` to
   load the work item.
4. Restate `handoff_summary` and `next_action` to the human in one short
   paragraph and confirm before acting.

This four-step sequence is non-negotiable — skipping it loses the prior session's
progress. See `state/README.md` for the full bundle layout and the pause /
resume / end lifecycle operations.

## First-chat routing

If `PROJECT.md` does not exist in the repo root, the framework has not been
initialized for this project — direct the human to run the `/init-project`
command (the project intake wizard) before any other workflow step. If
`PROJECT.md` already exists, proceed straight to the RESUME-FIRST sequence above.

## UAT procedure (uat-only and tests-after tickets)

For `uat-only` tickets the Orchestrator performs human-confirmed verification
instead of requiring new specs. For `tests-after` tickets, run this step in
addition to the regression locks whenever the ACs describe human-observable
behavior.

1. **Derive the script.** After implementation, read the ticket's acceptance
   criteria and produce a numbered list of "run/do X, expect Y" steps — at
   least one step per AC so every AC is covered. Keep it terse: one line per
   step, no walls of evidence — show supporting evidence only when the human
   asks.
2. **Present to the human.** Show the numbered script and ask the human to work
   through each step, reporting PASS or FAIL (plus optional notes). The human
   may delegate any step's verification back to the Orchestrator; record such
   steps as PASS with a "verified by Orchestrator at the human's request" note
   instead of a bare PASS.
3. **Record the outcome.** Append a comment to the ticket via the existing
   comment mechanism (author `uat`). The body must list each step with its
   expected result, observed result, and per-step verdict, then state the
   overall result (PASS or FAIL).
4. **Gate the done-transition.** A `uat-only` ticket cannot move to `done`
   without a `uat` comment that covers every AC with all steps PASS. A failed
   step sends the ticket back to implementation.

## Notes

- The pointer is intentionally tiny; never store substantive state in it.
- The bundle is self-contained: copying `state/sessions/<active_session_id>/` and
  pointing another machine's `state/session.json` at the same id is enough to
  resume. Tasks travel separately via git in `tasks/`.
- All session writes are atomic (same-directory temp + rename); see
  `state/README.md`.
