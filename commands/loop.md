---
description: Goal-driven autonomous drive loop for hivemind. Use this when you want the orchestrator to self-drive the per-ticket workflow toward a stated goal (label or key set) without repeating manual step-by-step instructions. Requires explicit goal confirmation from the human before starting.
---

# /hivemind:loop

Run the goal-driven autonomous drive loop. The loop self-drives the framework's existing per-ticket workflow — read ticket, tier, developer, reviewer, checkpoint — toward a human-stated goal, obeying all five hard-stop gates and surfacing to the human whenever it cannot proceed unilaterally.

> **Distinction from the harness built-in `/loop`:** The built-in `/loop` is a Claude Code harness primitive that keeps a single agent turn running. `/hivemind:loop` is this framework's orchestrator-level control loop: it is goal-driven, ticket-driven, and namespaced to the `hivemind` plugin. The two operate at different abstraction levels and must not be confused.

## OPT-IN requirement

This command does nothing until the human provides an explicit GOAL and confirms. Never start driving without a stated goal and confirmation.

A GOAL is one of:

- `label:<name>` — drive all tickets carrying a given label (e.g. `label:epic-loop-engineering`).
- `keys:<TASK-001,TASK-002,...>` — drive an explicit set of ticket keys.

Present the goal interpretation to the human and ask for a `yes / start / go` confirmation before acquiring the lock or touching any ticket.

## Control flow

### Loop-ctl CLI

All four loop-machinery modules (session-lock, operating-mode, loop-checkpoint,
loop-auth) are invoked exclusively through
`${CLAUDE_PLUGIN_ROOT}/dist/loop-ctl.cjs` — this is what makes the loop
executable on a plugin install, where no framework `src/` exists on disk. Every
subcommand prints one JSON line to stdout: `{"ok":true, ...}` on success, or
`{"ok":false,"code":"...","message":"..."}` on a non-zero exit (`code` names
the failure, e.g. `E_LOCK_HELD`; `message` carries the holder identity for a
lock conflict). The full subcommand contract lives in the orchestrator-routing
SKILL.md's "Loop-ctl CLI" section; this document shows only the call sites.

### Step 1 — Acquire the session lock (TASK-061) and flip to loop mode

Run `node ${CLAUDE_PLUGIN_ROOT}/dist/loop-ctl.cjs acquire --repo-root <repoRoot> [--holder <id>] [--staleness-ms <n>]` before any ticket work begins. In loop mode, pass a longer `--staleness-ms` override (e.g. 30–60 min in ms) so a slow ticket's heartbeat gap doesn't make the lock look abandoned to another session; outside loop mode the default 5-minute window is unchanged.

- If the JSON carries `"code":"E_LOCK_HELD"`: its `message` names the holder's `holder_id` (when the current holder supplied one) alongside its pid and hostname for diagnostics — surface it to the human, and STOP. Do not steal the lock.
- If acquisition succeeds (`"acquired":true`): record the lock in the session bundle so a crash-recovery path can inspect it.
- **Immediately after a successful `acquire`**, run `loop-ctl.cjs set-mode --repo-root <repoRoot> --mode loop`. This records that the session is now autonomously driving, so downstream tooling reading the session bundle can observe it.

**Renew cadence:** run `loop-ctl.cjs renew --repo-root <repoRoot> [--holder <id>]` at every phase boundary, not just once per ticket — after the ticket's `in_progress` transition, after each Developer subagent return, and after each Reviewer subagent return. This keeps the heartbeat fresh across the longest gaps in a ticket's lifecycle (a slow Developer or Reviewer turn) so the lock is never mistaken for stale mid-ticket. If the JSON's `renewed` is `false` (lock absent or foreign), re-acquire.

### Step 1.5 — Crash-resume check (TASK-084)

After the lock is acquired and before the main loop begins, check whether a
prior run of this session crashed mid-ticket:

1. Run `loop-ctl.cjs resume-point --repo-root <repoRoot>` — it reads the active
   bundle and the full task list internally and returns the same
   `{ action, ... }` shape the underlying `resumePoint` decision helper
   produces (there is no separate bundle-read step to perform first).
