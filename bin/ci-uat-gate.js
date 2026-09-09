#!/usr/bin/env node
// bin/ci-uat-gate.js
// TASK-225 — CI gate that promotes TASK-223's board audit into a
// build-blocking check, scoped to only the tickets that actually needed a
// UAT verdict (src/uat-gate.js's needsUat union — the SAME rule
// checkUatGuard enforces at close time) and were closed strictly after the
// frozen baseline cutoff (docs/uat-baseline.md).
//
// Reuses, never duplicates:
//   - readBoardTasks (bin/audit-uat.js) — the same read-only board loader.
//   - computeUatGateReport / classifyGateResult / exitCodeForGateResult
//     (src/uat-gate.js) — the pure engine, itself built on
//     computeUatAuditReport (src/uat-audit.js), filtered.
//   - UAT_BASELINE_CUTOFF_DATE (src/uat-audit.js, re-exported by
//     src/uat-gate.js) — AC6: the cutoff is read from the ONE place it is
//     defined, never redefined or duplicated here or in CI YAML.
//
// Usage:
//   node bin/ci-uat-gate.js             # human-readable report on stdout
//   node bin/ci-uat-gate.js --json      # {ok, result, ...report} on stdout
//
// Exit codes (AC1, AC3, AC4 — the empty-result contract):
//   0 — board read OK. TWO qualitatively different sub-cases, both ALWAYS
//       printed with a distinguishable marker (never a bare "OK" or silent
//       green):
//         (a) ZERO_EXAMINED — no needs-uat done ticket has been closed after
//             the cutoff AT ALL yet (today's real board is entirely in this
//             state: the cutoff is 2026-09-09 and every currently-done
//             needs-uat ticket closed on or before it). "0 actionable
//             violations" here would be indistinguishable from "verified
//             compliant" without this marker — exactly the ambiguity
//             CLAUDE.md's Empty-result contract exists to close.
//         (b) COMPLIANT — 1+ post-cutoff needs-uat done ticket was examined
//             and all of them carry a valid uat verdict. A genuine,
//             qualified green.
//   1 — board read/parse failure. Same {ok:false, code:'E_BOARD_READ_FAILURE',
//       message} convention as bin/audit-uat.js (AC4 — a read failure is
//       always distinguishable from "no incumplimientos" and always
//       non-zero).
//   2 — VIOLATIONS: 1+ post-cutoff needs-uat done ticket is missing a valid
//       uat verdict. The one real, build-blocking failure (AC1).
//
// DESIGN CHOICE — why ZERO_EXAMINED is exit 0, not a hard failure (read this
// before changing it): AC3 requires that a zero-examined gate "no reporta
// verde" — but that is an OUTPUT requirement (a distinguishable marker,
// investigable, never silently indistinguishable from compliance), not an
// exit-code requirement. This ticket's own description supplies the
// precedent to follow verbatim: "el mismo razonamiento exacto que sostiene
// el marcador de seleccion cero de test:since" — and scripts/test-since.mjs's
// TEST_SINCE_ZERO_SELECTION marker is DELIBERATELY non-fatal for its
// `reason=empty-diff` case, because a chronically-red gate on a legitimate
// empty state is alarm fatigue that gets the control disabled entirely (see
// CLAUDE.md's Empty-result contract and this ticket's own "POR QUE ESTA
// SEPARADO DE TASK-224" section, which makes exactly that argument about why
// the board audit was not wired into CI directly on day one). Concretely: a
// hard failure here would red-gate EVERY build starting today, for a state
// that is not a rules violation — nothing has even had the chance to violate
// the rule yet, since the cutoff is today. Only a REAL post-cutoff violation
// (VIOLATIONS, exit 2) is a hard build failure; AC4's board-read failure
// (exit 1) is the other, unrelated non-zero case.
//
// SKIPPED-AS-SATISFIED WARNING for whoever wires branch protection to this
// job (carried into .github/workflows/ci.yml as well, not just here): GitHub
// treats a `skipped` required check as SATISFIED, not failed. This gate is
// therefore deliberately NOT behind an `if: github.event_name == ...`
// conditional in the workflow — it runs unconditionally on every push and
// pull_request this workflow triggers on, so it can never silently pass by
// being skipped the way TASK-224's `fast`/`full` jobs legitimately do (those
// are two DIFFERENT jobs covering two DIFFERENT events; this is one job that
// must cover ALL of them).

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { resolveRepoRoot } from '../src/repo-root.js';
import { TASK_FILENAME_RE } from '../src/task-store.js';
import {
  computeUatGateReport,
  classifyGateResult,
  exitCodeForGateResult,
  GATE_RESULT,
} from '../src/uat-gate.js';

