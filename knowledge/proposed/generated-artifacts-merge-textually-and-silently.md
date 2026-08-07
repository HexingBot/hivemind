---
id: generated-artifacts-merge-textually-and-silently
problem: >-
  Git merges generated build artifacts (bundles, lockfiles, codegen output)
  textually and reports success with no conflict, producing an artifact that
  matches neither side's build.
symptoms:
  - >-
    A merge or worktree handback reports merged:true with no conflict, yet a
    parity/freshness check goes red afterwards naming several bundles at once
  - >-
    The corrective commit is a pure regeneration - equal insertion and deletion
    counts across exactly the drifted files, with no content change
  - >-
    The spliced artifact contains hunks from two different builds (e.g. one
    side's header plus the other side's body edit)
  - >-
    Only an unrelated sensor from a different ticket catches it; nothing in the
    merge path itself complains
solution: >-
  For generated paths the correct merge semantics are not "merge" but "take
  neither side, rebuild from merged source". Refusing is better than
  auto-rebuilding: making a merge run a build as a side effect adds a whole new
  failure surface to buy automation of a trivially manual step, and
  excluding-then-taking-target-side silently discards whichever regeneration
  lost - the same silent shape relocated. Three things make the refusal actually
  work: (1) derive the generated-path list from the build script's own
  entrypoint list so there is no second source of truth that can rot, but
  extract it into a ZERO-IMPORT data module first - importing the build script
  pulls the bundler (a devDependency) into a runtime module's import graph and
  breaks in a dependency-free install; (2) compute "both sides modified" against
  the true merge base, and make every git call three-valued (success /
  documented-negative / could-not-answer -> throw) rather than folding an
  unanswerable result into the benign outcome; (3) do not refuse when both sides
  produced BYTE-IDENTICAL content - over-refusal is how a guard gets worked
  around, and a guard nobody uses is worse than none. Document that a refusal is
  TERMINAL for that branch: rebuilding and re-attempting cannot work, because
  the merge base is unchanged and the target's own modification since that base
  still exists.
tags:
  - git
  - merge
  - generated-artifacts
  - build-output
  - silent-failure
  - fail-closed
  - worktree
  - devdependency-leak
projects:
  - hivemind
created_at: '2026-08-06T00:00:00.000Z'
last_seen_at: '2026-08-06T00:00:00.000Z'
---

