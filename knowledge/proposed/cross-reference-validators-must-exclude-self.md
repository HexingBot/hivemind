---
id: cross-reference-validators-must-exclude-self
problem: >-
  A descriptor/graph validator that enforces "field X must reference ANOTHER
  item id" typically builds its known-id set from ALL items, so a self-reference
  (e.g. fallback === own id) silently validates; and duplicate ids collapse in a
  Set, letting references resolve ambiguously against a dup.
symptoms:
  - A "references another X" check accepts an element pointing at itself
  - >-
    Duplicate ids in a collection validate because they collapse into a Set/Map
    key
  - >-
    Downstream reconciler/graph treats ids as unique keys but the validator
    never enforced uniqueness
solution: >-
  When validating intra-collection references: (1) exclude the element's own id
  from its own reference check and reject a self-reference explicitly with a
  distinct message; (2) order the self-reference branch BEFORE the
  dangling-reference branch; (3) enforce id uniqueness across the collection,
  flagging EVERY member sharing a duplicated id (not just the 2nd occurrence) so
  references resolve deterministically. Defer cycle detection (A->B->A) to the
  consumer (reconciler), not the schema validator. Caught at review on TASK-115
  (pack-descriptor validator: self-fallback silently accepted + duplicate ids
  uncaught).
tags:
  - validation
  - schema
  - addon-packs
  - reference-integrity
projects:
  - hivemind
source_tier: T2
created_at: '2026-07-08T16:30:36.894Z'
last_seen_at: '2026-07-08T16:30:36.894Z'
---
## Why it happens
The natural implementation of a cross-reference check collects every item id into one set, then asserts the referenced id is in that set. But "is a valid id" and "is a DIFFERENT item's id" are not the same predicate — the set includes the referrer itself, so a self-reference passes. Separately, building the set from a list silently deduplicates, so duplicate ids never surface even though downstream code keys on them.

## The general lesson
Reference-integrity validation over a collection has three distinct obligations that are easy to conflate: (a) the target exists, (b) the target is not the referrer itself (when the contract says "another"), and (c) ids are unique so a reference resolves to exactly one item. A validator that only does (a) looks correct and passes a happy-path test, but leaks (b) and (c). Encode (b) and (c) as their own rejection tests.

## Detection
A regression test that points an element's reference at its own id and asserts rejection, plus one that duplicates an id and asserts rejection, locks both gaps. Leave cycle detection to the consumer that walks the graph.
