// tests/question-library.spec.js
// TASK-011 — src/question-library.js exposes the curated question catalog and
// project-type taxonomy. Tests are written ahead of implementation: the prod
// module does not yet exist on disk, so every dynamic import resolves to a
// missing file — that's the right failure mode for the tests-first commit.
//
// Covers ACs 1, 2, 3 + the engine-compatibility cross-check (AC8 partial).

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
