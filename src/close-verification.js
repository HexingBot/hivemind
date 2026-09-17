// src/close-verification.js
// TASK-234 (WG-H-020, wargaming 2026-09-16) — "a reader opens the board and
// cannot tell a verified close from an unverified one." This module is the
// mechanical answer: given a done ticket, it reports EXACTLY ONE of three
// values, and never collapses the third into either of the first two.
//
//   'verified'     — this close ran under TASK-234's guards and every signal
//                    they record is present and good: a delivery body carrying
//                    the four blocks with real content, a wargaming record,
//                    no open HIGH finding, and every linked commit resolved to
//                    a real commit.
//   'not-verified' — the ticket IS carrying a close-verification record, and
//                    something in it is wrong (a sha that does not exist, a
//                    delivery body that no longer conforms — e.g. because the
//                    task file was hand-edited after the close).
//   'unverifiable' — cannot be known from the ticket. The ~208 tickets closed
//                    BEFORE this field existed live here permanently, and that
//                    is deliberate (AC7/CU10: historical closes are never
//                    retroactively re-judged, in either direction). So does a
//                    close whose commits git could not resolve, and a close
//                    taken under the documented `[CLOSE-EXCEPTION]` escape
//                    hatch — an exception is not a failure, and it is not a
//                    verification either.
//
// ADVISORY, NOT A GATE — the same decision, for the same reason, as
// bin/audit-reviewer-verdict.js and the MCP layer's linked_commits_verification:
// this module is never imported by src/task-store.js's close path and never
// blocks a close. A consumer project that has no git, or a board full of
// pre-TASK-234 closes, must not lose the ability to close tickets over a signal
// it structurally cannot produce. What DOES block a close lives in
// task-store.js's own checks; this is the READING of what those checks left
// behind.

import { findDeliveryBodyProblems, hasValidWargamingComment } from './task-store.js';
import { COMMIT_STATE } from './commit-existence.js';

export const CLOSE_VERIFICATION_STATUS = {
  VERIFIED: 'verified',
  NOT_VERIFIED: 'not-verified',
  UNVERIFIABLE: 'unverifiable',
};

const CLOSE_EXCEPTION_MARKER = '[CLOSE-EXCEPTION]';

/**
 * Classify ONE task's close. Pure: no I/O, no mutation.
 *
 * @param {object} task a task object as stored in tasks/TASK-*.json
 * @returns {{status: string, reason: string, message: string}}
 */
export function auditCloseVerification(task) {
  const key = (task && task.key) || '<unknown>';
  const comments = Array.isArray(task && task.comments) ? task.comments : [];

  if (!task || task.status !== 'done') {
    return {
      status: CLOSE_VERIFICATION_STATUS.UNVERIFIABLE,
      reason: 'not-closed',
      message: `${key} is not done — there is no close to classify`,
    };
  }

  const record = task.linked_commits_verification;
  if (!record || typeof record !== 'object') {
    return {
      status: CLOSE_VERIFICATION_STATUS.UNVERIFIABLE,
      reason: 'no-close-verification-record',
      message: `${key} carries no linked_commits_verification — it closed before TASK-234's close guards `
        + 'existed (or outside closeTask). Not re-judged retroactively: "cannot know", not "failed".',
    };
  }

  if (comments.some((c) => c && String(c.body || '').includes(CLOSE_EXCEPTION_MARKER))) {
    return {
      status: CLOSE_VERIFICATION_STATUS.UNVERIFIABLE,
      reason: 'closed-under-exception',
      message: `${key} closed through the documented [CLOSE-EXCEPTION] escape hatch, which bypasses the `
        + 'delivery/wargaming checks by design. An exception is neither a verification nor a failure.',
    };
  }

  const commits = Array.isArray(record.commits) ? record.commits : [];
  const notFound = commits.filter((c) => c && c.state === COMMIT_STATE.NOT_FOUND);
  if (notFound.length > 0) {
    return {
      status: CLOSE_VERIFICATION_STATUS.NOT_VERIFIED,
      reason: 'linked-commit-not-found',
      message: `${key} records ${notFound.length} linked commit(s) that do not exist in this repository: `
        + notFound.map((c) => c.sha).join(', '),
    };
  }

  // The closing comment is the LAST comment closeTask appended. Re-checking it
  // here (rather than trusting that the guard ran) is what catches a task file
  // edited by hand after the close — the documented degraded fallback that runs
  // through none of the guards.
  const last = comments.length > 0 ? comments[comments.length - 1] : null;
  const problems = findDeliveryBodyProblems(last ? last.body : '', {
    wargamingSatisfiedByComment: hasValidWargamingComment(task),
  });
  if (problems.length > 0) {
    return {
      status: CLOSE_VERIFICATION_STATUS.NOT_VERIFIED,
      reason: 'delivery-body-incomplete',
      message: `${key}'s closing comment does not carry a conforming delivery: ${problems.join('; ')}`,
    };
  }

  if (commits.length === 0) {
    return {
      status: CLOSE_VERIFICATION_STATUS.UNVERIFIABLE,
      reason: 'no-linked-commits-recorded',
      message: `${key} recorded no linked commits at close, so there is nothing to resolve against the `
        + 'repository — the delivery reads well, the code receipt cannot be checked.',
    };
  }

  const unverifiable = commits.filter((c) => c && c.state === COMMIT_STATE.UNVERIFIABLE);
  if (unverifiable.length > 0) {
    return {
      status: CLOSE_VERIFICATION_STATUS.UNVERIFIABLE,
      reason: `commit-existence-${record.reason || 'unverifiable'}`,
      message: `${key}: git could not resolve ${unverifiable.length} of ${commits.length} linked commit(s) `
        + `(${record.reason || 'git-error'}) — recorded as "cannot know", never as verified.`,
    };
  }

  return {
    status: CLOSE_VERIFICATION_STATUS.VERIFIED,
    reason: 'all-signals-present',
    message: `${key}: delivery blocks complete, wargaming named, ${commits.length} linked commit(s) resolved.`,
  };
}

/**
 * Classify every DONE ticket in `tasks`. Non-done tickets are excluded from
 * the examined set entirely (they are not closes), and the count of what was
 * skipped is reported so an empty examined set is self-describing rather than
 * an unqualified "all good" (CLAUDE.md's Empty-result contract, TASK-192).
 */
export function computeCloseVerificationReport(tasks) {
  const all = Array.isArray(tasks) ? tasks : [];
  const done = all.filter((t) => t && t.status === 'done');
  const results = done.map((task) => ({ key: task.key, ...auditCloseVerification(task) }));
  const byStatus = (status) => results.filter((r) => r.status === status);

  return {
    total_tickets_on_board: all.length,
    examined_count: results.length,
    verified: { count: byStatus(CLOSE_VERIFICATION_STATUS.VERIFIED).length },
    not_verified: {
      count: byStatus(CLOSE_VERIFICATION_STATUS.NOT_VERIFIED).length,
      tickets: byStatus(CLOSE_VERIFICATION_STATUS.NOT_VERIFIED),
    },
    unverifiable: {
      count: byStatus(CLOSE_VERIFICATION_STATUS.UNVERIFIABLE).length,
      tickets: byStatus(CLOSE_VERIFICATION_STATUS.UNVERIFIABLE),
    },
  };
}
