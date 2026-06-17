// tests/context-monitor-usage.spec.js
// TASK-008 — Port the 32 node:test cases from .claude/context-monitor/usage.test.mjs
// to vitest. These are pure-logic unit tests (no disk I/O) so they belong in the
// fast tier (tests/*.spec.js).
//
// AC map (TASK-008):
//   AC1 — scripts shipped under context-monitor/ (this spec covers usage.mjs)
//   AC5 — 32 usage cases ported from node:test to vitest

import { describe, it, expect } from 'vitest';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __thisDir = dirname(fileURLToPath(import.meta.url));
const USAGE_URL = pathToFileURL(join(__thisDir, '..', 'context-monitor', 'usage.mjs')).href;

// Dynamic import so tests fail with the correct "module not found" when the file
// hasn't been created yet (the right failure for tests-first).
const { THRESHOLD, readUsagePercent, shouldFlush, armedFlagName, instructedFlagName } =
  await import(USAGE_URL);

// ---------------------------------------------------------------------------
// THRESHOLD constant
// ---------------------------------------------------------------------------

describe('THRESHOLD', () => {
  it('is exactly 35', () => {
    expect(THRESHOLD).toBe(35);
  });

  it('is a number (not null, not string)', () => {
    expect(typeof THRESHOLD).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// readUsagePercent
// ---------------------------------------------------------------------------

describe('readUsagePercent', () => {
  it('returns the used_percentage from a valid statusline object', () => {
    const input = { context_window: { used_percentage: 42.7 } };
    expect(readUsagePercent(input)).toBe(42.7);
  });

  it('returns 0 when used_percentage is 0', () => {
    const input = { context_window: { used_percentage: 0 } };
    expect(readUsagePercent(input)).toBe(0);
  });

  it('returns 100 when used_percentage is 100', () => {
    const input = { context_window: { used_percentage: 100 } };
    expect(readUsagePercent(input)).toBe(100);
  });

  it('returns null for an empty object {}', () => {
    expect(readUsagePercent({})).toBeNull();
  });

  it('returns null when context_window key is missing', () => {
    const input = { model: { id: 'claude-3' } };
    expect(readUsagePercent(input)).toBeNull();
  });

  it('returns null when context_window exists but used_percentage is absent', () => {
    const input = { context_window: { total_input_tokens: 5000 } };
    expect(readUsagePercent(input)).toBeNull();
  });

  it('returns null for null input', () => {
    expect(readUsagePercent(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(readUsagePercent(undefined)).toBeNull();
  });

  it('returns null when used_percentage is not a number (string)', () => {
    const input = { context_window: { used_percentage: '42' } };
    expect(readUsagePercent(input)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// shouldFlush — boundary cases
// ---------------------------------------------------------------------------

describe('shouldFlush — boundary cases', () => {
  it('returns false at 34.9 (just below threshold)', () => {
    expect(shouldFlush(34.9, false)).toBe(false);
  });

  it('returns true at exactly 35.0 (at threshold)', () => {
    expect(shouldFlush(35.0, false)).toBe(true);
  });

  it('returns true at 35.1 (just above threshold)', () => {
    expect(shouldFlush(35.1, false)).toBe(true);
  });

  it('returns true at 100 (fully saturated)', () => {
    expect(shouldFlush(100, false)).toBe(true);
  });

  it('returns false at 0 (empty context)', () => {
    expect(shouldFlush(0, false)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// shouldFlush — idempotency
// ---------------------------------------------------------------------------

describe('shouldFlush — idempotency', () => {
  it('returns false when alreadyFlagged=true even though percent >= threshold', () => {
    expect(shouldFlush(40, true)).toBe(false);
  });

  it('returns true when alreadyFlagged=false and percent >= threshold', () => {
    expect(shouldFlush(40, false)).toBe(true);
  });

  it('returns false when alreadyFlagged=true at exactly THRESHOLD', () => {
    expect(shouldFlush(35, true)).toBe(false);
  });

  it('returns false when alreadyFlagged=true well above threshold', () => {
    expect(shouldFlush(99, true)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// shouldFlush — null percent (unknown usage)
// ---------------------------------------------------------------------------

describe('shouldFlush — null percent', () => {
  it('returns false when percent is null', () => {
    expect(shouldFlush(null, false)).toBe(false);
  });

  it('returns false when percent is null even if not already flagged', () => {
    expect(shouldFlush(null, false)).toBe(false);
  });

  it('returns false when percent is null and alreadyFlagged=true', () => {
    expect(shouldFlush(null, true)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// armedFlagName — pure path-name helper
// ---------------------------------------------------------------------------

describe('armedFlagName', () => {
  it('returns .flush-<sessionId> for a given session id', () => {
    expect(armedFlagName('abc123')).toBe('.flush-abc123');
  });

  it('returns .flush-default when sessionId is null', () => {
    expect(armedFlagName(null)).toBe('.flush-default');
  });

  it('returns .flush-default when sessionId is undefined', () => {
    expect(armedFlagName(undefined)).toBe('.flush-default');
  });

  it('returns .flush-default when sessionId is empty string', () => {
    expect(armedFlagName('')).toBe('.flush-default');
  });
});

// ---------------------------------------------------------------------------
// instructedFlagName — pure path-name helper
// ---------------------------------------------------------------------------

describe('instructedFlagName', () => {
  it('returns .instructed-<sessionId> for a given session id', () => {
    expect(instructedFlagName('abc123')).toBe('.instructed-abc123');
  });

  it('returns .instructed-default when sessionId is null', () => {
    expect(instructedFlagName(null)).toBe('.instructed-default');
  });

  it('returns .instructed-default when sessionId is undefined', () => {
    expect(instructedFlagName(undefined)).toBe('.instructed-default');
  });

  it('returns .instructed-default when sessionId is empty string', () => {
    expect(instructedFlagName('')).toBe('.instructed-default');
  });

  it('armed and instructed flags differ for the same session', () => {
    const sid = 'sess-xyz';
    expect(armedFlagName(sid)).not.toBe(instructedFlagName(sid));
  });
});
