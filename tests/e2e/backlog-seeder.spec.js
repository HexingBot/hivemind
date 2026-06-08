// tests/backlog-seeder.spec.js
// TASK-014 — src/backlog-seeder.js exposes seedBacklog({repoRoot, answers, now})
// which reads intake answers (specifically primary_use_cases) and mints a small
// starter backlog of `seed`-labeled tickets via createTask. The seeder is
// one-shot per project: if any existing ticket already carries the `seed`
// label, the next invocation is a no-op. bin/init.js calls it after
// generateProjectContext succeeds in the created / forced / resumed branches
// (NOT in already_initialized).
//
// Covers ACs 1-7 from TASK-014.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { PROD, makeRepoSkeleton } from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';
import { makeScriptedPrompter, webSaasAnswers } from '../helpers/scripted-prompter.js';
import { afterAll } from 'vitest';

afterAll(cleanupAll);

const FIXED_NOW = '2026-05-27T12:00:00Z';

// All six values in the primary_use_cases enum from src/question-library.js.
// Kept inline so this spec stays independent of question-library export shape.
const ALL_USE_CASES = [
  'data-entry',
  'reporting',
  'integration',
  'automation',
  'collaboration',
  'other',
];

// Use cases that must declare >=2 templates. `other` is excluded — AC2 says it
// has exactly 1 generic template.
const MULTI_TEMPLATE_USE_CASES = [
  'data-entry',
  'reporting',
  'integration',
  'automation',
  'collaboration',
];

/**
 * Read every TASK-NNN.json file under <repoRoot>/tasks and return the parsed
 * task objects sorted by key ascending. Ignores schema.json / index.json.
 */
