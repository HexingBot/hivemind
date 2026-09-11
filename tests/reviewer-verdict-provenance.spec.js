// tests/reviewer-verdict-provenance.spec.js
// TASK-217 — regression locks for the pure corroboration logic:
// auditReviewerVerdictProvenance and its extractVerdictToken heuristic.
//
// TIER: fast (pure functions, no disk I/O in this file — `log` objects are
// constructed in-memory; readSubagentLog itself is exercised end-to-end by
// tests/e2e/audit-reviewer-verdict-cli.spec.js).
//
// AC coverage (ticket's DESBLOQUEO comment, 2026-09-10):
//   AC1/AC6 — the three-outcome contract (corroborated / not-corroborated /
//             unverifiable) never collapses two of the three into one.
//   AC4     — a real durable log record backs a corroborated verdict
//             without any transcription step.
//
// Regla 3 (TASK-213): 8 acceptance criteria on this ticket -> cap is 8 new
// specs. This file used 6 (see the "coverage window" spec added in the first
// TASK-217 fix round); two further e2e specs cover the CLI layer (see
// tests/e2e/audit-reviewer-verdict-cli.spec.js) — 8 of 8, at the cap.
//
// TASK-217 SECOND FIX ROUND (2026-09-10, Regla 3 cap exceeded WITH
// justification, pre-authorized by the human): an independent reviewer
// proved, by mutation, that the first fix round's own "coverage window and
// time-windowed ticket correlation" spec (below) was VACUOUS for the
// time-range comparison it claims to lock — all 6 pre-existing unit
// assertions passed against a mutated isTicketCorrelationBrokenAt whose body
// was reduced to `return windows.length > 0;` (the entire atTime-in-window
// comparison deleted). That is not test accretion, it is the sensor the cap
// already assumed existed: the pre-existing specs did not exercise (a) a
// comment safely outside a null-ticket window that exists elsewhere in the
// log, or (b) a comment inside such a window that nonetheless has a real
// matching record for its own ticket (a live HIGH the reviewer reproduced
// against the real module: a single unrelated null-ticketed record could
// launder a genuine verdict-mismatch into unverifiable/no-ticket-correlation
// — see auditReviewerVerdictProvenance's body for the fix). Four more specs
// were added below to close both gaps plus a related LOW (Case 3: the
// matching record compared must be picked by latest captured_at, not array
// order) — 12 of 8 at the cap, 4 over, justified above.
//
// TASK-217 THIRD FIX ROUND (2026-09-10, Regla 3 cap exceeded again WITH
// justification, pre-authorized by the human): the second round's own
// match-priority fix reintroduced the false-accusation class it was meant to
// kill, in a narrower shape (a matching record compared against a comment
// that predates it — two different review rounds treated as one), and the
// second round's own time-windowed correlation check was itself only
// partially locked (three surviving mutations: an untested open-ended
// trailing null-ticket window, and its untested lower time bound — see the
// two specs below). Two more specs were added, one per finding — 14 of 8 at
// the cap, 6 over, justified above.
//
// TASK-217 FOURTH FIX ROUND (2026-09-10, Regla 3 cap exceeded again WITH
// justification, pre-authorized by the human): an independent reviewer
// reproduced, on this repo's OWN real board data (TASK-221), that the third
// round's own comment-predates-record check ran pickLatestRecordByCapturedAt
// on the full matchingRecords set BEFORE checking the timestamp constraint —
// so a real, genuinely-comparable record captured BEFORE the comment was
// discarded whenever a LATER record (mis-filed under the same ticket key by
// KNOWN GAP #2 — a stale active_task) also matched by ticket, because the
// latest-by-captured_at pick always preferred the mis-filed later one and
// then bailed out entirely instead of comparing against the real match. On
// forged data (comment flipped to the opposite verdict) this converted a
// DETECTED FABRICATION into "could not check" — exactly the regression this
// whole module exists to prevent. Fixed by restricting the candidate set to
// records captured AT OR BEFORE the comment's own `at` BEFORE picking the
// latest one (see auditReviewerVerdictProvenance's body). Two more specs
// were added, one per finding (the HIGH itself, and a MEDIUM survivor on the
// null-guard added to close it) — 16 of 8 at the cap, 8 over, justified
// above.
//
// FIRST FIX ROUND (2026-09-10) — the empty-result collapse this ticket's own
// contract was supposed to prevent, found by running the real CLI against
// this repo's real board: 49 of 52 examined tickets came back
// NOT_CORROBORATED, and inspection showed the overwhelming majority were
// closed MONTHS before the SubagentStop hook (TASK-219) existed — "we never
// had a chance to record this" was rendering identically to "we recorded it
// and it disagrees", which is exactly the class of bug TASK-192 exists to
// catch, reproduced inside the very tool built to catch it. See the module
// header's COVERAGE WINDOW and KNOWN GAP #1 sections for the fix.

