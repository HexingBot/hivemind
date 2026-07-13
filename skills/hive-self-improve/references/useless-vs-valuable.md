# Useless vs. valuable — a checklist

Run this checklist in protocol step 4 (triage) and again before reporting results. It exists because
"we did a quality pass" is not itself evidence of anything — a self-improve run can be busy and still
ship only cosmetic churn, which carries real regression risk for no real gain.

## USELESS when

- **The finding is not grounded in code actually run or read.** "This feels improvable" with no
  `file:line`, no uncovered AC named, no drifted line quoted, no timing number, is a vibe — see the
  skill's rule 1. Discard it or go produce the evidence.
- **It is style-only reformatting.** Whitespace, import ordering, or a rename that changes no
  behavior and no clarity is churn. If a formatter or linter would do it, it is not a self-improve
  finding.
- **It is speculative abstraction.** A layer, hook, or generalization added for an imagined future
  need with no current second caller is complexity, not simplification — the opposite of the goal.
- **It would add a spec the new-test budget forbids.** A "coverage" finding that adds a duplicate or
  vanity spec is a LOW finding at review time, not an improvement. Coverage findings must name a real
  uncovered AC or regression.
- **It is actually a security finding.** If the real issue is a trust boundary, an auth/validation
  seam, or a gate against hostile input, it does not belong here — route it to
  `hive-adversarial-improve` (step 5). Forcing it through the constructive path under-tests it.
- **It bundles many changes into one sweeping refactor.** A large rewrite that touches many concerns
  at once is hard to review, hard to revert, and where quality work turns into risk. Prefer small,
  independently-ticketed findings.

## VALUABLE when

- **Every finding carries inline evidence** — both `file:line`s of a duplication, the exact
  uncovered AC, both sides of a doc drift, a before/after timing — produced this session by running
  or reading the real code.
- **It measurably reduces complexity or closes a real gap** — one call site instead of two, a
  deleted unused export, a newly-covered AC, a green doc-lock, a faster hot path — with the baseline
  from step 2 to prove the delta.
- **It lands at the lightest defensible tier.** Most self-improve work is `tests-after` or
  `uat-only`; only schema/state/parsing findings are `tdd`. Over-tiering a doc tidy to `tdd` wastes
  the loop; under-tiering a state-mutation change skips real edge-risk.
- **The improvement is verified by re-running the baseline**, not asserted. Step 7's re-run is what
  turns "I cleaned this up" into "here is the same behavior in fewer lines / the newly-green sensor."
- **Severity is honest.** Most quality findings are MEDIUM or LOW. Calling a cosmetic tidy MEDIUM is
  exactly the noise triage exists to remove; calling a real coverage gap LOW buries it.

## Severity

Severity for findings reuses this repo's existing reviewer HIGH / MEDIUM / LOW convention (see
`.claude/agents/reviewer.md`) rather than a numeric rubric. A constructive quality finding is rarely
HIGH — reserve that for a genuine correctness or data-loss risk uncovered incidentally, and consider
whether such a finding actually belongs on the adversarial or reviewer path instead.
