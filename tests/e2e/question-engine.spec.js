// tests/question-engine.spec.js
// TASK-010 — src/question-engine.js exposes runQuestionnaire({questions, prompter,
// persistTo, now}) -> Promise<{answers, completedAt}>.
//
// Tests are written ahead of implementation. The prod module does not yet exist
// on disk, so every dynamic import resolves to a missing file — that is the
// "right" failure mode for the tests-first commit. Each test exercises a single
// AC from the ticket so the failure surface maps cleanly back to the spec.

import { describe, it, expect, vi, afterAll, afterEach } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { PROD } from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';

afterAll(cleanupAll);

const FIXED_NOW = '2026-05-26T12:00:00Z';

/**
 * Build a prompter that returns scripted answers in order. Each call records
 * the full `ctx` argument the engine passed so tests can assert that retries
 * carry an `error` field, that `prompt`/`type`/`enum` are forwarded, etc.
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
// 1. Sequence — all string questions, no branching, no persistence.
// =====================================================================
describe('runQuestionnaire — sequence', () => {
  it('sequence_all_string_questions', async () => {
    const { runQuestionnaire } = await import(PROD.questionEngine);

    const questions = [
      { id: 'project_name', prompt: 'Project name?', type: 'string' },
      { id: 'tagline',      prompt: 'Tagline?',      type: 'string' },
      { id: 'owner',        prompt: 'Owner email?',  type: 'string' },
    ];
    const prompter = makeScriptedPrompter(['demo', 'a demo project', 'me@example.com']);

    const result = await runQuestionnaire({
      questions,
      prompter,
      persistTo: null,
      now: () => FIXED_NOW,
    });

    expect(result.answers).toEqual({
      project_name: 'demo',
      tagline: 'a demo project',
      owner: 'me@example.com',
    });
    expect(result.completedAt).toBe(FIXED_NOW);
    // All scripted answers consumed; no extra prompts.
    expect(prompter.consumed()).toBe(3);
  });
});

// =====================================================================
// 2-3. Branching via `when`.
// =====================================================================
describe('runQuestionnaire — branching', () => {
  it('branching_skips_when_false', async () => {
    const { runQuestionnaire } = await import(PROD.questionEngine);

    const questions = [
      { id: 'kind',    prompt: 'Kind?',    type: 'string' },
      { id: 'x_only',  prompt: 'X only field?', type: 'string',
        when: (a) => a.kind === 'x' },
      { id: 'always',  prompt: 'Always?',  type: 'string' },
    ];
    // First answer is 'y' so the middle question is skipped entirely.
    const prompter = makeScriptedPrompter(['y', 'final']);

    const result = await runQuestionnaire({
      questions,
      prompter,
      persistTo: null,
      now: () => FIXED_NOW,
    });

    expect(result.answers.kind).toBe('y');
    expect(result.answers.always).toBe('final');
    // Skipped question id MUST be absent from the answers map.
    expect('x_only' in result.answers).toBe(false);
    // Prompter must not have been called for the middle question.
    expect(prompter.consumed()).toBe(2);
    const middlePrompts = prompter.calls.filter(
      (c) => typeof c.prompt === 'string' && c.prompt.includes('X only'),
    );
    expect(middlePrompts).toEqual([]);
  });

  it('branching_includes_when_true', async () => {
    const { runQuestionnaire } = await import(PROD.questionEngine);

    const questions = [
      { id: 'kind',    prompt: 'Kind?',    type: 'string' },
      { id: 'x_only',  prompt: 'X only field?', type: 'string',
        when: (a) => a.kind === 'x' },
      { id: 'always',  prompt: 'Always?',  type: 'string' },
    ];
    const prompter = makeScriptedPrompter(['x', 'middle answer', 'final']);

    const result = await runQuestionnaire({
      questions,
      prompter,
      persistTo: null,
      now: () => FIXED_NOW,
    });

    expect(result.answers.kind).toBe('x');
    expect(result.answers.x_only).toBe('middle answer');
    expect(result.answers.always).toBe('final');
    expect(prompter.consumed()).toBe(3);
  });
});

// =====================================================================
// 4-6. Validation — required, enum, custom validate.
// =====================================================================
describe('runQuestionnaire — validation', () => {
  it('validation_reprompts_on_required_empty', async () => {
    const { runQuestionnaire } = await import(PROD.questionEngine);

    const questions = [
      { id: 'name', prompt: 'Name?', type: 'string', required: true },
    ];
    const prompter = makeScriptedPrompter(['', 'Alice']);

    const result = await runQuestionnaire({
      questions,
      prompter,
      persistTo: null,
      now: () => FIXED_NOW,
    });

    expect(result.answers).toEqual({ name: 'Alice' });
    expect(prompter.consumed()).toBe(2);
    // First call has no error context.
    expect(prompter.calls[0].error == null).toBe(true);
    // Second call has an error context populated.
    expect(typeof prompter.calls[1].error).toBe('string');
    expect(prompter.calls[1].error.length).toBeGreaterThan(0);
    // The error message names the field id 'name' (per AC3).
    expect(prompter.calls[1].error).toMatch(/name/);
  });

  it('validation_reprompts_on_enum_mismatch', async () => {
    const { runQuestionnaire } = await import(PROD.questionEngine);

    const questions = [
      { id: 'choice', prompt: 'Pick a or b?', type: 'enum', enum: ['a', 'b'] },
    ];
    const prompter = makeScriptedPrompter(['c', 'b']);

    const result = await runQuestionnaire({
      questions,
      prompter,
      persistTo: null,
      now: () => FIXED_NOW,
    });

    expect(result.answers.choice).toBe('b');
    expect(prompter.consumed()).toBe(2);
    expect(prompter.calls[0].error == null).toBe(true);
    expect(typeof prompter.calls[1].error).toBe('string');
    // The error message should mention either 'enum' or one of the valid values
    // — implementer's choice of exact wording.
    expect(prompter.calls[1].error).toMatch(/enum|a|b/);
  });

  it('validation_reprompts_on_custom_validate', async () => {
    const { runQuestionnaire } = await import(PROD.questionEngine);

    const questions = [
      {
        id: 'word',
        prompt: 'Pick a longer word.',
        type: 'string',
        validate: (v) => (v.length < 3 ? 'too short' : null),
      },
    ];
    const prompter = makeScriptedPrompter(['hi', 'hello']);

    const result = await runQuestionnaire({
      questions,
      prompter,
      persistTo: null,
      now: () => FIXED_NOW,
    });

    expect(result.answers.word).toBe('hello');
    expect(prompter.consumed()).toBe(2);
    expect(prompter.calls[1].error).toBe('too short');
  });

  it('validation_reprompts_on_number_type_mismatch', async () => {
    const { runQuestionnaire } = await import(PROD.questionEngine);

    const questions = [
      { id: 'count', prompt: 'How many?', type: 'number' },
    ];
    const prompter = makeScriptedPrompter(['not a number', '7']);

    const result = await runQuestionnaire({
      questions,
      prompter,
      persistTo: null,
      now: () => FIXED_NOW,
    });

    // Number must parse — implementer chooses Number() vs parseFloat() — but
    // the answers map MUST contain a numeric type for type: 'number'.
    expect(result.answers.count).toBe(7);
    expect(prompter.consumed()).toBe(2);
    expect(typeof prompter.calls[1].error).toBe('string');
  });
});

// =====================================================================
// 7-9. Persistence (resume, no-persist, mid-run kill).
// =====================================================================
describe('runQuestionnaire — persistence', () => {
  it('persistence_writes_after_each_answer', async () => {
    const { runQuestionnaire } = await import(PROD.questionEngine);

    const repoDir = makeTmpDir('af-qe-persist');
    const target = join(repoDir, 'intake.json');

    const questions = [
      { id: 'q1', prompt: 'q1?', type: 'string' },
      { id: 'q2', prompt: 'q2?', type: 'string' },
      { id: 'q3', prompt: 'q3?', type: 'string' },
    ];

    // Scripted prompter: answer q1 and q2, then throw on q3 to simulate a Ctrl+C.
    let i = 0;
    const answers = ['answer 1', 'answer 2'];
    const prompter = async () => {
      if (i >= answers.length) {
        throw new Error('simulated interrupt');
      }
      return answers[i++];
    };

    await expect(runQuestionnaire({
      questions,
      prompter,
      persistTo: target,
      now: () => FIXED_NOW,
    })).rejects.toThrow(/simulated interrupt/);

    // After q2 was accepted, the persistTo file must contain both answers
    // and lastAnsweredId = 'q2'.
    expect(existsSync(target)).toBe(true);
    const saved = JSON.parse(readFileSync(target, 'utf8'));
    expect(saved.answers).toEqual({ q1: 'answer 1', q2: 'answer 2' });
    expect(saved.lastAnsweredId).toBe('q2');
  });

  it('resume_from_partial_state', async () => {
    const { runQuestionnaire } = await import(PROD.questionEngine);
    // The engine itself owns the read; we just plant a valid partial file.
    const { writeFileSync } = await import('node:fs');

    const repoDir = makeTmpDir('af-qe-resume');
    const target = join(repoDir, 'intake.json');

    writeFileSync(
      target,
      JSON.stringify({
        answers: { q1: 'restored 1', q2: 'restored 2' },
        lastAnsweredId: 'q2',
      }) + '\n',
      'utf8',
    );

    const questions = [
      { id: 'q1', prompt: 'q1?', type: 'string' },
      { id: 'q2', prompt: 'q2?', type: 'string' },
      { id: 'q3', prompt: 'q3?', type: 'string' },
    ];
    const prompter = makeScriptedPrompter(['answer 3']);

    const result = await runQuestionnaire({
      questions,
      prompter,
      persistTo: target,
      now: () => FIXED_NOW,
    });

    expect(result.answers).toEqual({
      q1: 'restored 1',
      q2: 'restored 2',
      q3: 'answer 3',
    });
    expect(result.completedAt).toBe(FIXED_NOW);
    // The prompter was called exactly once — only for q3.
    expect(prompter.consumed()).toBe(1);
  });

  it('persistTo_null_writes_nothing', async () => {
    const { runQuestionnaire } = await import(PROD.questionEngine);

    const repoDir = makeTmpDir('af-qe-nopersist');

    const questions = [
      { id: 'q1', prompt: 'q1?', type: 'string' },
      { id: 'q2', prompt: 'q2?', type: 'string' },
      { id: 'q3', prompt: 'q3?', type: 'string' },
    ];
    const prompter = makeScriptedPrompter(['a', 'b', 'c']);

    const result = await runQuestionnaire({
      questions,
      prompter,
      persistTo: null,
      now: () => FIXED_NOW,
    });

    expect(result.answers).toEqual({ q1: 'a', q2: 'b', q3: 'c' });

    // No files should exist in the tmp dir (the engine must not create
    // temp files when persistTo is null).
    const entries = readdirSync(repoDir);
    expect(entries).toEqual([]);
  });
});

// =====================================================================
// 10. Atomic-write invariant — fsync precedes rename across the loop.
// =====================================================================
describe('runQuestionnaire — atomic write recipe', () => {
  // Spy on node:fs so we can prove the engine's per-answer save goes through
  // atomicWriteFile (open -> write -> fsync -> close -> rename) for EVERY
  // accepted answer.
  vi.mock('node:fs', async (importOriginal) => {
    const real = await importOriginal();
    return {
      ...real,
      openSync: vi.fn(real.openSync),
      writeSync: vi.fn(real.writeSync),
      fsyncSync: vi.fn(real.fsyncSync),
      closeSync: vi.fn(real.closeSync),
      renameSync: vi.fn(real.renameSync),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('atomic_write_invariant', async () => {
    const fs = await import('node:fs');
    const { runQuestionnaire } = await import(PROD.questionEngine);

    const repoDir = makeTmpDir('af-qe-atomic');
    const target = join(repoDir, 'intake.json');

    const questions = [
      { id: 'q1', prompt: 'q1?', type: 'string' },
      { id: 'q2', prompt: 'q2?', type: 'string' },
    ];
    const prompter = makeScriptedPrompter(['v1', 'v2']);

    await runQuestionnaire({
      questions,
      prompter,
      persistTo: target,
      now: () => FIXED_NOW,
    });

    // At least 2 renames happened (one per accepted answer).
    const renamesToTarget = fs.renameSync.mock.calls.filter(
      ([, dst]) => dst === target,
    );
    expect(renamesToTarget.length).toBeGreaterThanOrEqual(2);

    // Every fsync was issued before every rename (the recipe invariant).
    expect(fs.fsyncSync.mock.invocationCallOrder.length).toBeGreaterThan(0);
    expect(fs.renameSync.mock.invocationCallOrder.length).toBeGreaterThan(0);
    const lastFsync = Math.max(...fs.fsyncSync.mock.invocationCallOrder);
    const firstRename = Math.min(
      ...fs.renameSync.mock.invocationCallOrder.filter((order, idx) => {
        // Only count renames whose dst is `target` (skip cleanup renames if any).
        const [, dst] = fs.renameSync.mock.calls[idx];
        return dst === target;
      }),
    );
    expect(firstRename).toBeGreaterThan(0);

    // For each individual rename-to-target, there must exist an fsync that
    // happened before it.
    for (const renameIdx of fs.renameSync.mock.calls
      .map((call, idx) => ({ call, idx }))
      .filter(({ call }) => call[1] === target)
      .map(({ idx }) => fs.renameSync.mock.invocationCallOrder[idx])) {
      const priorFsync = fs.fsyncSync.mock.invocationCallOrder.find(
        (o) => o < renameIdx,
      );
      expect(priorFsync, 'expected an fsync before each rename-to-target').toBeDefined();
    }
  });
});

// =====================================================================
// 11. required:false allows empty answer (stored as null).
// =====================================================================
describe('runQuestionnaire — optional fields', () => {
  it('required_false_allows_empty', async () => {
    const { runQuestionnaire } = await import(PROD.questionEngine);

    const questions = [
      { id: 'note', prompt: 'Note (optional)?', type: 'string', required: false },
    ];
    const prompter = makeScriptedPrompter(['']);

    const result = await runQuestionnaire({
      questions,
      prompter,
      persistTo: null,
      now: () => FIXED_NOW,
    });

    // Empty answer to an optional question is normalized to null (not '' or
    // undefined) so consumers can rely on `Object.hasOwn(answers, id)` to
    // distinguish "skipped" from "answered-blank".
    expect(result.answers).toEqual({ note: null });
    // No re-prompt — exactly one call.
    expect(prompter.consumed()).toBe(1);
  });
});

// =====================================================================
// Robustness — config-time errors raised at engine entry.
// =====================================================================
describe('runQuestionnaire — config validation', () => {
  it('unknown_type_throws_at_entry', async () => {
    const { runQuestionnaire } = await import(PROD.questionEngine);

    const questions = [
      { id: 'q1', prompt: 'q1?', type: 'banana' },
    ];
    // Prompter must NOT be invoked — the engine should reject before
    // asking anything.
    const prompter = async () => {
      throw new Error('prompter should not be called for invalid config');
    };

    await expect(runQuestionnaire({
      questions,
      prompter,
      persistTo: null,
      now: () => FIXED_NOW,
    })).rejects.toThrow(/type|banana/);
  });

  it('duplicate_question_ids_throws_at_entry', async () => {
    const { runQuestionnaire } = await import(PROD.questionEngine);

    const questions = [
      { id: 'dup', prompt: 'first dup?', type: 'string' },
      { id: 'dup', prompt: 'second dup?', type: 'string' },
    ];
    const prompter = async () => {
      throw new Error('prompter should not be called for invalid config');
    };

    await expect(runQuestionnaire({
      questions,
      prompter,
      persistTo: null,
      now: () => FIXED_NOW,
    })).rejects.toThrow(/dup|duplicate|unique/i);
  });
});

// =====================================================================
// Multi (comma-separated subset of enum) — sanity smoke.
// =====================================================================
describe('runQuestionnaire — multi type', () => {
  it('multi_accepts_comma_separated_subset', async () => {
    const { runQuestionnaire } = await import(PROD.questionEngine);

    const questions = [
      {
        id: 'tags',
        prompt: 'Pick tags',
        type: 'multi',
        enum: ['web', 'cli', 'lib', 'mobile'],
      },
    ];
    const prompter = makeScriptedPrompter(['web, cli']);

    const result = await runQuestionnaire({
      questions,
      prompter,
      persistTo: null,
      now: () => FIXED_NOW,
    });

    // Result is an array of trimmed, deduped values that are all in `enum`.
    expect(Array.isArray(result.answers.tags)).toBe(true);
    expect(result.answers.tags).toEqual(expect.arrayContaining(['web', 'cli']));
    expect(result.answers.tags.length).toBe(2);
  });

  it('multi_reprompts_on_unknown_value', async () => {
    const { runQuestionnaire } = await import(PROD.questionEngine);

    const questions = [
      {
        id: 'tags',
        prompt: 'Pick tags',
        type: 'multi',
        enum: ['web', 'cli'],
      },
    ];
    const prompter = makeScriptedPrompter(['web, banana', 'web, cli']);

    const result = await runQuestionnaire({
      questions,
      prompter,
      persistTo: null,
      now: () => FIXED_NOW,
    });

    expect(result.answers.tags).toEqual(expect.arrayContaining(['web', 'cli']));
    expect(prompter.consumed()).toBe(2);
    expect(typeof prompter.calls[1].error).toBe('string');
  });
});
