# Useless vs. valuable — a checklist

Run this checklist before fixing the stop condition (protocol step 6) and again before reporting
results. It exists because "we ran a hardening review" is not itself evidence of anything — a
review can be run and still produce zero durable value.

## USELESS when

- **The Challenger is omniscient with no plausible entry vector.** If the Challenger is handed
  knowledge or access no outside caller could plausibly have (internal-only credentials, unreleased
  source, a defense's exact implementation with no cited-catalog basis for how an outsider would
  find it), the exercise proves nothing about real exposure.
- **The pipeline is played "in the abstract" instead of running real code.** This is the #1 failure
  mode. If a human narrates "the pipeline would probably reject that" instead of actually running
  the pipeline against the probe, the exercise is a brainstorm, not a hardening review — see the
  skill's rule 1.
- **No adjudication criterion was fixed in advance.** If "caught" vs. "missed" is decided
  after seeing the outcome, the adjudication is not falsifiable and the round log cannot be trusted.
- **A single round with no adaptation.** One round tells you whether today's defenses catch today's
  probe; it tells you nothing about whether the defense generalizes once an input adapts.
- **Findings are not converted to replayable regression artifacts.** A gap that lives only in a
  chat transcript or a verbal summary evaporates the moment the session ends — see the skill's
  rule 2.

## VALUABLE when

- **Scenarios are seeded from a cited catalog**, not improvised from first principles (protocol
  step 3) — this keeps the exercise anchored to input classes that are actually seen in the wild,
  not just ones the Challenger happened to think of.
- **The pipeline runs the literal shipped code** — the real gate code, the real CLI, the real
  subagent spawns — never a description of what the pipeline is supposed to do.
- **Every gap is logged with the responsible gate, and becomes a ticket.** Naming the specific
  gate (a function, a regex, a reviewer step) that missed the probe is what makes the resulting
  `tdd` ticket's fix targeted rather than a vague hardening pass.
- **Many short rounds beat one long round.** A stop condition of "N short rounds, each with a fresh
  adaptation" surfaces more distinct gate weaknesses than a single long round spent on one probe.
- **Human sign-off gates are reviewed too, not just automated scans.** For any step in the real
  pipeline that ends in a human approval (not an automated check), the review should ask: does the
  approval **package** the human is shown actually give them what they need to catch the problem, or
  does it just report that an automated scan came back clean? A human who signs off on an
  under-informative package is itself a gate that can fail.

## Severity

Severity for adjudicated findings reuses this repo's existing reviewer HIGH / MEDIUM / LOW
convention (see `.claude/agents/reviewer.md`) rather than a numeric rubric — the security-testing
literature this catalog draws from is qualitative, and there is no established cross-project numeric
scale worth importing in its place.
