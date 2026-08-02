// tests/e2e/intake-scope-overlap-warn.spec.js
// TASK-167 — warn-and-reconfirm when a normalized token appears in BOTH
// scope_in and scope_out.
//
// Human scope decision (2026-07-18): warn-but-allow posture (same as the
// TASK-166 underspecified-definition check) — the user may still proceed.
//
// Covers:
//   AC1 — a normalized token (case/whitespace-insensitive) present in both
//         scope_in and scope_out warns naming the conflicting item(s) and the
//         existing confirm prompt doubles as the reconfirm; proceeding is
//         still allowed.
//   AC2 — disjoint lists pass silently (no false warning); empty lists pass
//         silently.
//   AC3 — token normalization matches the existing comma-split/trim
//         conventions (src/question-library.js) — case and whitespace
//         variants both resolve to the same conflict.
//   AC4 — tdd: parsing/validation logic + fixtures; existing wizard specs
//         (intake-underspecified-warn.spec.js et al.) stay green.

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

describe('findScopeOverlap (pure predicate)', () => {
  it('finds_a_single_conflicting_token_case_insensitive', async () => {
    const { findScopeOverlap } = await import(PROD.init);
    expect(findScopeOverlap({
      scope_in: ['Billing', 'Auth'],
      scope_out: ['auth', 'notifications'],
    })).toEqual(['auth']);
  });

  it('finds_a_conflicting_token_across_whitespace_variants', async () => {
    const { findScopeOverlap } = await import(PROD.init);
    expect(findScopeOverlap({
      scope_in: [' Billing ', 'Auth'],
      scope_out: ['auth', ' billing'],
    })).toEqual(['auth', 'billing']);
  });

  it('finds_multiple_conflicts_deduped_in_scope_out_order', async () => {
    const { findScopeOverlap } = await import(PROD.init);
    expect(findScopeOverlap({
      scope_in: ['Auth', 'Billing'],
      scope_out: ['billing', 'AUTH', 'billing'],
    })).toEqual(['billing', 'auth']);
  });

  it('returns_empty_array_for_disjoint_lists', async () => {
    const { findScopeOverlap } = await import(PROD.init);
    expect(findScopeOverlap({
      scope_in: ['billing'],
      scope_out: ['notifications'],
    })).toEqual([]);
  });

  it('returns_empty_array_when_either_list_is_empty_or_absent', async () => {
    const { findScopeOverlap } = await import(PROD.init);
    expect(findScopeOverlap({ scope_in: [], scope_out: ['auth'] })).toEqual([]);
    expect(findScopeOverlap({ scope_in: ['auth'], scope_out: [] })).toEqual([]);
    expect(findScopeOverlap({ scope_in: ['auth'] })).toEqual([]);
    expect(findScopeOverlap({ scope_out: ['auth'] })).toEqual([]);
    expect(findScopeOverlap({})).toEqual([]);
  });

  it('returns_empty_array_for_null_or_non_object_answers', async () => {
    const { findScopeOverlap } = await import(PROD.init);
    expect(findScopeOverlap(null)).toEqual([]);
    expect(findScopeOverlap(undefined)).toEqual([]);
  });

  it('handles_raw_comma_separated_strings_defensively', async () => {
    // Pre-normalization callers may still hold the raw wizard string shape
    // (comma-separated, un-split) — findScopeOverlap tolerates it the same
    // way normalizeDefinitionAnswers's split/trim convention does.
    const { findScopeOverlap } = await import(PROD.init);
    expect(findScopeOverlap({
      scope_in: 'Auth, Billing',
      scope_out: 'auth,notifications',
    })).toEqual(['auth']);
  });
});

describe('buildScopeOverlapWarning (pure message builder)', () => {
  it('names_the_single_conflicting_item', async () => {
    const { buildScopeOverlapWarning } = await import(PROD.init);
    const msg = buildScopeOverlapWarning({
      scope_in: ['Auth'],
      scope_out: ['auth'],
    });
    expect(msg).toMatch(/auth/i);
  });

  it('names_all_conflicting_items_when_multiple', async () => {
    const { buildScopeOverlapWarning } = await import(PROD.init);
    const msg = buildScopeOverlapWarning({
      scope_in: ['Auth', 'Billing'],
      scope_out: ['billing', 'auth'],
    });
    expect(msg).toMatch(/auth/i);
    expect(msg).toMatch(/billing/i);
  });

  // TASK-175 item 2 — the warning used to echo the normalized (lowercased)
  // comparison token rather than the user's own scope_out casing. Direct,
  // case-sensitive lock (the two tests above are deliberately case-
  // insensitive and would not have caught the regression).
  it('preserves_the_users_original_scope_out_casing_rather_than_the_normalized_token', async () => {
    const { buildScopeOverlapWarning } = await import(PROD.init);
    const msg = buildScopeOverlapWarning({
      scope_in: ['Auth'],
      scope_out: ['AUTH'],
    });
    expect(msg).toContain('"AUTH"');
    expect(msg).not.toContain('"auth"');
  });
});

// ---------------------------------------------------------------------------
// Integration via runInit
// ---------------------------------------------------------------------------

