// tests/e2e/context-monitor-settings-migrate-e2e.spec.js
// TASK-210 — E2e regression locks for settings-migrate.mjs disk operations:
// the automatic plugin-level SessionStart hook that migrates legacy FLAT
// context-monitor hook entries to the documented NESTED shape, so a user who
// reads nothing still gets the fix on their very next session.
//
// Covers:
//   (a) migrateSettingsFile actually rewrites a legacy flat entry on disk.
//   (b) it is a no-op when entries are already nested (idempotency).
//   (c) it never injects entries into a settings.json that has none (heal-only).
//   (d) it never touches an unrelated hook or unrelated top-level setting.
//   (e) it returns gracefully when settings.json is missing or malformed,
//       with an `outcome` discriminant that distinguishes "nothing to do"
//       from "the file is broken and needs a human" (TASK-210 fix round,
//       MEDIUM-1).
//   (f) race guard: the write is ACTUALLY SKIPPED (not just "no throw") when
//       the file changes on disk between the initial read and the pre-write
//       re-read, via the injectable `readSettings` seam — deterministic,
//       not a timing-dependent real race (TASK-210 fix round, HIGH-1).
//
// TASK-210 fix round (LOW-3) — static import (not a computed dynamic one):
// __isMain guards the hook body so importing this module in tests is safe,
// and a static specifier keeps this spec visible to `test:changed`'s import
// graph for any future edit to settings-migrate.mjs alone.

import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';
import {
  migrateSettingsFile,
  buildMigrateReportMessage,
  buildMigrateWarningMessage,
} from '../../context-monitor/settings-migrate.mjs';
import { REPO_ROOT } from '../helpers/repoRoot.js';

afterAll(cleanupAll);

const FAKE_PLUGIN_ROOT = REPO_ROOT;

function writeFlatSettings(claudeDir, extra = {}) {
  mkdirSync(claudeDir, { recursive: true });
  const settings = {
    ...extra,
    hooks: {
      Stop: [
        { type: 'command', command: 'node "/old/plugin/v1/context-monitor/stop-hook.mjs"' },
        ...(extra.hooks?.Stop || []),
      ],
      SessionStart: [
        {
          type: 'command',
          matcher: 'clear|compact',
          command: 'node "/old/plugin/v1/context-monitor/session-start.mjs"',
        },
        ...(extra.hooks?.SessionStart || []),
      ],
    },
  };
  const settingsPath = join(claudeDir, 'settings.json');
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  return settingsPath;
}

// ---------------------------------------------------------------------------
// (a) migrates a legacy flat entry to nested shape on disk
// ---------------------------------------------------------------------------

describe('migrateSettingsFile — legacy flat -> nested shape rewrite', () => {
  it('rewrites both Stop and SessionStart entries to the nested shape', () => {
    const repoDir = makeTmpDir('settings-migrate-flat');
    const claudeDir = join(repoDir, '.claude');
    const settingsPath = writeFlatSettings(claudeDir);

    const result = migrateSettingsFile({ projectRoot: repoDir, pluginRoot: FAKE_PLUGIN_ROOT });

    expect(result.wrote).toBe(true);
    expect(result.outcome).toBe('migrated');
    expect(result.migratedCount).toBe(2);

    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    expect(Array.isArray(settings.hooks.Stop[0].hooks)).toBe(true);
    expect(settings.hooks.Stop[0].hooks[0].command).toMatch(/stop-hook\.mjs/);
    expect(Array.isArray(settings.hooks.SessionStart[0].hooks)).toBe(true);
    expect(settings.hooks.SessionStart[0].hooks[0].command).toMatch(/session-start\.mjs/);
  });

  it('the report message names the actual migrated count', () => {
    expect(buildMigrateReportMessage(2)).toContain('migrated 2 context-monitor hook entries');
    expect(buildMigrateReportMessage(1)).toContain('migrated 1 context-monitor hook entry ');
  });
});

// ---------------------------------------------------------------------------
// (b) idempotent: no-op once already nested
// ---------------------------------------------------------------------------

describe('migrateSettingsFile — idempotency: no write once already nested', () => {
  it('returns wrote=false, outcome=nothing-to-migrate on a second run', () => {
    const repoDir = makeTmpDir('settings-migrate-idemp');
    const claudeDir = join(repoDir, '.claude');
    writeFlatSettings(claudeDir);

    migrateSettingsFile({ projectRoot: repoDir, pluginRoot: FAKE_PLUGIN_ROOT });
    const second = migrateSettingsFile({ projectRoot: repoDir, pluginRoot: FAKE_PLUGIN_ROOT });

    expect(second.wrote).toBe(false);
    expect(second.outcome).toBe('nothing-to-migrate');
  });
});

// ---------------------------------------------------------------------------
// (c) heal-only: never injects entries into a project with none
// ---------------------------------------------------------------------------

