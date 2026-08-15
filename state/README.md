# Session State

This directory is how the Orchestrator survives a chat restart. Without it, a new conversation starts cold — with it, the Orchestrator picks up exactly where the previous session paused. The contract has two layers: a tiny **pointer file** at the root, plus a self-contained **bundle directory** for each session.

## Layout

```
state/
├── README.md
├── session.json                            ← v2 pointer file (see below)
├── session.schema.json                     ← JSON Schema for the pointer
├── bundle.schema.json                      ← JSON Schema for each bundle's session.json
└── sessions/
    └── <session-id>/                       ← one bundle directory per session
        ├── session.json                    ← the substantive orchestrator state
        ├── archive.jsonl                   ← optional: append-only rotation archive (see "Compaction" below)
        ├── manifest.json                   ← bundle metadata (created_at, host fingerprint, snapshot flag, …)
        ├── lifecycle.log                   ← append-only JSONL audit trail of pause/resume/end events
        ├── summary.md                      ← human-readable wrap-up (present after session.end)
        ├── transcript.ref.json             ← optional: paths + sha256 of Claude Code transcripts
        ├── transcript.snapshot/            ← optional: copies of those transcripts
        │   └── <original-filename>
        └── artifacts/                      ← optional: free-form attachments
```

Where `<session-id>` matches `^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$`, e.g. `20260524T143015Z-9f2a1b3c`. The format is sortable by creation time and filesystem-safe on Windows (no colons).

## Pointer file (`state/session.json`)

`session.json` at the directory root is the **pointer**. It has exactly three required fields per `session.schema.json`:

- `schema_version` — always `2` for the current contract.
- `active_session_id` — the bundle directory name under `sessions/`, or `null` when idle.
- `updated_at` — RFC 3339 timestamp of the last pointer write.

The pointer is intentionally tiny (well under 200 bytes). Substantive state — `workflow_step`, `handoff_summary`, `next_action`, `open_questions`, `blockers`, `decisions`, `subagent_results` — lives inside the active bundle's `session.json`.

## Bundle directory (`state/sessions/<id>/`)

A bundle is **self-contained**: copying `state/sessions/<id>/` to another machine and pointing that machine's `state/session.json` at the same id is sufficient for a fresh chat to resume. The bundle does NOT carry the task JSONs — tasks travel via git in `tasks/`. The resume path on a new machine is:

1. Read `state/session.json` (pointer).
2. Read `state/sessions/<active_session_id>/session.json` (the per-session state).
3. If `active_task` is non-null, read `tasks/<active_task>.json` to load the work item.
4. Restate `handoff_summary` and `next_action` to the human in one short paragraph and confirm before acting.

That four-step sequence is the **RESUME-FIRST contract** enshrined in `CLAUDE.md`.

### Required vs optional files in a bundle

| File | Required? | Purpose |
|------|-----------|---------|
| `session.json` | **required** | full orchestrator state for the session; validates against `state/bundle.schema.json` |
| `archive.jsonl` | optional | append-only rotation archive written by compaction (see "Compaction" below); absent until the bundle's `decisions`/`subagent_results` first exceed the cap |
| `manifest.json` | **required** | `session_id`, `schema_version` (bundle-layout version), `created_at`, `host` (SHA-256 of hostname), `snapshot_transcript: bool`, `transcript_refs[]` |
| `lifecycle.log` | **required** | one JSONL entry per pause/resume/end event; append-only audit trail |
| `summary.md` | required after `end` | human-readable wrap-up; absent during `active`/`paused` |
| `transcript.ref.json` | optional | paths + sha256 of Claude Code's native transcript files; written when `snapshot_transcript=true` |
| `transcript.snapshot/` | optional | actual copies of the referenced transcript files; written on every `pause` and `end` when opted in |
| `artifacts/` | optional | catch-all for files the orchestrator wants to keep with the session |
| `subagent-log.jsonl` | optional | raw, append-only record of every subagent result, written by the `SubagentStop` hook (see "Subagent result persistence" below); absent until the first subagent finishes while a bundle is active |

The two `schema_version` numbers (pointer/bundle state at `2`, manifest at `1`) track independent dimensions on purpose; see the comment block in `src/schemas.js`.

## Subagent result persistence (`SubagentStop` hook, TASK-219)

Every subagent turn's result is written to disk by a `SubagentStop` hook
(`hooks/persist-subagent.mjs`, pure logic in `src/subagent-log.js`) — this
does **not** depend on the orchestrator being alive to relay the result. The
hook fires on every `SubagentStop` event, reads the payload from stdin, and
appends one JSON record per line to
`state/sessions/<active_session_id>/subagent-log.jsonl` (falling back to
`state/subagent-log.jsonl` when there is no resolvable active bundle).

