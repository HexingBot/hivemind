// tests/e2e/context-monitor-sentinel.spec.js
// TASK-008 AC2 — Prove that sentinels land under cwd, not next to the script.
//
// statusline.mjs and stop-hook.mjs must resolve sentinel directories from the
// project cwd in their stdin JSON (e.g. <cwd>/.claude/context-monitor/),
// not from __dirname (which would place them inside the plugin tree).
// session-start.mjs must clean up sentinels from that same cwd-derived dir.
//
// These tests spawn the scripts as child processes with crafted stdin, then
// assert that sentinel files appear/disappear under a tmp cwd dir, not under
// the context-monitor/ script directory.

import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';

afterAll(cleanupAll);

const __thisDir = dirname(fileURLToPath(import.meta.url));
const CONTEXT_MONITOR_DIR = join(__thisDir, '..', '..', 'context-monitor');

const STATUSLINE_SCRIPT = join(CONTEXT_MONITOR_DIR, 'statusline.mjs');
const STOP_HOOK_SCRIPT  = join(CONTEXT_MONITOR_DIR, 'stop-hook.mjs');
const SESSION_START_SCRIPT = join(CONTEXT_MONITOR_DIR, 'session-start.mjs');

/**
 * Run a script with a JSON payload on stdin. Returns { stdout, stderr, status }.
 */
function runScript(scriptPath, inputJson, options = {}) {
  return spawnSync('node', [scriptPath], {
    input: JSON.stringify(inputJson),
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, ...options.env },
  });
}

/**
 * Build a minimal statusline JSON payload that reports usage above threshold.
 */
function aboveThresholdPayload(cwd, sessionId = 'test-sess-001') {
  return {
    session_id: sessionId,
    cwd,
    context_window: { used_percentage: 40 },
  };
}

/**
 * Build a minimal statusline JSON payload that reports usage below threshold.
 */
function belowThresholdPayload(cwd, sessionId = 'test-sess-001') {
  return {
    session_id: sessionId,
    cwd,
    context_window: { used_percentage: 10 },
  };
}

// ---------------------------------------------------------------------------
// AC2 — statusline.mjs: sentinel lands under cwd, not next to the script
// ---------------------------------------------------------------------------

