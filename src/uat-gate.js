// src/uat-gate.js
// TASK-225 — pure logic for the CI gate that promotes TASK-223's board audit
// into a build-blocking check, scoped to only the tickets that ACTUALLY
// needed a UAT verdict and were closed strictly after the frozen baseline
// cutoff (see docs/uat-baseline.md for the cutoff's own justification).
//
// This module does NO disk I/O and defines NO new cutoff date — see
// UAT_BASELINE_CUTOFF_DATE re-exported below (AC6: the cutoff lives in
// exactly one place, src/uat-audit.js; this module reads it, never
// redefines it). bin/ci-uat-gate.js owns reading tasks/*.json.

import { computeUatAuditReport, UAT_BASELINE_CUTOFF_DATE } from './uat-audit.js';
import { requiresUat } from './task-store.js';

export { UAT_BASELINE_CUTOFF_DATE };

/**
 * TASK-225 AC1's scoping rule: "needed a UAT verdict" is the SAME union
 * task-store.js's checkUatGuard enforces at close time — a ticket whose
 * verification_tier is 'uat-only', OR whose requires_uat is true (per
 * requiresUat(), TASK-221's single canonical default-read helper) — not a
 * literal-only reading of the `requires_uat` field. checkUatGuard itself is
 * not exported (it is task-store.js's private close-time guard), so the
 * union's shape is mirrored here rather than duplicated as a second
 * independent rule: the ONLY part re-derived is the trivial
 * `=== 'uat-only'` tier comparison; the requires_uat default itself is
 * always read through requiresUat(), never re-inlined.
 */
export function needsUat(task) {
  return Boolean(task) && (task.verification_tier === 'uat-only' || requiresUat(task));
}

/** Distinguishable gate outcomes — see classifyGateResult below. */
export const GATE_RESULT = Object.freeze({
  ZERO_EXAMINED: 'zero-examined',
  COMPLIANT: 'compliant',
  VIOLATIONS: 'violations',
});

/**
 * Compute the gate's report: the same audit engine as src/uat-audit.js,
 * scoped down to only needsUat() tickets (AC1) via computeUatAuditReport's
 * filterFn hook (TASK-225 addition to that function — one engine, two
 * scopes, not a duplicated audit).
 *
 * @param {{tasks: object[], cutoffDate?: string}} opts see
 *   computeUatAuditReport; cutoffDate defaults to UAT_BASELINE_CUTOFF_DATE
 *   (AC6 — the single source).
 */
export function computeUatGateReport({ tasks, cutoffDate = UAT_BASELINE_CUTOFF_DATE } = {}) {
  return computeUatAuditReport({ tasks, cutoffDate, filterFn: needsUat });
}

/**
 * TASK-225 AC3/AC4 — classify a gate report into exactly one of three
 * mutually-exclusive, distinguishable outcomes:
 *
 *   - ZERO_EXAMINED: post_cutoff_done_count is 0 — no needs-uat ticket has
 *     even been CLOSED after the cutoff yet, so "0 actionable violations"
 *     would otherwise be indistinguishable from "the gate found nothing
 *     wrong" (AC3's empty-result contract; see bin/ci-uat-gate.js's header
 *     for the "why this is not a hard failure" design note, which mirrors
 *     scripts/test-since.mjs's TEST_SINCE_ZERO_SELECTION precedent).
 *   - VIOLATIONS: 1+ post-cutoff needs-uat done ticket is missing a valid
 *     uat verdict — a real, build-blocking regression (AC1).
 *   - COMPLIANT: 1+ post-cutoff needs-uat done ticket was examined and
 *     every one of them carries a valid uat verdict — a genuine, qualified
 *     green, distinct in the output from ZERO_EXAMINED even though both
 *     currently exit 0 (see exitCodeForGateResult).
 *
 * A board-read failure is NOT one of these three — that is a distinct,
 * always-non-zero-exit case handled entirely at the CLI layer
 * (bin/ci-uat-gate.js), never reaching this function (AC4).
 */
export function classifyGateResult(report) {
  if (report.post_cutoff_done_count === 0) return GATE_RESULT.ZERO_EXAMINED;
  if (report.actionable.count > 0) return GATE_RESULT.VIOLATIONS;
  return GATE_RESULT.COMPLIANT;
}

/**
 * TASK-225 exit-code decision (see bin/ci-uat-gate.js's header for the full
 * argument): only VIOLATIONS is a hard build failure. ZERO_EXAMINED and
 * COMPLIANT both exit 0 — the distinction between them is carried in the
 * OUTPUT MARKER (bin/ci-uat-gate.js's formatGateReport), not the exit code,
 * deliberately mirroring scripts/test-since.mjs's TEST_SINCE_ZERO_SELECTION
 * design: a legitimate empty case must never become a chronic red build
 * (alarm fatigue that gets a control disabled — the exact failure mode this
 * ticket's own description names as the reason TASK-223's audit was NOT
 * wired into CI directly on day one).
 */
export function exitCodeForGateResult(result) {
  return result === GATE_RESULT.VIOLATIONS ? 2 : 0;
}
