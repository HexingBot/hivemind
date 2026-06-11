// tests/intake-e2e.spec.js
// TASK-011 — AC8 end-to-end: runQuestionnaire(buildIntakeQuestions()) → answers
// → writeProjectMd → readProjectMd → ajv-validate frontmatter. All steps must
// succeed in one test.

import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { PROD } from '../helpers/fixtures.js';
import { REPO_ROOT } from '../helpers/repoRoot.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';

afterAll(cleanupAll);

const FIXED_NOW = '2026-05-26T12:00:00Z';
const SCHEMA_PATH = join(REPO_ROOT, 'state', 'PROJECT.schema.json');

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

describe('intake — end-to-end for web-saas', () => {
  it('end_to_end_intake_for_web_saas', async () => {
    const lib = await import(PROD.questionLibrary);
    const { runQuestionnaire } = await import(PROD.questionEngine);
    const { writeProjectMd, readProjectMd } = await import(PROD.projectMd);

    const intake = lib.buildIntakeQuestions();

    // Plan scripted answers: walk the intake list, simulate project_type =
    // 'web-saas', and answer every active question with a type-valid value.
    const simulatedAnswers = { project_type: 'web-saas' };
    const scriptedAnswers = [];
    for (const q of intake) {
      if (typeof q.when === 'function' && q.when(simulatedAnswers) === false) {
        continue;
      }
      if (q.id === 'project_type') {
        scriptedAnswers.push('web-saas');
      } else if (q.type === 'enum') {
        const choices = Array.isArray(q.enum) && q.enum.length > 0 ? q.enum : ['x'];
        scriptedAnswers.push(choices[0]);
      } else if (q.type === 'multi') {
        const choices = Array.isArray(q.enum) && q.enum.length > 0 ? q.enum : ['x'];
        scriptedAnswers.push(choices[0]);
      } else if (q.type === 'number') {
        scriptedAnswers.push('1');
      } else if (q.id === 'agent_models') {
        // TASK-036 — optional pair-syntax question whose validate hook rejects
        // free-form sentinels; empty input skips it so the round-trip
        // comparison covers exactly the answered intake set. (The answered
        // path is covered end-to-end in tests/e2e/agent-models-config.spec.js.)
        scriptedAnswers.push('');
      } else {
        // string — answer with a sentinel so we can also round-trip-assert.
        scriptedAnswers.push(`value-for-${q.id}`);
      }
    }

    const prompter = makeScriptedPrompter(scriptedAnswers);
    const { answers } = await runQuestionnaire({
      questions: intake,
      prompter,
      persistTo: null,
      now: () => FIXED_NOW,
    });

    expect(answers.project_type).toBe('web-saas');

    // TASK-036 — the engine stores a skipped optional question as null;
    // writeProjectMd writes no key for it and readProjectMd restores nothing,
    // so drop it from the round-trip expectation (absent stays absent).
    if (answers.agent_models === null) delete answers.agent_models;

    // Persist → re-read.
    const repoDir = makeTmpDir('af-intake-e2e');
    await writeProjectMd({
      repoRoot: repoDir,
      answers,
      now: () => FIXED_NOW,
    });
    expect(existsSync(join(repoDir, 'PROJECT.md'))).toBe(true);

    const out = await readProjectMd({ repoRoot: repoDir });

    // Validate the frontmatter against the committed schema.
    expect(existsSync(SCHEMA_PATH), 'state/PROJECT.schema.json must exist').toBe(true);
    const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const ok = validate(out.frontmatter);
    expect(
      ok,
      'e2e frontmatter failed schema: ' + JSON.stringify(validate.errors, null, 2),
    ).toBe(true);

    // Round-trip: out.answers ⊇ original answers (modulo writer-added fields
    // created_at and schema_version).
    const restored = { ...out.answers };
    delete restored.created_at;
    delete restored.schema_version;
    expect(restored).toEqual(answers);
  });
});
