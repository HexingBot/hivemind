// src/uat-audit.js
// TASK-223 — pure detection logic for the "board audit" sensor: which
// `status: "done"` tickets lack a valid UAT verdict, split into a frozen
// historical baseline (closed on/before the cutoff date) and actionable
// violations (closed after it). See docs/uat-baseline.md for the cutoff's
// full justification and the measured baseline numbers — this module is the
// ONE place the cutoff date lives in code; the doc is the canonical
// explanation, this constant is its machine-readable mirror (AC3: no magic
// date buried unexplained inside the command).
//
// "Valid UAT verdict" reuses task-store.js's hasRecordedUatVerdict — the
// SAME check checkUatGuard enforces at close time (TASK-222's per-AC
// coverage rule included) — rather than re-deriving the rule here. A second
// place of truth for "what counts as a recorded UAT verdict" is exactly the
// defect class this ticket exists to avoid (AC1: "la verificacion vigente").
//
// This module does NO disk I/O — bin/audit-uat.js owns reading tasks/*.json
// (AC5: the audit is read-only, verified at the CLI layer).

import { hasRecordedUatVerdict } from './task-store.js';

// TASK-223 AC3 — the cutoff date: 2026-09-09, the day the baseline was
// measured and the freeze decision was made (see docs/uat-baseline.md for
// the full "why freeze, why this date" justification — not duplicated here
// so there is exactly one place that explanation lives).
export const UAT_BASELINE_CUTOFF_DATE = '2026-09-09';

function tierKeyOf(task) {
  return task && typeof task.verification_tier === 'string' && task.verification_tier
    ? task.verification_tier
    : '(none)';
}

// TASK-223 — "closed date" proxy. The task schema carries no dedicated
// `closed_at` field; `updated_at` is refreshed on every write, and
// task-store.js's closeTask/transitionStatus both bump it on the transition
// to 'done' (CLAUDE.md's close protocol: "refresh updated_at"), so it is the
// best available proxy for "when this ticket closed". Documented here rather
// than silently assumed — see docs/uat-baseline.md's "closed-date proxy" note.
function closedAtOf(task) {
  return typeof task?.updated_at === 'string' ? task.updated_at : null;
}

/**
 * Compute the UAT audit report over an already-loaded list of raw task
 * objects (the caller owns reading tasks/*.json — see bin/audit-uat.js).
 *
 * @param {{tasks: object[], cutoffDate?: string, filterFn?: (task: object) => boolean}} opts
 *   `cutoffDate` is an ISO calendar date (YYYY-MM-DD); defaults to
 *   UAT_BASELINE_CUTOFF_DATE. Injectable so tests can pin a cutoff
 *   independent of the frozen constant without touching the constant
 *   itself. `filterFn` (TASK-225) narrows WHICH `status: "done"` tasks are
 *   examined at all, applied before anything else below — the CLI's
 *   unscoped `audit:uat` command (every done ticket, any tier) passes
 *   nothing and keeps today's behavior unchanged (default: examine every
 *   done ticket); the TASK-225 CI gate (src/uat-gate.js) passes the
 *   checkUatGuard union rule (`verification_tier === 'uat-only' ||
 *   requiresUat(task)`) so it only ever examines tickets that actually
 *   needed a UAT verdict, per this ticket's AC1. One engine, two callers,
 *   two scopes — not a duplicated audit.
 * @returns {{
 *   cutoff_date: string,
 *   total_tickets_on_board: number,
 *   examined_done_count: number,
 *   post_cutoff_done_count: number,
 *   missing_uat_total: number,
 *   baseline: {count: number, by_tier: Record<string, number>, tickets: Array<{key: string, verification_tier: string, updated_at: string|null}>},
 *   actionable: {count: number, tickets: Array<{key: string, verification_tier: string, updated_at: string|null}>},
 * }}
 */
export function computeUatAuditReport({
  tasks,
  cutoffDate = UAT_BASELINE_CUTOFF_DATE,
  filterFn = () => true,
} = {}) {
  const list = Array.isArray(tasks) ? tasks : [];
  const done = list.filter((t) => t && t.status === 'done' && filterFn(t));

  // End-of-day instant for the cutoff CALENDAR date: a ticket closed at any
  // point during the cutoff date itself still counts as baseline (it was
  // closed on the measurement day, not after it) — only a close whose
  // timestamp is strictly later than the end of that day is "after the
  // cutoff" (AC2's "cerrados despues").
  const cutoffInstantMs = Date.parse(`${cutoffDate}T23:59:59.999Z`);

  // Fail-closed instant check shared by both the "is this a finding at all"
  // partition below AND (TASK-225) the raw post-cutoff population count,
  // regardless of whether the task has a valid verdict — a single place for
  // "was this closed after the cutoff", not two independently-drifting
  // copies of the same Date.parse comparison.
  function closedAfterCutoff(task) {
    const closedAtMs = Date.parse(closedAtOf(task) ?? '');
    return Number.isFinite(closedAtMs) && closedAtMs > cutoffInstantMs;
  }

  const baselineTickets = [];
  const actionableTickets = [];
  let postCutoffDoneCount = 0;

  for (const task of done) {
    if (closedAfterCutoff(task)) postCutoffDoneCount += 1;

    if (hasRecordedUatVerdict(task)) continue; // has a valid verdict — not a finding at all

    const closedAt = closedAtOf(task);
    // Undated/unparseable closes fail closed toward the SAFE side (baseline,
    // not actionable) — an audit that can't prove a close happened after the
    // cutoff must never silently promote it to "regression". Real board data
    // never hits this branch (every done ticket has updated_at), but this is
    // the failure-mode this function is answerable for if that ever changes.
    const isActionable = closedAfterCutoff(task);

    const entry = { key: task.key, verification_tier: tierKeyOf(task), updated_at: closedAt };
    (isActionable ? actionableTickets : baselineTickets).push(entry);
  }

  const byTier = {};
  for (const entry of baselineTickets) {
    byTier[entry.verification_tier] = (byTier[entry.verification_tier] || 0) + 1;
  }

  return {
    cutoff_date: cutoffDate,
    total_tickets_on_board: list.length,
    examined_done_count: done.length,
    // TASK-225 — the RAW post-cutoff population among the (possibly
    // filterFn-narrowed) examined set, independent of verdict validity.
    // Needed because "actionable.count === 0" is ambiguous on its own: it is
    // true both when every post-cutoff ticket is compliant AND when there
    // are zero post-cutoff tickets to examine at all — exactly the
    // distinction src/uat-gate.js's empty-result contract depends on.
    post_cutoff_done_count: postCutoffDoneCount,
    missing_uat_total: baselineTickets.length + actionableTickets.length,
    baseline: {
      count: baselineTickets.length,
      by_tier: byTier,
      tickets: baselineTickets,
    },
    actionable: {
      count: actionableTickets.length,
      tickets: actionableTickets,
    },
  };
}