Each record: `captured_at`, `session_id` (the harness session id — NOT the
bundle id above), `agent_id`, `agent_type`, `ticket`, `last_assistant_message`
(the subagent's final answer for THAT turn, verbatim — no transcript parsing
needed), `agent_transcript_path`, `cwd`, `hook_event_name`. Any string field
that arrives empty or whitespace-only is normalized to `null` (observed in
real payloads — `agent_type: ""` occurs) rather than recorded as if it were a
real value.

**Granularity: one record per TURN, not one per subagent (TASK-219,
structural finding — held across every probe round regardless of sample
size, so it is the fact to design against, not a count worth citing here)**.
`SubagentStop` fires once per assistant turn a subagent completes, not once
per subagent lifetime — a long-lived subagent that is messaged multiple
times (e.g. a persistent teammate) produces multiple `SubagentStop` records,
one per turn, all sharing the same `agent_id`. `agent_id` is stable across a
given subagent's turns and is therefore the correlation key: to reconstruct
"this subagent's full history," filter by `agent_id`; to get "this
subagent's most recent result," take the last record for that `agent_id` by
`captured_at`. Do not assume one line in this file == one subagent.

**Attribution (AC3):** the hook resolves the originating ticket itself,
independent of the payload — it reads the pointer (`state/session.json`),
follows it to the active bundle, and applies this precedence:

1. `active_task`, if it is a non-empty string — use it.
2. else, only when `mode === 'loop'`, `loop_state.current_ticket`, if it is
   a non-empty string — use it.
3. else — `null`.

**Why `active_task` comes first, and why `loop_state.current_ticket` is
gated on loop mode** (fix round, found in live review): `active_task` is a
**required** bundle field (`state/bundle.schema.json`) and is the field the
RESUME-FIRST contract itself treats as authoritative (step 3 of the resume
path above) — it stays current in both `harness` mode (the default,
human-gated, one-step-at-a-time mode) and `loop` mode. `loop_state.current_ticket`
is only ever refreshed by the autonomous drive loop
(`src/loop-checkpoint.js`); in `harness` mode nothing updates it, so it can
sit frozen on whatever ticket a *past* loop run last touched — including a
ticket that has since closed. Reading it unconditionally whenever
`active_task` is `null` (the normal state of a session at rest) would
silently attribute fresh subagent results to a stale, possibly-closed
ticket, which is *worse* than `ticket: null`: `null` honestly says
"unknown," while a stale ticket key confidently asserts something false —
exactly the "absence of evidence rendered as evidence" failure class
`CLAUDE.md`'s Empty-result contract section exists to prevent. Gating step 2
on `mode === 'loop'` confines `loop_state` reads to the one operating mode
where the field is actually kept live.

If there is no active session, the pointer/bundle can't be read, or neither
source resolves, the record is still written with `ticket: null`. Losing
attribution is never a reason to lose the record.

**Blocking vs. persisting only (AC5):** the hook always exits `0`, no matter
what happens internally; any error goes to stderr, never to the exit code. A
`SubagentStop` hook's exit-2 "block" mechanism does not make the missing
record appear — it makes the subagent keep running instead of finishing,
which actively defeats the purpose of this hook (the subagent's turn never
completes, so nothing gets persisted anyway, and the subagent burns more
turns for no benefit). Decided by the human; not exit-2, ever.

**Does this repo run the hook on itself (AC6)?** Yes and no, by layer. This
repo already runs plugin-level hooks — the two `SessionStart` entries in
`hooks/hooks.json` (`repin.mjs`, `settings-migrate.mjs`) — and neither
`.claude/settings.json` nor `.claude/settings.local.json` in this repo
declares its own `hooks` key that would compete with them. So the new
`SubagentStop` entry in `hooks/hooks.json` reaches this repo through the
same plugin channel, in principle. The caveat: an **installed** plugin loads
from the marketplace cache, which only updates from the git **remote** — so
this change does not actually run in this repo's own live sessions until the
plugin is published/updated and the cache picks it up. Same topology caveat
as the MCP-server staleness note elsewhere in this codebase; not something
this ticket can close by itself.

