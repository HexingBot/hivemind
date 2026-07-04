// tests/e2e/create-task-routes.spec.js
// TASK-054 — Regression locks for POST /api/tasks (create-ticket endpoint).
//
// Mutation-path locks (tests-after tier, minimal):
//   1. Valid body → 201, minted key appears in subsequent GET /api/tasks, task file
//      exists on disk with status 'todo', index.json regenerated.
//   2. Invalid priority → 400, NO new task file written, tasks/ dir count unchanged.
//   3. Empty title → 400, NO new task file written, tasks/ dir count unchanged.
//   4. Acceptance-criteria default applied when omitted.
//
// Tmp-repo style — same pattern as tests/e2e/task-board.spec.js.

import {
  describe, it, expect, beforeEach, afterEach,
} from 'vitest';
import {
  mkdtempSync, rmSync, readdirSync, readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createBoardServer } from '../../src/task-board.js';
import { makeRepoSkeleton } from '../helpers/fixtures.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function startServer(repoRoot) {
  return new Promise((resolve, reject) => {
    const server = createBoardServer({ repoRoot });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

/** Count files in tasks/ that match TASK-NNN.json (task files only). */
function countTaskFiles(repoRoot) {
  const dir = join(repoRoot, 'tasks');
  return readdirSync(dir).filter((n) => /^TASK-\d{3,}\.json$/.test(n)).length;
}

/** Read tasks/index.json. */
function readIndex(repoRoot) {
  return JSON.parse(readFileSync(join(repoRoot, 'tasks', 'index.json'), 'utf8'));
}

// ===========================================================================
// Suite setup — fresh empty repo per test.
// ===========================================================================
describe('TASK-054 — POST /api/tasks create-ticket route', () => {
  let repoRoot;
  let server;
  let baseUrl;

  beforeEach(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), 'create-task-spec-'));
    // Empty tasks/ — no pre-seeded tasks.  makeRepoSkeleton creates the dir.
    makeRepoSkeleton(repoRoot, {});
    ({ server, baseUrl } = await startServer(repoRoot));
  });

  afterEach(async () => {
    if (server) await closeServer(server);
    if (repoRoot) rmSync(repoRoot, { recursive: true, force: true });
  });

  // =========================================================================
  // Lock 1 — Valid body → 201 + minted key in GET /api/tasks + disk
  // =========================================================================
  it('valid_body_returns_201_and_task_appears_in_GET_and_on_disk', async () => {
    const countBefore = countTaskFiles(repoRoot);

    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Test ticket from spec',
        description: 'Created by the regression lock.',
        priority: 'medium',
      }),
    });

    expect(res.status, 'valid create must return 201').toBe(201);

    const data = await res.json();
    expect(data.ok, 'response body must have ok: true').toBe(true);
    expect(typeof data.key, 'response must include a minted key string').toBe('string');
    expect(data.key, 'minted key must match TASK-NNN pattern').toMatch(/^TASK-\d{3,}$/);

    // Task file must exist on disk with status 'todo'.
    const taskPath = join(repoRoot, 'tasks', `${data.key}.json`);
    let taskOnDisk;
    try {
      taskOnDisk = JSON.parse(readFileSync(taskPath, 'utf8'));
    } catch {
      expect.fail(`task file ${taskPath} must exist after a successful create`);
    }
    expect(taskOnDisk.status, 'newly created task must have status todo').toBe('todo');
    expect(taskOnDisk.title).toBe('Test ticket from spec');
    expect(taskOnDisk.priority).toBe('medium');

    // Task count must have grown by 1.
    const countAfter = countTaskFiles(repoRoot);
    expect(countAfter, 'tasks/ must gain exactly one new task file').toBe(countBefore + 1);

    // GET /api/tasks must include the minted key.
    const listRes = await fetch(`${baseUrl}/api/tasks`);
    expect(listRes.status).toBe(200);
    const tasks = await listRes.json();
    const found = tasks.find((t) => t.key === data.key);
    expect(found, `minted key ${data.key} must appear in GET /api/tasks`).toBeTruthy();
    expect(found.status).toBe('todo');

    // index.json must be regenerated and include the new task.
    const idx = readIndex(repoRoot);
    const idxEntry = (idx.tasks || []).find((e) => e.key === data.key);
    expect(idxEntry, 'index.json must include the newly minted task').toBeTruthy();
  });

  // =========================================================================
  // Lock 2 — Invalid priority → 400, no partial write, count unchanged
  // =========================================================================
  it('invalid_priority_returns_400_and_no_task_file_written', async () => {
    const countBefore = countTaskFiles(repoRoot);

    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Should not be created',
        description: 'Bad priority.',
        priority: 'urgent',  // not a valid enum value
      }),
    });

    expect(res.status, 'invalid priority must return 400').toBe(400);
    const data = await res.json();
    expect(typeof data.error, '400 body must include an error message').toBe('string');

    // tasks/ dir must not have gained any new file.
    const countAfter = countTaskFiles(repoRoot);
    expect(
      countAfter,
      'tasks/ must be unchanged after a rejected create (no partial task file)',
    ).toBe(countBefore);
  });

  // =========================================================================
  // Lock 3 — Empty title → 400, no partial write, count unchanged
  // =========================================================================
  it('empty_title_returns_400_and_no_task_file_written', async () => {
    const countBefore = countTaskFiles(repoRoot);

    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: '   ',  // whitespace-only
        description: 'No title.',
        priority: 'low',
      }),
    });

    expect(res.status, 'empty title must return 400').toBe(400);
    const data = await res.json();
    expect(typeof data.error).toBe('string');

    const countAfter = countTaskFiles(repoRoot);
    expect(
      countAfter,
      'tasks/ must be unchanged after a rejected create (empty title)',
    ).toBe(countBefore);
  });

  // =========================================================================
  // Lock 4 — AC default applied when acceptance_criteria is absent
  // =========================================================================
  it('acceptance_criteria_default_applied_when_omitted', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Ticket without ACs',
        priority: 'low',
        // no acceptance_criteria field
      }),
    });

    expect(res.status, 'omitting ACs must still succeed with 201').toBe(201);
    const data = await res.json();
    expect(data.key).toMatch(/^TASK-\d{3,}$/);

    const taskPath = join(repoRoot, 'tasks', `${data.key}.json`);
    const taskOnDisk = JSON.parse(readFileSync(taskPath, 'utf8'));
    expect(
      Array.isArray(taskOnDisk.acceptance_criteria),
      'task must have a non-empty acceptance_criteria array on disk',
    ).toBe(true);
    expect(
      taskOnDisk.acceptance_criteria.length,
      'default AC must be applied (array must have at least one entry)',
    ).toBeGreaterThan(0);
  });

  // =========================================================================
  // TASK-087 AC1 — body over the 64KiB cap → 413, no partial task file
  // written. Regression lock: this guard's ONLY coverage lived in the
  // TASK-074 console specs (chat/mode-badge/preview routes shared the same
  // readBody helper); those were deleted along with the console, taking the
  // 413 assertion with them. readBody() throws before touching disk, so the
  // body need not be valid JSON — just oversized.
  // =========================================================================
  it('body_over_64KiB_cap_returns_413_and_no_task_file_written', async () => {
    const countBefore = countTaskFiles(repoRoot);

    const oversizedBody = 'x'.repeat(64 * 1024 + 1024); // > MAX_BODY_BYTES (65536)
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: oversizedBody,
    });

    expect(res.status, 'a body over the 64KiB cap must return 413').toBe(413);
    const data = await res.json();
    expect(typeof data.error, '413 body must include an error message').toBe('string');

    expect(
      countTaskFiles(repoRoot),
      'tasks/ must be unchanged after a 413 rejection',
    ).toBe(countBefore);
  });

  // =========================================================================
  // Guard — Content-Type guard (415) still blocks non-JSON POSTs
  // =========================================================================
  it('POST_without_json_content_type_returns_415', async () => {
    const countBefore = countTaskFiles(repoRoot);

    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'title=foo',
    });

    expect(res.status, 'non-JSON Content-Type must return 415').toBe(415);
    expect(countTaskFiles(repoRoot), 'no task file written after 415').toBe(countBefore);
  });
});