import { describe, it, expect } from 'vitest';
import {
  auditReviewerVerdictProvenance,
  extractVerdictToken,
  PROVENANCE_STATUS,
} from '../src/reviewer-verdict-provenance.js';

function reviewerTask(comments) {
  return { key: 'TASK-999', comments };
}

function reviewerRecord({ ticket, message }) {
  return { agent_type: 'reviewer', ticket, last_assistant_message: message };
}

// ---------------------------------------------------------------------------
// 1. UNVERIFIABLE — no log file at all (the hook never ran / no session yet).
// Harm this prevents: without this branch, "no log" and "reviewer fabricated
// a verdict" would render identically as NOT_CORROBORATED — falsely accusing
// a reviewer (or the orchestrator) of a mismatch that never happened, purely
// because the consumer project has not adopted the SubagentStop hook yet.
// ---------------------------------------------------------------------------

describe('UNVERIFIABLE — no log file', () => {
  it('reports unverifiable/no-log-file, never not-corroborated, when the log does not exist', () => {
    const task = reviewerTask([{ author: 'reviewer', body: '## Verdict\nPASS' }]);
    const result = auditReviewerVerdictProvenance({ task, log: { exists: false, records: [] } });
    expect(result.status).toBe(PROVENANCE_STATUS.UNVERIFIABLE);
    expect(result.reason).toBe('no-log-file');
  });
});

// ---------------------------------------------------------------------------
// 2. UNVERIFIABLE — ticket correlation is systemically broken (all reviewer
// records carry ticket: null), DISTINCT from "no record for this ticket".
// Harm this prevents: without this branch, a whole session's worth of
// records recorded while active_task sat null (a real, confirmed gap in this
// very repo) would be reported as this ticket's reviewer having no backing
// record — wrongly blaming one ticket for a system-wide bookkeeping gap.
// ---------------------------------------------------------------------------

describe('UNVERIFIABLE — ticket correlation is broken for the whole log window', () => {
  it('reports unverifiable/no-ticket-correlation, not not-corroborated, when every reviewer record has ticket: null', () => {
    const task = reviewerTask([{ author: 'reviewer', body: '## Verdict\nPASS' }]);
    const log = {
      exists: true,
      records: [reviewerRecord({ ticket: null, message: '## Verdict\nPASS' })],
    };
    const result = auditReviewerVerdictProvenance({ task, log });
    expect(result.status).toBe(PROVENANCE_STATUS.UNVERIFIABLE);
    expect(result.reason).toBe('no-ticket-correlation');
  });
});

// ---------------------------------------------------------------------------
// 3. CORROBORATED — a real durable record backs the ticket comment, and the
// verdicts agree (AC4: durability, no transcription needed to check it).
// Harm this prevents: without a genuine positive case, a bug that made the
// checker report every input as not-corroborated (fail-closed) would slip
// through unnoticed and permanently discredit real, honest verdicts.
// ---------------------------------------------------------------------------

describe('CORROBORATED — matching ticket, matching verdict', () => {
  it('reports corroborated when the log record for this ticket agrees with the comment', () => {
    const task = reviewerTask([{ author: 'reviewer', body: '## Verdict\nPASS' }]);
    const log = {
      exists: true,
      records: [reviewerRecord({ ticket: 'TASK-999', message: '## Verdict\nPASS' })],
    };
    const result = auditReviewerVerdictProvenance({ task, log });
    expect(result.status).toBe(PROVENANCE_STATUS.CORROBORATED);
  });
});

// ---------------------------------------------------------------------------
// 4. NOT_CORROBORATED — a comment exists but disagrees with the durable
// record for the SAME ticket. This is the case that matters (per the
// ticket's own text): it is the signal that the orchestrator's transcription
// drifted from what the reviewer actually said.
// Harm this prevents: a silently-drifted transcription (e.g. a BLOCK
// softened into a PASS when relayed) would go undetected forever, exactly
// reopening the "fabricated verdict" class TASK-187/188 tried to close.
// ---------------------------------------------------------------------------

describe('NOT_CORROBORATED — comment and log record disagree for the same ticket', () => {
  it('reports not-corroborated/verdict-mismatch with both extracted tokens named', () => {
    const task = reviewerTask([{ author: 'reviewer', body: '## Verdict\nPASS' }]);
    const log = {
      exists: true,
      records: [reviewerRecord({ ticket: 'TASK-999', message: '## Verdict\nBLOCK' })],
    };
    const result = auditReviewerVerdictProvenance({ task, log });
    expect(result.status).toBe(PROVENANCE_STATUS.NOT_CORROBORATED);
    expect(result.reason).toBe('verdict-mismatch');
    expect(result.commentVerdict).toBe('PASS');
    expect(result.recordVerdict).toBe('BLOCK');
  });
});

