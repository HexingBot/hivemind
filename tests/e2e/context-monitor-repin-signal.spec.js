// tests/e2e/context-monitor-repin-signal.spec.js
// TASK-209 — reproduces the human-reported break (a plugin update silently
// leaves .claude/settings.json pointing at a plugin version directory that no
// longer exists) and locks the fix: the SessionStart re-pin hook
// (context-monitor/repin.mjs) must not just SILENTLY heal the stale path —
// it must say so, via the same hookSpecificOutput.additionalContext channel
// session-start.mjs already uses for HANDOFF.md restoration, so the repair is
// visible in the session transcript rather than invisible.
//
// AC map (TASK-209):
//   AC1 — the break: a real subprocess run of repin.mjs against a settings.json
//         whose baked path points at a directory that VERIFIABLY does not
//         exist on disk (mirrors "the old version's cache directory was
//         removed by /plugin update").
//   AC2 — detection is not silent: the subprocess's stdout must carry a
//         hookSpecificOutput.additionalContext note describing the repair.
//   AC6 — this is the sensor for the mechanism (see the honest-scope note
//         below for what a real plugin-reinstall would add beyond this).
//
// Honest scope (AC6): this spawns the REAL repin.mjs as a subprocess with the
// same stdin contract and CLAUDE_PLUGIN_ROOT env var Claude Code provides for
// a plugin-level hook, against a real settings.json on a real tmp disk, and
// asserts on both the file mutation and the exact JSON envelope Claude Code's
// SessionStart hook mechanism expects. It does NOT drive an actual
// `claude plugin update` across two installed versions — that requires the
// real Claude Code CLI and the plugin marketplace, which this repo's harness
// cannot simulate. What's covered instead: 100% of the code this ticket
// changed, exercised exactly as production invokes it.
//
// Fix round (REQUEST-CHANGES) — MEDIUM: the original version of this spec
// asserted the repair only on settings.statusLine.command. A regression that
// repaired the statusline and silently dropped hook repair entirely (the
// live HIGH-1 defect: the CANONICAL nested hook shape was never even
// visited) would have passed this spec green. Every command in the file is
// now asserted individually, repairedCount is asserted exactly, and the
// fixture uses the CANONICAL nested shape (hooks/hooks.json's own format —
// see TASK-210's authoritative finding that this, not the legacy flat shape,
// is what Claude Code actually requires).

import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';

afterAll(cleanupAll);

const __thisDir = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__thisDir, '..', '..');
const REPIN_SCRIPT = join(REPO_ROOT, 'context-monitor', 'repin.mjs');
const ACTUAL_CM_DIR = join(REPO_ROOT, 'context-monitor');

// A directory shaped like a removed plugin-version cache dir. Verified below
// to genuinely not exist on disk — this is the literal "old version directory
// no longer exists" scenario from the ticket, not a placeholder string.
const REMOVED_VERSION_DIR = join(
  tmpdir(),
  `hivemind-removed-plugin-v0.18.0-${Date.now()}`,
  'context-monitor',
);

/** Canonical NESTED shape — matches hooks/hooks.json's own format (TASK-210). */
function writeStaleSettingsNested(claudeDir, staleCmDir) {
  mkdirSync(claudeDir, { recursive: true });
  const settings = {
    statusLine: {
      type: 'command',
      command: `node "${join(staleCmDir, 'statusline.mjs')}"`,
    },
    hooks: {
      Stop: [
        {
          hooks: [
            { type: 'command', command: `node "${join(staleCmDir, 'stop-hook.mjs')}"` },
          ],
        },
      ],
      SessionStart: [
        {
          matcher: 'clear|compact',
          hooks: [
            { type: 'command', command: `node "${join(staleCmDir, 'session-start.mjs')}"` },
          ],
        },
      ],
    },
  };
  const settingsPath = join(claudeDir, 'settings.json');
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  return settingsPath;
}

/** Legacy FLAT shape — command directly on the array element. */
function writeStaleSettingsFlat(claudeDir, staleCmDir) {
  mkdirSync(claudeDir, { recursive: true });
  const settings = {
    statusLine: {
      type: 'command',
      command: `node "${join(staleCmDir, 'statusline.mjs')}"`,
    },
    hooks: {
      Stop: [
        { type: 'command', command: `node "${join(staleCmDir, 'stop-hook.mjs')}"` },
      ],
      SessionStart: [
        {
          type: 'command',
          matcher: 'clear|compact',
          command: `node "${join(staleCmDir, 'session-start.mjs')}"`,
        },
      ],
    },
  };
  const settingsPath = join(claudeDir, 'settings.json');
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  return settingsPath;
}

