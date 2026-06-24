# TASK-004 — Design Research: Portable Session Bundles, Lifecycle, and Lessons-Learned KB

## Executive summary

TASK-004 introduces three coupled artifacts on top of the existing harness: (1) a per-session **bundle directory** under `state/sessions/<session-id>/` that is self-contained and copyable between machines, (2) **lifecycle operations** (`pause` / `resume` / `end`) backed by same-directory atomic temp+rename writes with idempotent state transitions, and (3) a portable **lessons-learned knowledge base** under `knowledge/` that the Researcher subagent must consult before web search. The existing `state/session.json` is demoted to a tiny **pointer file** (active session id + schema version + updated_at); the substantive orchestrator state moves into the active bundle. Claude Code's native transcript files stay untouched — the bundle merely references them by absolute path, with an opt-in snapshot for cross-machine portability. On Windows the only sharp edge is that Node's `fs.rename` over an existing destination is not strictly atomic; we mitigate by writing temp files in the same directory and accepting "last writer wins" semantics, with an optional lockfile for the multi-chat case (recommended **against** at this stage — see §C). All file effects are plain JSON + Markdown; no new runtime dependencies are required.

---

## A. Session bundle layout

### Recommended directory structure

```
state/
├── session.json                       # v2 pointer file (see §B)
├── session.schema.json                # JSON Schema for the pointer file
├── README.md
└── sessions/
    └── <session-id>/                  # one bundle per session
        ├── session.json               # required: full orchestrator state (same shape as today's v1)
        ├── session.schema.json        # optional: copy of the bundle-state schema, for portability
        ├── summary.md                 # required after `session.end`; absent during active/paused
        ├── lifecycle.log              # required: append-only JSONL of pause/resume/end events
        ├── manifest.json              # required: bundle metadata (id, created_at, schema_versions, host fingerprint, transcript refs)
        ├── transcript.ref.json        # optional: pointer(s) to Claude Code transcript file(s) by absolute path
        ├── transcript.snapshot/       # optional: copy of the referenced transcript file(s) when --snapshot-transcript was set
        │   └── <original-filename>
        └── artifacts/                 # optional: free-form attachments (research docs, screenshots) the orchestrator drops in
            └── ...
```

| File | Required? | Purpose |
|------|-----------|---------|
| `session.json` | **Required** | Full orchestrator state. Same shape as the existing v1 `state/session.json`, with an added `session_id` field. |
| `manifest.json` | **Required** | Bundle metadata: `session_id`, `schema_version` (bundle layout version), `created_at`, `host` (machine fingerprint at creation time, informational only), `transcript_refs[]`, `snapshot_transcript: bool`. |
| `lifecycle.log` | **Required** | JSONL audit trail. One line per lifecycle op: `{at, op, from_step, to_step, idempotent_noop: bool}`. Append-only. |
| `summary.md` | **Required after `end`** | Human-readable wrap-up. Absent until `session.end` runs. |
| `transcript.ref.json` | Optional | `{ "claude_code_transcripts": [{"path": "<abs>", "exists_at_capture": true, "sha256": "..."}] }`. |
| `transcript.snapshot/` | Optional | Copy of the transcript file(s) when the user opts in to bundle portability. |
| `artifacts/` | Optional | Catch-all for files the orchestrator wants to keep alongside the session. |
| `session.schema.json` | Optional | A drop-in copy so the bundle is interpretable without the parent repo. Trade-off: duplication. Recommendation: **include**, because the bundle is meant to survive on its own. |

### `<session-id>` format

**Recommendation:** `YYYYMMDDTHHMMSSZ-<8-hex>` where the hex is a random 32-bit suffix (e.g., `20260524T143015Z-9f2a1b3c`).

- **Sortable** lexicographically by creation time (the `session.list` output is then a free directory listing).
- **Collision-resistant** under the same second (2^32 random suffix; practically zero clash risk for a single human + handful of agents).
- **No PII**; no host or user name embedded.
- **Filesystem-safe on Windows** — no colons (which is why we use `YYYYMMDDTHHMMSSZ`, not ISO-8601 with colons).

**Alternative rejected:** UUIDv7. Has the same monotonic-time property but is 36 chars including hyphens, less human-readable in a directory listing, and adds a dependency on a UUID generator. Plain timestamp+hex is enough.

**Alternative rejected:** monotonic integer (`session-0001`). Requires a coordination point (a counter file); two machines reusing the same repo via git could collide.

### What "self-contained" means

A fresh chat on a different machine, given **only** the bundle directory copied somewhere and `state/session.json` pointer rewritten to its id, must be able to resume. Minimum file set for that:

