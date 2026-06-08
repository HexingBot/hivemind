// tests/new-task.spec.js
// TASK-002 — createTask programmatic core (lives in src/task-store.js per
// Developer decision (a): single co-located CRUD module; no helper-promotion
// needed for a single in-repo caller).
//
// Acceptance criteria covered (mapping to TASK-002 ACs):
//   AC1 (valid task JSON conforms to schema)
//     - created_task_conforms_to_schema
//     - defaults_applied_when_omitted
//     - created_at_and_updated_at_use_injected_now
//     - rejects_empty_acceptance_criteria
//     - rejects_invalid_priority
//   AC2 (key = highest + 1)
//     - next_key_is_highest_plus_one
//     - next_key_with_three_digit_padding
//     - next_key_in_empty_store
//     - next_key_ignores_non_task_files
//   AC3 (index updated atomically)
//     - index_is_regenerated_and_includes_new_task
//     - writes_go_through_atomic_write

import { describe, it, expect, vi, afterEach, afterAll } from 'vitest';
import {
  readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { PROD, makeRepoSkeleton } from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';

afterAll(cleanupAll);

// ---------------------------------------------------------------------------
// Fixture loader, mirroring tests/task-store.spec.js.
// ---------------------------------------------------------------------------
const __thisDir = dirname(fileURLToPath(import.meta.url));
const __fixturesDir = join(__thisDir, '..', 'fixtures', 'tasks');
// tests/ sits at repo root, so go up one level.
const __repoRoot = join(__thisDir, '..', '..');

function loadFixtureTask(key) {
  return JSON.parse(readFileSync(join(__fixturesDir, `${key}.json`), 'utf8'));
}
function loadFixtureTasks(keys) {
  const out = {};
  for (const k of keys) out[k] = loadFixtureTask(k);
  return out;
}
function readTaskFile(repoDir, key) {
  return JSON.parse(readFileSync(join(repoDir, 'tasks', `${key}.json`), 'utf8'));
}
function readIndex(repoDir) {
  return JSON.parse(readFileSync(join(repoDir, 'tasks', 'index.json'), 'utf8'));
}

// Helper: standard valid args for createTask, with overrides applied.
function validArgs(repoDir, overrides = {}) {
  return {
    repoRoot: repoDir,
    title: 'A brand-new task',
    description: 'Created via createTask().',
    acceptance_criteria: ['Does the thing.', 'Tests pass.'],
    priority: 'medium',
    labels: [],
    depends_on: [],
    now: () => '2026-09-10T12:00:00Z',
    ...overrides,
  };
}

// ===========================================================================
// AC2 — next-key derivation
// ===========================================================================
describe('AC2 — next-key derivation', () => {
  it('next_key_is_highest_plus_one', async () => {
    const { createTask } = await import(PROD.taskStore);

    const repoDir = makeTmpDir('af-nt-next-plus-one');
    // Intentional gap: 101, 102, 104 (no 103). Next must be 105, not 103.
    makeRepoSkeleton(repoDir, {
      tasks: loadFixtureTasks(['TASK-101', 'TASK-102', 'TASK-104']),
    });

    const { key, path } = await createTask(validArgs(repoDir));

    expect(key).toBe('TASK-105');
    expect(path).toBe(join(repoDir, 'tasks', 'TASK-105.json'));
    expect(existsSync(path)).toBe(true);
  });

  it('next_key_with_three_digit_padding', async () => {
    // Confirms the helper increments numerically rather than via string sort.
    // String sort of "999" + 1 would not produce "TASK-1000" — it would
    // produce something like "TASK-99:" or wrap.
    const { createTask } = await import(PROD.taskStore);

    const repoDir = makeTmpDir('af-nt-padding-boundary');
    makeRepoSkeleton(repoDir, {
      tasks: loadFixtureTasks(['TASK-999']),
    });

    const { key } = await createTask(validArgs(repoDir));

    expect(key).toBe('TASK-1000');
    // Filename uses the same 4-digit form — schema allows >=3 digits.
    expect(existsSync(join(repoDir, 'tasks', 'TASK-1000.json'))).toBe(true);
  });

  it('next_key_in_empty_store', async () => {
    const { createTask } = await import(PROD.taskStore);

    const repoDir = makeTmpDir('af-nt-empty');
    makeRepoSkeleton(repoDir, {});

    const { key } = await createTask(validArgs(repoDir));

    expect(key).toBe('TASK-001');
    expect(existsSync(join(repoDir, 'tasks', 'TASK-001.json'))).toBe(true);
  });

  it('next_key_ignores_non_task_files', async () => {
    // Seed task fixtures AND a schema.json + index.json + README.md sibling.
    // Only the TASK-NNN.json files count toward the next-key derivation.
    const { createTask } = await import(PROD.taskStore);

    const repoDir = makeTmpDir('af-nt-ignore-non-task');
    makeRepoSkeleton(repoDir, {
      tasks: loadFixtureTasks(['TASK-101']),
    });
    // Drop in distractors that the helper must ignore.
    writeFileSync(
      join(repoDir, 'tasks', 'schema.json'),
      readFileSync(join(__repoRoot, 'tasks', 'schema.json'), 'utf8'),
      'utf8',
    );
    writeFileSync(
      join(repoDir, 'tasks', 'index.json'),
      JSON.stringify({ generated_at: '2000-01-01T00:00:00Z', tasks: [] }, null, 2),
      'utf8',
    );
    writeFileSync(
      join(repoDir, 'tasks', 'README.md'),
      '# tasks\n\nignore me\n',
      'utf8',
    );

    const { key } = await createTask(validArgs(repoDir));

    // Must derive from TASK-101 only → 102. Not from any digits in
    // schema.json or index.json or some hash of README.md.
    expect(key).toBe('TASK-102');
  });
});

// ===========================================================================
// AC1 — created task is a valid task JSON conforming to the schema
// ===========================================================================
describe('AC1 — created task conforms to schema', () => {
  it('created_task_conforms_to_schema', async () => {
    const { createTask } = await import(PROD.taskStore);

    const repoDir = makeTmpDir('af-nt-schema-conformance');
    makeRepoSkeleton(repoDir, {
      tasks: loadFixtureTasks(['TASK-101']),
    });

    const { key, path } = await createTask(validArgs(repoDir, {
      title: 'Schema-conformant task',
      description: 'Body of the new task.',
      acceptance_criteria: ['AC #1', 'AC #2'],
      priority: 'high',
      labels: ['bootstrap'],
      depends_on: ['TASK-101'],
    }));

    const written = JSON.parse(readFileSync(path, 'utf8'));

    // Load the committed schema and validate.
    const schemaPath = join(__repoRoot, 'tasks', 'schema.json');
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const ok = validate(written);
    expect(
      ok,
      'createTask output failed schema: ' + JSON.stringify(validate.errors, null, 2),
    ).toBe(true);

    // Spot-check required+defaulted fields explicitly so the test fails with a
    // useful message if defaults are wrong.
    expect(written.key).toBe(key);
    expect(written.title).toBe('Schema-conformant task');
    expect(written.description).toBe('Body of the new task.');
    expect(written.acceptance_criteria).toEqual(['AC #1', 'AC #2']);
    expect(written.priority).toBe('high');
    expect(written.status).toBe('todo'); // default
    expect(written.labels).toEqual(['bootstrap']);
    expect(written.depends_on).toEqual(['TASK-101']);
    expect(written.comments).toEqual([]);
    expect(written.linked_commits).toEqual([]);
    expect(written.linked_prs).toEqual([]);
    expect(written.jira_key).toBeNull();
    expect(typeof written.created_at).toBe('string');
    expect(typeof written.updated_at).toBe('string');
  });

  it('created_at_and_updated_at_use_injected_now', async () => {
    const { createTask } = await import(PROD.taskStore);

    const repoDir = makeTmpDir('af-nt-now-injection');
    makeRepoSkeleton(repoDir, {});

    const fixedNow = '2026-12-31T23:59:59Z';
    const { path } = await createTask(validArgs(repoDir, {
      now: () => fixedNow,
    }));

    const written = JSON.parse(readFileSync(path, 'utf8'));
    // Byte-for-byte equality — no reformatting, no offsetting, no rounding.
    expect(written.created_at).toBe(fixedNow);
    expect(written.updated_at).toBe(fixedNow);
  });

  it('defaults_applied_when_omitted', async () => {
    const { createTask } = await import(PROD.taskStore);

    const repoDir = makeTmpDir('af-nt-defaults');
    makeRepoSkeleton(repoDir, {});

    // Minimal call — only the required-by-AC fields. Verifies createTask
    // backfills labels, depends_on, jira_key, status, comments, linked_*.
    const { path } = await createTask({
      repoRoot: repoDir,
      title: 'Minimal task',
      description: 'No labels, no deps, no status provided.',
      acceptance_criteria: ['Only AC.'],
      priority: 'low',
      now: () => '2026-09-10T12:00:00Z',
    });

    const written = JSON.parse(readFileSync(path, 'utf8'));
    expect(written.status).toBe('todo');
    expect(written.labels).toEqual([]);
    expect(written.depends_on).toEqual([]);
    expect(written.jira_key).toBeNull();
    expect(written.comments).toEqual([]);
    expect(written.linked_commits).toEqual([]);
    expect(written.linked_prs).toEqual([]);
  });

  it('rejects_empty_acceptance_criteria', async () => {
    // Schema enforces minItems: 1. createTask should reject BEFORE any
    // disk write so a bad call cannot leave a half-written task or
    // a stale index behind.
    const { createTask } = await import(PROD.taskStore);

    const repoDir = makeTmpDir('af-nt-reject-empty-ac');
    makeRepoSkeleton(repoDir, {
      tasks: loadFixtureTasks(['TASK-101']),
    });
    const beforeFiles = readdirSync(join(repoDir, 'tasks')).sort();

    await expect(
      createTask(validArgs(repoDir, { acceptance_criteria: [] })),
    ).rejects.toThrow(/acceptance_criteria/i);

    // No new file written; no index regenerated.
    const afterFiles = readdirSync(join(repoDir, 'tasks')).sort();
    expect(afterFiles).toEqual(beforeFiles);
  });

  it('rejects_invalid_priority', async () => {
    const { createTask } = await import(PROD.taskStore);

    const repoDir = makeTmpDir('af-nt-reject-bad-priority');
    makeRepoSkeleton(repoDir, {
      tasks: loadFixtureTasks(['TASK-101']),
    });
    const beforeFiles = readdirSync(join(repoDir, 'tasks')).sort();

    await expect(
      createTask(validArgs(repoDir, { priority: 'urgent' })),
    ).rejects.toThrow(/priority/i);

    const afterFiles = readdirSync(join(repoDir, 'tasks')).sort();
    expect(afterFiles).toEqual(beforeFiles);
  });
});

// ===========================================================================
// AC3 — index is updated; combined with the atomic-write assertion below this
//        proves the index is updated atomically (temp + rename).
// ===========================================================================
describe('AC3 — index regeneration', () => {
  it('index_is_regenerated_and_includes_new_task', async () => {
    const { createTask } = await import(PROD.taskStore);

    const repoDir = makeTmpDir('af-nt-index-regen');
    makeRepoSkeleton(repoDir, {
      tasks: loadFixtureTasks(['TASK-101', 'TASK-102']),
    });
    // Seed an obviously-stale index so we can observe it has refreshed.
    const staleGen = '2000-01-01T00:00:00Z';
    writeFileSync(
      join(repoDir, 'tasks', 'index.json'),
      JSON.stringify({
        generated_at: staleGen,
        tasks: [
          { key: 'TASK-101', title: 'stale', status: 'todo', priority: 'high' },
        ],
      }, null, 2),
      'utf8',
    );

    const fixedNow = '2026-09-10T12:00:00Z';
    const { key } = await createTask(validArgs(repoDir, {
      title: 'Brand new',
      priority: 'critical',
      now: () => fixedNow,
    }));
    expect(key).toBe('TASK-103');

    const idx = readIndex(repoDir);
    // generated_at advanced past stale.
    expect(idx.generated_at).not.toBe(staleGen);
    expect(new Date(idx.generated_at).getTime())
      .toBeGreaterThan(new Date(staleGen).getTime());

    // Index lists ALL three tasks now (the two seeded + the new one).
    const idxKeys = idx.tasks.map((t) => t.key).sort();
    expect(idxKeys).toEqual(['TASK-101', 'TASK-102', 'TASK-103']);

    // The new entry reflects the headline fields for the orchestrator.
    const entry = idx.tasks.find((t) => t.key === 'TASK-103');
    expect(entry).toBeDefined();
    expect(entry.title).toBe('Brand new');
    expect(entry.status).toBe('todo');
    expect(entry.priority).toBe('critical');
  });
});

// ===========================================================================
// AC3 — writes flow through src/atomic-write.js. One createTask call mutates
//        TWO files (the new task + the regenerated index). Per the two-phase
//        atomicWriteFiles invariant (max(fsync) < min(rename)), ALL fsyncs
//        for BOTH targets must complete before ANY rename runs.
// ===========================================================================
describe('writes go through src/atomic-write.js', () => {
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

  it('writes_go_through_atomic_write', async () => {
    const fs = await import('node:fs');
    const { createTask } = await import(PROD.taskStore);

    const repoDir = makeTmpDir('af-nt-atomic');
    makeRepoSkeleton(repoDir, {
      tasks: loadFixtureTasks(['TASK-101']),
    });

    // Clear any open/rename calls the fixture seeding emitted so assertions
    // scope only to the production createTask path.
    fs.openSync.mockClear();
    fs.renameSync.mockClear();
    fs.fsyncSync.mockClear();

    const fixedNow = '2026-09-10T12:00:00Z';
    const { key, path } = await createTask(validArgs(repoDir, {
      now: () => fixedNow,
    }));
    expect(key).toBe('TASK-102');

    const taskTarget = path; // .../tasks/TASK-102.json
    const indexTarget = join(repoDir, 'tasks', 'index.json');

    // 1. At least two sibling tmp files were opened with O_CREAT|O_EXCL —
    //    one for the new task file, one for the index.
    const tmpOpens = fs.openSync.mock.calls.filter(
      ([p, flags]) =>
        typeof p === 'string' &&
        p.includes('.tmp.') &&
        typeof flags === 'number' &&
        (flags & fs.constants.O_EXCL) !== 0 &&
        (flags & fs.constants.O_CREAT) !== 0,
    );
    expect(
      tmpOpens.length,
      'expected at least two O_CREAT|O_EXCL opens (task tmp + index tmp)',
    ).toBeGreaterThanOrEqual(2);

    // 2. Two-phase invariant: max(fsync.callOrder) < min(rename.callOrder).
    //    All fsyncs for ALL targets complete before ANY rename begins.
    expect(fs.fsyncSync.mock.invocationCallOrder.length).toBeGreaterThanOrEqual(2);
    expect(fs.renameSync.mock.invocationCallOrder.length).toBeGreaterThanOrEqual(2);
    const lastFsync = Math.max(...fs.fsyncSync.mock.invocationCallOrder);
    const firstRename = Math.min(...fs.renameSync.mock.invocationCallOrder);
    expect(
      lastFsync,
      'two-phase atomic write: every fsync must complete before any rename',
    ).toBeLessThan(firstRename);

    // 3. A rename targeted the new task file (proves task write went through
    //    tmp+rename, not direct writeFileSync).
    const renameToTask = fs.renameSync.mock.calls.find(
      ([src, dst]) =>
        typeof src === 'string' &&
        src.startsWith(taskTarget + '.tmp.') &&
        dst === taskTarget,
    );
    expect(
      renameToTask,
      'expected rename(tmp, TASK-102.json) — task file write must be atomic',
    ).toBeDefined();

    // 4. A rename targeted index.json (proves index write went through
    //    tmp+rename, not direct writeFileSync).
    const renameToIndex = fs.renameSync.mock.calls.find(
      ([src, dst]) =>
        typeof src === 'string' &&
        src.startsWith(indexTarget + '.tmp.') &&
        dst === indexTarget,
    );
    expect(
      renameToIndex,
      'expected rename(tmp, index.json) — index write must be atomic',
    ).toBeDefined();
  });
});
