// tests/e2e/context-monitor-repin-e2e.spec.js
// TASK-009 — E2e regression locks for repin.mjs disk operations.
//
// Covers:
//   (a) repin.mjs actually reads from and writes to the project's settings.json
//       when invoked via its exported repinFile() function with a stale path.
//   (b) repin.mjs is a no-op when settings are already current (idempotency).
//   (c) repin.mjs never writes when no context-monitor entries are present (heal-only).
//   (d) repin.mjs returns gracefully when settings.json is missing or malformed.

import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';

afterAll(cleanupAll);

const __thisDir = dirname(fileURLToPath(import.meta.url));
const REPIN_URL = pathToFileURL(join(__thisDir, '..', '..', 'context-monitor', 'repin.mjs')).href;
const ACTUAL_CM_DIR = join(__thisDir, '..', '..', 'context-monitor');

const { repinFile } = await import(REPIN_URL);

const OLD_CM_DIR = '/old/plugin/v1.0.0/context-monitor';

// Helper to write a settings.json with stale context-monitor paths.
function writeStaleSettings(claudeDir, staleCmDir) {
  mkdirSync(claudeDir, { recursive: true });
  const settings = {
    statusLine: {
      type: 'command',
      command: `node "${join(staleCmDir, 'statusline.mjs')}"`,
    },
    hooks: {
      Stop: [
        {
          type: 'command',
          command: `node "${join(staleCmDir, 'stop-hook.mjs')}"`,
        },
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

// ---------------------------------------------------------------------------
// (a) repin.mjs updates a stale settings.json to the current plugin root
// ---------------------------------------------------------------------------

describe('repinFile — stale → current path rewrite', () => {
  it('rewrites stale context-monitor paths to the current plugin root', async () => {
    const repoDir = makeTmpDir('repin-stale');
    const claudeDir = join(repoDir, '.claude');
    const settingsPath = writeStaleSettings(claudeDir, OLD_CM_DIR);

    const result = await repinFile({ projectRoot: repoDir, currentCmDir: ACTUAL_CM_DIR });

    expect(result.wrote).toBe(true);

    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    expect(settings.statusLine.command).toContain(ACTUAL_CM_DIR);
    expect(settings.statusLine.command).not.toContain(OLD_CM_DIR);
  });

  it('rewrites Stop hook path to current plugin root', async () => {
    const repoDir = makeTmpDir('repin-stop');
    const claudeDir = join(repoDir, '.claude');
    const settingsPath = writeStaleSettings(claudeDir, OLD_CM_DIR);

    await repinFile({ projectRoot: repoDir, currentCmDir: ACTUAL_CM_DIR });

    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    const stopHook = settings.hooks.Stop.find((h) => /stop-hook\.mjs/.test(h.command));
    expect(stopHook).toBeDefined();
    expect(stopHook.command).toContain(ACTUAL_CM_DIR);
  });

  it('rewrites SessionStart hook path to current plugin root', async () => {
    const repoDir = makeTmpDir('repin-ss');
    const claudeDir = join(repoDir, '.claude');
    const settingsPath = writeStaleSettings(claudeDir, OLD_CM_DIR);

    await repinFile({ projectRoot: repoDir, currentCmDir: ACTUAL_CM_DIR });

    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    const ssHook = settings.hooks.SessionStart.find((h) => /session-start\.mjs/.test(h.command));
    expect(ssHook).toBeDefined();
    expect(ssHook.command).toContain(ACTUAL_CM_DIR);
  });
});

// ---------------------------------------------------------------------------
// (b) repinFile is idempotent: no disk write when paths are already current
// ---------------------------------------------------------------------------

describe('repinFile — idempotency: no write when paths are already current', () => {
  it('returns wrote=false when all paths already point to the current cm dir', async () => {
    const repoDir = makeTmpDir('repin-idemp');
    const claudeDir = join(repoDir, '.claude');

    // Write settings that are already up-to-date.
    mkdirSync(claudeDir, { recursive: true });
    const settings = {
      statusLine: {
        type: 'command',
        command: `node "${join(ACTUAL_CM_DIR, 'statusline.mjs')}"`,
      },
      hooks: {
        Stop: [{ type: 'command', command: `node "${join(ACTUAL_CM_DIR, 'stop-hook.mjs')}"` }],
        SessionStart: [
          {
            type: 'command',
            matcher: 'clear|compact',
            command: `node "${join(ACTUAL_CM_DIR, 'session-start.mjs')}"`,
          },
        ],
      },
    };
    const settingsPath = join(claudeDir, 'settings.json');
    const serialized = JSON.stringify(settings, null, 2) + '\n';
    writeFileSync(settingsPath, serialized, 'utf8');

    const result = await repinFile({ projectRoot: repoDir, currentCmDir: ACTUAL_CM_DIR });

    expect(result.wrote).toBe(false);
    // File contents must be byte-identical.
    expect(readFileSync(settingsPath, 'utf8')).toBe(serialized);
  });
});

// ---------------------------------------------------------------------------
// (c) repinFile heal-only: never injects entries into a project with none
// ---------------------------------------------------------------------------

describe('repinFile — heal-only: does not add context-monitor entries', () => {
  it('does not add any context-monitor entries to a settings.json with none', async () => {
    const repoDir = makeTmpDir('repin-healonly');
    const claudeDir = join(repoDir, '.claude');
    mkdirSync(claudeDir, { recursive: true });

    const settings = {
      disableAllHooks: false,
      customKey: 'preserved',
      hooks: {
        Stop: [{ type: 'command', command: 'node /unrelated/hook.mjs' }],
      },
    };
    const settingsPath = join(claudeDir, 'settings.json');
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');

    const result = await repinFile({ projectRoot: repoDir, currentCmDir: ACTUAL_CM_DIR });

    expect(result.wrote).toBe(false);

    const after = JSON.parse(readFileSync(settingsPath, 'utf8'));
    // statusLine must not appear (was not in the original)
    expect(after.statusLine).toBeUndefined();
    // Stop hook array must be unchanged
    expect(after.hooks.Stop).toHaveLength(1);
    expect(after.hooks.Stop[0].command).toBe('node /unrelated/hook.mjs');
  });
});

// ---------------------------------------------------------------------------
// (d) repinFile gracefully handles missing or malformed settings.json
// ---------------------------------------------------------------------------

describe('repinFile — safe no-op on missing/malformed settings.json', () => {
  it('returns gracefully when .claude/settings.json does not exist', async () => {
    const repoDir = makeTmpDir('repin-missing');
    // Do NOT create .claude/ or settings.json.

    let error;
    let result;
    try {
      result = await repinFile({ projectRoot: repoDir, currentCmDir: ACTUAL_CM_DIR });
    } catch (e) {
      error = e;
    }

    expect(error).toBeUndefined();
    expect(result.wrote).toBe(false);
  });

  it('returns gracefully when settings.json contains invalid JSON', async () => {
    const repoDir = makeTmpDir('repin-malformed');
    const claudeDir = join(repoDir, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, 'settings.json'), '{ this is not json }', 'utf8');

    let error;
    let result;
    try {
      result = await repinFile({ projectRoot: repoDir, currentCmDir: ACTUAL_CM_DIR });
    } catch (e) {
      error = e;
    }

    expect(error).toBeUndefined();
    expect(result.wrote).toBe(false);
  });

  it('returns gracefully when settings.json contains a JSON array (not an object)', async () => {
    const repoDir = makeTmpDir('repin-array');
    const claudeDir = join(repoDir, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, 'settings.json'), '[]', 'utf8');

    const result = await repinFile({ projectRoot: repoDir, currentCmDir: ACTUAL_CM_DIR });
    expect(result.wrote).toBe(false);
  });
});
