---
id: pin-docs-by-executing-their-own-example
problem: >-
  Documentation that describes how to operate a guarded system drifts silently
  the moment the guards change. Tests do not catch it, because tests exercise
  the CODE and the drift is in the INSTRUCTIONS. A doc-lock that RESTATES the
  rules as its own assertions does not fix this — it is a second copy of the
  contract, free to drift exactly as the prose did, and it keeps passing while
  both copies are wrong.
symptoms:
  - >-
    Following the documented procedure verbatim produces an error the docs never
    mention.
  - >-
    The whole test suite is green, because every test drives the code directly
    and none of them follows the written instructions.
  - >-
    The same drift recurs across unrelated tickets — four separate instances in
    one session in one repo.
  - >-
    A doc-lock exists and is green, but only checks that a keyword appears, so
    the next tightening reopens the same gap.
  - >-
    The error message the operator hits names the ESCAPE HATCH as its remedy,
    because the compliant path was never written down — so the bypass becomes
    the steady state for honest operators.
solution: >-
  PIN THE DOCS BY EXECUTING THEM AGAINST THE LIVE CODE. Two shapes, depending on
  what the doc contains.


  **A. The doc publishes an EXAMPLE (a payload, a config, a message body).**

  1. Put it inside stable delimiters (`<!-- X:START --> … <!-- X:END -->`).

  2. In the spec, READ THE DOC FROM DISK, extract the example verbatim, and pass
  it to the REAL function — never a hard-coded copy, never a re-implementation
  of the rules.

  3. Assert it is ACCEPTED, then mutate it (remove a required token, add a
  forbidden region) and assert each mutation is REJECTED.


  **B. The doc publishes a PROCEDURE (a sequence of calls an operator must
  make).**

  1. Same delimiters, but the block contains the numbered calls with their
  arguments.

  2. The spec extracts the sequence AND ITS VALUES, then DRIVES THE REAL
  PRIMITIVES with it end to end, asserting the operation succeeds.

  3. Add mutation tests that drive a CORRUPTED sequence and assert the real
  guards reject it with the specific typed error.


  Shape B catches drift in BOTH directions, which is the property that matters:

  - **Code tightens** (a new precondition appears) → the documented sequence no
  longer suffices → the happy-path test throws.

  - **Code relaxes** (a guard is loosened or removed) → the corrupted sequence
  stops being rejected → a mutation test fails.


  A lock that only catches one direction gives false confidence, which is worse
  than no lock.


  THREE MECHANICS THAT MAKE IT HOLD:

  1. **Guard the extraction.** Missing markers, malformed markers, or a
  zero-step parse must FAIL LOUDLY. An extraction that silently yields nothing
  produces a lock that passes over an empty set.

  2. **Make mutations self-checking.** Each mutation test should first assert
  `mutated !== extracted`. If the doc itself ever drifts toward the mutated
  value, the test degenerates loudly instead of passing.

  3. **Eliminate unlocked duplicates.** A second copy of the example or
  procedure in another file is unpinned and will drift. Declare one file
  canonical and replace every other copy with a POINTER.


  AND FIX THE ERROR MESSAGES AT THE SAME TIME. When a guard rejects an operator,
  its message must name the COMPLIANT path first and any escape hatch last,
  framed as a genuine exception. A message that offers only the bypass converts
  every honest operator into a bypass user, and the control becomes audit noise
  while still appearing to work.


  KNOWN LIMIT, state it rather than discover it: this pins what the block
  contains and any value you explicitly extract. Prose OUTSIDE the block —
  narrative claims about what the code does — remains unverified and must still
  be written from the source, not from intent.
tags:
  - documentation
  - doc-lock
  - drift
  - testing-pattern
  - sensor-design
  - non-vacuity
  - error-messages
projects:
  - hivemind
created_at: '2026-08-04T06:11:03.304Z'
last_seen_at: '2026-08-04T06:11:03.304Z'
source_tier: T1
---
## Provenance

Filed from TASK-196 (closed 2026-08-03) and **substantially extended by TASK-187** (closed 2026-08-04; commits `d97838b`, `c15cf37`), which produced shape B and the both-directions property. Both captured under the TASK-105 rule — each gating review recorded a HIGH.

T1 — both mechanisms were built and their durability demonstrated, not theorized.

## Why this entry exists: four instances in one session

| Ticket | Code was right, the docs said | Caught by |
|---|---|---|
| TASK-186 | the old UAT recording convention | TASK-196's review |
| TASK-196 | a floor that did not exist in harness mode | its own reviewer |
| TASK-188 | fallback prose its own lock did not pin | its reviewer |
| TASK-187 | a close procedure missing every new prerequisite | its reviewer |

Same shape every time: **the code tightens, the prose describing how to operate it does not move, and the suite stays green because tests exercise the code rather than the instructions.**

## TASK-187 is the sharpest case, and shows why error messages are part of the fix

The close path gained three preconditions (reach `in_review`; a pre-existing reviewer-authored comment; non-empty `linked_commits`). No document the operator procedurally follows mentioned any of them. The evidence was blunt: **the five most recent closes — including the ticket that built this control's own foundation — would all have been rejected.**

Worse, both new error messages instructed exactly one remedy: the escape hatch. With the honest path undocumented and the bypass advertised, the predictable steady state was routine escape-hatch closes — the control degrading into audit noise while every test stayed green. The reviewer's formulation is worth keeping: *if the honest path is undocumented and the bypass is the advertised remedy, the speed bump gets driven around by the legitimate operator, not the adversary.*

## The proof that it worked

TASK-187 is itself a `tdd` ticket, so closing it required the sequence its own code enforces. That close — the first in the repo's history to follow the documented procedure — succeeded on the first attempt. A doc fix you can execute is a doc fix you can trust.

## Related

See [[blocklist-content-gates-lose-to-relocation]] for the same patch-the-instance-vs-close-the-shape lesson on a content gate, [[never-read-a-process-failure-as-a-state-answer]] for guard design under uncertainty, and [[derive-enums-from-code-not-from-the-corpus]] for the sibling "validate against reality, but reality includes the code" lesson.
