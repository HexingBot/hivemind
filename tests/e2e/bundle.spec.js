// tests/e2e/bundle.spec.js
// TASK-092 — direct unit coverage for src/bundle.js's readBundleSessionOrThrow,
// the shared helper that replaces the raw-ENOENT twins previously duplicated
// in src/loop-auth.js (setLoopAuth, fixed by TASK-088), src/loop-checkpoint.js
// (writeLoopCheckpoint), and src/operating-mode.js (setMode).
//
// This spec proves the helper's own contract directly; the call-site specs
// (tests/e2e/loop-auth.spec.js, tests/e2e/loop-checkpoint.spec.js,
// tests/e2e/operating-mode.spec.js) prove it is actually wired in at each
// migrated seam.
//
// ACs covered:
//   AC1 — readBundleSessionOrThrow(repoRoot, sessionId, callerLabel) throws a
//         typed E_BUNDLE_MISSING naming the session id, the expected
//         session.json path, and the callerLabel, for the missing-bundle-dir
//         (ENOENT) case; readBundleSession itself is unchanged (still throws
//         a raw ENOENT with no code tailoring).
//
// Disk I/O / tmpdir -> slow tier: tests/e2e/.

import { describe, it, expect, afterAll } from 'vitest';
import {
  mkdirSync, writeFileSync, existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';

afterAll(cleanupAll);

const __thisDir = dirname(fileURLToPath(import.meta.url));
const __srcDir = join(__thisDir, '..', '..', 'src');
const BUNDLE_URL = pathToFileURL(join(__srcDir, 'bundle.js')).href;

const SESSION_ID = '20260704T000000Z-abcdef01';

// ---------------------------------------------------------------------------
// AC1 — readBundleSessionOrThrow tailors the missing-bundle-dir ENOENT case.
// ---------------------------------------------------------------------------

describe('AC1 — readBundleSessionOrThrow tailors a missing bundle dir to E_BUNDLE_MISSING', () => {
  it('throws E_BUNDLE_MISSING naming the session id, expected path, and callerLabel', async () => {
    const { readBundleSessionOrThrow, bundleSessionPath } = await import(BUNDLE_URL);
    const root = makeTmpDir('af-bundle-helper');
    mkdirSync(join(root, 'state'), { recursive: true });
    // No state/sessions/<id>/ at all — the bundle dir is simply absent.
    expect(existsSync(join(root, 'state', 'sessions', SESSION_ID))).toBe(false);

    let caughtErr;
    try {
      readBundleSessionOrThrow(root, SESSION_ID, 'unitTestCaller');
    } catch (err) {
      caughtErr = err;
    }

    expect(caughtErr, 'must throw when the bundle dir is missing').toBeDefined();
    expect(caughtErr.code, 'must be the tailored code, not a raw ENOENT').toBe('E_BUNDLE_MISSING');
    expect(caughtErr.code).not.toBe('ENOENT');
    expect(caughtErr.message).toContain(SESSION_ID);
    expect(caughtErr.message).toContain(bundleSessionPath(root, SESSION_ID));
    expect(caughtErr.message).toContain('unitTestCaller');
  });

  it('returns the parsed bundle when the session.json exists (pass-through, no behavior change)', async () => {
    const { readBundleSessionOrThrow } = await import(BUNDLE_URL);
    const root = makeTmpDir('af-bundle-helper-ok');
    const bundleDir = join(root, 'state', 'sessions', SESSION_ID);
    mkdirSync(bundleDir, { recursive: true });
    writeFileSync(join(bundleDir, 'session.json'), JSON.stringify({ session_id: SESSION_ID, mode: 'harness' }), 'utf8');

    const result = readBundleSessionOrThrow(root, SESSION_ID, 'unitTestCaller');
    expect(result.session_id).toBe(SESSION_ID);
    expect(result.mode).toBe('harness');
  });
});

// ---------------------------------------------------------------------------
// AC1 — readBundleSession itself is unchanged: no code tailoring, raw ENOENT.
// ---------------------------------------------------------------------------

describe('AC1 — readBundleSession is unchanged (existing callers unaffected)', () => {
  it('readBundleSession still throws a raw ENOENT for the missing-bundle-dir case', async () => {
    const { readBundleSession } = await import(BUNDLE_URL);
    const root = makeTmpDir('af-bundle-raw');
    mkdirSync(join(root, 'state'), { recursive: true });

    let caughtErr;
    try {
      readBundleSession(root, SESSION_ID);
    } catch (err) {
      caughtErr = err;
    }

    expect(caughtErr, 'readBundleSession must still throw').toBeDefined();
    expect(caughtErr.code).toBe('ENOENT');
  });
});

// ---------------------------------------------------------------------------
// TASK-212 — retired 'test' workflow_step/loop_state.phase migrates to 'impl'
// on read, so a bundle written before the tdd-tier retirement keeps reading
// (and, if written back, keeps validating) without manual intervention.
// ---------------------------------------------------------------------------

describe('TASK-212 — a pre-retirement bundle with workflow_step/phase "test" reads without throwing, mapped to "impl"', () => {
  it('readBundleSession maps a legacy workflow_step: "test" to "impl"', async () => {
    const { readBundleSession } = await import(BUNDLE_URL);
    const root = makeTmpDir('af-bundle-legacy-test-step');
    const bundleDir = join(root, 'state', 'sessions', SESSION_ID);
    mkdirSync(bundleDir, { recursive: true });
    writeFileSync(
      join(bundleDir, 'session.json'),
      JSON.stringify({ session_id: SESSION_ID, mode: 'harness', workflow_step: 'test' }),
      'utf8',
    );

    const result = readBundleSession(root, SESSION_ID);
    expect(result.workflow_step).toBe('impl');
  });

  it('readBundleSession maps a legacy loop_state.phase: "test" to "impl", preserving sibling loop_state fields', async () => {
    const { readBundleSession } = await import(BUNDLE_URL);
    const root = makeTmpDir('af-bundle-legacy-test-phase');
    const bundleDir = join(root, 'state', 'sessions', SESSION_ID);
    mkdirSync(bundleDir, { recursive: true });
    writeFileSync(
      join(bundleDir, 'session.json'),
      JSON.stringify({
        session_id: SESSION_ID,
        mode: 'loop',
        workflow_step: 'test',
        loop_state: {
          current_ticket: 'TASK-042', phase: 'test', iteration: 3, completed_this_run: 1,
        },
      }),
      'utf8',
    );

    const result = readBundleSession(root, SESSION_ID);
    expect(result.workflow_step).toBe('impl');
    expect(result.loop_state.phase).toBe('impl');
    // Sibling loop_state fields survive the migration untouched.
    expect(result.loop_state.current_ticket).toBe('TASK-042');
    expect(result.loop_state.iteration).toBe(3);
    expect(result.loop_state.completed_this_run).toBe(1);
  });

  it('readBundleSession leaves a non-"test" workflow_step/phase untouched', async () => {
    const { readBundleSession } = await import(BUNDLE_URL);
    const root = makeTmpDir('af-bundle-non-legacy-step');
    const bundleDir = join(root, 'state', 'sessions', SESSION_ID);
    mkdirSync(bundleDir, { recursive: true });
    writeFileSync(
      join(bundleDir, 'session.json'),
      JSON.stringify({
        session_id: SESSION_ID,
        mode: 'loop',
        workflow_step: 'review',
        loop_state: { current_ticket: 'TASK-042', phase: 'review' },
      }),
      'utf8',
    );

    const result = readBundleSession(root, SESSION_ID);
    expect(result.workflow_step).toBe('review');
    expect(result.loop_state.phase).toBe('review');
  });
});
