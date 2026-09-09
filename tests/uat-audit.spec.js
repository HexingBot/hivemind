// tests/uat-audit.spec.js
// TASK-223 — regression locks for the board-audit sensor: which `status:
// "done"` tickets lack a valid UAT verdict, split into a frozen historical
// baseline (closed on/before the cutoff) and actionable violations (closed
// after it).
//
// TIER: fast (tests/*.spec.js). computeUatAuditReport is pure (no disk I/O);
// the live-repo assertion at the bottom reads the repo's own already-on-disk
// tasks/*.json synchronously — same precedent as tests/graph-freshness.spec.js
// and tests/use-case-policy.spec.js. readBoardTasks's failure-path test below
// points at a nonexistent directory (a single failing readdirSync call, no
// writes, no mkdtemp) — not the makeTmpDir/process-spawn shape that belongs
// in tests/e2e/.
//
// AC coverage:
//   AC1 — "verificacion vigente" reuse: computeUatAuditReport is proved to
//         call the SAME hasRecordedUatVerdict task-store.js's checkUatGuard
//         uses (TASK-222's per-AC coverage rule included), not a re-derived
//         copy.
//   AC2 — baseline and actionable are always reported separately, never
//         summed into one number.
//   AC6 — the three distinguishable empty-result states (qualified zero with
//         tickets examined; zero because nothing was examined; a read
//         failure) are each locked.
//   AC7 — one case WITH an actionable (post-cutoff) violation and one
//         WITHOUT, proving the two outputs genuinely differ.
//
// RED-GREEN EVIDENCE (do not remove — non-vacuity proof):
//   RED: temporarily forced computeUatAuditReport's `isActionable` branch to
//        always be `false` (`const isActionable = false;` in
//        src/uat-audit.js) and re-ran this file — the AC7
//        "differ_from_baseline_only_case" test failed with
//        `expected 0 to be 1` (actionable.count), and the AC6
//        "no_actionable_still_says_how_many_were_examined" test's exit-code
//        assertion also failed for the wrong-reason case
//        (exitCodeFor(actionableReport) returned 0 instead of 2). Restored
//        the real comparison immediately after; captured verbatim in the
//        TASK-223 hand-off.
//   GREEN: re-ran with the real implementation restored — all specs in this
//        file passed.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './helpers/repoRoot.js';
import { TASK_FILENAME_RE, hasRecordedUatVerdict } from '../src/task-store.js';
import { computeUatAuditReport, UAT_BASELINE_CUTOFF_DATE } from '../src/uat-audit.js';
import { readBoardTasks, formatReport, exitCodeFor } from '../bin/audit-uat.js';

const CUTOFF = UAT_BASELINE_CUTOFF_DATE;