1. `manifest.json` — tells the new chat which schema versions to read.
2. `session.json` — the actual state (`active_task`, `workflow_step`, `next_action`, `handoff_summary`, etc.).
3. `lifecycle.log` — so resume can validate the last known step.

Optional but recommended on cross-machine moves:

4. `transcript.snapshot/<file>` — only if the user opted in. Without it, the new chat has no verbatim history beyond `handoff_summary`; with it, the orchestrator can read the snapshot as a reference (it does **not** become Claude Code's active transcript on the new machine).

The pointer file `state/session.json` outside the bundle is **not** part of the bundle; it is the per-clone "which bundle is active" indirection.

---

## B. Pointer file (`state/session.json` v2)

### Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://hivemind.local/state/session.schema.json",
  "title": "SessionPointer",
  "description": "Pointer file. Names the currently-active session bundle under state/sessions/. Read first on every new chat.",
  "type": "object",
  "required": ["schema_version", "active_session_id", "updated_at"],
  "additionalProperties": false,
  "properties": {
    "schema_version": { "const": 2 },
    "active_session_id": {
      "type": ["string", "null"],
      "pattern": "^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$",
      "description": "ID of the bundle under state/sessions/. Null = no active session (idle between sessions)."
    },
    "updated_at": { "type": "string", "format": "date-time" }
  }
}
```

Fields:

- `schema_version` — `const: 2`. Distinguishes the pointer file from a v1 single-file state.
- `active_session_id` — `null` when idle; otherwise the bundle id under `state/sessions/`.
- `updated_at` — RFC 3339 timestamp of the last pointer write.

Notably **absent**: `active_task`, `workflow_step`, `handoff_summary`, etc. Those all moved into `state/sessions/<id>/session.json`. This keeps the pointer file under 200 bytes and means the resume path is two reads (pointer → bundle/session.json) instead of one.

### v1 → v2 migration / detection rule

A new chat reads `state/session.json` and inspects the top-level keys:

| Detection rule | Outcome |
|---------------|---------|
| Has key `schema_version` with value `2`, **and** has key `active_session_id` | Treat as v2. Proceed: if `active_session_id` is non-null, read `state/sessions/<id>/session.json`. |
| Has key `version` with value `1`, **and** has keys `workflow_step`/`handoff_summary` | Treat as v1. Perform the lift (below). |
| File is missing entirely | Treat as fresh repo, emit a v2 pointer with `active_session_id: null`. |
| Anything else | Hard error. Refuse to mutate; surface to human. |

**Safe lift to v2** (read-only inspection first, then exactly two writes):

1. Generate a new `<session-id>` using §A's format, but with the timestamp set to the v1 file's `updated_at` so the lifted bundle preserves chronology.
2. Create `state/sessions/<session-id>/` and write into it:
   - `session.json` = the v1 payload verbatim, with an added `session_id` field and `version` bumped to `2` for the bundle-state schema.
   - `manifest.json` with `created_at = v1.updated_at`, `lifted_from_v1: true`.
   - `lifecycle.log` with a single entry: `{"at": <now>, "op": "migrate_v1", "from_step": "<v1.workflow_step>", "to_step": "<same>", "idempotent_noop": false}`.
3. Atomically replace `state/session.json` with the new v2 pointer that names this bundle.
4. The original v1 content is preserved verbatim inside the bundle, so the migration is reversible by hand.

This lift runs at most once per repo. The Developer should guard it with an explicit "I am about to migrate" log line so it's not silently mutating state.

---

## C. Lifecycle operations

Three operations: `session.pause`, `session.resume`, `session.end`. Plus implicit `session.start` (creating a new bundle when there is no active one).

### State transitions on `workflow_step`

The existing enum is `idle | fetch | research | test | impl | review | update`. Lifecycle ops layer an orthogonal **lifecycle state** so we do not collide with workflow steps. Recommendation: add a sibling field `lifecycle_state` to the bundle's `session.json`:

```
lifecycle_state ∈ { "active", "paused", "ended" }
```

| Op | Pre-state | Post-state | Side effects |
|----|-----------|------------|--------------|
| `start` (implicit) | no active bundle / pointer null | `active` | creates bundle dir, writes manifest, sets pointer |
| `pause` | `active` | `paused` | refresh `updated_at`, `handoff_summary`, `next_action`; append `lifecycle.log` |
| `pause` | `paused` | `paused` (no-op) | append `lifecycle.log` with `idempotent_noop: true`; no rename |
| `pause` | `ended` | error (refuse) | logged, surfaced to human |
| `resume` | `paused` | `active` | refresh `updated_at`; append `lifecycle.log` |
| `resume` | `active` | `active` (no-op) | append `lifecycle.log` with `idempotent_noop: true` |
| `resume` | `ended` | error (refuse) | a new session must be started instead |
| `end` | `active` or `paused` | `ended` | write `summary.md`, refresh `updated_at`, append `lifecycle.log`, clear pointer (`active_session_id: null`) |
| `end` | `ended` | `ended` (no-op) | append `lifecycle.log` with `idempotent_noop: true`; `summary.md` is **not** rewritten |

### Fields refreshed on every successful (non-noop) lifecycle write

- `updated_at` — RFC 3339, set fresh.
- `lifecycle_state` — set to the new state.
- `handoff_summary` — caller-supplied; lifecycle op fails fast if missing on `pause` or `end` (we never want a paused/ended bundle with stale handoff text).
- `next_action` — caller-supplied on `pause`; cleared on `end`.

### Atomic write recipe (Windows-first)

Standard same-directory temp + rename:

```
target = state/sessions/<id>/session.json
tmp    = state/sessions/<id>/session.json.tmp.<pid>.<rand>

