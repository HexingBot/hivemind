// tests/context-monitor-repin.spec.js
// TASK-009 — Unit tests for context-monitor/repin.mjs path-healing logic.
//
// These are pure-logic tests (in-memory settings objects, no real disk I/O).
// They import and test the exported helpers from repin.mjs directly.
//
// AC map (TASK-009):
//   AC1a — path-rewrite: stale baked path → current plugin root
//   AC1b — idempotency: no-op when path is already current
//   AC1c — heal-only: does NOT inject entries into a project with none
//   AC1d — safe no-op on missing/malformed settings (never throws)

import { describe, it, expect } from 'vitest';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __thisDir = dirname(fileURLToPath(import.meta.url));
const REPIN_URL = pathToFileURL(join(__thisDir, '..', 'context-monitor', 'repin.mjs')).href;

// Dynamic import so the test fails for the RIGHT reason when file doesn't exist.
const {
  repinSettingsObject,
  isContextMonitorCommand,
  repinCommand,
} = await import(REPIN_URL);

// ---------------------------------------------------------------------------
// Helper: build a settings object with context-monitor entries at a given dir
// ---------------------------------------------------------------------------

function makeSettings(cmDir) {
  return {
    statusLine: {
      type: 'command',
      command: `node "${join(cmDir, 'statusline.mjs')}"`,
    },
    hooks: {
      Stop: [
        {
          type: 'command',
          command: `node "${join(cmDir, 'stop-hook.mjs')}"`,
        },
      ],
      SessionStart: [
        {
          type: 'command',
          matcher: 'clear|compact',
          command: `node "${join(cmDir, 'session-start.mjs')}"`,
        },
      ],
    },
  };
}

const OLD_CM_DIR = '/old/plugin/v1.0.0/context-monitor';
const NEW_CM_DIR = '/new/plugin/v2.0.0/context-monitor';

// ---------------------------------------------------------------------------
// isContextMonitorCommand — helper to detect context-monitor paths in commands
// ---------------------------------------------------------------------------

