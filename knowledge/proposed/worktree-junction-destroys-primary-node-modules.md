---
id: worktree-junction-destroys-primary-node-modules
problem: >-
  On Windows, disposing a git worktree whose node_modules is a junction to the
  primary checkout silently destroys the primary dependency tree.
symptoms:
  - Primary node_modules/.bin is emptied after a worktree is removed
  - >-
    Next build or test run fails with missing binaries immediately after an
    apparently clean worktree disposal
  - >-
    git worktree remove exits 0 with no warning; every merged-ness, branch and
    dirty-check guard passes because the junction is gitignored and invisible to
    git status --porcelain
solution: >-
  Sever the junction before calling git worktree remove: lstat the worktree
  node_modules and, when it is a symlink/junction, unlink it non-recursively
  (rmSync recursive:false) first. Ordering is load-bearing - git, not rmSync, is
  the destruction vector, and git recurses through a junction it finds. Two
  follow-on lessons: (1) the lstat guard must fail CLOSED - a bare catch that
  swallows EPERM/EBUSY on a still-present junction silently skips the sever and
  the destruction recurs, so only e.code === ENOENT may mean absent; (2) when
  git worktree remove fails after the sever it may still have partially
  completed (registry deregistered, directory emptied, only the root unlink
  failed), so the typed error must report post-conditions rather than leaving
  the caller to infer them. Do not retry the destructive git op - a
  permission-denied is the one signal that a live process still holds the tree.
tags:
  - windows
  - git-worktree
  - junction
  - symlink
  - data-loss
  - fail-closed
  - empty-result-contract
projects:
  - hivemind
created_at: '2026-08-06T00:00:00.000Z'
last_seen_at: '2026-08-06T00:00:00.000Z'
---