1. Serialize JSON to bytes.
2. Open tmp with exclusive create (O_CREAT|O_EXCL on POSIX, CREATE_NEW on Windows).
3. Write all bytes.
4. fsync(tmp)              # flush to disk; on Windows this maps to FlushFileBuffers.
5. close(tmp).
6. rename(tmp, target)     # atomic on POSIX; on Windows, see pitfall below.
7. (Best effort) fsync(parent dir on POSIX). No-op / not exposed on Windows.
```

#### Windows pitfalls (must be called out for the Developer)

1. **`fs.rename` over an existing file on Windows is not strictly atomic.** Internally it uses `MoveFileEx(MOVEFILE_REPLACE_EXISTING)`, which is a sequence of operations rather than a single atomic swap. For our case (single-writer per bundle), the practical risk is small: a crash between unlink-of-target and rename-of-tmp can leave the target missing but the tmp present, so a recovery routine on the next resume should sweep for `*.tmp.*` siblings of `session.json` and treat them as recovery candidates. Argue against using `ReplaceFile` directly because it adds a native dependency; document the recovery sweep instead. ([Node issue #835](https://github.com/jprichardson/node-fs-extra/issues/835))
2. **File handles from antivirus / Windows Defender** can briefly hold a write lock on the freshly-closed temp file, causing `rename` to fail with `EBUSY`. Recommended mitigation: retry the rename up to 5 times with 50ms backoff. Do not silently swallow other error codes.
3. **Path length** — on Windows without long-path support, total path can exceed `MAX_PATH` (260 chars). Our bundle ids are ~24 chars; the deepest path is `state/sessions/<id>/transcript.snapshot/<orig>`. Recommend documenting that the repo should be cloned to a path that leaves at least 80 chars of headroom.
4. **Trailing-dot filenames** are illegal on Windows. Our temp pattern uses random hex, not dots-only suffixes, so we're safe.

### Idempotency detection rule

Before writing, read the bundle's current `lifecycle_state`. If `op == "pause" && state == "paused"` (or analogous for the other ops), append to `lifecycle.log` with `idempotent_noop: true` and **do not** touch `session.json`. The lifecycle log is the audit trail; `session.json` is unchanged.

### Failure modes and the lockfile question

| Failure | Detection on next run | Recovery |
|---------|----------------------|----------|
| Crash mid-write (tmp present, target untouched) | sweep finds `session.json.tmp.*` next to a valid `session.json` | delete the tmp; log a `recovery` event |
| Crash mid-write (tmp present, target missing on Windows due to non-atomic rename) | `session.json` missing but tmp present | **promote** the tmp to target after validating it parses as the bundle-state schema; log a recovery event |
| Crash mid-rename leaves both | impossible on POSIX; on Windows, possible if antivirus held a handle | newest mtime wins; log a warning |
| Two chats opened against the same bundle | second chat's `updated_at` overwrites the first | see lockfile discussion below |

**Lockfile recommendation:** **No lockfile at this stage.** Reasoning:

- The expected use case is a single human running one Claude Code chat at a time per machine.
- A real lockfile needs stale-lock detection (PID + host fingerprint + heartbeat) to avoid orphaning a session after a crash, which is a non-trivial amount of code for a low-probability concern.
- The atomic-rename invariant already guarantees no torn writes; the worst case is "last writer wins on the field set," which matches user mental model ("the chat I'm typing into right now is authoritative").
- We **should** record a `host` fingerprint in `manifest.json` and have `resume` log a warning if the host changed since last write — a cheap heuristic for detecting accidental concurrent use.

If multi-chat collaboration becomes a real workflow, revisit and add a lockfile with `proper-lockfile` semantics. Flagged as an open question in §I.

---

## D. End-of-session `summary.md`

### Sections

```markdown
# Session <session-id>

