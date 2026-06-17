// tests/e2e/context-monitor-settings-scaffold.spec.js
// TASK-008 AC4 — init/scaffold wiring for .claude/settings.json.
//
// The init-project scaffold must write/merge the consuming project's
// .claude/settings.json with:
//   - statusLine entry: { type: 'command', command: 'node <ABS>/context-monitor/statusline.mjs' }
//   - Stop hook entry: { type: 'command', command: 'node <ABS>/context-monitor/stop-hook.mjs' }
//   - SessionStart hook entry with matcher 'clear|compact':
//       { type: 'command', command: 'node <ABS>/context-monitor/session-start.mjs' }
//
// where <ABS> is the plugin root resolved at init time (literal absolute path,
// NOT ${CLAUDE_PLUGIN_ROOT}).
//
// The merge MUST preserve pre-existing settings.json keys and existing hook arrays
// (deep-merge, not clobber).
//
// AC map (TASK-008 AC4):
//   (a) fresh scaffold with no settings.json
//   (b) merge into an existing settings.json with unrelated keys and an existing hook

import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { REPO_ROOT } from '../helpers/repoRoot.js';
import { PROD } from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';
import { makeScriptedPrompter, webSaasAnswers } from '../helpers/scripted-prompter.js';

afterAll(cleanupAll);

const __thisDir = dirname(fileURLToPath(import.meta.url));
const CONTEXT_MONITOR_DIR = join(__thisDir, '..', '..', 'context-monitor');
const FIXED_NOW = '2026-06-17T12:00:00Z';

// ---------------------------------------------------------------------------
// AC4a — fresh scaffold (no pre-existing settings.json)
// ---------------------------------------------------------------------------