describe('TASK-167 AC1 — interactive warn-and-reconfirm', () => {
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

  it('warns_naming_the_conflict_and_still_proceeds_on_default_confirm', async () => {
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-scope-overlap-warn-proceed');
    const prompter = makeScriptedPrompter(webSaasAnswers({
      goals: 'ship fast',
      scope_in: 'Auth, Billing',
      scope_out: 'auth, notifications',
    }));

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
    expect(allOutput).toMatch(/auth/i);
    expect(allOutput).toMatch(/both/i);
  });

  it('explicit_n_at_the_reconfirm_step_aborts_without_writing_PROJECT_md', async () => {
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-scope-overlap-explicit-n');
    const scripted = makeScriptedPrompter(webSaasAnswers({
      goals: 'ship fast',
      scope_in: 'Auth',
      scope_out: 'auth',
    }));
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

describe('TASK-167 AC2 — disjoint/empty lists pass silently', () => {
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

  it('no_warning_when_scope_in_and_scope_out_are_disjoint', async () => {
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-scope-overlap-disjoint');
    const prompter = makeScriptedPrompter(webSaasAnswers({
      goals: 'ship fast',
      scope_in: 'billing',
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
    expect(allOutput).not.toMatch(/both Scope/i);
  });

  it('no_warning_when_scope_in_and_scope_out_are_both_empty', async () => {
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-scope-overlap-both-empty');
    const prompter = makeScriptedPrompter(webSaasAnswers());

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
    expect(allOutput).not.toMatch(/both Scope/i);
  });
});

describe('TASK-167 AC3 — non-interactive paths degrade to a console notice', () => {
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

  it('yes_flag_warns_without_any_new_blocking_prompt', async () => {
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-scope-overlap-yes-flag');
    const prompter = makeScriptedPrompter(webSaasAnswers({
      goals: 'ship fast',
      scope_in: 'Auth',
      scope_out: 'AUTH',
    }));

    const result = await runInit({
      argv: ['--yes'],
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });

    expect(result.state).toBe('created');
    expect(existsSync(join(repoDir, 'PROJECT.md'))).toBe(true);
    const confirmCalls = prompter.calls.filter(
      (c) => typeof c.prompt === 'string' && c.prompt.includes('Confirm and create project'),
    );
    expect(confirmCalls.length).toBe(0);
    const allOutput = [...logSpy.mock.calls, ...warnSpy.mock.calls]
      .map((args) => args.join(' '))
      .join('\n');
    expect(allOutput).toMatch(/auth/i);
  });

  it('answers_mode_notice_is_non_blocking_console_output_only', async () => {
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-scope-overlap-answers-mode');

    const result = await runInit({
      argv: [],
      prompter: null,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
      answers: {
        project_name: 'answers-mode-overlap',
        project_type: 'other',
        project_description: 'Answers-mode with overlapping scope.',
        target_users: 'devs',
        success_criteria: 'works',
        problem_statement: 'A real, substantive problem statement.',
        goals: ['ship fast'],
        scope_in: ['Auth', 'Billing'],
        scope_out: ['billing'],
      },
    });

    expect(result.state).toBe('created');
    expect(existsSync(join(repoDir, 'PROJECT.md'))).toBe(true);
    const allOutput = [...logSpy.mock.calls, ...warnSpy.mock.calls]
      .map((args) => args.join(' '))
      .join('\n');
    expect(allOutput).toMatch(/billing/i);
  });
});

describe('TASK-167 — composes with TASK-166 warning without interference', () => {
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

  // NOTE: the two predicates are mutually exclusive by construction —
  // isDefinitionUnderspecified requires goals/scope_in/scope_out to be ALL
  // empty, while findScopeOverlap requires scope_in AND scope_out to both be
  // non-empty. They cannot both be true for a single answers object, so this
  // suite proves NON-INTERFERENCE (each check fires/doesn't independently of
  // the other's code path being present) rather than literal simultaneous
  // firing, which is not a reachable state.
  it('scope_overlap_warning_still_fires_when_goals_is_populated_TASK166_condition_false', async () => {
    const { runInit, isDefinitionUnderspecified } = await import(PROD.init);

    const repoDir = makeTmpDir('af-scope-overlap-compose-166-off');
    const answers = webSaasAnswers({
      goals: 'ship fast',
      scope_in: 'Auth',
      scope_out: 'auth',
    });
    const prompter = makeScriptedPrompter(answers);

    const result = await runInit({
      argv: [],
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });

    expect(result.state).toBe('created');
    expect(isDefinitionUnderspecified({
      problem_statement: answers.problem_statement,
      goals: ['ship fast'],
      scope_in: ['Auth'],
      scope_out: ['auth'],
    })).toBe(false);
    const allOutput = [...logSpy.mock.calls, ...warnSpy.mock.calls]
      .map((args) => args.join(' '))
      .join('\n');
    expect(allOutput).toMatch(/auth/i);
    expect(allOutput).not.toMatch(/all empty/i);
  });

  it('underspecified_warning_still_fires_when_scope_lists_are_both_empty_TASK167_condition_false', async () => {
    const { runInit, findScopeOverlap } = await import(PROD.init);

    const repoDir = makeTmpDir('af-scope-overlap-compose-167-off');
    const prompter = makeScriptedPrompter(webSaasAnswers());

    const result = await runInit({
      argv: [],
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });

    expect(result.state).toBe('created');
    expect(findScopeOverlap({ scope_in: [], scope_out: [] })).toEqual([]);
    const allOutput = [...logSpy.mock.calls, ...warnSpy.mock.calls]
      .map((args) => args.join(' '))
      .join('\n');
    expect(allOutput).toMatch(/all empty/i);
    expect(allOutput).not.toMatch(/both Scope/i);
  });
});