describe('isContextMonitorCommand', () => {
  it('returns true for a command referencing statusline.mjs', () => {
    expect(
      isContextMonitorCommand(`node "${OLD_CM_DIR}/statusline.mjs"`),
    ).toBe(true);
  });

  it('returns true for a command referencing stop-hook.mjs', () => {
    expect(
      isContextMonitorCommand(`node "${OLD_CM_DIR}/stop-hook.mjs"`),
    ).toBe(true);
  });

  it('returns true for a command referencing session-start.mjs', () => {
    expect(
      isContextMonitorCommand(`node "${OLD_CM_DIR}/session-start.mjs"`),
    ).toBe(true);
  });

  it('returns true for a command referencing repin.mjs', () => {
    expect(
      isContextMonitorCommand(`node "${OLD_CM_DIR}/repin.mjs"`),
    ).toBe(true);
  });

  it('returns false for an unrelated command', () => {
    expect(
      isContextMonitorCommand('node /some/other/script.mjs'),
    ).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(isContextMonitorCommand(null)).toBe(false);
    expect(isContextMonitorCommand(undefined)).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(isContextMonitorCommand('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// repinCommand — rewrites the directory portion of a context-monitor command
// ---------------------------------------------------------------------------

describe('repinCommand', () => {
  it('replaces the old context-monitor dir with the new one in statusline.mjs command', () => {
    const cmd = `node "${OLD_CM_DIR}/statusline.mjs"`;
    const result = repinCommand(cmd, OLD_CM_DIR, NEW_CM_DIR);
    expect(result).toBe(`node "${NEW_CM_DIR}/statusline.mjs"`);
  });

  it('replaces the old context-monitor dir with the new one in stop-hook.mjs command', () => {
    const cmd = `node "${OLD_CM_DIR}/stop-hook.mjs"`;
    const result = repinCommand(cmd, OLD_CM_DIR, NEW_CM_DIR);
    expect(result).toBe(`node "${NEW_CM_DIR}/stop-hook.mjs"`);
  });

  it('replaces the old context-monitor dir with the new one in session-start.mjs command', () => {
    const cmd = `node "${OLD_CM_DIR}/session-start.mjs"`;
    const result = repinCommand(cmd, OLD_CM_DIR, NEW_CM_DIR);
    expect(result).toBe(`node "${NEW_CM_DIR}/session-start.mjs"`);
  });

  it('is a no-op when oldCmDir equals newCmDir', () => {
    const cmd = `node "${OLD_CM_DIR}/statusline.mjs"`;
    const result = repinCommand(cmd, OLD_CM_DIR, OLD_CM_DIR);
    expect(result).toBe(cmd);
  });
});

// ---------------------------------------------------------------------------
// AC1a — path-rewrite: stale baked path → current plugin root
// ---------------------------------------------------------------------------

describe('AC1a — repinSettingsObject rewrites stale paths to current plugin root', () => {
  it('rewrites the statusLine command when baked dir differs from current', () => {
    const settings = makeSettings(OLD_CM_DIR);
    const result = repinSettingsObject(settings, NEW_CM_DIR);

    expect(result.statusLine.command).toContain(NEW_CM_DIR);
    expect(result.statusLine.command).not.toContain(OLD_CM_DIR);
  });

  it('rewrites Stop hook commands when baked dir differs from current', () => {
    const settings = makeSettings(OLD_CM_DIR);
    const result = repinSettingsObject(settings, NEW_CM_DIR);

    const stopHook = result.hooks.Stop.find((h) => /stop-hook\.mjs/.test(h.command));
    expect(stopHook).toBeDefined();
    expect(stopHook.command).toContain(NEW_CM_DIR);
    expect(stopHook.command).not.toContain(OLD_CM_DIR);
  });

  it('rewrites SessionStart hook commands when baked dir differs from current', () => {
    const settings = makeSettings(OLD_CM_DIR);
    const result = repinSettingsObject(settings, NEW_CM_DIR);

    const ssHook = result.hooks.SessionStart.find((h) => /session-start\.mjs/.test(h.command));
    expect(ssHook).toBeDefined();
    expect(ssHook.command).toContain(NEW_CM_DIR);
    expect(ssHook.command).not.toContain(OLD_CM_DIR);
  });

  it('indicates that a write is needed when paths were stale', () => {
    const settings = makeSettings(OLD_CM_DIR);
    const { needsWrite } = repinSettingsObject(settings, NEW_CM_DIR);
    expect(needsWrite).toBe(true);
  });

  it('preserves other (non-context-monitor) Stop hooks when rewriting', () => {
    const settings = makeSettings(OLD_CM_DIR);
    settings.hooks.Stop.push({ type: 'command', command: 'node /unrelated/hook.mjs' });

    const result = repinSettingsObject(settings, NEW_CM_DIR);

    const unrelated = result.hooks.Stop.find((h) => /unrelated/.test(h.command));
    expect(unrelated).toBeDefined();
    expect(unrelated.command).toBe('node /unrelated/hook.mjs');
  });

  it('preserves unrelated top-level settings keys when rewriting', () => {
    const settings = {
      ...makeSettings(OLD_CM_DIR),
      disableAllHooks: false,
      customKey: 'preserved',
    };

    const result = repinSettingsObject(settings, NEW_CM_DIR);

    expect(result.disableAllHooks).toBe(false);
    expect(result.customKey).toBe('preserved');
  });
});

// ---------------------------------------------------------------------------
// AC1b — idempotency: no-op when the baked path already equals current
// ---------------------------------------------------------------------------

describe('AC1b — repinSettingsObject is a no-op when paths are already current', () => {
  it('returns needsWrite=false when all paths already match the current cm dir', () => {
    const settings = makeSettings(NEW_CM_DIR);
    const { needsWrite } = repinSettingsObject(settings, NEW_CM_DIR);
    expect(needsWrite).toBe(false);
  });

  it('returns the same commands (no mutation) when already current', () => {
    const settings = makeSettings(NEW_CM_DIR);
    const result = repinSettingsObject(settings, NEW_CM_DIR);

    expect(result.statusLine.command).toBe(settings.statusLine.command);
    expect(result.hooks.Stop[0].command).toBe(settings.hooks.Stop[0].command);
    expect(result.hooks.SessionStart[0].command).toBe(settings.hooks.SessionStart[0].command);
  });
});

// ---------------------------------------------------------------------------
// AC1c — heal-only: does NOT add context-monitor entries if none exist
// ---------------------------------------------------------------------------

describe('AC1c — repinSettingsObject never injects entries into a project with none', () => {
  it('returns needsWrite=false for a settings object with no context-monitor entries', () => {
    const settings = {
      disableAllHooks: false,
      customKey: 'untouched',
    };

    const { needsWrite } = repinSettingsObject(settings, NEW_CM_DIR);
    expect(needsWrite).toBe(false);
  });

  it('does not add statusLine when none exists', () => {
    const settings = {
      hooks: {
        Stop: [{ type: 'command', command: 'node /unrelated/hook.mjs' }],
      },
    };

    const result = repinSettingsObject(settings, NEW_CM_DIR);
    expect(result.statusLine).toBeUndefined();
  });

  it('does not add Stop hook entries when none reference context-monitor', () => {
    const settings = {
      hooks: {
        Stop: [{ type: 'command', command: 'node /unrelated/hook.mjs' }],
      },
    };

    const result = repinSettingsObject(settings, NEW_CM_DIR);
    expect(result.hooks.Stop).toHaveLength(1);
    expect(result.hooks.Stop[0].command).toBe('node /unrelated/hook.mjs');
  });

  it('does not add SessionStart hook entries when none reference context-monitor', () => {
    const settings = {
      hooks: {
        SessionStart: [{ type: 'command', command: 'node /unrelated/start.mjs' }],
      },
    };

    const result = repinSettingsObject(settings, NEW_CM_DIR);
    expect(result.hooks.SessionStart).toHaveLength(1);
    expect(result.hooks.SessionStart[0].command).toBe('node /unrelated/start.mjs');
  });

  it('returns needsWrite=false for a completely empty settings object', () => {
    const { needsWrite } = repinSettingsObject({}, NEW_CM_DIR);
    expect(needsWrite).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC1d — safe no-op on missing/malformed settings: never throws
// ---------------------------------------------------------------------------

describe('AC1d — repinSettingsObject is safe on edge-case / malformed inputs', () => {
  it('returns needsWrite=false for null settings', () => {
    const { needsWrite } = repinSettingsObject(null, NEW_CM_DIR);
    expect(needsWrite).toBe(false);
  });

  it('returns needsWrite=false for undefined settings', () => {
    const { needsWrite } = repinSettingsObject(undefined, NEW_CM_DIR);
    expect(needsWrite).toBe(false);
  });

  it('returns needsWrite=false for a settings array (malformed JSON)', () => {
    const { needsWrite } = repinSettingsObject([], NEW_CM_DIR);
    expect(needsWrite).toBe(false);
  });

  it('returns needsWrite=false for a settings string (malformed JSON)', () => {
    const { needsWrite } = repinSettingsObject('invalid', NEW_CM_DIR);
    expect(needsWrite).toBe(false);
  });

  it('does not throw when hooks is null', () => {
    const settings = { statusLine: null, hooks: null };
    expect(() => repinSettingsObject(settings, NEW_CM_DIR)).not.toThrow();
  });

  it('does not throw when hooks.Stop is not an array', () => {
    const settings = {
      statusLine: null,
      hooks: { Stop: 'not-an-array', SessionStart: [] },
    };
    expect(() => repinSettingsObject(settings, NEW_CM_DIR)).not.toThrow();
  });

  it('does not throw when statusLine.command is not a string', () => {
    const settings = {
      statusLine: { type: 'command', command: 42 },
      hooks: {},
    };
    expect(() => repinSettingsObject(settings, NEW_CM_DIR)).not.toThrow();
  });
});
