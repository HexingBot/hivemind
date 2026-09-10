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
//                          no reviewer-type record at all, no record for
//                          this ticket AND the log's ticket-correlation is
//                          itself broken (see KNOWN GAP below), no reviewer
//                          comment yet, or a verdict token could not be
//                          extracted from one or both sides. Never reported
//                          as either of the other two.
//
// KNOWN GAP #1 — ticket correlation depends on a live `active_task`
// (found while unlocking this ticket, in scope here): every subagent-log
// record's `ticket` field comes from `resolveActiveTicket` reading the
// session bundle's `active_task` (src/subagent-log.js). When the bundle sat
// with `active_task: null` (as this repo's own first 31 records did), EVERY
// record in that window carries `ticket: null` and NONE of them is
// correlatable to anything — a systemic gap, not evidence against any one
// ticket. This module distinguishes that case (UNVERIFIABLE, reason
// `no-ticket-correlation`) from the ordinary "no record for THIS ticket while
// correlation works fine for others" case (NOT_CORROBORATED, reason
// `no-matching-log-record`). The Orchestrator's obligation to keep
// `active_task` current (see state/README.md's resume contract and CLAUDE.md's
// RESUME FIRST section) is exactly what keeps this correlation meaningful;
// this module can only detect the gap, not close it.
//
// KNOWN GAP #2 — attribution is "which ticket was the Orchestrator driving",
// not "what did the subagent work on". `resolveActiveTicket` reads the
// bundle's `active_task` at the moment the hook fires, which is what the
// Orchestrator believes it is doing, not a fact about the subagent's own
// prompt. A reviewer spawned for ticket A while the bundle still points at
// ticket B is filed under B and will not corroborate against A's comment.
// This is a real, named limitation of the mechanism, not a bug in this
// module — stated here rather than hidden (per the ticket's instruction to
// "decirlo, no esconderlo").
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

  const anyCorrelatable = reviewerRecords.some((r) => isNonEmptyString(r.ticket));
  if (!anyCorrelatable) {
    return unverifiable(
      'no-ticket-correlation',
      'ningun registro reviewer trae un ticket no-nulo: el bundle de sesion tenia '
        + 'active_task en null cuando corrieron estos subagentes, asi que la '
        + 'correlacion por ticket esta rota para toda esta ventana, no solo para '
        + 'este ticket (ver KNOWN GAP #1 en el header del modulo).',
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

  const matchingRecords = reviewerRecords.filter((r) => r.ticket === ticketKey);
  if (matchingRecords.length === 0) {
    return notCorroborated(
      'no-matching-log-record',
      'hay comentario author "reviewer" en el ticket pero ningun registro del log '
        + 'tiene ticket === este ticket.',
    );
  }

  const lastComment = reviewerComments[reviewerComments.length - 1];
  const lastRecord = matchingRecords[matchingRecords.length - 1];

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
