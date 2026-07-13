---
id: verify-findings-by-executing-not-by-reading-code
problem: >-
  A review/audit/wargame that asserts findings from READING code (and trusting
  in-file comments) ships false findings with the same confidence as true ones.
  Static reading cannot distinguish "this looks broken" from "this is broken",
  and a stale code comment describing an earlier state is read as current truth.
  The result is a low-reliability report: some findings real, some refuted on
  contact with the running system, with no signal telling them apart.
symptoms:
  - >-
    A finding cites a code comment as evidence (e.g. "the header says nothing
    wires this yet") without checking current callers/imports
  - >-
    A report mixes confirmed and unconfirmed claims with no per-finding
    verification status
  - >-
    A claimed failure mode ("value with ':' corrupts the round-trip") was never
    actually fed through the real encoder/parser
  - >-
    A finding is presented to a human as a confirmed "gap" and they act on it,
    before it was executed even once
solution: >-
  For any correctness/security finding that is falsifiable in code, VERIFY BY
  EXECUTION before reporting: write a small harness that imports and RUNS the
  real module against crafted inputs and observe the actual behavior (Blue plays
  the literal shipped pipeline — the core wargame rule). Mark each finding
  CONFIRMED/REFUTED with the observed evidence attached, and give the developer
  the reproduction as a ready-made red test. Concrete lessons from the
  2026-07-12 assimilate/design wargame self-verification loop: (1) NEVER trust a
  stale in-file comment — design-profile.js's "nothing wires it into the wizard
  yet" (true at TASK-125) was superseded by TASK-129's builtin-packs.js, and an
  e2e spec proved profiling IS asked at init; the finding built on that comment
  was false. (2) A "REFUTED" can itself be a HARNESS BUG — the provenance-spoof
  finding first showed as refuted only because the test looked up
  probed['spoof'] instead of the real key 'skill:spoof'; always debug an
  unexpected refutation before deleting the finding. (3) Test the ASSERTED
  failure mode, not a plausible-sounding one — the "':' corrupts frontmatter"
  claim was false; the parser round-trips ':' fine and the real breakers
  (comma/newline) throw loudly, not silently. Reliability came from running
  code, and it moved a self-rated 3/10 report to 9/10 by withdrawing 2 false
  findings and correcting 1 over-claim out of 8.
tags:
  - review
  - verification
  - wargame
  - reliability
  - execution
  - stale-comments
  - false-refutation
projects:
  - hivemind
source_tier: T2
created_at: '2026-07-12T22:00:00.000Z'
last_seen_at: '2026-07-12T22:00:00.000Z'
---

Related: this is the verification discipline the [[wargame-a-component]] skill
(TASK-147) encodes as its load-bearing rule, and it is why every surviving
wargame ticket (TASK-140/141/142/143/144) carries a "VERIFIED BY EXECUTION"
comment with the observed values. Complements
[[license-is-not-a-safety-gate-for-third-party-adoption]] (both are about not
substituting a weaker signal — a label, a code comment — for the real check).
