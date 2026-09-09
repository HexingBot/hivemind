// tests/uat-gate.spec.js
// TASK-225 — regression locks for the CI gate that scopes TASK-223's board
// audit to a build-blocking check over needs-uat tickets closed after the
// cutoff.
//
// TIER: fast (tests/*.spec.js). computeUatGateReport/classifyGateResult are
// pure (no disk I/O); the live-repo assertion at the bottom reads the
// repo's own already-on-disk tasks/*.json synchronously — same precedent
// as tests/uat-audit.spec.js and tests/graph-freshness.spec.js.
//
// AC coverage (per-ticket new-test budget: one spec group per AC actually
// exercised here, no padding):
//   AC1 — needsUat() scoping mirrors checkUatGuard's union (verification_tier
//         === 'uat-only' OR requiresUat(task)), and a post-cutoff violation
//         within that scope classifies as VIOLATIONS / exit 2.
//   AC2 — the real board's frozen baseline (161-ticket lineage, needs-uat
//         subset) never trips the gate: live-repo sensor asserts
//         actionable.count === 0 today.
//   AC3 — the zero-examined state (post_cutoff_done_count === 0) is
//         DISTINCT from COMPLIANT and exits 0, not a hard failure — AC5's
//         third required output.
//   AC6 — UAT_BASELINE_CUTOFF_DATE is re-exported from src/uat-gate.js, not
//         redefined; the default cutoff used by computeUatGateReport is the
//         same constant.
//
// RED-GREEN EVIDENCE (do not remove — non-vacuity proof):
//   RED: temporarily changed classifyGateResult's VIOLATIONS branch guard
//        from `report.actionable.count > 0` to `false` in src/uat-gate.js
//        and re-ran this file — the AC1 "a post-cutoff needs-uat ticket
//        missing a valid verdict is VIOLATIONS" test failed with
//        `expected 'compliant' to be 'violations'`, and the exit-code
//        assertion failed with `expected 0 to be 2`. Restored the real
//        guard immediately after; captured verbatim in the TASK-225
//        hand-off.
//   GREEN: re-ran with the real implementation restored — all tests in this
//        file passed.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './helpers/repoRoot.js';
import { TASK_FILENAME_RE } from '../src/task-store.js';
import { UAT_BASELINE_CUTOFF_DATE } from '../src/uat-audit.js';
import {
  needsUat,
  computeUatGateReport,
  classifyGateResult,
  exitCodeForGateResult,
  GATE_RESULT,
  UAT_BASELINE_CUTOFF_DATE as GATE_CUTOFF,
} from '../src/uat-gate.js';

const CUTOFF = UAT_BASELINE_CUTOFF_DATE;