## Dates
- Started: <created_at>
- Ended:   <ended_at>
- Active duration: <hh:mm:ss>           # sum of (resume..pause/end) windows from lifecycle.log
- Paused duration: <hh:mm:ss>

## Active task
- <TASK-KEY>: <title>                   # from active_task at end-time
- Final workflow_step: <step>

## Tasks touched
- <TASK-KEY>: <title>                   # union of every active_task value seen in lifecycle.log + subagent_results

## Commits referenced
- <sha> — <task-key>                    # sourced as below

## Lifecycle timeline
| at | op | from → to | noop? |
| --- | --- | --- | --- |
| ... | ... | ... | ... |

## Subagent invocations
- <agent> @ <at> — <one-line summary>

## Decisions
- <at>: <decision> — <rationale>

## Open threads
<orchestrator-supplied; copied verbatim from session.json `open_questions`>

## Unresolved blockers
<orchestrator-supplied; copied verbatim from session.json `blockers`>

## Pending human confirmation at end-of-session
<copied from session.json `pending_human_confirmation`, or "none">
```

### Auto-derived vs. orchestrator-supplied

| Section | Source |
|---------|--------|
| Dates, active/paused duration | derived from `lifecycle.log` |
| Active task, final workflow_step | from `session.json` |
| Tasks touched | union of all `active_task` values in `lifecycle.log` events + `subagent_results.artifacts` |
| Commits referenced | derived (see below) |
| Lifecycle timeline | rendered directly from `lifecycle.log` |
| Subagent invocations | from `session.json.subagent_results` |
| Decisions | from `session.json.decisions` |
| **Open threads** | **orchestrator-supplied** via `session.json.open_questions` — orchestrator must populate before calling `end` |
| **Unresolved blockers** | **orchestrator-supplied** via `session.json.blockers` |

### Commits referenced — sourcing

This is **not** a git operation. Source it by:

1. Enumerate the union of tasks touched during the session.
2. For each, read `tasks/<TASK-KEY>.json` and pull `linked_commits[]`.
3. Render `<sha> — <task-key>` rows.
4. If a task was touched but has no linked commits at end-time, render `<task-key>: (no commits)`.

This means `commits referenced` is best-effort — it reflects what the orchestrator has wired up so far via TASK-001's update step. That's intentional: the session summary should not run git itself.

---

## E. Inspection commands

These are **orchestrator-level operations** (functions the orchestrator invokes by reading files via its existing tools), not OS commands. Naming: `session.list` and `session.show <id>`.

### `session.list`

- **Reads:** `state/sessions/` directory listing; `state/sessions/<id>/manifest.json` and `state/sessions/<id>/session.json` for each entry.
- **Prints:** a table with columns `id | created_at | ended_at | lifecycle_state | active_task | workflow_step`.
- **Must NOT mutate** anything. Read-only.
- Sort order: newest `created_at` first.
- Pointer file is **not** read by `session.list`; this operation works independently of which bundle is active.

### `session.show <id>`

- **Reads:** `state/sessions/<id>/session.json` and `state/sessions/<id>/summary.md` (if present).
- **Prints:** the parsed `session.json` (pretty-printed JSON or a structured view) followed by `summary.md` verbatim.
- **Must NOT mutate** the pointer or anything inside any bundle.
- If `summary.md` is absent (active or paused session), prints "Session is still <state>; no summary yet." instead.

Failure modes: unknown `<id>` → error. `<id>` matches but bundle is malformed (missing `session.json`) → error with a pointer to the recovery sweep.

---

## F. Knowledge base under `knowledge/`

### Directory layout

**Recommended:**

```
knowledge/
├── README.md                  # human-facing: what is this, how do I add an entry
├── schema.md                  # human-readable schema doc
├── schema.json                # JSON Schema for frontmatter (machine-checkable)
└── entries/
    └── <id>.md                # one entry per file, flat
```

**Why flat, not sharded by tag:** entries are referenced by id (the frontmatter `id` field, which must match the filename minus `.md`). Tag-sharding would force entries with multiple tags into either duplication or symlinks; portability across OSes (Windows symlink semantics differ) makes that fragile. Tags live in frontmatter and are the unit of search, not directory placement. **Alternative rejected:** sharding by date (`entries/2026/05/<id>.md`) — adds path depth for no lookup benefit when grep is the lookup primitive.

**Entry id format:** kebab-case slug, e.g., `windows-atomic-rename-not-truly-atomic.md`. Stable, human-meaningful, copy-pasteable across projects. Must match `^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$`.

### Frontmatter schema

```yaml
---
id: windows-atomic-rename-not-truly-atomic            # required, string, matches filename
problem: >                                             # required, string, one-paragraph
  Node's fs.rename on Windows is not strictly atomic when the destination exists,
  because MoveFileEx is a multi-step operation.
