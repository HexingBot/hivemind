// src/reviewer-verdict-provenance.js
// TASK-217 — corroboration (NOT proof) that a ticket's `author: 'reviewer'`
// comment matches the durable record TASK-219's SubagentStop hook already
// wrote to `state/sessions/<id>/subagent-log.jsonl`.
//
// WHY THIS EXISTS, AND WHY IT DOES NOT GIVE THE REVIEWER A WRITE TOOL
// (AC1/AC6): the ticket's own unlock comment (2026-09-10) re-verified that
// giving the reviewer `append_comment` would let it write ANY author in
// COMMENT_AUTHORS (task-store.js), including 'uat' — the exact author that
// satisfies the uat-only close guard — and that the MCP server has no
// caller identity anywhere to restrict that with. That path was rejected.
// TASK-219 already solved DURABILITY for every subagent, reviewer included,
// with no new tool grant: the SubagentStop hook persists
// `last_assistant_message` verbatim, independent of whether the Orchestrator
// is alive to relay it. What is still open is AUTHORSHIP: the Orchestrator
// still writes the `author: 'reviewer'` comment itself (via `append_comment`,
// because the reviewer has and keeps no such tool — AC2/AC5), transcribing
// the reviewer's verdict in its own words. Nothing stops that transcription
// from silently drifting from what the reviewer actually said.
//
// AC6, ANSWERED HONESTLY, NOT IMPLIED: this module cannot PROVE a comment was
// written by the reviewer — there is no caller identity in any layer to
// check against (same limit the ticket's unlock comment names for AC1). What
// it CAN do is CORROBORATE: compare the comment against the durable log
// record and report whether they agree. Corroboration is not proof, so this
// is advisory only (see bin/audit-reviewer-verdict.js's header for why it is
// never wired into the close path).
//
// EMPTY-RESULT CONTRACT (TASK-192): "we could not check" and "we checked and
// it doesn't match" must never collapse into one another. There are exactly
// three outcomes and every branch below returns exactly one of them:
//   - CORROBORATED       — a reviewer comment exists, a durable log record
//                          for this ticket exists, and their verdict tokens
//                          agree.
//   - NOT_CORROBORATED   — a reviewer comment exists, but either no durable
//                          record backs it for this ticket, or the verdict
//                          tokens disagree. This is the case that matters:
//                          it is the signal that the Orchestrator's
//                          transcription may not match what the reviewer
//                          actually said.
//   - UNVERIFIABLE       — there was nothing usable to compare: no log file,
//                          no reviewer-type record at all, the comment
//                          predates the log's own coverage window (see
//                          COVERAGE WINDOW below), no record for this ticket
//                          AND the log's ticket-correlation is itself broken
//                          for that stretch of time (see KNOWN GAP #1 below),
//                          no reviewer comment yet, or a verdict token could
//                          not be extracted from one or both sides. Never
//                          reported as either of the other two.
//
// COVERAGE WINDOW (TASK-217 fix round, 2026-09-10 — found by running this
// tool against the repo's real board: 49/52 examined tickets came back
// not-corroborated, and inspection showed the overwhelming majority were
// closed MONTHS before the SubagentStop hook (TASK-219) existed at all —
// "we never had a chance to record this" was rendering identically to "we
// recorded it and it doesn't match", exactly the empty-result collapse
// TASK-192 exists to prevent). The log's coverage window starts at the
// EARLIEST `captured_at` across EVERY record in the log (any agent_type, not
// only reviewer records — a developer record two minutes before the first
// reviewer record still proves the hook was already running). A reviewer
// comment whose own `at` timestamp predates that earliest `captured_at`
// could not possibly have been recorded even if the hook worked perfectly
// that day, and is reported UNVERIFIABLE (reason `out-of-log-coverage`), not
// NOT_CORROBORATED. A comment with no parseable `at`, or a log with no
// record carrying a parseable `captured_at`, cannot be placed relative to
// the window at all — this check is skipped entirely in that case (never
// guessed either way).
//
// KNOWN GAP #1 — ticket correlation depends on a live `active_task`
// (found while unlocking this ticket, in scope here): every subagent-log
// record's `ticket` field comes from `resolveActiveTicket` reading the
// session bundle's `active_task` (src/subagent-log.js). When the bundle sat
// with `active_task: null`, EVERY record captured during that stretch
// carries `ticket: null` and NONE of them is correlatable to anything — a
// systemic gap, not evidence against any one ticket. TASK-217's fix round
// generalized the detection of this gap from a whole-log check ("are ALL
// reviewer records in the entire log null-ticketed") to a TIME-WINDOWED one:
// the log can legitimately contain more than one such stretch (this repo's
// own log has two, hours apart, separated by long runs of correctly-
// correlated records in between) and a ticket whose true record fell inside
// ONE of those stretches must not be judged by whether OTHER, unrelated
// stretches of the same log happened to correlate fine. Concretely: every
// maximal contiguous run of null-ticketed reviewer records (ordered by
// `captured_at`) forms a window from that run's first record up to (but not
// including) the next non-null reviewer record's `captured_at` — open-ended
// if the log currently ends mid-run. A ticket's own reviewer comment whose
// `at` falls inside such a window is reported UNVERIFIABLE (reason
// `no-ticket-correlation`), never NOT_CORROBORATED, even though no record
// literally matches its ticket key — because for that stretch of time NO
// record could possibly have matched anything, by construction. This is a
// TIME-RANGE check, never an identity guess: it never claims WHICH null
// record is this ticket's own, only that correlation was demonstrably
// impossible for every record captured in that stretch.
//
// TASK-217 FIX ROUND (2026-09-10, Case 1 — HIGH, code made to agree with the
// paragraph above instead of contradicting it): this check (and the
// COVERAGE WINDOW check above it) is evaluated ONLY when no record matching
// this exact ticket key was found. A matching record proves correlation WAS
// possible for this ticket — the opposite of what both pre-checks exist to
// explain — so once one is found, both are skipped entirely and the outcome
// is decided by comparing verdict tokens instead. Pre-fix, the code ran both
// pre-checks unconditionally: a single UNRELATED null-ticketed reviewer
// record captured inside a correlation-broken window could silently launder
// a real verdict-mismatch for this ticket into unverifiable/
// no-ticket-correlation, hiding the one outcome (NOT_CORROBORATED) this
// module exists to surface. See auditReviewerVerdictProvenance's body for
// the fix. When neither side
// carries a usable timestamp (comment has no parseable `at`, or no reviewer
// record carries a parseable `captured_at`), this collapses back to the
// original coarse check: are ALL reviewer records in the whole log
// null-ticketed. The Orchestrator's obligation to keep `active_task` current
// (see state/README.md's resume contract and CLAUDE.md's RESUME FIRST
// section) is exactly what keeps this correlation meaningful; this module
// can only detect the gap, not close it.
//
// KNOWN GAP #2 — attribution is "which ticket was the Orchestrator driving",
// not "what did the subagent work on". `resolveActiveTicket` reads the
// bundle's `active_task` at the moment the hook fires, which is what the
// Orchestrator believes it is doing, not a fact about the subagent's own
// prompt. A reviewer spawned for ticket A while the bundle still points at
// ticket B is filed under B and will not corroborate against A's comment.
// This is a real, named limitation of the mechanism, not a bug in this
// module — stated here rather than hidden (per the ticket's instruction to
// "decirlo, no esconderlo"). UNLIKE KNOWN GAP #1's null-ticket stretches
// (which the record itself honestly flags as "correlation unknown" via
// `ticket: null`, and which the time-window check above can therefore
// detect), a GAP #2 misattribution carries a CONFIDENT but WRONG ticket key
// — nothing in the data signals the error, so it is structurally
// indistinguishable from "this reviewer comment simply has no backing
// record at all" without guessing which OTHER ticket's record it actually
// belongs to. This module deliberately does not attempt that guess (a
// time-proximity heuristic that reassigns a record to a different ticket
// would convert a corroboration tool into one that fabricates
// correlations — exactly what this ticket's fix round was told not to
// build). CONCRETE, VALIDATED INSTANCE (2026-09-10, found while fixing this
// ticket, left deliberately unresolved): TASK-211's real, hook-captured
// reviewer record — content-matched via its "rango f8edcd0..768524b" text —
// was filed under `ticket: 'TASK-217'` because this repo's own bundle
// `active_task` pointed at TASK-217 at that moment; TASK-211 therefore still
// reports NOT_CORROBORATED / `no-matching-log-record` after this fix round,
// and that is the correct, honest answer given what this module can know.
//
// VERDICT EXTRACTION IS A HEURISTIC, NOT A PARSER (see extractVerdictToken):
// reviewer.md's Output Format template ends every report with a literal
// "## Verdict" heading followed by "PASS" or "BLOCK", but a comment the
// Orchestrator transcribes is free-form prose, not that template. A real,
// unmodified case from this very repo (TASK-218) demonstrates the risk this
// heuristic is built to catch: the log record's own text ends
// "## Verdict\n\n**REQUEST-CHANGES (BLOCK)**", while the transcribed
// `author: 'reviewer'` comment on the ticket opens "PASS sobre el diff" — a
// defensible paraphrase of a conditional PASS-once-UAT-lands, but exactly
// the shape of disagreement this module exists to surface as
// NOT_CORROBORATED rather than silently accept.
//
// No disk I/O of its own beyond reading the subagent log (readSubagentLog
// below) — the ticket object itself is supplied by the caller (CLI owns
// reading tasks/*.json, same split as src/uat-audit.js / bin/audit-uat.js).

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const PROVENANCE_STATUS = Object.freeze({
  CORROBORATED: 'corroborated',
  NOT_CORROBORATED: 'not-corroborated',
  UNVERIFIABLE: 'unverifiable',
});

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Extract a PASS/BLOCK verdict token from free-form report/comment text.
 * Prefers text following a "Verdict"/"Veredicto" heading (reviewer.md's own
 * Output Format template uses "## Verdict"); falls back to scanning the
 * whole text when no such heading is found. "REQUEST-CHANGES" normalizes to
 * BLOCK (real reviewer comments write "REQUEST-CHANGES (BLOCK)" verbatim —
 * see this module's header for the TASK-218 example).
 *
 * TWO HEADING SHAPES, BOTH REAL (found while validating this module against
 * the repo's own historical corpus, TASK-217 fix round): the current
 * reviewer.md template puts the token on its own line after a "## Verdict"
 * heading ("## Verdict\n\nPASS"), but real historical comments (e.g.
 * TASK-220) write it inline on the SAME line as the heading word
 * ("VEREDICTO: APPROVE."). A heading regex that requires a newline before
 * the searched text (as an earlier version of this function did) skips the
 * inline token entirely and falls through to an incidental, unrelated later
 * match — the exact false-extraction failure mode this function exists to
 * avoid. The heading regex below therefore starts the search region
 * immediately after the heading word (optional colon/whitespace), covering
 * both shapes, and prefers the LAST heading occurrence in the text (a
 * verdict is stated once, near the end of a report; an earlier false
 * "veredicto" mention — e.g. inside a quoted AC — must not win).
 *
 * "APPROVE" is accepted as a PASS synonym: confirmed via `git log -p --
 * agents/reviewer.md` to be real historical output vocabulary, predating the
 * current template's PASS|BLOCK wording.
 *
 * Returns null when no token can be found — callers must treat that as
 * "cannot extract", never as an implicit BLOCK or PASS (empty-result
 * contract: an extraction failure is UNVERIFIABLE, not a silent guess).
 *
 * @param {*} text
 * @returns {'PASS'|'BLOCK'|null}
 */
export function extractVerdictToken(text) {
  if (!isNonEmptyString(text)) return null;

  const headingRe = /(?:^|\n)\s*#*\s*(?:verdict|veredicto)\b[:\s]*/gi;
  let lastHeadingEnd = -1;
  let m;
  // eslint-disable-next-line no-cond-assign
  while ((m = headingRe.exec(text)) !== null) {
    lastHeadingEnd = m.index + m[0].length;
    if (m[0].length === 0) headingRe.lastIndex += 1; // guard against a zero-width match looping forever
  }
  const searchIn = lastHeadingEnd >= 0 ? text.slice(lastHeadingEnd) : text;

  const tokenMatch = searchIn.match(/\b(PASS|BLOCK|REQUEST-CHANGES|APPROVE)\b/i);
  if (!tokenMatch) return null;

  const token = tokenMatch[1].toUpperCase();
  if (token === 'REQUEST-CHANGES') return 'BLOCK';
  if (token === 'APPROVE') return 'PASS';
  return token;
}

/**
 * Read every `state/sessions/<id>/subagent-log.jsonl` file under `repoRoot` and
 * parse it, tolerating malformed lines (skipped, never throws — same
 * tolerance policy as task-store.js's zero-byte-file skip). Never throws.
 *
 * @param {string} repoRoot
 * @returns {{exists: boolean, records: object[]}} `exists` is false only when
 *   NO session directory contains a subagent-log.jsonl at all (the hook has
 *   never run in this repo, or no session has been created yet).
 */
export function readSubagentLog(repoRoot) {
  const sessionsDir = join(repoRoot, 'state', 'sessions');
  let sessionIds;
  try {
    sessionIds = existsSync(sessionsDir) ? readdirSync(sessionsDir) : [];
  } catch {
    return { exists: false, records: [] };
  }

  const records = [];
  let exists = false;
  for (const sessionId of sessionIds) {
    const logPath = join(sessionsDir, sessionId, 'subagent-log.jsonl');
    if (!existsSync(logPath)) continue;
    exists = true;
    let raw;
    try {
      raw = readFileSync(logPath, 'utf8');
    } catch {
      continue;
    }
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        records.push(JSON.parse(trimmed));
      } catch {
        // malformed line — skip, do not fail the whole read
      }
    }
  }
  return { exists, records };
}

