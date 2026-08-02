# Reviewer checklist

Derived from the goal that opened the 2026-08-02 session: **make hivemind develop faster without
losing a review that proves we built what was asked.** Every item below exists because a real
defect got past us this week, and the citation names it. Nothing here is precautionary.

Use alongside `agents/reviewer.md`, which remains the process of record. This is the
goal-anchored layer on top of it.

---

## A — Did we build what was asked?

The goal names this explicitly, and it is the weakest link in the system: the binding between a
request and the shipped work is prose judged by an agent, with no mechanical sensor behind it.

- [ ] **Restate each acceptance criterion and give it an individual verdict.** Not a summary
      verdict over the set. An 8-AC ticket gets 8 verdicts.
- [ ] **Check the ACs against the request, not just the diff against the ACs.** A ticket can be
      re-scoped mid-flight; verify the criteria still describe what the human actually wanted.
- [ ] **Name any AC that cannot fail.** "It works correctly", an empty string, and whitespace are
      all currently accepted by the task store. An unfalsifiable criterion gives you nothing to
      check and should be reported, not quietly satisfied.
- [ ] **Check for criteria you were never shown.** Acceptance criteria are truncated at 4000
      characters when interpolated into a briefing. A criterion past the cut is still binding on
      the ticket and invisible to you. If the ACs look truncated, read `tasks/<KEY>.json` directly.
- [ ] **Verify the tier was right, independently.** State the tier you would have assigned before
      reading the assigned one. The orchestrator both assigns the tier and benefits from a lighter
      one, and no downstream sensor checks it.

## B — Is the check real, or only green?

Three sensors were found this week that were green while the thing they guarded was broken. None
was caught by the suite. This section is the highest-yield part of the checklist.

- [ ] **Mutate the subject and confirm the test fails.** If breaking the code leaves the spec
      green, the spec is decoration. Do this in a scratchpad copy — never mutate the working tree.
- [ ] **Check what the fixture presupposes.** A test that stages its own precondition may be
      asserting a world no caller inhabits. *(A pack-ctl soft-failure test staged owned copies into
      its own fixture, so it passed throughout an outage that shipped across multiple releases.)*
- [ ] **Check where the checked set comes from.** A lock that derives what it verifies from a
      success path can never see failure-only fields. *(The design-pack doc-lock derived its field
      names from a success run, so `code` and `message` formed an empty set that passed.)*
- [ ] **Check the predicate for accidental satisfaction.** Substring matches are the usual culprit.
      *(`doc.includes('code')` was already true because of the word "hardcoded".)*
- [ ] **Confirm every alternation of a new pattern is individually covered.** A regex with six
      claimed behaviours and three test inputs has untested branches that can be deleted silently.
- [ ] **Zero results are a finding, not a pass.** `test:since` selecting no specs, an empty install
      list, an empty checked set — none of these is evidence of success. Investigate before
      accepting.

## C — Does the evidence exist, and can you reproduce it?

- [ ] **For `tdd` tier, find the captured red run** and confirm it fails for the *right* reason —
      not an import error or a typo. If the hand-off does not contain it, reproduce it yourself by
      reverting or stashing the implementation hunks.
- [ ] **Treat a hand-off claim as a claim.** Session loss has already destroyed red-run evidence
      once. Re-derive rather than trust, and say in your report which you did.
- [ ] **Re-run the gate yourself** — the scoped selection, the full fast tier, and any named e2e
      spec. A green developer hand-off must reproduce as green in your hands.
- [ ] **Scrutinise any changed expected value.** A test whose expectation moved to match new
      behaviour is the shape of calibration laundering. Adjudicate it: was the old assertion
      pinning correct behaviour, or pinning the bug? Cite evidence either way.

## D — Does it break what already works?

- [ ] **Check the fix does not undo a recent one.** Several fixes may land in a single day; a
      later ticket can silently invalidate an earlier one. *(A doc corrected in the morning was
      wrong again two minutes later when a sibling ticket changed the behaviour it described.)*
- [ ] **Verify against live data, not fixtures alone.** A tightened validator that rejects real
      stored values is worse than the hole it closed. Run the real data through it and report the
      count.
- [ ] **Confirm docs still match code.** If the diff changes a contract, find every place that
      contract is described — module headers, command docs, skill files — not just the one the
      ticket mentioned.
- [ ] **Check both parity copies.** Anything duplicated between `.claude/` and plugin-root must be
      byte-identical. Diff them.
- [ ] **Confirm committed build artifacts are freshly machine-built,** not hand-edited.

## E — Was it faster for the right reason?

Speed is a goal. Speed bought by skipping a gate is not speed, it is deferred cost.

- [ ] **Note the review depth and whether it matched the rubric.** If the depth was overridden,
      that must be recorded on the ticket. An unrecorded downgrade is indistinguishable from a
      diff that legitimately earned a light pass.
- [ ] **Escalate on suspicion.** Depth may always be raised, never lowered. A surprising diff, a
      sensor that smells vacuous, a hand-off that reads too smoothly — all are sufficient reason.
- [ ] **Flag redundant new tests.** Suite size should track product surface, not ticket count.
- [ ] **Say plainly what you did not verify.** An unstated gap is worse than a stated one, because
      it reads as coverage.

---

## Reporting

Findings are HIGH / MEDIUM / LOW with a file:line anchor and a concrete failure scenario. A HIGH
blocks. Say APPROVE or REQUEST-CHANGES explicitly — never imply it.

State which checks you ran and which you skipped. A reviewer that quietly skips a section
reproduces the exact failure this checklist exists to prevent.

**Provenance:** every citation above is a defect found on 2026-08-02, recorded in TASK-181,
TASK-183, TASK-184, TASK-185, and TASK-186 through TASK-193. This document is not enforced by any
sensor — it is a convention, and conventions are precisely what this week showed to be
insufficient on their own. Folding it into `agents/reviewer.md` so it ships with every spawn is
tracked separately.
