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
// specs. This file uses 6 (see the "coverage window" spec added in the
// TASK-217 fix round below); two further e2e specs cover the CLI layer (see
// tests/e2e/audit-reviewer-verdict-cli.spec.js) — 8 of 8, at the cap.
//
// FIX ROUND (2026-09-10) — the empty-result collapse this ticket's own
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