/**
 * Parse an ISO-ish timestamp into epoch milliseconds, or null when it is
 * missing or unusable. Never throws (empty-result contract: an unparseable
 * timestamp yields "cannot place on the timeline", never a silently-wrong
 * comparison in either direction).
 *
 * @param {*} v
 * @returns {number|null}
 */
function parseTimestamp(v) {
  if (!isNonEmptyString(v)) return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * The log's coverage window starts at the EARLIEST `captured_at` across
 * every record (any agent_type). Returns null when no record carries a
 * parseable `captured_at` — the coverage check is then skipped by the
 * caller rather than guessed (see module header, COVERAGE WINDOW).
 *
 * @param {object[]} records
 * @returns {number|null}
 */
function computeLogCoverageStart(records) {
  let min = null;
  for (const r of records) {
    const ms = parseTimestamp(r && r.captured_at);
    if (ms === null) continue;
    if (min === null || ms < min) min = ms;
  }
  return min;
}

/**
 * Maximal contiguous runs (ordered by `captured_at`) of reviewer records
 * whose `ticket` is null/empty — see module header, KNOWN GAP #1. A run's
 * window is `[firstNullCapturedAt, nextNonNullCapturedAt)`; the upper bound
 * is `null` (open-ended) when the run has not yet been closed by a later
 * correlated reviewer record. Records without a parseable `captured_at` are
 * excluded from the timeline entirely — never guessed into a position.
 *
 * @param {object[]} reviewerRecords
 * @returns {{start: number, end: number|null}[]}
 */
function computeNullTicketWindows(reviewerRecords) {
  const timestamped = reviewerRecords
    .map((r) => ({ ticket: r && r.ticket, ms: parseTimestamp(r && r.captured_at) }))
    .filter((r) => r.ms !== null)
    .sort((a, b) => a.ms - b.ms);

  const windows = [];
  let runStart = null;
  for (const rec of timestamped) {
    const isNull = !isNonEmptyString(rec.ticket);
    if (isNull) {
      if (runStart === null) runStart = rec.ms;
    } else if (runStart !== null) {
      windows.push({ start: runStart, end: rec.ms });
      runStart = null;
    }
  }
  if (runStart !== null) windows.push({ start: runStart, end: null });
  return windows;
}

/**
 * Was ticket-correlation broken AT (or around) the time this ticket's
 * reviewer comment would have been captured? See module header, KNOWN GAP
 * #1, for the full rationale. Two modes:
 *   1. `atTime === null` (comment carries no parseable `at`) — fall back to
 *      the coarse, whole-log check: EVERY reviewer record in the log has a
 *      null ticket.
 *   2. `atTime` available — true when it falls inside any null-ticket
 *      window (see computeNullTicketWindows). A time-range check, never an
 *      identity guess.
 *
 * @param {object[]} reviewerRecords
 * @param {number|null} atTime
 * @returns {boolean}
 */
function isTicketCorrelationBrokenAt(reviewerRecords, atTime) {
  if (atTime === null) {
    return !reviewerRecords.some((r) => isNonEmptyString(r.ticket));
  }
  const windows = computeNullTicketWindows(reviewerRecords);
  return windows.some((w) => atTime >= w.start && (w.end === null || atTime < w.end));
}

/**
 * TASK-217 FIX ROUND (2026-09-10, Case 3 — LOW, real correctness bug): pick
 * the matching record with the LATEST `captured_at`, never "the last one in
 * array order". `readSubagentLog` concatenates records across every
 * `state/sessions/<id>/` directory in `readdirSync` order, which is NOT
 * guaranteed to correlate with wall-clock time — with two session dirs on
 * disk, the array-order-last matching record can be the OLDER one. Picking
 * it produced a FALSE verdict-mismatch after a legitimate RC-loop re-review
 * (the earlier, stale record — e.g. an initial BLOCK — outranking the real,
 * later PASS purely because of directory read order).
 *
 * DECISION on records with no parseable `captured_at` (explicitly stated,
 * not left implicit, per the ticket's instruction): such a record must
 * neither silently WIN (it has no timestamp to compare, so it can never beat
 * a record that does have one) nor silently VANISH (it stays eligible and
 * still wins ties against other timestamp-less records, using their
 * original array/read order as the tiebreak — the only ordering information
 * available for it). Concretely: sort ascending treating an unparseable
 * `captured_at` as `-Infinity`, with the original array index as the
 * tiebreaker, and take the last element.
 *
 * @param {object[]} records non-empty array of matching log records.
 * @returns {object}
 */
function pickLatestRecordByCapturedAt(records) {
  const ranked = records.map((r, i) => ({ r, i, ms: parseTimestamp(r && r.captured_at) }));
  ranked.sort((a, b) => {
    const am = a.ms === null ? -Infinity : a.ms;
    const bm = b.ms === null ? -Infinity : b.ms;
    if (am !== bm) return am - bm;
    return a.i - b.i;
  });
  return ranked[ranked.length - 1].r;
}

function unverifiable(reason, message, extra = {}) {
  return { status: PROVENANCE_STATUS.UNVERIFIABLE, reason, message, ...extra };
}
function notCorroborated(reason, message, extra = {}) {
  return { status: PROVENANCE_STATUS.NOT_CORROBORATED, reason, message, ...extra };
}
function corroborated(message, extra = {}) {
  return { status: PROVENANCE_STATUS.CORROBORATED, reason: 'verdict-match', message, ...extra };
}

/**
 * Corroborate (never prove — see module header) a ticket's `author:
 * 'reviewer'` comment against the durable subagent-log record TASK-219's
 * hook wrote for that same ticket.
 *
 * @param {{task: object, log: {exists: boolean, records: object[]}}} args
 *   `task` is a parsed tasks/<KEY>.json object (must carry `.key` and
 *   `.comments`). `log` is the result of readSubagentLog (or an equivalent
 *   shape) — injected rather than read internally so this function stays
 *   pure and unit-testable without touching disk.
 * @returns {{status: 'corroborated'|'not-corroborated'|'unverifiable', reason: string, message: string, [commentVerdict]: string, [recordVerdict]: string}}
 */
export function auditReviewerVerdictProvenance({ task, log }) {
  const ticketKey = task && isNonEmptyString(task.key) ? task.key : null;
  if (!ticketKey) {
    return unverifiable('no-ticket-key', 'el objeto task no trae una key utilizable.');
  }

  if (!log || log.exists !== true) {
    return unverifiable(
      'no-log-file',
      'no existe ningun state/sessions/*/subagent-log.jsonl: el hook SubagentStop '
        + '(TASK-219) nunca corrio en este repo, o ninguna sesion se creo todavia.',
    );
  }

  const records = Array.isArray(log.records) ? log.records : [];
  const reviewerRecords = records.filter((r) => r && r.agent_type === 'reviewer');
  if (reviewerRecords.length === 0) {
    return unverifiable(
      'no-reviewer-records',
      'el log existe pero no tiene ningun registro con agent_type "reviewer".',
    );
  }

  const reviewerComments = (Array.isArray(task.comments) ? task.comments : [])
    .filter((c) => c && c.author === 'reviewer');
  if (reviewerComments.length === 0) {
    return unverifiable(
      'no-reviewer-comment',
      'el ticket todavia no tiene ningun comentario author "reviewer" que corroborar.',
    );
  }

  const lastComment = reviewerComments[reviewerComments.length - 1];
  const lastCommentAt = parseTimestamp(lastComment.at);

  // TASK-217 FIX ROUND (2026-09-10, Case 1 — HIGH): compute matchingRecords
  // BEFORE the two pre-checks below, and skip both entirely when a record
  // for THIS ticket already exists. Both pre-checks exist solely to EXPLAIN
  // AN ABSENCE (see module header, COVERAGE WINDOW and KNOWN GAP #1) — they
  // have no meaning once a real, correlated record for this exact ticket is
  // present. Pre-fix, an UNRELATED null-ticketed reviewer record captured
  // inside the correlation-broken window could silently launder a real
  // verdict-mismatch into unverifiable/no-ticket-correlation, because the
  // window check ran unconditionally regardless of whether this ticket's own
  // record had already been found. A matching record PROVES correlation was
  // possible for this ticket, which is exactly what the module header's own
  // KNOWN GAP #1 text says ("it never claims WHICH null record is this
  // ticket's own, only that correlation was demonstrably impossible for
  // every record captured in that stretch") — code now agrees with that
  // text instead of contradicting it.
  const matchingRecords = reviewerRecords.filter((r) => r.ticket === ticketKey);

  if (matchingRecords.length === 0) {
    // COVERAGE WINDOW (see module header): a comment that predates the log's
    // own earliest captured_at could not possibly have been recorded, hook or
    // no hook. Skipped (never guessed) when either side lacks a usable
    // timestamp.
    const logCoverageStart = computeLogCoverageStart(records);
    if (lastCommentAt !== null && logCoverageStart !== null && lastCommentAt < logCoverageStart) {
      return unverifiable(
        'out-of-log-coverage',
        'el comentario author "reviewer" es anterior al registro mas antiguo de todo '
          + `el log (captured_at ${new Date(logCoverageStart).toISOString()}): el hook `
          + 'SubagentStop (TASK-219) todavia no corria en este repo cuando se escribio '
          + 'este comentario, asi que la ausencia de registro no dice nada sobre si el '
          + 'veredicto fue fiel.',
      );
    }

    // KNOWN GAP #1 (see module header): ticket correlation may be broken for
    // the specific stretch of time this comment falls in, even when it works
    // fine elsewhere in the same log.
    if (isTicketCorrelationBrokenAt(reviewerRecords, lastCommentAt)) {
      return unverifiable(
        'no-ticket-correlation',
        'el bundle de sesion tenia active_task en null cuando corrieron los '
          + 'subagentes reviewer de esa ventana de tiempo, asi que la correlacion por '
          + 'ticket esta rota para ese tramo del log, no solo para este ticket '
          + '(ver KNOWN GAP #1 en el header del modulo).',
      );
    }

    return notCorroborated(
      'no-matching-log-record',
      'hay comentario author "reviewer" en el ticket pero ningun registro del log '
        + 'tiene ticket === este ticket.',
    );
  }

  const lastRecord = pickLatestRecordByCapturedAt(matchingRecords);

  const commentVerdict = extractVerdictToken(lastComment.body);
  const recordVerdict = extractVerdictToken(lastRecord.last_assistant_message);

  if (!commentVerdict || !recordVerdict) {
    return unverifiable(
      'verdict-not-extractable',
      'no se pudo extraer un token PASS/BLOCK confiable del comentario y/o del '
        + 'registro del log (ver la heuristica de extractVerdictToken).',
    );
  }

  if (commentVerdict === recordVerdict) {
    return corroborated(`comentario y registro coinciden en ${commentVerdict}.`, {
      commentVerdict,
      recordVerdict,
    });
  }

  return notCorroborated(
    'verdict-mismatch',
    `el comentario dice ${commentVerdict} y el registro del log dice ${recordVerdict}.`,
    { commentVerdict, recordVerdict },
  );
}
