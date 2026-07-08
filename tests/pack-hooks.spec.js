// tests/pack-hooks.spec.js
// TASK-127 — Pack hooks: turn an active-pack set (src/pack-registry.js) into
// wizard contributions. Phase D-2 of the Option-C hybrid hook
// (docs/design/addon-packs.md §8 / addon-packs-plan.md §5): the pack
// DESCRIPTOR is the declarative allowlist; the pack MODULE supplies named
// pure exports core invokes only for declared surfaces.
//
// AC1 — collectPackQuestions appends active-pack questions AFTER the core
//        questions (forward-only `when` stays valid). A question id colliding
//        with a core id (or another pack's id) throws a pack-attributed error
//        naming the offending id. Table-driven: happy append + collision throw.
// AC2 — applyProjectMdContributions runs each active pack's derive fn and
//        merges its output into answers; a derived key NOT in that pack's
//        descriptor.project_md_contribution throws a pack-attributed isolation
//        error and merges NOTHING for that pack (all-or-nothing). Non-vacuous:
//        a stub pack whose derive emits an out-of-envelope key proves the throw.
// AC3 — zero active packs: both collectors are no-ops (strictly additive,
//        off-by-default).
// AC4 — both collectors are pure/deterministic (no I/O), exercised against the
//        REAL DESIGN_PROFILE_QUESTIONS + deriveProfileFields (design-power's
//        actual contributions), not only stubs.
//
// Pure logic, no disk I/O — fast tier.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './helpers/repoRoot.js';
import { collectPackQuestions, applyProjectMdContributions } from '../src/pack-hooks.js';
import { DESIGN_PROFILE_QUESTIONS, deriveProfileFields } from '../src/design-profile.js';
import { buildIntakeQuestions } from '../src/question-library.js';

// A minimal ActivePack fixture: { descriptor: {id, project_md_contribution},
// module: {questions, deriveProjectMd} } — the adapter shape the collectors
// consume (see src/pack-hooks.js header comment for the binding contract).
function makeActivePack(overrides = {}) {
  return {
    descriptor: {
      id: 'stub-pack',
      project_md_contribution: [],
      ...overrides.descriptor,
    },
    module: {
      questions: [],
      deriveProjectMd: () => ({}),
      ...overrides.module,
    },
  };
}

const CORE_QUESTIONS = [
  { id: 'problem_statement', type: 'string', prompt: 'core q1' },
  { id: 'project_name', type: 'string', prompt: 'core q2' },
];

describe('TASK-127 AC1 — collectPackQuestions: append + collision guard, table-driven', () => {
  it('appends_active_pack_questions_after_core_questions_in_pack_order', () => {
    const packA = makeActivePack({
      descriptor: { id: 'pack-a' },
      module: { questions: [{ id: 'pack_a_q1', type: 'string', prompt: 'a1' }] },
    });
    const packB = makeActivePack({
      descriptor: { id: 'pack-b' },
      module: { questions: [{ id: 'pack_b_q1', type: 'string', prompt: 'b1' }] },
    });

    const combined = collectPackQuestions(CORE_QUESTIONS, [packA, packB]);

    expect(combined.map((q) => q.id)).toEqual([
      'problem_statement', 'project_name', 'pack_a_q1', 'pack_b_q1',
    ]);
    // Core list itself is untouched (no mutation).
    expect(CORE_QUESTIONS.map((q) => q.id)).toEqual(['problem_statement', 'project_name']);
  });

  it('a_pack_question_id_colliding_with_a_core_id_throws_a_pack_attributed_error', () => {
    const packA = makeActivePack({
      descriptor: { id: 'collider-pack' },
      module: { questions: [{ id: 'project_name', type: 'string', prompt: 'dup' }] },
    });

    expect(() => collectPackQuestions(CORE_QUESTIONS, [packA])).toThrow(/collider-pack/);
    expect(() => collectPackQuestions(CORE_QUESTIONS, [packA])).toThrow(/project_name/);
  });

  it('a_pack_question_id_colliding_with_another_packs_id_throws_a_pack_attributed_error', () => {
    const packA = makeActivePack({
      descriptor: { id: 'pack-a' },
      module: { questions: [{ id: 'shared_id', type: 'string', prompt: 'a' }] },
    });
    const packB = makeActivePack({
      descriptor: { id: 'pack-b' },
      module: { questions: [{ id: 'shared_id', type: 'string', prompt: 'b' }] },
    });

    expect(() => collectPackQuestions(CORE_QUESTIONS, [packA, packB])).toThrow(/pack-b/);
    expect(() => collectPackQuestions(CORE_QUESTIONS, [packA, packB])).toThrow(/shared_id/);
  });

  it.each([
    ['happy_append', [makeActivePack({ descriptor: { id: 'p1' }, module: { questions: [{ id: 'p1_q', type: 'string', prompt: 'x' }] } })], false],
    ['collision', [makeActivePack({ descriptor: { id: 'p1' }, module: { questions: [{ id: 'problem_statement', type: 'string', prompt: 'x' }] } })], true],
  ])('case_%s', (_label, packs, shouldThrow) => {
    if (shouldThrow) {
      expect(() => collectPackQuestions(CORE_QUESTIONS, packs)).toThrow();
    } else {
      expect(() => collectPackQuestions(CORE_QUESTIONS, packs)).not.toThrow();
    }
  });
});