// ---------------------------------------------------------------------------
// 5. extractVerdictToken — the inline "VEREDICTO: APPROVE" heading shape
// (confirmed real historical output, predating the current "## Verdict\nPASS"
// template) must not be skipped in favor of an unrelated, incidental later
// match of the word PASS/BLOCK elsewhere in the same report.
// Harm this prevents: without this, a real historical reviewer comment like
// TASK-220's ("VEREDICTO: APPROVE... AC1 a AC4 PASS por lectura literal")
// would extract the wrong token from deep in the body text instead of the
// actual verdict, producing a FALSE not-corroborated alarm indistinguishable
// from a genuine transcription drift — the exact false-positive this
// heuristic must not manufacture.
// ---------------------------------------------------------------------------

describe('extractVerdictToken — inline "VEREDICTO: APPROVE" heading shape', () => {
  it('extracts APPROVE (normalized to PASS) from the heading line itself, not an unrelated later BLOCK mention', () => {
    const text = 'VEREDICTO: APPROVE. Revision LIGHT.\n\n'
      + 'Nota: el ticket anterior fue BLOCK por un HIGH ya resuelto ahora.';
    expect(extractVerdictToken(text)).toBe('PASS');
  });
});

// ---------------------------------------------------------------------------
// 6. FIX ROUND (2026-09-10) — the coverage-window and time-windowed
// no-ticket-correlation checks, both added to close the real empty-result
// collapse found against this repo's own board (see file header).
//
// Harm this prevents: without the coverage-window check, a ticket reviewed
// and closed months before the SubagentStop hook existed reports
// NOT_CORROBORATED indistinguishably from a genuinely-drifted transcription
// — exactly the false accusation that trains a reader to ignore this tool's
// output altogether, burying the one real finding (verdict-mismatch) in
// noise. Without the time-windowed correlation check, a ticket whose true
// review fell inside a real (but non-global) active_task-null stretch is
// blamed the same way, even though correlation was demonstrably impossible
// for every record in that stretch — this repo's own log has two such
// stretches, hours apart, with correctly-correlated records in between, so
// a whole-log-only check (the pre-fix version) cannot see either one.
//
// RED-GREEN EVIDENCE (do not remove — non-vacuity proof):
//   RED: temporarily reverted both the coverage-window `if` block and the
//        `isTicketCorrelationBrokenAt` call in
//        src/reviewer-verdict-provenance.js (restoring the old unconditional
//        `matchingRecords` check right after the `no-reviewer-comment`
//        guard) and re-ran this file — both assertions below failed:
//        the out-of-coverage case reported `not-corroborated/no-matching-log-record`
//        instead of `unverifiable/out-of-log-coverage`, and the
//        time-windowed-null case reported the same wrong status/reason
//        instead of `unverifiable/no-ticket-correlation`. Restored
//        immediately after confirming red.
//   GREEN: re-ran with the real implementation restored — both assertions
//        passed.
// ---------------------------------------------------------------------------

describe('FIX ROUND — coverage window and time-windowed ticket correlation', () => {
  it('reports unverifiable/out-of-log-coverage when the comment predates the log\'s earliest record, and unverifiable/no-ticket-correlation when it falls inside a real (non-global) null-ticket stretch', () => {
    // Case A: comment written before the log's own coverage started — the
    // hook could not possibly have recorded anything yet.
    const preHookTask = {
      key: 'TASK-900',
      comments: [{ author: 'reviewer', at: '2026-01-01T00:00:00Z', body: '## Verdict\nPASS' }],
    };
    const log = {
      exists: true,
      records: [
        { agent_type: 'developer', ticket: null, captured_at: '2026-06-01T00:00:00Z' },
        {
          agent_type: 'reviewer',
          ticket: 'TASK-901',
          captured_at: '2026-06-01T00:05:00Z',
          last_assistant_message: '## Verdict\nPASS',
        },
      ],
    };
    const resultA = auditReviewerVerdictProvenance({ task: preHookTask, log });
    expect(resultA.status).toBe(PROVENANCE_STATUS.UNVERIFIABLE);
    expect(resultA.reason).toBe('out-of-log-coverage');

    // Case B: comment falls inside a real null-ticket stretch bounded by
    // correlated reviewer records before AND after it in the SAME log — a
    // whole-log-only check would miss this because most of the log
    // correlates fine.
    const midWindowTask = {
      key: 'TASK-910',
      comments: [{ author: 'reviewer', at: '2026-06-01T00:10:00Z', body: '## Verdict\nPASS' }],
    };
    const windowedLog = {
      exists: true,
      records: [
        { agent_type: 'reviewer', ticket: 'TASK-908', captured_at: '2026-06-01T00:00:00Z', last_assistant_message: '## Verdict\nPASS' },
        { agent_type: 'reviewer', ticket: null, captured_at: '2026-06-01T00:08:00Z', last_assistant_message: '## Verdict\nPASS' },
        { agent_type: 'reviewer', ticket: 'TASK-912', captured_at: '2026-06-01T00:20:00Z', last_assistant_message: '## Verdict\nPASS' },
      ],
    };
    const resultB = auditReviewerVerdictProvenance({ task: midWindowTask, log: windowedLog });
    expect(resultB.status).toBe(PROVENANCE_STATUS.UNVERIFIABLE);
    expect(resultB.reason).toBe('no-ticket-correlation');
  });
});

