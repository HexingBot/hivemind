#!/usr/bin/env node
/**
 * stop-hook.mjs — Stop hook for Claude Code.
 *
 * Fires after each assistant turn. Implements the "exactly once per crossing"
 * state machine (see usage.mjs for the full design comment):
 *
 *   - If the armed flag exists AND the instructed sentinel does NOT exist:
 *     emit a block decision with `reason` (the correct Stop hook field) and
 *     write the instructed sentinel so subsequent turns stay silent.
 *   - If both flags exist (already instructed this crossing): exit 0 silently.
 *   - If the armed flag is absent: exit 0 silently (no threshold crossing active).
 *
 * The armed flag is NOT deleted here. It is removed by statusline.mjs when
 * usage drops back below the threshold, or by session-start.mjs after a /clear.
 * This ensures the instruction fires only once per crossing while allowing
 * legitimate re-arms after the context is actually flushed.
 *
 * Hook input: JSON on stdin with { session_id, transcript_path, cwd, ... }
 * Hook output (block):
 *   { "decision": "block", "reason": "<instruction>" }
 * Hook output (pass): exit 0 with no stdout (or empty stdout).
 *
 * NOTE: `reason` is the correct field for Stop hook block messages.
 * `additionalContext` is a UserPromptSubmit/SessionStart field and is silently
 * ignored by the Stop hook — using it would mean the instruction is never seen.
 *
 * Sentinel directory (RELOCATION-SAFE):
 *   Sentinels are placed under <cwd>/.claude/context-monitor/ where cwd is
 *   read from the stdin JSON (data.cwd), falling back to process.cwd().
 *   This ensures sentinels are per-project, not next to this script.
 *
 * Never throws on bad input.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { THRESHOLD, armedFlagName, instructedFlagName } from './usage.mjs';

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Resolve the sentinel directory from the project cwd.
 *
 * @param {object} data - parsed stdin JSON
 * @returns {string} absolute path to the sentinel directory
 */
function sentinelDir(data) {
  const cwd = (data && data.cwd) ? data.cwd : process.cwd();
  return join(cwd, '.claude', 'context-monitor');
}

const data = readStdin();
const sessionId = data?.session_id || 'default';

const dir = sentinelDir(data);
const armedPath = join(dir, armedFlagName(sessionId));
const instructedPath = join(dir, instructedFlagName(sessionId));

const isArmed = existsSync(armedPath);
const alreadyInstructed = existsSync(instructedPath);

if (isArmed && !alreadyInstructed) {
  // First time the stop-hook fires after a threshold crossing.
  // Write the instructed sentinel BEFORE emitting output so that even if
  // Claude Code re-runs the hook, it won't double-instruct.
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(instructedPath, '1', 'utf8');
  } catch { /* ignore */ }

  // Emit the block decision. `reason` is the correct Stop hook field —
  // `additionalContext` is silently ignored by Stop and must NOT be used here.
  const response = {
    decision: 'block',
    reason: `Context usage crossed ${THRESHOLD}%. Snapshot current work to HANDOFF.md (use the pause skill), then run /clear.`,
  };

  process.stdout.write(JSON.stringify(response));
}

// If not armed, or already instructed, exit 0 silently (no block).
process.exit(0);
