#!/usr/bin/env node
// bin/loop-ctl.js
// TASK-097 — CLI wrapper exposing the loop machinery (session-lock,
// operating-mode, loop-checkpoint, loop-auth) so a plugin-installed project
// (no framework src/ on disk) can drive the autonomous loop via
// ${CLAUDE_PLUGIN_ROOT}/dist/loop-ctl.cjs. See commands/loop.md,
// commands/mode.md, and the orchestrator-routing SKILL.md for the calling
// contract this CLI implements.
//
// Subcommands:
//   acquire          --repo-root <path> [--holder <id>] [--staleness-ms <n>]
//   renew            --repo-root <path> [--holder <id>]
//   release          --repo-root <path> [--holder <id>]
//   get-mode         --repo-root <path>
//   set-mode         --repo-root <path> --mode <harness|loop>
//   checkpoint       --repo-root <path> --current-ticket <key> --phase <phase>
//                    [--iteration <n>] [--completed-this-run <n>] [--run-started-at <iso>]
//   resume-point     --repo-root <path>
//   landed-commits   --key <ticket-key>   (reads `git log --oneline` output from
//                    stdin — TASK-100: backs the reset protocol's pre-discard
//                    git-log check; does not spawn git itself, --repo-root not
//                    needed)
//   grant-unattended --repo-root <path> [--opt-in <switch>]...
//   compact-bundle   --repo-root <path> [--max-decisions <n>] [--max-subagent-results <n>]
//                    (TASK-103 — rotates decisions/subagent_results beyond the
//                    documented cap into the bundle's archive.jsonl; see
//                    src/bundle-compaction.js)
//   drafts-count     --repo-root <path>
//                    (TASK-111 AC4 — wraps listDraftEntries (src/knowledge.js)
//                    so a live draftEntryCount can feed consolidationGate at
//                    Gate 5 instead of the human hand-counting
//                    knowledge/proposed/; see commands/loop.md's Gate 5.)
//
// `--repo-root` may be omitted; it then falls back to CLAUDE_PROJECT_DIR or
// process.cwd() (src/repo-root.js's existing resolution policy).
//
// Output contract: every subcommand prints exactly one JSON line to stdout —
// `{ ok: true, ... }` on success (exit 0), or `{ ok: false, code, message }`
// on failure (exit 1; `message` also goes to stderr). `code` mirrors the
// thrown error's `.code` when present (e.g. E_LOCK_HELD, E_BUNDLE_MISSING),
// otherwise 'E_ARGS' for CLI-level argument problems.

import { pathToFileURL } from 'node:url';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { resolveRepoRoot } from '../src/repo-root.js';
import { acquire, renew, release } from '../src/session-lock.js';
import { getMode, setMode } from '../src/operating-mode.js';
import { writeLoopCheckpoint, resumePoint, ticketHasLandedCommits } from '../src/loop-checkpoint.js';
import { grantUnattended } from '../src/loop-auth.js';
import { readPointer } from '../src/pointer.js';
import { readBundleSession } from '../src/bundle.js';
import { compactBundleSession } from '../src/bundle-compaction.js';
import { TASK_FILENAME_RE } from '../src/task-store.js';
import { listDraftEntries } from '../src/knowledge.js';

const SUBCOMMANDS = new Set([
  'acquire', 'renew', 'release',
  'get-mode', 'set-mode',
  'checkpoint', 'resume-point', 'landed-commits',
  'grant-unattended', 'compact-bundle', 'drafts-count',
]);

// Known single-value flags per subcommand (kebab-case, as typed on the CLI).
const FLAG_SPEC = {
  acquire: ['--repo-root', '--holder', '--staleness-ms'],
  renew: ['--repo-root', '--holder'],
  release: ['--repo-root', '--holder'],
  'get-mode': ['--repo-root'],
  'set-mode': ['--repo-root', '--mode'],
  checkpoint: [
    '--repo-root', '--current-ticket', '--phase', '--iteration',
    '--completed-this-run', '--run-started-at',
  ],
  'resume-point': ['--repo-root'],
  'landed-commits': ['--key'],
  'grant-unattended': ['--repo-root'],
  'compact-bundle': ['--repo-root', '--max-decisions', '--max-subagent-results'],
  'drafts-count': ['--repo-root'],
};