symptoms:                                              # required, array of strings, >=1
  - "EBUSY on rename"
  - "Target file briefly missing after crash"
solution: >                                            # required, string, markdown allowed
  Write to a same-directory tmp file, fsync, rename, and on the next read
  sweep for orphaned `*.tmp.*` siblings and promote them if the target is missing.
tags: [windows, atomic-write, filesystem]              # required, array of strings, >=1, lowercase-kebab
projects: [hivemind]                          # required, array of strings, >=1
created_at: "2026-05-24T00:00:00Z"                     # required, RFC 3339
last_seen_at: "2026-05-24T00:00:00Z"                   # required, RFC 3339, updated on reuse
source_urls:                                           # optional, array of strings (URLs)
  - "https://github.com/jprichardson/node-fs-extra/issues/835"
supersedes: []                                         # optional, array of entry ids
superseded_by: null                                    # optional, entry id or null
---

Body — extended prose, examples, anti-patterns. MUST NOT contain absolute filesystem
paths or repo-specific paths. Refer to files generically: "the session bundle's
session.json", not "C:\Users\srpar\...".
```

JSON Schema fragment:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://hivemind.local/knowledge/schema.json",
  "title": "KnowledgeEntryFrontmatter",
  "type": "object",
  "required": ["id", "problem", "symptoms", "solution", "tags", "projects", "created_at", "last_seen_at"],
  "additionalProperties": false,
  "properties": {
    "id": { "type": "string", "pattern": "^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$" },
    "problem": { "type": "string", "minLength": 10, "maxLength": 1000 },
    "symptoms": { "type": "array", "minItems": 1, "items": { "type": "string", "minLength": 1 } },
    "solution": { "type": "string", "minLength": 10 },
    "tags": { "type": "array", "minItems": 1, "items": { "type": "string", "pattern": "^[a-z0-9][a-z0-9-]*$" } },
    "projects": { "type": "array", "minItems": 1, "items": { "type": "string", "minLength": 1 } },
    "created_at": { "type": "string", "format": "date-time" },
    "last_seen_at": { "type": "string", "format": "date-time" },
    "source_urls": { "type": "array", "items": { "type": "string", "format": "uri" } },
    "supersedes": { "type": "array", "items": { "type": "string" } },
    "superseded_by": { "type": ["string", "null"] }
  }
}
```

### Lookup contract (deterministic — testable)

When the Researcher subagent is spawned with a focused question, **before any web search**, it MUST execute the following procedure:

