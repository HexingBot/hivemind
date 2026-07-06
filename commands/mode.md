---
description: Manually flip the operating mode of the active session between 'harness' (default, human-gated, one-step-at-a-time) and 'loop' (autonomous drive loop). Use this when you need to override the mode outside of the loop command — e.g. to reset a stale 'loop' mode after a crash, or to prime the mode before inspecting state.
---

# /hivemind:mode

Manually set the operating mode of the active session.

## Usage

```
/hivemind:mode harness
/hivemind:mode loop
```

Or with no argument to **toggle** the current mode:

```
/hivemind:mode
```

## What it does

Invokes the `set-mode` subcommand of `${CLAUDE_PLUGIN_ROOT}/dist/loop-ctl.cjs` — the CLI wrapper around `setMode`/`getMode` (see the "Loop-ctl CLI" section of the orchestrator-routing SKILL.md) — to write the requested mode into the active bundle's `session.json` via the existing atomic-write helper. The change is immediately visible via the `get-mode` subcommand and through the `mode` field on the session bundle.

## Valid modes

| Mode | Meaning |
|---|---|
| `harness` | Default. Human-gated, one-step-at-a-time orchestrator workflow. |
| `loop` | Autonomous drive loop is (or was) running. |

Any other value is rejected with an error.

## When to use this

- **Crash recovery**: if the autonomous loop (`/hivemind:loop`) crashed without releasing cleanly, the bundle may be stuck at `mode: 'loop'`. Run `/hivemind:mode harness` to reset it.
- **Pre-flight inspection**: prime the mode to `loop` before manually stepping through the drive loop's sequence to test gate behavior.
- **Ad-hoc toggle**: flip between modes without starting the full loop sequence.

## Notes

- The mode auto-flips during a normal `/hivemind:loop` run: `loop` after `acquire()` succeeds, `harness` before `release()`. Manual use of this command outside the loop is only needed for recovery or testing.
- `setMode` is idempotent: setting the same mode twice does not throw.
- Requires an active session (non-null `active_session_id` in `state/session.json`). If there is no active session this command will fail with an error.

## Implementation

```
# Toggle: read the current mode, then set the opposite.
node ${CLAUDE_PLUGIN_ROOT}/dist/loop-ctl.cjs get-mode --repo-root <repoRoot>
# -> {"ok":true,"mode":"harness"}  (invert 'harness'<->'loop' and pass it below)
node ${CLAUDE_PLUGIN_ROOT}/dist/loop-ctl.cjs set-mode --repo-root <repoRoot> --mode loop

# Explicit:
node ${CLAUDE_PLUGIN_ROOT}/dist/loop-ctl.cjs set-mode --repo-root <repoRoot> --mode harness
node ${CLAUDE_PLUGIN_ROOT}/dist/loop-ctl.cjs set-mode --repo-root <repoRoot> --mode loop
```

Each invocation prints a single JSON line to stdout — `{"ok":true,"mode":"..."}` on
success, or `{"ok":false,"code":"E_ARGS","message":"..."}` (non-zero exit) when
`--mode` is missing/invalid or no active session exists.
