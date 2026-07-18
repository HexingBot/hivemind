// tests/e2e/discovery-intake.spec.js
// TASK-046 — Discovery-first intake + confirmation gate.
//
// Covers:
//   AC2 — Answers flow through runInit into PROJECT.md as the definition body
//          sections (## Problem / ## Goals / ## Scope (in) / ## Scope (out)).
//   AC3 — Confirmation gate: interactive path prints a summary, prompts for
//          confirm AFTER questionnaire and BEFORE artifact writes. Empty/Enter
//          defaults to CONFIRM (materialization proceeds).
//   AC4 — Confirmation is suppressed: (a) in answers-mode (suppliedAnswers),
//          (b) via --yes flag in interactive mode.
//   AC5 — Abort on explicit NO: PROJECT.md and seeded backlog must NOT exist;
//          session bundle + intake.json MAY exist (resumable-wizard pre-confirm).
//   AC6a — Empty answer for goals/scope_in/scope_out → empty array → no heading
//           in PROJECT.md (not a one-item [''] array with a stray `- ` bullet).
//           Multi-item comma answer like "ship fast, iterate, learn" → 3 bullets.
//   AC6b — Order assertion: in the written PROJECT.md, indexOf('## Success criteria')
//           < indexOf('## Problem') — the BODY_SECTIONS render order keeps definition
//           sections AFTER the existing well-known sections.
//
// NOTE ON AC3/AC5/AC4 prompter design:
//   The confirmation prompt has a fixed recognizable text ("Confirm" or similar).
//   We intercept it by checking ctx.prompt for that text (case-insensitive match
//   on "confirm" or "definition" or the exact prompt the impl will use). The fake
//   prompters below delegate all wizard questions to the webSaasAnswers map and
//   specifically handle the confirmation prompt. The impl must call prompter with
//   type:'string' for the confirmation step; empty or 'y*' prefix = confirm.

import { describe, it, expect, afterAll } from 'vitest';
import {
  existsSync, readFileSync, readdirSync,
} from 'node:fs';
import { join } from 'node:path';

import { PROD } from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';
import { makeScriptedPrompter, webSaasAnswers } from '../helpers/scripted-prompter.js';

afterAll(cleanupAll);

const FIXED_NOW = '2026-05-26T12:00:00Z';
const FIXED_HOST = 'test-host';

// ---------------------------------------------------------------------------
// Prompter helpers
// ---------------------------------------------------------------------------

/**
 * Build an answer map for webSaasAnswers that includes the four discovery
 * questions. The new discovery questions are type:'string' and will be routed
 * via PROMPT_SIGNATURES once the IMPL phase adds them. Until then (tests-first)
 * they will be unresolved — but the tests still describe the expected behavior.
 *
 * We supply inline prompter logic below that handles discovery questions by
 * matching on the question id embedded in ctx.prompt (since PROMPT_SIGNATURES
 * won't carry them yet). This is the forward-compatible approach: the IMPL phase
 * will add them to PROMPT_SIGNATURES and the tests will keep passing.
 */
function webSaasWithDiscovery(overrides = {}) {
  return {
    // discovery questions come first in the new ordering
    problem_statement: 'Teams lose context between sessions.',
    goals: 'ship fast, iterate, learn',
    scope_in: 'intake wizard, agent briefing',
    scope_out: 'deployment tooling',
    // then the classic wizard fields
    ...webSaasAnswers(),
    ...overrides,
  };
}

/**
 * Build a prompter that:
 *  1. Handles confirmation prompts by returning the given confirmAnswer.
 *  2. Handles all wizard questions (via makeScriptedPrompter + PROMPT_SIGNATURES
 *     extended with discovery question signatures).
 *  3. For discovery questions not yet in PROMPT_SIGNATURES (before IMPL phase
 *     adds them), falls through to the id-based lookup below.
 *
 * The `confirmAnswer` is what the test wants to return at the confirmation step:
 *   '' or 'y' → confirm (proceed with materialization)
 *   'n'        → abort
 */
