#!/usr/bin/env node
/**
 * statusline.mjs — Statusline script for Claude Code.
 *
 * Reads the statusline JSON from stdin, computes used_percentage via
 * readUsagePercent, prints a one-line status.
 *
 * State-machine (see usage.mjs for the full design comment):
 *   - When usage >= THRESHOLD and the armed flag does NOT exist: write the
 *     armed flag (signals the stop-hook that a crossing just happened).
 *   - When usage < THRESHOLD and the armed flag exists: remove BOTH the armed
 *     flag and the instructed sentinel. This is the legitimate re-arm — the
 *     next crossing above the threshold will fire a fresh instruction.
 *
 * Flag file directory (RELOCATION-SAFE):
 *   Sentinels are placed under <cwd>/.claude/context-monitor/ where cwd is
 *   read from the stdin JSON (data.cwd), falling back to process.cwd().
 *   This ensures sentinels are per-project (under the consuming project's
 *   tree), not next to this script (which would put them inside the plugin
 *   directory, shared across all projects and potentially read-only).
 *
 *   armed      — .flush-<session_id>       (written here, read by stop-hook)
 *   instructed — .instructed-<session_id>  (written by stop-hook, cleared here)
 *
 * Falls back to session id "default" when session_id is absent.
 * Never throws on bad stdin or file I/O.
 *
 * Deliberate trade-off: "exactly once per crossing" is favored over "nag every
 * turn". If the model ignores the single instruction, re-arm happens when %
 * next drops below THRESHOLD or after a /clear.
 */

import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { THRESHOLD, readUsagePercent, shouldFlush, armedFlagName, instructedFlagName } from './usage.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Resolve the sentinel directory from the project cwd.
 * Uses data.cwd (from the statusline JSON) so sentinels land under the
 * consuming project's tree, not next to this script.
 *
 * @param {object} data - parsed stdin JSON
 * @returns {string} absolute path to the sentinel directory
 */
function sentinelDir(data) {
  const cwd = (data && data.cwd) ? data.cwd : process.cwd();
  return join(cwd, '.claude', 'context-monitor');
}

function flagPath(dir, filename) {
  return join(dir, filename);
}

/**
 * Atomically write a file using a temp-file + rename pattern.
 * On Windows, rename is not truly atomic but is still safer than direct write.
 */
function atomicWrite(filePath, content) {
  const tmp = filePath + '.tmp';
  writeFileSync(tmp, content, 'utf8');
  try {
    renameSync(tmp, filePath);
  } catch {
    // Fallback: direct write if rename fails (Windows cross-device edge case)
    writeFileSync(filePath, content, 'utf8');
    try { unlinkSync(tmp); } catch { /* ignore */ }
  }
}

function bar(pct) {
  const width = 10;
  const filled = Math.min(width, Math.round((pct / 100) * width));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const data = readStdin();
const sessionId = data?.session_id || 'default';
const percent = readUsagePercent(data);

const dir = sentinelDir(data);
const armedPath = flagPath(dir, armedFlagName(sessionId));
const instructedPath = flagPath(dir, instructedFlagName(sessionId));
const alreadyArmed = existsSync(armedPath);

// Side-effect: manage the state-machine flag files
if (shouldFlush(percent, alreadyArmed)) {
  // Usage crossed threshold and not yet armed — write the armed flag.
  // The stop-hook will detect this and emit the one-time block instruction.
  try { mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  try { atomicWrite(armedPath, String(percent ?? '')); } catch { /* ignore */ }
} else if (percent !== null && percent < THRESHOLD && alreadyArmed) {
  // Usage dropped back below threshold — remove BOTH the armed flag and the
  // instructed sentinel so a future crossing can re-arm cleanly.
  try { unlinkSync(armedPath); } catch { /* ignore */ }
  try { unlinkSync(instructedPath); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Output line
// ---------------------------------------------------------------------------

const RESET = '\x1b[0m';
let color = '\x1b[32m'; // green — below threshold
if (percent !== null && percent >= THRESHOLD) color = '\x1b[33m'; // yellow — warning
if (percent !== null && percent >= THRESHOLD + 15) color = '\x1b[31m'; // red — critical

const pctStr = percent !== null ? percent.toFixed(1) : '?.?';
const barStr = percent !== null ? bar(percent) : '░'.repeat(10);

const warn = (percent !== null && percent >= THRESHOLD)
  ? `  ⚠ FLUSH NEEDED (>=${THRESHOLD}%)`
  : '';

process.stdout.write(
  `${color}ctx ${barStr} ${pctStr}%${RESET}${warn}`
);