function runRepin(repoDir) {
  return spawnSync('node', [REPIN_SCRIPT], {
    input: JSON.stringify({ cwd: repoDir }),
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: REPO_ROOT },
  });
}

describe('TASK-209 AC1/AC2/AC6 — repin.mjs reports a stale-path repair, not just heals it silently', () => {
  it('sanity: the stale directory used in this test genuinely does not exist on disk', () => {
    expect(existsSync(REMOVED_VERSION_DIR)).toBe(false);
  });

  it('a real repin.mjs subprocess repairs EVERY command (statusLine + BOTH nested hooks) AND emits an honest additionalContext note', () => {
    const repoDir = makeTmpDir('repin-signal-nested');
    const claudeDir = join(repoDir, '.claude');
    const settingsPath = writeStaleSettingsNested(claudeDir, REMOVED_VERSION_DIR);

    const result = runRepin(repoDir);

    expect(result.status).toBe(0);

    // MEDIUM fix — assert every command in the file individually, not just
    // statusLine. This is what would have caught HIGH-1 (nested hooks
    // silently unrepaired while statusLine quietly got fixed).
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    expect(settings.statusLine.command).toContain(ACTUAL_CM_DIR);
    expect(settings.statusLine.command).not.toContain(REMOVED_VERSION_DIR);
    expect(settings.hooks.Stop[0].hooks[0].command).toContain(ACTUAL_CM_DIR);
    expect(settings.hooks.Stop[0].hooks[0].command).not.toContain(REMOVED_VERSION_DIR);
    expect(settings.hooks.SessionStart[0].hooks[0].command).toContain(ACTUAL_CM_DIR);
    expect(settings.hooks.SessionStart[0].hooks[0].command).not.toContain(REMOVED_VERSION_DIR);
    // matcher and shape (nested, not flattened) survive repair untouched.
    expect(settings.hooks.SessionStart[0].matcher).toBe('clear|compact');
    expect(Array.isArray(settings.hooks.SessionStart[0].hooks)).toBe(true);

    // The repair must not be silent, and must not over-claim: stdout must
    // carry a SessionStart hookSpecificOutput envelope naming the repair.
    expect(result.stdout.trim().length, 'repin.mjs must print something when it repairs a stale path').toBeGreaterThan(0);

    const parsed = JSON.parse(result.stdout);
    expect(parsed.hookSpecificOutput).toBeDefined();
    expect(parsed.hookSpecificOutput.hookEventName).toBe('SessionStart');
    const msg = parsed.hookSpecificOutput.additionalContext;
    expect(msg).toMatch(/repair/i);
    expect(msg).toMatch(/stale/i);
    // Every one of the 3 commands in the file was actually fixed, so the
    // message may honestly say "no action needed" (HIGH-2's own honesty gate).
    expect(msg).toMatch(/3 stale/);
    expect(msg).toMatch(/no action needed/i);
  });

  it('a real repin.mjs subprocess also repairs the legacy flat hook shape (no regression)', () => {
    const repoDir = makeTmpDir('repin-signal-flat');
    const claudeDir = join(repoDir, '.claude');
    const settingsPath = writeStaleSettingsFlat(claudeDir, REMOVED_VERSION_DIR);

    const result = runRepin(repoDir);

    expect(result.status).toBe(0);

    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    expect(settings.statusLine.command).toContain(ACTUAL_CM_DIR);
    expect(settings.hooks.Stop[0].command).toContain(ACTUAL_CM_DIR);
    expect(settings.hooks.SessionStart[0].command).toContain(ACTUAL_CM_DIR);

    const parsed = JSON.parse(result.stdout);
    expect(parsed.hookSpecificOutput.additionalContext).toMatch(/3 stale/);
    expect(parsed.hookSpecificOutput.additionalContext).toMatch(/no action needed/i);
  });

  it('a real repin.mjs subprocess prints nothing when paths are already current (idempotent, still quiet on no-op)', () => {
    const repoDir = makeTmpDir('repin-signal-noop');
    const claudeDir = join(repoDir, '.claude');
    writeStaleSettingsNested(claudeDir, ACTUAL_CM_DIR);

    const result = runRepin(repoDir);

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('');
  });
});
