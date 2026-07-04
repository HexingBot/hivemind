// tests/loop-auth.spec.js
// TASK-075 — Pure-logic tests for src/loop-auth.js (fast tier, no disk I/O).
//
// ACs covered:
//   AC1 — setLoopAuth/grantUnattended validate switch names BEFORE any I/O
//         (unknown name -> typed throw, no bundle touched); absent bundle
//         surfaces a clear error (exercised here via a fake, non-existent
//         repoRoot so the validation-vs-IO ordering is provable without disk).
//   AC2 — UNATTENDED_PRESET composition: auto_close_on_green_review,
//         uat_delegated_to_orchestrator, auto_consolidate true;
//         auto_push_after_close / auto_version_bump_on_milestone default false.
//   AC3 — Gate 3 (ambiguous scope) has NO switch name in LOOP_AUTH_SWITCHES;
//         attempting to grant one is rejected as unknown.
//
// All tests MUST FAIL with "Cannot find module …loop-auth.js" until
// src/loop-auth.js is created in the IMPL phase.
//
// Pure-logic tier — top-level tests/, no real disk I/O. Validation logic that
// does NOT require an actual pointer+bundle on disk lives here (mirrors the
// tests/operating-mode.spec.js pattern: fake repoRoot proves validation runs
// before any file-system access).

import { describe, it, expect } from 'vitest';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __thisDir = dirname(fileURLToPath(import.meta.url));
const __srcDir = join(__thisDir, '..', 'src');
const LOOP_AUTH_URL = pathToFileURL(join(__srcDir, 'loop-auth.js')).href;

const FAKE_ROOT = '/fake/root/that/does/not/exist';

// ---------------------------------------------------------------------------
// Module shape
// ---------------------------------------------------------------------------

