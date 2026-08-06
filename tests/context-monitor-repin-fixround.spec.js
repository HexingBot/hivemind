// tests/context-monitor-repin-fixround.spec.js
// TASK-209 fix round (REQUEST-CHANGES, 4 HIGH) — unit-level locks for the
// findings the reviewer confirmed live:
//
//   HIGH-1 — repinSettingsObject only walked the LEGACY flat hook shape
//            (`{ type, command }` on the array element) and was structurally
//            blind to the CANONICAL nested shape (`{ matcher?, hooks: [{ type,
//            command }] }` — the shape hooks/hooks.json itself uses). Against
//            a nested-shape settings.json, every hook command survived
//            unrepaired while statusLine quietly got fixed — exactly the
//            human's lived symptom (statusline recovers, hooks stay dead).
//   HIGH-2 — buildRepinReportMessage unconditionally claimed "the statusline
//            and context-monitor hooks are now re-pointed... no action
//            needed", regardless of whether that was true. Under HIGH-1 that
//            was a FALSE ALL-CLEAR — worse than the silence it replaced.
//   LOW    — a pure separator-only path comparison treated a case-only
//            difference (Windows is case-insensitive) as "stale", producing a
//            spurious rewrite/report every session.
//
// These are pure in-memory tests (no subprocess, no disk) — see
// tests/e2e/context-monitor-repin-signal.spec.js for the real-subprocess,
// real-disk companion coverage of the same fix.

import { describe, it, expect } from 'vitest';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __thisDir = dirname(fileURLToPath(import.meta.url));
const REPIN_URL = pathToFileURL(join(__thisDir, '..', 'context-monitor', 'repin.mjs')).href;

const { repinSettingsObject, buildRepinReportMessage } = await import(REPIN_URL);

const OLD_CM_DIR = '/old/plugin/v0.18.0/context-monitor';
const NEW_CM_DIR = '/new/plugin/v0.21.0/context-monitor';

/** Canonical NESTED shape — matches hooks/hooks.json's own format. */
function makeNestedSettings(cmDir) {
  return {
    statusLine: {
      type: 'command',
      command: `node "${join(cmDir, 'statusline.mjs')}"`,
    },
    hooks: {
      Stop: [
        {
          hooks: [
            { type: 'command', command: `node "${join(cmDir, 'stop-hook.mjs')}"` },
          ],
        },
      ],
      SessionStart: [
        {
          matcher: 'clear|compact',
          hooks: [
            { type: 'command', command: `node "${join(cmDir, 'session-start.mjs')}"` },
          ],
        },
      ],
    },
  };
}

/** Legacy FLAT shape — command directly on the array element. */
function makeFlatSettings(cmDir) {
  return {
    hooks: {
      Stop: [{ type: 'command', command: `node "${join(cmDir, 'stop-hook.mjs')}"` }],
    },
  };
}

// ---------------------------------------------------------------------------
// HIGH-1 — the canonical NESTED hook shape is repaired, not silently skipped
// ---------------------------------------------------------------------------

