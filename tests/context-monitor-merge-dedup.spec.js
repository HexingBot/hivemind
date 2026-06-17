// tests/context-monitor-merge-dedup.spec.js
// TASK-009 — Close the two LOW reviewer test gaps for mergeContextMonitorSettings.
//
// AC map (TASK-009):
//   AC3 — calling mergeContextMonitorSettings twice does NOT grow Stop/SessionStart arrays
//   AC4 — a pre-existing statusLine entry in a project's settings.json is left UNTOUCHED

import { describe, it, expect } from 'vitest';
import {
  mergeContextMonitorSettings,
  buildContextMonitorEntries,
} from '../src/claude-settings.js';

// Use a fixed plugin root so tests are deterministic and path-independent.
const FAKE_ROOT = '/fake/plugin/root';
const entries = buildContextMonitorEntries(FAKE_ROOT);

// ---------------------------------------------------------------------------
// AC3 — idempotent re-merge: Stop and SessionStart arrays must NOT grow on
// a second call to mergeContextMonitorSettings with the same base.
// ---------------------------------------------------------------------------

describe('AC3 — mergeContextMonitorSettings dedup: second merge does not grow arrays', () => {
  it('Stop array length is 1 after merging into an empty settings object twice', () => {
    const afterFirst = mergeContextMonitorSettings({}, entries);
    const afterSecond = mergeContextMonitorSettings(afterFirst, entries);

    expect(afterSecond.hooks.Stop).toHaveLength(1);
  });

  it('SessionStart array length is 1 after merging into an empty settings object twice', () => {
    const afterFirst = mergeContextMonitorSettings({}, entries);
    const afterSecond = mergeContextMonitorSettings(afterFirst, entries);

    expect(afterSecond.hooks.SessionStart).toHaveLength(1);
  });

  it('Stop array does not grow when merged a third time', () => {
    const once = mergeContextMonitorSettings({}, entries);
    const twice = mergeContextMonitorSettings(once, entries);
    const thrice = mergeContextMonitorSettings(twice, entries);

    expect(thrice.hooks.Stop).toHaveLength(1);
  });

  it('SessionStart array does not grow when merged a third time', () => {
    const once = mergeContextMonitorSettings({}, entries);
    const twice = mergeContextMonitorSettings(once, entries);
    const thrice = mergeContextMonitorSettings(twice, entries);

    expect(thrice.hooks.SessionStart).toHaveLength(1);
  });

  it('does not mutate the first-merge output when called a second time', () => {
    const afterFirst = mergeContextMonitorSettings({}, entries);
    const stopCountBefore = afterFirst.hooks.Stop.length;
    const sessionStartCountBefore = afterFirst.hooks.SessionStart.length;

    mergeContextMonitorSettings(afterFirst, entries);

    // afterFirst must not be mutated
    expect(afterFirst.hooks.Stop.length).toBe(stopCountBefore);
    expect(afterFirst.hooks.SessionStart.length).toBe(sessionStartCountBefore);
  });

  it('pre-existing non-context-monitor Stop hooks are preserved across two merges', () => {
    const existing = {
      hooks: {
        Stop: [{ type: 'command', command: 'node /some/other-hook.mjs' }],
      },
    };
    const afterFirst = mergeContextMonitorSettings(existing, entries);
    const afterSecond = mergeContextMonitorSettings(afterFirst, entries);

    // Should have exactly 2: the pre-existing one + our stop-hook.mjs
    expect(afterSecond.hooks.Stop).toHaveLength(2);
    const otherHook = afterSecond.hooks.Stop.find(
      (h) => h.command === 'node /some/other-hook.mjs',
    );
    expect(otherHook, 'pre-existing non-context-monitor Stop hook must be preserved').toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// AC4 — pre-existing statusLine is left UNTOUCHED by merge.
// ---------------------------------------------------------------------------

describe('AC4 — pre-existing statusLine is left untouched by merge', () => {
  it('leaves a pre-existing statusLine command unchanged', () => {
    const preExistingStatusLine = {
      type: 'command',
      command: 'node /pre-existing/my-statusline.mjs',
    };
    const existing = { statusLine: preExistingStatusLine };

    const merged = mergeContextMonitorSettings(existing, entries);

    expect(merged.statusLine.command).toBe('node /pre-existing/my-statusline.mjs');
  });

  it('does not overwrite any field on a pre-existing statusLine object', () => {
    const preExistingStatusLine = {
      type: 'command',
      command: 'node /pre-existing/my-statusline.mjs',
      refreshInterval: 5,
      customField: 'preserved',
    };
    const existing = { statusLine: preExistingStatusLine };

    const merged = mergeContextMonitorSettings(existing, entries);

    expect(merged.statusLine).toEqual(preExistingStatusLine);
  });

  it('still adds hook entries even when statusLine is already present', () => {
    const existing = {
      statusLine: {
        type: 'command',
        command: 'node /custom/statusline.mjs',
      },
    };

    const merged = mergeContextMonitorSettings(existing, entries);

    // statusLine preserved (custom)
    expect(merged.statusLine.command).toBe('node /custom/statusline.mjs');
    // hooks still added
    expect(merged.hooks.Stop.length).toBeGreaterThan(0);
    expect(merged.hooks.SessionStart.length).toBeGreaterThan(0);
  });

  it('second merge with pre-existing statusLine still does not overwrite it', () => {
    const existing = {
      statusLine: {
        type: 'command',
        command: 'node /pre-existing/my-statusline.mjs',
      },
    };

    const afterFirst = mergeContextMonitorSettings(existing, entries);
    const afterSecond = mergeContextMonitorSettings(afterFirst, entries);

    expect(afterSecond.statusLine.command).toBe('node /pre-existing/my-statusline.mjs');
  });
});
