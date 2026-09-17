// tests/policy-propagation-doc-locks.spec.js
// TASK-233 (WG-H4-001) — the root break the whole 2026-09-16 wargaming
// campaign orders around: the repo already has the correct policy (TDD
// eliminated, manifest gate eliminated, mandatory human-approved use cases,
// wargaming as the real verification), but nothing catches it drifting away
// from the surfaces actually shipped to a consumer (agents/, skills/,
// commands/). Three real Developer spawns implemented against the stale
// installed plugin with ZERO refusals (3/3) because the refusal rule simply
// was not present in the agent they ran — this file is the sensor that
// would have caught that surface going stale BEFORE it shipped.
//
// Acceptance criteria covered (fast tier — reads committed files, no disk
// I/O, no mkdtemp, no process spawn):
//   AC2 — a sensor fails when a consumer-shipped surface contradicts the
//         live policy: zero "absent means tdd" (or the other measured
//         retired tests-first-gate phrasings), plus mandatory presence of
//         the human-approval refusal gate (developer.md) and the wargaming
//         final-verification gate (reviewer.md, SKILL.md).
//   AC3/WG-H-017 — vitest.config.all.js no longer instructs running the
//         e2e-including suite before hand-off.
//   AC4/WG-H4-003 — the human-approval hard stop is written IN the
//         Orchestrator's dispatch point (SKILL.md Workflow step 2, before
//         the Developer is spawned in step 4), not only as general policy.
//   AC5 — this file itself never touches tasks/ (see the last describe
//         block below): it is a pure fs-read doc-lock, same shape as every
//         other doc-lock in this suite, and structurally cannot rewrite a
//         historical tdd-tier ticket (TASK-212 forbids that).
//
// Scope decision (developer, TASK-233): checks read only the plugin-root
// copies (agents/, skills/, commands/) — the SAME convention already
// established by tests/agility-doc-locks.spec.js and the TASK-213 block in
// tests/verification-policy-docs.spec.js. tests/agents-parity.spec.js
// already fails on any byte divergence between the plugin-root copies and
// their .claude/ mirrors, so re-reading the .claude/ copies here would be
// redundant (flagged LOW at review under the documented convention, not a
// gap this file needs to re-close).
//
// Non-vacuity (AC2/Regla-adjacent "no candado vacuo"): every check below is
// backed by a pure, exported function in tests/helpers/policyPropagationChecks.js
// so the exact same logic can be (and was, at hand-off time) run against
// mutated /tmp copies of these files to prove each check actually goes red
// for the right reason — never against the repo itself. See the hand-off
// for the full mutant -> died/survived table; that proof is not re-run here
// because committing a mutation, even a temporary one, is exactly what the
// "never on the repo" instruction for this ticket forbids.
//
// RED-GREEN PLANT PROTOCOL (reported in the hand-off, not committed): each
// assertion below was verified able to fail for the right reason using an
// ephemeral /tmp harness (tmp copies of the target files, mutated with
// node:fs, checked with the same helper functions imported by this file),
// never by editing the files in this working tree. See the hand-off for the
// harness script and its output.
//
// Test budget (Regla 3, self-applied): TASK-233 has 6 acceptance criteria;
// the 6 `it` blocks below (5 original + 1 added in the wargaming loop-back
// round for HIGH-3, commands/loop.md's positive gate) are within that cap,
// no justification needed.
//
// WARGAMING LOOP-BACK (2026-09-17): an adversarial pass built 85 mutants
// against this file + its helper and found HIGH-1 (retired policy live on
// skills/impl-block-tasks/SKILL.md, fixed on that file, not here), HIGH-2
// (hardcoded 5-file surface list, fixed via `enumerateConsumerSurfaces`
// below), HIGH-3 (commands/loop.md had no positive lock, fixed via the new
// describe block below using `hasLoopMdGates`), plus MEDIUM/LOW findings
// fixed inside tests/helpers/policyPropagationChecks.js — see that file's
// own header for the full per-finding account, including which findings
// were deliberately left as documented limitations rather than "fixed".
//
// WARGAMING LOOP-BACK, 3RD PASS (2026-09-17, TASK-233 re-spawn): one HIGH
// (WG2-233-001, the "test-first (red-green)" mutant + the allowlist-
// silenced .claude/shared/TDD.md pointer) and two MEDIUM edges of the same
// class (the enumerator missing 7 real references/*.md + nested-skill-dir
// surfaces; the loop.md positive gate being positional over the whole file
// instead of anchored to the real step list) survived the 2nd pass. All
// three are fixed in tests/helpers/policyPropagationChecks.js — see that
// file's own "3rd PASS" header block for the per-finding account. The four
// `it` blocks added below (see the new describe block near the bottom of
// this file, plus two assertions folded into AC2's existing block) are the
// minimal regression locks for those four fixes: within this loop-back's
// own scope (1 HIGH + 2 MEDIUM + 1 measured-false-positive regression),
// proportionate to what broke, not a fresh per-ticket AC budget.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './helpers/repoRoot.js';
import {
  enumerateConsumerSurfaces,
  findForbiddenMatches,
  hasDeveloperRefusalGate,
  hasSkillDispatchHardStop,
  hasReviewerWargamingGate,
  hasSkillWargamingFinalStep,
  vitestAllConfigDefersE2eToWargaming,
  hasLoopMdGates,
} from './helpers/policyPropagationChecks.js';

