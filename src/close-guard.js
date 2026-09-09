// src/close-guard.js
// TASK-082 — the injectable loop-mode close guard: the `closeGuard` seam that
// task-store.js's transitionStatus/closeTask accept and call BEFORE any disk
// write when status === 'done'. TASK-188 (AC3) — task-store.js now imports
// loopModeCloseGuard from this module directly and uses it as the DEFAULT
// closeGuard when a caller omits one (see task-store.js's resolveCloseGuard),
// so the loop-mode guard is enforced even if the MCP layer (src/mcp-server.js,
// which also composes it explicitly) is bypassed entirely. This module still
// imports nothing FROM task-store.js (no cycle) and still does all the actual
// session/bundle reading itself — task-store.js still never inspects
// pointer/bundle state directly, it only calls into this module.

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
// list instead: it requires EVERY recognized step block to end, once its own
// whitespace is normalized, with exactly "Verdict: PASS" or "Verdict: PASS."
// (an optional trailing period, nothing else). A step whose verdict is
// qualified ("PASS (deferred)"), missing, or explicitly FAIL fails the whole
// comment closed.
//
// TASK-186 fix round (HIGH) — the structured convention was previously
// OPT-IN: it activated only when the body happened to carry the literal
// "Verdict:" label ANYWHERE, and a body with none fell straight through to a
// legacy FAIL_VERDICT_RE/body-wide-PASS token-scan, where a real failure
// phrased with bare "PASS"/"PASS (deferred)" tokens and no FAIL-family word
// satisfied the scan and closed the ticket. Whoever WRITES the comment could
// bypass the fix simply by omitting one word. The structured convention is
// now MANDATORY for this marker — evaluateStructuredStepVerdicts is always
// the check (see hasExplicitHumanVerdictMarker below); there is no more
// label-free fallback in loop mode.
//
// TASK-186 fix round (third round) — round 1 (this comment block) and round 2
// (the parseUatBody doc comment below) each closed a REGION where a real
// failure could hide, by rejecting that specific region: a blocklist
// strategy. It kept losing — round 2's own fix (require no non-whitespace
// text outside the recognized step blocks and the overall-result line) found
// the SAME failure-in-prose defect reappear a third time, on the
// "Overall result:" line itself (probes E1/E2): that line was exempted
// WHOLESALE from the "text outside step blocks" rejection, and the only
// content check applied to it was a body-wide substring match
// (the now-removed OVERALL_PASS_RE) that tolerated arbitrary trailing prose
// after "PASS". Rather than patch a fourth region when one is inevitably
// found next, the accepted body is now defined as a strict ALLOWLIST
// GRAMMAR, and a body is accepted only when it parses as exactly that
// grammar in full:
//
//     <body> ::= <step-block>+ <overall-line>
//
// where:
//   <step-block>   a recognized step (STEP_START_RE) whose own text, once
//                  whitespace-normalized, ends with EXACTLY "Verdict: PASS"
//                  or "Verdict: PASS." (STRICT_STEP_VERDICT_RE, anchored at
//                  the end) — no qualifier, no missing label, no FAIL;
//   <overall-line> a single physical line whose own text, once
//                  whitespace-normalized, IS EXACTLY "Overall result: PASS"
//                  or "Overall: PASS" (optional trailing period)
//                  (STRICT_OVERALL_RE, anchored at BOTH ends) — no trailing
//                  prose, no qualifier;
//   the `+`        at least as many step blocks as the task has acceptance
//                  criteria (see evaluateStructuredStepVerdicts) — a floor
//                  on count, not a coverage proof (see that function's doc
//                  comment for the distinction);
// and nothing else is permitted ANYWHERE in the body: no preamble before the
// first step, no non-whitespace text between step blocks (any such text is
// absorbed into the preceding block's own text and must still let that block
// end cleanly per STRICT_STEP_VERDICT_RE), and no text after the overall
// line. Every component of the grammar is now strict — there is no longer a
// wholesale-exempted region left for a failure to hide behind (that is what
// made the overall line a hole: it was the one component still checked with
// a loose, unanchored, body-wide rule instead of the grammar's own strict
// rule). FAIL_VERDICT_RE remains in use ONLY as defense-in-depth inside
// evaluateStructuredStepVerdicts, checked over the whole body in addition to
// (not instead of) the grammar above — see that function for why prose
// INSIDE an otherwise-clean step block is the one thing this grammar cannot
// see through (it is not exempted from the grammar, it is a limit of what a
// textual convention check can prove about a block's own content).
//
// Corpus-safety (see tests/uat-verdict-marker-compat.spec.js): of this
// repo's own 45 real tickets carrying a uat comment, exactly ONE
// (TASK-133) used the now-removed label-free legacy path — and it is
// already `status: "done"`. hasExplicitHumanVerdictMarker/loopModeCloseGuard
// only ever run at close time, and a closed ticket is never re-gated, so
// this is the sole documented, zero-effect exception to the "no retroactive
// invalidation" backward-compat proof (see that spec's fix-round amendment
// comment for the full reasoning). Every fix round since (preamble/postscript
// evasion, padded step count, and now the strict overall-line grammar) is
// ALSO corpus-safe for a stronger reason: hasExplicitHumanVerdictMarker
// already evaluates false for all 45 real tickets under the first fix
// round's mandatory-"Verdict:"-label rule (their bodies use conventions like
// "Verdict = PASS" or "STEP 1 (...)" that the strict per-step regex already
// rejected), so tightening it further cannot flip any of them from true to
// false — there is nothing left to flip.
// TASK-222 — capturing group added (was `\d+`, non-capturing) so callers can
// recover a recognized step block's OWN label number, not just detect that a
// line starts one. `.test()` call sites are unaffected by adding a group.
const STEP_START_RE = /^(?:step\s*)?(\d+)[.):]/i;
const OVERALL_LINE_RE = /^overall(?:\s+result)?\s*:/i;
const STRICT_STEP_VERDICT_RE = /verdict\s*:\s*(pass|fail)\.?\s*$/i;
// TASK-186 fix round (third round) — the <overall-line> half of the grammar
// above. Anchored at BOTH ends (unlike OVERALL_LINE_RE, which only anchors
// the head, used solely to LOCATE which physical line is the overall line —
// see parseUatBody), so trailing prose after "PASS" fails the match instead
// of being silently accepted as a substring hit. This is what closes E1
// ("Overall result: PASS — however the xlsx export crashed ... deferring.")
// and E2 ("Overall result: PASS (deferred — xlsx crashed, no file
// produced)") — both clean step blocks, both a body-wide-substring "PASS"
// hit under the old OVERALL_PASS_RE, both rejected here because the overall
// line's own text does not end at "pass" (or "pass.").
const STRICT_OVERALL_RE = /^overall(?:\s+result)?\s*:\s*pass\.?$/i;

