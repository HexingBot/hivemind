---
id: session-audit-logs-vs-wildcard-gitignore
problem: >
  A wildcard `*.log` line in the project-level `.gitignore` silently ignores
  audit logs that the harness expects to commit and replay, such as a
  session bundle's append-only `lifecycle.log`. The files exist on disk
  and the code reads them fine, but `git status` shows nothing and a fresh
  clone has no record of the lifecycle history.
symptoms:
  - "git status shows no changes after writing lifecycle.log"
  - "Bundle directory committed but lifecycle.log missing on a fresh clone"
  - "git check-ignore -v <path> points at the *.log rule"
  - "Cross-machine bundle round-trip works locally but loses history after push/pull"
solution: >
  Add an explicit un-ignore line below the wildcard so the rule survives
  but the audit-log file does not. In `.gitignore`:

  ```
  *.log
  !state/sessions/**/lifecycle.log
  ```

  Verify with `git check-ignore -v state/sessions/<id>/lifecycle.log` — the
  command should print nothing (or the un-ignore rule), not the wildcard.
  Treat any append-only audit-log file shipped inside a self-contained
  bundle the same way; the wildcard is for transient build/debug logs,
  not for files the harness considers source of truth.

tags: [git, gitignore, audit-log, bundle, portability]
projects: [hivemind]
created_at: "2026-05-25T00:00:00Z"
last_seen_at: "2026-05-25T00:00:00Z"
supersedes: []
superseded_by: null
source_tier: T1
---

## Why it happens

`.gitignore` patterns apply by suffix match across the whole tree unless
narrowed by a path prefix or by an explicit un-ignore. A bare `*.log` line
matches every file ending in `.log`, regardless of which directory it
lives in. That is usually what you want for transient logs — but a
session bundle's `lifecycle.log` is an append-only audit trail that the
harness treats as source of truth: the bundle's portability contract
breaks if the log doesn't travel with the bundle.

## Anti-patterns

- **Renaming the file** to `lifecycle.jsonl` or `lifecycle.audit` to dodge
  the wildcard. Works, but obscures the file's nature and trains future
  contributors to rename files instead of fixing the ignore rule.
- **Removing the `*.log` wildcard entirely** and listing transient logs
  one by one. Tedious and forgets the next one.
- **Adding the file via `git add -f`** once. Subsequent edits get
  re-ignored; CI will eventually notice the staleness.

## The general lesson

Any file the harness considers part of a portable bundle — audit logs,
manifests, snapshots — needs an un-ignore line in the same commit that
introduces the wildcard that would otherwise eat it. Pair the wildcard
and the carve-out as a single change; don't trust the next maintainer
to remember the interaction.

## Detection

A pre-commit hook can grep for any file path under `state/sessions/`
that `git check-ignore -v` reports as ignored, and fail the commit.
Cheap, deterministic, runs once per commit.