// ---------------------------------------------------------------------------
// 7. FIX ROUND (2026-09-10, Case 1 HIGH + Case 2 MEDIUM) — regression locks
// for a reviewer's live reproduction: the pre-TASK-217-fix-round unit specs
// above never exercised (a) a comment whose `at` falls OUTSIDE a null-ticket
// window that exists elsewhere in the same log, or (b) a comment INSIDE a
// window that nonetheless has a real matching record for its own ticket.
// The reviewer proved this by mutating isTicketCorrelationBrokenAt's body to
// `return windows.length > 0;` (deleting the atTime-in-window comparison
// entirely) and replaying all 6 pre-fix-round unit assertions above — all 6
// still passed.
//
// Regla 2 harm line: without sub-case (a), a comment timestamped safely
// outside a correlation-broken stretch can still be misreported as
// unverifiable/no-ticket-correlation whenever ANY null-ticketed window
// exists anywhere else in the log, silently hiding a real
// not-corroborated/no-matching-log-record finding. Without sub-case (b) —
// this is Case 1's own HIGH regression lock — an unrelated null-ticketed
// record captured inside a correlation-broken window can launder a REAL
// verdict-mismatch (a reviewer's BLOCK reported to the ticket as PASS) into
// "could not be checked", so nobody notices the drift.
//
// RED-GREEN EVIDENCE (do not remove — non-vacuity proof):
//   RED: applied the reviewer's exact mutation (isTicketCorrelationBrokenAt's
//        body reduced to `return windows.length > 0;`) and re-ran this file
//        — the outside-window assertion failed (`no-matching-log-record`
//        expected, `no-ticket-correlation` returned, because `windows.length
//        > 0` ignores atTime entirely and fires for ANY log containing a
//        null-ticket window, whether or not the comment falls inside it).
//        Restored immediately after confirming red.
//   GREEN: re-ran with the real implementation restored — both assertions
//        passed.
// ---------------------------------------------------------------------------

describe('FIX ROUND — a match takes priority over the pre-checks, and the window check is a real time-range test', () => {
  it('a comment outside every null window still reaches the record-matching decision instead of being swallowed as unverifiable', () => {
    const outsideWindowTask = {
      key: 'TASK-920',
      comments: [{ author: 'reviewer', at: '2026-06-01T00:25:00Z', body: '## Verdict\nPASS' }],
    };
    const log = {
      exists: true,
      records: [
        { agent_type: 'reviewer', ticket: 'TASK-908', captured_at: '2026-06-01T00:00:00Z', last_assistant_message: '## Verdict\nPASS' },
        { agent_type: 'reviewer', ticket: null, captured_at: '2026-06-01T00:08:00Z', last_assistant_message: '## Verdict\nPASS' },
        { agent_type: 'reviewer', ticket: 'TASK-912', captured_at: '2026-06-01T00:20:00Z', last_assistant_message: '## Verdict\nPASS' },
      ],
    };
    const resultC = auditReviewerVerdictProvenance({ task: outsideWindowTask, log });
    expect(resultC.status).toBe(PROVENANCE_STATUS.NOT_CORROBORATED);
    expect(resultC.reason).toBe('no-matching-log-record');
  });

  it('a comment INSIDE an open-ended null-ticket window with a real, earlier matching record for its own ticket reports verdict-mismatch, never unverifiable (Case 1 fix — same shape as the reviewer\'s live reproduction)', () => {
    // Mirrors the reviewer's exact repro: the real matching record for this
    // ticket is captured BEFORE an unrelated null-ticketed record opens a
    // window that is never closed (no later non-null reviewer record exists
    // to close it) — the comment's own `at` falls inside that open window,
    // even though a real match for THIS ticket exists earlier in the log.
    const insideWindowWithMatchTask = {
      key: 'TASK-915',
      comments: [{ author: 'reviewer', at: '2026-06-01T00:10:00Z', body: '## Verdict\nPASS' }],
    };
    const log = {
      exists: true,
      records: [
        { agent_type: 'reviewer', ticket: 'TASK-915', captured_at: '2026-06-01T00:00:00Z', last_assistant_message: '## Verdict\nBLOCK' },
        { agent_type: 'reviewer', ticket: null, captured_at: '2026-06-01T00:05:00Z', last_assistant_message: '## Verdict\nPASS' },
      ],
    };
    const resultD = auditReviewerVerdictProvenance({ task: insideWindowWithMatchTask, log });
    expect(resultD.status).toBe(PROVENANCE_STATUS.NOT_CORROBORATED);
    expect(resultD.reason).toBe('verdict-mismatch');
    expect(resultD.commentVerdict).toBe('PASS');
    expect(resultD.recordVerdict).toBe('BLOCK');
  });
});

