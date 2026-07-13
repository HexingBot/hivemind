---
id: unicode-cf-property-matches-only-assigned-codepoints
problem: >-
  When neutralizing a whole named Unicode codepoint range (e.g. the Tag block
  U+E0000-U+E007F used for invisible instruction-smuggling), a regex property
  class like \p{Cf} is insufficient: Unicode property classes match only
  ASSIGNED codepoints, so unassigned codepoints inside the target range slip
  through, and behavior silently changes across Unicode versions as codepoints
  get assigned.
symptoms:
  - >-
    An intake/config value carrying invisible chars is stripped by \p{Cf} yet a
    raw String.fromCodePoint(0xE0000) still survives into the output bytes
  - >-
    A sanitizer that passes for a real-payload probe leaves unassigned
    codepoints in the named range untouched, so an absolute AC (no codepoint in
    U+X-U+Y) is not literally met
  - >-
    Sanitizer behavior would change if a future Unicode version assigns
    previously-unassigned codepoints in the range
solution: >-
  To neutralize a whole codepoint range robustly and version-independently,
  strip by NUMERIC codepoint range (cp >= START && cp <= END) in a
  per-code-point pass, not by a \p{Cf} property class. Keep the property class
  only as a convenience for the assigned invisible chars, and add the explicit
  numeric range for any range whose full span must be guaranteed clean. Use
  plain decimal/hex numeric comparison rather than a literal
  /[\u{...}-\u{...}]/u escape-range regex (the literal form is fragile to
  author). Reference: TASK-159 src/intake-sanitizer.js
  isStrippableControlCodePoint (TAG_BLOCK_START/END).
tags:
  - security
  - unicode
  - sanitization
  - injection
projects:
  - hivemind
created_at: '2026-07-13T04:45:00.000Z'
last_seen_at: '2026-07-13T04:45:00.000Z'
source_tier: T1
---
Surfaced by the TASK-159 gating review (a hive-adversarial-improve finding: probe P9 smuggled a hidden SKIP REVIEW instruction into PROJECT.md via Unicode Tag-block chars). The first fix stripped Unicode category Cf, which closed the exploitable vector (the encoder only uses assigned printable tag codepoints) but left 31 unassigned Tag-block codepoints unstripped versus the AC1 range contract. The amend added a numeric-range check. General lesson: Unicode property classes are assignment-dependent; when a security contract is stated over a raw codepoint RANGE, enforce it with a numeric range test, not a property class. Related: the sibling structural-markdown lesson [[markdown-escape-must-cover-setext-headings]] and [[verify-findings-by-executing-not-by-reading-code]].