// Deliberately NOT re-imported from bin/audit-uat.js: importing a sibling
// bin/ entry module (which self-executes `main()` on import via its
// __isEntry guard being false in that case — see its own guard, which is
// import.meta.url-keyed and therefore safe) would still work, but coupling
// two `bin/` CLIs together is more fragile than the ~15-line read function
// itself, which has zero logic beyond readdirSync/readFileSync/JSON.parse.
// See bin/audit-uat.js's own readBoardTasks for the byte-for-byte identical
// contract this mirrors (AC5-equivalent read-only guarantee): no write call,
// ever.
function readBoardTasks(repoRoot) {
  const dir = join(repoRoot, 'tasks');
  let entries;
  try {
    entries = readdirSync(dir);
  } catch (err) {
    throw new Error(`ci-uat-gate: could not read ${dir}: ${err.message}`);
  }

  const files = entries.filter((name) => TASK_FILENAME_RE.test(name));
  const tasks = [];
  for (const name of files) {
    const filePath = join(dir, name);
    let raw;
    try {
      raw = readFileSync(filePath, 'utf8');
    } catch (err) {
      throw new Error(`ci-uat-gate: could not read ${filePath}: ${err.message}`);
    }
    if (raw.length === 0) continue; // createTask's exclusive-create reservation window, not corruption
    try {
      tasks.push(JSON.parse(raw));
    } catch (err) {
      throw new Error(`ci-uat-gate: ${filePath} is not valid JSON: ${err.message}`);
    }
  }
  return tasks;
}

/** Human-readable rendering of a computeUatGateReport + its classification. */
export function formatGateReport(report, result) {
  const lines = [];
  lines.push(`cutoff_date: ${report.cutoff_date}`);
  lines.push(`tickets_on_board: ${report.total_tickets_on_board}`);
  lines.push(`needs_uat_done_examined: ${report.examined_done_count}`);
  lines.push(`post_cutoff_needs_uat_done: ${report.post_cutoff_done_count}`);

  if (result === GATE_RESULT.ZERO_EXAMINED) {
    lines.push(
      'RESULT: UAT_GATE_ZERO_EXAMINED — no needs-uat ticket has been closed after '
        + `${report.cutoff_date} yet. This is NOT a claim that the board is compliant; it `
        + 'means the actionable population is currently empty (see bin/ci-uat-gate.js for '
        + 'why this is exit 0 with a marker, not a hard failure, mirroring '
        + 'scripts/test-since.mjs\'s TEST_SINCE_ZERO_SELECTION precedent).',
    );
    return lines.join('\n');
  }

  lines.push(`actionable_violations: ${report.actionable.count}`);

  if (result === GATE_RESULT.VIOLATIONS) {
    lines.push(`  ${report.actionable.tickets.map((t) => t.key).join(', ')}`);
    lines.push(
      'RESULT: UAT_GATE_VIOLATIONS_FOUND — ticket(s) above are status "done", needed a UAT '
        + `verdict, closed after ${report.cutoff_date}, and carry no valid "uat" comment. See `
        + 'docs/uat-baseline.md.',
    );
  } else {
    lines.push(
      `RESULT: UAT_GATE_COMPLIANT — ${report.post_cutoff_done_count} post-cutoff needs-uat `
        + 'done ticket(s) examined, all carry a valid uat verdict.',
    );
  }
  return lines.join('\n');
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

  const report = computeUatGateReport({ tasks });
  const result = classifyGateResult(report);

  if (asJson) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ok: true, result, ...report }));
  } else {
    // eslint-disable-next-line no-console
    console.log(formatGateReport(report, result));
  }

  process.exitCode = exitCodeForGateResult(result);
}

const __isEntry = import.meta.url
  ? Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href
  : (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module);

if (__isEntry) main();