// ---------------------------------------------------------------------------
// 8. FIX ROUND (2026-09-10, Case 3 LOW) — the matching record compared must
// be the one with the LATEST `captured_at`, never "the last one in array
// order". `readSubagentLog` concatenates records across session directories
// in `readdirSync` order, which does not correlate with wall-clock order.
//
// Regla 2 harm line: with two session dirs on disk, an RC-loop re-review
// (an initial BLOCK, later superseded by a real PASS) can report a FALSE
// verdict-mismatch purely because the older record happens to sit last in
// read order — training a reader to distrust (and eventually ignore) this
// tool's output on exactly the case that should read as a clean pass.
//
// RED-GREEN EVIDENCE (do not remove — non-vacuity proof):
//   RED: temporarily reverted pickLatestRecordByCapturedAt's call site back
//        to `matchingRecords[matchingRecords.length - 1]` and re-ran this
//        file — both assertions below failed: the array-order case reported
//        not-corroborated/verdict-mismatch (PASS vs BLOCK) instead of
//        corroborated, and the unparseable-timestamp case reported the same
//        false mismatch instead of corroborated. Restored immediately after
//        confirming red.
//   GREEN: re-ran with the real implementation restored — both assertions
//        passed.
// ---------------------------------------------------------------------------

describe('FIX ROUND — the matching record compared is the one with the latest captured_at, not the array-order-last one', () => {
  it('picks the record with the latest captured_at when the array-order-last record is actually the OLDER one', () => {
    const task = {
      key: 'TASK-930',
      comments: [{ author: 'reviewer', at: '2026-06-02T00:00:00Z', body: '## Verdict\nPASS' }],
    };
    const log = {
      exists: true,
      records: [
        // Newer record (real, superseding PASS) appears FIRST in array order
        // — as would happen if it landed in an earlier-sorted session dir.
        { agent_type: 'reviewer', ticket: 'TASK-930', captured_at: '2026-06-01T00:10:00Z', last_assistant_message: '## Verdict\nPASS' },
        // Older record (a stale, already-superseded BLOCK) appears LAST.
        { agent_type: 'reviewer', ticket: 'TASK-930', captured_at: '2026-06-01T00:00:00Z', last_assistant_message: '## Verdict\nBLOCK' },
      ],
    };
    const result = auditReviewerVerdictProvenance({ task, log });
    expect(result.status).toBe(PROVENANCE_STATUS.CORROBORATED);
  });

  it('a matching record with no parseable captured_at never silently outranks one that has a real timestamp, even when it sits last in array order', () => {
    const task = {
      key: 'TASK-931',
      comments: [{ author: 'reviewer', at: '2026-06-02T00:00:00Z', body: '## Verdict\nPASS' }],
    };
    const log = {
      exists: true,
      records: [
        { agent_type: 'reviewer', ticket: 'TASK-931', captured_at: '2026-06-01T00:00:00Z', last_assistant_message: '## Verdict\nPASS' },
        // No captured_at at all, and it sits LAST in array order — under the
        // old "pick array-order-last" rule this would silently win despite
        // carrying no timestamp at all.
        { agent_type: 'reviewer', ticket: 'TASK-931', last_assistant_message: '## Verdict\nBLOCK' },
      ],
    };
    const result = auditReviewerVerdictProvenance({ task, log });
    expect(result.status).toBe(PROVENANCE_STATUS.CORROBORATED);
  });
});

