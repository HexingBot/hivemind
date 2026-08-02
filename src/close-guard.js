// src/close-guard.js
// TASK-082 — the injectable loop-mode close guard: the `closeGuard` seam that
// task-store.js's transitionStatus/closeTask accept and call BEFORE any disk
// write when status === 'done'. task-store.js itself imports nothing from
// this module (or bundle.js/operating-mode.js/loop-auth.js) — the MCP layer
// (src/mcp-server.js) is what imports loopModeCloseGuard and passes it in as
// `closeGuard`, keeping task-store decoupled from session/bundle internals.

import { readPointer } from './pointer.js';
import { readBundleSession } from './bundle.js';
import { getMode } from './operating-mode.js';

/**
 * Thrown when loop mode is active but the human has not granted
 * auto_close_on_green_review. `.code` lets callers distinguish this from any
 * other rejection.
 */
export class LoopCloseGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LoopCloseGuardError';
    this.code = 'LOOP_CLOSE_GUARD_DENIED';
  }
}

/**
 * TASK-099 (R4+R5 guard leg) — thrown when loop mode is active, the ticket
 * being closed is `verification_tier: "uat-only"`, and neither
 * `loop_auth.uat_delegated_to_orchestrator` nor an explicit human verdict
 * marker (see hasExplicitHumanVerdictMarker below) authorizes the close.
 * Distinct `.code` from LoopCloseGuardError so callers can tell Gate 1
 * (auto_close_on_green_review) apart from this Gate 2 (uat delegation) denial.
 */
export class UatDelegationGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UatDelegationGuardError';
    this.code = 'LOOP_UAT_DELEGATION_REQUIRED';
  }
}

/**
 * TASK-108 — thrown by loopModeUatCommentGuard (the write-side seam for
 * append_comment) when loop mode is active, the comment's `author` is
 * `'uat'`, and the active bundle's `loop_auth.uat_delegated_to_orchestrator`
 * is not `true`. Distinct `.code` from both LoopCloseGuardError and
 * UatDelegationGuardError so callers can tell this write-side guard apart
 * from the two read-time close guards.
 */
export class UatCommentGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UatCommentGuardError';
    this.code = 'LOOP_UAT_COMMENT_DENIED';
  }
}

// The SKILL.md UAT-step convention: a step the human verified themselves is
// recorded as a bare "PASS"; a step the Orchestrator verified on the human's
// behalf (only permitted once uat_delegated_to_orchestrator is granted) is
// qualified "— verified by Orchestrator at the human's request".
const DELEGATED_MARKER_RE = /verified by orchestrator at the human'?s request/i;

// SKILL.md's UAT step 3 ("Record the outcome"): the body must list each
// step's verdict, "then state the overall result (PASS or FAIL)" — the
// recorded convention is an "Overall result: PASS|FAIL" line. Anchoring on
// this line (not a bare PASS anywhere in the body) is what TASK-099 review
// M1 requires: a per-step "PASS" inside an otherwise-failing UAT (or a
// "FAIL — but PASS on retry" aside) must not satisfy the marker.
const OVERALL_PASS_RE = /overall result:?\s*pass\b/i;
// TASK-108 (fix-round scope addition, folded in here) — widened from
// /\bfail\b/i so a self-contradictory body ("Step 2 FAILED ... Overall
// result: PASS") cannot satisfy the marker: FAILED/failing/fails are the
// same textual-convention class of gap as this ticket's core write-side
// narrowing, so both land together.
const FAIL_VERDICT_RE = /\bfail(?:ed|ing|s)?\b/i;

// TASK-186 — a token blacklist over prose cannot be made reliable by
// extending the token list (a real failure phrased "Verdict: PASS
// (deferred)" contains no FAIL-family token and still satisfies "Overall
// result: PASS" — that is the exact defect this ticket fixes). The
// structured-verdict path below makes the marker ARITHMETIC over a per-step
// list instead: it activates only when the body carries the literal
// "Verdict:" label — already the real convention in use (see e.g. this
// repo's own TASK-109/112/155/170 uat comments) — and then requires EVERY
// recognized step block to end, once its own whitespace is normalized, with
// exactly "Verdict: PASS" or "Verdict: PASS." (an optional trailing period,
// nothing else). A step whose verdict is qualified ("PASS (deferred)"),
// missing, or explicitly FAIL fails the whole comment closed. Bodies with no
// literal "Verdict:" label anywhere are unaffected — they keep using the
// pre-existing FAIL_VERDICT_RE/OVERALL_PASS_RE token-scan below (the
// documented legacy path; see tests/uat-verdict-marker-compat.spec.js for
// the backward-compat proof against this repo's real tasks/).
const VERDICT_LABEL_PRESENT_RE = /verdict\s*:/i;
const STEP_START_RE = /^(?:step\s*)?\d+[.):]/i;
const OVERALL_LINE_RE = /^overall(?:\s+result)?\s*:/i;
const STRICT_STEP_VERDICT_RE = /verdict\s*:\s*(pass|fail)\.?\s*$/i;

