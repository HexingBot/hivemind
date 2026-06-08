// tests/backlog-seeder-hardening.spec.js
// TASK-017 — hardening pass for src/backlog-seeder.js (follow-ups from the
// TASK-014 reviewer audit + the TASK-009 reviewer's readAllTasksSync filter
// note). This file is a SIBLING to tests/backlog-seeder.spec.js — it does not
// re-prove the AC1-7 contract from TASK-014, only the seven hardening items:
//
//   AC1 — duplicate use-case slugs collapse via `new Set` before the loop.
//   AC2 — CSV-string `primary_use_cases` splits on ',' and trims; both halves
//         contribute their templates. (Design choice: split-CSV in
//         normalizeUseCases, not throw-on-unknown-slug — easier on direct
//         callers and matches the question-engine behavior already.)
//   AC3 — malformed JSON in tasks/ propagates from the idempotency guard
//         (design choice: propagate, not silent-skip — corruption must surface
//         so the user fixes the underlying bytes before more tickets land).
//   AC4 — a source-level comment near the readdirSync read-loop names the
//         order independence (filesystem-dependent order doesn't matter).
//   AC5 — bin/init.js wraps the seedBacklog call in try/catch that prints a
//         user-visible warning to stderr (or console.warn) on failure and
//         re-throws. PROJECT.md and project-context.md are already on disk by
//         the time the seeder runs, so they survive the failure.
//   AC6 — a source-level comment near mintTicket names the sequential-await
//         rationale (atomic-write needs serialization for monotonic keys).
//   AC7 — readAllTasksSync imports TASK_FILENAME_RE from src/task-store.js
//         (DRY) instead of duplicating the looser `.endsWith('.json') && ...`
//         filter.

import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PROD, makeRepoSkeleton } from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';

afterAll(cleanupAll);

const FIXED_NOW = '2026-05-28T12:00:00Z';

const __thisDir = dirname(fileURLToPath(import.meta.url));
const __seederSourcePath = join(__thisDir, '..', '..', 'src', 'backlog-seeder.js');

/**
 * Read every TASK-NNN.json file under <repoRoot>/tasks and return the parsed
 * task objects sorted by key ascending. Matches the helper in the sibling
 * spec — duplicated here so this file stays self-contained.
 */
function readAllTaskFiles(repoRoot) {
  const dir = join(repoRoot, 'tasks');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => /^TASK-\d{3,}\.json$/.test(n))
    .map((n) => JSON.parse(readFileSync(join(dir, n), 'utf8')))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

// ===========================================================================
// AC1 — duplicate use-case slugs collapse via `new Set` before the per-template
// loop. Passing ['data-entry', 'data-entry'] mints each data-entry template
// exactly once (not twice).
// ===========================================================================
describe('AC1 — duplicate use-case slugs collapse', () => {
  it('duplicate_use_cases_emit_each_template_exactly_once', async () => {
    const { seedBacklog } = await import(PROD.backlogSeeder);

    const repoDir = makeTmpDir('af-seed-dup');
    makeRepoSkeleton(repoDir);

    const result = await seedBacklog({
      repoRoot: repoDir,
      answers: { primary_use_cases: ['data-entry', 'data-entry'] },
      now: () => FIXED_NOW,
    });

    const tasks = readAllTaskFiles(repoDir);

    // Filter to the data-entry-tagged tickets (opening comment names the slug).
    const dataEntryTickets = tasks.filter((t) => {
      if (!Array.isArray(t.comments) || t.comments.length === 0) return false;
      return typeof t.comments[0].body === 'string'
        && t.comments[0].body.includes('data-entry');
    });

    // USE_CASE_TEMPLATES['data-entry'] has exactly 2 templates today.
    expect(dataEntryTickets.length).toBe(2);

    // Titles must be unique — duplicates would land as two tickets with the
    // same title. The seeder must collapse the duplicate slug before the
    // template loop, not after.
    const titles = dataEntryTickets.map((t) => t.title).sort();
    const uniqueTitles = [...new Set(titles)];
    expect(titles).toEqual(uniqueTitles);

    // Belt-and-suspenders: total minted count is COMMON (1) + data-entry (2) = 3.
    expect(result.created.length).toBe(3);
  });
});