/**
 * Parse a uat comment body into the pieces the <body> ::= <step-block>+
 * <overall-line> grammar (see the STRICT_OVERALL_RE comment block above)
 * needs to be checked in full. A line (after trim) matching STEP_START_RE
 * ("1.", "2)", "Step 3:", ...) starts a new step block; every following line
 * up to the next step-start line, the "Overall result:" line, or the end of
 * the body is a continuation of that block (this is what lets a single
 * step's verdict line span several physical lines, e.g. a wrapped Observed:
 * paragraph). If NO step-start line is found at all, the whole body (minus
 * any "Overall result:" line) is treated as a single block — a reasonable
 * fallback for a non-numbered single-verdict comment.
 *
 * TASK-186 fix round (HIGH, second round) — text OUTSIDE those step blocks (a
 * preamble before the first recognized step, or a postscript after the
 * "Overall result:" line) used to be silently dropped, which was the exact
 * defect: a real failure disclosed only in that discarded text was invisible
 * to the per-step check and satisfied the marker via the FAIL-token backstop
 * alone. `extraneousText` now surfaces that discarded text (trimmed,
 * newline-joined) so evaluateStructuredStepVerdicts can reject it outright
 * instead of dropping it. `recognizedStepCount` is the number of step-start
 * lines actually recognized (0 in the no-step-lines fallback) — see
 * evaluateStructuredStepVerdicts for how this pairs with `blocks.length` in
 * the AC-count floor check.
 *
 * TASK-186 fix round (third round) — `overallLine` returns the RAW (trimmed,
 * un-normalized-whitespace) text of the single physical line that matched
 * OVERALL_LINE_RE (`null` when no such line exists), so
 * evaluateStructuredStepVerdicts can hold it to the grammar's own
 * <overall-line> rule (STRICT_OVERALL_RE, anchored at both ends) instead of
 * the old body-wide substring test. Note this line's own text is captured
 * ONLY as that one physical line — any further physical lines after it are
 * still swept into `extraneousText` (postscript) exactly as round 2 already
 * did, so a multi-line "overall" statement is rejected the same way a
 * postscript is: the grammar's <overall-line> is, by construction, a single
 * self-contained line.
 *
 * TASK-222 — `stepNumbers` is a new array, parallel to `blocks` (one entry
 * per recognized step block, in order), holding each block's OWN label
 * number as captured by STEP_START_RE's group (`"1."` -> 1, `"Step 2:"` -> 2,
 * ...). This is what lets evaluateStructuredStepVerdicts (loop mode) and
 * task-store.js's hasRecordedUatVerdict (harness mode) both check DISTINCT
 * numeric coverage of 1..N instead of a bare block-count floor — closing the
 * duplicate-numbering evasion (two blocks both labelled "1." satisfying a
 * 2-AC floor with only one AC actually addressed). In the no-recognized-step
 * fallback (`stepBoundaries.length === 0`), `stepNumbers` is `[1]` — an
 * implicit label for the single whole-body block, matching this function's
 * own pre-existing documented intent ("a reasonable fallback for a
 * non-numbered single-verdict comment") for the 1-AC case; `recognizedStepCount`
 * stays `0` in that branch (unchanged) so callers can still tell "genuinely
 * no numbered structure" apart from "one block, explicitly labelled 1".
 */
