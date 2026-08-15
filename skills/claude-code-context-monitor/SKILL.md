---
name: claude-code-context-monitor
description: >
  Load this skill when implementing context-window monitoring, auto-flush, or
  pause/resume logic in Claude Code. Covers the statusline JSON contract (token
  and percentage fields), the full hook-event catalogue and their absence of
  token data, the PreCompact/PostCompact/SessionStart(compact|clear) snapshot
  pattern, the HANDOFF.md snapshot recipe, and the go/no-go verdict for
  fully-automatic 35%-threshold flushing. Triggers: files named *context-monitor*,
  *autoflush*, *handoff*, *precompact*, or any code reading
  `.context_window.used_percentage` from statusline JSON.
---

# claude-code-context-monitor — Context Usage, Hooks, and Flush Design

## When to Use This Skill

Use when building or extending the context-autoflush feature shipped by the
hivemind plugin (`context-monitor/` scripts), or any feature that reads
live context-window usage, detects a threshold, or orchestrates a
snapshot-clear-resume cycle inside Claude Code.

---

## 1. Context-Usage Measurement

### 1a. Statusline script (authoritative, live token data)

Claude Code pipes a JSON object to a statusline command on stdin after every
assistant message, after `/compact`, and when permission mode toggles.

Key fields (Claude Code >= v2.1.132):

```
context_window.total_input_tokens     — tokens currently in the window (input side)
context_window.total_output_tokens    — output tokens from the most recent turn
context_window.context_window_size    — max window size (200 000 or 1 000 000)
context_window.used_percentage        — pre-calculated %; input-only formula
context_window.remaining_percentage   — 100 - used_percentage
context_window.current_usage          — per-component breakdown (input_tokens,
                                        output_tokens, cache_creation_input_tokens,
                                        cache_read_input_tokens)
exceeds_200k_tokens                   — boolean; fixed 200 k threshold regardless
                                        of actual window size
```

`used_percentage` = (input_tokens + cache_creation_input_tokens +
                    cache_read_input_tokens) / context_window_size * 100

`current_usage` is `null` before the first API call and again immediately after
`/compact` until the next call repopulates it. Handle with `// 0` (jq) or `or 0`
(Python).

The statusline script CANNOT trigger actions (hooks/commands) — it is purely
display output.

### 1b. Hooks — token data availability

