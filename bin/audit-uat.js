#!/usr/bin/env node
// bin/audit-uat.js
// TASK-223 — CLI: list `status: "done"` tickets missing a valid UAT verdict
// (per task-store.js's hasRecordedUatVerdict — the SAME check the close
// guard enforces, not a copy), split into a frozen historical baseline
// (closed on/before docs/uat-baseline.md's cutoff date) and actionable
// violations (closed after it). See docs/uat-baseline.md for the cutoff's
// justification and the measured baseline this ticket's own first run
// produced.
//
// Usage:
//   node bin/audit-uat.js             # human-readable report on stdout
//   node bin/audit-uat.js --json      # {ok, ...report} on stdout
//
// Exit codes (TASK-223 AC6 — empty-result contract: an ambiguous
// empty/zero result must be distinguishable from "the thing that finds
// work is broken and found nothing"):
//   0 — board read OK, no actionable (post-cutoff) violations. Two distinct
//       sub-cases, both printed explicitly (never a bare "OK"):
//         (a) examined_done_count > 0 — a QUALIFIED zero: "N done tickets
//             examined, N_baseline frozen, 0 actionable".
//         (b) examined_done_count === 0 — a DIFFERENT qualified message:
//             "no done tickets on the board to examine" (nothing to audit,
//             not a pass on an audited set).
//   1 — board read/parse failure (tasks/ missing or unreadable, or a task
//       file failed to parse). `{ok:false, code:'E_BOARD_READ_FAILURE',
//       message}` on stdout, message on stderr — mirrors bin/pack-ctl.js's
//       {ok:false, code, message} convention.
//   2 — actionable.count > 0 — real, post-cutoff violations found. Distinct
//       from a read failure so a CI gate can tell "the audit ran and found
//       a real regression" apart from "the audit itself is broken".

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { resolveRepoRoot } from '../src/repo-root.js';
import { TASK_FILENAME_RE } from '../src/task-store.js';
import { computeUatAuditReport } from '../src/uat-audit.js';

/**
 * Read every tasks/TASK-<digits>.json file under `repoRoot` and parse it.
 * READ-ONLY (AC5): uses only readdirSync/readFileSync, never opens tasks/ in
 * a write mode — no mkdirSync, no writeFileSync, no rename, ever. Throws
 * with a descriptive message on any read/parse failure so the caller can
 * distinguish "board unreadable" from "board read fine, zero results"
 * (AC6).
 */
export function readBoardTasks(repoRoot) {
  const dir = join(repoRoot, 'tasks');
  let entries;
  try {
    entries = readdirSync(dir);
  } catch (err) {
    throw new Error(`audit-uat: could not read ${dir}: ${err.message}`);
  }

  const files = entries.filter((name) => TASK_FILENAME_RE.test(name));
  const tasks = [];
  for (const name of files) {
    const filePath = join(dir, name);
    let raw;
    try {
      raw = readFileSync(filePath, 'utf8');
    } catch (err) {
      throw new Error(`audit-uat: could not read ${filePath}: ${err.message}`);
    }
    // A zero-byte file is createTask's exclusive-create reservation window,
    // not corruption — same policy as task-store.js's readAllTasks. Skipped
    // silently; non-empty invalid JSON still throws below.
    if (raw.length === 0) continue;
    try {
      tasks.push(JSON.parse(raw));
    } catch (err) {
      throw new Error(`audit-uat: ${filePath} is not valid JSON: ${err.message}`);
    }
  }
  return tasks;
}

/** Human-readable rendering of a computeUatAuditReport result. */
export function formatReport(report) {
  const lines = [];
  lines.push(`cutoff_date: ${report.cutoff_date}`);
  lines.push(`tickets_on_board: ${report.total_tickets_on_board}`);
  lines.push(`done_tickets_examined: ${report.examined_done_count}`);

  if (report.examined_done_count === 0) {
    lines.push(
      'RESULT: no done tickets on the board to examine — an empty examined set, '
        + 'not a read failure and not a claim that 0 tickets are compliant.',
    );
    return lines.join('\n');
  }

  lines.push(`missing_uat_total: ${report.missing_uat_total}`);
  lines.push(
    `baseline (frozen, closed on/before ${report.cutoff_date}): ${report.baseline.count}`
      + ` — by tier: ${JSON.stringify(report.baseline.by_tier)}`,
  );
  lines.push(`actionable (closed after ${report.cutoff_date}): ${report.actionable.count}`);

  if (report.actionable.count > 0) {
    lines.push(`  ${report.actionable.tickets.map((t) => t.key).join(', ')}`);
    lines.push('RESULT: actionable violations found — see docs/uat-baseline.md.');
  } else {
    lines.push(
      `RESULT: 0 actionable violations — QUALIFIED: board read OK, `
        + `${report.examined_done_count} done ticket(s) examined, `
        + `${report.baseline.count} frozen baseline, 0 actionable.`,
    );
  }
  return lines.join('\n');
}

/** Exit code for a successfully-computed report (AC6 — see header table). */
export function exitCodeFor(report) {
  return report.actionable.count > 0 ? 2 : 0;
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

  const report = computeUatAuditReport({ tasks });

  if (asJson) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ok: true, ...report }));
  } else {
    // eslint-disable-next-line no-console
    console.log(formatReport(report));
  }

  process.exitCode = exitCodeFor(report);
}

// Only run when invoked as the entry script (not on import from tests) —
// same convention as bin/task-board.js and bin/pack-ctl.js.
const __isEntry = import.meta.url
  ? Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href
  : (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module);

if (__isEntry) main();