export function parseUatBody(body) {
  const lines = String(body).split(/\r?\n/);
  const boundaries = [];
  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    const stepMatch = STEP_START_RE.exec(trimmed);
    if (stepMatch) boundaries.push({ idx, type: 'step', num: Number(stepMatch[1]) });
    else if (OVERALL_LINE_RE.test(trimmed)) boundaries.push({ idx, type: 'overall' });
  });
  const stepBoundaries = boundaries.filter((b) => b.type === 'step');
  const overallBoundary = boundaries.find((b) => b.type === 'overall');
  const overallLine = overallBoundary ? lines[overallBoundary.idx].trim() : null;

  if (stepBoundaries.length === 0) {
    const end = overallBoundary ? overallBoundary.idx : lines.length;
    const afterOverall = overallBoundary ? lines.slice(overallBoundary.idx + 1).join('\n') : '';
    return {
      blocks: [lines.slice(0, end).join(' ')],
      recognizedStepCount: 0,
      extraneousText: afterOverall.trim(),
      overallLine,
      stepNumbers: [1],
    };
  }

  const blocks = stepBoundaries.map((b) => {
    const next = boundaries.find((other) => other.idx > b.idx);
    const end = next ? next.idx : lines.length;
    return lines.slice(b.idx, end).join(' ');
  });
  const preamble = lines.slice(0, stepBoundaries[0].idx).join('\n');
  const postscript = overallBoundary ? lines.slice(overallBoundary.idx + 1).join('\n') : '';

  return {
    blocks,
    recognizedStepCount: stepBoundaries.length,
    extraneousText: [preamble, postscript].filter((s) => s.trim() !== '').join('\n'),
    overallLine,
    stepNumbers: stepBoundaries.map((b) => b.num),
  };
}

/**
 * TASK-222 (AC5) — the shared numeric-coverage primitive both
 * evaluateStructuredStepVerdicts (loop mode) and task-store.js's
 * hasRecordedUatVerdict (harness mode) call: true iff every integer from 1 to
 * `requiredStepCount` appears at least once among `stepNumbers` (a block's
 * OWN label number, from parseUatBody). This is a strictly stronger check
 * than counting blocks (`stepNumbers.length >= requiredStepCount`), which is
 * what the pre-TASK-222 code did and which is exactly what let duplicate
 * numbering (two blocks both labelled "1.") satisfy a 2-AC floor with only
 * one AC actually addressed — two blocks both labelled "1." produce
 * `stepNumbers = [1, 1]`, `distinct = {1}`, which does NOT cover `{1, 2}`.
 * `requiredStepCount` <= 0 or non-numeric means "nothing to require" (true) —
 * matches the pre-existing floor check's behavior for a task with no
 * acceptance_criteria recorded.
 *
 * HONEST RESIDUAL (unchanged by this ticket, stated here so it is not
 * confused with what this DOES fix): this ties each covered AC INDEX to at
 * least one step block's OWN label, not to that block's CONTENT — nothing
 * here proves block "3." is actually ABOUT acceptance criterion 3, only that
 * some block claims to be. A relabelled-but-content-mismatched block (e.g.
 * block "3." actually describing AC1's scenario) still satisfies this check.
 * Closing that would require semantic matching (LLM judgment or an explicit
 * AC-reference syntax), a materially different and heavier mechanism this
 * ticket does not add — see this file's module-level TASK-186 fix-round
 * comments for the general reason a textual-convention check cannot prove
 * meaning, only structure.
 */