function kebabToCamel(flag) {
  return flag.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/**
 * Parse argv (after the subcommand token) into a plain object. Unknown flags
 * throw immediately (typo protection, no I/O yet). `--opt-in` is special-cased
 * as repeatable for `grant-unattended` only, collected into `optIn` (array).
 */
function parseFlags(subcommand, argv) {
  const known = new Set(FLAG_SPEC[subcommand] || []);
  const repeatable = subcommand === 'grant-unattended' ? '--opt-in' : null;
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === repeatable) {
      const value = argv[++i];
      if (value === undefined) throw new Error(`flag ${flag} requires a value`);
      (out.optIn = out.optIn || []).push(value);
      continue;
    }
    if (!known.has(flag)) throw new Error(`unknown flag for ${subcommand}: ${flag}`);
    const value = argv[++i];
    if (value === undefined) throw new Error(`flag ${flag} requires a value`);
    out[kebabToCamel(flag)] = value;
  }
  return out;
}

function resolveRoot(flags) {
  return flags.repoRoot || resolveRepoRoot(process.env, process.cwd());
}

/** Read every tasks/TASK-NNN.json under repoRoot — mirrors src/task-board.js's
 * readAllTasksForBoard (task-store.js's own readAllTasks is not exported; this
 * follows the same established local-copy convention rather than widening
 * task-store.js's export surface). */
async function readAllTasksForResume(repoRoot) {
  const dir = join(repoRoot, 'tasks');
  let entries;
  try {
    entries = await readdir(dir);
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw err;
  }
  const taskFiles = entries.filter((name) => TASK_FILENAME_RE.test(name));
  const out = [];
  for (const name of taskFiles) {
    const raw = await readFile(join(dir, name), 'utf8');
    if (raw.length === 0) continue; // createTask's exclusive-create reservation window
    out.push(JSON.parse(raw));
  }
  return out;
}

/** Read stdin to completion as a utf8 string. Used by `landed-commits`, which
 * takes its `git log` text over stdin rather than as a CLI arg (a git log can
 * be arbitrarily long/multi-line — unsafe to pass as a single flag value).
 * Callers MUST pipe input (e.g. `git log --oneline | loop-ctl landed-commits
 * --key <key>`); with no pipe attached this waits on stdin's 'end' event. */
function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

/** Resolve the active bundle, tolerating "no active session" / "bundle dir
 * missing" as null (resumePoint itself tolerates a null bundle). */
