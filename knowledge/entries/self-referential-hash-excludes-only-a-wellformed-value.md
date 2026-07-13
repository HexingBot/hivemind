---
id: self-referential-hash-excludes-only-a-wellformed-value
problem: >-
  When a content-integrity hash is embedded in the very file it protects (the
  hash line lives inside the content being hashed), the writer and verifier must
  agree to EXCLUDE that line from the digest. If the exclusion is done with a
  greedy, whole-line and/or globally-matched regex, it becomes a tamper channel:
  an attacker can append arbitrary bytes onto the excluded line (or plant a
  decoy line elsewhere) and those bytes are silently dropped from the hash — so
  the integrity check the design exists to provide fails OPEN on exactly the
  line it trusts least.
symptoms:
  - >-
    A canonicalization regex like /^- content_integrity:.*$/m used to blank the
    hash line before hashing — the .*$ swallows any trailing junk on that line
  - >-
    The exclusion regex is unanchored/global, so a decoy line matching the same
    prefix elsewhere in the file captures the writer's splice (real hash lands
    on the wrong line; the attested block shows a placeholder like "(pending)")
  - >-
    Appending text to the hash line after approval materializes into the live
    artifact undetected — the staged→live tamber-detection control passes it
  - >-
    A whole-file .replace() splice of the hash value that searches body content
    the attacker can influence
solution: >-
  Exclude only a WELL-FORMED value in a FIXED location, and fail closed on
  anything else. (1) Match only the exact value shape, not the whole line: `^-
  content_integrity: (sha256:[0-9a-f]{64}|\(pending\))\s*$` — so a valid hash
  followed by trailing junk (the tamper) fails to match, stays IN the hashed
  bytes, and flips the digest → mismatch → caught. (2) Scope the exclusion to a
  fixed anchor (e.g. only text after the `## Sources & provenance (hivemind)`
  heading, located via lastIndexOf) and require EXACTLY ONE match there; 0 or >1
  matches leave the text unchanged so a mangled/duplicated line still hashes and
  mismatches — never throw, never silently skip. (3) Prefer eliminating the
  body-text splice entirely: rebuild the trailing block by re-emitting it with
  the real value (buildProvenanceBlock) rather than regex-replacing a value into
  attacker-influenceable text, so a decoy line is structurally un-targetable.
  (4) The writer's exclusion rule and the verifier's must be ONE shared
  definition (shared exported constant + regex), and the anchoring heading
  constant must not be able to drift across files unguarded — a silent drift
  makes every untampered artifact false-mismatch; add a shared constant or a
  meta-test asserting the copies are equal. Verified on TASK-142: the greedy
  whole-line form let an appended "ATTACKER-INJECTED-INSTRUCTIONS-FOR-THE-AGENT"
  reach the live skill undetected; the value-scoped + block-anchored + rebuild
  form catches it (re-ran the exploit end-to-end).
tags:
  - security
  - integrity
  - hashing
  - assimilate
  - supply-chain
  - self-reference
  - fail-closed
projects:
  - hivemind
source_tier: T2
created_at: '2026-07-12T22:00:00.000Z'
last_seen_at: '2026-07-12T22:00:00.000Z'
---

Surfaced by TASK-142 (assimilate content_integrity), review REQUEST-CHANGES then
APPROVE after one fix-round. This is the same "exclude a weaker/self-referential
signal correctly, fail closed" family as
[[license-is-not-a-safety-gate-for-third-party-adoption]] and the discipline in
[[verify-findings-by-executing-not-by-reading-code]] (the hole was found and the
fix confirmed by RUNNING the exploit, not by reading the regex). Relates to the
[[wargame-a-component]] method: a "Red appends to the excluded line" inject
belongs in the supply-chain taxonomy.