// ===========================================================================
// AC2 — CSV-string `primary_use_cases` is split on ',' and trimmed inside
// normalizeUseCases. 'data-entry,reporting' must emit BOTH data-entry's
// templates AND reporting's templates (not silently zero, not as the literal
// one-slug 'data-entry,reporting' that fails the lookup).
//
// Design choice locked here: split-CSV in normalizeUseCases (option a from the
// ticket) instead of throw-on-unknown-slug (option b). Easier on direct callers
// and matches the question-engine pre-normalization that the wizard path
// already relies on.
// ===========================================================================
describe('AC2 — CSV string splits into multiple use cases', () => {
  it('csv_string_emits_templates_for_each_split_slug', async () => {
    const { seedBacklog } = await import(PROD.backlogSeeder);

    const repoDir = makeTmpDir('af-seed-csv');
    makeRepoSkeleton(repoDir);

    const result = await seedBacklog({
      repoRoot: repoDir,
      answers: { primary_use_cases: 'data-entry,reporting' },
      now: () => FIXED_NOW,
    });

    expect(result.created.length).toBeGreaterThan(0);

    const tasks = readAllTaskFiles(repoDir);

    const dataEntryTickets = tasks.filter((t) => {
      if (!Array.isArray(t.comments) || t.comments.length === 0) return false;
      return typeof t.comments[0].body === 'string'
        && t.comments[0].body.includes('data-entry');
    });
    const reportingTickets = tasks.filter((t) => {
      if (!Array.isArray(t.comments) || t.comments.length === 0) return false;
      return typeof t.comments[0].body === 'string'
        && t.comments[0].body.includes('reporting');
    });

    expect(
      dataEntryTickets.length,
      'csv split must produce data-entry templates',
    ).toBeGreaterThanOrEqual(2);
    expect(
      reportingTickets.length,
      'csv split must produce reporting templates',
    ).toBeGreaterThanOrEqual(2);
  });

  it('csv_string_with_whitespace_trims_each_slug', async () => {
    const { seedBacklog } = await import(PROD.backlogSeeder);

    const repoDir = makeTmpDir('af-seed-csv-ws');
    makeRepoSkeleton(repoDir);

    // Whitespace around each slug — split-CSV must trim.
    const result = await seedBacklog({
      repoRoot: repoDir,
      answers: { primary_use_cases: ' data-entry , reporting ' },
      now: () => FIXED_NOW,
    });

    expect(result.created.length).toBeGreaterThan(0);

    const tasks = readAllTaskFiles(repoDir);

    const dataEntryTickets = tasks.filter(
      (t) => Array.isArray(t.comments) && t.comments.length > 0
        && t.comments[0].body.includes('data-entry'),
    );
    const reportingTickets = tasks.filter(
      (t) => Array.isArray(t.comments) && t.comments.length > 0
        && t.comments[0].body.includes('reporting'),
    );

    expect(dataEntryTickets.length).toBeGreaterThanOrEqual(2);
    expect(reportingTickets.length).toBeGreaterThanOrEqual(2);
  });
});

