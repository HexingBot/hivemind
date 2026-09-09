// tests/e2e/uat-gate-cli.spec.js
// TASK-225 — e2e coverage for the real `bin/ci-uat-gate.js` CLI: spawns the
// entry script as a child process (same convention as
// tests/e2e/uat-audit-cli.spec.js) against a tmp repo skeleton, so the
// argv/exit-code/stdout wiring is under test, not just the pure
// computeUatGateReport (already covered in tests/uat-gate.spec.js).
//
// TIER: slow (real mkdtemp + process spawn) — belongs under tests/e2e/ per
// vitest.config.js's tier boundary.
//
// AC coverage (new-test budget: exactly the three gate outcomes AC5 asks
// for, plus AC4's board-read-failure distinguishability — no more):
//   AC1/AC5 — a real spawned run against a post-cutoff needs-uat violation
//             exits 2.
//   AC3/AC5 — a real spawned run with no post-cutoff needs-uat ticket at all
//             exits 0 with the ZERO_EXAMINED marker, distinct from COMPLIANT.
//   AC4     — a real spawned run against an unreadable board exits 1,
//             distinct from both of the above.
//
// RED-GREEN EVIDENCE (do not remove — non-vacuity proof):
//   RED: temporarily forced bin/ci-uat-gate.js's exitCodeForGateResult call
//        site to always use exit code 0 (edited the process.exitCode
//        assignment in main() to `process.exitCode = 0;` unconditionally)
//        and re-ran this file — the "violation" test failed with
//        `expected +0 to be 2`. Restored the real
//        `exitCodeForGateResult(result)` call immediately after; captured
//        verbatim in the TASK-225 hand-off.
//   GREEN: re-ran with the real implementation restored — all tests in this
//        file passed.

import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { makeRepoSkeleton } from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';
import { REPO_ROOT } from '../helpers/repoRoot.js';

afterAll(cleanupAll);

const CLI = join(REPO_ROOT, 'bin', 'ci-uat-gate.js');

function runCli(args, { cwd }) {
  const cleanEnv = { ...process.env };
  delete cleanEnv.CLAUDE_PROJECT_DIR; // force cwd-based repoRoot resolution, same as uat-audit-cli.spec.js
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
    verification_tier: 'uat-only',
    ...overrides,
  };
}

describe('AC3 — real CLI run: zero-examined (no needs-uat ticket closed after the cutoff)', () => {
  it('exits 0 with the ZERO_EXAMINED marker, not a bare pass', () => {
    const repoDir = makeTmpDir('af-uat-gate-zero');
    makeRepoSkeleton(repoDir, {
      tasks: {
        'TASK-001': doneTask('TASK-001', { updated_at: '2026-01-01T00:00:00Z' }), // pre-cutoff
      },
    });

    const { status, stdout } = runCli([], { cwd: repoDir });
    expect(status).toBe(0);
    expect(stdout).toMatch(/UAT_GATE_ZERO_EXAMINED/);
  });
});

describe('AC1 — real CLI run: a post-cutoff needs-uat violation exits 2', () => {
  it('exits 2 and names the violating ticket', () => {
    const repoDir = makeTmpDir('af-uat-gate-violation');
    makeRepoSkeleton(repoDir, {
      tasks: {
        'TASK-001': doneTask('TASK-001', { updated_at: '2026-09-10T00:00:00Z' }), // post-cutoff, no verdict
      },
    });

    const { status, stdout } = runCli(['--json'], { cwd: repoDir });
    expect(status).toBe(2);
    const payload = JSON.parse(stdout);
    expect(payload.result).toBe('violations');
    expect(payload.actionable.tickets.map((t) => t.key)).toEqual(['TASK-001']);
  });
});

describe('AC3 — real CLI run: compliant (post-cutoff, valid verdict) is distinct from zero-examined', () => {
  it('exits 0 with the COMPLIANT marker, not the ZERO_EXAMINED one', () => {
    const repoDir = makeTmpDir('af-uat-gate-compliant');
    makeRepoSkeleton(repoDir, {
      tasks: {
        'TASK-001': doneTask('TASK-001', {
          updated_at: '2026-09-10T00:00:00Z',
          comments: [{ author: 'uat', at: '2026-09-10T00:00:00Z', body: 'Overall result: PASS' }],
        }),
      },
    });

    const { status, stdout } = runCli([], { cwd: repoDir });
    expect(status).toBe(0);
    expect(stdout).toMatch(/UAT_GATE_COMPLIANT/);
    expect(stdout).not.toMatch(/UAT_GATE_ZERO_EXAMINED/);
  });
});

describe('AC4 — real CLI run: a board read failure exits 1, distinct from 0 and 2', () => {
  it('a missing tasks/ directory exits 1 with E_BOARD_READ_FAILURE', () => {
    const repoDir = makeTmpDir('af-uat-gate-noboard');
    mkdirSync(repoDir, { recursive: true }); // no tasks/ subdir at all

    const { status, stdout, stderr } = runCli(['--json'], { cwd: repoDir });
    expect(status).toBe(1);
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, code: 'E_BOARD_READ_FAILURE' });
    expect(stderr).toMatch(/could not read/);
  });
});