describe('migrateSettingsFile — heal-only: does not inject entries', () => {
  it('does not add any context-monitor entries to a settings.json with none', () => {
    const repoDir = makeTmpDir('settings-migrate-healonly');
    const claudeDir = join(repoDir, '.claude');
    mkdirSync(claudeDir, { recursive: true });

    const settings = { customKey: 'preserved', hooks: { Stop: [{ type: 'command', command: 'node /unrelated/hook.mjs' }] } };
    const settingsPath = join(claudeDir, 'settings.json');
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');

    const result = migrateSettingsFile({ projectRoot: repoDir, pluginRoot: FAKE_PLUGIN_ROOT });

    expect(result.wrote).toBe(false);
    expect(result.outcome).toBe('nothing-to-migrate');
    const after = JSON.parse(readFileSync(settingsPath, 'utf8'));
    expect(after.statusLine).toBeUndefined();
    expect(after.hooks.SessionStart).toBeUndefined();
    expect(after.hooks.Stop).toHaveLength(1);
    expect(after.hooks.Stop[0].command).toBe('node /unrelated/hook.mjs');
  });
});

// ---------------------------------------------------------------------------
// (d) unrelated hooks and unrelated top-level settings survive untouched
// ---------------------------------------------------------------------------

describe('migrateSettingsFile — preserves unrelated content', () => {
  it('preserves an unrelated Stop hook and an unrelated top-level setting', () => {
    const repoDir = makeTmpDir('settings-migrate-preserve');
    const claudeDir = join(repoDir, '.claude');
    const settingsPath = writeFlatSettings(claudeDir, {
      someOtherSetting: { keep: 'me' },
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node /some/other-hook.mjs' }] }] },
    });

    migrateSettingsFile({ projectRoot: repoDir, pluginRoot: FAKE_PLUGIN_ROOT });

    const after = JSON.parse(readFileSync(settingsPath, 'utf8'));
    expect(after.someOtherSetting).toEqual({ keep: 'me' });
    const otherHook = after.hooks.Stop.find((h) => h.hooks?.[0]?.command === 'node /some/other-hook.mjs');
    expect(otherHook, 'unrelated Stop hook must be preserved').toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// (e) missing/malformed settings.json — outcome discriminant (MEDIUM-1)
// ---------------------------------------------------------------------------

describe('migrateSettingsFile — outcome discriminant on missing/malformed settings.json', () => {
  it('returns outcome=no-file (legitimate, quiet) when .claude/settings.json does not exist', () => {
    const repoDir = makeTmpDir('settings-migrate-missing');
    let error;
    let result;
    try {
      result = migrateSettingsFile({ projectRoot: repoDir, pluginRoot: FAKE_PLUGIN_ROOT });
    } catch (e) {
      error = e;
    }
    expect(error).toBeUndefined();
    expect(result.wrote).toBe(false);
    expect(result.outcome).toBe('no-file');
    expect(buildMigrateWarningMessage(result.outcome)).toBeNull();
  });

  it('returns outcome=malformed (must be surfaced, not silent) when settings.json contains invalid JSON', () => {
    const repoDir = makeTmpDir('settings-migrate-malformed');
    const claudeDir = join(repoDir, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, 'settings.json'), '{ not json }', 'utf8');

    let error;
    let result;
    try {
      result = migrateSettingsFile({ projectRoot: repoDir, pluginRoot: FAKE_PLUGIN_ROOT });
    } catch (e) {
      error = e;
    }
    expect(error).toBeUndefined();
    expect(result.wrote).toBe(false);
    expect(result.outcome).toBe('malformed');
    // MEDIUM-1: this outcome must NOT be silently indistinguishable from success.
    expect(buildMigrateWarningMessage(result.outcome)).toMatch(/not valid JSON/);
  });
});

// ---------------------------------------------------------------------------
// (f) race guard — deterministically exercised via the injectable read seam
// (TASK-210 fix round, HIGH-1)
// ---------------------------------------------------------------------------

describe('migrateSettingsFile — race guard composing with a concurrent writer (e.g. repin.mjs)', () => {
  it('SKIPS the write and returns outcome=skipped-race when the second read differs from the first', () => {
    const repoDir = makeTmpDir('settings-migrate-race');
    const claudeDir = join(repoDir, '.claude');
    const settingsPath = writeFlatSettings(claudeDir);
    const onDiskBefore = readFileSync(settingsPath, 'utf8');

    // Concurrent writer's content — what repin.mjs (or another process) would
    // have written between our initial read and our pre-write re-read.
    const concurrentContent = JSON.stringify(
      { ...JSON.parse(onDiskBefore), statusLine: { type: 'command', command: 'node /concurrent/statusline.mjs' } },
      null,
      2,
    ) + '\n';

    let callCount = 0;
    // Deterministically simulate the race: 1st call (the initial read) sees
    // the real on-disk flat content; 2nd call (the pre-write re-read) sees
    // the concurrent writer's content instead — exactly the condition the
    // guard exists to detect.
    const readSettings = (path, enc) => {
      callCount += 1;
      return callCount === 1 ? onDiskBefore : concurrentContent;
    };

    const result = migrateSettingsFile({
      projectRoot: repoDir,
      pluginRoot: FAKE_PLUGIN_ROOT,
      readSettings,
    });

    expect(callCount, 'the seam must be called exactly twice (initial read + pre-write re-read)').toBe(2);
    expect(result.wrote).toBe(false);
    expect(result.outcome).toBe('skipped-race');

    // The write must have been skipped entirely: the REAL on-disk file is
    // untouched by migrateSettingsFile (still the original flat content —
    // our injected readSettings never actually wrote anything, and the real
    // fs.writeFileSync must not have been reached).
    expect(readFileSync(settingsPath, 'utf8')).toBe(onDiskBefore);
  });
});
