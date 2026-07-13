---
name: hive-self-improve-current-project
description: Load when improving the QUALITY of an already-shipped component of THIS project (your own src/, tests/, tasks/ — not the hivemind framework) — simplification, duplication and dead-code removal, test-coverage gaps, doc/consistency drift, developer ergonomics, and performance — by running the real code to ground every finding, then converting each into a right-tiered ticket. NOT for security or trust-boundary hardening (that is hive-adversarial-improve-current-project) and NOT for routine single-diff review (that is the reviewer agent). Triggers on "hive-self-improve-current-project this", "improve THIS project", "find quality gaps in <component>", "what can we simplify/clean up in <component>".
---

# Hive Self-Improve (current project)

**Context guard — consumer project only.** This skill targets **this project's own** components
(its `src/`, `tests/`, `tasks/`) — never the hivemind framework's internals. Before proceeding,
confirm you are NOT in the framework repo: call `isFrameworkRepo({ repoRoot })` from
`src/framework-context.js` against the current working repo root, if that module is reachable in
this project. If it returns **true**, **STOP** — do not proceed with this skill — and direct the
user to the plain `hive-self-improve` variant instead, which targets the framework's own internals.
If `src/framework-context.js` is not importable (the common case — most consumer projects do not
vendor the framework's source), that itself is evidence you are in a consumer project: proceed. Only
STOP when you can positively confirm framework-repo identity (a `.claude-plugin/plugin.json` whose
`name` is `hivemind`, AND a `src/` directory, AND a `bin/init.js` file, all present at the repo root).

This skill turns an ad-hoc "this could be cleaner / better covered / clearer" conversation into a
repeatable, evidence-producing exercise. It is a **durable quality-improvement capability**, not a
one-off brainstorm: every run is grounded in the real shipped code actually executed, seeded from a
cited improvement-dimension catalog, and converts every finding into a right-tiered ticket so the
improvement survives after the session ends.

It is the constructive counterpart to `hive-adversarial-improve-current-project`. That skill hardens
a **trust boundary** against hostile inputs; this one raises the everyday quality of a component that
is already correct — the ~90% of "make this project better" work that is not security-sensitive. The
two are designed to run side by side: most components deserve a self-improve pass, and only the ones
sitting on a trust boundary additionally deserve an adversarial one.

## When to load this skill

Load whenever the task is to raise the quality of one specific, already-shipped component or
pipeline **in this project** along a **constructive** dimension: it works, but it could be simpler,
better covered, better documented, faster, or more ergonomic. Examples: collapsing duplicated logic
across two modules, closing a use-case coverage gap, reconciling a doc that has drifted from the code
it describes, tightening a CLI's error messages.

Do **not** load it for:

- **The hivemind framework's own internals** — that is `hive-self-improve` (framework repo only; see
  the context guard above).
- **Security or trust-boundary hardening** — where untrusted content crosses into trusted execution
  (auth/validation seams, parsers of fetched or user-supplied content, installer inputs). That is
  `hive-adversarial-improve-current-project`. See the hard handoff in protocol step 5.
- **Routine review of a single diff** — that is the `reviewer` agent.
- **Open-ended research into an unfamiliar library or pattern** — that is the `researcher` agent.

## The two load-bearing rules

Everything below is scaffolding around these two rules. Drop either one and the exercise stops
producing durable value:

1. **Every finding is grounded in the REAL code actually run — never speculation.** A finding must
   point at concrete evidence you produced this session: a duplication with both `file:line`
   locations, a coverage gap named against the specific acceptance criterion it leaves untested, a
   doc-vs-code drift with both sides quoted, a timing number from an actual run. A quality review
   that lists "things that feel improvable" without running the code or citing the artifact is a
   brainstorm, not a self-improve pass — and it systematically ships cosmetic churn while missing
   the real complexity.
