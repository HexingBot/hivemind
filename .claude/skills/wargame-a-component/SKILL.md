---
name: wargame-a-component
description: Load when adversarially stress-testing a specific framework component/pipeline for security or correctness failures — especially a trust boundary where untrusted content crosses into trusted execution (third-party skill adoption, tool-use pipelines, installers, parsers). Triggers on "wargame this", "red-team this component", "adversarial test", "find failure modes in <component>".
---

# Wargame a Component

This skill turns an ad-hoc "let's think about how this could be attacked" conversation into a
repeatable, evidence-producing exercise. It is a **durable red-team capability**, not a one-off
brainstorm: every run is seeded from a cited attack taxonomy, exercises the real shipped code, and
converts every failure into a replayable regression fixture so the finding survives after the
room empties.

## When to load this skill

Load whenever the task is to adversarially probe one specific, already-shipped component or
pipeline — especially at a **trust boundary** where content originating outside the project
(a third-party skill, a fetched URL, an uploaded file, an installer input) crosses into code that
executes with the project's own privileges. Examples: vetting a new skill-adoption pipeline,
stress-testing a tool-use dispatch loop, probing an installer or config parser. Do not load it for
routine feature review (that's the `reviewer` agent) or for open-ended security research with no
concrete component in scope (that's the `researcher` agent).

## The two load-bearing rules

Everything below is scaffolding around these two rules. Drop either one and the exercise stops
producing durable value:

1. **Blue plays the REAL shipped pipeline — never a tabletop description.** Blue must execute the
   actual gate code, the actual CLI calls, the actual subagent spawns that ship in the repo today.
   A wargame where Blue is played "in the abstract" (a human narrating what the code *would*
   probably do) is not a wargame — it is a brainstorm with role names, and it systematically misses
   the exact class of bug (a missed `await`, a regex that doesn't anchor, a gate that's wired to the
   wrong function) that only shows up when the real code runs.
2. **Every 'Red wins' outcome becomes a `tdd` ticket, with the inject as a replayable test
   fixture.** A caught-nothing finding that lives only in a chat transcript evaporates the moment
   the session ends. The acceptance criterion for that ticket is literally "replaying this exact
   inject is now caught" — the inject artifact itself is the fixture the new test asserts against.

## The 9-step protocol

1. **Name the component and its trust boundaries.** Write down every place untrusted content
   crosses into trusted execution for this component (a fetched file being parsed, a third-party
   skill's instructions being read by an agent, a config value being interpolated into a shell
   call). Each boundary gets at least one inject.
2. **Assign roles.** Control (you, the orchestrator) runs the exercise. Red is a subagent briefed
   with the cited attack taxonomy (`references/attack-taxonomy.md`) and nothing else — no advance
   knowledge of the specific defenses beyond what a real external attacker could plausibly have.
   Blue is the real shipped pipeline, run for real (see rule 1 — this is the single most important
   role assignment in the whole protocol). An optional White cell takes notes and tracks the round
   log without participating in either side.
3. **Seed one inject per trust boundary from a cited taxonomy.** Pull concrete inject ideas from
   `references/attack-taxonomy.md` — do not improvise novel attack classes from first principles.
   Improvised injects test the Red player's imagination, not the component's real exposure to
   attacks that are actually happening in the wild.
4. **Run rounds.** Red proposes one concrete artifact (a malicious skill file, a crafted config, a
   poisoned fetch response). Blue processes it through the actual code path — the real gate, the
   real CLI, the real subagent. Control adjudicates the outcome as caught / missed / partial and
   records **which gate** (by name — a specific function, regex, or reviewer step) was responsible
   for the catch or the miss.
5. **Adapt.** After each round, Red tries to evade whichever specific gate caught it last round
   (a new alias, an extra indirection, a restructured payload) — this is what surfaces the
   difference between a pattern that generalizes and a pattern that only catches the literal
   inject you started with.
6. **Stop condition.** End the exercise when any of: a fixed round budget (N rounds) is spent, the
   seeded taxonomy is exhausted, or a time-box expires. Fix the stop condition before round 1, not
   after a convenient result appears.
7. **Convert every Red-win into a `tdd` ticket.** The ticket's acceptance criterion is "replaying
   this exact inject is now caught," and the inject artifact produced in step 4 is attached as the
   test fixture the new regression test asserts against (see rule 2).
8. **Feed the round log back as detection signal.** New evasion patterns discovered in step 5
   become new scanner rules and fixtures — for the assimilation pipeline this is the
   `src/skill-scan.js` pattern list; for other components, the analogous detector. This closes the
   loop from "we found it once" to "we can no longer be surprised by it."
9. **Re-run the same inject set as a regression pass after fixes land.** Once every Red-win ticket
   from step 7 is closed, replay the full original inject set (not a fresh one) against the fixed
   pipeline to confirm every previously-missed inject is now caught, and that no fix regressed a
   previously-caught one.

## References

- `references/attack-taxonomy.md` — the supply-chain / third-party-content inject taxonomy, with
  cited source URLs. Seed step 3's injects from here, not from imagination.
- `references/useless-vs-valuable.md` — the checklist for telling a wargame that produced durable
  value from one that produced only a transcript. Run through it before step 6's stop condition and
  again before reporting results.

## Severity scoring

Adjudication in step 4 (and the tickets produced in step 7) reuse this repo's existing reviewer
HIGH / MEDIUM / LOW severity convention (see `.claude/agents/reviewer.md` and the same three-tier
scale used by `src/skill-scan.js`'s pattern findings) rather than importing a numeric rubric from
the wargaming literature — that literature is qualitative, and there is no cross-project standard
scale worth adopting instead of the one this repo already runs on.

## Worked example (reference implementation)

TASK-140 through TASK-144 (the `hivemind-assimilate-skill` build-out) were produced by exactly
this method, and are a concrete reference implementation to read if the steps above feel abstract:
Blue was the real assimilation pipeline (`src/assimilate.js`), run end to end via a node harness
plus the actual `developer`/`reviewer` subagent loop — never a tabletop description of what the
pipeline "should" do. The TASK-142 HIGH finding was a genuine Red win, caught by running the real
exploit through the real pipeline rather than reasoning about it in the abstract. Each finding from
that round became its own `tdd` ticket with the triggering inject attached as the fixture the new
regression test now replays.
