// tests/e2e/intake-underspecified-warn.spec.js
// TASK-166 — warn-and-reconfirm when goals+scope are all empty despite a
// substantive problem_statement.
//
// Human scope decision (2026-07-18): warn-but-allow posture. goals/scope_in/
// scope_out stay `required: false` (TASK-048 preserved) — this ticket adds a
// cross-field NOTICE, never a hard block.
//
// Covers:
//   AC1 — interactive path: warning names the empty sections and the existing
//         confirm prompt doubles as the reconfirm step; proceeding is allowed
//         and PROJECT.md is still written (default-Y / explicit 'y').
//   AC2 — never hard-blocks: goals/scope_in/scope_out stay optional; a user
//         who confirms proceeds with empty sections.
//   AC3 — non-interactive (--yes / answers-mode) is not broken: the warn path
//         degrades to a non-blocking console notice, never a new prompt.
//   AC4 — regression: no warning at all when the sections are NOT all empty,
//         or when problem_statement itself is empty/trivial.

import {
  describe, it, expect, vi, afterAll, afterEach, beforeEach,
} from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { PROD } from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';
import { makeScriptedPrompter, webSaasAnswers } from '../helpers/scripted-prompter.js';

afterAll(cleanupAll);

const FIXED_NOW = '2026-07-18T12:00:00Z';

// ---------------------------------------------------------------------------
// Pure predicate / message builder — no I/O, directly unit-tested.
// ---------------------------------------------------------------------------

describe('isDefinitionUnderspecified (pure predicate)', () => {
  it('true_when_problem_statement_set_and_goals_scope_all_empty_strings', async () => {
    const { isDefinitionUnderspecified } = await import(PROD.init);
    expect(isDefinitionUnderspecified({
      problem_statement: 'Teams lose context between sessions.',
      goals: '',
      scope_in: '',
      scope_out: '',
    })).toBe(true);
  });

  it('true_when_goals_scope_are_empty_arrays', async () => {
    const { isDefinitionUnderspecified } = await import(PROD.init);
    expect(isDefinitionUnderspecified({
      problem_statement: 'Teams lose context between sessions.',
      goals: [],
      scope_in: [],
      scope_out: [],
    })).toBe(true);
  });

  it('true_when_goals_scope_keys_are_entirely_absent', async () => {
    const { isDefinitionUnderspecified } = await import(PROD.init);
    expect(isDefinitionUnderspecified({
      problem_statement: 'Teams lose context between sessions.',
    })).toBe(true);
  });

  it('false_when_problem_statement_is_empty', async () => {
    const { isDefinitionUnderspecified } = await import(PROD.init);
    expect(isDefinitionUnderspecified({
      problem_statement: '',
      goals: '',
      scope_in: '',
      scope_out: '',
    })).toBe(false);
  });

  it('false_when_problem_statement_is_whitespace_only', async () => {
    const { isDefinitionUnderspecified } = await import(PROD.init);
    expect(isDefinitionUnderspecified({
      problem_statement: '   ',
      goals: [],
      scope_in: [],
      scope_out: [],
    })).toBe(false);
  });

  it('false_when_any_one_of_goals_scope_in_scope_out_is_non_empty', async () => {
    const { isDefinitionUnderspecified } = await import(PROD.init);
    expect(isDefinitionUnderspecified({
      problem_statement: 'A real problem.',
      goals: ['ship fast'],
      scope_in: [],
      scope_out: [],
    })).toBe(false);
    expect(isDefinitionUnderspecified({
      problem_statement: 'A real problem.',
      goals: [],
      scope_in: 'wizard',
      scope_out: [],
    })).toBe(false);
    expect(isDefinitionUnderspecified({
      problem_statement: 'A real problem.',
      goals: [],
      scope_in: [],
      scope_out: ['billing'],
    })).toBe(false);
  });

  it('false_when_answers_is_null_or_not_an_object', async () => {
    const { isDefinitionUnderspecified } = await import(PROD.init);
    expect(isDefinitionUnderspecified(null)).toBe(false);
    expect(isDefinitionUnderspecified(undefined)).toBe(false);
  });
});

describe('buildUnderspecifiedWarning (pure message builder)', () => {
  it('names_all_three_empty_sections', async () => {
    const { buildUnderspecifiedWarning } = await import(PROD.init);
    const msg = buildUnderspecifiedWarning({
      problem_statement: 'Teams lose context between sessions.',
      goals: [],
      scope_in: [],
      scope_out: [],
    });
    expect(msg).toMatch(/goals/i);
    expect(msg).toMatch(/scope \(in\)/i);
    expect(msg).toMatch(/scope \(out\)/i);
  });
});

// ---------------------------------------------------------------------------
// Integration via runInit
// ---------------------------------------------------------------------------