2. Branch on `action`:
   - **`'resume'`** — a mid-ticket checkpoint was found at a post-commit
     phase (or the ticket was `in_review`). Continue the recorded ticket
     (`result.ticket`) at its recorded `phase`, restoring `iteration`,
     `completed_this_run`, and `run_started_at` from the result **verbatim**
     — these feed `shouldStop` and `consolidationGate` directly so the
     iteration/no-progress/consolidation ceilings survive the restart rather
     than silently resetting to zero.
   - **`'reset'`** — the recorded ticket crashed before any commit landed
     (or its status is otherwise inconsistent with the checkpoint). Transition
     the ticket back to `todo` via `transition_status`, append an explanatory
     `append_comment` citing `result.reason`, and continue to normal ticket
     selection.
   - **`'none'`** — no crash evidence (no `current_ticket` recorded, or the
     recorded ticket is already `done`). Start the next iteration with the
     counters restored from `result` (`iteration`, `completed_this_run`,
     `run_started_at`, verbatim when `loop_state` was present) rather than
     from zero — only `current_ticket` is stale/absent, not the run's
     progress.

`loop-ctl.cjs checkpoint --repo-root <repoRoot> --current-ticket <key> --phase <phase> [--iteration <n>] [--completed-this-run <n>] [--run-started-at <iso>]`
is the writer half of this contract: call it at **every** phase boundary —
after ticket selection, after the Developer subagent returns, after the
Reviewer subagent returns, and after ticket close — passing `--phase` as one of
the `LOOP_PHASES` keys (`idle`, `fetch`, `research`, `test`, `impl`, `review`,
`update`). The subcommand maps `phase` onto the bundle's `workflow_step` enum
via `LOOP_PHASES` and validates it before any I/O (an invalid phase exits
non-zero and touches nothing on disk). This also documents the TASK-071 rule
for any manual orchestrator checkpoint: `workflow_step` must always be set to
an enum-valid value, never a raw phase name that happens not to be in the
enum.

**Ordering is load-bearing:** for a newly selected ticket, always write the
`fetch`-phase checkpoint naming that ticket as `current_ticket` **before**
transitioning it to `in_progress` — never the other way around — because a
crash between the transition and the checkpoint write would leave
`loop_state.current_ticket` pointing at the previous ticket, `resumePoint`
returning `'none'`, and the new ticket stranded `in_progress` yet invisible.

### Step 2 — Loop until done, stopped, or stuck

```
tasks = readAllTasks({ repoRoot })   // FULL list, every status — Read/Glob tasks/*.json
while NOT goalSatisfied(tasks, goal)
      AND NOT shouldStop({ iteration, maxIterations, consecutiveNoProgress, maxNoProgress }).stop:
  ticket = selectNextTicket(tasks, goal)          // from src/drive-loop.js — pass the FULL list, never listReady()'s filtered output (see below)
  if ticket is null:
    if goalStuck(tasks, goal):
      SURFACE to human (see "Stuck handling" below)
      BREAK
    else:
      // No ready ticket yet but not stuck — increment no-progress counter, continue
      consecutiveNoProgress += 1
      tasks = readAllTasks({ repoRoot })   // refresh before the next check
      continue

  // A ready ticket was found — run the standard per-ticket workflow:
  1. Transition ticket to in_progress (transitionStatus)
     -> Renew the session lock (loop-ctl.cjs renew --repo-root <repoRoot>; if the JSON's `renewed` is false, re-acquire)
  2. Spawn the Developer subagent (IMPL or TDD per verification_tier)
     -> Renew the session lock
  3. Spawn the Reviewer subagent (fresh context, read-only)
     - On HIGH finding: loop back to Developer (max 2 retries); on third HIGH, surface and break
     -> Renew the session lock
  4. [HARD-STOP GATE — see below before proceeding to close]
  5. Checkpoint the session bundle
  6. Renew the session lock (final renew before the next iteration's selection)
  tasks = readAllTasks({ repoRoot })   // refresh — statuses changed (e.g. this ticket closed to 'done'), which may unblock dependents
  consecutiveNoProgress = 0  // reset on any progress
  iteration += 1

  check = shouldStop({ iteration, maxIterations, consecutiveNoProgress, maxNoProgress })
  if check.stop:
    LOG check.reason to the session bundle
    SURFACE reason to human
    BREAK
```

