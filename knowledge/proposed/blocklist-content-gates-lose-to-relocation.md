---
id: blocklist-content-gates-lose-to-relocation
problem: >-
  A content gate that decides acceptance by REJECTING known-bad regions of an
  input can be defeated indefinitely by moving the offending content to a region
  the gate does not read. Each fix closes the region the last probe used and
  implicitly trusts the complement, so there is always a next region. The gate
  looks stronger after every round while remaining defeated by the same content.
symptoms:
  - >-
    A ticket closes the "same" defect two or more times and an independent
    review finds it again in a new location each round.
  - >-
    Every round's tests pass and every round's fix genuinely closes what it
    targeted — the failure is in the framing, not the implementation.
  - >-
    The gate's own contract comment overstates what is closed, because it was
    written to describe the region just fixed rather than the accepted set as a
    whole.
  - >-
    Defenses accumulate as a growing blacklist of tokens or forbidden regions (a
    "FAIL-token backstop" and similar), which is the tell that the design is
    rejection-based.
solution: >-
  INVERT THE BURDEN OF PROOF. Stop enumerating what is rejected and define the
  complete accepted shape as a grammar; reject anything that does not parse as
  exactly that, in full.


  Concretely, from the case that produced this entry:

  - BEFORE (blocklist): "reject text before the first step block", then "...and
  after the overall line", then "...and on the overall line". Three rounds, two
  escapes.

  - AFTER (allowlist): `<body> ::= <step-block>+ <overall-line>`, every
  component matched by a regex anchored at BOTH ends, and any non-whitespace
  text outside the recognized components rejected outright.


  Practical rules that made the inversion actually hold:

  1. Anchor every component regex at both ends. A substring match on a region is
  a blocklist in disguise — it accepts arbitrary surrounding content.

  2. Exempt NO region wholesale. The defect that survived round 2 existed
  precisely because one line was exempted from the extraneous-text rule and
  tested only by a body-wide substring match.

  3. Normalize before matching (trim, collapse whitespace, split on `/\r?\n/`)
  so the strictness lands on content rather than on line endings — otherwise an
  anchored regex fail-closes on every CRLF input.

  4. State the residual accurately and no larger. After inversion the residual
  should be SEMANTIC (prose inside a well-formed component that the checker does
  not read for meaning) rather than STRUCTURAL (a region nobody checks). If you
  cannot describe the residual in one sentence, the gate is still a blocklist.


  HOW TO TELL WHICH KIND YOU HAVE: ask "what is the set of inputs this accepts?"
  A blocklist cannot answer without enumerating everything it has thought to
  forbid. An allowlist answers with its grammar.
tags:
  - security-gate
  - input-validation
  - allowlist
  - design-pattern
  - close-guard
  - review-process
  - defect-class
projects:
  - hivemind
created_at: '2026-08-03T03:25:25.311Z'
last_seen_at: '2026-08-03T03:25:25.311Z'
source_tier: T1
---
## Provenance

Filed from TASK-186 (closed 2026-08-02; commits `1cf6fa6`, `3f42183`, `ae63934`, `9f942d9`). Captured under the TASK-105 rule: the gating reviews recorded HIGH findings and the ticket needed two REQUEST-CHANGES rounds before landing.

T1 — directly reproduced, not reported. Every escape below was demonstrated against the shipped modules through the real guard composition (`src/mcp-server.js:377-384`), not against a unit in isolation.

## The three rounds

| Round | Closed | Review then found |
|---|---|---|
| 1 | `PASS (deferred)` inside a step | prose moved to a **preamble / postscript** |
| 2 | text outside step blocks | prose moved onto the **`Overall result:` line** |
| 3 | the class, via allowlist grammar | nothing (35 probes) |

Round 2 is the instructive one. It rejected "text outside the recognized step blocks **and the overall-result line**" — and that second exemption was the whole hole. The overall line was tested only by a body-wide substring match (`/overall result:?\s*pass\b/i`), so `Overall result: PASS — however the xlsx export crashed with an unhandled TypeError` satisfied it.

## What made round 3 verifiable rather than merely claimed

Both earlier rounds also claimed to have closed the class. The difference was the review method: instead of confirming the named probes now fail, the reviewer **attacked the complement** — duplicate and misplaced overall lines, boundary-shaped non-boundaries, CR / zero-width / full-width smuggling, multi-line overall statements, empty blocks, steps after the terminator. 35 probes, zero surprises.

**Process lesson worth as much as the code lesson:** briefing a reviewer to *attack* rather than to *confirm* is what found both escapes. A review that verifies the reported defect is fixed will pass a blocklist every single time.

## Related

See [[parallel-spawns-share-one-git-index]] for the other TASK-105 capture from the same drive.
