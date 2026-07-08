---
id: reconcile-removal-needs-desired-not-just-ownership
problem: >-
  A declarative reconciler that decides what to REMOVE based only on a resource
  being orphaned (owners/refcount empty) will delete a resource that is still
  DESIRED in the current run — the removal predicate is missing the "not in the
  desired set" clause, producing output that contradicts the install/keep pass
  and destroys wanted state.
symptoms:
  - >-
    Reconcile output lists the same resource as both a no-op (desired, pins
    match) and a removal
  - >-
    A still-wanted resource with an empty owners[] / zero refcount gets marked
    for deletion
  - >-
    Removal logic checks ownership/orphan state but never cross-checks the
    desired set
solution: >-
  Removal candidacy in a desired-vs-actual reconciler is a CONJUNCTION, not a
  single condition: remove only when (a) the resource is NOT in the desired set
  AND (b) it is orphaned (owners empty / refcount zero) AND (c) it is
  soft/removable. Build the desired-id set first and skip it in the orphan pass
  before any owners check. Dropping any one conjunct is a data-loss bug. Keep
  the planner pure (never mutates the lock); the applier acts on its plan. Lock
  the gap with a test where a soft, empty-owners resource that IS in the desired
  set must not appear in remove (the "still-owned orphan" test does not cover
  this — it only exercises owners>0). Caught at review on TASK-118 (skills
  reconcile planner).
tags:
  - reconciler
  - lockfile
  - ownership
  - data-loss
  - addon-packs
projects:
  - hivemind
source_tier: T2
created_at: '2026-07-08T16:48:57.725Z'
last_seen_at: '2026-07-08T16:48:57.725Z'
---
## Why it happens
Ownership tracking (owners[] edges, Nix-style reachability) answers "is anyone still relying on this," and it is tempting to treat owners-empty as sufficient for removal. But "nobody owns it" and "nobody wants it THIS run" are different predicates. A resource can be orphaned by another pack yet re-adopted by the current desired set; or its edges can be empty transiently while it is still requested. Deleting on orphan-alone destroys wanted state and produces self-contradictory reconcile output (the desired pass keeps it, the orphan pass removes it).

## The general lesson
In any desired-vs-actual reconciler (package managers, IaC, plugin/addon systems), the three obligations of a removal decision — not-desired, unowned, and safe-to-remove — must all be checked together. This is the removal-side sibling of the TASK-116 ownership property [[declarative-reconciler-lockfile-ownership-pattern]]: ownership makes removal SAFE across packs, but desired-set membership makes removal CORRECT for the current run. Both are required.

## Detection
A regression test that places a soft, empty-owners resource into the desired set and asserts it appears in neither remove nor install nor replace pins the gap. A planner that emits a resource in both the keep/no-op and remove buckets is the smell.
