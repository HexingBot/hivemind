---
name: hive-adversarial-improve-current-project
description: Load when hardening a specific component/pipeline of THIS project (your own src/, tests/, tasks/ — not the hivemind framework) by stress-testing it against difficult and hostile inputs — especially a trust boundary where untrusted content crosses into trusted execution (auth/validation seams, installers, parsers of fetched or user-supplied content). Triggers on "hive-adversarial-improve-current-project this", "harden this component", "stress-test this boundary", "find failure modes in <component>".
---

# Hive Adversarial Improve (current project)

**Context guard — consumer project only.** This skill targets **this project's own** components
(its `src/`, `tests/`, `tasks/`) — never the hivemind framework's internals. Before proceeding,
confirm you are NOT in the framework repo: call `isFrameworkRepo({ repoRoot })` from
`src/framework-context.js` against the current working repo root, if that module is reachable in
this project. If it returns **true**, **STOP** — do not proceed with this skill — and direct the
user to the plain `hive-adversarial-improve` variant instead, which targets the framework's own
internals. If `src/framework-context.js` is not importable (the common case — most consumer projects
do not vendor the framework's source), that itself is evidence you are in a consumer project:
proceed. Only STOP when you can positively confirm framework-repo identity (a
`.claude-plugin/plugin.json` whose `name` is `hivemind`, AND a `src/` directory, AND a `bin/init.js`
file, all present at the repo root).

This skill turns an ad-hoc "let's think about how this could break" conversation into a
repeatable, evidence-producing exercise. It is a **durable self-hardening capability**, not a
one-off brainstorm: every run is seeded from a cited failure-mode catalog, exercises the real
shipped code, and converts every gap into a replayable regression fixture so the finding survives
after the session ends.

## When to load this skill

Load whenever the task is to harden one specific, already-shipped component or pipeline **in this
project** by stress-testing it — especially at a **trust boundary** where content originating
outside the project (a third-party input, a fetched URL, an uploaded file, an installer input,
user-supplied data) crosses into code that executes with the project's own privileges. Examples:
hardening a form-input handler, stress-testing an auth pipeline, probing a config parser. Do not
load it for the hivemind framework's own internals (that is `hive-adversarial-improve`; see the
context guard above), for routine feature review (that's the `reviewer` agent), or for open-ended
security research with no concrete component in scope (that's the `researcher` agent).

## The two load-bearing rules

Everything below is scaffolding around these two rules. Drop either one and the exercise stops
producing durable value:

1. **The live pipeline is the REAL shipped code — never a tabletop description.** The exercise must
   execute the actual gate code, the actual CLI calls, the actual subagent spawns that ship in this
   project today. A review where the pipeline is played "in the abstract" (a human narrating what the
   code *would* probably do) is not a hardening review — it is a brainstorm with role names, and it
   systematically misses the exact class of bug (a missed `await`, a regex that doesn't anchor, a
   gate that's wired to the wrong function) that only shows up when the real code runs.
2. **Every gap becomes a `tdd` ticket, with the probe input as a replayable test fixture.** A
   finding that lives only in a chat transcript evaporates the moment the session ends. The
   acceptance criterion for that ticket is literally "replaying this exact input is now caught" —
   the probe artifact itself is the fixture the new test asserts against.

## The 9-step protocol

1. **Name the component and its trust boundaries.** Write down every place untrusted content
   crosses into trusted execution for this component (a fetched file being parsed, user-supplied
   input being read by an agent or handler, a config value being interpolated into a shell call).
   Each boundary gets at least one probe.
2. **Assign roles.** The Reviewer (you, the orchestrator) runs the exercise. The Challenger is a
   subagent briefed with the cited failure-mode catalog (`references/failure-mode-catalog.md`) and
   nothing else — no advance knowledge of the specific defenses beyond what an outside caller could
   plausibly have. The live pipeline is the real shipped code, run for real (see rule 1 — this is
   the single most important role assignment in the whole protocol). An optional Recorder takes
   notes and tracks the round log without participating.
3. **Seed one probe per trust boundary from a cited catalog.** Pull concrete probe ideas from
   `references/failure-mode-catalog.md` — do not improvise novel failure classes from first
   principles. Improvised probes test the Challenger's imagination, not the component's real
   exposure to the input classes that are actually seen in the wild.
4. **Run rounds.** The Challenger proposes one concrete artifact (a crafted config value, a hostile
   fetched response, a malformed user input). The live pipeline processes it through the actual code
   path — the real gate, the real CLI, the real subagent. The Reviewer adjudicates the outcome as
   caught / missed / partial and records **which gate** (by name — a specific function, regex, or
   review step) was responsible for the catch or the miss.
5. **Adapt.** After each round, the Challenger tries to get past whichever specific gate caught it
   last round (a new alias, an extra indirection, a restructured input) — this is what surfaces the
   difference between a check that generalizes and one that only catches the literal input you
   started with.
6. **Stop condition.** End the exercise when any of: a fixed round budget (N rounds) is spent, the
   seeded catalog is exhausted, or a time-box expires. Fix the stop condition before round 1, not
   after a convenient result appears.
7. **Convert every gap into a `tdd` ticket.** The ticket's acceptance criterion is "replaying this
   exact input is now caught," and the probe artifact produced in step 4 is attached as the test
   fixture the new regression test asserts against (see rule 2).
8. **Feed the round log back as detection signal.** New patterns discovered in step 5 become new
   scanner rules and fixtures in this project's own detectors — whatever this project's analogous
   input-validation layer is. This closes the loop from "we found it once" to "we can no longer be
   surprised by it."
9. **Re-run the same probe set as a regression pass after fixes land.** Once every gap ticket from
   step 7 is closed, replay the full original probe set (not a fresh one) against the fixed pipeline
   to confirm every previously-missed input is now caught, and that no fix regressed a
   previously-caught one.

## References

- `references/failure-mode-catalog.md` — the supply-chain / third-party-content input taxonomy, with
  cited source URLs. Seed step 3's probes from here, not from imagination.
- `references/useless-vs-valuable.md` — the checklist for telling a hardening review that produced
  durable value from one that produced only a transcript. Run through it before step 6's stop
  condition and again before reporting results.

## Severity scoring

Adjudication in step 4 (and the tickets produced in step 7) reuse this project's reviewer
HIGH / MEDIUM / LOW severity convention (the same three-tier scale the `reviewer` agent shipped with
the hivemind plugin already runs on) rather than importing a numeric rubric from the security-testing
literature — that literature is qualitative, and there is no cross-project standard scale worth
adopting instead of the one already in use.

## Worked example

Read the `hive-adversarial-improve` skill's own "Worked example" section (framework repo only) for a
concrete reference run of this method end to end (`TASK-140` through `TASK-144` in the hivemind
framework's own history) if the steps above feel abstract — the mechanic is identical here, only the
target project differs: the live pipeline must always be this project's own real shipped code, run
end to end, never a tabletop description of what it "should" do.
