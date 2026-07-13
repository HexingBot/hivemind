---
id: markdown-escape-must-cover-setext-headings
problem: >-
  When sanitizing untrusted free-text so it cannot forge framework markdown
  structure, escaping only leading-marker constructs (ATX headings "#...", code
  fences) is incomplete: CommonMark setext headings need no leading marker. A
  plain text line immediately followed by a line of only dashes or equals still
  renders as an h2/h1, so a value that passes a /^## Heading$/ check can still
  forge a heading.
symptoms:
  - >-
    An intake/config value that fails a /^## Heading$/m check still renders as a
    heading via a two-line Text

    --- setext form
  - >-
    A markdown-structure escape that handles only # and code fences passes first
    review, then a setext payload forges a heading in re-review
  - |-
    Reviewer finds License
    --- still produces a top-level heading after the ATX escape landed
solution: >-
  Escape the whole structural-marker class, not just leading-marker forms. In
  the per-line escaper also neutralize a bare underline/break line matching /^
  {0,3}([=\-*_])(?:[ \t]*\1)*[ \t]*$/ — this closes setext =/- underlines AND
  thematic breaks -/*/_ in one branch — and apply it inside re-indented bullet
  continuation lines too, not only top-level prose. Verify with evasions:
  trailing spaces, space-separated a - - -, marker after a blank line, and
  <=3-space indentation. Reference implementation: TASK-158
  src/intake-sanitizer.js#escapeStructuralLine.
tags:
  - security
  - markdown
  - sanitization
  - injection
  - commonmark
projects:
  - hivemind
created_at: '2026-07-13T04:30:00.000Z'
last_seen_at: '2026-07-13T04:30:00.000Z'
source_tier: T1
---
Surfaced by the TASK-158 gating review (a hive-adversarial-improve finding on the bin/init.js intake boundary). The first fix escaped ATX headings (#...) and code fences, but the reviewer showed a two-line setext payload (a text line followed by a bare --- line) still forged a top-level heading in PROJECT.md prose and inside re-indented goal bullets, defeating the ticket AC. The amend widened escapeStructuralLine to cover the =/-/*/_ underline-and-thematic-break class. General lesson for any untrusted-markdown sanitizer: enumerate the block-structure constructs of the target markdown flavor (CommonMark: ATX + setext headings, fenced + indented code, thematic breaks, blockquotes, HTML blocks), not just the ones with an obvious leading sigil. See [[verify-findings-by-executing-not-by-reading-code]].