async function readBundleTolerant(repoRoot) {
  const pointer = readPointer(repoRoot);
  if (!pointer || pointer.active_session_id == null) return null;
  try {
    return readBundleSession(repoRoot, pointer.active_session_id);
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

async function run(subcommand, flags) {
  const repoRoot = resolveRoot(flags);

  switch (subcommand) {
    case 'acquire': {
      const opts = { repoRoot };
      if (flags.holder !== undefined) opts.holder = flags.holder;
      if (flags.stalenessMs !== undefined) {
        const n = Number(flags.stalenessMs);
        if (!Number.isFinite(n)) throw new Error(`--staleness-ms must be a number, got: ${flags.stalenessMs}`);
        opts.stalenessMs = n;
      }
      const result = await acquire(opts);
      return { acquired: result.acquired };
    }
    case 'renew': {
      const opts = { repoRoot };
      if (flags.holder !== undefined) opts.holder = flags.holder;
      const renewed = await renew(opts);
      return { renewed };
    }
    case 'release': {
      const opts = { repoRoot };
      if (flags.holder !== undefined) opts.holder = flags.holder;
      await release(opts);
      return {};
    }
    case 'get-mode': {
      const mode = await getMode({ repoRoot });
      return { mode };
    }
    case 'set-mode': {
      if (!flags.mode) throw new Error('--mode is required');
      await setMode({ repoRoot, mode: flags.mode });
      return { mode: flags.mode };
    }
    case 'checkpoint': {
      // `--current-ticket` has no independent check inside writeLoopCheckpoint
      // (it validates `phase` against LOOP_PHASES but not current_ticket), so
      // an omitted flag would otherwise silently write a checkpoint with no
      // ticket attribution. `--phase` is redundantly caught below too since
      // writeLoopCheckpoint's own LOOP_PHASES check throws on it, but failing
      // fast here keeps the error message CLI-flag-shaped for both.
      // `--current-ticket` has no independent check inside writeLoopCheckpoint
      // (it validates `phase` against LOOP_PHASES but not current_ticket), so
      // an omitted flag would otherwise silently write a checkpoint with no
      // ticket attribution. `--phase` is redundantly caught below too since
      // writeLoopCheckpoint's own LOOP_PHASES check throws on it, but failing
      // fast here keeps the error message CLI-flag-shaped for both.
      const missing = ['currentTicket', 'phase'].filter((k) => flags[k] === undefined);
      if (missing.length > 0) {
        const flagNames = missing.map((k) => `--${k.replace(/([A-Z])/g, '-$1').toLowerCase()}`);
        throw new Error(`missing required flags: ${flagNames.join(', ')}`);
      }
      const checkpoint = {
        current_ticket: flags.currentTicket,
        phase: flags.phase,
        iteration: flags.iteration !== undefined ? Number(flags.iteration) : undefined,
        completed_this_run: flags.completedThisRun !== undefined ? Number(flags.completedThisRun) : undefined,
        run_started_at: flags.runStartedAt,
      };
      await writeLoopCheckpoint({ repoRoot, checkpoint });
      return { written: true };
    }
    case 'resume-point': {
      const bundle = await readBundleTolerant(repoRoot);
      const tasks = await readAllTasksForResume(repoRoot);
      return resumePoint({ bundle, tasks });
    }
    case 'landed-commits': {
      if (!flags.key) throw new Error('missing required flag: --key');
      const gitLog = await readStdin();
      return { hasLandedCommits: ticketHasLandedCommits({ gitLog, key: flags.key }) };
    }
    case 'grant-unattended': {
      const optIns = {};
      for (const key of flags.optIn || []) optIns[key] = true;
      await grantUnattended({ repoRoot, optIns });
      return { granted: true, optIns };
    }
    case 'compact-bundle': {
      const pointer = readPointer(repoRoot);
      if (!pointer || pointer.active_session_id == null) {
        throw new Error('No active session — cannot compact a bundle without an active bundle.');
      }
      const opts = { repoRoot, sessionId: pointer.active_session_id };
      if (flags.maxDecisions !== undefined) {
        const n = Number(flags.maxDecisions);
        if (!Number.isFinite(n)) throw new Error(`--max-decisions must be a number, got: ${flags.maxDecisions}`);
        opts.maxDecisions = n;
      }
      if (flags.maxSubagentResults !== undefined) {
        const n = Number(flags.maxSubagentResults);
        if (!Number.isFinite(n)) throw new Error(`--max-subagent-results must be a number, got: ${flags.maxSubagentResults}`);
        opts.maxSubagentResults = n;
      }
      return compactBundleSession(opts);
    }
    case 'drafts-count': {
      const drafts = listDraftEntries({ repoRoot });
      return { draftEntryCount: drafts.length };
    }
    default:
      throw new Error(`unknown subcommand: ${subcommand}`);
  }
}

async function main() {
  const [subcommand, ...rest] = process.argv.slice(2);
  if (!subcommand || !SUBCOMMANDS.has(subcommand)) {
    throw new Error(`usage: loop-ctl <${[...SUBCOMMANDS].join('|')}> [--flags]`);
  }
  const flags = parseFlags(subcommand, rest);
  const result = await run(subcommand, flags);
  const payload = { ok: true, ...result };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(payload));
}

// Only run when invoked as the entry script (not on import from tests).
const __isEntry = import.meta.url
  ? Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href
  : (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module);

if (__isEntry) {
  main().catch((err) => {
    const payload = { ok: false, code: err.code || 'E_ARGS', message: err.message };
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(payload));
    // eslint-disable-next-line no-console
    console.error(err.message);
    process.exit(1);
  });
}

export { parseFlags, run };