describe('TASK-127 AC2 — applyProjectMdContributions: merge + isolation guard, all-or-nothing', () => {
  it('merges_a_packs_derive_output_into_answers_when_keys_are_within_the_envelope', () => {
    const pack = makeActivePack({
      descriptor: { id: 'good-pack', project_md_contribution: ['tier', 'perfil_proyecto'] },
      module: { deriveProjectMd: () => ({ tier: 'LIGERO', perfil_proyecto: { a: '1' } }) },
    });
    const answers = { some_answer: 'x' };

    const merged = applyProjectMdContributions([pack], answers);

    expect(merged).toEqual({ some_answer: 'x', tier: 'LIGERO', perfil_proyecto: { a: '1' } });
    // Original answers object is untouched (no mutation).
    expect(answers).toEqual({ some_answer: 'x' });
  });

  it('a_derived_key_outside_the_declared_project_md_contribution_throws_a_pack_attributed_isolation_error_non_vacuous', () => {
    const stubPack = makeActivePack({
      descriptor: { id: 'rogue-pack', project_md_contribution: ['tier'] },
      module: { deriveProjectMd: () => ({ tier: 'LIGERO', secret_field: 'leaked' }) },
    });
    const answers = { some_answer: 'x' };

    expect(() => applyProjectMdContributions([stubPack], answers)).toThrow(/rogue-pack/);
    expect(() => applyProjectMdContributions([stubPack], answers)).toThrow(/secret_field/);
  });

  it('merges_nothing_for_the_offending_pack_all_or_nothing_even_when_a_prior_pack_succeeded', () => {
    const goodPack = makeActivePack({
      descriptor: { id: 'good-pack', project_md_contribution: ['tier'] },
      module: { deriveProjectMd: () => ({ tier: 'LIGERO' }) },
    });
    const rogue = makeActivePack({
      descriptor: { id: 'rogue-pack', project_md_contribution: ['tier'] },
      module: { deriveProjectMd: () => ({ tier: 'LIGERO', secret_field: 'leaked' }) },
    });

    // The throw propagates — nothing from the rogue pack's derive output can
    // have been merged, since the function never returns.
    expect(() => applyProjectMdContributions([goodPack, rogue], { x: 1 })).toThrow(/rogue-pack/);
  });
});

describe('TASK-127 AC3 — zero active packs: both collectors are strict no-ops', () => {
  it('collectPackQuestions_returns_the_core_list_unchanged_with_zero_active_packs', () => {
    const combined = collectPackQuestions(CORE_QUESTIONS, []);
    expect(combined).toEqual(CORE_QUESTIONS);
  });

  it('applyProjectMdContributions_returns_answers_unchanged_with_zero_active_packs', () => {
    const answers = { problem_statement: 'x', project_type: 'web-saas' };
    const merged = applyProjectMdContributions([], answers);
    expect(merged).toEqual(answers);
  });
});

describe('TASK-127 AC4 — pure/deterministic, exercised against REAL design-power exports', () => {
  it('collectPackQuestions_with_the_real_DESIGN_PROFILE_QUESTIONS_and_the_real_core_intake', () => {
    const coreQuestions = buildIntakeQuestions();
    const designPowerPack = makeActivePack({
      descriptor: { id: 'design-power', project_md_contribution: ['tier', 'perfil_proyecto'] },
      module: { questions: DESIGN_PROFILE_QUESTIONS },
    });

    const combined = collectPackQuestions(coreQuestions, [designPowerPack]);

    const coreIds = coreQuestions.map((q) => q.id);
    const designIds = DESIGN_PROFILE_QUESTIONS.map((q) => q.id);
    expect(combined.map((q) => q.id)).toEqual([...coreIds, ...designIds]);
    // buildIntakeQuestions() itself is untouched — question-library.js stays
    // byte-unchanged and is never mutated by this collector.
    expect(buildIntakeQuestions().map((q) => q.id)).toEqual(coreIds);
  });

  it('applyProjectMdContributions_with_the_real_deriveProfileFields_merges_tier_and_perfil_proyecto', () => {
    const designPowerPack = makeActivePack({
      descriptor: { id: 'design-power', project_md_contribution: ['tier', 'perfil_proyecto'] },
      module: { deriveProjectMd: deriveProfileFields },
    });
    const answers = {
      design_heavy: 'yes',
      estimated_screens: 10,
      stakes: 'real',
      design_ambition: 'branded',
      ui_framework: 'react',
      has_canvas_render: 'no',
      motion_required: 'no',
      needs_research: 'have-direction',
      assets_required: ['icons-custom'],
    };

    const merged = applyProjectMdContributions([designPowerPack], answers);
    const expected = deriveProfileFields(answers);

    expect(merged.tier).toBe(expected.tier);
    expect(merged.perfil_proyecto).toEqual(expected.perfil_proyecto);
    expect(merged.design_heavy).toBe('yes'); // original answers preserved
  });

  it('is_pure_no_disk_io_apis_referenced_by_source_inspection', () => {
    const source = readFileSync(join(REPO_ROOT, 'src', 'pack-hooks.js'), 'utf8');
    const fsImportPattern = /from\s+['"]node:fs['"]|from\s+['"]fs['"]|require\(\s*['"]fs['"]\s*\)/;
    expect(fsImportPattern.test(source), 'pack-hooks.js must not import node:fs').toBe(false);
  });

  it('is_deterministic_across_repeat_calls_with_the_same_inputs', () => {
    const pack = makeActivePack({
      descriptor: { id: 'design-power', project_md_contribution: ['tier', 'perfil_proyecto'] },
      module: { deriveProjectMd: deriveProfileFields },
    });
    const answers = { design_heavy: 'no' };
    const first = applyProjectMdContributions([pack], answers);
    const second = applyProjectMdContributions([pack], answers);
    expect(first).toEqual(second);
  });
});