/**
 * Split a uat comment body into logical step blocks for the structured
 * per-step check. A line (after trim) matching STEP_START_RE ("1.", "2)",
 * "Step 3:", ...) starts a new block; every following line up to the next
 * step-start line, the "Overall result:" line, or the end of the body is a
 * continuation of that block (this is what lets a single step's verdict
 * line span several physical lines, e.g. a wrapped Observed: paragraph).
 * Text before the first recognized step-start line (a preamble like "UAT
 * script:") is dropped. If NO step-start line is found at all, the whole
 * body (minus any "Overall result:" line) is treated as a single block —
 * a reasonable fallback for a non-numbered single-verdict comment.
 */
function splitIntoStepBlocks(body) {
  const lines = String(body).split(/\r?\n/);
  const boundaries = [];
  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (STEP_START_RE.test(trimmed)) boundaries.push({ idx, type: 'step' });
    else if (OVERALL_LINE_RE.test(trimmed)) boundaries.push({ idx, type: 'overall' });
  });
  const stepBoundaries = boundaries.filter((b) => b.type === 'step');
  if (stepBoundaries.length === 0) {
    const overall = boundaries.find((b) => b.type === 'overall');
    const end = overall ? overall.idx : lines.length;
    return [lines.slice(0, end).join(' ')];
  }
  return stepBoundaries.map((b) => {
    const next = boundaries.find((other) => other.idx > b.idx);
    const end = next ? next.idx : lines.length;
    return lines.slice(b.idx, end).join(' ');
  });
}

/**
 * TASK-186 AC3 — evaluates the structured per-step verdicts in a body that
 * carries at least one literal "Verdict:" label. Returns true only when
 * EVERY recognized step block cleanly ends with "Verdict: PASS" (no
 * qualifier, no missing label, no FAIL) AND the overall body still passes
 * the legacy FAIL/PASS checks as a defense-in-depth backstop.
 */
function evaluateStructuredStepVerdicts(body) {
  const blocks = splitIntoStepBlocks(body).map((b) => b.replace(/\s+/g, ' ').trim());
  if (blocks.length === 0) return false;
  for (const block of blocks) {
    const m = STRICT_STEP_VERDICT_RE.exec(block);
    if (!m) return false; // unparseable/qualified/ambiguous step — conservative reject
    if (m[1].toLowerCase() === 'fail') return false;
  }
  if (FAIL_VERDICT_RE.test(body)) return false;
  return OVERALL_PASS_RE.test(body);
}

/**
 * TASK-099 Gate 2 (TASK-186 restructure) — a uat-only ticket's `uat` comment
 * carries an "explicit human verdict marker" when its most recent
 * `uat`-authored comment (a) has no orchestrator-delegation phrasing
 * anywhere in the body, and (b) either — for bodies using the structured
 * "Verdict:" convention — every recognized step cleanly records PASS (see
 * evaluateStructuredStepVerdicts), or — for bodies with no such label at all
 * — has no FAIL verdict anywhere and states the overall result as PASS per
 * the SKILL.md recording convention (the pre-TASK-186 legacy path,
 * unchanged). If the comment shows delegated-verification phrasing anywhere,
 * at least one step was recorded as Orchestrator-verified, so the close
 * still requires `uat_delegated_to_orchestrator` to be explicitly granted.
 *
 * This is a textual-convention check, not a cryptographic one: it cannot
 * prove a human actually authored the recorded verdict, only that the
 * comment does not itself claim delegated verification and does not itself
 * record a failure (structured or prose). It narrows — it does not
 * eliminate — the prior hole where ANY comment authored 'uat' satisfied the
 * done-guard regardless of content (see the TASK-099 hand-off for the
 * original residual-limitation note, and the TASK-186 hand-off for why a
 * token blacklist over prose could not be hardened further by extending the
 * token list alone).
 */
export function hasExplicitHumanVerdictMarker(task) {
  const comments = Array.isArray(task && task.comments) ? task.comments : [];
  const uatComments = comments.filter((c) => c && c.author === 'uat');
  if (uatComments.length === 0) return false;
  const last = uatComments[uatComments.length - 1];
  const body = String((last && last.body) || '');
  if (DELEGATED_MARKER_RE.test(body)) return false;
  if (VERDICT_LABEL_PRESENT_RE.test(body)) {
    return evaluateStructuredStepVerdicts(body);
  }
  if (FAIL_VERDICT_RE.test(body)) return false;
  return OVERALL_PASS_RE.test(body);
}

