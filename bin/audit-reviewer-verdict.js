#!/usr/bin/env node
// bin/audit-reviewer-verdict.js
// TASK-217 — CLI: for every ticket carrying an `author: 'reviewer'` comment,
// corroborate it against the durable subagent-log record TASK-219's
// SubagentStop hook already wrote, using src/reviewer-verdict-provenance.js's
// pure `auditReviewerVerdictProvenance` (the same check, not a copy).
//
// ADVISORY, NOT A GATE (AC1/AC6 of TASK-217, decided explicitly, not
// implied): this CLI never mutates tasks/, is never called from the close
// path (src/close-guard.js / task-store.js's transitionStatus/closeTask),
// and never blocks a close. The reason mirrors why
// linked_commits_verification and bin/audit-uat.js are both advisory rather
// than wired into the guard: a consumer project that has never enabled the
// SubagentStop hook, or whose bundle sat with `active_task: null` (see
// src/reviewer-verdict-provenance.js's KNOWN GAP #1), must not lose the
// ability to close tickets over a signal it structurally cannot produce.
// Corroboration is a strictly weaker claim than proof — see this module's
// header and src/reviewer-verdict-provenance.js's own header for why no
// caller identity exists anywhere in this stack to prove authorship instead.
//
// Usage:
//   node bin/audit-reviewer-verdict.js             # human-readable report
//   node bin/audit-reviewer-verdict.js --json       # {ok, ...report}
//
// Exit codes (empty-result contract, TASK-192 — mirrors bin/audit-uat.js):
//   0 — board/log read OK. Two distinct qualified sub-cases, both always
//       printed explicitly (never a bare "OK"):
//         (a) examined_count === 0 — no ticket on the board carries an
//             `author: 'reviewer'` comment yet; nothing to corroborate.
//         (b) examined_count > 0, not_corroborated_count === 0 — a real,
//             qualified pass: "N tickets examined, M unverifiable, 0 not
//             corroborated".
//   1 — board read/parse failure. `{ok:false, code:'E_BOARD_READ_FAILURE',
//       message}` — same convention as bin/audit-uat.js.
//   2 — not_corroborated_count > 0 — 1+ ticket's reviewer comment disagrees
//       with (or has no backing in) the durable log. Advisory: a human or CI
//       reads this, it never blocks close_task by itself (see header above).

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { resolveRepoRoot } from '../src/repo-root.js';
import { TASK_FILENAME_RE } from '../src/task-store.js';
import { auditReviewerVerdictProvenance, readSubagentLog, PROVENANCE_STATUS } from '../src/reviewer-verdict-provenance.js';

/**
 * Read every tasks/TASK-<digits>.json under `repoRoot`. READ-ONLY: never
 * opens tasks/ in a write mode. Deliberately duplicated rather than imported
 * from bin/audit-uat.js — same precedent bin/ci-uat-gate.js already
 * documents (coupling two bin/ CLIs together is more fragile than this
 * ~15-line function).
 */
export function readBoardTasks(repoRoot) {
  const dir = join(repoRoot, 'tasks');
  let entries;
  try {
    entries = readdirSync(dir);
  } catch (err) {
    throw new Error(`audit-reviewer-verdict: could not read ${dir}: ${err.message}`);
  }

  const files = entries.filter((name) => TASK_FILENAME_RE.test(name));
  const tasks = [];
  for (const name of files) {
    const filePath = join(dir, name);
    let raw;
    try {
      raw = readFileSync(filePath, 'utf8');
    } catch (err) {
      throw new Error(`audit-reviewer-verdict: could not read ${filePath}: ${err.message}`);
    }
    if (raw.length === 0) continue; // createTask's exclusive-create reservation window, not corruption
    try {
      tasks.push(JSON.parse(raw));
    } catch (err) {
      throw new Error(`audit-reviewer-verdict: ${filePath} is not valid JSON: ${err.message}`);
    }
  }
  return tasks;
}

/**
 * Compute the audit over an already-loaded task list + log (both read-only
 * I/O owned by the caller — see readBoardTasks/readSubagentLog).
 */
export function computeReviewerVerdictAuditReport({ tasks, log }) {
  const withReviewerComment = tasks.filter(
    (t) => Array.isArray(t.comments) && t.comments.some((c) => c && c.author === 'reviewer'),
  );

  const results = withReviewerComment.map((task) => ({
    key: task.key,
    ...auditReviewerVerdictProvenance({ task, log }),
  }));

  const byStatus = (status) => results.filter((r) => r.status === status);

  return {
    total_tickets_on_board: tasks.length,
    examined_count: results.length,
    corroborated: { count: byStatus(PROVENANCE_STATUS.CORROBORATED).length },
    not_corroborated: {
      count: byStatus(PROVENANCE_STATUS.NOT_CORROBORATED).length,
      tickets: byStatus(PROVENANCE_STATUS.NOT_CORROBORATED),
    },
    unverifiable: {
      count: byStatus(PROVENANCE_STATUS.UNVERIFIABLE).length,
      tickets: byStatus(PROVENANCE_STATUS.UNVERIFIABLE),
    },
  };
}

/** Human-readable rendering of a computeReviewerVerdictAuditReport result. */
export function formatReport(report) {
  const lines = [];
  lines.push(`tickets_on_board: ${report.total_tickets_on_board}`);
  lines.push(`examined_count (have an author:'reviewer' comment): ${report.examined_count}`);

  if (report.examined_count === 0) {
    lines.push(
      'RESULT: no ticket on the board carries an author:\'reviewer\' comment yet — an '
        + 'empty examined set, not a read failure and not a claim that 0 tickets are corroborated.',
    );
    return lines.join('\n');
  }

  lines.push(`corroborated: ${report.corroborated.count}`);
  lines.push(`unverifiable: ${report.unverifiable.count}`);
  lines.push(`not_corroborated: ${report.not_corroborated.count}`);

  if (report.not_corroborated.count > 0) {
    for (const t of report.not_corroborated.tickets) {
      lines.push(`  ${t.key}: ${t.reason} — ${t.message}`);
    }
    lines.push(
      'RESULT: not-corroborated ticket(s) found — advisory only, does not block any close. '
        + 'See src/reviewer-verdict-provenance.js for what this can and cannot prove.',
    );
  } else {
    lines.push(
      `RESULT: 0 not-corroborated — QUALIFIED: ${report.examined_count} examined, `
        + `${report.unverifiable.count} unverifiable (could not be checked, not a pass), `
        + `${report.corroborated.count} corroborated.`,
    );
  }
  return lines.join('\n');
}

/** Exit code for a successfully-computed report. */
export function exitCodeFor(report) {
  return report.not_corroborated.count > 0 ? 2 : 0;
}

export function main(argv = process.argv.slice(2)) {
  const asJson = argv.includes('--json');
  const repoRoot = resolveRepoRoot(process.env, process.cwd());

  let tasks;
  try {
    tasks = readBoardTasks(repoRoot);
  } catch (err) {
    const payload = { ok: false, code: 'E_BOARD_READ_FAILURE', message: err.message };
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(payload));
    // eslint-disable-next-line no-console
    console.error(err.message);
    process.exitCode = 1;
    return;
  }

  const log = readSubagentLog(repoRoot);
  const report = computeReviewerVerdictAuditReport({ tasks, log });

  if (asJson) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ok: true, ...report }));
  } else {
    // eslint-disable-next-line no-console
    console.log(formatReport(report));
  }

  process.exitCode = exitCodeFor(report);
}

const __isEntry = import.meta.url
  ? Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href
  : (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module);

if (__isEntry) main();