describe('HIGH-1 — repinSettingsObject repairs the canonical nested hook shape', () => {
  it('rewrites a nested Stop hook command', () => {
    const settings = makeNestedSettings(OLD_CM_DIR);
    const result = repinSettingsObject(settings, NEW_CM_DIR);

    expect(result.hooks.Stop[0].hooks[0].command).toContain(NEW_CM_DIR);
    expect(result.hooks.Stop[0].hooks[0].command).not.toContain(OLD_CM_DIR);
  });

  it('rewrites a nested SessionStart hook command and preserves the matcher field', () => {
    const settings = makeNestedSettings(OLD_CM_DIR);
    const result = repinSettingsObject(settings, NEW_CM_DIR);

    expect(result.hooks.SessionStart[0].hooks[0].command).toContain(NEW_CM_DIR);
    expect(result.hooks.SessionStart[0].hooks[0].command).not.toContain(OLD_CM_DIR);
    expect(result.hooks.SessionStart[0].matcher).toBe('clear|compact');
  });

  it('repairedCount counts every rewritten command: statusLine + 2 nested hooks = 3', () => {
    const settings = makeNestedSettings(OLD_CM_DIR);
    const result = repinSettingsObject(settings, NEW_CM_DIR);

    expect(result.repairedCount).toBe(3);
  });

  it('allCurrent is true once every nested command has been repaired', () => {
    const settings = makeNestedSettings(OLD_CM_DIR);
    const result = repinSettingsObject(settings, NEW_CM_DIR);

    expect(result.allCurrent).toBe(true);
  });

  it('is idempotent on the nested shape: a second pass reports needsWrite=false', () => {
    const settings = makeNestedSettings(OLD_CM_DIR);
    const once = repinSettingsObject(settings, NEW_CM_DIR);
    const twice = repinSettingsObject(once, NEW_CM_DIR);

    expect(twice.needsWrite).toBe(false);
    expect(twice.repairedCount).toBe(0);
  });

  it('repairs the path only — does NOT migrate the nested shape into the flat shape', () => {
    const settings = makeNestedSettings(OLD_CM_DIR);
    const result = repinSettingsObject(settings, NEW_CM_DIR);

    expect(Array.isArray(result.hooks.Stop[0].hooks)).toBe(true);
    expect(result.hooks.Stop[0].command).toBeUndefined();
  });

  it('a file mixing flat Stop and nested SessionStart repairs both shapes', () => {
    const settings = {
      hooks: {
        Stop: [{ type: 'command', command: `node "${join(OLD_CM_DIR, 'stop-hook.mjs')}"` }],
        SessionStart: [
          {
            matcher: 'clear|compact',
            hooks: [{ type: 'command', command: `node "${join(OLD_CM_DIR, 'session-start.mjs')}"` }],
          },
        ],
      },
    };
    const result = repinSettingsObject(settings, NEW_CM_DIR);

    expect(result.hooks.Stop[0].command).toContain(NEW_CM_DIR);
    expect(result.hooks.SessionStart[0].hooks[0].command).toContain(NEW_CM_DIR);
    expect(result.repairedCount).toBe(2);
    expect(result.allCurrent).toBe(true);
  });

  it('the legacy flat shape alone still repairs exactly as before (no regression)', () => {
    const settings = makeFlatSettings(OLD_CM_DIR);
    const result = repinSettingsObject(settings, NEW_CM_DIR);

    expect(result.hooks.Stop[0].command).toContain(NEW_CM_DIR);
    expect(result.repairedCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// HIGH-2 — allCurrent is an INDEPENDENT verification, not a re-derivation of
// whatever the structural traversal happened to visit
// ---------------------------------------------------------------------------

describe('HIGH-2 — allCurrent independently verifies the whole file, not just the locations repaired', () => {
  it('is false when a stale context-monitor command exists somewhere the structural repair never visits', () => {
    const settings = {
      // Not statusLine, not hooks[event][] — an arbitrary location no current
      // or foreseeable structural branch walks into.
      someFutureExtension: {
        nested: { command: `node "${join(OLD_CM_DIR, 'stop-hook.mjs')}"` },
      },
    };
    const result = repinSettingsObject(settings, NEW_CM_DIR);

    // Heal-only scope is unchanged: this location must NOT be rewritten.
    expect(result.someFutureExtension.nested.command).toBe(settings.someFutureExtension.nested.command);
    expect(result.repairedCount).toBe(0);
    // But the independent scan must still see the stale reference and refuse
    // to call the file clean.
    expect(result.allCurrent).toBe(false);
  });

  it('is true for a settings object with no context-monitor commands at all', () => {
    const result = repinSettingsObject({ disableAllHooks: false }, NEW_CM_DIR);
    expect(result.allCurrent).toBe(true);
  });
});

describe('HIGH-2 — buildRepinReportMessage never claims "no action needed" without allCurrent', () => {
  it('claims the file is clean and says "no action needed" when allCurrent is true', () => {
    const msg = buildRepinReportMessage(3, true);
    expect(msg).toMatch(/no action needed/i);
  });

  it('does NOT claim "no action needed" when allCurrent is false, and tells the user to check by hand', () => {
    const msg = buildRepinReportMessage(1, false);
    expect(msg).not.toMatch(/no action needed/i);
    expect(msg).toMatch(/still.*not|not repaired|by hand/i);
  });
});

// ---------------------------------------------------------------------------
// LOW — case-only path differences do not spuriously mark a path stale
// ---------------------------------------------------------------------------

describe('LOW — case-only directory differences are not treated as stale on a case-insensitive filesystem', () => {
  it('win32: a case-only difference in the directory is NOT a rewrite; POSIX: it is (case-sensitive filesystem)', () => {
    const settings = {
      statusLine: { type: 'command', command: 'node "C:\\Plugin\\Context-Monitor\\statusline.mjs"' },
    };
    const result = repinSettingsObject(settings, 'c:\\plugin\\context-monitor');

    if (process.platform === 'win32') {
      expect(result.needsWrite).toBe(false);
      expect(result.repairedCount).toBe(0);
    } else {
      expect(result.needsWrite).toBe(true);
      expect(result.repairedCount).toBe(1);
    }
  });
});