/**
 * Read the active bundle's `loop_auth` object (or `{}` on any missing/corrupt
 * pointer or bundle). Shared by loopModeCloseGuard and loopModeUatCommentGuard
 * so both guards read the exact same source of truth via the same
 * readPointer/readBundleSession primitives operating-mode.js and
 * loop-auth.js already use.
 */
function readLoopAuth(repoRoot) {
  try {
    const pointer = readPointer(repoRoot);
    if (pointer && pointer.active_session_id != null) {
      const bundle = readBundleSession(repoRoot, pointer.active_session_id);
      return (bundle && bundle.loop_auth) || {};
    }
  } catch (_err) {
    // fall through to {}
  }
  return {};
}

/**
 * loopModeCloseGuard({ repoRoot, task, key }) — the closeGuard implementation
 * for autonomous loop mode.
 *
 *   - Reads the operating mode via src/operating-mode.js's getMode, which
 *     already defaults to 'harness' on any missing/corrupt pointer or bundle.
 *   - mode !== 'loop' (including 'harness' or no active session) -> resolves
 *     without throwing (no-op).
 *   - mode === 'loop' -> reads the active bundle's loop_auth directly (the
 *     same readPointer/readBundleSession primitives operating-mode.js and
 *     loop-auth.js already use) and throws LoopCloseGuardError unless
 *     loop_auth.auto_close_on_green_review === true.
 *   - mode === 'loop' && task.verification_tier === 'uat-only' (Gate 2,
 *     TASK-099) -> additionally throws UatDelegationGuardError unless
 *     loop_auth.uat_delegated_to_orchestrator === true OR the ticket's uat
 *     comment carries an explicit human verdict marker.
 */
export async function loopModeCloseGuard({ repoRoot, task }) {
  const mode = await getMode({ repoRoot });
  if (mode !== 'loop') return;

  const loopAuth = readLoopAuth(repoRoot);

  if (loopAuth.auto_close_on_green_review !== true) {
    throw new LoopCloseGuardError(
      'loop mode is active but auto_close_on_green_review has not been granted — cannot close this task automatically',
    );
  }

  if (task && task.verification_tier === 'uat-only') {
    if (loopAuth.uat_delegated_to_orchestrator !== true && !hasExplicitHumanVerdictMarker(task)) {
      throw new UatDelegationGuardError(
        `task ${(task && task.key) || ''} is verification_tier "uat-only" and loop mode is active — `
          + 'closing it requires loop_auth.uat_delegated_to_orchestrator or an explicit human '
          + 'verdict recorded on the uat comment',
      );
    }
  }
}

/**
 * TASK-108 — loopModeUatCommentGuard({ repoRoot, author }): the write-side
 * seam that narrows the uat-comment fabrication channel left open by Gate 2
 * (TASK-099 review MEDIUM-2). append_comment previously accepted
 * author:'uat' from ANY caller regardless of operating mode, so a loop-mode
 * orchestrator could append a convention-format all-PASS uat comment itself
 * and pass Gate 2 with no human involvement.
 *
 *   - Reads the operating mode via getMode (defaults to 'harness' on any
 *     missing/corrupt pointer or bundle).
 *   - mode !== 'loop' (including 'harness' or no active session) -> resolves
 *     without throwing (no-op) REGARDLESS of author — the normal
 *     human-present UAT-recording flow is unaffected.
 *   - mode === 'loop' && author !== 'uat' -> resolves without throwing
 *     (no-op) — only author:'uat' is gated; every other author (orchestrator,
 *     developer, reviewer, ...) writes normally in loop mode.
 *   - mode === 'loop' && author === 'uat' -> throws UatCommentGuardError
 *     unless loop_auth.uat_delegated_to_orchestrator === true (the human-set
 *     delegation grant — the ONLY way to record a uat comment during an
 *     autonomous loop, which keeps the human as the gate).
 *
 * This complements Gate 2's read-time check in loopModeCloseGuard (which
 * inspects the CONTENT of an already-written uat comment at close time)
 * rather than replacing it: this guard closes the write seam itself so an
 * unauthorized loop-mode caller can never get a self-authored uat comment
 * onto disk in the first place.
 */
export async function loopModeUatCommentGuard({ repoRoot, author }) {
  const mode = await getMode({ repoRoot });
  if (mode !== 'loop') return;
  if (author !== 'uat') return;

  const loopAuth = readLoopAuth(repoRoot);
  if (loopAuth.uat_delegated_to_orchestrator !== true) {
    throw new UatCommentGuardError(
      'loop mode is active and this comment is authored "uat" — recording a uat comment during '
        + 'an autonomous loop requires loop_auth.uat_delegated_to_orchestrator to be granted',
    );
  }
}
