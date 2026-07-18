// tests/e2e/backlog-seeder-plan-ticket.spec.js
// TASK-165 — seedBacklog mints exactly ONE additional 'implementation plan'
// ticket when the captured discovery-first definition (problem_statement /
// goals / scope_in / scope_out — see src/question-library.js COMMON_QUESTIONS
// and bin/init.js#normalizeDefinitionAnswers) is non-empty. The prose is
// passed through VERBATIM (problem_statement) or via a pure join
// (goals/scope_in/scope_out) — no LLM generation, so the seeder stays
// deterministic and fixture-testable (HUMAN SCOPE DECISION, 2026-07-18).
//
// Covers TASK-165 ACs 1-5. Sibling to tests/e2e/backlog-seeder.spec.js and
// tests/e2e/backlog-seeder-hardening.spec.js — this file does not re-prove
// the primary_use_cases-driven contract (AC4 of TASK-165: existing seeding
// stays unchanged), only the new plan-ticket behavior.

import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { PROD, makeRepoSkeleton } from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';

afterAll(cleanupAll);

const FIXED_NOW = '2026-07-18T12:00:00Z';

function readAllTaskFiles(repoRoot) {
  const dir = join(repoRoot, 'tasks');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => /^TASK-\d{3,}\.json$/.test(n))
    .map((n) => JSON.parse(readFileSync(join(dir, n), 'utf8')))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

const PLAN_TITLE = 'Draft an implementation plan against the stated goals/scope';

function findPlanTickets(tasks) {
  return tasks.filter((t) => t.title === PLAN_TITLE);
}

// ===========================================================================
// AC1 — non-empty definition mints exactly one extra plan ticket whose
// description carries problem_statement verbatim and whose acceptance
// criteria reference the stated goals/scope_in.
// ===========================================================================
describe('AC1 — plan ticket minted from non-empty definition', () => {
  it('mints_exactly_one_plan_ticket_embedding_problem_statement_verbatim_and_referencing_goals_scope_in', async () => {
    const { seedBacklog } = await import(PROD.backlogSeeder);

    const repoDir = makeTmpDir('af-seed-plan-full');
    makeRepoSkeleton(repoDir);

    const problemStatement = 'Teams lose context between sessions.';
    const result = await seedBacklog({
      repoRoot: repoDir,
      answers: {
        primary_use_cases: [],
        problem_statement: problemStatement,
        goals: ['ship faster', 'reduce bugs'],
        scope_in: ['auth flow', 'billing'],
        scope_out: ['mobile app'],
      },
      now: () => FIXED_NOW,
    });

    // Baseline (empty use cases) mints exactly 1 common ticket; the plan
    // ticket is exactly one MORE on top of that.
    expect(result.created.length).toBe(2);

    const tasks = readAllTaskFiles(repoDir);
    const planTickets = findPlanTickets(tasks);
    expect(planTickets.length).toBe(1);

    const plan = planTickets[0];
    expect(plan.description).toContain(problemStatement);
    expect(Array.isArray(plan.acceptance_criteria)).toBe(true);
    const acJoined = plan.acceptance_criteria.join(' | ');
    expect(acJoined).toContain('ship faster');
    expect(acJoined).toContain('reduce bugs');
    expect(acJoined).toContain('auth flow');
    expect(acJoined).toContain('billing');

    // Still conforms to the seeder's ticket invariants.
    expect(plan.labels).toContain('seed');
    expect(plan.priority).toBeTruthy();
  });

  it('goals_only_without_problem_statement_still_mints_plan_ticket', async () => {
    const { seedBacklog } = await import(PROD.backlogSeeder);

    const repoDir = makeTmpDir('af-seed-plan-goals-only');
    makeRepoSkeleton(repoDir);

    const result = await seedBacklog({
      repoRoot: repoDir,
      answers: {
        primary_use_cases: [],
        goals: ['launch MVP'],
      },
      now: () => FIXED_NOW,
    });

    expect(result.created.length).toBe(2);

    const tasks = readAllTaskFiles(repoDir);
    const planTickets = findPlanTickets(tasks);
    expect(planTickets.length).toBe(1);
    expect(planTickets[0].acceptance_criteria.join(' | ')).toContain('launch MVP');
  });
});

