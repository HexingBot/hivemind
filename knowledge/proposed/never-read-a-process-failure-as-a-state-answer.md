---
id: never-read-a-process-failure-as-a-state-answer
problem: >-
  A guard that shells out to another program (git, a linter, a package manager)
  to decide whether an operation is safe will collapse that program's THREE
  possible outcomes — "yes", "no", and "I could not answer" — into a two-valued
  boolean. When the tool errors, the guard reads the reassuring answer and
  proceeds. On a destructive operation this deletes work that exists nowhere
  else.
symptoms:
  - >-
    A guard is written as `result.status === 0 ? parse(result.stdout) : <benign
    default>` — the ternary IS the defect; the benign default is what a tool
    failure becomes.
  - >-
    The docstring claims the function "refuses unless it can prove X is safe",
    while the code proceeds whenever it cannot determine X at all.
  - >-
    Fixing one such site introduces another: each new subprocess call re-decides
    failure handling ad hoc, so the defect reappears at whatever call site the
    last fix added.
  - >-
    Tests are green throughout, because the failure requires the external tool
    to fail — which no happy-path fixture ever makes it do.
solution: >-
  Treat every subprocess invocation as THREE-VALUED and give each call site an
  explicit, named failure disposition. Three sanctioned shapes cover every real
  case:


  1. **Throw-on-any-failure** (`runGitOrThrow`-style) — when there is no
  meaningful "no" outcome, only "yes" or "error".

  2. **A dedicated three-valued probe** — when a non-zero exit legitimately
  means either "no" or "the tool failed", and those must not be conflated.
  Example: `git rev-parse --verify -q MERGE_HEAD` exits 0 = present, 1 = absent
  (documented "missing ref" signal), anything else = error. Return
  present/absent and THROW on any other status.

  3. **Inline handling that folds every non-yes/no outcome into the CONSERVATIVE
  disposition** — a throw, or the alarm-raising answer (`dirty: true`), never
  the benign one.


  The unsafe shape is specifically: reading `.status` as the sole disposition
  AND folding the ambiguous case into the BENIGN outcome. Note that a bare
  `.status !== 0` comparison is NOT itself the bug — `status !== 0 ||
  stdout.trim()` folding into `dirty: true` is correct. An invariant that
  forbids all `.status` comparisons will be discovered to be false by the next
  reader and discounted entirely.


  STATE THE INVARIANT AT MODULE LEVEL, and make it TRUE of every existing call
  site. An invariant with counterexamples in its own file is worse than none:
  the reader concludes it is aspirational, pattern-matches off the code instead,
  and reproduces the bug with nothing but review to catch it.


  WHAT ACTUALLY HOLDS THE LINE is mechanical, not textual: fail-closed locks
  that turn a loosened guard into a DIFFERENT thrown error code, so weakening
  one guard fails a spec that names the code it expected. The comment is the
  softer layer; the specs are the control.
tags:
  - subprocess
  - git
  - fail-closed
  - empty-result-contract
  - destructive-operations
  - guard-design
  - defect-generator
projects:
  - hivemind
created_at: '2026-08-04T03:24:40.511Z'
last_seen_at: '2026-08-04T03:24:40.511Z'
source_tier: T1
---
## Provenance

Filed from TASK-195 (closed 2026-08-03; commits `aad12db`, `88f0395`, `0b3b327`, `3a26afc`, `2cd5ac6`, `6977b0c`). Captured under the TASK-105 rule: the gating reviews recorded HIGH findings and the ticket needed multiple REQUEST-CHANGES rounds.

T1 — every claim below was demonstrated against real git in temp sandboxes, not reasoned about.

## The demonstrated losses

In `removeMergedWorktree`, a function whose docstring said it "can never discard unique work":

- A **detached-HEAD worktree carrying a unique commit** was deleted, leaving the commit reachable from nothing.
- A **renamed branch** and a **typo'd target branch** each made `rev-list` fail; the failure was coerced to "0 unmerged commits" and the worktree was deleted despite carrying unmerged work.

`git worktree remove` does not refuse in any of these cases — established by experiment — so the guard was the only defense, and it was checking the caller's CLAIM rather than the worktree's actual state.

## The four-for-four pattern

| Round | Fixed | Introduced |
|---|---|---|
| 1 | — | fail-open guard; claim-not-state check |
| 2 | both HIGHs | `E_MERGE_ABORT_FAILED` over-fire (false "mid-merge" on a clean repo) |
| 3 | the over-fire | probe-error conflated with probe-absent |
| 4 | the conflation | *(none — streak ended)* |

Every fix was correct for what it targeted. The generator was that each fix ADDED A CALL SITE, and each new call site re-decided failure handling from scratch. Closing it required a shared helper plus a module invariant — not another patch.

## Escalate the tier when the operation destroys

This ticket entered as `tests-after` ("glue over git") and was escalated to `tdd` only after a review demonstrated the deletion paths. **"Does this operation destroy anything?" belongs in the tier rubric at assignment time.**

## Related

This is the fifth appearance of the empty-result class in this repo and the first on a destructive operation. See [[blocklist-content-gates-lose-to-relocation]] for the same patch-the-instance-vs-close-the-shape lesson on a content gate, and [[pin-docs-by-executing-their-own-example]] for the doc-accuracy half — this module shipped an invariant comment that was false of five of its own call sites.