// ---------------------------------------------------------------------------
// 9. THIRD FIX ROUND (2026-09-10, Case 1 MEDIUM) — a matching record does not
// prove the COMMENT transcribes THAT record when the comment's own `at`
// predates the record's `captured_at`: the record did not exist yet when the
// comment was written. Reproduced live by the reviewer against the module
// fixed in the second round: a pre-hook-era comment (2026-03-01) matched
// against a later, unrelated re-review's record (captured_at 2026-09-10)
// produced not-corroborated/verdict-mismatch — manufacturing a mismatch out
// of two different review rounds.
//
// Regla 2 harm line: without this check, a stale historical comment gets
// silently compared against a record from an unrelated LATER review round
// purely because both happen to carry the same ticket key, producing a false
// verdict-mismatch accusation against a reviewer/orchestrator pair who never
// actually disagreed — the exact false-accusation class this whole fix round
// exists to kill, reintroduced in a narrower (single-ticket) shape by the
// second round's own match-priority fix. The second assertion below proves
// this does not regress the genuinely-absent-record case: no record for the
// ticket at all must still report not-corroborated/no-matching-log-record,
// never unverifiable.
//
// RED-GREEN EVIDENCE (do not remove — non-vacuity proof):
//   RED: temporarily removed the `comment-predates-record` `if` block from
//        auditReviewerVerdictProvenance (src/reviewer-verdict-provenance.js)
//        and re-ran this file — the first assertion below failed: reported
//        not-corroborated/verdict-mismatch (commentVerdict PASS, recordVerdict
//        BLOCK) instead of unverifiable/comment-predates-record. Restored
//        immediately after confirming red.
//   GREEN: re-ran with the real implementation restored — both assertions
//        passed.
// ---------------------------------------------------------------------------

describe('FIX ROUND (third) — a comment predating its own matching record cannot be a transcription of it', () => {
  it('reports unverifiable/comment-predates-record when the comment is older than its matching record, and still reports not-corroborated/no-matching-log-record when no record for the ticket exists at all', () => {
    // Case A: reviewer's exact repro — pre-hook-era comment matched against a
    // later, unrelated re-review's record for the same ticket.
    const predatesTask = {
      key: 'TASK-940',
      comments: [{ author: 'reviewer', at: '2026-03-01T00:00:00Z', body: '## Verdict\nPASS' }],
    };
    const predatesLog = {
      exists: true,
      records: [
        {
          agent_type: 'reviewer',
          ticket: 'TASK-940',
          captured_at: '2026-09-10T00:00:00Z',
          last_assistant_message: '## Verdict\nBLOCK',
        },
      ],
    };
    const resultA = auditReviewerVerdictProvenance({ task: predatesTask, log: predatesLog });
    expect(resultA.status).toBe(PROVENANCE_STATUS.UNVERIFIABLE);
    expect(resultA.reason).toBe('comment-predates-record');

    // Case B: no regression — a ticket with genuinely no matching record at
    // all must still be not-corroborated/no-matching-log-record.
    const absentTask = {
      key: 'TASK-941',
      comments: [{ author: 'reviewer', at: '2026-09-10T00:00:00Z', body: '## Verdict\nPASS' }],
    };
    const absentLog = {
      exists: true,
      records: [
        {
          agent_type: 'reviewer',
          ticket: 'TASK-942',
          captured_at: '2026-09-10T00:00:00Z',
          last_assistant_message: '## Verdict\nPASS',
        },
      ],
    };
    const resultB = auditReviewerVerdictProvenance({ task: absentTask, log: absentLog });
    expect(resultB.status).toBe(PROVENANCE_STATUS.NOT_CORROBORATED);
    expect(resultB.reason).toBe('no-matching-log-record');
  });
});

// ---------------------------------------------------------------------------
// 10. THIRD FIX ROUND (2026-09-10, Case 2 MEDIUM) — the reviewer proved by
// mutation that isTicketCorrelationBrokenAt's time-range comparison was only
// partially locked: three independent mutations survived all 12 pre-existing
// specs — M8 (deleting the open-ended trailing-run push, ~line 334), M11
// (flipping `w.end === null` to `w.end !== null`), and M9 (dropping the
// lower bound `atTime >= w.start`). The open-ended-run shape (M8/M11) is
// exactly the LIVE-SESSION shape: the current null stretch is always
// open-ended while a session is still running.
//
// Regla 2 harm line: without a lock on the open-ended trailing window
// (M8/M11), a refactor that drops it silently turns every ticket reviewed
// during an `active_task: null` stretch that is STILL ONGOING (no later
// correlated record has closed it yet) into a false
// not-corroborated/no-matching-log-record — the exact false-accusation class
// this whole fix round exists to kill, on the one code path (a live session)
// that cannot be caught after the fact. Without the lower bound (M9), a
// comment written safely BEFORE a later null-ticket window opens gets
// wrongly swept into that window and reported unverifiable/
// no-ticket-correlation instead of the real, checkable
// not-corroborated/no-matching-log-record.
//
// RED-GREEN EVIDENCE (do not remove — non-vacuity proof; verified against
// COPIES of the module under /tmp, never against the repo file itself, per
// this round's explicit instruction):
//   RED (M8): copied src/reviewer-verdict-provenance.js, deleted the
//        `if (runStart !== null) windows.push({ start: runStart, end: null })`
//        line, ran the two assertions below against the copy via a throwaway
//        node script — assertion (a) failed: reported
//        not-corroborated/no-matching-log-record instead of
//        unverifiable/no-ticket-correlation (the open-ended window never
//        entered `windows` at all, so `.some(...)` had nothing to match).
//   RED (M11): copied the module, changed `(w.end === null || …)` to
//        `(w.end !== null && …)`, ran the same two assertions against the
//        copy — assertion (a) failed the same way: the open window's `end`
//        is null, so `w.end !== null` is false and the `&&` short-circuits
//        to false regardless of `atTime`, so the window never matches.
//   RED (M9): copied the module, deleted the `atTime >= w.start &&` clause,
//        ran the same two assertions against the copy — assertion (b)
//        failed: a comment safely BEFORE the window's start still matched
//        (an open `end: null` window satisfies the mutated
//        `w.end === null || …` unconditionally, ignoring `atTime` entirely),
//        so it wrongly reported unverifiable/no-ticket-correlation instead
//        of not-corroborated/no-matching-log-record.
//   GREEN: re-ran the same two assertions against the real, unmutated module
//        (this spec file, as committed) — both passed. The three copies
//        under /tmp were discarded; the repo file was never touched.
// ---------------------------------------------------------------------------

