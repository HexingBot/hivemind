#!/usr/bin/env node
/**
 * session-start.mjs — SessionStart hook for Claude Code.
 *
 * Matcher: clear|compact
 *
 * Fires after /clear or /compact. If HANDOFF.md exists at the project root,
 * emits the correct SessionStart envelope so Claude can restore in-flight work.
 * Safe no-op if HANDOFF.md is absent.
 *
 * After restoring HANDOFF.md, deletes both the armed flag and the instructed
 * sentinel so that the next threshold crossing re-arms cleanly (AC2 idempotency).
 *
 * Sentinel directory (RELOCATION-SAFE):
 *   Sentinels are placed under <cwd>/.claude/context-monitor/ where cwd is
 *   read from the stdin JSON (data.cwd), falling back to process.cwd().
 *   This ensures sentinels are per-project, not next to this script.
 *
 * Hook input: JSON on stdin with { session_id, cwd, hook_event_name, ... }
 * Hook output (with HANDOFF.md):
 *   {
 *     "hookSpecificOutput": {
 *       "hookEventName": "SessionStart",
 *       "additionalContext": "<HANDOFF.md contents prefixed with restore notice>"
 *     }
 *   }
 * Hook output (no HANDOFF.md): exit 0 with no stdout.
 *
 * NOTE: The bare top-level { "additionalContext": "..." } shape is silently
 * ignored by Claude Code for SessionStart. The correct envelope is
 * hookSpecificOutput.hookEventName + hookSpecificOutput.additionalContext.
 *
 * Never throws on bad input.
 */

import { readFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { armedFlagName, instructedFlagName } from './usage.mjs';

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return {};
  }
}

const data = readStdin();
const sessionId = data?.session_id || 'default';

// Resolve project root: prefer cwd from hook input, fall back to process.cwd()
const projectRoot = data?.cwd || process.cwd();
const handoffPath = join(projectRoot, 'HANDOFF.md');

// Sentinel directory: always cwd-relative, never next to the script.
const sentinelDirectory = join(projectRoot, '.claude', 'context-monitor');

if (existsSync(handoffPath)) {
  let contents;
  try {
    contents = readFileSync(handoffPath, 'utf8');
  } catch {
    // Unreadable — silently exit
    process.exit(0);
  }

  // After restoring, clear both sentinels so the next crossing re-arms cleanly.
  try { unlinkSync(join(sentinelDirectory, armedFlagName(sessionId))); } catch { /* ignore */ }
  try { unlinkSync(join(sentinelDirectory, instructedFlagName(sessionId))); } catch { /* ignore */ }

  // Emit the correct SessionStart envelope. A bare top-level additionalContext
  // is silently ignored by Claude Code; hookSpecificOutput is required.
  const response = {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: [
        'A HANDOFF.md snapshot was found from the previous session. Restore context from it:',
        '',
        contents,
      ].join('\n'),
    },
  };

  process.stdout.write(JSON.stringify(response));
}

// No HANDOFF.md — exit 0 silently
process.exit(0);
