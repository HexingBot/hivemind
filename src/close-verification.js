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
//
// WG2-M-06 (wargaming 2026-09-17) — NO LONGER PURE, on purpose, for the
// commit-existence half only. The doc comment above this note used to claim
// re-checking the last comment "is what catches a task file edited by hand
// after the close" — true for a hand-edit that BREAKS the delivery body, but
// FALSE for one that FABRICATES `linked_commits_verification` itself: a
// hand-written record claiming `state: 'verified'` for a sha that exists
// nowhere used to be trusted as DATA and reported back as 'verified'. Since
// this module already documents itself as advisory (it can afford git, the
// same reasoning src/mcp-server.js's verifyLinkedCommits and closeTask's own
// commitVerifier seam already rely on), `auditCloseVerification` now
// RE-RESOLVES every sha in `task.linked_commits` (the claimed ground truth,
// not `record.commits`, which could itself carry fabricated extra entries
// with no corresponding linked_commits entry at all) against the repository
// right now, via an injectable `commitVerifier` (defaults to
// verifyCommitExistence). `repoRoot` is required to do this; when it is
// omitted (e.g. a caller with only the task JSON in hand, no working tree to
// check against) the function does NOT fall back to trusting the stored
// record — "cannot re-resolve" is reported as 'unverifiable', never silently
// upgraded to 'verified' by trusting unverified data (the same empty-result
// discipline, TASK-192, this whole module already applies everywhere else).

import { findDeliveryBodyProblems, hasValidWargamingComment } from './task-store.js';
import { verifyCommitExistence, COMMIT_STATE } from './commit-existence.js';

export const CLOSE_VERIFICATION_STATUS = {
  VERIFIED: 'verified',
  NOT_VERIFIED: 'not-verified',
  UNVERIFIABLE: 'unverifiable',
};

const CLOSE_EXCEPTION_MARKER = '[CLOSE-EXCEPTION]';

/**
 * Classify ONE task's close.
 *
 * WG2-M-06 — no longer pure when `repoRoot` is supplied: the commit-existence
 * half re-runs `commitVerifier` (real git by default) against `repoRoot`
 * rather than trusting `task.linked_commits_verification.commits` as stored
 * data. Omitting `repoRoot` is still supported (e.g. a caller with only the
 * task JSON) — it just means the commit-existence half degrades to
 * 'unverifiable' instead of ever reporting 'verified' from unchecked data.
 *
 * @param {object} task a task object as stored in tasks/TASK-*.json
 * @param {object} [opts]
 * @param {string|null} [opts.repoRoot] repo root to re-resolve linked_commits
 *   against. Required to reach a 'verified' outcome; omitted means the
 *   commit-existence half cannot be re-checked and is reported 'unverifiable'.
 * @param {Function} [opts.commitVerifier] injectable verifier, same shape as
 *   closeTask's own seam — `(repoRoot, shas) => { commits: [{sha, state}] }`.
 * @returns {{status: string, reason: string, message: string}}
 */
export function auditCloseVerification(task, { repoRoot = null, commitVerifier = verifyCommitExistence } = {}) {
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

  // WG2-M-06 — the ground truth for WHICH shas to check is task.linked_commits
  // (what the ticket itself claims), never record.commits (a hand-edit could
  // otherwise list fabricated extra 'verified' entries with no corresponding
  // linked_commits entry at all).
  const linkedCommits = Array.isArray(task.linked_commits) ? task.linked_commits : [];
  if (linkedCommits.length === 0) {
    return {
      status: CLOSE_VERIFICATION_STATUS.UNVERIFIABLE,
      reason: 'no-linked-commits-recorded',
      message: `${key} recorded no linked commits at close, so there is nothing to resolve against the `
        + 'repository — the delivery reads well, the code receipt cannot be checked.',
    };
  }

  if (!repoRoot) {
    return {
      status: CLOSE_VERIFICATION_STATUS.UNVERIFIABLE,
      reason: 'cannot-reresolve-without-reporoot',
      message: `${key} has ${linkedCommits.length} linked commit(s), but no repoRoot was supplied to `
        + 're-resolve them against — the stored linked_commits_verification record is a CLAIM, not a fact, '
        + 'and this audit does not trust it as data. Re-run with a repoRoot to get a real verdict.',
    };
  }

  const verification = commitVerifier(repoRoot, linkedCommits);
  const freshCommits = Array.isArray(verification && verification.commits) ? verification.commits : [];
  const notFound = freshCommits.filter((c) => c && c.state === COMMIT_STATE.NOT_FOUND);
  if (notFound.length > 0) {
    return {
      status: CLOSE_VERIFICATION_STATUS.NOT_VERIFIED,
      reason: 'linked-commit-not-found',
      message: `${key} records ${notFound.length} linked commit(s) that do not exist in this repository `
        + `(re-resolved just now, not trusted from the stored record): ${notFound.map((c) => c.sha).join(', ')}`,
    };
  }

  const unverifiable = freshCommits.filter((c) => c && c.state === COMMIT_STATE.UNVERIFIABLE);
  if (unverifiable.length > 0) {
    return {
      status: CLOSE_VERIFICATION_STATUS.UNVERIFIABLE,
      reason: `commit-existence-${(verification && verification.reason) || 'unverifiable'}`,
      message: `${key}: git could not resolve ${unverifiable.length} of ${linkedCommits.length} linked commit(s) `
        + `(${(verification && verification.reason) || 'git-error'}) — recorded as "cannot know", never as verified.`,
    };
  }

  return {
    status: CLOSE_VERIFICATION_STATUS.VERIFIED,
    reason: 'all-signals-present',
    message: `${key}: delivery blocks complete, wargaming named, ${linkedCommits.length} linked commit(s) `
      + 're-resolved just now against the repository.',
  };
}

/**
 * Classify every DONE ticket in `tasks`. Non-done tickets are excluded from
 * the examined set entirely (they are not closes), and the count of what was
 * skipped is reported so an empty examined set is self-describing rather than
 * an unqualified "all good" (CLAUDE.md's Empty-result contract, TASK-192).
 *
 * WG2-M-06 — forwards `repoRoot`/`commitVerifier` to auditCloseVerification so
 * the whole-board report re-resolves commit existence too, rather than
 * trusting each ticket's stored record.
 */
export function computeCloseVerificationReport(tasks, { repoRoot = null, commitVerifier = verifyCommitExistence } = {}) {
  const all = Array.isArray(tasks) ? tasks : [];
  const done = all.filter((t) => t && t.status === 'done');
  const results = done.map((task) => ({ key: task.key, ...auditCloseVerification(task, { repoRoot, commitVerifier }) }));
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