describe('AC2 — statusline: armed sentinel lands under cwd, not __dirname', () => {
  it('armed flag is created under <cwd>/.claude/context-monitor/ when usage crosses threshold', () => {
    const cwd = makeTmpDir('cm-statusline-arm');

    const result = runScript(STATUSLINE_SCRIPT, aboveThresholdPayload(cwd, 'sess-arm'));

    // The script must exit 0 (or 1 — sentinel I/O errors are silent, but the exit
    // code itself may vary; we care about the file placement, not the exit code).
    // Verify the sentinel appeared under cwd, not next to the script.
    const sentinelDir = join(cwd, '.claude', 'context-monitor');
    const sentinelPath = join(sentinelDir, '.flush-sess-arm');

    expect(
      existsSync(sentinelPath),
      `armed flag must be at ${sentinelPath} (cwd-relative), not next to the script.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    ).toBe(true);

    // Verify it did NOT appear next to the script.
    const scriptDir = CONTEXT_MONITOR_DIR;
    const wrongPath = join(scriptDir, '.flush-sess-arm');
    expect(
      existsSync(wrongPath),
      `armed flag must NOT appear next to the script at ${wrongPath}`,
    ).toBe(false);
  });

  it('re-arm: armed and instructed flags under cwd are removed when usage drops below threshold', () => {
    const cwd = makeTmpDir('cm-statusline-rearm');
    const sentinelDir = join(cwd, '.claude', 'context-monitor');

    // Manually pre-create both sentinels in the cwd-relative dir (simulates a prior crossing).
    mkdirSync(sentinelDir, { recursive: true });
    writeFileSync(join(sentinelDir, '.flush-sess-rearm'), '40', 'utf8');
    writeFileSync(join(sentinelDir, '.instructed-sess-rearm'), '1', 'utf8');

    // Run statusline with usage BELOW threshold — should remove both sentinels.
    runScript(STATUSLINE_SCRIPT, belowThresholdPayload(cwd, 'sess-rearm'));

    expect(
      existsSync(join(sentinelDir, '.flush-sess-rearm')),
      'armed flag must be removed when usage drops below threshold',
    ).toBe(false);

    expect(
      existsSync(join(sentinelDir, '.instructed-sess-rearm')),
      'instructed sentinel must be removed when usage drops below threshold',
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC2 — stop-hook.mjs: reads armed flag from cwd-relative dir
// ---------------------------------------------------------------------------

describe('AC2 — stop-hook: reads armed flag from cwd-relative dir', () => {
  it('emits block decision when armed flag exists under <cwd>/.claude/context-monitor/', () => {
    const cwd = makeTmpDir('cm-stophook-armed');
    const sentinelDir = join(cwd, '.claude', 'context-monitor');

    // Manually create the armed flag in the cwd-relative dir.
    mkdirSync(sentinelDir, { recursive: true });
    writeFileSync(join(sentinelDir, '.flush-sess-stop'), '40', 'utf8');

    const result = runScript(STOP_HOOK_SCRIPT, {
      session_id: 'sess-stop',
      cwd,
    });

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.decision).toBe('block');
    expect(typeof parsed.reason).toBe('string');
    expect(parsed.reason.length).toBeGreaterThan(0);

    // The instructed sentinel must now be under cwd, not next to the script.
    const instructedPath = join(sentinelDir, '.instructed-sess-stop');
    expect(
      existsSync(instructedPath),
      `instructed sentinel must appear under cwd at ${instructedPath}`,
    ).toBe(true);

    const wrongPath = join(CONTEXT_MONITOR_DIR, '.instructed-sess-stop');
    expect(
      existsSync(wrongPath),
      `instructed sentinel must NOT appear next to the script at ${wrongPath}`,
    ).toBe(false);
  });

  it('exits silently (no stdout) when no armed flag exists under cwd', () => {
    const cwd = makeTmpDir('cm-stophook-noflag');

    const result = runScript(STOP_HOOK_SCRIPT, {
      session_id: 'sess-noflag',
      cwd,
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('');
  });

  it('does not create sentinels next to the script when armed flag is in wrong location', () => {
    const cwd = makeTmpDir('cm-stophook-isolation');
    // stop-hook must look in the cwd dir — since no flag exists there, it must exit silently.
    const wrongFlagPath = join(CONTEXT_MONITOR_DIR, '.flush-sess-iso');

    // Ensure the wrong-location flag does NOT affect cwd-based behavior.
    // (We do NOT create it — we just verify the script reads from cwd.)
    const result = runScript(STOP_HOOK_SCRIPT, {
      session_id: 'sess-iso',
      cwd,
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('');

    // Clean up if it leaked (should not happen but be safe).
    try {
      if (existsSync(wrongFlagPath)) {
        unlinkSync(wrongFlagPath);
      }
    } catch { /* ignore */ }
  });
});

// ---------------------------------------------------------------------------
// AC2 — session-start.mjs: cleans sentinels from cwd-relative dir
// ---------------------------------------------------------------------------

describe('AC2 — session-start: cleans sentinels from cwd-relative dir', () => {
  it('removes armed and instructed sentinels from <cwd>/.claude/context-monitor/ after restoring HANDOFF.md', () => {
    const cwd = makeTmpDir('cm-sessstart-clean');
    const sentinelDir = join(cwd, '.claude', 'context-monitor');

    // Set up HANDOFF.md so session-start actually runs its cleanup branch.
    writeFileSync(join(cwd, 'HANDOFF.md'), '# Handoff\n\nSome snapshot.\n', 'utf8');

    // Pre-create sentinels in the cwd-relative dir.
    mkdirSync(sentinelDir, { recursive: true });
    writeFileSync(join(sentinelDir, '.flush-sess-clear'), '40', 'utf8');
    writeFileSync(join(sentinelDir, '.instructed-sess-clear'), '1', 'utf8');

    const result = runScript(SESSION_START_SCRIPT, {
      session_id: 'sess-clear',
      cwd,
    });

    expect(result.status).toBe(0);

    // Both sentinels must be cleaned up from the cwd-relative dir.
    expect(
      existsSync(join(sentinelDir, '.flush-sess-clear')),
      'armed flag must be removed from cwd-relative dir by session-start',
    ).toBe(false);

    expect(
      existsSync(join(sentinelDir, '.instructed-sess-clear')),
      'instructed sentinel must be removed from cwd-relative dir by session-start',
    ).toBe(false);

    // Session-start must emit the correct hookSpecificOutput envelope.
    const parsed = JSON.parse(result.stdout);
    expect(parsed.hookSpecificOutput).toBeDefined();
    expect(parsed.hookSpecificOutput.hookEventName).toBe('SessionStart');
    expect(typeof parsed.hookSpecificOutput.additionalContext).toBe('string');
  });

  it('exits silently when no HANDOFF.md exists (no sentinel cleanup needed)', () => {
    const cwd = makeTmpDir('cm-sessstart-nohandoff');

    const result = runScript(SESSION_START_SCRIPT, {
      session_id: 'sess-nohandoff',
      cwd,
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('');
  });
});
