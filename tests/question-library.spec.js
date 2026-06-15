// tests/question-library.spec.js
// TASK-011 — src/question-library.js exposes the curated question catalog and
// project-type taxonomy. Tests are written ahead of implementation: the prod
// module does not yet exist on disk, so every dynamic import resolves to a
// missing file — that's the right failure mode for the tests-first commit.
//
// Covers ACs 1, 2, 3 + the engine-compatibility cross-check (AC8 partial).
//
// TASK-046 — AC1: discovery-first ordering. COMMON_QUESTIONS must lead with
// the four discovery questions (problem_statement, goals, scope_in, scope_out)
// BEFORE project_name. The `build_intake_questions_concatenates` test from
// TASK-011 is unchanged — it asserts common questions come first in intake, in
// their COMMON_QUESTIONS order. The new describe block at the bottom specifies
// what that order must be.
// NOTE: this file was updated at TASK-046 to add ordering assertions.
// The existing `common_questions_min_six` test does NOT check order, so it
// needs no changes (it only checks membership).

import { describe, it, expect, afterAll } from 'vitest';

import { PROD } from './helpers/fixtures.js';
import { cleanupAll } from './helpers/tmpRepo.js';

afterAll(cleanupAll);

const FIXED_NOW = '2026-05-26T12:00:00Z';

// The exact taxonomy the orchestrator froze. Any future drift must edit this
// literal — forcing intent — rather than silently widening.
const FROZEN_TAXONOMY = ['web-saas', 'cli-tool', 'data-pipeline', 'ml-model', 'library', 'other'];

/**
 * Build a scripted prompter that returns answers in order. Used to drive a
 * single end-to-end pass through runQuestionnaire(buildIntakeQuestions()).
 */
function makeScriptedPrompter(answers) {
  const calls = [];
  let i = 0;
  const prompter = async (ctx) => {
    calls.push(ctx);
    if (i >= answers.length) {
      throw new Error(
        `scripted prompter exhausted after ${i} answers; ` +
        `engine asked again with: ${JSON.stringify(ctx)}`,
      );
    }
    return answers[i++];
  };
  prompter.calls = calls;
  prompter.consumed = () => i;
  return prompter;
}

// =====================================================================
// AC2 — project_type enum is locked literal.
// =====================================================================
describe('question-library — taxonomy', () => {
  it('taxonomy_enum_is_locked', async () => {
    const lib = await import(PROD.questionLibrary);
    const projectTypeQ = lib.COMMON_QUESTIONS.find((q) => q.id === 'project_type');
    expect(projectTypeQ, 'COMMON_QUESTIONS must include a project_type question').toBeDefined();
    // Exact literal-array equality — order matters.
    expect(projectTypeQ.enum).toEqual(FROZEN_TAXONOMY);
    // The question must be an enum-typed prompt so the engine validates input.
    expect(projectTypeQ.type).toBe('enum');
  });
});

// =====================================================================
// AC1 — COMMON_QUESTIONS shape.
// =====================================================================
describe('question-library — common questions', () => {
  it('common_questions_min_six', async () => {
    const lib = await import(PROD.questionLibrary);
    expect(Array.isArray(lib.COMMON_QUESTIONS)).toBe(true);
    expect(lib.COMMON_QUESTIONS.length).toBeGreaterThanOrEqual(6);

    const ids = new Set(lib.COMMON_QUESTIONS.map((q) => q.id));
    const requiredIds = [
      'project_name',
      'project_description',
      'project_type',
      'target_users',
      'success_criteria',
      'primary_use_cases',
    ];
    for (const id of requiredIds) {
      expect(ids.has(id), `COMMON_QUESTIONS must include id "${id}"`).toBe(true);
    }
  });
});

