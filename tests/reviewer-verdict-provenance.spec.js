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
// specs. This file uses 5; two further e2e specs cover the CLI layer (see
// tests/e2e/audit-reviewer-verdict-cli.spec.js) — 7 of 8, under the cap.

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