1. **Tokenize the question.** Lowercase; split on whitespace and punctuation; drop English stopwords (a fixed short list, e.g., `the, a, an, of, to, for, in, on, with, and, or, is, are`); keep tokens of length ≥ 3.
2. **First pass — tag match.** Grep `knowledge/entries/*.md` for any token appearing in the frontmatter `tags:` block. Collect candidate ids.
3. **Second pass — symptom match.** Grep `knowledge/entries/*.md` for any token appearing in the frontmatter `symptoms:` block. Collect candidate ids.
4. **Third pass — problem/body match.** Grep `knowledge/entries/*.md` for any token in body or `problem:`. Collect candidate ids.
5. **Score and rank.** Candidate score = (#tag hits × 3) + (#symptom hits × 2) + (#body hits × 1).
6. **Read the top-3 candidates** (by score, breaking ties by most recent `last_seen_at`). For each one read, the Researcher reports it in its output as a `kb_hit`.
7. **Decide.** If any read entry's `solution` answers the question, the Researcher returns that answer citing the entry id and **skips** web research. The Orchestrator updates `last_seen_at` (see below).
8. **Otherwise** proceed to web research per the existing process, and after synthesizing the answer, the Researcher **proposes** a new entry (does not write it directly — the Orchestrator/human approves before commit).

This procedure is deterministic given the same `knowledge/` contents and the same tokenizer, which makes it testable: given a fixed entry set and a fixed question, the candidate list is reproducible.

### Export bundle format

"Drop knowledge/ into another project" means literally:

1. Copy the entire `knowledge/` directory tree.
2. The receiving project gets a working KB immediately with no edits required, **provided** entry bodies follow the no-absolute-paths rule.

**What needs stripping/transforming on export:** essentially nothing if the body rule is enforced. The only field that is project-relative is `projects`, which lists the projects an entry has been validated in. On export this is **kept**, not stripped — it's useful provenance ("this lesson was learned in hivemind"). On import, the receiving project may **append** itself to `projects` on first reuse. Frontmatter linting at commit time should reject any body containing `C:\`, `/Users/`, `/home/`, or `\\?\` (a small fixed deny-list); this is the enforcement point for portability.

**Optional `knowledge/export.json` manifest** — recommended on export: a single JSON file listing entry ids + their `created_at` + their checksum, so the importing project can detect drift. Generated on demand; not stored permanently.

### `last_seen_at` update mechanics

- **When:** the moment a Researcher invocation **uses** an entry to answer a question (i.e., step 7 above resolved to "yes, this entry answered it"). Pure candidate-list inclusion is **not** a reuse.
- **By whom:** the **Orchestrator**, not the Researcher. The Researcher returns its `kb_hit` list with a `used: true|false` flag; the Orchestrator performs the atomic write on the entry file (rewrite frontmatter, preserve body) using the same same-directory tmp+rename recipe as session writes. This keeps the Researcher read-only against the KB, which matches the existing contract that the Researcher only writes to `.claude/skills/`.

(Alternative considered: have the Researcher itself update `last_seen_at`. Rejected because it broadens the Researcher's write surface; cleaner to keep it read-only and let the Orchestrator own the mutation.)

---

## G. Researcher subagent contract update

The Developer applies this; the Researcher contract document is **not** edited by this research task. Proposed additions to `.claude/agents/researcher.md` — **additions only**, to be inserted between the existing "Inputs" and "Process" sections (and a small amendment to the Process step ordering):

```markdown
## Knowledge base lookup (mandatory, runs before web search)

Before invoking `WebSearch` or `WebFetch` for any research question, you MUST:

1. Tokenize the question (lowercase, strip stopwords, keep tokens ≥ 3 chars).
2. Grep `knowledge/entries/*.md` for those tokens in three passes:
   - tag matches (weight 3),
   - symptom matches (weight 2),
   - problem/body matches (weight 1).
3. Read the top-3 scoring candidate entries.
4. If any candidate's `solution` answers the question, return that answer and cite the entry id. Set `used: true` for that hit in your output. Do NOT proceed to web research.
5. Otherwise, proceed to web search as before, and at the end propose a new knowledge entry as part of your output (do not write it directly — the Orchestrator will create the file after human approval).

Your write surface remains `.claude/skills/` only. You never modify `knowledge/` files yourself; the Orchestrator updates `last_seen_at` on reused entries and creates new entries you propose.

## Output format additions

In addition to the existing fields, return:

- **kb_hits**: array of `{ id, score, used: bool }` — every entry you considered, with whether it answered the question.
- **proposed_kb_entry** (optional): if your web research produced a generalizable lesson, include a frontmatter+body draft for a new entry under `knowledge/entries/`.
```

(Plus a one-line amendment to the existing **Process** section: insert the KB lookup as step 2, renumbering existing steps 2–5.)

---

## H. Tests

Mapped 1:1 to acceptance criteria in `tasks/TASK-004.json`. **U** = unit, **I** = integration.

| # | AC reference | Test name | Setup | Assertion | Type |
|---|---|---|---|---|---|
| 1 | AC1 (pointer file) | `pointer_v2_shape_minimal` | Fresh repo; orchestrator boots. | `state/session.json` parses against pointer schema; has `schema_version=2`, `active_session_id=null`, `updated_at` present. | U |
| 2 | AC1 | `bundle_session_json_has_v1_shape_plus_session_id` | Start a session. | `state/sessions/<id>/session.json` validates against the existing v1-style schema with the added `session_id` field. | U |
| 3 | AC2 (self-contained) | `bundle_is_self_contained_after_copy` | Start session, write state, copy `state/sessions/<id>/` to a temp dir; create a new repo skeleton there and a pointer pointing at the bundle. | New chat resume path successfully reads `handoff_summary`, `next_action`, and `active_task` without errors. | I |
| 4 | AC3 (transcript untouched) | `claude_code_transcripts_not_modified` | Start session without `--snapshot-transcript`. | No file in Claude Code's transcript directory is modified; `transcript.ref.json` either absent or contains only paths + checksums, no content. | I |
| 5 | AC3 (opt-in snapshot) | `transcript_snapshot_present_when_opted_in` | Start session with `--snapshot-transcript`. | `transcript.snapshot/<file>` exists and matches the source by SHA-256. | I |
| 6 | AC4 (lifecycle atomic) | `pause_atomic_write_temp_then_rename` | Mock filesystem to record open/write/rename calls. | Sequence is `open tmp → write → fsync → close → rename`; no direct write to `session.json`. | U |
| 7 | AC4 (lifecycle updates fields) | `pause_refreshes_required_fields` | Active session; call `pause` with new `handoff_summary` + `next_action`. | `lifecycle_state=paused`, `updated_at` changed, `handoff_summary`/`next_action` reflect the new values. | U |
| 8 | AC4 + crash safety | `crash_during_pause_recovered_on_next_read` | Simulate crash between tmp write and rename. | On next resume, recovery sweep promotes the tmp file (if target missing) or deletes it (if target present); state is consistent. | I |
| 9 | AC5 (idempotency) | `pause_on_paused_is_noop` | Paused session; call `pause`. | `session.json` mtime unchanged; `lifecycle.log` gains one entry with `idempotent_noop=true`; no error. | U |
| 10 | AC5 | `resume_on_active_is_noop` | Active session; call `resume`. | Analogous to #9. | U |
| 11 | AC5 | `end_on_ended_is_noop` | Ended session; call `end`. | `summary.md` not rewritten (mtime unchanged); `lifecycle.log` gains a noop entry. | U |
| 12 | AC5 | `pause_on_ended_errors` | Ended session; call `pause`. | Returns an error with a stable error code; state untouched. | U |
| 13 | AC6 (summary.md content) | `summary_md_contains_required_sections` | Run a session through start → some lifecycle ops → end. | `summary.md` exists and contains the required H2 sections: Dates, Active task, Tasks touched, Commits referenced, Lifecycle timeline, Open threads, Unresolved blockers. | I |
| 14 | AC6 (commits sourced from tasks) | `summary_lists_commits_from_linked_commits` | Touch TASK-X during session; ensure TASK-X has 2 entries in `linked_commits`. | Both SHAs appear in `summary.md` under "Commits referenced". | I |
| 15 | AC7 (`session.list`) | `session_list_lists_all_bundles` | Create 3 bundles in different states. | `session.list` output contains all 3, sorted newest-first, columns match spec. | U |
| 16 | AC7 (`session.show`) | `session_show_prints_without_mutating` | Active session A; `session.show B` for a different bundle. | A's pointer and files unchanged; B's `session.json` + `summary.md` printed. | U |
| 17 | AC8 (KB exists + seed) | `knowledge_dir_has_required_files` | Fresh checkout. | `knowledge/README.md`, `knowledge/schema.md`, `knowledge/schema.json`, and at least one entry under `knowledge/entries/` exist. | U |
| 18 | AC8 (no absolute paths) | `knowledge_entries_have_no_absolute_paths` | All committed entries. | Body of each entry matches no path in the deny-list (`C:\`, `/Users/`, `/home/`, `\\?\`). | U |
| 19 | AC8 (frontmatter schema) | `knowledge_entry_frontmatter_validates` | All committed entries. | Each entry's parsed frontmatter validates against `knowledge/schema.json`. | U |
| 20 | AC9 (researcher consults KB) | `researcher_contract_mentions_kb_lookup` | Read `.claude/agents/researcher.md`. | Contains the mandatory KB lookup section and the `kb_hits` output field. | U |
| 21 | AC9 (`last_seen_at` updated on reuse) | `orchestrator_updates_last_seen_at_on_reuse` | Researcher returns a `kb_hit` with `used=true`. | The targeted entry's `last_seen_at` is more recent than before; atomic write recipe was followed. | I |
| 22 | AC10 (export portability) | `knowledge_copy_works_in_blank_project` | Copy `knowledge/` into a temp dir; run the lookup procedure there. | All entries parse, frontmatter validates, no body references the source project's filesystem. | I |
| 23 | AC11 (CLAUDE.md updated) | `claude_md_explains_pointer_file` | Read `CLAUDE.md`. | Contains the v2 pointer-file resume rule. | U |
| 24 | AC11 (state/README.md) | `state_readme_explains_bundle_layout` | Read `state/README.md`. | Describes `state/sessions/<id>/` layout. | U |
| 25 | AC12 (cross-machine round trip) | `cross_machine_bundle_roundtrip` | See dedicated design below. | Resume payload identical after move. | I |
| 26 | AC12 (KB schema validation) | `kb_schema_test_suite` | Synthetic entries: one missing `id`, one with invalid `tags`, one valid. | Validator rejects the bad two, accepts the good one. | U |

### Cross-machine bundle round-trip test (detailed design — AC12)

```
GIVEN:
  - working_dir_A = <tmp>/repoA  (a full clone of the framework)
  - a bundle has been created in working_dir_A: state/sessions/<id>/ with session.json,
    manifest.json, lifecycle.log, no transcript snapshot
  - state/session.json points at <id>

WHEN:
  - working_dir_B = <tmp>/repoB  (a fresh checkout of the framework)
  - copy working_dir_A/state/sessions/<id>/  →  working_dir_B/state/sessions/<id>/
  - write working_dir_B/state/session.json as v2 pointer with active_session_id = <id>
  - the test harness invokes the orchestrator's "resume" procedure with cwd = working_dir_B

THEN:
  - resume reads working_dir_B/state/session.json
  - resume reads working_dir_B/state/sessions/<id>/session.json
  - resume reads working_dir_B/tasks/<active_task>.json  (the task must exist in B; this is
    why the bundle does NOT need to carry the task — it's already in the repo)
  - the printed handoff_summary, next_action, and active_task match exactly what was in repoA
  - no file in repoA was mutated by the test
  - no file outside working_dir_B/state/sessions/<id>/ and working_dir_B/state/session.json
    was mutated in repoB
```

**Subtlety:** the test exercises the case where the task JSON exists in both repos. The cross-machine contract is "the bundle is self-contained for **session state**, not for tasks". Tasks travel via git, not via bundles. The Developer should add a second sub-test where the task is **missing** in repoB, asserting that resume surfaces a clear error rather than crashing.

---

## I. Risks and open questions

Flagged for the human / Orchestrator before implementation begins:

1. **Single-writer assumption.** The design assumes one Claude Code chat per machine writing to a given bundle at a time. Should we add `proper-lockfile` (or equivalent) now, or wait for a real multi-writer scenario? My recommendation is wait; the cost-benefit doesn't justify it yet.
2. **Transcript snapshot copy mechanics.** Claude Code's transcript file path varies by platform and may rotate during a long session. Do we want the snapshot to capture **only the file as it stood at `end` time**, or do we want a periodic refresh on each `pause`? Recommendation: snapshot on `end` only, plus an explicit user-invoked `session.snapshot` op for mid-session capture. Confirm.
3. **Where exactly Claude Code stores transcripts on Windows.** The exact directory is harness-internal and not documented here. The Developer will need to discover this (likely `%APPDATA%\Claude\...` or similar) during implementation. **Confirm with the human or by inspection before coding.**
4. **KB lookup tokenizer.** I specified a simple lowercase + stopword strip + ≥3-char filter. Should we instead use a real stemmer (e.g., Porter) so "configuring" matches an entry with tag "configure"? Recommendation: not yet — stemming adds a dependency and the corpus is small. Revisit when KB > ~100 entries.
5. **Proposed KB entries — write surface.** I split this so the Researcher only **proposes** and the Orchestrator **writes**. The alternative is to let the Researcher write directly into `knowledge/entries/` (broadening its write surface to `.claude/skills/` + `knowledge/`). Cleaner separation vs. fewer round-trips. **Confirm preferred design.**
6. **Bundle GC.** Old `ended` bundles accumulate forever. Do we want a retention policy (e.g., archive bundles older than N days into a `state/sessions/_archive/` subtree, or zip them)? Out of scope for TASK-004; flagged for a future task.
7. **`pending_human_confirmation` lifecycle interaction.** The existing v1 schema has a `pending_human_confirmation` field. Should `pause` always clear it (because the new session resumes by re-asking the human) or always preserve it (so the next chat knows what was waiting)? Recommendation: preserve. Confirm.
8. **Schema version field naming collision.** v1 used `version: 1`; v2 pointer uses `schema_version: 2`. The bundle-state `session.json` keeps `version` (with value bumped to `2`). This is intentional — `version` on the bundle state, `schema_version` on the pointer — but mildly inconsistent. Acceptable trade-off, or rename for cleanliness? Recommendation: keep as specified; renaming the bundle state's field would require touching every consumer.
9. **Host fingerprint contents.** `manifest.json.host` could be the OS hostname (mild PII) or a hashed value (less useful for debugging). Recommendation: store a SHA-256 hash of the hostname so it's deterministic-per-machine but not directly identifying. Confirm.
10. **First-write race during v1→v2 lift.** If two chats are opened simultaneously on a v1 repo, both will try to lift. The atomic-rename protects the pointer write, but two bundles may be created. Mitigation: the lift procedure should first check for an existing `state/sessions/` with any entries and refuse to lift if non-empty (treat as "someone else already lifted, just re-read"). This is a small but real edge case worth handling explicitly.

---

## Sources

- [Node fs.rename atomicity discussion (node-fs-extra issue #835)](https://github.com/jprichardson/node-fs-extra/issues/835)
- [Windows: ReplaceFile vs MoveFileEx (golang-nuts thread)](https://groups.google.com/d/topic/golang-nuts/JFvnLx246uM)
- [Node.js fs.rename docs (geeksforgeeks summary)](https://www.geeksforgeeks.org/node-js/node-js-fs-renamesync-method/)