function load(relPath) {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8');
}

// ===========================================================================
// AC2 — zero retired tests-first-gate phrasings on any consumer surface
// ===========================================================================
// Harm this prevents: WG-H4-001, measured live — a consumer-shipped surface
// that still declares "absent means tdd" (or instructs tests-first as a gate
// under any of the other measured phrasings) causes every Developer spawned
// against it to implement without an approved use-case list, 3 of 3 times
// observed. This is the sensor that would have caught the plugin going
// stale before a human ever had to notice it live.
//
// Wargaming loop-back (2026-09-17), HIGH-2: the surface list used to be a
// hardcoded 5-file array — 25 of ~30 shipped surfaces were invisible to this
// scan. `enumerateConsumerSurfaces` reads agents/*.md, commands/*.md, and
// skills/*/SKILL.md straight off disk (and throws, per the TASK-192
// empty-result contract, if it finds zero — see the helper) so a new,
// renamed, or previously-overlooked surface is scanned automatically instead
// of needing a human to remember to add it to a list.
describe('AC2 — zero retired tests-first-gate phrasing on any shipped consumer surface', () => {
  it('no consumer surface (agents/, commands/, skills/*/SKILL.md — enumerated from disk) contains a retired tests-first-gate phrase', () => {
    const surfaces = enumerateConsumerSurfaces(REPO_ROOT);
    expect(surfaces.length).toBeGreaterThan(0);

    const offenders = [];
    for (const relPath of surfaces) {
      const text = load(relPath);
      const matches = findForbiddenMatches(text);
      if (matches.length > 0) offenders.push({ relPath, matches });
    }
    expect(
      offenders,
      `retired tests-first-gate phrasing found on shipped surfaces: ${JSON.stringify(offenders, null, 2)}`,
    ).toEqual([]);
  });

  // Harm this prevents (3rd wargaming pass, MEDIUM edge): the enumerator used
  // to read only ONE level (agents/*.md, commands/*.md, skills/*/SKILL.md),
  // so 7 real `references/*.md` files and any nested skill directory were
  // never scanned — a retired-policy phrase planted there would ship to a
  // consumer with zero sensor coverage. Locks the recursive walk's real
  // count against silent regression back to the one-level version.
  it('enumerateConsumerSurfaces recurses into skills/*/references/*.md, not only skills/*/SKILL.md', () => {
    const surfaces = enumerateConsumerSurfaces(REPO_ROOT);
    expect(surfaces.length).toBe(37);
    const referencesSurfaces = surfaces.filter((s) => s.includes('/references/'));
    expect(referencesSurfaces.length).toBe(7);
  });
});

