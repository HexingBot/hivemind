#!/usr/bin/env node
// bin/audit-close-verification.js
// TASK-234 (WG-H-020) — CLI: for every DONE ticket on the board, report
// whether its close is 'verified', 'not-verified', or 'unverifiable', using
// src/close-verification.js's pure `auditCloseVerification` (the same check,
// not a copy). This is the mechanical way a reader tells a verified close from
// an unverified one — the thing WG-H-020 measured as impossible before.
//
// ADVISORY, NOT A GATE (same decision, same reason, as
// bin/audit-reviewer-verdict.js): never mutates tasks/, never called from the
// close path, never blocks a close. A board full of pre-TASK-234 closes, or a
// consumer project without git, must not lose the ability to close tickets
// over a signal it structurally cannot produce.
//
// THE ONE THING IT WILL NOT DO: collapse "cannot know" into either verdict.
// An unverifiable close is reported as unverifiable, counted separately, and
// never added to the verified count — which is the whole point, since the
// ~208 tickets closed before this record existed all land there permanently.
//
// Usage:
//   node bin/audit-close-verification.js            # human-readable report
//   node bin/audit-close-verification.js --json     # {ok, ...report}
//
// Exit codes (empty-result contract, TASK-192 — mirrors bin/audit-uat.js):
//   0 — board read OK. Two distinct qualified sub-cases, both printed
//       explicitly (never a bare "OK"):
//         (a) examined_count === 0 — no done ticket on the board; nothing to
//             classify.
//         (b) examined_count > 0, not_verified_count === 0 — a qualified pass:
//             "N examined, M unverifiable, 0 not verified".
//   1 — board read/parse failure. {ok:false, code:'E_BOARD_READ_FAILURE'}.
//   2 — not_verified_count > 0. Advisory: a human or CI reads this.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { resolveRepoRoot } from '../src/repo-root.js';
import { TASK_FILENAME_RE } from '../src/task-store.js';
import { computeCloseVerificationReport } from '../src/close-verification.js';

/**
 * Read every tasks/TASK-<digits>.json under `repoRoot`. READ-ONLY. Duplicated
 * from bin/audit-reviewer-verdict.js on the precedent that file itself
 * documents: coupling two bin/ CLIs together is more fragile than this
 * ~15-line function.
 */
export function readBoardTasks(repoRoot) {
  const dir = join(repoRoot, 'tasks');
  let entries;
  try {
    entries = readdirSync(dir);
  } catch (err) {
    throw new Error(`audit-close-verification: could not read ${dir}: ${err.message}`);
  }

  const tasks = [];
  for (const name of entries.filter((n) => TASK_FILENAME_RE.test(n))) {
    const filePath = join(dir, name);
    let raw;
    try {
      raw = readFileSync(filePath, 'utf8');
    } catch (err) {
      throw new Error(`audit-close-verification: could not read ${filePath}: ${err.message}`);
    }
    if (raw.length === 0) continue; // createTask's exclusive-create reservation window, not corruption
    try {
      tasks.push(JSON.parse(raw));
    } catch (err) {
      throw new Error(`audit-close-verification: ${filePath} is not valid JSON: ${err.message}`);
    }
  }
  return tasks;
}

/** Human-readable rendering of a computeCloseVerificationReport result. */
export function formatReport(report) {
  const lines = [];
  lines.push(`tickets_on_board: ${report.total_tickets_on_board}`);
  lines.push(`examined_count (status: done): ${report.examined_count}`);

  if (report.examined_count === 0) {
    lines.push(
      'RESULT: no done ticket on the board — an empty examined set, not a read failure and not a '
        + 'claim that 0 closes are verified.',
    );
    return lines.join('\n');
  }

  lines.push(`verified: ${report.verified.count}`);
  lines.push(`unverifiable: ${report.unverifiable.count}`);
  lines.push(`not_verified: ${report.not_verified.count}`);

  if (report.not_verified.count > 0) {
    for (const t of report.not_verified.tickets) {
      lines.push(`  ${t.key}: ${t.reason} — ${t.message}`);
    }
    lines.push(
      'RESULT: not-verified close(s) found — advisory only, does not block any close.',
    );
  } else {
    lines.push(
      `RESULT: 0 not-verified — QUALIFIED: ${report.examined_count} examined, `
        + `${report.unverifiable.count} unverifiable (could not be checked, NOT a pass), `
        + `${report.verified.count} verified.`,
    );
  }
  return lines.join('\n');
}

/** Exit code for a successfully-computed report. */
export function exitCodeFor(report) {
  return report.not_verified.count > 0 ? 2 : 0;
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

  // WG2-M-06 — re-resolve every done ticket's linked_commits against this
  // repoRoot via real git, instead of trusting each ticket's stored
  // linked_commits_verification record as data (see close-verification.js's
  // module-header note for why that used to be forgeable).
  const report = computeCloseVerificationReport(tasks, { repoRoot });

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