**Default backstop values (override in session bundle if needed):**

| Parameter | Default | Meaning |
|---|---|---|
| `maxIterations` | 20 | Hard ceiling on total loop iterations |
| `maxNoProgress` | 3 | Consecutive iterations with no ticket selected before stopping |
| `maxReviewerRetries` | 2 | Maximum times a single ticket bounces back to Developer on HIGH |

### Step 3 — Flip back to harness mode and release the lock (finally-style)

On exit, pause, or any unhandled error — in this order:

1. Run `loop-ctl.cjs set-mode --repo-root <repoRoot> --mode harness` to signal that autonomous driving has ended. Do this **before** releasing the lock so the mode change is recorded while the lock is still held.
2. Run `loop-ctl.cjs release --repo-root <repoRoot> [--holder <id>]` to free the advisory lock.

Both steps are mandatory — a held lock blocks other sessions, and a stale `mode: 'loop'` in the bundle misrepresents the session state.

## The five hard-stop gates

The loop MUST pause and surface to the human at each gate. It may only proceed autonomously if an explicit **standing-authorization switch** (see below) covers that gate.

> **SKILL.md is authoritative.** The gate/switch contract (gate count, gate order, which switch
> lifts which gate, and `LOOP_AUTH_SWITCHES`) is defined canonically in the orchestrator-routing
> skill's "Five hard-stop gates" / "Standing-authorization switches" sections. This document
> mirrors that contract for operational convenience and carries Gate 5's `consolidationGate` call
> detail — if the two ever disagree, SKILL.md wins.

### Gate 1 — Destructive / irreversible operations

Includes: transitioning a ticket to `done` (close-to-done), pushing commits to a remote branch, deleting branches, tagging releases, running database migrations, or any destructive Bash operation.

**Default behavior:** pause before every close-to-done transition and every push. Present what will happen and require `yes` before proceeding.

**Authorization switch:** `auto_close_on_green_review` (close-to-done only); `auto_push_after_close` (push after close).

#### Push guard recipe (TASK-082, AC4)