// ===========================================================================
// WG2-233-001 (3rd wargaming pass, 2026-09-17) — the exact HIGH mutant that
// survived the 2nd pass, plus the measured false-positive regression lock
// ===========================================================================
// Harm this prevents: the retired task-authoring instruction ("phrase the
// outcome so a test-first (red-green) test can assert it") tells whoever
// authors the next skill's task template to write the test before the
// implementation exists — the exact ordering CLAUDE.md eliminated on
// 2026-09-16 — and it survived verbatim in both copies of
// skills/impl-block-tasks/SKILL.md through the 2nd wargaming pass because no
// pattern existed for either "test-first" or "red-green". Equally important:
// this same lock proves the fix does NOT flag the CORRECT, still-live
// "red-green planting" policy text (agents/developer.md's own section),
// which the ticket briefing specifically warned against breaking.
describe('WG2-233-001 — the test-first (red-green) mutant is caught, and real red-green-planting policy text is not', () => {
  it('findForbiddenMatches catches the exact mutant phrasing, and the .claude/shared/TDD.md pointer even next to unrelated "eliminated" prose', () => {
    const mutant =
      'Observable, **testable** outcome -- phrased so a test-first (red-green) test can assert it';
    expect(findForbiddenMatches(mutant)).toEqual(['test-first-red-green-outcome-phrasing']);

    const dangling =
      'See .claude/shared/TDD.md for the full discipline. TDD is eliminated as of 2026-09-16.';
    expect(findForbiddenMatches(dangling)).toContain('tdd-md-dangling-pointer');
  });

  it('does not flag the live, correct "Red-green planting" section of agents/developer.md or agents/reviewer.md', () => {
    expect(findForbiddenMatches(load('agents/developer.md'))).toEqual([]);
    expect(findForbiddenMatches(load('agents/reviewer.md'))).toEqual([]);
  });

  // Harm this prevents: these three exact phrases correctly state CURRENT
  // policy (tdd retired, tests-after default, "do not write tests first" as
  // a prohibition) — flagging them as violations would train whoever reads
  // this sensor's failures to distrust it, or worse, to delete correct
  // policy prose to appease it. Locks the 2026-09-17 false-positive fix
  // (negation lookbehind on write-tests-first-instruction; two new
  // TDD_ALLOWLIST_STEMS) against silent regression.
  it('does not flag the three measured false-positive phrases (correct policy prose)', () => {
    const fp1 = 'El tier tdd ya se fue del enum; hoy todo es tests-after o uat-only.';
    const fp2 = 'TASK-212 cerro 100 tickets con tier tdd; el default hoy es tests-after.';
    const fp3 = 'Do not write the tests first under any tier.';
    expect(findForbiddenMatches(fp1)).toEqual([]);
    expect(findForbiddenMatches(fp2)).toEqual([]);
    expect(findForbiddenMatches(fp3)).toEqual([]);
  });
});

// ===========================================================================
// AC2 + AC4/WG-H4-003 — the human-approval refusal gate must be present, and
// present AT the Orchestrator's dispatch point, not only as general policy
// ===========================================================================
// Harm this prevents: WG-H4-003 — a hard stop that only exists as general
// policy prose, with no instantiation at the actual point where the
// Orchestrator hands off to the Developer, is not a hard stop a real
// dispatch can trip over. This pins both halves of the gate: the
// Developer's own refusal instruction, and the Orchestrator's dispatch-point
// STOP that must precede it structurally.
describe('AC2 + AC4/WG-H4-003 — human-approval refusal gate present at the Developer and at the dispatch point', () => {
  it('developer.md carries the refusal rule, and SKILL.md carries the hard stop inside the dispatch step', () => {
    const devResult = hasDeveloperRefusalGate(load('agents/developer.md'));
    expect(
      devResult.ok,
      `agents/developer.md must carry the human-approval refusal gate: ${JSON.stringify(devResult)}`,
    ).toBe(true);

    const skillResult = hasSkillDispatchHardStop(load('skills/orchestrator-routing/SKILL.md'));
    expect(
      skillResult.ok,
      `skills/orchestrator-routing/SKILL.md must carry the human-approval hard stop between Workflow ` +
        `step 1 (fetch ticket) and step 4 (spawn Developer), i.e. AT the dispatch point: ${JSON.stringify(skillResult)}`,
    ).toBe(true);
  });
});

