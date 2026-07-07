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

The two `schema_version` numbers (pointer/bundle state at `2`, manifest at `1`) track independent dimensions on purpose; see the comment block in `src/schemas.js`.

## Compaction (bundle hygiene — TASK-103)

`writeBundleSession` (`src/bundle.js`) validates every payload against
`state/bundle.schema.json` (mirrored from `src/schemas.js#bundleStateSchema`)
BEFORE the atomic write, and throws a typed `E_BUNDLE_INVALID` carrying the
ajv error paths on any violation — no invalid payload ever reaches disk. The
schema caps `decisions` and `subagent_results` at 15 entries each
(`maxItems`); this is the enforced size sensor that replaces the free-text
length caps removed from `next_action`/`handoff_summary`/
`subagent_results[].summary` (those stay uncapped — see `src/schemas.js`'s
comment for why capping prose broke real usage instead).

`src/bundle-compaction.js#compactBundleSession` (also reachable via
`node dist/loop-ctl.cjs compact-bundle --repo-root <repoRoot>`) keeps a
bundle within both caps without losing history: it partitions each array by
most-recent `at`, keeps the 15 newest in `session.json`, and appends
everything older to `archive.jsonl` — one JSON object per line, tagged
`type: 'decision' | 'subagent_result'` plus `archived_at`. The archive is
append-only (repeated compactions never rewrite or drop prior lines) and the
mechanism is idempotent — a bundle already within both caps is left
untouched (no write, no archive append). Required fields, `mode`,
`loop_auth`, `loop_state`, and the current `handoff_summary` are unaffected
by compaction.

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