describe('TASK-166 AC1/AC2 — interactive warn-and-reconfirm', () => {
  let logSpy;
  let warnSpy;
  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('warns_and_still_proceeds_on_default_confirm_when_goals_scope_all_empty', async () => {
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-underspec-warn-proceed');
    // webSaasAnswers() supplies a substantive problem_statement but no
    // goals/scope_in/scope_out — the scripted prompter returns '' (skip) for
    // those optional ids, and '' (default-Y) for the confirm gate.
    const prompter = makeScriptedPrompter(webSaasAnswers());

    const result = await runInit({
      argv: [],
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });

    expect(result.state).toBe('created');
    expect(existsSync(join(repoDir, 'PROJECT.md'))).toBe(true);

    const allOutput = [...logSpy.mock.calls, ...warnSpy.mock.calls]
      .map((args) => args.join(' '))
      .join('\n');
    expect(allOutput).toMatch(/goals/i);
    expect(allOutput).toMatch(/scope \(in\)/i);
    expect(allOutput).toMatch(/scope \(out\)/i);
  });

  it('never_hard_blocks_PROJECT_md_is_still_written_after_confirm_with_empty_sections', async () => {
    // AC2 — goals/scope_in/scope_out stay optional (TASK-048 preserved); a user
    // who confirms at the (warning-augmented) gate proceeds with empty
    // sections and PROJECT.md is written. (The exact rendering of a skipped
    // optional field in the interactive path is a pre-existing project-md.js
    // concern tracked separately — see hand-off punch list — and is not
    // asserted on here.)
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-underspec-never-block');
    const prompter = makeScriptedPrompter(webSaasAnswers());

    const result = await runInit({
      argv: [],
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });

    expect(result.state).toBe('created');
    expect(existsSync(join(repoDir, 'PROJECT.md'))).toBe(true);
  });

  it('explicit_n_at_the_reconfirm_step_aborts_without_writing_PROJECT_md', async () => {
    // The warning-augmented confirm gate is still the SAME voluntary
    // confirm/abort mechanism as before — an explicit 'n' aborts (AC2 does not
    // forbid the user's own choice to decline; it forbids a NEW forced block).
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-underspec-explicit-n');
    const scripted = makeScriptedPrompter(webSaasAnswers());
    const prompter = async (ctx) => {
      if (ctx && typeof ctx.prompt === 'string' && ctx.prompt.includes('Confirm and create project')) {
        return 'n';
      }
      return scripted(ctx);
    };

    const result = await runInit({
      argv: [],
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });

    expect(result.state).toBe('cancelled');
    expect(existsSync(join(repoDir, 'PROJECT.md'))).toBe(false);
  });
});

describe('TASK-166 AC3 — non-interactive paths are not broken', () => {
  let logSpy;
  let warnSpy;
  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('yes_flag_proceeds_without_any_new_blocking_prompt', async () => {
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-underspec-yes-flag');
    const prompter = makeScriptedPrompter(webSaasAnswers());

    const result = await runInit({
      argv: ['--yes'],
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });

    expect(result.state).toBe('created');
    expect(existsSync(join(repoDir, 'PROJECT.md'))).toBe(true);
    // The confirm prompt itself must never have fired under --yes.
    const confirmCalls = prompter.calls.filter(
      (c) => typeof c.prompt === 'string' && c.prompt.includes('Confirm and create project'),
    );
    expect(confirmCalls.length).toBe(0);
  });

  it('answers_mode_proceeds_without_a_prompter_at_all', async () => {
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-underspec-answers-mode');

    const result = await runInit({
      argv: [],
      prompter: null,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
      answers: {
        project_name: 'answers-mode-underspec',
        project_type: 'other',
        project_description: 'Answers-mode with no goals/scope.',
        target_users: 'devs',
        success_criteria: 'works',
        problem_statement: 'A real, substantive problem statement.',
        // goals/scope_in/scope_out intentionally omitted entirely.
      },
    });

    expect(result.state).toBe('created');
    expect(existsSync(join(repoDir, 'PROJECT.md'))).toBe(true);
  });

  it('answers_mode_notice_is_non_blocking_console_output_only', async () => {
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-underspec-answers-notice');

    await runInit({
      argv: [],
      prompter: null,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
      answers: {
        project_name: 'answers-mode-notice',
        project_type: 'other',
        project_description: 'Answers-mode with no goals/scope.',
        target_users: 'devs',
        success_criteria: 'works',
        problem_statement: 'A real, substantive problem statement.',
      },
    });

    const allOutput = [...logSpy.mock.calls, ...warnSpy.mock.calls]
      .map((args) => args.join(' '))
      .join('\n');
    expect(allOutput).toMatch(/goals/i);
  });
});

describe('TASK-166 AC4 — regression: no warning fires when it should not', () => {
  let logSpy;
  let warnSpy;
  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('no_warning_when_goals_scope_are_defined', async () => {
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-underspec-defined-no-warn');
    const prompter = makeScriptedPrompter(webSaasAnswers({
      goals: 'ship fast, iterate',
      scope_in: 'intake wizard',
      scope_out: 'deployment tooling',
    }));

    const result = await runInit({
      argv: [],
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });

    expect(result.state).toBe('created');
    const allOutput = [...logSpy.mock.calls, ...warnSpy.mock.calls]
      .map((args) => args.join(' '))
      .join('\n');
    expect(allOutput).not.toMatch(/all empty/i);
  });

  it('no_warning_when_problem_statement_is_effectively_empty', async () => {
    // problem_statement is REQUIRED (TASK-048), so it can't truly be '' through
    // the interactive engine — but answers-mode can still supply a
    // whitespace-only value. The predicate must not fire on it.
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-underspec-blank-problem');

    await runInit({
      argv: [],
      prompter: null,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
      answers: {
        project_name: 'blank-problem',
        project_type: 'other',
        project_description: 'Blank problem statement test.',
        target_users: 'devs',
        success_criteria: 'works',
        problem_statement: '   ',
      },
    });

    const allOutput = [...logSpy.mock.calls, ...warnSpy.mock.calls]
      .map((args) => args.join(' '))
      .join('\n');
    expect(allOutput).not.toMatch(/all empty/i);
  });
});