function doneTask(overrides) {
  return {
    key: 'TASK-000',
    status: 'done',
    verification_tier: 'tests-after',
    acceptance_criteria: ['a'],
    comments: [],
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// AC7 — a post-cutoff case and a pre-cutoff-only case produce genuinely
// different reports.
// ---------------------------------------------------------------------------

describe('AC7 — actionable vs baseline-only reports genuinely differ', () => {
  it('a ticket closed AFTER the cutoff with no uat comment is actionable, not baseline', () => {
    const tasks = [
      doneTask({ key: 'TASK-100', updated_at: '2026-01-01T00:00:00Z' }), // before cutoff
      doneTask({ key: 'TASK-101', updated_at: '2026-09-10T00:00:00Z' }), // after cutoff
    ];
    const report = computeUatAuditReport({ tasks });

    expect(report.baseline.count).toBe(1);
    expect(report.baseline.tickets.map((t) => t.key)).toEqual(['TASK-100']);
    expect(report.actionable.count).toBe(1);
    expect(report.actionable.tickets.map((t) => t.key)).toEqual(['TASK-101']);
    // AC2 — never summed into one number: missing_uat_total is reported
    // separately from (not in place of) the baseline/actionable split.
    expect(report.missing_uat_total).toBe(2);
  });

  it('the same tickets with NO post-cutoff close produce zero actionable — the two outputs differ', () => {
    const tasks = [
      doneTask({ key: 'TASK-100', updated_at: '2026-01-01T00:00:00Z' }),
      doneTask({ key: 'TASK-101', updated_at: '2026-09-09T00:00:00Z' }), // cutoff day itself — still baseline
    ];
    const report = computeUatAuditReport({ tasks });

    expect(report.baseline.count).toBe(2);
    expect(report.actionable.count).toBe(0);
  });

  it('exitCodeFor distinguishes the two cases (2 vs 0)', () => {
    const withActionable = computeUatAuditReport({
      tasks: [doneTask({ key: 'TASK-101', updated_at: '2026-09-10T00:00:00Z' })],
    });
    const withoutActionable = computeUatAuditReport({
      tasks: [doneTask({ key: 'TASK-100', updated_at: '2026-01-01T00:00:00Z' })],
    });
    expect(exitCodeFor(withActionable)).toBe(2);
    expect(exitCodeFor(withoutActionable)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC1 — reuses task-store.js's hasRecordedUatVerdict verbatim (the SAME
// check checkUatGuard enforces, coverage rule included), not a copy.
// ---------------------------------------------------------------------------

describe('AC1 — computeUatAuditReport uses the CURRENT hasRecordedUatVerdict, not a re-derived copy', () => {
  it('a done ticket whose uat comment covers every AC is NOT a finding', () => {
    const task = doneTask({
      key: 'TASK-200',
      acceptance_criteria: ['a', 'b'],
      comments: [{
        author: 'uat',
        at: '2026-01-01T00:00:00Z',
        body: '1. did a\nVerdict: PASS\n2. did b\nVerdict: PASS\nOverall result: PASS',
      }],
    });
    expect(hasRecordedUatVerdict(task)).toBe(true); // sanity: proves the fixture itself is valid
    const report = computeUatAuditReport({ tasks: [task] });
    expect(report.missing_uat_total).toBe(0);
  });

  it('a done ticket whose uat comment covers only SOME ACs is a finding (TASK-222 coverage rule)', () => {
    const task = doneTask({
      key: 'TASK-201',
      acceptance_criteria: ['a', 'b'],
      comments: [{
        author: 'uat',
        at: '2026-01-01T00:00:00Z',
        body: '1. did a\nVerdict: PASS\nOverall result: PASS',
      }],
    });
    expect(hasRecordedUatVerdict(task)).toBe(false); // sanity: proves TASK-222's rule is what flags this
    const report = computeUatAuditReport({ tasks: [task] });
    expect(report.missing_uat_total).toBe(1);
    expect(report.baseline.tickets[0].key).toBe('TASK-201');
  });

  it('by_tier breaks the baseline down by verification_tier, "(none)" for a missing field', () => {
    const tasks = [
      doneTask({ key: 'TASK-300', verification_tier: 'tdd' }),
      doneTask({ key: 'TASK-301', verification_tier: undefined }),
      doneTask({ key: 'TASK-302', verification_tier: 'tests-after' }),
    ];
    const report = computeUatAuditReport({ tasks });
    expect(report.baseline.by_tier).toEqual({ tdd: 1, '(none)': 1, 'tests-after': 1 });
  });
});

// ---------------------------------------------------------------------------
// AC6 — empty-result contract: the three states are distinguishable.
// ---------------------------------------------------------------------------

describe('AC6 — empty-result contract: three distinguishable states', () => {
  it('state (a): a qualified zero — tickets were examined, none actionable', () => {
    const report = computeUatAuditReport({
      tasks: [doneTask({ key: 'TASK-400', updated_at: '2026-01-01T00:00:00Z' })],
    });
    expect(report.examined_done_count).toBe(1);
    expect(report.actionable.count).toBe(0);
    const text = formatReport(report);
    expect(text).toMatch(/QUALIFIED/);
    expect(text).toMatch(/1 done ticket\(s\) examined/);
  });

  it('state (b): zero because nothing was examined at all — distinct message from state (a)', () => {
    const report = computeUatAuditReport({ tasks: [{ key: 'TASK-401', status: 'todo' }] });
    expect(report.examined_done_count).toBe(0);
    const text = formatReport(report);
    expect(text).toMatch(/no done tickets on the board to examine/);
    expect(text).not.toMatch(/QUALIFIED/);
  });

  it('state (c): a board read failure is a distinct code, never a qualified zero', () => {
    expect(() => readBoardTasks(join(REPO_ROOT, 'this-directory-does-not-exist-task-223'))).toThrow(
      /could not read/,
    );
  });

  it('an empty tasks array is state (b), not an exception — the two must not be conflated', () => {
    expect(() => computeUatAuditReport({ tasks: [] })).not.toThrow();
    expect(computeUatAuditReport({ tasks: [] }).examined_done_count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Live-repo sensor (AC1's "corre sobre el board real de este repo", and a
// permanent regression gate for AC6/AC2 going forward): the real board's
// actionable count must stay at 0 — a future non-zero value here IS the
// regression this whole ticket exists to catch.
// ---------------------------------------------------------------------------

function loadAllTasks() {
  const tasksDir = join(REPO_ROOT, 'tasks');
  const files = readdirSync(tasksDir).filter((f) => TASK_FILENAME_RE.test(f));
  return files.map((f) => JSON.parse(readFileSync(join(tasksDir, f), 'utf8')));
}

describe('uat-audit sensor — the real board has zero actionable (post-cutoff) violations', () => {
  it('no_done_ticket_closed_after_the_cutoff_is_missing_a_valid_uat_verdict', () => {
    const report = computeUatAuditReport({ tasks: loadAllTasks() });
    expect(
      report.actionable.tickets.map((t) => t.key),
      `${report.actionable.count} ticket(s) closed after ${CUTOFF} are missing a valid uat `
        + `verdict per the current hasRecordedUatVerdict check — see docs/uat-baseline.md: `
        + JSON.stringify(report.actionable.tickets),
    ).toEqual([]);
  });
});