function readAllTaskFiles(repoRoot) {
  const dir = join(repoRoot, 'tasks');
  if (!existsSync(dir)) return [];
  const names = readdirSync(dir).filter(
    (n) => /^TASK-\d{3,}\.json$/.test(n),
  );
  return names
    .map((n) => JSON.parse(readFileSync(join(dir, n), 'utf8')))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/**
 * Sorted list of every file in tasks/ (including schema.json / index.json /
 * anything else). Used for the idempotency before/after comparison.
 */
function listTasksDir(repoRoot) {
  const dir = join(repoRoot, 'tasks');
  if (!existsSync(dir)) return [];
  return [...readdirSync(dir)].sort();
}

/**
 * Test convention: a "comment names the use case" iff the comment body
 * contains the use-case slug as a substring (case-sensitive). Documented here
 * so the impl developer can rely on the substring contract — e.g. a body of
 * "Triggered by primary_use_case: data-entry" satisfies the data-entry tag.
 */
function commentNamesUseCase(commentBody, useCase) {
  return typeof commentBody === 'string' && commentBody.includes(useCase);
}

// ===========================================================================
// AC1 — module shape.
// ===========================================================================
describe('AC1 — seedBacklog module shape', () => {
  it('returns_created_array_listing_minted_keys', async () => {
    const { seedBacklog } = await import(PROD.backlogSeeder);

    const repoDir = makeTmpDir('af-seed-shape');
    makeRepoSkeleton(repoDir);

    const result = await seedBacklog({
      repoRoot: repoDir,
      answers: { primary_use_cases: ['data-entry'] },
      now: () => FIXED_NOW,
    });

    expect(result).toBeTruthy();
    expect(typeof result).toBe('object');
    expect(Array.isArray(result.created)).toBe(true);
    // Every minted key must match the TASK-NNN pattern (the seeder must mint
    // via createTask, not invent keys itself).
    for (const key of result.created) {
      expect(key).toMatch(/^TASK-\d{3,}$/);
    }
    // The disk must agree with the returned key list.
    const onDisk = readAllTaskFiles(repoDir).map((t) => t.key).sort();
    const fromResult = [...result.created].sort();
    for (const key of fromResult) {
      expect(onDisk).toContain(key);
    }
  });
});

// ===========================================================================
// AC2 — per-use-case template counts. Each value in the use-case enum
// produces the right number of `seed`-labeled tickets whose opening comment
// names that use case.
// ===========================================================================
describe('AC2 — per-use-case template counts', () => {
  it.each(MULTI_TEMPLATE_USE_CASES)('use_case_%s_emits_at_least_two_templates', async (useCase) => {
    const { seedBacklog } = await import(PROD.backlogSeeder);

    const repoDir = makeTmpDir(`af-seed-uc-${useCase}`);
    makeRepoSkeleton(repoDir);

    await seedBacklog({
      repoRoot: repoDir,
      answers: { primary_use_cases: [useCase] },
      now: () => FIXED_NOW,
    });

    const tasks = readAllTaskFiles(repoDir);
    const useCaseTickets = tasks.filter((t) => {
      if (!Array.isArray(t.comments) || t.comments.length === 0) return false;
      return commentNamesUseCase(t.comments[0].body, useCase);
    });
    expect(
      useCaseTickets.length,
      `use case ${useCase} must produce at least 2 templates`,
    ).toBeGreaterThanOrEqual(2);
  });

  it('use_case_other_emits_exactly_one_template', async () => {
    const { seedBacklog } = await import(PROD.backlogSeeder);

    const repoDir = makeTmpDir('af-seed-uc-other');
    makeRepoSkeleton(repoDir);

    await seedBacklog({
      repoRoot: repoDir,
      answers: { primary_use_cases: ['other'] },
      now: () => FIXED_NOW,
    });

    const tasks = readAllTaskFiles(repoDir);
    const otherTickets = tasks.filter((t) => {
      if (!Array.isArray(t.comments) || t.comments.length === 0) return false;
      return commentNamesUseCase(t.comments[0].body, 'other');
    });
    expect(otherTickets.length).toBe(1);
  });
});

// ===========================================================================
// AC3 — common starter ticket. Independent of use cases, every fresh seed
// produces exactly one ticket from COMMON_TEMPLATES whose opening comment
// author is `backlog-seeder` and whose body contains `common`.
// ===========================================================================
describe('AC3 — common starter ticket', () => {
  it('empty_use_cases_still_emits_exactly_one_common_starter', async () => {
    const { seedBacklog } = await import(PROD.backlogSeeder);

    const repoDir = makeTmpDir('af-seed-common');
    makeRepoSkeleton(repoDir);

    const result = await seedBacklog({
      repoRoot: repoDir,
      answers: { primary_use_cases: [] },
      now: () => FIXED_NOW,
    });

    expect(result.created.length).toBe(1);

    const tasks = readAllTaskFiles(repoDir);
    expect(tasks.length).toBe(1);

    const t = tasks[0];
    expect(Array.isArray(t.labels)).toBe(true);
    expect(t.labels).toContain('seed');

    expect(Array.isArray(t.comments)).toBe(true);
    expect(t.comments.length).toBeGreaterThanOrEqual(1);
    expect(t.comments[0].author).toBe('backlog-seeder');
    expect(t.comments[0].body).toContain('common');
  });
});

// ===========================================================================
// AC4 — every seeded ticket carries the `seed` label and an opening
// backlog-seeder comment that names either the use case or `common`.
// ===========================================================================
describe('AC4 — labels and comments on every seeded ticket', () => {
  it('every_seeded_ticket_has_seed_label_and_backlog_seeder_comment', async () => {
    const { seedBacklog } = await import(PROD.backlogSeeder);

    const repoDir = makeTmpDir('af-seed-labels');
    makeRepoSkeleton(repoDir);

    // Pick a mix: one multi-template use case + the singleton `other`.
    const answers = { primary_use_cases: ['data-entry', 'other'] };
    const result = await seedBacklog({
      repoRoot: repoDir,
      answers,
      now: () => FIXED_NOW,
    });

    expect(result.created.length).toBeGreaterThan(0);

    const tasks = readAllTaskFiles(repoDir);
    expect(tasks.length).toBe(result.created.length);

    for (const t of tasks) {
      expect(
        Array.isArray(t.labels),
        `${t.key}: labels must be an array`,
      ).toBe(true);
      expect(
        t.labels,
        `${t.key}: every seeded ticket must include the literal 'seed' label`,
      ).toContain('seed');

      expect(
        Array.isArray(t.comments),
        `${t.key}: comments must be an array`,
      ).toBe(true);
      expect(
        t.comments.length,
        `${t.key}: comments must be non-empty (opening backlog-seeder comment)`,
      ).toBeGreaterThanOrEqual(1);

      const first = t.comments[0];
      expect(first.author, `${t.key}: first comment author must be backlog-seeder`).toBe(
        'backlog-seeder',
      );

      // Body must either name a known use case or the string 'common'.
      const body = first.body || '';
      const namesAUseCase = ALL_USE_CASES.some((uc) => body.includes(uc));
      const namesCommon = body.includes('common');
      expect(
        namesAUseCase || namesCommon,
        `${t.key}: opening comment body must name a use case or 'common' — got ${JSON.stringify(body)}`,
      ).toBe(true);
    }
  });
});

// ===========================================================================
// AC5 — idempotency. A pre-existing `seed`-labeled ticket short-circuits the
// seeder; a non-seed pre-existing ticket does not.
// ===========================================================================
describe('AC5 — idempotency', () => {
  it('returns_empty_created_when_seed_label_already_present', async () => {
    const { seedBacklog } = await import(PROD.backlogSeeder);

    const repoDir = makeTmpDir('af-seed-idemp-yes');
    makeRepoSkeleton(repoDir, {
      tasks: {
        'TASK-001': {
          key: 'TASK-001',
          title: 'Pre-existing seeded ticket',
          description: 'placed by the fixture to simulate a prior seed run',
          acceptance_criteria: ['Some criterion'],
          status: 'todo',
          priority: 'medium',
          labels: ['seed', 'fixture'],
          assignee: null,
          depends_on: [],
          linked_commits: [],
          linked_prs: [],
          comments: [],
          created_at: '2026-05-27T00:00:00Z',
          updated_at: '2026-05-27T00:00:00Z',
          jira_key: null,
        },
      },
    });

    const before = listTasksDir(repoDir);

    const result = await seedBacklog({
      repoRoot: repoDir,
      answers: { primary_use_cases: ['data-entry', 'reporting'] },
      now: () => FIXED_NOW,
    });

    expect(result.created).toEqual([]);

    const after = listTasksDir(repoDir);
    expect(after).toEqual(before);
  });

  it('proceeds_when_existing_tickets_carry_non_seed_labels', async () => {
    const { seedBacklog } = await import(PROD.backlogSeeder);

    const repoDir = makeTmpDir('af-seed-idemp-no');
    makeRepoSkeleton(repoDir, {
      tasks: {
        'TASK-001': {
          key: 'TASK-001',
          title: 'Pre-existing non-seed ticket',
          description: 'unrelated to the seeder',
          acceptance_criteria: ['Some criterion'],
          status: 'todo',
          priority: 'medium',
          labels: ['other-label'],
          assignee: null,
          depends_on: [],
          linked_commits: [],
          linked_prs: [],
          comments: [],
          created_at: '2026-05-27T00:00:00Z',
          updated_at: '2026-05-27T00:00:00Z',
          jira_key: null,
        },
      },
    });

    const result = await seedBacklog({
      repoRoot: repoDir,
      answers: { primary_use_cases: ['data-entry'] },
      now: () => FIXED_NOW,
    });

    expect(result.created.length).toBeGreaterThan(0);

    // Verify a fresh seeded ticket landed on disk.
    const tasks = readAllTaskFiles(repoDir);
    const seedTickets = tasks.filter(
      (t) => Array.isArray(t.labels) && t.labels.includes('seed'),
    );
    expect(seedTickets.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// AC6 — bin/init.js integration. The seeder runs in `created`, NOT in
// `already_initialized`.
// ===========================================================================
describe('AC6 — bin/init.js integration', () => {
  it('created_branch_invokes_seeder', async () => {
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-seed-init-created');
    const prompter = makeScriptedPrompter(webSaasAnswers());

    const result = await runInit({
      argv: [],
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });

    expect(result.state).toBe('created');

    const tasks = readAllTaskFiles(repoDir);
    const seedTickets = tasks.filter(
      (t) => Array.isArray(t.labels) && t.labels.includes('seed'),
    );
    expect(
      seedTickets.length,
      'init created branch should seed at least one ticket',
    ).toBeGreaterThanOrEqual(1);
  });

  it('already_initialized_branch_does_not_invoke_seeder', async () => {
    const { runInit } = await import(PROD.init);
    const { writeProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-seed-init-existing');
    // Pre-seed PROJECT.md so init takes the already_initialized branch.
    await writeProjectMd({
      repoRoot: repoDir,
      answers: {
        project_name: 'preexisting',
        project_type: 'cli-tool',
        project_description: 'd',
        target_users: 't',
        success_criteria: 's',
      },
      now: () => FIXED_NOW,
    });

    // Snapshot tasks/ before init.
    const before = listTasksDir(repoDir);

    const result = await runInit({
      argv: [],
      prompter: async () => {
        throw new Error('prompter should not be called in already_initialized branch');
      },
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });

    expect(result.state).toBe('already_initialized');

    const tasks = readAllTaskFiles(repoDir);
    const seedTickets = tasks.filter(
      (t) => Array.isArray(t.labels) && t.labels.includes('seed'),
    );
    expect(
      seedTickets.length,
      'already_initialized branch must NOT invoke the seeder',
    ).toBe(0);

    // Belt-and-suspenders: tasks/ contents must match exactly.
    const after = listTasksDir(repoDir);
    expect(after).toEqual(before);
  });
});

// ===========================================================================
// AC7 — primary_use_cases accepts string or array.
// ===========================================================================
describe('AC7 — primary_use_cases string-or-array', () => {
  it('string_form_produces_same_template_set_as_array_form', async () => {
    const { seedBacklog } = await import(PROD.backlogSeeder);

    // Run A: string form.
    const repoA = makeTmpDir('af-seed-str');
    makeRepoSkeleton(repoA);
    const resultA = await seedBacklog({
      repoRoot: repoA,
      answers: { primary_use_cases: 'data-entry' },
      now: () => FIXED_NOW,
    });

    // Run B: array form.
    const repoB = makeTmpDir('af-seed-arr');
    makeRepoSkeleton(repoB);
    const resultB = await seedBacklog({
      repoRoot: repoB,
      answers: { primary_use_cases: ['data-entry'] },
      now: () => FIXED_NOW,
    });

    // Same number of tickets minted.
    expect(resultA.created.length).toBe(resultB.created.length);

    // Compare normalized template fingerprints — title+priority+description
    // sorted to make the comparison ordering-independent.
    const fingerprintsA = readAllTaskFiles(repoA)
      .map((t) => `${t.title}|${t.priority}|${t.description}`)
      .sort();
    const fingerprintsB = readAllTaskFiles(repoB)
      .map((t) => `${t.title}|${t.priority}|${t.description}`)
      .sort();
    expect(fingerprintsA).toEqual(fingerprintsB);
  });
});