export function coversAllStepNumbers(stepNumbers, requiredStepCount) {
  if (typeof requiredStepCount !== 'number' || requiredStepCount <= 0) return true;
  const distinct = new Set(Array.isArray(stepNumbers) ? stepNumbers : []);
  for (let n = 1; n <= requiredStepCount; n += 1) {
    if (!distinct.has(n)) return false;
  }
  return true;
}

/**
 * TASK-186 AC3 (fix round: now the ONLY evaluation path, called
 * unconditionally by hasExplicitHumanVerdictMarker — see that function's
 * doc comment for why the prior "only when a 'Verdict:' label is present"
 * gate was removed) — evaluates a body against the full
 * <body> ::= <step-block>+ <overall-line> grammar (see the STRICT_OVERALL_RE
 * comment block above for the grammar statement). Returns true only when:
 *   - no non-whitespace text sits outside the recognized step blocks and the
 *     overall-result line (TASK-186 fix round HIGH, second round — closes
 *     the preamble/postscript evasion where a real failure was disclosed
 *     only in text the old code discarded outright; see parseUatBody);
 *   - the recognized step blocks' OWN label numbers cover every integer from
 *     1 to `requiredStepCount` (coversAllStepNumbers, TASK-222 — supersedes
 *     the original TASK-186 fix round HIGH/second-round check, which only
 *     required the recognized block COUNT to be >= requiredStepCount; when
 *     the caller supplies the ticket's AC count, this closes the sibling
 *     evasion of simply omitting the failing AC's step rather than writing a
 *     qualified verdict for it — see the R3 regression lock in
 *     tests/e2e/close-guard.spec.js for why both this AND the
 *     extraneous-text check are needed together. TASK-222 additionally
 *     closes the DUPLICATE-numbering evasion the original count-only floor
 *     left open: two blocks both labelled "1." used to satisfy a 2-AC floor
 *     (count 2 >= 2) with only one AC actually addressed; coversAllStepNumbers
 *     requires the DISTINCT labels {1, 2} to both appear, so that no longer
 *     passes — see coversAllStepNumbers's own doc comment for the still-open
 *     residual (a block's label number is checked, not its content's actual
 *     subject) and tests/e2e/close-guard.spec.js's TASK-222 AC5 regression
 *     lock for the worked duplicate-numbering example.);
 *   - EVERY recognized step block cleanly ends with "Verdict: PASS" (no
 *     qualifier, no missing label, no FAIL) — STRICT_STEP_VERDICT_RE,
 *     anchored at the end;
 *   - the overall-result line's OWN text, whitespace-normalized, is EXACTLY
 *     "Overall result: PASS" / "Overall: PASS" (optional trailing period) —
 *     STRICT_OVERALL_RE, anchored at BOTH ends (TASK-186 fix round, third
 *     round — closes E1/E2, where trailing prose after "PASS" on the overall
 *     line itself disclosed a real failure that the prior body-wide
 *     substring test (OVERALL_PASS_RE) silently ignored); and
 *   - the overall body still passes the FAIL_VERDICT_RE check as
 *     defense-in-depth (a FAIL-family token anywhere, even inside an
 *     otherwise-clean step's own prose, still voids the whole comment).
 * A body with no step carrying a literal "Verdict:" label at all, or with no
 * recognizable overall-result line at all, naturally returns false here,
 * which is what makes the grammar mandatory rather than opt-in.
 *
 * HONEST RESIDUAL (documented, not closed by this fix; this is the CURRENT,
 * accurate scope after the third fix round — see hasExplicitHumanVerdictMarker
 * below for the same statement at the marker's own doc comment): this is a
 * textual check, not a semantic one, and the grammar above governs the
 * body's STRUCTURE (which regions exist, and how each region's own text must
 * end), not the MEANING of text that lives INSIDE a structurally-valid
 * region. Concretely, the one remaining hole is prose INSIDE a step block
 * that still ends cleanly with "Verdict: PASS" — a step whose Observed: text
 * itself narrates a failure but is followed by a bare "Verdict: PASS" label
 * still satisfies this check, because nothing here reads the Observed: text
 * for meaning. This is a narrower residual than any prior round: round 1
 * closed the label-free legacy path, round 2 closed the preamble/postscript/
 * padded-step-count regions, and this round closes the overall-line region —
 * every region the grammar defines is now strict, so the only thing left
 * unchecked is content that is not itself a distinct grammar region at all.
 */
