---
id: pin-docs-by-executing-their-own-example
problem: >-
  Documentation that describes what a guard, parser, or validator accepts drifts
  silently the moment the code is tightened. A doc-lock that RESTATES the
  accepted format as its own regexes does not fix this — it just creates a
  second copy of the contract, free to drift from the code exactly as the prose
  did, and it will keep passing while both copies are wrong.
symptoms:
  - Following the documented procedure verbatim produces input the code rejects.
  - >-
    The same doc-vs-code drift recurs across unrelated tickets — three separate
    instances in two days in one repo (a CLI whose behavior changed twice while
    its command doc described the old one, then a gate whose accepted grammar
    accumulated four requirements none of which reached the docs).
  - >-
    Every tightening of the code is correct in isolation; the instructions that
    drive humans and agents are what fall behind.
  - >-
    A doc-lock exists and is green, but only checks that a keyword appears — so
    the next tightening reopens the same gap.
solution: >-
  PIN THE DOCS BY EXECUTING THEIR OWN PUBLISHED EXAMPLE AGAINST THE LIVE CODE.


  Concretely:

  1. Put a worked example in the doc inside stable delimiters (e.g. HTML comment
  markers `<!-- X:START --> ... <!-- X:END -->`).

  2. In the spec, READ THE DOC FROM DISK, extract the example verbatim, and pass
  it to the REAL function — never a hard-coded copy of the example, and never a
  re-implementation of the accepted grammar.

  3. Assert the extracted example is ACCEPTED.

  4. Apply mutations to the extracted text (remove a required token, add a
  forbidden region, append trailing prose) and assert each is REJECTED. This is
  non-vacuity by construction rather than by claim.

  5. Guard the extraction itself: if the markers are absent, malformed,
  reordered, or the block is empty, FAIL LOUDLY. An extraction that silently
  yields nothing produces a lock that passes over an empty set.


  The property this buys: if anyone tightens the code without updating the doc,
  the lock fails — because the doc's own published example stops being accepted.
  A documented example the code rejects is exactly how the drift starts, so the
  example is the right thing to pin.


  COROLLARY — eliminate unlocked duplicates. A second copy of the example in
  another file is unpinned and will drift. Declare one file canonical and
  replace every other copy with a POINTER to it. Prefer whichever option leaves
  the fewest unlocked copies of a load-bearing format.


  KNOWN LIMIT, state it rather than discovering it: this pins the EXAMPLE and
  any tolerance you explicitly assert. It does NOT pin prose claims outside the
  example block — narrative sentences about what the code does remain unverified
  and must still be written from the source, not from intent.
tags:
  - documentation
  - doc-lock
  - drift
  - testing-pattern
  - sensor-design
  - non-vacuity
projects:
  - hivemind
created_at: '2026-08-03T05:32:08.845Z'
last_seen_at: '2026-08-03T05:32:08.845Z'
source_tier: T1
---
## Provenance

Filed from TASK-196 (closed 2026-08-03; commits `1a925ec`, `929fa69`, `ba4cd31`). Captured under the TASK-105 rule: the gating review recorded a HIGH and the ticket needed two REQUEST-CHANGES rounds.

T1 — the mechanism was built and its durability empirically demonstrated, not theorized.

## Why this entry exists

TASK-196 was itself the third doc-vs-code drift in two days in this repo. It closed the drift for one convention AND produced a reusable mechanism for preventing the next one.

## The limit is not hypothetical

TASK-196 shipped **three separate doc-vs-code errors of its own** across two rounds, every one in prose *outside* the pinned example block:

1. "The AC-count check **(both modes)**" — the harness-mode guard does no step counting at all (HIGH).
2. "name a recognizable **PASS/FAIL** verdict word" — the regex only ever checks for `pass`.
3. "the guard also tolerates `Overall: PASS` / **`Overall: FAIL`**" — the regex hardcodes `pass`.

The lock caught none of them, exactly as its stated limit predicts. All three were written from intent rather than from source. **The discipline that catches these is: read the code first, then write the sentence** — and have the reviewer re-derive each claim from the source rather than confirming it reads plausibly.

## Related

See [[blocklist-content-gates-lose-to-relocation]] for the guard-design lesson from TASK-186, the ticket whose tightenings caused this drift.
