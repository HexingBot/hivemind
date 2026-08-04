---
id: derive-enums-from-code-not-from-the-corpus
problem: >-
  When you tighten a free-text field into a fixed enum, the obvious way to find
  the permitted values is to read what is already stored. That set is incomplete
  by construction: production code can write values that no stored record
  happens to contain yet. The corpus records what HAS happened; the code defines
  what CAN happen. Deriving the enum from stored data alone ships a validator
  that rejects a legitimate value the moment some rarely-exercised code path
  runs.
symptoms:
  - >-
    A field is being narrowed from an arbitrary string to an enum, and the enum
    was built by grepping stored records.
  - >-
    Every test passes, the migration check reports zero violations against the
    whole corpus, and the change looks completely safe.
  - >-
    The missing value belongs to a path that is rare in the corpus but common in
    real life — first-run bootstrap, error handling, an admin action, a
    migration script.
  - >-
    The failure will appear far from the change, in a code path nobody edited,
    at a time nobody connects to the enum.
solution: >-
  DERIVE THE ENUM FROM BOTH SOURCES AND TAKE THE UNION.


  1. Grep the stored corpus for the values actually present — necessary, and it
  tells you the common cases plus their frequencies.

  2. Grep PRODUCTION SOURCE for every site that writes the field — this is the
  step that gets skipped. Search for the field name as a literal in assignment
  position across `src/`, `bin/`, `scripts/`, and any generator or template that
  emits records.

  3. Any value that appears in the code but NOT in the corpus is the interesting
  one. It is not dead code until you have proven it dead — it is far more often
  a path the corpus has not exercised yet.


  A migration check that validates the whole corpus and reports zero violations
  is NOT evidence the enum is complete. It is evidence the enum covers the past.
  Those are different claims, and only one of them is what you need.


  GENERALIZATION beyond enums: this applies to any validator whose permitted set
  is inferred from observed data — status values, comment authors, event types,
  config keys, file extensions. Whenever you catch yourself thinking "I checked
  it against all the real data", ask the second question: what can the code
  produce that the data has not shown me?
tags:
  - validation
  - enum
  - schema
  - migration
  - silent-failure
  - code-vs-data
projects:
  - hivemind
created_at: '2026-08-04T04:59:37.333Z'
last_seen_at: '2026-08-04T04:59:37.333Z'
source_tier: T1
---
## Provenance

Filed from TASK-188 (closed 2026-08-03, commit `abc1049`). **Written outside the TASK-105 trigger** — the gating review recorded 0 HIGH and needed no REQUEST-CHANGES round — because the lesson is reusable and would otherwise be lost with the ticket. The trigger is a floor, not a ceiling.

T1 — the near-miss was real and caught during implementation, not theorized.

## The concrete near-miss

TASK-188 constrained a ticket comment's `author` field from an arbitrary string to an enum. The corpus gave five values across **389 real comments**: `orchestrator` (314), `uat` (46), `reviewer` (24), `developer` (4), `researcher` (1).

A sixth value, **`backlog-seeder`**, has **zero occurrences** in that corpus — but `src/backlog-seeder.js` writes it on every fresh `bin/init.js` run. It is absent from this repo's own `tasks/` because this repo was bootstrapped before that code existed.

Shipping the five-value enum would have passed every test here, reported **0 violations across all 193 tickets**, and then **silently broken every future project bootstrap** — in a file nobody touched, at init time, far from the change.

It was found only by grepping production source for the `author:` literal.

## Why the migration check could not catch it

The check asked "does every existing record still validate?" and the honest answer was yes. The question it could not ask is "will every record this code can produce still validate?" — no amount of validating stored data answers that, because the offending record had never been produced in this repo.

## Related

See [[never-read-a-process-failure-as-a-state-answer]] for the sibling lesson about inferring state from incomplete evidence, and [[pin-docs-by-executing-their-own-example]] for pinning a claim against the live thing rather than a restatement of it.