**How this coexists with the bundle's `subagent_results` (AC7):** they are
not the same thing and neither replaces the other.
`subagent-log.jsonl` is the **raw, append-only, machine-written** source of
truth for "what did every subagent turn actually return" — every turn, every
field, `last_assistant_message` in full, no size cap (see "Granularity"
above — this is a per-turn log, not a per-subagent one). The bundle's
`subagent_results` (see the "Compaction" section above — capped at 15
entries, ~1000-char summaries) stays the **orchestrator's curated index**:
a short, human-authored gist for fast session recall, not a durable
archive. If a `subagent_results` entry rotates out of the bundle (or was
never written because the orchestrator wasn't around to relay it),
`subagent-log.jsonl` is where the full record still lives.

## Compaction (bundle hygiene — TASK-103, extended by TASK-110)

`writeBundleSession` (`src/bundle.js`) validates every payload against
`state/bundle.schema.json` (mirrored from `src/schemas.js#bundleStateSchema`)
BEFORE the atomic write, and throws a typed `E_BUNDLE_INVALID` carrying the
ajv error paths on any violation — no invalid payload ever reaches disk. The
schema caps `decisions` and `subagent_results` at 15 entries each
(`maxItems`); this is the enforced size sensor that replaces the free-text
length caps removed from `next_action`/`handoff_summary`/
`subagent_results[].summary` (those stay uncapped — see `src/schemas.js`'s
comment for why capping prose broke real usage instead). TASK-110 found the
same unbounded-growth pattern one level down, inside the otherwise free-form
`loop_state`: `loop_state.beta_findings` now carries `maxItems: 15` and
`loop_state.note` carries `maxLength: 4000` — the same enforced-sensor
treatment, one level down.

`src/bundle-compaction.js#compactBundleSession` (also reachable via
`node dist/loop-ctl.cjs compact-bundle --repo-root <repoRoot>` — see its
`--max-beta-findings`/`--max-note-length` flags) keeps a bundle within every
cap without losing history: it partitions `decisions`/`subagent_results` by
most-recent `at` (keeping the 15 newest), and `loop_state.beta_findings` by
append order (keeping the last 15 — no per-item timestamp to sort by), and
appends everything older to `archive.jsonl` — one JSON object per line,
tagged `type: 'decision' | 'subagent_result' | 'loop_state_beta_finding' |
'loop_state_note'` plus `archived_at`. When `loop_state.note` overflows
`maxLength`, the FULL original string is archived (`type:
'loop_state_note'`, no truncation loss) and the live field is replaced with
a short rotation marker. The archive is append-only (repeated compactions
never rewrite or drop prior lines) and the mechanism is idempotent — a
bundle already within every cap is left untouched (no write, no archive
append). Required fields, `mode`, `loop_auth`, and the current
`handoff_summary` are unaffected by compaction; within `loop_state` itself,
only `beta_findings`/`note` ever rotate — `current_ticket`, `phase`,
`iteration`, `completed_this_run`, and `run_started_at` (the TASK-084
crash-resume checkpoint fields) are always preserved verbatim.

Because `archive.jsonl` lives inside the bundle directory, the bundle stays
self-contained under the "copy the dir" contract above. A knowledge-graph
decision node (`knowledge/graph/graph.json`) whose `ref` names the bare
bundle path (`state/sessions/<id>/session.json`) remains addressable at the
directory level: if the decision isn't in `session.json`'s live `decisions`
array, check `archive.jsonl` next. A node whose `ref` carries a `#<at>`
fragment pointing at an entry that rotated out was repointed (one-time, at
TASK-103) to `archive.jsonl#<at>` so the fragment keeps resolving to the
exact entry.

## Lifecycle operations

Three explicit operations, plus an implicit `start`:

| op | from state | to state | side effects |
|----|------------|----------|--------------|
| `start` (implicit) | no active bundle | `active` | creates bundle dir, writes manifest + initial session.json + start entry in lifecycle.log, sets pointer |
| `pause` | `active` | `paused` | refresh `updated_at`/`handoff_summary`/`next_action`; append lifecycle entry; snapshot transcript if opted in |
| `pause` | `paused` | `paused` (noop) | append idempotent_noop entry; session.json untouched |
| `resume` | `paused` | `active` | refresh `updated_at`; append lifecycle entry |
| `resume` | `active` | `active` (noop) | append idempotent_noop entry |
| `end` | `active`/`paused` | `ended` | write `summary.md`, clear pointer to `null`, append lifecycle entry; snapshot transcript if opted in |
| `end` | `ended` | `ended` (noop) | append idempotent_noop entry; `summary.md` NOT rewritten |
| `pause`/`resume` on `ended` | — | error | refuse with `E_INVALID_TRANSITION`; new session must be started |

All session.json writes use the **atomic same-directory temp + rename** recipe (`src/atomic-write.js`) with a 5×50 ms EBUSY/EPERM retry. On crash mid-write, the orphan tmp survives on disk and the next read calls `src/recovery.js` to promote or delete it.

## Inspection

`src/inspection.js` exposes two read-only helpers:

- `listSessions({ repoRoot })` — returns `Array<{id, created_at, ended_at, lifecycle_state, active_task, workflow_step}>` sorted newest-first. Reads only `manifest.json` + `session.json` from each bundle.
- `showSession({ repoRoot, id })` — returns `{ session_json, summary_md }` for any bundle without changing active state.

Neither mutates anything. The pointer file is not even read by `listSessions`; the operation works independently of which bundle is active.

## v1 → v2 migration

The earliest version of this contract kept everything in a single `state/session.json` with a `version: 1` field. `src/migrate.js#liftV1ToV2` performs the one-shot migration: it creates a new bundle directory, moves the v1 payload into the bundle's `session.json` (renaming `version` → `schema_version`, adding `session_id` and `lifecycle_state`), writes the manifest with `lifted_from_v1: true`, and atomically replaces the pointer file with the v2 shape. The lift refuses to run when `state/sessions/` already contains any directories.
