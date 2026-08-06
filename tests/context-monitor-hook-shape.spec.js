// tests/context-monitor-hook-shape.spec.js
// TASK-210 — buildContextMonitorEntries must emit the documented NESTED hook
// shape (`{ matcher?, hooks: [{ type, command }] }`), not the flat shape
// (`{ type, command }` directly on the array element). Per `claude doctor`
// (verified empirically, see TASK-210 hand-off), the flat shape is REJECTED
// as invalid settings — `hooks.Stop.0.hooks: Expected array, but received
// undefined` — so entries in that shape have never fired in any consumer
// project since June 2026.
//
// AC map (TASK-210):
//   AC2/AC7 — a sensor pins the emitted shape against the documented nested
//     schema, red on the pre-fix flat shape (this is the tests-first red-run
//     evidence captured verbatim at hand-off).
//   AC3     — matcher is per-event correct: SessionStart carries it, Stop
//     does not (Stop does not support matcher per the docs).
//   AC4/AC5 — mergeContextMonitorSettings migrates a pre-existing LEGACY FLAT
//     entry (written by pre-fix code) to the nested shape in place, while
//     never touching unrelated hooks/settings, and staying idempotent.
//   AC6     — migrateContextMonitorShape (the heal-only, no-inject sibling
//     used by the new plugin-level auto-migration hook) never injects entries
//     into a project that never had any (heal-only, same contract as
//     repin.mjs), and only rewrites the exact stale entry it finds.

import { describe, it, expect } from 'vitest';
import {
  buildContextMonitorEntries,
  mergeContextMonitorSettings,
  migrateContextMonitorShape,
} from '../src/claude-settings.js';

const FAKE_ROOT = '/fake/plugin/root';
const entries = buildContextMonitorEntries(FAKE_ROOT);

// ---------------------------------------------------------------------------
// AC2 / AC7 — emitted shape matches the documented nested schema
// ---------------------------------------------------------------------------