describe('AC1 — loop-auth module exports the expected seam', () => {
  it('module exports LOOP_AUTH_SWITCHES, UNATTENDED_PRESET, setLoopAuth, grantUnattended', async () => {
    const mod = await import(LOOP_AUTH_URL);
    expect(Array.isArray(mod.LOOP_AUTH_SWITCHES)).toBe(true);
    expect(typeof mod.UNATTENDED_PRESET).toBe('object');
    expect(mod.UNATTENDED_PRESET).not.toBeNull();
    expect(typeof mod.setLoopAuth).toBe('function');
    expect(typeof mod.grantUnattended).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// AC4 (schema side is covered in tests/loop-auth-schema.spec.js) — here we
// only assert the switch-name list itself, since setLoopAuth/grantUnattended
// validate against it.
// ---------------------------------------------------------------------------

describe('AC1/AC4 — LOOP_AUTH_SWITCHES is the five known switches', () => {
  it('contains exactly the five documented switch names', async () => {
    const { LOOP_AUTH_SWITCHES } = await import(LOOP_AUTH_URL);
    const expected = [
      'auto_close_on_green_review',
      'auto_push_after_close',
      'uat_delegated_to_orchestrator',
      'auto_version_bump_on_milestone',
      'auto_consolidate',
    ];
    expect([...LOOP_AUTH_SWITCHES].sort()).toEqual([...expected].sort());
  });
});

// ---------------------------------------------------------------------------
// AC2 — UNATTENDED_PRESET composition
// ---------------------------------------------------------------------------

describe('AC2 — UNATTENDED_PRESET composes the unattended defaults', () => {
  it('sets auto_close_on_green_review, uat_delegated_to_orchestrator, auto_consolidate true', async () => {
    const { UNATTENDED_PRESET } = await import(LOOP_AUTH_URL);
    expect(UNATTENDED_PRESET.auto_close_on_green_review).toBe(true);
    expect(UNATTENDED_PRESET.uat_delegated_to_orchestrator).toBe(true);
    expect(UNATTENDED_PRESET.auto_consolidate).toBe(true);
  });

  it('leaves auto_push_after_close and auto_version_bump_on_milestone false (opt-in only)', async () => {
    const { UNATTENDED_PRESET } = await import(LOOP_AUTH_URL);
    expect(UNATTENDED_PRESET.auto_push_after_close).toBe(false);
    expect(UNATTENDED_PRESET.auto_version_bump_on_milestone).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TASK-088 AC1 — LOOP_AUTH_SWITCHES and UNATTENDED_PRESET are frozen so a
// caller mutating either exported binding in place cannot poison later
// grantUnattended calls in the same process (see src/loop-auth.js header
// comment on the two exports). Disk-touching proof that a subsequent
// grantUnattended still writes canonical values lives in
// tests/e2e/loop-auth.spec.js (grantUnattended needs a real bundle on disk).
// ---------------------------------------------------------------------------

describe('TASK-088 AC1 — exported constants are frozen against mutation', () => {
  it('LOOP_AUTH_SWITCHES and UNATTENDED_PRESET are both frozen', async () => {
    const { LOOP_AUTH_SWITCHES, UNATTENDED_PRESET } = await import(LOOP_AUTH_URL);
    expect(Object.isFrozen(LOOP_AUTH_SWITCHES)).toBe(true);
    expect(Object.isFrozen(UNATTENDED_PRESET)).toBe(true);
  });

  it('flipping an existing key on UNATTENDED_PRESET throws (ESM runs in strict mode)', async () => {
    const { UNATTENDED_PRESET } = await import(LOOP_AUTH_URL);
    expect(() => {
      UNATTENDED_PRESET.auto_close_on_green_review = false;
    }).toThrow(TypeError);
    // The canonical value survives the failed mutation attempt.
    expect(UNATTENDED_PRESET.auto_close_on_green_review).toBe(true);
  });

  it('adding a new key to UNATTENDED_PRESET throws and the key never lands', async () => {
    const { UNATTENDED_PRESET } = await import(LOOP_AUTH_URL);
    expect(() => {
      UNATTENDED_PRESET.a_brand_new_switch = true;
    }).toThrow(TypeError);
    expect(UNATTENDED_PRESET.a_brand_new_switch).toBeUndefined();
  });

  it('pushing onto LOOP_AUTH_SWITCHES throws and the array stays a fixed five', async () => {
    const { LOOP_AUTH_SWITCHES } = await import(LOOP_AUTH_URL);
    expect(() => {
      LOOP_AUTH_SWITCHES.push('auto_resolve_ambiguity');
    }).toThrow(TypeError);
    expect(LOOP_AUTH_SWITCHES).toHaveLength(5);
    expect(LOOP_AUTH_SWITCHES).not.toContain('auto_resolve_ambiguity');
  });
});

// ---------------------------------------------------------------------------
// AC3 — Gate 3 (ambiguous scope) has no switch name at all.
// ---------------------------------------------------------------------------

describe('AC3 — gate 3 (ambiguous scope) is not representable as a switch', () => {
  it('LOOP_AUTH_SWITCHES contains no ambiguity/gate-3/scope-lifting switch name', async () => {
    const { LOOP_AUTH_SWITCHES } = await import(LOOP_AUTH_URL);
    for (const name of LOOP_AUTH_SWITCHES) {
      expect(name).not.toMatch(/ambig|gate.?3|scope/i);
    }
  });

  it('setLoopAuth rejects an attempt to grant a gate-3-shaped switch as unknown', async () => {
    const { setLoopAuth } = await import(LOOP_AUTH_URL);
    await expect(
      setLoopAuth({ repoRoot: FAKE_ROOT, grants: { auto_resolve_ambiguity: true } }),
    ).rejects.toThrow(/unknown|invalid/i);
  });

  it('grantUnattended rejects a gate-3-shaped optIn as unknown', async () => {
    const { grantUnattended } = await import(LOOP_AUTH_URL);
    await expect(
      grantUnattended({ repoRoot: FAKE_ROOT, optIns: { auto_resolve_ambiguity: true } }),
    ).rejects.toThrow(/unknown|invalid/i);
  });
});

// ---------------------------------------------------------------------------
// AC1 — validation-before-IO: unknown switch names must be rejected without
// ever touching the filesystem. We prove the ordering by pointing at a
// repoRoot that cannot possibly exist — if the error is a "not found" /
// filesystem style error, validation ran AFTER an I/O attempt (wrong order).
// If the error is the unknown-switch validation error, we know validation
// short-circuited before any I/O was attempted.
// ---------------------------------------------------------------------------

describe('AC1 — setLoopAuth validates switch names before touching disk', () => {
  it('rejects a single unknown switch name with a validation error, not a filesystem error', async () => {
    const { setLoopAuth } = await import(LOOP_AUTH_URL);
    await expect(
      setLoopAuth({ repoRoot: FAKE_ROOT, grants: { totally_made_up_switch: true } }),
    ).rejects.toThrow(/unknown|invalid/i);
  });

  it('rejects when ANY key in a multi-key grants object is unknown', async () => {
    const { setLoopAuth } = await import(LOOP_AUTH_URL);
    await expect(
      setLoopAuth({
        repoRoot: FAKE_ROOT,
        grants: { auto_close_on_green_review: true, bogus_switch: true },
      }),
    ).rejects.toThrow(/unknown|invalid/i);
  });

  it('valid switch names do not throw a validation error (may throw a not-found error instead)', async () => {
    const { setLoopAuth } = await import(LOOP_AUTH_URL);
    let caughtErr;
    try {
      await setLoopAuth({ repoRoot: FAKE_ROOT, grants: { auto_close_on_green_review: true } });
    } catch (err) {
      caughtErr = err;
    }
    if (caughtErr) {
      expect(caughtErr.message).not.toMatch(/unknown.*switch|invalid.*switch/i);
    }
  });
});

describe('AC1 — grantUnattended validates optIns keys before touching disk', () => {
  it('rejects an unknown optIn key with a validation error', async () => {
    const { grantUnattended } = await import(LOOP_AUTH_URL);
    await expect(
      grantUnattended({ repoRoot: FAKE_ROOT, optIns: { not_a_real_switch: true } }),
    ).rejects.toThrow(/unknown|invalid/i);
  });

  it('called with no optIns does not throw a validation error (may throw a not-found error instead)', async () => {
    const { grantUnattended } = await import(LOOP_AUTH_URL);
    let caughtErr;
    try {
      await grantUnattended({ repoRoot: FAKE_ROOT });
    } catch (err) {
      caughtErr = err;
    }
    if (caughtErr) {
      expect(caughtErr.message).not.toMatch(/unknown.*switch|invalid.*switch/i);
    }
  });
});

// ---------------------------------------------------------------------------
// AC1 — absent/null active session surfaces a clear, typed error message.
// We can't fabricate "a pointer exists but names no session" without disk
// I/O (covered in tests/e2e/loop-auth.spec.js); here we only assert that a
// repoRoot with no state/ directory at all produces SOME error (never a
// silent no-op / resolved promise), which is the minimum clear-error bar
// that must hold even before the e2e fixture is exercised.
// ---------------------------------------------------------------------------

describe('AC1 — absent bundle surfaces an error rather than silently succeeding', () => {
  it('setLoopAuth with a valid grant against a non-existent repoRoot rejects', async () => {
    const { setLoopAuth } = await import(LOOP_AUTH_URL);
    await expect(
      setLoopAuth({ repoRoot: FAKE_ROOT, grants: { auto_consolidate: true } }),
    ).rejects.toThrow();
  });
});
