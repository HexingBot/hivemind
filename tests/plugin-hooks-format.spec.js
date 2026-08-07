// tests/plugin-hooks-format.spec.js
// TASK-138 — regression sensor for the shipped hooks/hooks.json format.
//
// Bug: the shipped hooks/hooks.json failed Claude Code hook validation with
// `Error: Hook load failed: expected record, received undefined at path
// ["hooks"]`. Two format defects vs the canonical Claude Code plugin hook
// schema (authoritative: https://code.claude.com/docs/en/plugins.md,
// 'Migrate hooks'):
//   1. missing the top-level "hooks" wrapper object;
//   2. type/command flattened as siblings of "matcher" instead of nested
//      inside a "hooks": [...] array.
//
// This spec asserts the canonical nested shape directly against the shipped
// file, and separately proves the assertion helper is non-vacuous by running
// it against a crafted fixture reproducing the OLD flat (buggy) shape — that
// fixture must fail. This guards against a future regression back to the
// flat shape shipping undetected again.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './helpers/repoRoot.js';
import { collectFormatViolations } from './helpers/hookShapeViolations.js';

const HOOKS_JSON_PATH = join(REPO_ROOT, 'hooks', 'hooks.json');

// The OLD, buggy, flat shape that originally shipped and caused the
// "Hook load failed: expected record, received undefined at path [\"hooks\"]"
// error. No top-level "hooks" wrapper; type/command flattened as siblings of
// matcher. Used below purely to prove the assertions are non-vacuous.
const OLD_FLAT_SHAPE = {
  SessionStart: [
    {
      type: 'command',
      matcher: 'startup|resume|clear|compact',
      command: 'node "${CLAUDE_PLUGIN_ROOT}/context-monitor/repin.mjs"',
    },
  ],
};

// collectFormatViolations (the AC's structural validator) now lives in
// tests/helpers/hookShapeViolations.js (TASK-210 fix round, LOW-5) so
// tests/context-monitor-hook-shape.spec.js (TASK-210) can reuse the same
// validator against buildContextMonitorEntries's output instead of
// hand-rolling a second one for the identical schema.

describe('hooks/hooks.json canonical nested format (TASK-138 regression sensor)', () => {
  const raw = readFileSync(HOOKS_JSON_PATH, 'utf8');
  const doc = JSON.parse(raw);

  it('is valid JSON', () => {
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('top-level "hooks" is a plain object (record), not undefined/array', () => {
    expect(doc.hooks).toBeDefined();
    expect(typeof doc.hooks).toBe('object');
    expect(Array.isArray(doc.hooks)).toBe(false);
  });

  it('each event value (e.g. SessionStart) is an array', () => {
    for (const [eventName, eventValue] of Object.entries(doc.hooks)) {
      expect(Array.isArray(eventValue), `hooks.${eventName} must be an array`).toBe(true);
    }
  });

  it('every entry has a nested "hooks" array of {type, command} objects', () => {
    for (const eventValue of Object.values(doc.hooks)) {
      for (const entry of eventValue) {
        expect(Array.isArray(entry.hooks)).toBe(true);
        for (const nested of entry.hooks) {
          expect(typeof nested.type).toBe('string');
          expect(typeof nested.command).toBe('string');
        }
      }
    }
  });

  it('no entry carries a flat top-level "command" or "type" sibling of "matcher"', () => {
    for (const eventValue of Object.values(doc.hooks)) {
      for (const entry of eventValue) {
        expect(entry.command).toBeUndefined();
        expect(entry.type).toBeUndefined();
      }
    }
  });

  it('produces zero violations against the shipped hooks/hooks.json', () => {
    expect(collectFormatViolations(doc)).toEqual([]);
  });

  // ---------------------------------------------------------------------
  // Non-vacuity proof: the same validator, run against the OLD flat shape
  // that originally shipped and triggered "Hook load failed: expected
  // record, received undefined at path [\"hooks\"]", must fail.
  // ---------------------------------------------------------------------
  it('non-vacuity: the validator FAILS against the old flat (buggy) shape', () => {
    const violations = collectFormatViolations(OLD_FLAT_SHAPE);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations).toContain('missing top-level "hooks" key');
  });

  it('non-vacuity: even with a "hooks" wrapper added, flat type/command siblings still fail', () => {
    const wrappedButStillFlat = { hooks: OLD_FLAT_SHAPE };
    const violations = collectFormatViolations(wrappedButStillFlat);
    expect(violations.length).toBeGreaterThan(0);
    expect(
      violations.some((v) => v.includes('flat top-level "command"')),
    ).toBe(true);
    expect(
      violations.some((v) => v.includes('flat top-level "type"')),
    ).toBe(true);
    expect(
      violations.some((v) => v.includes('must have a nested "hooks" array')),
    ).toBe(true);
  });
});
