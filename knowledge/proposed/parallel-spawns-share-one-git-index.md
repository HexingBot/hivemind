---
id: parallel-spawns-share-one-git-index
problem: >-
  Two developer subagents spawned concurrently against deliberately disjoint
  file surfaces can still corrupt each other's commits, because they share one
  git index. Briefing each agent to stage only its own files with `git add
  <explicit paths>` is NOT sufficient: the staging is per-agent but the index is
  global, so whichever agent commits second (or first) sweeps in whatever the
  sibling has staged at that moment.
symptoms:
  - >-
    A developer stages exactly N files with an explicit-path `git add`, commits,
    and the resulting commit contains substantially more than N files.
  - >-
    Observed live twice on 2026-08-02 during the parallel TASK-183 / TASK-184
    drive: commit a64859c contained 11 files after its developer staged exactly
    3.
  - >-
    Both developers appear to have behaved correctly in their own transcripts —
    the fault is in the orchestration protocol, not in either agent's conduct.
  - >-
    The damage is silent unless someone inspects the commit contents; the
    developer's own view of what it staged looks right.
solution: >-
  Commit with a pathspec limit applied AT COMMIT TIME rather than relying on a
  clean shared index: `git commit -m "..." -- <explicit paths>`. This scopes the
  commit to those paths regardless of what a sibling has staged. Pair it with
  MANDATORY post-commit verification — run `git show --stat HEAD` immediately
  after committing and assert the file list matches intent; that check is what
  caught the original incident and it is nearly free.


  KNOWN LIMITS, which matter as much as the fix:

  1. It does NOT protect against two agents touching the SAME path. A pathspec
  commit records the working-tree content of that path, so a sibling's
  concurrent edit to the same file is swept in silently — and `git show --stat
  HEAD` CANNOT detect this, because the file list still matches intent. Only the
  content differs.

  2. It relies on agent compliance. Nothing mechanically prevents a plain `git
  commit`; this is briefing guidance, not an enforced hook.

  3. Untracked files still need a prior `git add`.


  The stronger fix is per-agent worktree isolation, which removes the shared
  index rather than briefing around it (tracked as TASK-195). Serialized commits
  were rejected as a mitigation because they discard the throughput that makes
  parallel spawns worth doing.


  GENERALIZATION: "disjoint file surfaces" does not imply "safe concurrent
  commits". Any orchestrator briefing that parallelizes agents on the basis of
  file-surface disjointness alone is reasoning about the wrong resource — the
  contended resource is the index, not the files.
tags:
  - git
  - parallel-agents
  - orchestration
  - subagent-protocol
  - silent-failure
  - commit-hygiene
projects:
  - hivemind
created_at: '2026-08-03T02:05:40.024Z'
last_seen_at: '2026-08-03T02:05:40.024Z'
source_tier: T1
---
## Provenance

Filed from TASK-191 (closed 2026-08-02, commits `ca21d2b` + `b62fe82`). Captured under the TASK-105 knowledge-capture rule: the ticket needed a REQUEST-CHANGES round before landing.

T1 evidence — this is directly-reproduced behavior, not a secondary report. The incident was observed live in production orchestration, and `tests/e2e/git-pathspec-commit-isolation.spec.js` reproduces the hazard deterministically: test 1 shows a plain commit sweeping a sibling's staged file despite an explicit-path `add`; test 2 locks the pathspec-limited mitigation.

A live two-process race proved impractical to reproduce deterministically in CI, so the spec sequences the exact incident interleaving explicitly instead — the same git plumbing a real race exercises. That tradeoff is stated in the spec header rather than left implicit.

## Where the protocol lives

The "Git commit protocol (parallel-spawn safe)" section of `agents/developer.md`, and the delegation protocol in `skills/orchestrator-routing/SKILL.md` — both in byte-identical parity copies under `.claude/` and the plugin root. Pinned against silent deletion by `tests/git-commit-protocol-doc-locks.spec.js`, whose checked set is hard-coded distinctive phrases rather than fixture-derived (avoiding the empty-checked-set trap that made an earlier doc-lock pass vacuously — see TASK-184).