describe('AC2/AC7 — buildContextMonitorEntries emits the documented nested shape', () => {
  it('stopHook nests the command inside a hooks[] array (no command at top level)', () => {
    expect(entries.stopHook.command).toBeUndefined();
    expect(Array.isArray(entries.stopHook.hooks)).toBe(true);
    expect(entries.stopHook.hooks).toHaveLength(1);
    expect(entries.stopHook.hooks[0]).toMatchObject({ type: 'command' });
    expect(entries.stopHook.hooks[0].command).toMatch(/stop-hook\.mjs/);
  });

  it('sessionStartHook nests the command inside a hooks[] array (no command at top level)', () => {
    expect(entries.sessionStartHook.command).toBeUndefined();
    expect(Array.isArray(entries.sessionStartHook.hooks)).toBe(true);
    expect(entries.sessionStartHook.hooks).toHaveLength(1);
    expect(entries.sessionStartHook.hooks[0]).toMatchObject({ type: 'command' });
    expect(entries.sessionStartHook.hooks[0].command).toMatch(/session-start\.mjs/);
  });

  it('statusLine is unaffected — stays the flat { type, command } shape', () => {
    // Different settings key, different (genuinely-honoured) shape — not part
    // of the hooks schema at all. Must NOT be nested.
    expect(entries.statusLine.command).toMatch(/statusline\.mjs/);
    expect(entries.statusLine.hooks).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// AC3 — matcher handled correctly per event
// ---------------------------------------------------------------------------

describe('AC3 — matcher is per-event correct', () => {
  it('SessionStart entry carries the matcher', () => {
    expect(entries.sessionStartHook.matcher).toBe('clear|compact');
  });

  it('Stop entry carries NO matcher key at all (Stop does not support matcher)', () => {
    expect('matcher' in entries.stopHook).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC4/AC5 — mergeContextMonitorSettings migrates a legacy flat entry in place
// ---------------------------------------------------------------------------

describe('AC4/AC5 — mergeContextMonitorSettings migrates legacy flat entries in place', () => {
  it('replaces a pre-existing legacy FLAT stop-hook.mjs entry with the nested shape', () => {
    const existing = {
      hooks: {
        Stop: [
          { type: 'command', command: 'node "/old/plugin/v1/context-monitor/stop-hook.mjs"' },
        ],
      },
    };

    const merged = mergeContextMonitorSettings(existing, entries);

    expect(merged.hooks.Stop).toHaveLength(1);
    expect(Array.isArray(merged.hooks.Stop[0].hooks)).toBe(true);
    expect(merged.hooks.Stop[0].hooks[0].command).toMatch(/stop-hook\.mjs/);
  });

  it('replaces a pre-existing legacy FLAT session-start.mjs entry with the nested shape', () => {
    const existing = {
      hooks: {
        SessionStart: [
          {
            type: 'command',
            matcher: 'clear|compact',
            command: 'node "/old/plugin/v1/context-monitor/session-start.mjs"',
          },
        ],
      },
    };

    const merged = mergeContextMonitorSettings(existing, entries);

    expect(merged.hooks.SessionStart).toHaveLength(1);
    expect(Array.isArray(merged.hooks.SessionStart[0].hooks)).toBe(true);
    expect(merged.hooks.SessionStart[0].hooks[0].command).toMatch(/session-start\.mjs/);
    expect(merged.hooks.SessionStart[0].matcher).toBe('clear|compact');
  });

  it('migration is idempotent: merging a second time after migration changes nothing', () => {
    const existing = {
      hooks: {
        Stop: [
          { type: 'command', command: 'node "/old/plugin/v1/context-monitor/stop-hook.mjs"' },
        ],
      },
    };

    const afterFirst = mergeContextMonitorSettings(existing, entries);
    const afterSecond = mergeContextMonitorSettings(afterFirst, entries);

    expect(afterSecond).toEqual(afterFirst);
    expect(afterSecond.hooks.Stop).toHaveLength(1);
  });

  it('an unrelated pre-existing Stop hook (not ours) survives the migration untouched', () => {
    const existing = {
      hooks: {
        Stop: [
          { type: 'command', command: 'node "/old/plugin/v1/context-monitor/stop-hook.mjs"' },
          { hooks: [{ type: 'command', command: 'node /some/other-hook.mjs' }] },
        ],
      },
    };

    const merged = mergeContextMonitorSettings(existing, entries);

    expect(merged.hooks.Stop).toHaveLength(2);
    const other = merged.hooks.Stop.find(
      (h) => h.hooks?.[0]?.command === 'node /some/other-hook.mjs',
    );
    expect(other, 'unrelated Stop hook must be preserved untouched').toBeDefined();
  });

  it('an unrelated pre-existing top-level setting survives the migration untouched', () => {
    const existing = {
      someOtherSetting: { nested: true, value: 42 },
      hooks: {
        Stop: [
          { type: 'command', command: 'node "/old/plugin/v1/context-monitor/stop-hook.mjs"' },
        ],
      },
    };

    const merged = mergeContextMonitorSettings(existing, entries);

    expect(merged.someOtherSetting).toEqual({ nested: true, value: 42 });
  });

  it('an already-correctly-nested entry is left untouched (no needless rewrite)', () => {
    const existing = {
      hooks: {
        Stop: [entries.stopHook],
      },
    };

    const merged = mergeContextMonitorSettings(existing, entries);

    // Same reference-equal content — proves we did not strip+re-add.
    expect(merged.hooks.Stop[0]).toEqual(entries.stopHook);
    expect(merged.hooks.Stop).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// AC6 — migrateContextMonitorShape: heal-only sibling used by the automatic
// plugin-level migration hook (context-monitor/settings-migrate.mjs).
// Composes with repin.mjs: repin.mjs repairs stale PATHS regardless of shape
// (already updated for TASK-209 to traverse both); this function repairs
// SHAPE only and never touches the path or injects new entries.
// ---------------------------------------------------------------------------

describe('AC6 — migrateContextMonitorShape is heal-only (never injects)', () => {
  it('does nothing when no context-monitor entries are present at all', () => {
    const existing = { hooks: { Stop: [{ type: 'command', command: 'node /unrelated.mjs' }] } };

    const { settings, changed } = migrateContextMonitorShape(existing, entries);

    expect(changed).toBe(false);
    expect(settings).toEqual(existing);
  });

  it('migrates a legacy flat stop-hook.mjs entry in place without injecting SessionStart', () => {
    const existing = {
      hooks: {
        Stop: [
          { type: 'command', command: 'node "/old/plugin/v1/context-monitor/stop-hook.mjs"' },
        ],
      },
    };

    const { settings, changed } = migrateContextMonitorShape(existing, entries);

    expect(changed).toBe(true);
    expect(Array.isArray(settings.hooks.Stop[0].hooks)).toBe(true);
    // Heal-only: must NOT inject a SessionStart array that was never there.
    expect(settings.hooks.SessionStart).toBeUndefined();
  });

  it('does not inject statusLine even when absent (heal-only, never force-enable)', () => {
    const existing = {
      hooks: {
        Stop: [
          { type: 'command', command: 'node "/old/plugin/v1/context-monitor/stop-hook.mjs"' },
        ],
      },
    };

    const { settings } = migrateContextMonitorShape(existing, entries);

    expect(settings.statusLine).toBeUndefined();
  });

  it('is idempotent: a second call after migration reports changed=false', () => {
    const existing = {
      hooks: {
        Stop: [
          { type: 'command', command: 'node "/old/plugin/v1/context-monitor/stop-hook.mjs"' },
        ],
      },
    };

    const first = migrateContextMonitorShape(existing, entries);
    const second = migrateContextMonitorShape(first.settings, entries);

    expect(second.changed).toBe(false);
    expect(second.settings).toEqual(first.settings);
  });
});
