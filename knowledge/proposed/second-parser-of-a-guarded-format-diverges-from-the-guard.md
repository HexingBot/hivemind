---
id: second-parser-of-a-guarded-format-diverges-from-the-guard
problem: >-
  A helper that reads the same marker format the close guard reads (to decide
  something before the guard runs) was written with its own regex. The guard had
  been hardened against Unicode lookalikes, invisible glyphs and quoted
  mentions; the helper had not, so the two disagreed on which findings were
  resolved and the disagreement let a ticket close with an open regression
  (TASK-240 WG-3). The same ticket hit the sibling pattern twice: a hand-listed
  test fixture closure missing a newly imported module (CU-R-1), and two readers
  of PROJECT.md disagreeing on duplicate keys (WG-2).
symptoms:
  - >-
    A guard and a pre-processor of the same text format give different answers
    for the same input
  - >-
    Wargaming probe with U+2011, ZWSP or a quoted mention passes one reader and
    not the other
  - >-
    A fixture that copies a module closure by hand fails with
    ERR_MODULE_NOT_FOUND after a refactor, or a sibling test passes for the
    wrong reason
solution: >-
  Never keep a second parser for a format a guard already parses: export one
  collector from the guard (here src/finding-markers.js
  collectFindingMarkerState) and make every reader consume it. When two code
  paths read and write the same file key, make the writer leave exactly one
  occurrence and the reader report disagreement as invalid instead of picking
  one. After moving or adding an import, grep tests for hand-listed copies of
  that module closure and run the fs-read specs (npm test / the named spec)
  since test:since cannot see them.
tags:
  - wargaming
  - close-guard
  - parsing
  - unicode
  - fixtures
  - tests-after
projects:
  - hivemind
created_at: '2026-10-09T16:32:31.439Z'
last_seen_at: '2026-10-09T16:32:31.439Z'
source_tier: T1
---