describe('FIX ROUND (third) — the null-ticket window check locks the open-ended trailing run and its lower bound', () => {
  it('an ongoing (open-ended) null-ticket window still correlation-breaks a comment inside it, and never sweeps in a comment safely before the window starts', () => {
    const openWindowRecords = [
      {
        agent_type: 'reviewer',
        ticket: 'TASK-950',
        captured_at: '2026-07-01T00:00:00Z',
        last_assistant_message: '## Verdict\nPASS',
      },
      // Opens a null-ticket run that is NEVER closed by a later correlated
      // record — the live-session shape: the current stretch is still open.
      {
        agent_type: 'reviewer',
        ticket: null,
        captured_at: '2026-07-01T01:00:00Z',
        last_assistant_message: '## Verdict\nPASS',
      },
    ];

    // (a) A comment for an unmatched ticket, timestamped INSIDE the
    // open-ended window (after it opened) — must be unverifiable/
    // no-ticket-correlation, never a false not-corroborated verdict.
    const insideOpenTask = {
      key: 'TASK-951',
      comments: [{ author: 'reviewer', at: '2026-07-01T02:00:00Z', body: '## Verdict\nPASS' }],
    };
    const resultA = auditReviewerVerdictProvenance({
      task: insideOpenTask,
      log: { exists: true, records: openWindowRecords },
    });
    expect(resultA.status).toBe(PROVENANCE_STATUS.UNVERIFIABLE);
    expect(resultA.reason).toBe('no-ticket-correlation');

    // (b) A comment for an unmatched ticket, timestamped BEFORE the window
    // even opened — correlation was NOT broken yet at that time, so this
    // must be the real, checkable not-corroborated/no-matching-log-record,
    // never swept into the later window.
    const beforeOpenTask = {
      key: 'TASK-952',
      comments: [{ author: 'reviewer', at: '2026-07-01T00:30:00Z', body: '## Verdict\nPASS' }],
    };
    const resultB = auditReviewerVerdictProvenance({
      task: beforeOpenTask,
      log: { exists: true, records: openWindowRecords },
    });
    expect(resultB.status).toBe(PROVENANCE_STATUS.NOT_CORROBORATED);
    expect(resultB.reason).toBe('no-matching-log-record');
  });
});

// ---------------------------------------------------------------------------
// 11. FOURTH FIX ROUND (2026-09-10, Case 1 — HIGH, reviewer-reproduced on
// this repo's own real board): the third round's comment-predates-record
// check picked the LATEST matching record first and only checked the
// timestamp constraint afterward, so a real, comparable record captured
// BEFORE the comment was thrown away whenever a LATER record also matched by
// ticket (the KNOWN GAP #2 shape: a stale active_task mis-files later,
// unrelated records under this ticket's key). Reproduced live against
// TASK-221: a true same-round record 287s before the comment (token PASS)
// plus later GAP #2 mis-filed records made the buggy code discard the real
// match and bail out as unverifiable — and on forged data (opposite verdict)
// this converted a DETECTED FABRICATION into "could not check".
//
// Regla 2 harm line: without restricting the candidate set BEFORE picking,
// a genuine reviewer verdict-mismatch (a fabricated or drifted transcription)
// on a ticket that also happens to have a later, unrelated mis-filed record
// is silently downgraded from a caught fabrication to "nothing to check" —
// the exact failure this whole module exists to prevent, and the one the
// reviewer measured live on TASK-221's real data.
//
// RED-GREEN EVIDENCE (do not remove — non-vacuity proof; verified against the
// actual pre-fix module content committed at 63fcb12, copied to /tmp, never
// against a reverted copy of the repo file itself):
//   RED: ran this exact assertion against a copy of src/reviewer-verdict-
//        provenance.js as it existed at commit 63fcb12 (git show 63fcb12:...)
//        via a throwaway node script — reported
//        unverifiable/comment-predates-record (message citing the LATER,
//        mis-filed record's captured_at) instead of not-corroborated/
//        verdict-mismatch. The real, earlier, genuinely-comparable BLOCK
//        record was discarded.
//   GREEN: ran the same assertion against the real, fixed module (this repo,
//        as committed in this round) — reported not-corroborated/
//        verdict-mismatch, commentVerdict PASS, recordVerdict BLOCK (the
//        earlier record), as expected.
// ---------------------------------------------------------------------------

