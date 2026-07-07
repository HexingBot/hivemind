---
id: vacuous-sensor-assertion-swallowed-by-product-catch
problem: >-
  A spec whose only assertion executes inside a callback that the code under
  test wraps in a try/catch can never fail: the thrown AssertionError is
  swallowed by the product catch, the code falls to its fallback branch, and the
  test (with no top-level assertions) passes vacuously.
symptoms:
  - >-
    red-run failure count lower than expected (a spec passes while the defect it
    encodes is still present)
  - >-
    assertion placed inside a mocked runner/injected callback instead of after
    the await
  - >-
    vitest does not fail a test on a swallowed assertion error (verified on
    vitest 2.1.9)
solution: >-
  Capture values inside the callback into outer variables and assert AFTER the
  await at test top level; additionally assert the observable outcome (e.g.
  result.filed === 'github') so a swallowed failure surfaces as an unexpected
  fallback. Prove repaired sensors non-vacuous with a mutant plant: temporarily
  break the constant/branch under guard, watch the spec go red, revert without
  committing. Reviewers: reconcile the red-run failure count against the spec
  inventory — N specs for an AC must produce N reds.
tags:
  - testing
  - vacuous-sensor
  - tdd
  - review
  - vitest
projects:
  - hivemind
created_at: '2026-07-07T05:30:00.000Z'
last_seen_at: '2026-07-07T05:30:00.000Z'
source_tier: T1
---
Found as the sole HIGH in TASK-101 review (2026-07-07): the AC1 default-repo wiring spec asserted inside the mocked gh runner; fileFrameworkBug's inner catch swallowed the AssertionError and the test passed while DEFAULT_REPO was still wrong. Proven empirically by the reviewer (scratchpad probe + the developer's own red run showing AC1 x3 failures where 4 specs existed). Fixed in commits 276afad/9a22f14 with a mutant-plant red proof. Related: the five recurring HIGH classes list (TASK-078) — this is the canonical vacuous-sensor exemplar.
