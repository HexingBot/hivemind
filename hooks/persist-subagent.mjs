#!/usr/bin/env node
/**
 * persist-subagent.mjs — SubagentStop hook: persist every subagent's result
 * to disk, independent of whether the orchestrator is alive to relay it.
 *
 * TASK-219. Reads the SubagentStop JSON payload on stdin (see
 * src/subagent-log.js's header for the payload shape, verified empirically
 * against Claude Code 2.1.233), builds a durable JSONL record via the pure
 * logic in src/subagent-log.js, and appends it to the active session
 * bundle's subagent-log.jsonl (or a repo-root fallback — see
 * resolveLogPath).
 *
 * Reachability of src/ (verified, not assumed): a git-URL plugin install
 * clones the WHOLE repo (see scripts/build-plugin.mjs's header — the reason
 * bin/*.js is bundled into dist/*.cjs is the ABSENCE of node_modules, not
 * the absence of src/). context-monitor/settings-migrate.mjs already
 * imports from '../src/claude-settings.js' as a shipped plugin-level hook,
 * which is direct precedent that a relative import from hooks/ into src/
 * resolves at a real plugin install, as long as the imported module needs
 * no npm dependency. src/subagent-log.js imports only node:fs/node:path, so
 * this script reuses it directly rather than duplicating its logic.
 *
 * AC5 (decided by the human, not re-litigated here): this hook ALWAYS exits
 * 0, no matter what. SubagentStop's exit-2 "block" semantics do not create
 * the missing record — they make the subagent keep working instead of
 * finishing, which is strictly worse than the problem this ticket fixes.
 * Any error is written to stderr for visibility; it never affects the exit
 * code or blocks the subagent from finishing.
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { buildSubagentRecord, resolveActiveTicket, resolveLogPath } from '../src/subagent-log.js';

function readStdin() {
  try {
    const raw = readFileSync(0, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// Resolve the repo root the same way repin.mjs/session-start.mjs do:
// prefer CLAUDE_PROJECT_DIR (set by Claude Code for hook subprocesses),
// falling back to process.cwd().
function resolveRepoRoot() {
  if (process.env.CLAUDE_PROJECT_DIR && process.env.CLAUDE_PROJECT_DIR.length > 0) {
    return process.env.CLAUDE_PROJECT_DIR;
  }
  return process.cwd();
}

try {
  const payload = readStdin();
  const repoRoot = resolveRepoRoot();
  const activeTicket = resolveActiveTicket(repoRoot);
  const record = buildSubagentRecord(payload, { activeTicket });
  const logPath = resolveLogPath(repoRoot);

  const dir = dirname(logPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(logPath, JSON.stringify(record) + '\n', 'utf8');
} catch (err) {
  // Never let a persistence failure block or fail the subagent (AC5).
  process.stderr.write(`persist-subagent.mjs: ${err && err.stack ? err.stack : err}\n`);
}

process.exit(0);