describe('AC4a — fresh scaffold: settings.json written when none exists', () => {
  it('creates .claude/settings.json with statusLine and hooks on fresh init', async () => {
    const { runInit } = await import(PROD.init);
    const repoDir = makeTmpDir('cm-settings-fresh');

    const prompter = makeScriptedPrompter(webSaasAnswers({ project_name: 'cm-fresh' }));
    const result = await runInit({
      argv: [],
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });

    expect(['created', 'forced']).toContain(result.state);

    const settingsPath = join(repoDir, '.claude', 'settings.json');
    expect(
      existsSync(settingsPath),
      `.claude/settings.json must be created by init`,
    ).toBe(true);

    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));

    // statusLine must be present and use an absolute path
    expect(settings.statusLine, 'settings.json must have statusLine').toBeDefined();
    expect(settings.statusLine.type).toBe('command');
    expect(
      settings.statusLine.command,
      'statusLine.command must reference statusline.mjs',
    ).toMatch(/statusline\.mjs/);
    // Must be a node command
    expect(settings.statusLine.command).toMatch(/^node /);
    // Must NOT contain ${CLAUDE_PLUGIN_ROOT}
    expect(
      settings.statusLine.command,
      'statusLine.command must not contain ${CLAUDE_PLUGIN_ROOT}',
    ).not.toContain('${CLAUDE_PLUGIN_ROOT}');

    // hooks must be an object
    expect(settings.hooks, 'settings.json must have hooks').toBeDefined();

    // Stop hook
    const stopHooks = settings.hooks.Stop;
    expect(Array.isArray(stopHooks), 'hooks.Stop must be an array').toBe(true);
    const stopHook = stopHooks.find(
      (h) => h && h.type === 'command' && /stop-hook\.mjs/.test(h.command),
    );
    expect(
      stopHook,
      'hooks.Stop must contain a command entry for stop-hook.mjs',
    ).toBeDefined();
    expect(stopHook.command).toMatch(/^node /);
    expect(stopHook.command).not.toContain('${CLAUDE_PLUGIN_ROOT}');

    // SessionStart hook
    const sessionStartHooks = settings.hooks.SessionStart;
    expect(Array.isArray(sessionStartHooks), 'hooks.SessionStart must be an array').toBe(true);
    const sessionStartHook = sessionStartHooks.find(
      (h) => h && h.type === 'command' && /session-start\.mjs/.test(h.command),
    );
    expect(
      sessionStartHook,
      'hooks.SessionStart must contain a command entry for session-start.mjs',
    ).toBeDefined();
    expect(sessionStartHook.command).toMatch(/^node /);
    expect(sessionStartHook.command).not.toContain('${CLAUDE_PLUGIN_ROOT}');
    // Matcher must be 'clear|compact'
    expect(
      sessionStartHook.matcher,
      'SessionStart hook must have matcher "clear|compact"',
    ).toBe('clear|compact');
  });

  it('commands use literal absolute paths that actually point to existing scripts', async () => {
    const { runInit } = await import(PROD.init);
    const repoDir = makeTmpDir('cm-settings-abspath');

    const prompter = makeScriptedPrompter(webSaasAnswers({ project_name: 'cm-abspath' }));
    await runInit({
      argv: [],
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });

    const settings = JSON.parse(readFileSync(join(repoDir, '.claude', 'settings.json'), 'utf8'));

    // Extract the script path from each command ("node <path>") and verify it exists.
    function extractPath(cmd) {
      // The command is: node "<path>" or node <path>
      // Strip leading 'node ' and any surrounding quotes.
      return cmd.replace(/^node\s+/, '').replace(/^"(.*)"$/, '$1');
    }

    const statusLinePath = extractPath(settings.statusLine.command);
    expect(
      existsSync(statusLinePath),
      `statusLine script must exist at ${statusLinePath}`,
    ).toBe(true);

    for (const hook of settings.hooks.Stop) {
      if (/stop-hook\.mjs/.test(hook.command)) {
        const p = extractPath(hook.command);
        expect(existsSync(p), `stop-hook.mjs must exist at ${p}`).toBe(true);
      }
    }

    for (const hook of settings.hooks.SessionStart) {
      if (/session-start\.mjs/.test(hook.command)) {
        const p = extractPath(hook.command);
        expect(existsSync(p), `session-start.mjs must exist at ${p}`).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// AC4b — merge into existing settings.json (preserve pre-existing content)
// ---------------------------------------------------------------------------

describe('AC4b — merge: preserves pre-existing settings.json content', () => {
  it('preserves unrelated keys in existing settings.json', async () => {
    const { runInit } = await import(PROD.init);
    const repoDir = makeTmpDir('cm-settings-merge');

    // Pre-create .claude/settings.json with unrelated content.
    const claudeDir = join(repoDir, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    const existingSettings = {
      disableAllHooks: false,
      customKey: 'preserved-value',
      someOtherSetting: { nested: true },
    };
    writeFileSync(
      join(claudeDir, 'settings.json'),
      JSON.stringify(existingSettings, null, 2) + '\n',
      'utf8',
    );

    const prompter = makeScriptedPrompter(webSaasAnswers({ project_name: 'cm-merge' }));
    await runInit({
      argv: [],
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });

    const settings = JSON.parse(readFileSync(join(repoDir, '.claude', 'settings.json'), 'utf8'));

    // Pre-existing keys must be preserved.
    expect(
      settings.disableAllHooks,
      'pre-existing disableAllHooks must be preserved',
    ).toBe(false);
    expect(
      settings.customKey,
      'pre-existing customKey must be preserved',
    ).toBe('preserved-value');
    expect(
      settings.someOtherSetting,
      'pre-existing someOtherSetting must be preserved',
    ).toEqual({ nested: true });

    // Our keys must be merged in.
    expect(settings.statusLine, 'statusLine must be added by merge').toBeDefined();
    expect(settings.hooks, 'hooks must be added by merge').toBeDefined();
  });

  it('preserves pre-existing hooks when merging', async () => {
    const { runInit } = await import(PROD.init);
    const repoDir = makeTmpDir('cm-settings-hooks-merge');

    // Pre-create .claude/settings.json with an existing hook.
    const claudeDir = join(repoDir, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    const existingSettings = {
      hooks: {
        Stop: [
          {
            type: 'command',
            command: 'node /existing/my-hook.mjs',
          },
        ],
        PreToolUse: [
          {
            type: 'command',
            command: 'node /some/tool-hook.mjs',
          },
        ],
      },
    };
    writeFileSync(
      join(claudeDir, 'settings.json'),
      JSON.stringify(existingSettings, null, 2) + '\n',
      'utf8',
    );

    const prompter = makeScriptedPrompter(webSaasAnswers({ project_name: 'cm-hooks-merge' }));
    await runInit({
      argv: [],
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });

    const settings = JSON.parse(readFileSync(join(repoDir, '.claude', 'settings.json'), 'utf8'));

    // Pre-existing Stop hook must still be there.
    const stopHooks = settings.hooks.Stop;
    expect(Array.isArray(stopHooks), 'hooks.Stop must be an array').toBe(true);
    const preExistingStop = stopHooks.find((h) => h.command === 'node /existing/my-hook.mjs');
    expect(
      preExistingStop,
      'pre-existing Stop hook must be preserved after merge',
    ).toBeDefined();

    // Our stop-hook.mjs entry must also be present.
    const ourStopHook = stopHooks.find((h) => /stop-hook\.mjs/.test(h.command));
    expect(
      ourStopHook,
      'our stop-hook.mjs entry must be added to hooks.Stop',
    ).toBeDefined();

    // Pre-existing PreToolUse hook must be preserved.
    const preToolUseHooks = settings.hooks.PreToolUse;
    expect(Array.isArray(preToolUseHooks), 'hooks.PreToolUse must be preserved').toBe(true);
    expect(
      preToolUseHooks.some((h) => h.command === 'node /some/tool-hook.mjs'),
      'pre-existing PreToolUse hook must be preserved',
    ).toBe(true);
  });

  it('does not duplicate context-monitor entries on idempotent re-run', async () => {
    const { runInit } = await import(PROD.init);
    const repoDir = makeTmpDir('cm-settings-idemp');

    // First init.
    const prompter = makeScriptedPrompter(webSaasAnswers({ project_name: 'cm-idemp' }));
    await runInit({
      argv: [],
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });

    const settingsAfterFirst = JSON.parse(
      readFileSync(join(repoDir, '.claude', 'settings.json'), 'utf8'),
    );
    const stopCountAfterFirst = settingsAfterFirst.hooks.Stop.filter(
      (h) => /stop-hook\.mjs/.test(h.command),
    ).length;
    expect(stopCountAfterFirst).toBe(1);

    // Second init (already_initialized) must not duplicate entries.
    await runInit({
      argv: [],
      prompter: async () => { throw new Error('must not be called in already_initialized'); },
      repoRoot: repoDir,
      now: () => '2099-01-01T00:00:00Z',
    });

    // settings.json may not be modified at all by already_initialized branch.
    // Even if it is, there must be no duplicates.
    const settingsAfterSecond = JSON.parse(
      readFileSync(join(repoDir, '.claude', 'settings.json'), 'utf8'),
    );
    const stopCountAfterSecond = settingsAfterSecond.hooks.Stop.filter(
      (h) => /stop-hook\.mjs/.test(h.command),
    ).length;
    expect(
      stopCountAfterSecond,
      'stop-hook.mjs must not be duplicated by a second init run',
    ).toBe(1);
  });
});
