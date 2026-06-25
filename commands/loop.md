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

### Step 1 — Acquire the session lock (TASK-061) and flip to loop mode

Call `acquire()` from `src/session-lock.js` before any ticket work begins.

- If `E_LOCK_HELD` is raised: read the error message for the holder's pid and hostname, surface it to the human, and STOP. Do not steal the lock.
- If acquisition succeeds: record the lock in the session bundle so a crash-recovery path can inspect it.
- **Immediately after a successful `acquire()`**, call `setMode({ repoRoot, mode: 'loop' })` from `src/operating-mode.js`. This records that the session is now autonomously driving, which the console (TASK-064) surfaces to the human.

### Step 2 — Loop until done, stopped, or stuck

```
while NOT goalSatisfied(tasks, goal)
      AND NOT shouldStop({ iteration, maxIterations, consecutiveNoProgress, maxNoProgress }).stop:
  tasks = listReady({ repoRoot })
  ticket = selectNextTicket(tasks, goal)          // from src/drive-loop.js
  if ticket is null:
    if goalStuck(allTasks, goal):
      SURFACE to human (see "Stuck handling" below)
      BREAK
    else:
      // No ready ticket yet but not stuck — increment no-progress counter, continue
      consecutiveNoProgress += 1
      continue

  // A ready ticket was found — run the standard per-ticket workflow:
  1. Transition ticket to in_progress (transitionStatus)
  2. Spawn the Developer subagent (IMPL or TDD per verification_tier)
  3. Spawn the Reviewer subagent (fresh context, read-only)
     - On HIGH finding: loop back to Developer (max 2 retries); on third HIGH, surface and break
  4. [HARD-STOP GATE — see below before proceeding to close]
  5. Checkpoint the session bundle
  6. Renew the session lock (renew() from src/session-lock.js; if renew returns false, re-acquire)
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

1. Call `setMode({ repoRoot, mode: 'harness' })` from `src/operating-mode.js` to signal that autonomous driving has ended. Do this **before** releasing the lock so the console can observe the mode change while the lock is still held.
2. Call `release()` from `src/session-lock.js` to free the advisory lock.

Both steps are mandatory — a held lock blocks other sessions, and a stale `mode: 'loop'` in the bundle misleads the console.

## The five hard-stop gates

The loop MUST pause and surface to the human at each gate. It may only proceed autonomously if an explicit **standing-authorization switch** (see below) covers that gate.

### Gate 1 — Destructive / irreversible operations

Includes: transitioning a ticket to `done` (close-to-done), pushing commits to a remote branch, deleting branches, tagging releases, running database migrations, or any destructive Bash operation.

**Default behavior:** pause before every close-to-done transition and every push. Present what will happen and require `yes` before proceeding.

**Authorization switch:** `auto_close_on_green_review` (close-to-done only); `auto_push_after_close` (push after close).

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

These helpers are pure (no I/O, no side effects). The orchestrator passes the current task list from `listReady` / `readAllTasks` at each iteration.

## Notes

- The lock (`state/.lock`) is advisory. If the orchestrator crashes without releasing, the lock expires after 5 minutes (default staleness window). The next session can then acquire it.
- The loop drives the EXISTING per-ticket workflow. It does NOT reimplement the Developer, Reviewer, or UAT steps — it orchestrates them.
- The session bundle is checkpointed after every ticket completes so a crash recovery can resume from the last completed ticket.
- The loop respects `depends_on`: a ticket is not selected until all its dependencies are `done`.
- On any unexpected error (subagent crash, tool failure), the loop surfaces the error and pauses — it does not silently retry indefinitely.
