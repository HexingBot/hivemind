// tests/helpers/policyPropagationChecks.js
// TASK-233 (WG-H4-001) — pure, path-agnostic checks for whether a
// consumer-shipped instruction surface (agents/, skills/, commands/) still
// carries the retired TDD-gate policy, or is missing the two 2026-09-16
// gates (human-approval hard stop, wargaming as final verification).
//
// Deliberately extracted from the spec file so the SAME logic can be run
// against files that are NOT this repo's: tests/policy-propagation-doc-locks.spec.js
// runs it over the real committed repo files, and an out-of-repo mutant caller
// runs it over deliberately-broken /tmp copies to prove each check can actually
// fail (see the TASK-233 hand-off for the mutant table; the reviewer exercised
// this path independently). Enabling that out-of-repo caller — not a second
// committed import — is what earns this file existing as its own module rather
// than living inline in the spec, where the checks could only ever be pointed
// at the repo that makes them pass.
//
// Every function here is pure: it takes a string (file content) and returns
// a plain result. No fs, no repo-root resolution — that stays in the caller.

// ---------------------------------------------------------------------------
// Forbidden phrases — the measured, real wording of the retired tests-first
// gate (git show a45808c:agents/developer.md, the last commit before TASK-212
// retired the `tdd` tier) plus the "absent means tdd" default that survived
// past TASK-212 in the actually-installed stale plugin (confirmed live:
// ~/.claude/plugins/cache/hivemind-marketplace/hivemind/0.22.0/agents/developer.md
// line 16, and its SKILL.md, both still contain it as of 2026-09-16). Each
// pattern is a multi-word phrase, not a bare substring, per the TASK-184/
// TASK-229 substring-collision precedent.
// ---------------------------------------------------------------------------
export const FORBIDDEN_PATTERNS = [
  {
    name: 'absent-means-tdd',
    re: /absent means[\s`]*tdd\b/i,
    harm:
      'a shipped surface that still defaults an unset verification_tier to the retired `tdd` ' +
      'tier re-legitimizes tests-first as a live, assignable tier for any Developer that reads it',
  },
  {
    name: 'before-writing-any-implementation-code',
    re: /before writing any implementation code/i,
    harm: 'reintroduces a tests-first gate instructing tests be written before any implementation exists',
  },
  {
    name: 'never-write-implementation-before-test-commit',
    re: /never write implementation code before/i,
    harm: 'reintroduces the retired two-commit tests-first discipline as a live instruction',
  },
  {
    name: 'strictly-before-implementation-commit',
    re: /strictly before[\s\S]{0,40}implementation commit/i,
    harm: 'reintroduces the retired test-commit-must-land-first ordering rule',
  },
  {
    name: 'tests-first-step-tdd-tier-only',
    re: /tests-first step \(tdd tier only/i,
    harm: 'reintroduces the retired tdd-tier tests-first step heading as a live section',
  },
];

/** Returns the array of forbidden-pattern names that match `text`. Empty = clean. */
export function findForbiddenMatches(text) {
  return FORBIDDEN_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.name);
}

// ---------------------------------------------------------------------------
// Required presence checks — the two 2026-09-16 gates that must be reachable
// on the specific surfaces the wargaming campaign found missing them.
// ---------------------------------------------------------------------------

/**
 * developer.md must carry the Developer-side refusal rule: refuse to
 * implement without an approved use-case list, both as the general Inputs
 * statement and as the concrete Spanish "TDD ELIMINADO" refusal instruction.
 */
export function hasDeveloperRefusalGate(developerText) {
  const hasGeneralStatement = /no approved list, no implementation/i.test(developerText);

  const headingIdx = developerText.search(/^## TDD ELIMINADO/m);
  const section =
    headingIdx === -1 ? '' : developerText.slice(headingIdx, headingIdx + 4000);
  const refuseRe =
    /no empieces a implementar[\s\S]{0,200}devolve el control al Orquestador|devolve el control al Orquestador[\s\S]{0,200}no empieces a implementar/i;
  const hasRefusalInstruction = headingIdx !== -1 && refuseRe.test(section);

  return { ok: hasGeneralStatement && hasRefusalInstruction, hasGeneralStatement, hasRefusalInstruction };
}

/**
 * skills/orchestrator-routing/SKILL.md must carry the human-approval hard
 * stop AT the point where the Orchestrator dispatches to the Developer
 * (inside the numbered Workflow step 2, before step 4 spawns the Developer),
 * not only as a general policy paragraph elsewhere in the file.
 */
export function hasSkillDispatchHardStop(skillText) {
  const stopPhrase = "Then STOP and get the human's approval of the list";
  const stopIdx = skillText.indexOf(stopPhrase);
  const step1Idx = skillText.indexOf('1. **Fetch ticket.**');
  const step4Idx = skillText.indexOf('4. **Verify per tier.**');

  const positioned = stopIdx !== -1 && step1Idx !== -1 && step4Idx !== -1 && step1Idx < stopIdx && stopIdx < step4Idx;

  return { ok: positioned, stopIdx, step1Idx, step4Idx };
}

/**
 * reviewer.md must name the wargaming pass as the verification of record,
 * with at least the two HIGH findings that make a review-only green
 * insufficient (missing wargaming record; missing approved use-case list).
 */
export function hasReviewerWargamingGate(reviewerText) {
  const headingIdx = reviewerText.search(/^## Wargaming gate/m);
  if (headingIdx === -1) return { ok: false, highFindingCount: 0 };
  const section = reviewerText.slice(headingIdx, headingIdx + 3000);
  const hasVerificationOfRecordLine = /is not the verification of record/i.test(section);
  const highFindingCount = (section.match(/is a HIGH finding/g) ?? []).length;
  return { ok: hasVerificationOfRecordLine && highFindingCount >= 2, highFindingCount };
}

/**
 * skills/orchestrator-routing/SKILL.md must carry the wargaming step as the
 * LAST step before ticket close — positioned after "Spawn the Reviewer" and
 * before "Update ticket" in the numbered Workflow list — and must say a HIGH
 * wargaming finding blocks the close.
 */
export function hasSkillWargamingFinalStep(skillText) {
  const wargamingPhrase = '**Wargaming step — the real verification (2026-09-16 human decision).**';
  const wgIdx = skillText.indexOf(wargamingPhrase);
  const reviewerStepIdx = skillText.indexOf('5. **Spawn the Reviewer.**');
  const updateStepIdx = skillText.indexOf('6. **Update ticket.**');
  const positioned =
    wgIdx !== -1 && reviewerStepIdx !== -1 && updateStepIdx !== -1 && reviewerStepIdx < wgIdx && wgIdx < updateStepIdx;
  const blocksClose = /A HIGH-severity wargaming finding blocks the close/.test(skillText);
  return { ok: positioned && blocksClose, positioned, blocksClose };
}

/**
 * vitest.config.all.js must no longer instruct that the Developer runs the
 * full (e2e-including) suite before hand-off — that execution moved to the
 * wargaming step (2026-09-16 decision, WG-H-017).
 */
export function vitestAllConfigDefersE2eToWargaming(vitestAllText) {
  const stillInstructsPreHandoff = /runs this before hand-off/i.test(vitestAllText);
  const mentionsWargamingDeferral = /wargaming step/i.test(vitestAllText);
  return { ok: !stillInstructsPreHandoff && mentionsWargamingDeferral, stillInstructsPreHandoff, mentionsWargamingDeferral };
}

export const CONSUMER_SURFACES = [
  'agents/developer.md',
  'agents/reviewer.md',
  'agents/researcher.md',
  'skills/orchestrator-routing/SKILL.md',
  'commands/loop.md',
];
