// tests/plugin-hooks-scaffold.spec.js
// TASK-009 — Plugin-level SessionStart re-pin hook registration.
//
// The plugin must ship a hooks/hooks.json that registers a SessionStart hook
// running `node ${CLAUDE_PLUGIN_ROOT}/context-monitor/repin.mjs`.
// This runs as a plugin-level hook, so ${CLAUDE_PLUGIN_ROOT} IS expanded.
//
// AC map (TASK-009 AC1 — plugin hook registration):
//   - hooks/hooks.json must exist at the plugin root.
//   - It must declare a SessionStart hook with a command referencing repin.mjs.
//   - The command must use ${CLAUDE_PLUGIN_ROOT} (not a baked absolute path).
//   - If plugin.json has a "hooks" reference, it must point to hooks/hooks.json.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './helpers/repoRoot.js';

const HOOKS_JSON_PATH = join(REPO_ROOT, 'hooks', 'hooks.json');
const PLUGIN_JSON_PATH = join(REPO_ROOT, '.claude-plugin', 'plugin.json');

// ---------------------------------------------------------------------------
// hooks/hooks.json must exist and be valid JSON
// ---------------------------------------------------------------------------

describe('hooks/hooks.json existence and structure', () => {
  it('hooks/hooks.json must exist at the plugin root', () => {
    expect(
      existsSync(HOOKS_JSON_PATH),
      `hooks/hooks.json must exist at ${HOOKS_JSON_PATH}`,
    ).toBe(true);
  });

  it('hooks/hooks.json must be valid JSON', () => {
    expect(existsSync(HOOKS_JSON_PATH), 'hooks/hooks.json must exist first').toBe(true);
    const raw = readFileSync(HOOKS_JSON_PATH, 'utf8');
    expect(() => JSON.parse(raw), 'hooks/hooks.json must be valid JSON').not.toThrow();
  });

  it('hooks/hooks.json must declare at least one SessionStart hook', () => {
    expect(existsSync(HOOKS_JSON_PATH)).toBe(true);
    const hooks = JSON.parse(readFileSync(HOOKS_JSON_PATH, 'utf8'));
    const sessionStartHooks = hooks.SessionStart;
    expect(
      Array.isArray(sessionStartHooks),
      'hooks.json must have a SessionStart array',
    ).toBe(true);
    expect(
      sessionStartHooks.length,
      'hooks.json must have at least one SessionStart entry',
    ).toBeGreaterThan(0);
  });

  it('the SessionStart hook command must reference repin.mjs', () => {
    expect(existsSync(HOOKS_JSON_PATH)).toBe(true);
    const hooks = JSON.parse(readFileSync(HOOKS_JSON_PATH, 'utf8'));
    const sessionStartHooks = hooks.SessionStart;
    expect(Array.isArray(sessionStartHooks)).toBe(true);

    const repinHook = sessionStartHooks.find(
      (h) => h && typeof h.command === 'string' && h.command.includes('repin.mjs'),
    );
    expect(
      repinHook,
      'SessionStart must include a hook command referencing repin.mjs',
    ).toBeDefined();
  });

  it('the repin hook command must use ${CLAUDE_PLUGIN_ROOT} (not a baked absolute path)', () => {
    expect(existsSync(HOOKS_JSON_PATH)).toBe(true);
    const hooks = JSON.parse(readFileSync(HOOKS_JSON_PATH, 'utf8'));
    const sessionStartHooks = hooks.SessionStart;
    expect(Array.isArray(sessionStartHooks)).toBe(true);

    const repinHook = sessionStartHooks.find(
      (h) => h && typeof h.command === 'string' && h.command.includes('repin.mjs'),
    );
    expect(repinHook).toBeDefined();

    // Must use ${CLAUDE_PLUGIN_ROOT} — the variable IS expanded in plugin-level hooks.json.
    expect(
      repinHook.command,
      'repin hook command must use ${CLAUDE_PLUGIN_ROOT}',
    ).toContain('${CLAUDE_PLUGIN_ROOT}');

    // Must NOT be a baked absolute path (e.g., C:\ or /home/).
    // Any command that starts with 'node /' or 'node "C:' is a baked absolute path.
    expect(
      repinHook.command,
      'repin hook command must not be a baked absolute path',
    ).not.toMatch(/node\s+"?[A-Za-z]:[/\\]/);
    expect(
      repinHook.command,
      'repin hook command must not be a baked absolute path (unix)',
    ).not.toMatch(/node\s+"\/[^$]/);
  });

  it('the SessionStart repin hook must have a broad matcher (startup|resume|clear|compact)', () => {
    expect(existsSync(HOOKS_JSON_PATH)).toBe(true);
    const hooks = JSON.parse(readFileSync(HOOKS_JSON_PATH, 'utf8'));
    const sessionStartHooks = hooks.SessionStart;
    expect(Array.isArray(sessionStartHooks)).toBe(true);

    const repinHook = sessionStartHooks.find(
      (h) => h && typeof h.command === 'string' && h.command.includes('repin.mjs'),
    );
    expect(repinHook).toBeDefined();

    // The matcher must cover at least session startup (startup or startup|resume).
    // A missing matcher means "fires on all events" which is also acceptable.
    if (repinHook.matcher !== undefined) {
      // If matcher is set, it should cover at least startup events.
      // We accept any matcher string that includes 'startup' or covers broadly.
      // This is a soft assertion: either no matcher (fires always) or one that
      // includes startup/resume coverage.
      const m = repinHook.matcher;
      const coversStartup = m.includes('startup') || m.includes('resume') || m === '';
      expect(
        coversStartup,
        `matcher "${m}" should cover startup/resume events for a re-pin hook`,
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// If plugin.json declares a "hooks" field, it must point at hooks/hooks.json
// ---------------------------------------------------------------------------

describe('plugin.json hooks reference (if present)', () => {
  it('if plugin.json has a "hooks" field, it must point at hooks/hooks.json', () => {
    const pluginJson = JSON.parse(readFileSync(PLUGIN_JSON_PATH, 'utf8'));
    if (pluginJson.hooks === undefined) {
      // Not declared — that's fine; Claude Code auto-discovers hooks/hooks.json
      // from the plugin root convention.
      return;
    }
    expect(
      pluginJson.hooks,
      'plugin.json hooks field must point at hooks/hooks.json',
    ).toBe('./hooks/hooks.json');
  });
});
