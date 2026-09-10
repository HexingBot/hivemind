// tests/e2e/ac-fidelity-probes.spec.js
// TASK-189 — permanent regression replay of the 2026-08-02 adversarial
// hardening run's AC-fidelity probes (hive-adversarial-improve protocol
// rule 2: replayable fixtures). Source scripts, run against the REAL shipped
// task-store code in throwaway temp repos:
//   state/sessions/20260708T154259Z-29a27eda/artifacts/ac-fidelity-probes.mjs   (P1-P5)
//   state/sessions/20260708T154259Z-29a27eda/artifacts/ac-fidelity-round3.mjs   (C2)
//
// Each `it` below replays one probe's exact input against createTask() and
// asserts the previously-MISSED behaviour is now CAUGHT — or, where TASK-189's
// hand-off recorded a deliberate decision NOT to block (P1, P5), asserts the
// advisory/non-blocking behaviour instead. See src/task-store.js's
// validateAcceptanceCriteria / checkTierContentMismatch doc comments for the
// reasoning behind each disposition.

import { describe, it, expect, afterAll } from 'vitest';

import { PROD, makeRepoSkeleton } from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';

afterAll(cleanupAll);

const base = { description: 'Probe ticket.', priority: 'medium' };

async function loadStore() {
  return import(PROD.taskStore);
}