2. **Every surviving finding becomes a ticket at the LIGHTEST defensible verification tier, with
   the evidence attached.** A finding that lives only in a chat transcript evaporates the moment the
   session ends. Most self-improve findings are `tests-after` (behavior provable by running the
   code) or `uat-only` (docs, glue, ergonomics); reserve `tdd` for the rare finding that touches
   schema, state mutation, or parsing (see this project's verification-tier rubric). The concrete
   evidence from rule 1 is what makes the ticket actionable rather than a vague "clean this up."

## The 7-step protocol

1. **Name the component and pick the dimensions in scope.** Choose from
   `references/improvement-dimensions.md` — simplification/reuse, test-coverage, doc/consistency
   drift, developer experience, performance, structural cohesion. Do not scan every dimension by
   reflex; pick the ones that fit the component and say which you are deliberately skipping.
2. **Establish a baseline by running the real thing.** Before proposing any change, capture the
   current state as evidence: run this project's affected specs and record pass/skip counts, time
   the hot path if performance is in scope, run the CLI and capture its actual output. This baseline
   is what every later finding is measured against and what step 7 re-runs to prove the improvement
   landed.
3. **Scan each in-scope dimension for concrete findings.** Work from the baseline, not from
   imagination. Each finding carries its evidence inline (the duplicated block, the uncovered AC,
   the drifted doc line). Grep and read this project's real code; do not infer structure you have
   not opened.
4. **Triage against the useless-vs-valuable checklist.** Run every candidate through
   `references/useless-vs-valuable.md` and discard the cosmetic ones. Style-only reformatting,
   speculative abstraction for an imagined future, and any "improvement" that would add a spec this
   project's new-test budget forbids are noise — dropping them is the point of this step.
5. **Security handoff (hard gate).** If any finding touches a trust boundary — untrusted content
   reaching trusted execution, an auth/validation seam, a scanner or gate that rejects hostile
   input — STOP on that finding and route it to `hive-adversarial-improve-current-project` instead
   of handling it here. This skill deliberately does not do adversarial security work; forcing a
   security finding through the constructive path under-tests it. Record the handoff so the finding
   is not lost.
6. **Convert each surviving finding into a right-tiered ticket.** Assign the lightest defensible
   `verification_tier` (rule 2), attach the step-3 evidence, and state the acceptance criterion as a
   concrete, verifiable delta ("these two blocks become one call site", "this AC is now covered by a
   spec", "this doc line now matches the code and a doc-lock sensor guards it").
7. **Verify the improvement by re-running the baseline.** Once a ticket lands, re-run the exact
   step-2 baseline. The delta — fewer lines at the same behavior, a newly-covered AC, a green
   doc-lock, a faster hot path — is the evidence the improvement is real and regression-free.

## References

- `references/improvement-dimensions.md` — the catalog of constructive quality dimensions with
  "what good looks like" and how to find each one by running the real code. Seed step 1 from here.
- `references/useless-vs-valuable.md` — the checklist for telling a self-improve pass that produced
  durable value from one that shipped cosmetic churn. Run it in step 4 and again before reporting.

## Priority scoring

Findings and the tickets they produce reuse this project's reviewer HIGH / MEDIUM / LOW convention
(the same scale the `reviewer` agent shipped with the hivemind plugin already runs on) rather than a
separate numeric rubric. A quality finding is rarely HIGH; most are MEDIUM (real complexity or a real
coverage gap) or LOW (a small clarity or consistency win). Be honest about severity: inflating a
cosmetic tidy to MEDIUM is exactly the noise step 4 exists to remove.

## How it complements the adversarial skill

A mature component gets both: a `hive-self-improve-current-project` pass keeps it simple, covered,
and clear, and — if it sits on a trust boundary — a `hive-adversarial-improve-current-project` pass
keeps it robust against hostile input. Run self-improve first on a component that is merely messy;
run adversarial-improve first on one whose main risk is untrusted input. Findings from either can
legitimately hand off to the other: a self-improve pass that uncovers a validation seam routes it to
adversarial-improve (step 5), and an adversarial pass that trips over duplicated gate logic can note
it back for a self-improve ticket.