// ===========================================================================
// AC2 — wargaming named as the final, real verification (reviewer.md +
// SKILL.md), positioned as the last step before ticket close
// ===========================================================================
// Harm this prevents: without this, a review APPROVE alone could be read
// (again) as "this ticket is verified" — which is exactly the pre-2026-09-16
// failure mode the wargaming step exists to close. A gate that only lives as
// prose, not positioned as the actual last step before close, degrades back
// into decoration the first time someone reorders the Workflow steps.
describe('AC2 — wargaming named as the final verification, in reviewer.md and at the end of SKILL.md Workflow', () => {
  it('reviewer.md and SKILL.md both name wargaming as the real, final verification step', () => {
    const revResult = hasReviewerWargamingGate(load('agents/reviewer.md'));
    expect(
      revResult.ok,
      `agents/reviewer.md must name the wargaming pass as the verification of record with >=2 HIGH findings: ${JSON.stringify(revResult)}`,
    ).toBe(true);

    const skillResult = hasSkillWargamingFinalStep(load('skills/orchestrator-routing/SKILL.md'));
    expect(
      skillResult.ok,
      `skills/orchestrator-routing/SKILL.md must position the wargaming step between "Spawn the Reviewer" ` +
        `and "Update ticket", and state a HIGH wargaming finding blocks the close: ${JSON.stringify(skillResult)}`,
    ).toBe(true);
  });
});