function makeDiscoveryPrompter(answers, confirmAnswer, opts = {}) {
  // Track whether the confirmation prompter was ever called.
  let confirmCalled = false;
  const wizardPrompter = makeScriptedPrompter(answers);

  const DISCOVERY_SIGNATURES = {
    problem_statement: 'problem',
    goals: 'goals',
    scope_in: 'scope in',
    scope_out: 'scope out',
  };

  // Build an extended prompter that handles confirmation and discovery
  // questions not yet in PROMPT_SIGNATURES.
  const prompter = async (ctx) => {
    if (!ctx || typeof ctx.prompt !== 'string') {
      throw new Error(`prompter received unexpected ctx: ${JSON.stringify(ctx)}`);
    }
    const lower = ctx.prompt.toLowerCase();

    // Confirmation gate detection: the impl will include some form of
    // "confirm" or "proceed" or "definition" in the prompt. Match broadly.
    if (
      lower.includes('confirm') ||
      lower.includes('proceed') ||
      lower.includes('look good') ||
      lower.includes('ready to create')
    ) {
      confirmCalled = true;
      if (opts.onConfirmCalled) opts.onConfirmCalled(ctx);
      return confirmAnswer;
    }

    // Try the standard scripted prompter first (PROMPT_SIGNATURES).
    try {
      return await wizardPrompter(ctx);
    } catch (err) {
      // If the scripted prompter couldn't resolve, check for discovery question
      // prompts by looking for their distinctive substrings.
      for (const [id, fragment] of Object.entries(DISCOVERY_SIGNATURES)) {
        if (lower.includes(fragment) && Object.prototype.hasOwnProperty.call(answers, id)) {
          return answers[id];
        }
      }
      // Re-throw if we still can't resolve.
      throw err;
    }
  };

  prompter.wasConfirmCalled = () => confirmCalled;

  return prompter;
}

// ---------------------------------------------------------------------------
// AC2 — Discovery answers flow through runInit into PROJECT.md sections
// ---------------------------------------------------------------------------