describe('FOURTH FIX ROUND — the candidate set is restricted to records at-or-before the comment BEFORE picking the latest one', () => {
  it('a real, earlier matching record is compared (and a real mismatch reported) even when a later, unrelated record also matches by ticket', () => {
    const task = {
      key: 'TASK-960',
      comments: [{ author: 'reviewer', at: '2026-06-01T00:00:00Z', body: '## Verdict\nPASS' }],
    };
    const log = {
      exists: true,
      records: [
        // Real, comparable match — captured BEFORE the comment.
        { agent_type: 'reviewer', ticket: 'TASK-960', captured_at: '2026-05-31T23:00:00Z', last_assistant_message: '## Verdict\nBLOCK' },
        // GAP #2 mis-filed record — captured AFTER the comment, same ticket key.
        { agent_type: 'reviewer', ticket: 'TASK-960', captured_at: '2026-06-02T00:00:00Z', last_assistant_message: '## Verdict\nPASS' },
      ],
    };
    const result = auditReviewerVerdictProvenance({ task, log });
    expect(result.status).toBe(PROVENANCE_STATUS.NOT_CORROBORATED);
    expect(result.reason).toBe('verdict-mismatch');
    expect(result.commentVerdict).toBe('PASS');
    expect(result.recordVerdict).toBe('BLOCK');
  });
});

// ---------------------------------------------------------------------------
// 12. FOURTH FIX ROUND (2026-09-10, Case 3 — MEDIUM, surviving mutation on
// the code this round added) — the candidate-set filter must treat "the
// comment has no parseable `at`" as "every matching record is eligible",
// never as "every matching record is somehow after the comment". Dropping
// the `lastCommentAt === null ? matchingRecords : ...` guard survives every
// other spec in this file: `c <= lastCommentAt` with `lastCommentAt === null`
// coerces `null` to `0`, so any record with a real (post-1970) captured_at
// fails the filter and gets excluded — flipping EVERY reviewer comment
// lacking a parseable `at` to unverifiable/comment-predates-record.
//
// Regla 2 harm line: without this guard, a reviewer comment with no
// parseable `at` (a real, unremarkable shape — not every historical comment
// carries one) can never be corroborated against ANY matching record, no
// matter how clearly it agrees or disagrees — silently converting a real,
// checkable verdict-mismatch into "could not check" purely because of a
// missing timestamp field, not because anything was actually incomparable.
//
// RED-GREEN EVIDENCE (do not remove — non-vacuity proof; verified against a
// COPY of the module under /tmp with the guard deleted, never against a
// reverted copy of the repo file itself):
//   RED: copied src/reviewer-verdict-provenance.js, replaced
//        `const eligibleRecords = lastCommentAt === null ? matchingRecords :
//        matchingRecords.filter(...)` with the filter call alone (no
//        null-check branch), ran this exact assertion against the mutated
//        copy — reported unverifiable/comment-predates-record instead of
//        not-corroborated/verdict-mismatch.
//   GREEN: ran the same assertion against the real, unmutated module (this
//        repo, as committed) — reported not-corroborated/verdict-mismatch,
//        commentVerdict PASS, recordVerdict BLOCK, as expected.
// ---------------------------------------------------------------------------

describe('FOURTH FIX ROUND — a comment with no parseable `at` never excludes a real matching record from comparison', () => {
  it('reports the real verdict-mismatch when the comment has no parseable `at` at all', () => {
    const task = {
      key: 'TASK-961',
      comments: [{ author: 'reviewer', body: '## Verdict\nPASS' }],
    };
    const log = {
      exists: true,
      records: [
        { agent_type: 'reviewer', ticket: 'TASK-961', captured_at: '2026-06-01T00:00:00Z', last_assistant_message: '## Verdict\nBLOCK' },
      ],
    };
    const result = auditReviewerVerdictProvenance({ task, log });
    expect(result.status).toBe(PROVENANCE_STATUS.NOT_CORROBORATED);
    expect(result.reason).toBe('verdict-mismatch');
    expect(result.commentVerdict).toBe('PASS');
    expect(result.recordVerdict).toBe('BLOCK');
  });
});