// =====================================================================
// AC3 — TYPE_SPECIFIC_QUESTIONS coverage and the `when` predicate gating.
// =====================================================================
describe('question-library — type-specific questions', () => {
  it('each_type_has_at_least_three_questions', async () => {
    const lib = await import(PROD.questionLibrary);
    expect(typeof lib.TYPE_SPECIFIC_QUESTIONS).toBe('object');

    for (const type of FROZEN_TAXONOMY) {
      const qs = lib.TYPE_SPECIFIC_QUESTIONS[type];
      expect(Array.isArray(qs), `TYPE_SPECIFIC_QUESTIONS["${type}"] must be an array`).toBe(true);
      if (type === 'other') {
        expect(qs.length, 'TYPE_SPECIFIC_QUESTIONS["other"] must have exactly 1 question').toBe(1);
      } else {
        expect(
          qs.length,
          `TYPE_SPECIFIC_QUESTIONS["${type}"] must have >= 3 questions`,
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('when_predicate_gates_correctly', async () => {
    const lib = await import(PROD.questionLibrary);

    for (const type of FROZEN_TAXONOMY) {
      const qs = lib.TYPE_SPECIFIC_QUESTIONS[type];
      for (const q of qs) {
        expect(
          typeof q.when,
          `question "${q.id}" in type "${type}" must declare a when predicate`,
        ).toBe('function');
        // Matching type: predicate returns true.
        expect(
          q.when({ project_type: type }),
          `when predicate for "${q.id}" must return true for project_type="${type}"`,
        ).toBe(true);
        // Every other type: predicate returns false.
        for (const otherType of FROZEN_TAXONOMY) {
          if (otherType === type) continue;
          expect(
            q.when({ project_type: otherType }),
            `when predicate for "${q.id}" must return false for project_type="${otherType}"`,
          ).toBe(false);
        }
      }
    }
  });
});

// =====================================================================
// AC1 — buildIntakeQuestions() concatenates common + all type-specific.
// =====================================================================
describe('question-library — buildIntakeQuestions', () => {
  it('build_intake_questions_concatenates', async () => {
    const lib = await import(PROD.questionLibrary);
    expect(typeof lib.buildIntakeQuestions).toBe('function');

    const intake = lib.buildIntakeQuestions();
    expect(Array.isArray(intake)).toBe(true);

    const typeSpecificTotal = Object.values(lib.TYPE_SPECIFIC_QUESTIONS)
      .reduce((sum, arr) => sum + arr.length, 0);
    expect(intake.length).toBe(lib.COMMON_QUESTIONS.length + typeSpecificTotal);

    // Common questions come first, preserving their order.
    for (let i = 0; i < lib.COMMON_QUESTIONS.length; i++) {
      expect(intake[i].id).toBe(lib.COMMON_QUESTIONS[i].id);
    }

    // No duplicate ids in the concatenated array.
    const ids = intake.map((q) => q.id);
    expect(new Set(ids).size, 'buildIntakeQuestions() must produce unique ids').toBe(ids.length);
  });
});

// =====================================================================
// Engine-compat smoke: pass buildIntakeQuestions() directly to runQuestionnaire
// scripted for the 'web-saas' branch. Type-specific keys for OTHER types
// must NOT appear in the resulting answers (the `when` predicates suppressed
// them).
// =====================================================================
describe('question-library — engine compatibility', () => {
  it('engine_accepts_combined_array', async () => {
    const lib = await import(PROD.questionLibrary);
    const { runQuestionnaire } = await import(PROD.questionEngine);

    const intake = lib.buildIntakeQuestions();

    // Build a scripted prompter that answers every active question. We
    // simulate the user picking 'web-saas' so only common + web-saas
    // type-specific questions get asked. Answers are derived from the
    // question's enum/type so they pass validation regardless of impl wording.
    const answers = [];
    const simulatedAnswers = { project_type: 'web-saas' };
    for (const q of intake) {
      if (typeof q.when === 'function' && q.when(simulatedAnswers) === false) {
        continue;
      }
      // Compute a syntactically valid answer for each type.
      if (q.id === 'project_type') {
        answers.push('web-saas');
      } else if (q.type === 'enum') {
        const choices = Array.isArray(q.enum) && q.enum.length > 0 ? q.enum : ['x'];
        answers.push(choices[0]);
      } else if (q.type === 'multi') {
        const choices = Array.isArray(q.enum) && q.enum.length > 0 ? q.enum : ['x'];
        answers.push(choices[0]);
      } else if (q.type === 'number') {
        answers.push('1');
      } else if (q.id === 'agent_models') {
        // TASK-036 — optional pair-syntax question whose validate hook rejects
        // free-form strings; empty input skips it (required: false).
        answers.push('');
      } else {
        // Free-form string. Use the question id so we can assert presence
        // later if needed.
        answers.push(`answer for ${q.id}`);
      }
    }

    const prompter = makeScriptedPrompter(answers);
    const result = await runQuestionnaire({
      questions: intake,
      prompter,
      persistTo: null,
      now: () => FIXED_NOW,
    });

    expect(result.answers.project_type).toBe('web-saas');

    // For each non-'web-saas', non-'other' type, NONE of its question ids
    // may appear in the answers map. (The `other` branch is a free-text
    // single question whose `when` is also false for web-saas.)
    for (const type of FROZEN_TAXONOMY) {
      if (type === 'web-saas') continue;
      const otherIds = lib.TYPE_SPECIFIC_QUESTIONS[type].map((q) => q.id);
      for (const id of otherIds) {
        // It is legitimate for two type-branches to share an id (e.g. both
        // declare `language`). Only assert absence if THIS id is exclusive
        // to non-web-saas types.
        const isAlsoInWebSaas = lib.TYPE_SPECIFIC_QUESTIONS['web-saas']
          .some((q) => q.id === id);
        if (isAlsoInWebSaas) continue;
        expect(
          Object.prototype.hasOwnProperty.call(result.answers, id),
          `answers must NOT contain "${id}" (it belongs to type "${type}", but we picked web-saas)`,
        ).toBe(false);
      }
    }
  });
});

// =====================================================================
// TASK-046 AC1 — Discovery-first ordering in COMMON_QUESTIONS.
//
// The four discovery questions (problem_statement, goals, scope_in,
// scope_out) must appear BEFORE project_name in COMMON_QUESTIONS, so
// that buildIntakeQuestions() leads with discovery.
//
// Relation to existing TASK-011 tests:
//   * `build_intake_questions_concatenates` (above) asserts intake[0..N-1]
//     mirrors COMMON_QUESTIONS exactly — it will automatically enforce that
//     any COMMON_QUESTIONS reorder flows through to buildIntakeQuestions().
//     The tests below specify WHAT that order must be.
//   * `common_questions_min_six` only checks membership — it does not pin
//     order, so it does not need to change.
// =====================================================================
describe('TASK-046 AC1 — discovery-first ordering in COMMON_QUESTIONS', () => {
  it('COMMON_QUESTIONS_leads_with_four_discovery_question_ids', async () => {
    const lib = await import(PROD.questionLibrary);

    const ids = lib.COMMON_QUESTIONS.map((q) => q.id);
    // The first four question ids must be the discovery questions in this order.
    expect(ids[0], 'first question must be problem_statement').toBe('problem_statement');
    expect(ids[1], 'second question must be goals').toBe('goals');
    expect(ids[2], 'third question must be scope_in').toBe('scope_in');
    expect(ids[3], 'fourth question must be scope_out').toBe('scope_out');
  });

  it('buildIntakeQuestions_first_four_are_discovery_questions', async () => {
    const lib = await import(PROD.questionLibrary);

    const intake = lib.buildIntakeQuestions();
    // The first four question ids in the full intake must be the discovery
    // questions — COMMON_QUESTIONS leads the concatenation, so this follows
    // from the COMMON_QUESTIONS ordering above, but we assert it directly on
    // the intake array so any future refactor of buildIntakeQuestions cannot
    // break the invariant by reordering internally.
    const EXPECTED_FIRST_FOUR = ['problem_statement', 'goals', 'scope_in', 'scope_out'];
    for (let i = 0; i < EXPECTED_FIRST_FOUR.length; i++) {
      expect(
        intake[i].id,
        `intake[${i}].id must be ${EXPECTED_FIRST_FOUR[i]} (discovery-first ordering)`,
      ).toBe(EXPECTED_FIRST_FOUR[i]);
    }
  });

  it('project_name_appears_after_the_four_discovery_questions', async () => {
    const lib = await import(PROD.questionLibrary);

    const intake = lib.buildIntakeQuestions();
    const discoveryIds = ['problem_statement', 'goals', 'scope_in', 'scope_out'];
    const projectNameIdx = intake.findIndex((q) => q.id === 'project_name');

    expect(projectNameIdx, 'project_name must appear in intake').toBeGreaterThan(-1);

    for (const dId of discoveryIds) {
      const dIdx = intake.findIndex((q) => q.id === dId);
      expect(dIdx, `${dId} must appear in intake`).toBeGreaterThan(-1);
      expect(
        dIdx,
        `${dId} (discovery question) must come before project_name in intake`,
      ).toBeLessThan(projectNameIdx);
    }
  });

  it('all_intake_question_ids_remain_globally_unique', async () => {
    // This is a regression guard: adding discovery questions to COMMON_QUESTIONS
    // must not introduce duplicate ids (the engine rejects non-unique ids).
    const lib = await import(PROD.questionLibrary);

    const intake = lib.buildIntakeQuestions();
    const ids = intake.map((q) => q.id);
    const uniqueCount = new Set(ids).size;

    expect(
      uniqueCount,
      `buildIntakeQuestions() returned ${ids.length} questions but only ${uniqueCount} unique ids — duplicates detected`,
    ).toBe(ids.length);
  });

  it('discovery_questions_are_type_string_no_when_predicate', async () => {
    // Discovery questions are common (asked of every project), so they MUST
    // NOT have a `when` predicate. They must also be type 'string' (free-text
    // collected in the wizard; comma-split normalization happens in bin/init.js).
    const lib = await import(PROD.questionLibrary);

    const discoveryIds = ['problem_statement', 'goals', 'scope_in', 'scope_out'];
    for (const id of discoveryIds) {
      const q = lib.COMMON_QUESTIONS.find((cq) => cq.id === id);
      expect(q, `COMMON_QUESTIONS must include a question with id "${id}"`).toBeDefined();
      expect(
        q.when,
        `discovery question "${id}" must NOT have a when predicate (it is common to all types)`,
      ).toBeUndefined();
      expect(
        q.type,
        `discovery question "${id}" must be type "string" (comma-split handled in bin/init.js)`,
      ).toBe('string');
    }
  });

  it('type_specific_concatenation_is_unchanged_after_discovery_insertion', async () => {
    // Regression guard: no discovery id must appear in a type-specific branch.
    const lib = await import(PROD.questionLibrary);

    const discoveryIds = new Set(['problem_statement', 'goals', 'scope_in', 'scope_out']);
    for (const [type, qs] of Object.entries(lib.TYPE_SPECIFIC_QUESTIONS)) {
      for (const q of qs) {
        expect(
          discoveryIds.has(q.id),
          `TYPE_SPECIFIC_QUESTIONS["${type}"] must NOT contain discovery question id "${q.id}"`,
        ).toBe(false);
      }
    }
  });
});
