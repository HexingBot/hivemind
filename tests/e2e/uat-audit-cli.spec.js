// tests/e2e/uat-audit-cli.spec.js
// TASK-223 — e2e coverage for the real `bin/audit-uat.js` CLI: spawns the
// entry script as a child process (same convention as
// tests/e2e/new-task-cli.spec.js) against a tmp repo skeleton, so the
// argv/exit-code/stdout wiring itself is under test, not just the pure
// computeUatAuditReport (already covered in tests/uat-audit.spec.js).
//
// TIER: slow (real mkdtemp + process spawn) — belongs under tests/e2e/ per
// vitest.config.js's tier boundary.
//
// AC coverage:
//   AC5 — read-only: mtime + content-hash of every tasks/*.json fixture is
//         compared before/after a real CLI run and must be byte-identical.
//   AC6 — the three distinguishable exit codes (0 qualified, 1 read failure,
//         2 actionable violations found) are each exercised against the
//         real spawned process, not just the in-process pure function.
//
// RED-GREEN EVIDENCE (do not remove — non-vacuity proof):
//   RED: temporarily forced bin/audit-uat.js's exitCodeFor to
//        `return 0;` unconditionally and re-ran this file plus
//        tests/uat-audit.spec.js together — 3 tests failed for the right
//        reason: "actionable violation — real CLI run exits 2" (`expected
//        +0 to be 2`), "AC5 — the audit never modifies tasks/" (same sanity
//        assertion on the exit code), and tests/uat-audit.spec.js's own
//        "exitCodeFor distinguishes the two cases (2 vs 0)". Restored the
//        real ternary immediately after; captured verbatim in the TASK-223
//        hand-off.
//   GREEN: re-ran with the real implementation restored — all 16 tests
//        across both files passed.

import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, statSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { makeRepoSkeleton } from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';
import { REPO_ROOT } from '../helpers/repoRoot.js';

afterAll(cleanupAll);

const CLI = join(REPO_ROOT, 'bin', 'audit-uat.js');

function runCli(args, { cwd }) {
  const cleanEnv = { ...process.env };
  delete cleanEnv.CLAUDE_PROJECT_DIR; // force cwd-based repoRoot resolution, same as new-task-cli.spec.js
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, env: cleanEnv, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function doneTask(key, overrides = {}) {
  return {
    key,
    title: 't',
    description: 'd',
    acceptance_criteria: ['a'],
    status: 'done',
    priority: 'medium',
    labels: [],
    assignee: null,
    depends_on: [],
    linked_commits: [],
    linked_prs: [],
    comments: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    jira_key: null,
    verification_tier: 'tests-after',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// AC6 — state (a): qualified zero (baseline-only, no actionable).
// ---------------------------------------------------------------------------

describe('AC6 state (a) — real CLI run: qualified zero, board read OK', () => {
  it('exits 0 and prints how many were examined/baseline', () => {
    const repoDir = makeTmpDir('af-uat-audit-baseline');
    makeRepoSkeleton(repoDir, {
      tasks: {
        'TASK-001': doneTask('TASK-001', { updated_at: '2026-01-01T00:00:00Z' }),
      },
    });

    const { status, stdout } = runCli([], { cwd: repoDir });
    expect(status).toBe(0);
    expect(stdout).toMatch(/QUALIFIED/);
    expect(stdout).toMatch(/1 done ticket\(s\) examined/);
  });
});

// ---------------------------------------------------------------------------
// AC6 — state (b): zero examined (empty board).
// ---------------------------------------------------------------------------

describe('AC6 state (b) — real CLI run: nothing to examine, distinct from state (a)', () => {
  it('exits 0 and prints a distinct "nothing to examine" message', () => {
    const repoDir = makeTmpDir('af-uat-audit-empty');
    makeRepoSkeleton(repoDir, {}); // tasks/ exists but is empty

    const { status, stdout } = runCli([], { cwd: repoDir });
    expect(status).toBe(0);
    expect(stdout).toMatch(/no done tickets on the board to examine/);
    expect(stdout).not.toMatch(/QUALIFIED/);
  });
});

// ---------------------------------------------------------------------------
// AC6 — state (c): board read failure.
// ---------------------------------------------------------------------------

describe('AC6 state (c) — real CLI run: board read failure exits non-zero, distinguishable from a zero', () => {
  it('a missing tasks/ directory exits 1 with a distinct code, not a qualified zero', () => {
    const repoDir = makeTmpDir('af-uat-audit-noboard');
    mkdirSync(repoDir, { recursive: true }); // no tasks/ subdir at all

    const { status, stdout, stderr } = runCli(['--json'], { cwd: repoDir });
    expect(status).toBe(1);
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, code: 'E_BOARD_READ_FAILURE' });
    expect(stderr).toMatch(/could not read/);
  });
});

// ---------------------------------------------------------------------------
// AC2/AC6 — an actionable (post-cutoff) violation is a distinct, non-zero
// exit from both the qualified-zero and the read-failure cases.
// ---------------------------------------------------------------------------

describe('actionable violation — real CLI run exits 2, distinct from 0 and 1', () => {
  it('a done ticket closed after the cutoff with no uat comment exits 2', () => {
    const repoDir = makeTmpDir('af-uat-audit-actionable');
    makeRepoSkeleton(repoDir, {
      tasks: {
        'TASK-001': doneTask('TASK-001', { updated_at: '2026-01-01T00:00:00Z' }), // baseline
        'TASK-002': doneTask('TASK-002', { updated_at: '2026-09-10T00:00:00Z' }), // actionable
      },
    });

    const { status, stdout } = runCli(['--json'], { cwd: repoDir });
    expect(status).toBe(2);
    const payload = JSON.parse(stdout);
    expect(payload.actionable.count).toBe(1);
    expect(payload.actionable.tickets.map((t) => t.key)).toEqual(['TASK-002']);
    expect(payload.baseline.count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// AC5 — read-only: mtime + content hash of every tasks/*.json fixture is
// unchanged by a real CLI run.
// ---------------------------------------------------------------------------

function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

describe('AC5 — the audit never modifies tasks/', () => {
  it('mtime and content hash of every task file are byte-identical before/after a real run', () => {
    const repoDir = makeTmpDir('af-uat-audit-readonly');
    makeRepoSkeleton(repoDir, {
      tasks: {
        'TASK-001': doneTask('TASK-001', { updated_at: '2026-01-01T00:00:00Z' }),
        'TASK-002': doneTask('TASK-002', { updated_at: '2026-09-10T00:00:00Z' }),
      },
    });

    const files = ['TASK-001.json', 'TASK-002.json'].map((f) => join(repoDir, 'tasks', f));
    const before = files.map((f) => ({ mtimeMs: statSync(f).mtimeMs, hash: hashFile(f) }));

    const { status } = runCli(['--json'], { cwd: repoDir });
    expect(status).toBe(2); // sanity: the run actually happened and found the actionable ticket

    const after = files.map((f) => ({ mtimeMs: statSync(f).mtimeMs, hash: hashFile(f) }));
    expect(after).toEqual(before);
  });
});