// ===========================================================================
// AC2 — entire definition empty (no problem_statement, goals, scope_in,
// scope_out) mints NOTHING extra (back-compat with definition-less inits).
// ===========================================================================
describe('AC2 — empty definition mints no plan ticket', () => {
  it('all_four_definition_fields_absent_yields_no_plan_ticket', async () => {
    const { seedBacklog } = await import(PROD.backlogSeeder);

    const repoDir = makeTmpDir('af-seed-plan-empty');
    makeRepoSkeleton(repoDir);

    const result = await seedBacklog({
      repoRoot: repoDir,
      answers: { primary_use_cases: ['data-entry'] },
      now: () => FIXED_NOW,
    });

    // Baseline for data-entry alone: common(1) + data-entry(2) = 3, no plan.
    expect(result.created.length).toBe(3);

    const tasks = readAllTaskFiles(repoDir);
    expect(findPlanTickets(tasks).length).toBe(0);
  });

  it('empty_string_and_empty_array_definition_fields_yield_no_plan_ticket', async () => {
    const { seedBacklog } = await import(PROD.backlogSeeder);

    const repoDir = makeTmpDir('af-seed-plan-blank');
    makeRepoSkeleton(repoDir);

    const result = await seedBacklog({
      repoRoot: repoDir,
      answers: {
        primary_use_cases: [],
        problem_statement: '',
        goals: [],
        scope_in: [],
        scope_out: [],
      },
      now: () => FIXED_NOW,
    });

    expect(result.created.length).toBe(1); // common only
    const tasks = readAllTaskFiles(repoDir);
    expect(findPlanTickets(tasks).length).toBe(0);
  });
});

// ===========================================================================
// AC3 — determinism: identical answers produce a byte-identical plan ticket
// body (title/description/acceptance_criteria/priority/labels), independent
// of the assigned TASK-NNN key.
// ===========================================================================
describe('AC3 — deterministic plan ticket body', () => {
  it('identical_answers_produce_byte_identical_plan_ticket_body', async () => {
    const { seedBacklog } = await import(PROD.backlogSeeder);

    const answers = {
      primary_use_cases: [],
      problem_statement: 'Onboarding takes too long.',
      goals: ['cut onboarding time in half'],
      scope_in: ['signup flow'],
      scope_out: ['billing'],
    };

    const repoA = makeTmpDir('af-seed-plan-det-a');
    makeRepoSkeleton(repoA);
    await seedBacklog({ repoRoot: repoA, answers, now: () => FIXED_NOW });

    const repoB = makeTmpDir('af-seed-plan-det-b');
    makeRepoSkeleton(repoB);
    await seedBacklog({ repoRoot: repoB, answers, now: () => FIXED_NOW });

    const planA = findPlanTickets(readAllTaskFiles(repoA))[0];
    const planB = findPlanTickets(readAllTaskFiles(repoB))[0];

    expect(planA).toBeTruthy();
    expect(planB).toBeTruthy();

    // Strip the non-deterministic/positional `key` field before comparing —
    // everything else must be byte-identical.
    const normalize = (t) => {
      const { key, ...rest } = t;
      return JSON.stringify(rest);
    };
    expect(normalize(planA)).toBe(normalize(planB));
  });
});

// ===========================================================================
// AC4 — existing primary_use_cases-driven seeding is unchanged when combined
// with a non-empty definition: the plan ticket is purely additive.
// ===========================================================================
describe('AC4 — plan ticket is additive to existing use-case seeding', () => {
  it('use_case_and_definition_together_mint_both_independently', async () => {
    const { seedBacklog } = await import(PROD.backlogSeeder);

    const repoDir = makeTmpDir('af-seed-plan-combined');
    makeRepoSkeleton(repoDir);

    const result = await seedBacklog({
      repoRoot: repoDir,
      answers: {
        primary_use_cases: ['data-entry'],
        problem_statement: 'Data entry is manual and error-prone.',
        goals: ['automate validation'],
      },
      now: () => FIXED_NOW,
    });

    // common(1) + data-entry(2) + plan(1) = 4.
    expect(result.created.length).toBe(4);

    const tasks = readAllTaskFiles(repoDir);
    expect(findPlanTickets(tasks).length).toBe(1);

    const dataEntryTickets = tasks.filter((t) => {
      if (!Array.isArray(t.comments) || t.comments.length === 0) return false;
      return typeof t.comments[0].body === 'string' && t.comments[0].body.includes('data-entry');
    });
    expect(dataEntryTickets.length).toBe(2);
  });
});