function evaluateStructuredStepVerdicts(body, requiredStepCount) {
  const { blocks: rawBlocks, extraneousText, overallLine, stepNumbers } = parseUatBody(body);
  if (rawBlocks.length === 0) return false;
  if (extraneousText !== '') return false; // preamble/postscript evasion — reject outright
  // TASK-222 — numeric coverage of 1..requiredStepCount, not a bare count
  // floor; see coversAllStepNumbers's doc comment for why this closes the
  // duplicate-numbering evasion the old `rawBlocks.length < requiredStepCount`
  // check left open.
  if (!coversAllStepNumbers(stepNumbers, requiredStepCount)) return false;
  const blocks = rawBlocks.map((b) => b.replace(/\s+/g, ' ').trim());
  for (const block of blocks) {
    const m = STRICT_STEP_VERDICT_RE.exec(block);
    if (!m) return false; // unparseable/qualified/ambiguous step — conservative reject
    if (m[1].toLowerCase() === 'fail') return false;
  }
  if (FAIL_VERDICT_RE.test(body)) return false;
  if (overallLine === null) return false; // no recognizable overall-result line at all
  return STRICT_OVERALL_RE.test(overallLine.replace(/\s+/g, ' ').trim());
}

/**
 * TASK-099 Gate 2 (TASK-186 restructure; TASK-186 fix rounds made the
 * structured convention MANDATORY and, across three rounds, closed the
 * preamble/postscript, padded-step-count, and overall-line-trailing-prose
 * evasions) — a uat-only ticket's `uat` comment carries an "explicit human
 * verdict marker" when its most recent `uat`-authored comment parses as the
 * full <body> ::= <step-block>+ <overall-line> grammar (see the
 * STRICT_OVERALL_RE comment block above): (a) has no orchestrator-delegation
 * phrasing anywhere in the body, (b) carries no non-whitespace text outside
 * its recognized step blocks and the overall-result line, (c) its recognized
 * step blocks' OWN label numbers cover every AC index 1..N (TASK-222 —
 * numeric coverage, no longer a bare count floor; see
 * coversAllStepNumbers/evaluateStructuredStepVerdicts for what this closes
 * and coversAllStepNumbers's doc comment for the still-open content residual),
 * (d) every
 * recognized step in the body cleanly records "Verdict: PASS", and (e) the
 * overall-result line's own text is EXACTLY "Overall result: PASS" (or
 * "Overall: PASS"), nothing appended (see evaluateStructuredStepVerdicts) —
 * a body with no literal "Verdict:" label on any step, or no clean overall
 * line, is REJECTED, not passed through to a looser prose scan; see this
 * file's STEP_START_RE-block doc comment for why the legacy label-free path
 * was removed. If the comment shows delegated-verification phrasing
 * anywhere, at least one step was recorded as Orchestrator-verified, so the
 * close still requires `uat_delegated_to_orchestrator` to be explicitly
 * granted.
 *
 * This is a textual-convention check, not a cryptographic one: it cannot
 * prove a human actually authored the recorded verdict. Across its three fix
 * rounds this ticket closed every evasion IT WAS SHOWN — a failure disclosed
 * only in a discarded preamble/postscript (R1/R2), the same disclosure
 * smuggled past an AC-count floor by padding the step count (R3), and the
 * same disclosure moved onto the overall-result line itself as trailing
 * prose (E1/E2, third round) — but it does NOT eliminate every way prose can
 * mislead: a step whose Observed: text itself narrates a failure yet still
 * ends with a bare "Verdict: PASS" label is not read for meaning and still
 * satisfies this check (see evaluateStructuredStepVerdicts's doc comment for
 * the same residual, stated once there as the canonical location, and for
 * why this is now a narrower and more accurately-scoped residual than either
 * prior round claimed). It narrows — it does not eliminate — the prior hole
 * where ANY comment authored 'uat' satisfied the done-guard regardless of
 * content (see the TASK-099 hand-off for the original residual-limitation
 * note, and the TASK-186 hand-offs for why a token blacklist over prose
 * could not be hardened further by extending the token list alone, nor by
 * making the structured check merely opt-in, nor by treating any one grammar
 * region as wholesale-exempt from its own strict rule).
 */
export function hasExplicitHumanVerdictMarker(task) {
  const comments = Array.isArray(task && task.comments) ? task.comments : [];
  const uatComments = comments.filter((c) => c && c.author === 'uat');
  if (uatComments.length === 0) return false;
  const last = uatComments[uatComments.length - 1];
  const body = String((last && last.body) || '');
  if (DELEGATED_MARKER_RE.test(body)) return false;
  const requiredStepCount = Array.isArray(task && task.acceptance_criteria)
    ? task.acceptance_criteria.length
    : 0;
  return evaluateStructuredStepVerdicts(body, requiredStepCount);
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