No hook event receives token counts or `used_percentage`. This is an open feature
request (GitHub issue #11008, unimplemented as of June 2026). Hook common input
fields are: `session_id`, `transcript_path`, `cwd`, `permission_mode`,
`hook_event_name`. No usage fields.

`agent_id`/`agent_type` (TASK-219 empirical verification, Claude Code
2.1.233): observed present in 4/4 captures of `SubagentStart` and
`SubagentStop`, all for subagents spawned via the `Agent`/Task-spawn tool
(both with and without an explicit `name`). Not tested for forked sessions or
workflow-originated agents, so treat as reliably present for tool-spawned
subagents specifically, not as an unconditional guarantee across every
possible agent-spawning path. `agent_type` returns the spawn's `name` when one
was passed, and the `subagent_type` only when it wasn't — it is not a
trustworthy role identifier on its own. See `src/subagent-log.js` (TASK-219)
for a consumer that treats both fields as possibly-absent regardless.

The complete hook-event catalogue with token-data verdict. **Matcher?**
(added TASK-219) records only what has actually been checked against real
Claude Code behavior or is directly documented elsewhere in this file —
`Unverified` means nobody has confirmed matcher support for that event in
this codebase, not that it lacks one:

| Hook event          | Fires on                        | Can block? | Token/context data? | Matcher? |
|---------------------|---------------------------------|------------|---------------------|----------|
| SessionStart        | startup, resume, clear, compact | No         | No                  | Yes — event-defined values (`startup\|resume\|clear\|compact`) |
| Setup               | init, maintenance               | No         | No                  | Unverified |
| SessionEnd          | clear, resume, logout, other    | No         | No                  | Unverified |
| UserPromptSubmit    | every user prompt               | Yes (exit 2)| No                 | Unverified |
| UserPromptExpansion | slash-command expansion         | Yes        | No                  | Unverified |
| Stop                | Claude finishes a turn          | Yes (exit 2)| No                 | No — Stop does not support a matcher (§7) |
| StopFailure         | API error ends a turn           | No         | No                  | Unverified |
| PreToolUse          | before each tool call           | Yes        | No                  | Unverified |
| PermissionRequest   | permission dialog appears       | Yes        | No                  | Unverified |
| PermissionDenied    | tool denied by auto classifier  | No         | No                  | Unverified |
| PostToolUse         | after tool succeeds             | No*        | No                  | Unverified |
| PostToolUseFailure  | after tool fails                | No         | No                  | Unverified |
| PostToolBatch       | after parallel batch resolves   | Yes        | No                  | Unverified |
| **PreCompact**      | **before compaction**           | **Yes (exit 2)**| **No**         | Yes — `"auto"` / `"manual"` |
| **PostCompact**     | **after compaction**            | **No**     | **No**              | Unverified |
| SubagentStart       | subagent spawned                | No         | No                  | Unverified |
| SubagentStop        | subagent finishes               | **Yes — deliberately NOT used** (TASK-219: exiting 2 keeps the subagent running instead of finishing, which cannot create the missing record and only makes the underlying problem worse; see `hooks/persist-subagent.mjs`, always exits 0) | No | Yes — matches against `agent_type` (TASK-219 empirical verification); the hivemind hook is registered with no matcher so it fires unconditionally |
| TaskCreated/Completed| task lifecycle                 | Yes        | No                  | Unverified |
| TeammateIdle        | team agent idle                 | Yes        | No                  | Unverified |
| InstructionsLoaded  | CLAUDE.md loaded                | No         | No                  | Unverified |
| ConfigChange        | settings file changes           | Yes        | No                  | Unverified |
| FileChanged         | watched file changes            | No         | No                  | Unverified |
| CwdChanged          | working dir changes             | No         | No                  | Unverified |
| WorktreeCreate/Remove| worktree lifecycle             | Yes/No     | No                  | Unverified |
| MessageDisplay      | assistant text displayed        | No         | No                  | Unverified |
| Notification        | system notification             | No         | No                  | Unverified |
| Elicitation/Result  | MCP elicitation                 | Yes        | No                  | Unverified |

**PreCompact** fires with `matcher: "auto"` (automatic compaction) or
`"manual"` (`/compact` command). Its payload is the common fields only — no
token counts. It CAN block compaction by exiting 2, and it CAN write side
effects (e.g., snapshot to HANDOFF.md) before returning.

### 1c. Transcript JSONL parsing

Path: `~/.claude/projects/<project-slug>/<session-id>.jsonl`
(also exposed as `transcript_path` in statusline JSON and hook inputs).

Each line is a JSONL entry. Message entries contain `message.usage` with the
same Anthropic API usage fields (`input_tokens`, `output_tokens`,
`cache_creation_input_tokens`, `cache_read_input_tokens`). A script can tail
this file and compute a running total, but it will lag the live context state
(Claude Code's internal accounting may differ slightly) and requires the session
ID to locate the file.

---

## 2. Flush Trigger Mechanisms

### 2a. What hooks CAN do

- **PreCompact hook (exit 2):** blocks automatic compaction. Use this to
  intercept auto-compaction, write a HANDOFF.md snapshot, then let compaction
  proceed by returning 0, OR exit 2 to suppress compaction entirely.
- **Stop hook (exit 2 + reason):** blocks Claude from finishing a
  turn and injects a system-level message Claude reads. Can instruct Claude to
  write a snapshot file and then type `/clear`. This is model-driven, not
  deterministic — Claude decides whether to comply.
- **SessionStart(compact|clear) hook:** fires after compaction or `/clear`;
  can inject `additionalContext` or `initialUserMessage` to restore context
  from a snapshot.

### 2b. What hooks CANNOT do

- **No hook can programmatically invoke `/clear`.** Hooks are passive
  responders; they cannot issue interactive commands or session lifecycle
  operations.
- **No hook can call `/compact` on the model's behalf.** Same restriction.
- **No hook receives token/usage data** to self-detect the 35% threshold.

### 2c. The shipped auto-flush design (three components)

Three components work together:

**Component A — Statusline threshold indicator**
A statusline script reads `context_window.used_percentage` and displays a
color-coded bar. When usage crosses 35%, it changes color and prints a
prominent warning. This is the reliable, always-accurate signal.

**Component B — Statusline-driven side-effect file (bridge)**
The statusline script writes a flag file (`<cwd>/.claude/context-monitor/.flush-<id>`)
when `used_percentage >= 35`. This file acts as a shared signal between the
display layer and the hook layer.

**Component C — Stop hook polling the flag file**
A `Stop` hook reads the flag file. If it exists, the hook responds with
`decision: "block"` and `reason` instructing Claude to:
1. Write HANDOFF.md (snapshot all in-flight work).
2. Type `/clear`.
The hook writes an instructed sentinel so the instruction fires only once.

**Limitation:** The Stop hook fires after each assistant turn, not instantly
when the threshold is crossed mid-turn. The actual flush happens at the next
turn boundary after the threshold is reached, not at exactly 35%. At 35% this
is acceptable — there is ample headroom before quality degrades.

**Component D — SessionStart(clear|compact) hook restoring HANDOFF.md**
On `/clear` or `/compact`, `SessionStart` with matcher `"clear|compact"` fires.
The hook reads HANDOFF.md and injects it via `hookSpecificOutput.additionalContext`.

---

## 3. Go/No-Go Verdict

**TRUE fully-automatic 35%-flush is NOT achievable today.**

Reason: No hook receives token/usage data, so no hook can detect the 35%
threshold deterministically. The gap requires the model (Claude) to cooperate
when the Stop hook instructs it to flush — this is model-driven, not
deterministic.

**What IS achievable (closest feasible design):**

| Component | Automatable? | Mechanism |
|-----------|-------------|-----------|
| Display % in statusline | Yes, fully | `context_window.used_percentage` |
| Color-code at 35% threshold | Yes, fully | statusline script threshold |
| Write flag file at 35% | Yes, fully | statusline script side-effect |
| Detect flag file at turn end | Yes, fully | Stop hook reads file |
| Write HANDOFF.md snapshot | Yes, via model | Stop hook injects instruction |
| Execute `/clear` | No (model-driven) | Stop hook instructs Claude; model must type it |
| Restore HANDOFF.md after `/clear` | Yes, fully | SessionStart(clear|compact) hook |

**Closest feasible design summary:** Semi-automatic. The threshold detection
and HANDOFF.md snapshot are reliable. The `/clear` execution requires Claude
to follow the hook's instruction, which it reliably does but is not 100%
deterministic. In practice this is one-keystroke or zero-keystroke for the
user in the modal sense: the model types `/clear` without user intervention
if it follows the hook instruction.

---

## 4. HANDOFF.md Snapshot Recipe

Minimal fields for a snapshot that restores context across `/clear`:

```markdown
# HANDOFF.md — Context Snapshot
**Flushed at:** <ISO timestamp>
**Session:** <session_id>
**Context at flush:** <used_percentage>%

## Active Task
<ticket key, acceptance criteria summary>

## Current Progress
<what has been done since last flush>

## Open Questions
<unresolved items>

## Next Action
<exact next step for the resumed session>
```

The Stop hook's `reason` message instructs Claude to write this file. The
SessionStart hook re-injects it.

---

## 5. Shipped Script Contracts

### 5a. statusline.mjs

- Input: statusline JSON on stdin (includes `session_id`, `cwd`, `context_window`).
- Output: one-line color-coded bar + percentage to stdout.
- Side-effect: writes `<cwd>/.claude/context-monitor/.flush-<session_id>` when
  `used_percentage >= THRESHOLD`; removes both sentinels when usage drops below.

### 5b. stop-hook.mjs

- Input: hook JSON on stdin (includes `session_id`, `cwd`).
- Output (armed, not yet instructed):
  `{ "decision": "block", "reason": "<instruction>" }`
  **`reason` is the correct field**; `additionalContext` is silently ignored by Stop.
- Output (not armed OR already instructed): exit 0 silently (no stdout).
- Side-effect: writes `<cwd>/.claude/context-monitor/.instructed-<session_id>`
  on first block to prevent double-instruction.

### 5c. session-start.mjs

- Input: hook JSON on stdin (includes `session_id`, `cwd`).
- Matcher: `clear|compact`
- Output (HANDOFF.md exists):
  ```json
  {
    "hookSpecificOutput": {
      "hookEventName": "SessionStart",
      "additionalContext": "A HANDOFF.md snapshot was found..."
    }
  }
  ```
  **`hookSpecificOutput` envelope is required**; bare top-level `additionalContext`
  is silently ignored by Claude Code for SessionStart.
- Output (no HANDOFF.md): exit 0 silently.
- Side-effect: removes both sentinels from `<cwd>/.claude/context-monitor/`.

### 5d. usage.mjs

Pure functions (no I/O) imported by the three scripts above:
- `THRESHOLD` — 35 (the only magic number)
- `readUsagePercent(data)` — extracts `context_window.used_percentage`
- `shouldFlush(percent, alreadyFlagged)` — pure decision
- `armedFlagName(sessionId)` — returns `.flush-<id>`
- `instructedFlagName(sessionId)` — returns `.instructed-<id>`

---

## 6. Sentinel Location Design

All scripts resolve sentinels from the project `cwd` (read off their stdin JSON),
NOT from `__dirname`. This is the **relocation-safety** requirement:

- `__dirname` would point to the plugin directory (shared across all projects,
  potentially read-only after installation).
- `cwd` points to the consuming project's working directory, which is always
  writable and project-scoped.

Sentinel directory: `<cwd>/.claude/context-monitor/`
This directory is created on demand (no pre-requisite setup).

---

## 7. Settings.json Scaffold (init-project)

The `init-project` scaffold writes/merges `.claude/settings.json` with these
entries (deep-merge, never clobbers pre-existing keys or hooks). **The
hooks.Stop/SessionStart entries use the documented NESTED shape** (TASK-210)
— the command lives inside a `hooks: [...]` array, never directly on the
matcher-group element. Per the official hooks reference: "You cannot place a
handler directly on the matcher group. Handlers must nest inside the hooks
array." A flat `{ "type": "command", "command": ... }` sitting directly on
the array element is invalid settings — `claude doctor` rejects it
(`hooks.Stop.0.hooks: Expected array, but received undefined`) and the hook
never fires. `statusLine` is a *different*, unrelated settings key with a
different (flat, genuinely-honoured) shape — it is not part of the hooks
schema and stays flat.

<!-- SETTINGS-SCAFFOLD-EXAMPLE:START -->
```json
{
  "statusLine": {
    "type": "command",
    "command": "node \"<ABSOLUTE_PLUGIN_ROOT>/context-monitor/statusline.mjs\""
  },
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"<ABSOLUTE_PLUGIN_ROOT>/context-monitor/stop-hook.mjs\""
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "matcher": "clear|compact",
        "hooks": [
          {
            "type": "command",
            "command": "node \"<ABSOLUTE_PLUGIN_ROOT>/context-monitor/session-start.mjs\""
          }
        ]
      }
    ]
  }
}
```
<!-- SETTINGS-SCAFFOLD-EXAMPLE:END -->

Note `Stop` carries no `matcher` key at all — Stop does not support one.
`SessionStart` does, and keeps `matcher: "clear|compact"`.

Projects initialized before this fix carry the old flat shape on disk. They
are migrated automatically, with no user action required, by
`context-monitor/settings-migrate.mjs` — a plugin-level `SessionStart` hook
(registered in `hooks/hooks.json` alongside `repin.mjs`) that rewrites any
legacy flat entry to the nested shape in place on the very next session. See
`src/claude-settings.js`'s `migrateContextMonitorShape` / `mergeContextMonitorSettings`
for the pure migration logic.

`<ABSOLUTE_PLUGIN_ROOT>` is resolved at init time from:
```js
process.env.CLAUDE_PLUGIN_ROOT ?? resolve(fileURLToPath(import.meta.url), '../..')
```
The literal absolute path is baked in — `${CLAUDE_PLUGIN_ROOT}` is NOT
expanded in project-level `settings.json` (see `claude-code-plugin-path-resolution`
skill for the full rationale).

---

## Best Practices

- **Do** use `used_percentage` directly — it is pre-calculated and accurate as
  of Claude Code v2.1.132+. Before v2.1.132, `total_input_tokens` was
  cumulative (not current); check version if deploying on older installs.
- **Do** write the flag file atomically (temp + rename) to avoid race
  conditions on Windows (see `windows-atomic-rename-not-truly-atomic` KB entry).
- **Do** scope the flag file to `session_id` so concurrent sessions don't
  interfere.
- **Do not** rely on PreCompact alone for 35% detection — it fires only when
  Claude Code decides to compact (typically much later than 35%).
- **Do not** use PostToolUse for threshold checking — it fires per tool call,
  not per turn, and does not have token data.
- **Do not** use `exceeds_200k_tokens` as the threshold signal — it is a hard
  200 k boolean, not configurable.

---

## Common Pitfalls

- **`current_usage` is null after `/compact`:** guard with `|| 0` before the
  next API call repopulates it.
- **Statusline fires on events, not on a timer:** during long tool-only turns,
  the statusline may not update. Set `refreshInterval: 5` in settings to poll.
- **Stop hook always blocking:** gate the `"block"` decision on the flag file
  existence. A hook that unconditionally returns block creates an infinite loop.
- **Hook not firing:** check `disableAllHooks: false` in settings. The statusline
  is also disabled when `disableAllHooks: true`.
- **`reason` vs `additionalContext`:** Stop hook uses `{ decision, reason }`.
  SessionStart uses `hookSpecificOutput.additionalContext`. These are NOT
  interchangeable — using the wrong field causes silent no-ops.

---

## References

- [Statusline docs](https://code.claude.com/docs/en/statusline) — full JSON schema and field descriptions.
- [Hooks reference](https://code.claude.com/docs/en/hooks) — all hook events, input contracts, output contracts.
- [GitHub issue #11008](https://github.com/anthropics/claude-code/issues/11008) — open request to add token data to hook inputs (unimplemented).
- [GitHub issue #13783](https://github.com/anthropics/claude-code/issues/13783) — bug: statusline `context_window` pre-v2.1.132 was cumulative, not current.
- [Context handoff repo](https://github.com/who96/claude-code-context-handoff) — community PreCompact+SessionStart snapshot pattern.

---

## Provenance

- **Authored by:** Developer subagent on behalf of ticket `TASK-008`.
- **Primary sources:**
  - https://code.claude.com/docs/en/statusline
  - https://code.claude.com/docs/en/hooks
  - https://github.com/anthropics/claude-code/issues/11008
  - https://github.com/anthropics/claude-code/issues/13783
  - https://github.com/who96/claude-code-context-handoff
- **Last verified:** 2026-06-17.
- **TASK-219 update (2026-08-15):** `agent_id`/`agent_type` presence and the
  SubagentStop matcher/block-vs-persist findings (§1b) are empirical, against
  Claude Code 2.1.233, captured live via a real hook probe (not from docs) —
  see `src/subagent-log.js` and `state/README.md`'s "Subagent result
  persistence" section for the consumer built on these findings.