// ===========================================================================
// AC3 — malformed JSON in tasks/ surfaces. Idempotency guard's read loop must
// NOT swallow JSON.parse errors. Pre-seed a malformed TASK-NNN.json under the
// filter (TASK-NNN pattern after AC7 lands; the test uses a name that matches
// regardless of the filter — TASK-CORRUPT.json with the strict TASK_FILENAME_RE
// would be excluded, so we use TASK-999.json which matches both the old
// `.endsWith('.json')` AND the new TASK_FILENAME_RE).
//
// Design choice locked here: propagate, not warn-and-skip. The risk of
// silently re-minting duplicates over a corrupted prior seed run outweighs the
// inconvenience of the user having to fix the bytes by hand.
// ===========================================================================
describe('AC3 — malformed JSON propagates from idempotency guard', () => {
  it('corrupt_task_file_throws_even_when_a_seed_labeled_ticket_exists', async () => {
    const { seedBacklog } = await import(PROD.backlogSeeder);

    const repoDir = makeTmpDir('af-seed-corrupt');
    makeRepoSkeleton(repoDir, {
      tasks: {
        // A valid `seed`-labeled prior ticket. Today's seeder reads it, sees
        // the seed label, and short-circuits with `{created: []}` — the
        // corrupt sibling's JSON parse error is swallowed by the try/catch
        // inside readAllTasksSync. After AC3 lands, the corrupt-sibling
        // failure must propagate BEFORE the idempotency check completes.
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

    // Write a malformed TASK-NNN.json sibling. The filename matches both the
    // current `.endsWith('.json') && !== 'index.json'` filter AND the
    // post-AC7 TASK_FILENAME_RE (/^TASK-\d{3,}\.json$/), so the corrupt file
    // is in scope for the read loop either way.
    const corruptPath = join(repoDir, 'tasks', 'TASK-999.json');
    writeFileSync(corruptPath, '{invalid json', 'utf8');

    // Must throw. Today's swallow + early short-circuit hides the corruption
    // entirely (returns {created: []} with no error), so this assertion
    // pinpoints the deliberate behavior change.
    let caught = null;
    try {
      await seedBacklog({
        repoRoot: repoDir,
        answers: { primary_use_cases: ['data-entry'] },
        now: () => FIXED_NOW,
      });
    } catch (err) {
      caught = err;
    }

    expect(
      caught,
      'seedBacklog must throw on malformed task JSON (no silent swallow + short-circuit)',
    ).not.toBeNull();
    expect(caught).toBeInstanceOf(Error);
    // Message must mention JSON or the file name so the user can locate the
    // corruption. Either is acceptable — both are common Node failure surfaces.
    const msg = String(caught.message || '');
    const mentionsJson = /json/i.test(msg);
    const mentionsFile = msg.includes('TASK-999');
    expect(
      mentionsJson || mentionsFile,
      `error must name JSON or the corrupt filename — got ${JSON.stringify(msg)}`,
    ).toBe(true);
  });
});

// ===========================================================================
// AC4 — source-grep: a comment near the readdirSync read-loop names the
// order independence. Filesystem-dependent readdir order (Windows vs POSIX)
// must be called out so the next reader doesn't trace it for three minutes.
// ===========================================================================
describe('AC4 — readdirSync order-independence comment', () => {
  it('source_contains_comment_about_readdir_order_independence', () => {
    const source = readFileSync(__seederSourcePath, 'utf8');
    // Comment must mention readdirSync (or readdir) AND either "order" or
    // "independent" — case-insensitive. The exact phrasing is up to the
    // implementer, but the test pins the intent.
    const pattern = /readdir[a-z]*[\s\S]{0,200}?(order|independent|independence)/i;
    expect(
      pattern.test(source),
      'src/backlog-seeder.js must carry a comment near readdirSync naming the order independence',
    ).toBe(true);
  });
});

// AC5 lives in its own sibling spec file
// (tests/backlog-seeder-hardening-init.spec.js) because the
// `vi.mock('../src/backlog-seeder.js')` factory in that test is hoisted to the
// top of the file and would override the real seeder for every other test in
// this file — collapsing AC1/AC2/AC3 into false-positive failures.

// ===========================================================================
// AC6 — source-grep: a comment near mintTicket (or the await inside the per-
// use-case loop) names the sequential-await rationale. The atomic-write
// monotonic-key derivation requires serialization; a Promise.all() would race
// deriveNextKey and produce duplicate keys.
// ===========================================================================
describe('AC6 — mintTicket sequential-await rationale comment', () => {
  it('source_contains_comment_about_sequential_or_serialized_mint', () => {
    const source = readFileSync(__seederSourcePath, 'utf8');
    // Comment must mention sequential/monotonic/serialize/serialized/await
    // ordering — case-insensitive. Phrasing is the implementer's choice.
    const pattern = /(sequential|monotonic|serializ|atomic[\s\S]{0,40}?(order|await|key))/i;
    expect(
      pattern.test(source),
      'src/backlog-seeder.js must carry a comment near mintTicket naming the sequential-await rationale',
    ).toBe(true);
  });
});

// ===========================================================================
// AC7 — readAllTasksSync uses TASK_FILENAME_RE imported from src/task-store.js
// (DRY). The current loose filter ('.endsWith('.json') && !== 'index.json'
// && !== 'schema.json') must be replaced with the strict regex so the seeder
// and task-store agree on what counts as a task file.
// ===========================================================================
describe('AC7 — readAllTasksSync imports TASK_FILENAME_RE from task-store', () => {
  it('source_imports_task_filename_re_from_task_store', () => {
    const source = readFileSync(__seederSourcePath, 'utf8');
    // Must contain an import line referencing TASK_FILENAME_RE from task-store.
    // Tolerate either named import or aliased import; tolerate either `./task-
    // store.js` or `./task-store` (the project's existing imports use the
    // `.js` extension, but the test stays forgiving).
    const importPattern =
      /import\s*\{[^}]*\bTASK_FILENAME_RE\b[^}]*\}\s*from\s*['"]\.\/task-store(?:\.js)?['"]/;
    expect(
      importPattern.test(source),
      'src/backlog-seeder.js must `import { TASK_FILENAME_RE } from "./task-store.js"`',
    ).toBe(true);
  });

  it('source_does_not_use_loose_endsWith_filter_for_task_files', () => {
    const source = readFileSync(__seederSourcePath, 'utf8');
    // The loose filter pattern from before the fix:
    //   n.endsWith('.json') && n !== 'index.json' && n !== 'schema.json'
    // After the fix, readAllTasksSync should test the filename against
    // TASK_FILENAME_RE directly. Asserting the negative pins the swap.
    const looseFilter = /\.endsWith\(\s*['"]\.json['"]\s*\)[\s\S]{0,120}?index\.json/;
    expect(
      looseFilter.test(source),
      'src/backlog-seeder.js must not retain the loose `.endsWith(.json)` task-file filter',
    ).toBe(false);
  });
});
