// tests/e2e/operating-mode.spec.js
// TASK-063 — e2e/bundle-touching tests for src/operating-mode.js
// (slow tier — real tmpdir + pointer + bundle on disk).
//
// ACs covered:
//   AC1 — default mode is 'harness'; absent-bundle / absent-`mode` backward-compat.
//   AC2 — getMode reads bundle and returns current mode; setMode writes mode atomically;
//          setMode is idempotent (calling with same value succeeds without error).
//   AC3/AC4 — setMode supports flip outside the loop (harness→loop, loop→harness).
//
// All tests MUST FAIL until src/operating-mode.js is created.
//
// Disk I/O / tmpdir → slow tier: tests/e2e/.

import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';

afterAll(cleanupAll);

// ---------------------------------------------------------------------------
// Resolve the production module via file URL — same pattern as session-lock.spec.js.
// ---------------------------------------------------------------------------
const __thisDir = dirname(fileURLToPath(import.meta.url));
const __srcDir = join(__thisDir, '..', '..', 'src');
const OPERATING_MODE_URL = pathToFileURL(join(__srcDir, 'operating-mode.js')).href;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Write a minimal pointer + active bundle under a fresh temp dir. */
function makeRepo({ sessionId, bundleExtra = {} } = {}) {
  const id = sessionId || '20260616T120000Z-deadbeef';
  const root = makeTmpDir('af-om');

  // Pointer
  mkdirSync(join(root, 'state'), { recursive: true });
  writeFileSync(
    join(root, 'state', 'session.json'),
    JSON.stringify({
      schema_version: 2,
      active_session_id: id,
      updated_at: '2026-06-16T12:00:00Z',
    }, null, 2),
    'utf8',
  );

  // Bundle
  const bundleDir = join(root, 'state', 'sessions', id);
  mkdirSync(bundleDir, { recursive: true });
  writeFileSync(
    join(bundleDir, 'session.json'),
    JSON.stringify({
      schema_version: 2,
      session_id: id,
      lifecycle_state: 'active',
      updated_at: '2026-06-16T12:00:00Z',
      active_task: 'TASK-063',
      workflow_step: 'implement',
      next_action: 'write tests',
      handoff_summary: 'in progress',
      open_questions: [],
      blockers: [],
      decisions: [],
      subagent_results: [],
      pending_human_confirmation: null,
      ...bundleExtra,
    }, null, 2),
    'utf8',
  );

  return { root, id };
}

// ---------------------------------------------------------------------------
// AC1 + AC2 — getMode returns 'harness' when bundle has no `mode` field (backward-compat)
// ---------------------------------------------------------------------------

describe('AC1 — getMode defaults to harness when bundle has no mode field', () => {
  it('getMode_returns_harness_for_legacy_bundle_without_mode', async () => {
    const { getMode } = await import(OPERATING_MODE_URL);
    const { root } = makeRepo(); // bundle has no `mode` field
    const result = await getMode({ repoRoot: root });
    expect(result).toBe('harness');
  });
});

// ---------------------------------------------------------------------------
// AC2 — getMode returns existing mode when bundle already has one
// ---------------------------------------------------------------------------

describe('AC2 — getMode reads mode from bundle', () => {
  it('getMode_returns_loop_when_bundle_mode_is_loop', async () => {
    const { getMode } = await import(OPERATING_MODE_URL);
    const { root } = makeRepo({ bundleExtra: { mode: 'loop' } });
    const result = await getMode({ repoRoot: root });
    expect(result).toBe('loop');
  });

  it('getMode_returns_harness_when_bundle_mode_is_harness', async () => {
    const { getMode } = await import(OPERATING_MODE_URL);
    const { root } = makeRepo({ bundleExtra: { mode: 'harness' } });
    const result = await getMode({ repoRoot: root });
    expect(result).toBe('harness');
  });
});

// ---------------------------------------------------------------------------
// AC2 + AC4 — setMode writes mode to bundle atomically (harness→loop flip)
// ---------------------------------------------------------------------------

describe('AC2/AC4 — setMode writes mode to bundle (harness→loop)', () => {
  it('setMode_flips_mode_to_loop_and_persists', async () => {
    const { setMode, getMode } = await import(OPERATING_MODE_URL);
    const { root, id } = makeRepo(); // starts with no mode (defaults harness)

    await setMode({ repoRoot: root, mode: 'loop' });

    // Verify via getMode.
    const result = await getMode({ repoRoot: root });
    expect(result).toBe('loop');

    // Verify the bundle file was actually updated on disk.
    const bundlePath = join(root, 'state', 'sessions', id, 'session.json');
    const onDisk = JSON.parse(readFileSync(bundlePath, 'utf8'));
    expect(onDisk.mode).toBe('loop');
  });
});

// ---------------------------------------------------------------------------
// AC2 + AC4 — setMode writes mode (loop→harness flip)
// ---------------------------------------------------------------------------

describe('AC2/AC4 — setMode writes mode to bundle (loop→harness)', () => {
  it('setMode_flips_mode_back_to_harness', async () => {
    const { setMode, getMode } = await import(OPERATING_MODE_URL);
    const { root } = makeRepo({ bundleExtra: { mode: 'loop' } });

    await setMode({ repoRoot: root, mode: 'harness' });

    const result = await getMode({ repoRoot: root });
    expect(result).toBe('harness');
  });
});

// ---------------------------------------------------------------------------
// AC2 — setMode is idempotent (same value twice must not throw)
// ---------------------------------------------------------------------------

describe('AC2 — setMode idempotency', () => {
  it('setMode_called_twice_with_same_value_does_not_throw', async () => {
    const { setMode, getMode } = await import(OPERATING_MODE_URL);
    const { root } = makeRepo();

    await expect(setMode({ repoRoot: root, mode: 'loop' })).resolves.not.toThrow();
    await expect(setMode({ repoRoot: root, mode: 'loop' })).resolves.not.toThrow();

    // Mode must remain 'loop' after two identical sets.
    const result = await getMode({ repoRoot: root });
    expect(result).toBe('loop');
  });

  it('setMode_harness_on_harness_does_not_throw', async () => {
    const { setMode } = await import(OPERATING_MODE_URL);
    const { root } = makeRepo({ bundleExtra: { mode: 'harness' } });

    await expect(setMode({ repoRoot: root, mode: 'harness' })).resolves.not.toThrow();
  });
});