The close-to-done half of Gate 1 is enforced deterministically inside `close_task`/
`transition_status` via `src/close-guard.js`'s `loopModeCloseGuard` (see the
orchestrator-routing SKILL.md "Ticket-update protocol" section). The **push** half has
no equivalent code seam — `git push` runs as a plain `Bash` tool call, outside the
task-store's write path — so it is enforced instead via a Claude Code `PreToolUse` hook
on the `Bash` tool. This is a **documented recipe**, not shipped code: copy the JSON
below into `.claude/settings.json` (project or user scope) to activate it. It reads the
same pointer/bundle files `loopModeCloseGuard` reads (`state/session.json` →
`state/sessions/<id>/session.json`), but checks `loop_auth.auto_push_after_close`
instead of `auto_close_on_green_review`, and only fires when the Bash command matches
`git push`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node -e \"const fs=require('fs'),path=require('path');let input='';process.stdin.on('data',d=>input+=d);process.stdin.on('end',()=>{let payload;try{payload=JSON.parse(input);}catch{process.exit(0);}const cmd=(payload.tool_input&&payload.tool_input.command)||'';if(!/\\\\bgit\\\\s+push\\\\b/.test(cmd)){process.exit(0);}try{const root=process.cwd();const ptr=JSON.parse(fs.readFileSync(path.join(root,'state','session.json'),'utf8'));const sid=ptr.active_session_id;if(!sid){process.exit(0);}const bundle=JSON.parse(fs.readFileSync(path.join(root,'state','sessions',sid,'session.json'),'utf8'));if(bundle.mode!=='loop'){process.exit(0);}const authed=bundle.loop_auth&&bundle.loop_auth.auto_push_after_close===true;if(authed){process.exit(0);}console.error('Gate 1 (push): loop mode is active and auto_push_after_close is not granted — push blocked. Ask the human to authorize auto_push_after_close, or push manually in harness mode.');process.exit(2);}catch(_err){process.exit(0);}});\""
          }
        ]
      }
    ]
  }
}
```

Notes on the recipe:
- Exit code `2` is Claude Code's "block the tool call" signal; the `stderr` text
  (the `console.error` line) is surfaced back to the model as the block reason.
- Any read failure (no active session, corrupt pointer/bundle, malformed JSON) falls
  through to `process.exit(0)` — **allow** — mirroring `loopModeCloseGuard`'s
  fail-open-to-harness default rather than fail-closed, so a missing/corrupt session
  never wedges an otherwise-legitimate push.
- The matcher fires on every `Bash` call and filters internally to commands matching
  `git push`; non-push Bash calls pass through untouched (`process.exit(0)` before any
  file read).
- This hook is **additive** to, not a replacement for, the human confirmation Gate 1
  otherwise requires — it is the mechanical backstop for the case where the loop tries
  to push without the standing authorization the human actually granted.
- **Coverage caveat:** the `/\bgit\s+push\b/` matcher is a plain-text pattern match on
  the literal `Bash` command string — it does not catch `git -C <dir> push`, shell
  aliases/functions that wrap `push`, or a push issued from inside a script the Bash
  call merely invokes (e.g. `./deploy.sh`). It is a mechanical backstop additive to the
  human gate, not a security boundary — treat it as a convenience net for the common
  case, not a guarantee against every way a push can be issued.

### Gate 2 — UAT verdicts

Tickets with `verification_tier: uat-only` require human-confirmed UAT steps. The loop cannot self-satisfy a UAT verdict because acceptance criteria in the `uat-only` tier are human-observable by definition.

**Default behavior:** present the UAT script to the human, collect per-step PASS/FAIL, record the comment, and only proceed if all steps PASS.

**Authorization switch:** `uat_delegated_to_orchestrator` — the human authorizes the Orchestrator to verify UAT steps on their behalf. Each step so verified is recorded as "PASS — verified by Orchestrator at the human's request".

### Gate 3 — Genuinely ambiguous scope

If the loop cannot resolve which ticket to work on next, or the acceptance criteria are contradictory or under-specified, it must surface the ambiguity and ask for clarification. No autonomous guess is permitted.

**No authorization switch available.** Ambiguity always requires human input.

### Gate 4 — Release / version-bump / publish

Any ticket that would trigger a version bump (`package.json`, `CHANGELOG`, release tag) or a publish step (npm, container registry, artifact upload) is a hard stop.

**Default behavior:** pause, present the exact version / publish action, and require explicit confirmation.

**Authorization switch:** `auto_version_bump_on_milestone` — the human pre-authorizes a specific version bump strategy (e.g. "bump patch on every milestone close").

### Gate 5 — Phase / consolidation checkpoint

An autonomous run must never barrel past a consolidation boundary. After every `consolidateEvery` tickets completed this run (default 5), call `consolidationGate({ completedThisRun, consolidateEvery, autoConsolidate })` from `src/drive-loop.js`; on `stop: true`, pause so the human can consolidate the batch (review what shipped, update the knowledge base / brain graph) before the next phase.

**Authorization switch:** `auto_consolidate` — the human pre-authorizes skipping the consolidation pause.

> Research tickets run their inner round loop via `loopUntilDry({ runRound, maxDryRounds, maxRounds })` — keep searching until K consecutive rounds find nothing new, then stop. The outer drive-loop wraps this.

## Standing-authorization switches

Authorization switches are recorded in the session bundle under `loop_auth` (an object). Absent fields default to `false` (most conservative — all gates ON).

```json
{
  "loop_auth": {
    "auto_close_on_green_review": false,
    "auto_push_after_close": false,
    "uat_delegated_to_orchestrator": false,
    "auto_version_bump_on_milestone": false,
    "auto_consolidate": false
  }
}
```

To grant an authorization: the human must say so explicitly (e.g. "auto-close on green review"). The Orchestrator records the grant in the session bundle and reads `loop_auth` at each gate. Authorization is session-scoped — it does not persist across sessions unless the human re-states it.

### Unattended-mode preset

Instead of granting switches one at a time, the human can make a single up-front grant via
`loop-ctl.cjs grant-unattended --repo-root <repoRoot> [--opt-in <switch>]...` so the loop runs
without per-step supervision. This sets `auto_close_on_green_review`, `uat_delegated_to_orchestrator`, and
`auto_consolidate` to `true`. `auto_push_after_close` and `auto_version_bump_on_milestone` remain
strictly opt-in — pass them via repeated `--opt-in <switch>` flags to lift Gate 1's push or Gate 4 as well. Gate 3 has no
switch and is never liftable, preset or not. See SKILL.md's "Unattended-mode preset" section for
the full contract.

## Stuck handling

The loop is "stuck" when `goalStuck(tasks, goal)` returns true: the goal is not satisfied but `selectNextTicket` returns null because all remaining goal tickets are blocked, in_review, or have unsatisfied dependencies.

On stuck:

1. Log the stuck state to the session bundle (which tickets remain, their statuses, and why none is ready).
2. Surface a clear summary to the human: list the stuck tickets and their blocking conditions.
3. STOP the loop. Do not spin.

## Backstop logging (no silent truncation)

Whenever the loop stops early — due to `shouldStop`, a stuck state, a gate that cannot be lifted, or a reviewer HIGH finding that exhausts retries — the loop MUST:

1. Log the specific stop reason to the session bundle's `artifacts/loop-stop-reason.txt`.
2. Surface the reason to the human in the response.
3. List every ticket that was skipped or not started.

No silent truncation: if the loop ends without satisfying the goal, the human must know why.

## Helper functions (src/drive-loop.js)

The following pure helpers are used internally by the loop logic:

- `matchesGoal(task, goal)` — does the task belong to the goal?
- `selectNextTicket(tasks, goal)` — pick the next ready ticket by priority (critical > high > medium > low) then ascending key.
- `goalProgress(tasks, goal)` — `{ done, total }` over goal-matching tasks.
- `goalSatisfied(tasks, goal)` — true when all goal tasks are done.
- `goalStuck(tasks, goal)` — true when not satisfied and no ticket is selectable.
- `shouldStop({ iteration, maxIterations, consecutiveNoProgress, maxNoProgress })` — backstop check returning `{ stop, reason }`.

These helpers are pure (no I/O, no side effects). The orchestrator MUST pass the FULL task list (every status, read via `Read`/`Glob` on `tasks/*.json` — conceptually `readAllTasks`, not `listReady`) into `selectNextTicket` and `goalStuck` at each iteration. `listReady()` (src/task-store.js) filters its own return value down to `status==='todo'` tasks only, so a 'done' dependency never appears in what it returns; composing `listReady()` into `selectNextTicket` strands any dependent ticket because `depsAreDone` can't find the missing dep key in the array it was given, and — as of TASK-096 — throws rather than silently returning null (see the READINESS comment in `src/drive-loop.js`).

## Notes

- The lock (`state/.lock`) is advisory. If the orchestrator crashes without releasing, the lock expires after the staleness window — 5 minutes by default, or the longer `stalenessMs` override passed at `acquire()` time in loop mode (e.g. 30–60 min). The next session can then acquire it.
- The loop drives the EXISTING per-ticket workflow. It does NOT reimplement the Developer, Reviewer, or UAT steps — it orchestrates them.
- The session bundle is checkpointed after every ticket completes so a crash recovery can resume from the last completed ticket.
- The loop respects `depends_on`: a ticket is not selected until all its dependencies are `done`.
- On any unexpected error (subagent crash, tool failure), the loop surfaces the error and pauses — it does not silently retry indefinitely.