describe('TASK-189 — AC-fidelity probes replayed as permanent regression specs', () => {
  // ---------------------------------------------------------------- P1
  // Deliberately NOT blocked (TASK-189 AC5) — unfalsifiable-but-well-formed
  // prose is a human-judgement call left to review, not a schema/regex rule.
  it('P1 — "It works correctly." (unfalsifiable but well-formed) is deliberately ACCEPTED, not blocked', async () => {
    const { createTask } = await loadStore();
    const repoDir = makeTmpDir('acfid-p1');
    makeRepoSkeleton(repoDir, {});

    const result = await createTask({
      ...base,
      repoRoot: repoDir,
      title: 'P1 vacuous AC',
      acceptance_criteria: ['It works correctly.'],
    });
    expect(result.key).toMatch(/^TASK-\d{3,}$/);
  });

  // ---------------------------------------------------------------- P2
  it('P2 — an empty-string acceptance criterion is REJECTED (CAUGHT, was MISSED)', async () => {
    const { createTask, AcceptanceCriteriaError } = await loadStore();
    const repoDir = makeTmpDir('acfid-p2');
    makeRepoSkeleton(repoDir, {});

    let caught;
    try {
      await createTask({
        ...base, repoRoot: repoDir, title: 'P2 empty AC string', acceptance_criteria: [''],
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AcceptanceCriteriaError);
    expect(caught.code).toBe('E_INVALID_ACCEPTANCE_CRITERIA');
    expect(caught.message).toMatch(/empty or whitespace-only/);
  });

  // ---------------------------------------------------------------- P3
  it('P3 — a whitespace-only acceptance criterion is REJECTED (CAUGHT, was MISSED)', async () => {
    const { createTask, AcceptanceCriteriaError } = await loadStore();
    const repoDir = makeTmpDir('acfid-p3');
    makeRepoSkeleton(repoDir, {});

    let caught;
    try {
      await createTask({
        ...base, repoRoot: repoDir, title: 'P3 whitespace AC', acceptance_criteria: ['   \t  '],
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AcceptanceCriteriaError);
    expect(caught.code).toBe('E_INVALID_ACCEPTANCE_CRITERIA');
  });

  // A short but genuinely falsifiable AC must NOT be rejected by the P2/P3 fix
  // — the ticket's own "must not become a style police" warning.
  it('control — a terse but falsifiable criterion ("Exit code is 0.") is still ACCEPTED', async () => {
    const { createTask } = await loadStore();
    const repoDir = makeTmpDir('acfid-control');
    makeRepoSkeleton(repoDir, {});

    const result = await createTask({
      ...base, repoRoot: repoDir, title: 'control', acceptance_criteria: ['Exit code is 0.'],
    });
    expect(result.key).toMatch(/^TASK-\d{3,}$/);
  });

  // ---------------------------------------------------------------- P4
  it('P4 — an AC set exceeding the documented 4000-char briefing cap is REJECTED (CAUGHT, was MISSED)', async () => {
    const { createTask, AcceptanceCriteriaError } = await loadStore();
    const repoDir = makeTmpDir('acfid-p4');
    makeRepoSkeleton(repoDir, {});

    const huge = 'The system must ' + 'x'.repeat(12000) + ' behave correctly.';
    let caught;
    try {
      await createTask({
        ...base,
        repoRoot: repoDir,
        title: 'P4 oversized AC vs briefing cap',
        acceptance_criteria: [
          huge,
          'A second criterion that lives PAST the 4000-char truncation point and will never reach the reviewer.',
        ],
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AcceptanceCriteriaError);
    expect(caught.code).toBe('E_INVALID_ACCEPTANCE_CRITERIA');
    expect(caught.message).toMatch(/4000-char briefing cap/);
  });

  // ---------------------------------------------------------------- P5
  // Deliberately NOT hard-blocked (TASK-189 AC4) — advisory WARNING only.
  // TASK-218 C2/AC5 — also the "protection was not lost" case: a schema
  // mention + uat-only is exactly the shape the pre-TASK-218 tier-based
  // check already caught; it must keep producing a warning under the new,
  // tier-agnostic checkDangerousSurfaceMention.
  it('P5 — a schema-change ticket declared uat-only is ACCEPTED but carries a visible WARNING (advisory, was silent MISS)', async () => {
    const { createTask } = await loadStore();
    const repoDir = makeTmpDir('acfid-p5');
    makeRepoSkeleton(repoDir, {});

    const result = await createTask({
      repoRoot: repoDir,
      title: 'P5 schema change at uat-only tier',
      description: 'Change tasks/schema.json to add a new required field and migrate all existing task files.',
      acceptance_criteria: ['Schema updated and all task files migrated.'],
      priority: 'medium',
      verification_tier: 'uat-only',
    });
    expect(result.key).toMatch(/^TASK-\d{3,}$/);
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/schema/i);
  });

  // TASK-212 (2026-08-13 human decision) retired the 'tdd' tier. The former
  // "control — a schema-change ticket declared tdd carries NO warning" case
  // that used to live here (proving checkTierContentMismatch's now-deleted
  // `verification_tier === 'tdd'` exemption branch) tested machinery
  // createTask makes unreachable on its own (VERIFICATION_TIERS rejects
  // 'tdd' outright — see tests/e2e/verification-tier.spec.js's
  // createTask_rejects_the_retired_tdd_tier) — deleted rather than adapted.
  //
  // TASK-218 replaces it here with the control cases for the REPLACEMENT
  // mechanism (checkDangerousSurfaceMention, src/task-store.js — see
  // CLAUDE.md's "Dangerous surface" section for the definition it audits
  // against): the harm of losing the old tier-based signal wholesale, and
  // the harm of the never-shipped TASK-212 AC5 proposal that would have
  // gone silent on exactly the case that matters most now.
  it('control (TASK-218) — a schema-change ticket declared tests-after ALSO carries a WARNING (protection preserved; this is exactly the case that would have gone silent under TASK-212 AC5\'s rejected, never-shipped narrower threshold, now that tests-after is the default tier for all real work — harm prevented: a real schema/migration change landing with acceptance criteria that never name the data-corruption or migration risk)', async () => {
    const { createTask } = await loadStore();
    const repoDir = makeTmpDir('acfid-p218-tests-after');
    makeRepoSkeleton(repoDir, {});

    const result = await createTask({
      repoRoot: repoDir,
      title: 'TASK-218 schema change at tests-after tier',
      description: 'Change tasks/schema.json to add a new required field and migrate all existing task files.',
      acceptance_criteria: ['Schema updated and all task files migrated.'],
      priority: 'medium',
      verification_tier: 'tests-after',
    });
    expect(result.key).toMatch(/^TASK-\d{3,}$/);
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/schema/i);
    // C4 — the new advisory never names a tier and never recommends tdd.
    expect(result.warnings[0]).not.toMatch(/\btier\b/i);
    expect(result.warnings[0]).not.toMatch(/\btdd\b/i);
    expect(result.warnings[0]).toMatch(/concrete harm/i);
  });

  // C3 — harm prevented: a detector that fires on ordinary tickets teaches
  // the team to ignore it, exactly the noise-vs-signal trade the ticket's
  // own "why not just adjust the threshold" section warns against.
  it('control (TASK-218) — a ticket with NO dangerous-surface mention carries ZERO warnings', async () => {
    const { createTask } = await loadStore();
    const repoDir = makeTmpDir('acfid-p218-no-mention');
    makeRepoSkeleton(repoDir, {});

    const result = await createTask({
      ...base,
      repoRoot: repoDir,
      title: 'Ordinary ticket with no dangerous-surface mention',
      acceptance_criteria: ['The button is blue.'],
      verification_tier: 'tests-after',
    });
    expect(result.key).toMatch(/^TASK-\d{3,}$/);
    expect(result.warnings).toBeUndefined();
  });

  // ---------------------------------------------------------------- C2
  // (state/sessions/.../ac-fidelity-round3.mjs)
  it('C2 — marker:"[EXPLICIT]" with source_tier:"T4" is REJECTED by a real cross-field schema rule (CAUGHT, was MISSED)', async () => {
    const { createTask } = await loadStore();
    const repoDir = makeTmpDir('acfid-c2');
    makeRepoSkeleton(repoDir, {});

    await expect(createTask({
      ...base,
      repoRoot: repoDir,
      title: 'C2 calibration laundering',
      acceptance_criteria: ['The claim holds.'],
      marker: '[EXPLICIT]',
      source_tier: 'T4',
    })).rejects.toThrow(/source_tier/);
  });

  it('control — marker:"[EXPLICIT]" with source_tier:"T1" is still ACCEPTED', async () => {
    const { createTask } = await loadStore();
    const repoDir = makeTmpDir('acfid-c2-control');
    makeRepoSkeleton(repoDir, {});

    const result = await createTask({
      ...base,
      repoRoot: repoDir,
      title: 'C2 control',
      acceptance_criteria: ['The claim holds.'],
      marker: '[EXPLICIT]',
      source_tier: 'T1',
    });
    expect(result.key).toMatch(/^TASK-\d{3,}$/);
  });

  it('control — marker:"[EXPLICIT]" with NO source_tier at all is still ACCEPTED (backward-compatible)', async () => {
    const { createTask } = await loadStore();
    const repoDir = makeTmpDir('acfid-c2-control2');
    makeRepoSkeleton(repoDir, {});

    const result = await createTask({
      ...base,
      repoRoot: repoDir,
      title: 'C2 control 2',
      acceptance_criteria: ['The claim holds.'],
      marker: '[EXPLICIT]',
    });
    expect(result.key).toMatch(/^TASK-\d{3,}$/);
  });

  // Locks the `required: ["marker", "source_tier"]` half of the `if` clause
  // (review round-3 LOW). Without this control, dropping that clause from
  // the schema still lets every existing C2 spec pass, because the `then`
  // keyword passes VACUOUSLY on a ticket with no `marker` at all — so a
  // no-marker + T3/T4 ticket would start being wrongly REJECTED with no
  // spec catching it. A no-marker ticket must never be constrained by the
  // marker-ceiling rule, regardless of source_tier.
  it('control — NO marker at all with source_tier:"T4" is still ACCEPTED (the `if` must not fire without a marker)', async () => {
    const { createTask } = await loadStore();
    const repoDir = makeTmpDir('acfid-c2-control3');
    makeRepoSkeleton(repoDir, {});

    const result = await createTask({
      ...base,
      repoRoot: repoDir,
      title: 'C2 control 3 — no marker, weak tier',
      acceptance_criteria: ['The claim holds.'],
      source_tier: 'T4',
    });
    expect(result.key).toMatch(/^TASK-\d{3,}$/);
  });
});