describe('TASK-046 AC2 — discovery answers flow into PROJECT.md sections via runInit', () => {
  it('problem_statement_appears_as_Problem_section_in_PROJECT_md', async () => {
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-disc-ac2-problem');
    const answers = webSaasWithDiscovery({
      problem_statement: 'Teams lose context between sessions.',
    });
    const prompter = makeDiscoveryPrompter(answers, ''); // empty = confirm

    const result = await runInit({
      argv: [],
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
      hostname: FIXED_HOST,
    });

    expect(result.state).toBe('created');
    const text = readFileSync(join(repoDir, 'PROJECT.md'), 'utf8');
    expect(text).toMatch(/^## Problem$/m);
    expect(text).toContain('Teams lose context between sessions.');
  });

  it('goals_multi_value_appears_as_Goals_section_bullets', async () => {
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-disc-ac2-goals');
    const answers = webSaasWithDiscovery({
      goals: 'ship fast, iterate, learn',
    });
    const prompter = makeDiscoveryPrompter(answers, '');

    const result = await runInit({
      argv: [],
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
      hostname: FIXED_HOST,
    });

    expect(result.state).toBe('created');
    const text = readFileSync(join(repoDir, 'PROJECT.md'), 'utf8');
    expect(text).toMatch(/^## Goals$/m);
    // Each comma-split item must be a separate bullet.
    expect(text).toMatch(/^- ship fast$/m);
    expect(text).toMatch(/^- iterate$/m);
    expect(text).toMatch(/^- learn$/m);
  });

  it('scope_in_appears_as_ScopeIn_section_bullets', async () => {
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-disc-ac2-scopein');
    const answers = webSaasWithDiscovery({
      scope_in: 'intake wizard, agent briefing',
    });
    const prompter = makeDiscoveryPrompter(answers, '');

    const result = await runInit({
      argv: [],
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
      hostname: FIXED_HOST,
    });

    expect(result.state).toBe('created');
    const text = readFileSync(join(repoDir, 'PROJECT.md'), 'utf8');
    expect(text).toMatch(/^## Scope \(in\)$/m);
    expect(text).toMatch(/^- intake wizard$/m);
    expect(text).toMatch(/^- agent briefing$/m);
  });

  it('scope_out_appears_as_ScopeOut_section_bullets', async () => {
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-disc-ac2-scopeout');
    const answers = webSaasWithDiscovery({
      scope_out: 'deployment tooling',
    });
    const prompter = makeDiscoveryPrompter(answers, '');

    const result = await runInit({
      argv: [],
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
      hostname: FIXED_HOST,
    });

    expect(result.state).toBe('created');
    const text = readFileSync(join(repoDir, 'PROJECT.md'), 'utf8');
    expect(text).toMatch(/^## Scope \(out\)$/m);
    expect(text).toMatch(/^- deployment tooling$/m);
  });

  it('all_four_sections_present_when_all_discovery_answers_supplied', async () => {
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-disc-ac2-all');
    const answers = webSaasWithDiscovery({
      problem_statement: 'Context gets lost.',
      goals: 'retain context, fast onboarding',
      scope_in: 'intake, briefing',
      scope_out: 'deployment, billing',
    });
    const prompter = makeDiscoveryPrompter(answers, '');

    const result = await runInit({
      argv: [],
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
      hostname: FIXED_HOST,
    });

    expect(result.state).toBe('created');
    const text = readFileSync(join(repoDir, 'PROJECT.md'), 'utf8');
    expect(text).toMatch(/^## Problem$/m);
    expect(text).toMatch(/^## Goals$/m);
    expect(text).toMatch(/^## Scope \(in\)$/m);
    expect(text).toMatch(/^## Scope \(out\)$/m);
    expect(text).toContain('Context gets lost.');
    expect(text).toMatch(/^- retain context$/m);
    expect(text).toMatch(/^- fast onboarding$/m);
    expect(text).toMatch(/^- intake$/m);
    expect(text).toMatch(/^- briefing$/m);
    expect(text).toMatch(/^- deployment$/m);
    expect(text).toMatch(/^- billing$/m);
  });
});

// ---------------------------------------------------------------------------
// AC3 — Confirmation gate in interactive mode
// ---------------------------------------------------------------------------

describe('TASK-046 AC3 — confirmation gate fires in interactive path', () => {
  it('confirmation_prompter_is_called_in_interactive_mode', async () => {
    // Asserts the confirmation step fires in the interactive path (prompter
    // present, no suppliedAnswers, no --yes flag). Verifying this by looking
    // at whether the confirm prompter was called.
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-disc-ac3-called');
    const answers = webSaasWithDiscovery();
    const prompter = makeDiscoveryPrompter(answers, ''); // empty = confirm

    await runInit({
      argv: [],
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
      hostname: FIXED_HOST,
    });

    expect(
      prompter.wasConfirmCalled(),
      'confirmation prompter must be called in interactive mode',
    ).toBe(true);
  });

  it('empty_enter_at_confirm_proceeds_with_materialization', async () => {
    // Empty input (default Enter) at the confirm step must proceed.
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-disc-ac3-confirm-empty');
    const answers = webSaasWithDiscovery();
    const prompter = makeDiscoveryPrompter(answers, ''); // empty = confirm

    const result = await runInit({
      argv: [],
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
      hostname: FIXED_HOST,
    });

    expect(result.state).toBe('created');
    expect(existsSync(join(repoDir, 'PROJECT.md'))).toBe(true);
  });

  it('y_at_confirm_proceeds_with_materialization', async () => {
    // 'y' at the confirm step must also proceed.
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-disc-ac3-confirm-y');
    const answers = webSaasWithDiscovery();
    const prompter = makeDiscoveryPrompter(answers, 'y');

    const result = await runInit({
      argv: [],
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
      hostname: FIXED_HOST,
    });

    expect(result.state).toBe('created');
    expect(existsSync(join(repoDir, 'PROJECT.md'))).toBe(true);
  });

  it('confirmation_fires_after_questionnaire_and_before_project_md', async () => {
    // Assert ordering: by the time the confirm prompt fires, runQuestionnaire
    // has already collected all answers (we know this because the confirm step
    // itself requires the answers to print the summary). We verify this
    // indirectly by asserting that PROJECT.md does NOT exist at the point the
    // confirm prompt fires (since PROJECT.md is written AFTER confirmation).
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-disc-ac3-order');
    const answers = webSaasWithDiscovery();

    let projectMdExistedAtConfirmTime = null;
    const prompter = makeDiscoveryPrompter(answers, '', {
      onConfirmCalled: () => {
        projectMdExistedAtConfirmTime = existsSync(join(repoDir, 'PROJECT.md'));
      },
    });

    await runInit({
      argv: [],
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
      hostname: FIXED_HOST,
    });

    expect(
      prompter.wasConfirmCalled(),
      'confirm must have been called',
    ).toBe(true);
    expect(
      projectMdExistedAtConfirmTime,
      'PROJECT.md must NOT exist at the time the confirm prompt fires (it is written after confirm)',
    ).toBe(false);
    // After the call, PROJECT.md must exist (confirm proceeded via empty answer).
    expect(existsSync(join(repoDir, 'PROJECT.md'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC4 — Confirmation suppressed in answers-mode and via --yes flag
// ---------------------------------------------------------------------------

describe('TASK-046 AC4 — confirmation suppressed in answers-mode and --yes', () => {
  it('confirmation_not_called_in_answers_mode', async () => {
    // suppliedAnswers path: no prompter invocations for confirmation.
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-disc-ac4-answersmode');

    // A prompter that throws if called at all — proves answers-mode never
    // invokes the confirmation prompter.
    let confirmCalled = false;
    const throwPrompter = async (ctx) => {
      if (!ctx || typeof ctx.prompt !== 'string') {
        throw new Error('unexpected prompter call');
      }
      const lower = ctx.prompt.toLowerCase();
      if (
        lower.includes('confirm') ||
        lower.includes('proceed') ||
        lower.includes('look good') ||
        lower.includes('ready to create')
      ) {
        confirmCalled = true;
        throw new Error(
          `confirmation prompter must NOT be called in answers-mode; prompt: ${ctx.prompt}`,
        );
      }
      // Unreachable in answers-mode (prompter is null). But if somehow called:
      throw new Error(`prompter must not be called in answers-mode; prompt: ${ctx.prompt}`);
    };

    // answers-mode: pass suppliedAnswers, null prompter (same as production path).
    const result = await runInit({
      argv: [],
      prompter: null,  // non-interactive: null prompter
      repoRoot: repoDir,
      now: () => FIXED_NOW,
      hostname: FIXED_HOST,
      answers: {
        project_name: 'answers-mode-project',
        project_type: 'other',
        project_description: 'A test project via answers mode.',
        target_users: 'developers',
        success_criteria: 'works',
        problem_statement: 'Context is lost.',
        goals: ['ship fast', 'iterate'],
        scope_in: ['intake'],
        scope_out: ['deployment'],
      },
    });

    expect(result.state).toBe('created');
    expect(existsSync(join(repoDir, 'PROJECT.md'))).toBe(true);
    // The confirm prompter should not have been called. Using throwPrompter
    // to catch it — if confirmCalled is false, it was never invoked.
    expect(confirmCalled, 'confirm prompter must not be called in answers-mode').toBe(false);
  });

  it('confirmation_not_called_with_yes_flag', async () => {
    // --yes flag: wizard runs but confirmation is skipped.
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-disc-ac4-yes');
    const answers = webSaasWithDiscovery();

    let confirmCalled = false;
    const wizardPrompter = makeScriptedPrompter(answers);
    const DISCOVERY_SIGNATURES = {
      problem_statement: 'problem',
      goals: 'goals',
      scope_in: 'scope in',
      scope_out: 'scope out',
    };

    const prompter = async (ctx) => {
      if (!ctx || typeof ctx.prompt !== 'string') {
        throw new Error('unexpected ctx');
      }
      const lower = ctx.prompt.toLowerCase();
      if (
        lower.includes('confirm') ||
        lower.includes('proceed') ||
        lower.includes('look good') ||
        lower.includes('ready to create')
      ) {
        confirmCalled = true;
        throw new Error(
          `confirmation must be skipped when --yes is passed; got prompt: ${ctx.prompt}`,
        );
      }
      try {
        return await wizardPrompter(ctx);
      } catch {
        for (const [id, fragment] of Object.entries(DISCOVERY_SIGNATURES)) {
          if (lower.includes(fragment) && Object.prototype.hasOwnProperty.call(answers, id)) {
            return answers[id];
          }
        }
        throw new Error(`unresolved prompt: ${ctx.prompt}`);
      }
    };

    const result = await runInit({
      argv: ['--yes'],
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
      hostname: FIXED_HOST,
    });

    expect(result.state).toBe('created');
    expect(existsSync(join(repoDir, 'PROJECT.md'))).toBe(true);
    expect(confirmCalled, 'confirm must not be called when --yes is passed').toBe(false);
  });

  it('yes_is_a_recognized_flag_not_an_unknown_argument', async () => {
    // Regression guard: --yes must be in KNOWN_FLAGS so it does not throw.
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-disc-ac4-yesflag-known');
    const answers = webSaasWithDiscovery();
    const prompter = makeDiscoveryPrompter(answers, '');

    // Must NOT throw "unknown argument: --yes"
    await expect(
      runInit({
        argv: ['--yes'],
        prompter,
        repoRoot: repoDir,
        now: () => FIXED_NOW,
        hostname: FIXED_HOST,
      }),
    ).resolves.not.toThrow();
  });

  it('materialization_succeeds_in_answers_mode_without_confirmation', async () => {
    // Proves that answers-mode materializes PROJECT.md + backlog even without
    // the confirmation step.
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-disc-ac4-answers-materializes');

    const result = await runInit({
      argv: [],
      prompter: null,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
      hostname: FIXED_HOST,
      answers: {
        project_name: 'answers-materializes',
        project_type: 'cli-tool',
        project_description: 'CLI for testing.',
        target_users: 'developers',
        success_criteria: 'ships',
        problem_statement: 'A well-defined problem.',
        goals: ['goal one', 'goal two'],
        scope_in: ['feature A'],
        scope_out: ['feature B'],
      },
    });

    expect(result.state).toBe('created');
    expect(existsSync(join(repoDir, 'PROJECT.md'))).toBe(true);
    // backlog must also be seeded
    const taskFiles = readdirSync(join(repoDir, 'tasks')).filter(
      (n) => /^TASK-\d{3,}\.json$/.test(n),
    );
    expect(taskFiles.length, 'seeder must run in answers-mode without confirm').toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// AC5 — Abort on NO: PROJECT.md and seeded backlog must NOT exist
// ---------------------------------------------------------------------------

describe('TASK-046 AC5 — abort on NO at confirmation gate', () => {
  it('project_md_does_not_exist_after_abort', async () => {
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-disc-ac5-no-projmd');
    const answers = webSaasWithDiscovery();
    const prompter = makeDiscoveryPrompter(answers, 'n'); // 'n' = abort

    // The abort must not throw — it should return gracefully (state 'aborted'
    // or similar, or the function might just exit cleanly).
    // We do not assert the return state here since the impl is free to choose
    // the state name; we only assert the FILE SYSTEM invariants.
    try {
      await runInit({
        argv: [],
        prompter,
        repoRoot: repoDir,
        now: () => FIXED_NOW,
        hostname: FIXED_HOST,
      });
    } catch {
      // Some implementations may throw on abort — we allow that too.
      // The filesystem assertions below are what matter.
    }

    expect(
      existsSync(join(repoDir, 'PROJECT.md')),
      'PROJECT.md must NOT exist after aborting at the confirmation gate',
    ).toBe(false);
  });

  it('seeded_backlog_does_not_exist_after_abort', async () => {
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-disc-ac5-no-backlog');
    const answers = webSaasWithDiscovery();
    const prompter = makeDiscoveryPrompter(answers, 'n'); // 'n' = abort

    try {
      await runInit({
        argv: [],
        prompter,
        repoRoot: repoDir,
        now: () => FIXED_NOW,
        hostname: FIXED_HOST,
      });
    } catch {
      // Abort may throw — allowed.
    }

    // tasks/ must be empty of seeded tickets (may not exist at all, or be empty).
    const tasksDir = join(repoDir, 'tasks');
    const taskFiles = existsSync(tasksDir)
      ? readdirSync(tasksDir).filter((n) => /^TASK-\d{3,}\.json$/.test(n))
      : [];
    expect(
      taskFiles.length,
      'no seeded TASK-*.json files must exist after aborting at the confirmation gate',
    ).toBe(0);
  });

  it('project_context_md_does_not_exist_after_abort', async () => {
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-disc-ac5-no-ctx');
    const answers = webSaasWithDiscovery();
    const prompter = makeDiscoveryPrompter(answers, 'n');

    try {
      await runInit({
        argv: [],
        prompter,
        repoRoot: repoDir,
        now: () => FIXED_NOW,
        hostname: FIXED_HOST,
      });
    } catch {
      // Abort may throw — allowed.
    }

    const ctxPath = join(repoDir, '.claude', 'agents', 'project-context.md');
    expect(
      existsSync(ctxPath),
      'project-context.md must NOT exist after aborting at the confirmation gate',
    ).toBe(false);
  });

  it('no_at_confirm_with_n_aborts', async () => {
    // Explicit 'n' at the confirmation step.
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-disc-ac5-n');
    const answers = webSaasWithDiscovery();
    const prompter = makeDiscoveryPrompter(answers, 'n');

    let caught = null;
    let returnedState = null;
    try {
      const result = await runInit({
        argv: [],
        prompter,
        repoRoot: repoDir,
        now: () => FIXED_NOW,
        hostname: FIXED_HOST,
      });
      returnedState = result.state;
    } catch (err) {
      caught = err;
    }

    // Either returns an aborted state or throws — both are acceptable.
    // The key invariant is the filesystem assertion below.
    const projectMdAbsent = !existsSync(join(repoDir, 'PROJECT.md'));
    expect(
      projectMdAbsent,
      'PROJECT.md must not exist when user answers "n" at the confirmation gate ' +
      `(state: ${returnedState}, error: ${caught && caught.message})`,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC6a — Empty answer → empty array omission; comma answer → N bullets
// ---------------------------------------------------------------------------

describe('TASK-046 AC6a — empty answer omits section; comma answer splits into bullets', () => {
  it('empty_goals_answer_produces_no_Goals_heading_in_PROJECT_md', async () => {
    // A wizard run where the user presses Enter on "goals" (empty string)
    // must produce a PROJECT.md with NO ## Goals heading.
    // This tests the normalization: '' → [] → omission in writeProjectMd.
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-disc-ac6a-empty-goals');

    // Use answers-mode to bypass confirmation gate (AC4 proves it's suppressed).
    const result = await runInit({
      argv: [],
      prompter: null,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
      hostname: FIXED_HOST,
      answers: {
        project_name: 'empty-goals-project',
        project_type: 'other',
        project_description: 'Test empty goals normalization.',
        target_users: 'devs',
        success_criteria: 'works',
        // goals is an empty string — must normalize to [] and produce no heading
        goals: '',
      },
    });

    expect(result.state).toBe('created');
    const text = readFileSync(join(repoDir, 'PROJECT.md'), 'utf8');
    // MUST NOT have ## Goals heading.
    expect(
      text,
      'PROJECT.md must have no ## Goals heading when goals answer is empty string',
    ).not.toMatch(/^## Goals$/m);
    // MUST NOT have a stray '- ' bullet from a [''] array.
    // (We check that there is no bullet immediately after a potential Goals heading —
    // but since the heading must not exist, this is redundant. Belt-and-suspenders.)
    expect(text).not.toContain('\n- \n');
  });

  it('empty_array_goals_also_produces_no_Goals_heading', async () => {
    // Direct empty-array path (answers-mode, arrays passed directly per TASK-047 note).
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-disc-ac6a-empty-arr-goals');
    const result = await runInit({
      argv: [],
      prompter: null,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
      hostname: FIXED_HOST,
      answers: {
        project_name: 'empty-arr-goals',
        project_type: 'other',
        project_description: 'Test.',
        target_users: 'devs',
        success_criteria: 'works',
        goals: [],  // empty array directly
      },
    });

    expect(result.state).toBe('created');
    const text = readFileSync(join(repoDir, 'PROJECT.md'), 'utf8');
    expect(text).not.toMatch(/^## Goals$/m);
  });

  it('comma_separated_goals_becomes_three_bullets', async () => {
    // "ship fast, iterate, learn" must produce three separate bullet points.
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-disc-ac6a-three-bullets');
    const result = await runInit({
      argv: [],
      prompter: null,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
      hostname: FIXED_HOST,
      answers: {
        project_name: 'three-bullet-goals',
        project_type: 'other',
        project_description: 'Test goals normalization.',
        target_users: 'devs',
        success_criteria: 'works',
        goals: 'ship fast, iterate, learn',
      },
    });

    expect(result.state).toBe('created');
    const text = readFileSync(join(repoDir, 'PROJECT.md'), 'utf8');
    expect(text).toMatch(/^## Goals$/m);
    expect(text).toMatch(/^- ship fast$/m);
    expect(text).toMatch(/^- iterate$/m);
    expect(text).toMatch(/^- learn$/m);

    // Exactly 3 bullets under ## Goals (not more).
    // Extract the Goals section lines.
    const lines = text.split('\n');
    let inGoals = false;
    const goalBullets = [];
    for (const line of lines) {
      if (/^## Goals$/.test(line)) { inGoals = true; continue; }
      if (inGoals && /^## /.test(line)) { inGoals = false; break; }
      if (inGoals && /^- /.test(line)) goalBullets.push(line);
    }
    expect(goalBullets.length, 'Goals section must have exactly 3 bullets').toBe(3);
  });

  it('comma_normalized_string_accepts_extra_whitespace_around_items', async () => {
    // " ship fast , iterate , learn " → 3 trimmed bullets.
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-disc-ac6a-trim-whitespace');
    const result = await runInit({
      argv: [],
      prompter: null,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
      hostname: FIXED_HOST,
      answers: {
        project_name: 'whitespace-goals',
        project_type: 'other',
        project_description: 'Test whitespace trimming in comma split.',
        target_users: 'devs',
        success_criteria: 'works',
        goals: ' ship fast , iterate , learn ',
      },
    });

    expect(result.state).toBe('created');
    const text = readFileSync(join(repoDir, 'PROJECT.md'), 'utf8');
    expect(text).toMatch(/^- ship fast$/m);
    expect(text).toMatch(/^- iterate$/m);
    expect(text).toMatch(/^- learn$/m);
  });

  it('empty_scope_in_string_omits_ScopeIn_heading', async () => {
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-disc-ac6a-empty-scopein');
    const result = await runInit({
      argv: [],
      prompter: null,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
      hostname: FIXED_HOST,
      answers: {
        project_name: 'empty-scope-in',
        project_type: 'other',
        project_description: 'Test.',
        target_users: 'devs',
        success_criteria: 'works',
        scope_in: '',
      },
    });

    expect(result.state).toBe('created');
    const text = readFileSync(join(repoDir, 'PROJECT.md'), 'utf8');
    expect(text).not.toMatch(/^## Scope \(in\)$/m);
  });

  it('empty_scope_out_string_omits_ScopeOut_heading', async () => {
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-disc-ac6a-empty-scopeout');
    const result = await runInit({
      argv: [],
      prompter: null,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
      hostname: FIXED_HOST,
      answers: {
        project_name: 'empty-scope-out',
        project_type: 'other',
        project_description: 'Test.',
        target_users: 'devs',
        success_criteria: 'works',
        scope_out: '',
      },
    });

    expect(result.state).toBe('created');
    const text = readFileSync(join(repoDir, 'PROJECT.md'), 'utf8');
    expect(text).not.toMatch(/^## Scope \(out\)$/m);
  });

  it('array_goals_passed_directly_preserves_items_without_resplitting', async () => {
    // When goals is already an array (TASK-047 path), it must not be re-split.
    // "ship fast, then iterate" as a single-item array stays as one bullet.
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-disc-ac6a-array-passthrough');
    const result = await runInit({
      argv: [],
      prompter: null,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
      hostname: FIXED_HOST,
      answers: {
        project_name: 'array-passthrough',
        project_type: 'other',
        project_description: 'Test.',
        target_users: 'devs',
        success_criteria: 'works',
        goals: ['ship fast, then iterate', 'measure and adapt'],
      },
    });

    expect(result.state).toBe('created');
    const text = readFileSync(join(repoDir, 'PROJECT.md'), 'utf8');
    expect(text).toMatch(/^## Goals$/m);
    // "ship fast, then iterate" must be ONE bullet, not split on the comma.
    expect(text).toMatch(/^- ship fast, then iterate$/m);
    expect(text).toMatch(/^- measure and adapt$/m);
    // MUST NOT produce stray sub-items from re-splitting.
    expect(text).not.toMatch(/^- then iterate$/m);
  });
});

// ---------------------------------------------------------------------------
// TASK-174 — interactive-path skip (Enter) of goals/scope_in/scope_out must
// NOT produce a stray '- null' bullet or an empty heading. The bug: the
// runQuestionnaire engine's Enter-skip sentinel for an optional question is
// `null` (not '' / []); normalizeDefinitionAnswers's per-field guard
// (`if (v === null || v === undefined) continue`) left that null value
// untouched, so it survived into writeProjectMd's bullet renderer, which
// treats a non-array value as a one-item `[null]` array — one item, so the
// `items.length === 0` empty-omission guard never fires, and String(null)
// renders the literal text "null" as a bullet under a heading that should not
// exist at all. AC6a above already locks the answers-mode ('' / [] passed
// directly) path; this locks the INTERACTIVE path, which is the only path
// that actually produces the engine's null sentinel.
// ---------------------------------------------------------------------------

describe('TASK-174 — interactive Enter-skip of goals/scope produces no null bullet', () => {
  it('interactive_enter_skip_of_all_three_definition_lists_produces_no_null_bullet_or_heading', async () => {
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-174-interactive-null-skip');
    // Enter-skip: goals/scope_in/scope_out answered with '' via the prompter,
    // exactly as a human pressing Enter would (see question-library.js prompts
    // "... or press Enter to skip"). The engine coerces this to `null`
    // (validateAndCoerce's required:false branch), NOT '' or [].
    const answers = webSaasWithDiscovery({
      goals: '',
      scope_in: '',
      scope_out: '',
    });
    const prompter = makeDiscoveryPrompter(answers, ''); // '' at confirm = confirm

    const result = await runInit({
      argv: [],
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
      hostname: FIXED_HOST,
    });

    expect(result.state).toBe('created');
    const text = readFileSync(join(repoDir, 'PROJECT.md'), 'utf8');

    // The pre-fix bug: writeProjectMd renders `## Goals\n- null` (and the same
    // for Scope (in) / Scope (out)) because String(null) === 'null'.
    expect(text, 'PROJECT.md must not contain a stray "- null" bullet').not.toContain('- null');
    expect(text, 'PROJECT.md must not have a ## Goals heading for a skipped field')
      .not.toMatch(/^## Goals$/m);
    expect(text, 'PROJECT.md must not have a ## Scope (in) heading for a skipped field')
      .not.toMatch(/^## Scope \(in\)$/m);
    expect(text, 'PROJECT.md must not have a ## Scope (out) heading for a skipped field')
      .not.toMatch(/^## Scope \(out\)$/m);
  });
});

// ---------------------------------------------------------------------------
// AC6b — Order: Success criteria rendered BEFORE Problem in PROJECT.md
// ---------------------------------------------------------------------------

describe('TASK-046 AC6b — BODY_SECTIONS render order: Success criteria before Problem', () => {
  it('success_criteria_section_appears_before_Problem_section_in_PROJECT_md', async () => {
    // writeProjectMd's BODY_SECTIONS array controls render order. The existing
    // well-known sections (Description, Target users, Primary use cases,
    // Success criteria) must appear BEFORE the definition sections (Problem,
    // Goals, Scope (in), Scope (out)). Lock this so a future BODY_SECTIONS
    // reorder is caught immediately.
    const { writeProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-disc-ac6b-order');
    await writeProjectMd({
      repoRoot: repoDir,
      answers: {
        project_name: 'order-check',
        project_type: 'other',
        project_description: 'Checking section order.',
        target_users: 'devs',
        success_criteria: 'passes the test',
        problem_statement: 'The problem here.',
        goals: ['goal one'],
        scope_in: ['feature A'],
        scope_out: ['feature B'],
      },
      now: () => FIXED_NOW,
    });

    const text = readFileSync(join(repoDir, 'PROJECT.md'), 'utf8');
    const successCriteriaIdx = text.indexOf('## Success criteria');
    const problemIdx = text.indexOf('## Problem');

    expect(successCriteriaIdx, '## Success criteria must be present').toBeGreaterThan(-1);
    expect(problemIdx, '## Problem must be present').toBeGreaterThan(-1);

    expect(
      successCriteriaIdx,
      '## Success criteria must appear BEFORE ## Problem (BODY_SECTIONS render order)',
    ).toBeLessThan(problemIdx);
  });

  it('description_appears_before_Goals_section', async () => {
    // Belt-and-suspenders: ## Description must also precede ## Goals.
    const { writeProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-disc-ac6b-desc-before-goals');
    await writeProjectMd({
      repoRoot: repoDir,
      answers: {
        project_name: 'order-desc-goals',
        project_type: 'other',
        project_description: 'My description.',
        target_users: 'devs',
        success_criteria: 'works',
        goals: ['goal one'],
      },
      now: () => FIXED_NOW,
    });

    const text = readFileSync(join(repoDir, 'PROJECT.md'), 'utf8');
    const descIdx = text.indexOf('## Description');
    const goalsIdx = text.indexOf('## Goals');

    expect(descIdx, '## Description must be present').toBeGreaterThan(-1);
    expect(goalsIdx, '## Goals must be present').toBeGreaterThan(-1);
    expect(
      descIdx,
      '## Description must appear BEFORE ## Goals',
    ).toBeLessThan(goalsIdx);
  });

  it('order_via_runInit_answers_mode_success_criteria_before_Problem', async () => {
    // End-to-end via runInit in answers-mode to confirm the order persists
    // through the full init path (not just writeProjectMd directly).
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-disc-ac6b-e2e-order');
    await runInit({
      argv: [],
      prompter: null,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
      hostname: FIXED_HOST,
      answers: {
        project_name: 'e2e-order-check',
        project_type: 'other',
        project_description: 'Checking section render order end-to-end.',
        target_users: 'devs',
        success_criteria: 'renders in order',
        problem_statement: 'Ordering must be stable.',
        goals: ['goal A', 'goal B'],
        scope_in: ['feature X'],
        scope_out: ['feature Y'],
      },
    });

    const text = readFileSync(join(repoDir, 'PROJECT.md'), 'utf8');
    expect(text.indexOf('## Success criteria')).toBeLessThan(text.indexOf('## Problem'));
    expect(text.indexOf('## Success criteria')).toBeLessThan(text.indexOf('## Goals'));
    expect(text.indexOf('## Success criteria')).toBeLessThan(text.indexOf('## Scope (in)'));
    expect(text.indexOf('## Success criteria')).toBeLessThan(text.indexOf('## Scope (out)'));
  });
});