// ===========================================================================
// HIGH-3 (wargaming loop-back, 2026-09-17) — commands/loop.md carries BOTH
// 2026-09-16 gates as actual loop steps, positioned correctly
// ===========================================================================
// Harm this prevents: commands/loop.md was in the old hardcoded surface list
// but had NO positive lock — only the (now surface-wide) forbidden scan. An
// adversary proved that reverting the file to the real, gates-free v0.22.0
// content, or deleting its step-3 approval hard stop and step-6 wargaming
// step wholesale, both stayed green. This is the surface where the gates
// matter most: it is what an UNATTENDED loop actually reads before
// dispatching a Developer with no human in the turn.
describe('HIGH-3 — commands/loop.md carries the approval hard stop and the wargaming step', () => {
  it('commands/loop.md positions the use-case-approval STOP before the Developer spawn, and the wargaming step (with its close-blocking rule) after it', () => {
    const result = hasLoopMdGates(load('commands/loop.md'));
    expect(
      result.ok,
      `commands/loop.md must carry both 2026-09-16 gates as positioned loop steps: ${JSON.stringify(result)}`,
    ).toBe(true);
  });

  // Harm this prevents (3rd wargaming pass, MEDIUM edge 2): the old check
  // was positional over the WHOLE FILE, so an adversary could gut the real
  // step 3/step 6 gates inside the Step 2 fence and paste a
  // "APENDICE HISTORICO (derogado, NO rige)" block containing the same four
  // phrases, in order, BEFORE the real step list — `text.indexOf` found the
  // decoy occurrences first and the ordering check passed on a functionally
  // gate-free file. Locks that the check is now scoped to the Step 2 fenced
  // block only, so content outside that one fence — decoy or otherwise — is
  // structurally invisible to it.
  it('does not pass when the real step-3/step-6 gates are gutted but a matching decoy phrase set is pasted before the Step 2 step list', () => {
    const real = load('commands/loop.md');
    const decoy = [
      '## APENDICE HISTORICO (derogado, NO rige)',
      '',
      "STOP for the human's EXPLICIT approval of a historical, no-longer-relevant step.",
      'Spawn the Developer subagent, briefed with the approved use-case list from a retired flow.',
      'Wargaming step: once the review is green, run the adversarial pass, historically.',
      'A HIGH-severity wargaming',
      '     finding blocks the close, historically speaking.',
      '',
    ].join('\n');
    const gutted = real
      .replace(
        /3\. \[MANDATORY, 2026-09-16 human decision[\s\S]*?approval before proceeding to step 4\./,
        '3. Derive the list and proceed. No approval needed.',
      )
      .replace(
        /6\. \[MANDATORY, 2026-09-16 human decision, same non-liftable status[\s\S]*?proceeding to step 7\./,
        '6. Proceed to close.',
      );
    // Sanity: the replacements above must have actually matched something,
    // or this test would vacuously pass against an unrelated file shape.
    expect(gutted).not.toEqual(real);
    const bypassed = decoy + gutted;
    expect(hasLoopMdGates(bypassed).ok).toBe(false);
  });
});

// ===========================================================================
// AC3/WG-H-017 — vitest.config.all.js no longer instructs e2e-before-handoff
// ===========================================================================
// Harm this prevents: a Developer or Reviewer reading this file's own header
// comment for guidance would run the full e2e-including suite at every
// hand-off, burning wall-clock re-proving specs the wargaming step was
// specifically designed to defer execution of — the exact waste the
// 2026-09-16 decision eliminated.
describe('AC3/WG-H-017 — vitest.config.all.js defers e2e execution to the wargaming step', () => {
  it('vitest.config.all.js header no longer says the Developer runs it before hand-off', () => {
    const result = vitestAllConfigDefersE2eToWargaming(load('vitest.config.all.js'));
    expect(
      result.ok,
      `vitest.config.all.js must not instruct running before hand-off, and must mention the wargaming ` +
        `step as where e2e specs actually execute: ${JSON.stringify(result)}`,
    ).toBe(true);
  });
});

// ===========================================================================
// AC5 — this sensor never touches tasks/, and cannot rewrite a historical
// tdd-tier ticket (TASK-212 forbids that)
// ===========================================================================
// Harm this prevents: a doc-lock sensor that silently grew a write path onto
// tasks/ could, even by accident, mutate or "helpfully" re-tier one of the
// ~100 historical tdd-tier tickets TASK-212 explicitly forbids rewriting —
// this pins that this file (and the surfaces it reads) never becomes that
// write path.
describe('AC5 — the sensor is a pure fs-read surface check; it never touches tasks/', () => {
  it('this spec file and its helper module reference only read paths, never tasks/ or a task-store write function', () => {
    const specSource = readFileSync(join(REPO_ROOT, 'tests', 'policy-propagation-doc-locks.spec.js'), 'utf8');
    const helperSource = readFileSync(
      join(REPO_ROOT, 'tests', 'helpers', 'policyPropagationChecks.js'),
      'utf8',
    );
    const combined = specSource + '\n' + helperSource;

    // Comments in this very file legitimately mention the tasks/ directory
    // in prose (explaining what TASK-212 forbids) — what must be absent is
    // a quoted PATH reference to it (the shape a real read/write call would
    // take), or a reference to any task-store write function.
    expect(combined).not.toMatch(/['"`]tasks\//);
    // Actual invocation shape (name immediately followed by an open paren, or
    // an import specifier pointing at task-store.js) — not a bare mention of
    // the function name, which this very assertion's own source contains.
    expect(combined).not.toMatch(
      /(writeFileSync|appendComment|closeTask|transitionStatus|createTask)\s*\(|from\s+['"][^'"]*task-store\.js['"]/,
    );
  });
});