function doneTask(overrides) {
  return {
    key: 'TASK-000',
    status: 'done',
    verification_tier: 'uat-only',
    acceptance_criteria: ['a'],
    comments: [],
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// AC6 — single source for the cutoff date.
// ---------------------------------------------------------------------------

describe('AC6 — the cutoff date is read from src/uat-audit.js, not redefined', () => {
  it('src/uat-gate.js re-exports the SAME constant, not a copy', () => {
    expect(GATE_CUTOFF).toBe(CUTOFF);
  });
});

// ---------------------------------------------------------------------------
// AC1 — scoping rule (checkUatGuard's union) and post-cutoff violation.
// ---------------------------------------------------------------------------

describe('AC1 — needsUat() mirrors checkUatGuard\'s union rule', () => {
  it('verification_tier "uat-only" alone triggers needsUat regardless of requires_uat', () => {
    expect(needsUat({ verification_tier: 'uat-only', requires_uat: false })).toBe(true);
  });

  it('requires_uat: true alone triggers needsUat regardless of tier', () => {
    expect(needsUat({ verification_tier: 'tests-after', requires_uat: true })).toBe(true);
  });

  it('neither signal present does NOT trigger needsUat', () => {
    expect(needsUat({ verification_tier: 'tests-after', requires_uat: false })).toBe(false);
    expect(needsUat({ verification_tier: 'tests-after' })).toBe(false);
  });

  it('a post-cutoff needs-uat done ticket with no valid uat verdict is VIOLATIONS, exit 2', () => {
    const tasks = [doneTask({ key: 'TASK-901', updated_at: '2026-09-10T00:00:00Z' })];
    const report = computeUatGateReport({ tasks });
    const result = classifyGateResult(report);
    expect(result).toBe(GATE_RESULT.VIOLATIONS);
    expect(report.actionable.tickets.map((t) => t.key)).toEqual(['TASK-901']);
    expect(exitCodeForGateResult(result)).toBe(2);
  });

  it('a tests-after ticket with requires_uat:true, post-cutoff, missing verdict is ALSO VIOLATIONS', () => {
    const tasks = [doneTask({
      key: 'TASK-902',
      verification_tier: 'tests-after',
      requires_uat: true,
      updated_at: '2026-09-10T00:00:00Z',
    })];
    const result = classifyGateResult(computeUatGateReport({ tasks }));
    expect(result).toBe(GATE_RESULT.VIOLATIONS);
  });

  it('a post-cutoff tests-after ticket with NO requires_uat is never examined at all (out of scope)', () => {
    const tasks = [doneTask({
      key: 'TASK-903',
      verification_tier: 'tests-after',
      requires_uat: false,
      updated_at: '2026-09-10T00:00:00Z',
    })];
    const report = computeUatGateReport({ tasks });
    expect(report.examined_done_count).toBe(0);
    expect(classifyGateResult(report)).toBe(GATE_RESULT.ZERO_EXAMINED);
  });
});

// ---------------------------------------------------------------------------
// AC3/AC5 — the three distinguishable gate outcomes.
// ---------------------------------------------------------------------------

describe('AC3/AC5 — three distinguishable outcomes: zero-examined, compliant, violations', () => {
  it('zero-examined: no needs-uat ticket closed after the cutoff at all — exit 0, distinct from compliant', () => {
    const tasks = [doneTask({ key: 'TASK-910', updated_at: '2026-01-01T00:00:00Z' })]; // pre-cutoff only
    const report = computeUatGateReport({ tasks });
    const result = classifyGateResult(report);
    expect(report.post_cutoff_done_count).toBe(0);
    expect(result).toBe(GATE_RESULT.ZERO_EXAMINED);
    expect(exitCodeForGateResult(result)).toBe(0);
  });

  it('compliant: a post-cutoff needs-uat ticket WITH a valid uat verdict — exit 0, distinct from zero-examined', () => {
    const tasks = [doneTask({
      key: 'TASK-911',
      updated_at: '2026-09-10T00:00:00Z',
      comments: [{ author: 'uat', body: 'Overall result: PASS' }],
    })];
    const report = computeUatGateReport({ tasks });
    const result = classifyGateResult(report);
    expect(report.post_cutoff_done_count).toBe(1);
    expect(report.actionable.count).toBe(0);
    expect(result).toBe(GATE_RESULT.COMPLIANT);
    expect(exitCodeForGateResult(result)).toBe(0);
  });

  it('the three outcomes are mutually exclusive string values', () => {
    expect(new Set(Object.values(GATE_RESULT)).size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// AC2 — the real board's frozen baseline never trips the gate.
// ---------------------------------------------------------------------------

function loadAllTasks() {
  const tasksDir = join(REPO_ROOT, 'tasks');
  const files = readdirSync(tasksDir).filter((f) => TASK_FILENAME_RE.test(f));
  return files.map((f) => JSON.parse(readFileSync(join(tasksDir, f), 'utf8')));
}

describe('uat-gate sensor — the real board never trips the gate (AC2)', () => {
  it('no needs-uat done ticket closed after the cutoff is missing a valid uat verdict', () => {
    const report = computeUatGateReport({ tasks: loadAllTasks() });
    const result = classifyGateResult(report);
    expect(
      result,
      `gate classified as ${result} — actionable: ${JSON.stringify(report.actionable.tickets)}`,
    ).not.toBe(GATE_RESULT.VIOLATIONS);
  });
});
