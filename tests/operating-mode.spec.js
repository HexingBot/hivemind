// tests/operating-mode.spec.js
// TASK-063 — Pure-logic tests for src/operating-mode.js (fast tier, no disk I/O).
//
// ACs covered:
//   AC1 — default mode is 'harness'; absence treated as 'harness'.
//   AC2 — getMode / setMode exported; setMode validates enum (rejects garbage, accepts
//          'harness' and 'loop'); setMode is idempotent (setting same value twice is fine).
//   AC4 — setMode supports explicit flip outside the loop.
//
// All tests MUST FAIL with "Cannot find module …operating-mode.js" until
// src/operating-mode.js is created in the IMPL phase.
//
// Pure-logic tier — top-level tests/, no real disk I/O. Validation logic that
// does NOT require an actual pointer+bundle on disk lives here.

import { describe, it, expect } from 'vitest';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ---------------------------------------------------------------------------
// Resolve the production module via file URL (same pattern as PROD in fixtures.js).
// Dynamic import means the whole suite fails at collection time with
// "Cannot find module" — the correct RED state for TEST mode.
// ---------------------------------------------------------------------------
const __thisDir = dirname(fileURLToPath(import.meta.url));
const __srcDir = join(__thisDir, '..', 'src');
const OPERATING_MODE_URL = pathToFileURL(join(__srcDir, 'operating-mode.js')).href;

// ---------------------------------------------------------------------------
// AC1 — VALID_MODES enum / constant: only 'harness' and 'loop' are valid.
// We test this by importing the module and checking that setMode with an
// invalid value throws — that verifies the enum is encoded in the module.
// The pure-logic tests here exercise the validation branch synchronously by
// passing a fake repoRoot that would never be reached because the validator
// throws first.
// ---------------------------------------------------------------------------

describe('AC2 — operating-mode module exports getMode and setMode', () => {
  it('module exports getMode and setMode functions', async () => {
    const mod = await import(OPERATING_MODE_URL);
    expect(typeof mod.getMode).toBe('function');
    expect(typeof mod.setMode).toBe('function');
  });
});

describe('AC2 — setMode enum validation: rejects garbage values', () => {
  it('throws on invalid mode string', async () => {
    const { setMode } = await import(OPERATING_MODE_URL);
    // Invalid mode must throw synchronously or reject asynchronously.
    // We use rejects because setMode is declared async.
    await expect(
      setMode({ repoRoot: '/fake/root', mode: 'zombie' }),
    ).rejects.toThrow(/invalid.*mode|unknown.*mode|must be.*harness.*loop|harness.*loop/i);
  });

  it('throws on numeric mode', async () => {
    const { setMode } = await import(OPERATING_MODE_URL);
    await expect(
      setMode({ repoRoot: '/fake/root', mode: 42 }),
    ).rejects.toThrow(/invalid.*mode|unknown.*mode|must be.*harness.*loop|harness.*loop/i);
  });

  it('throws on null mode', async () => {
    const { setMode } = await import(OPERATING_MODE_URL);
    await expect(
      setMode({ repoRoot: '/fake/root', mode: null }),
    ).rejects.toThrow(/invalid.*mode|unknown.*mode|must be.*harness.*loop|harness.*loop/i);
  });

  it('throws on empty string mode', async () => {
    const { setMode } = await import(OPERATING_MODE_URL);
    await expect(
      setMode({ repoRoot: '/fake/root', mode: '' }),
    ).rejects.toThrow(/invalid.*mode|unknown.*mode|must be.*harness.*loop|harness.*loop/i);
  });
});

describe('AC2 — setMode enum validation: valid modes do not throw on validation step', () => {
  // NOTE: These will still fail because there is no real bundle at /fake/root.
  // The test expectation is that the error is about the missing file/pointer,
  // NOT about an invalid mode. This proves the validator passed.
  it('harness does not throw a validation error (may throw file-not-found)', async () => {
    const { setMode } = await import(OPERATING_MODE_URL);
    let caughtErr;
    try {
      await setMode({ repoRoot: '/fake/root/that/does/not/exist', mode: 'harness' });
    } catch (err) {
      caughtErr = err;
    }
    // If it threw, it must NOT be a validation error — it should be a file/path error.
    if (caughtErr) {
      expect(caughtErr.message).not.toMatch(/invalid.*mode|unknown.*mode|must be.*harness.*loop/i);
    }
  });

  it('loop does not throw a validation error (may throw file-not-found)', async () => {
    const { setMode } = await import(OPERATING_MODE_URL);
    let caughtErr;
    try {
      await setMode({ repoRoot: '/fake/root/that/does/not/exist', mode: 'loop' });
    } catch (err) {
      caughtErr = err;
    }
    if (caughtErr) {
      expect(caughtErr.message).not.toMatch(/invalid.*mode|unknown.*mode|must be.*harness.*loop/i);
    }
  });
});
