# Improvement-dimension catalog (constructive quality)

Seed step 1 of the hive-self-improve protocol from this list. Each dimension below is a concrete,
groundable class of quality improvement — not a vibe. For each, a finding is only valid when it
carries the evidence named under "how to find it," produced by running or reading the real code this
session (skill rule 1). Pick the dimensions that fit the component; say which you are skipping.

## Dimensions

- **Simplification & reuse** — duplicated logic across modules, dead code no caller reaches,
  over-abstraction (an indirection with one implementation), or a redundant spec the new-test budget
  forbids. *What good looks like:* one call site instead of two, a deleted unused export, a collapsed
  needless layer. *How to find it:* grep for repeated blocks and cite both `file:line`s; trace an
  export's callers and show there are none; point at two specs that assert the same thing.

- **Test-coverage gaps** — an acceptance criterion with no spec, a use-case in `USE-CASES.md` whose
  mapped spec is thin or missing, a regression that could recur with no lock, or a sensor gap (a
  skill/agent shipped without the byte-identity or parity spec its siblings have). *What good looks
  like:* the specific AC now has a spec that fails for the right reason if the behavior breaks. *How
  to find it:* run the affected specs, read the ACs on the ticket that shipped the component, and
  name the exact criterion or use-case left unguarded — not "more tests would be nice."

- **Documentation & consistency drift** — a doc that describes behavior the code no longer has
  (CLAUDE.md, a README, a SKILL.md, an agent file), a stale reference to a renamed file/flag/symbol,
  or naming that diverges from the established pattern its siblings follow. *What good looks like:*
  the doc line matches the code, ideally with a doc-lock sensor guarding the pair. *How to find it:*
  quote both sides — the doc claim and the code reality — and note whether a sensor could lock them.

- **Developer experience** — a CLI whose error message does not say what to do next, a workflow
  step that is easy to get wrong, a "which command when" ambiguity, or a confusing failure mode that
  reads as a bug but is expected. *What good looks like:* the tool tells you what happened and the
  next action. *How to find it:* actually run the command down its failure paths and quote the real
  output that misled you.

- **Performance** — a hot path with redundant I/O or re-computation, an unnecessarily full test run
  where a scoped one would do, or an allocation/parse repeated in a loop. *What good looks like:* the
  same behavior at a measurably lower cost. *How to find it:* time the real path before and after;
  a performance finding with no number is speculation, not evidence.

- **Structural cohesion** — a module doing two unrelated jobs, an import convention violated, or a
  responsibility that leaked across a boundary the PROJECT_STRUCTURE manifest draws. *What good looks
  like:* each module has one reason to change and imports follow the declared convention. *How to
  find it:* read the module and name the two responsibilities, or cite the boundary the import
  crosses.

## Choosing depth

Prefer many small, grounded findings over one sweeping refactor. A stop condition of "scan the 2–3
dimensions that fit this component, mint the findings that survive triage, stop" beats an open-ended
"make it better" that produces a large speculative rewrite. Sweeping refactors are where quality work
turns into churn and risk.

## Not in scope (route elsewhere)

- **Trust-boundary / security hardening** → `hive-adversarial-improve` (protocol step 5 handoff).
  Untrusted-input handling, auth/validation seams, and scanner/gate robustness are dual-use-sensitive
  and belong in the adversarial skill, not here.
- **Unfamiliar-stack research** → the `researcher` agent.
- **A single uncommitted diff** → the `reviewer` agent.
