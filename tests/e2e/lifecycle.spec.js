// tests/lifecycle.spec.js
// AC4 — pause refreshes required fields.
// AC5 — idempotency: pause-on-paused, resume-on-active, end-on-ended are no-ops.
//
// Maps research §H:
//   #7  pause_refreshes_required_fields
//   #9  pause_on_paused_is_noop
//   #10 resume_on_active_is_noop
//   #11 end_on_ended_is_noop
//   #12 pause_on_ended_errors

import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  PROD, makeSessionId, seedActiveBundle, seedBundleInState, bundlePath,
  makeRepoSkeleton, pointerPath,
} from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';

afterAll(cleanupAll);

function setupBundle(label, lifecycleState = 'active') {
  const repoDir = makeTmpDir(label);
  const id = makeSessionId(label.length);
  const dir = bundlePath(repoDir, id);
  if (lifecycleState === 'active') {
    seedActiveBundle(dir, { session_id: id });
  } else {
    seedBundleInState(dir, lifecycleState, { session_id: id });
  }
  // Pointer points at the bundle for all lifecycle states. The earlier
  // "null pointer + ended bundle" wiring was incidental — it leaned on the
  // mtime fallback in loadActiveBundleWithFallback. TASK-008 LOW #2 removes
  // that fallback for pause/resume so the helper now reflects the canonical
  // shape: pointer always references the bundle whose lifecycle_state is
  // under test. The dedicated null-pointer case lives in
  // tests/lifecycle-polish.spec.js.
  makeRepoSkeleton(repoDir, {
    pointer: { schema_version: 2, active_session_id: id, updated_at: '2026-05-24T12:00:00Z' },
  });
  return { repoDir, id, dir };
}

function readLifecycleLog(dir) {
  return readFileSync(join(dir, 'lifecycle.log'), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

describe('AC4 — pause refreshes required fields', () => {
  it('pause_refreshes_required_fields', async () => {
    const { pauseSession } = await import(PROD.lifecycle);
    const { repoDir, dir } = setupBundle('af-pause-fields');

    const before = JSON.parse(readFileSync(join(dir, 'session.json'), 'utf8'));
    await new Promise((r) => setTimeout(r, 5)); // ensure updated_at advances

    await pauseSession({
      repoRoot: repoDir,
      handoffSummary: 'a fresh handoff',
      nextAction: 'pick up where we left off',
    });

    const after = JSON.parse(readFileSync(join(dir, 'session.json'), 'utf8'));
    expect(after.lifecycle_state).toBe('paused');
    expect(after.handoff_summary).toBe('a fresh handoff');
    expect(after.next_action).toBe('pick up where we left off');
    expect(after.updated_at).not.toBe(before.updated_at);
  });

  it('pause_fails_fast_when_handoff_summary_missing', async () => {
    const { pauseSession } = await import(PROD.lifecycle);
    const { repoDir } = setupBundle('af-pause-missing-handoff');

    await expect(
      pauseSession({ repoRoot: repoDir, nextAction: 'something' }),
    ).rejects.toThrow(/handoff/i);
  });
});

describe('AC5 — idempotency', () => {
  it('pause_on_paused_is_noop', async () => {
    const { pauseSession } = await import(PROD.lifecycle);
    const { repoDir, dir } = setupBundle('af-noop-pause', 'paused');
    const target = join(dir, 'session.json');
    const before = readFileSync(target, 'utf8');
    const beforeMtime = statSync(target).mtimeMs;
    const beforeLog = readLifecycleLog(dir);

    await pauseSession({
      repoRoot: repoDir,
      handoffSummary: 'noop attempt',
      nextAction: 'should be ignored',
    });

    // session.json untouched (byte-equal AND mtime unchanged).
    expect(readFileSync(target, 'utf8')).toBe(before);
    expect(statSync(target).mtimeMs).toBe(beforeMtime);

    // lifecycle.log gained exactly one entry, idempotent_noop=true.
    const afterLog = readLifecycleLog(dir);
    expect(afterLog.length).toBe(beforeLog.length + 1);
    expect(afterLog[afterLog.length - 1]).toMatchObject({
      op: 'pause',
      idempotent_noop: true,
    });
  });

  it('resume_on_active_is_noop', async () => {
    const { resumeSession } = await import(PROD.lifecycle);
    const { repoDir, dir } = setupBundle('af-noop-resume', 'active');
    const target = join(dir, 'session.json');
    const before = readFileSync(target, 'utf8');
    const beforeMtime = statSync(target).mtimeMs;
    const beforeLog = readLifecycleLog(dir);

    await resumeSession({ repoRoot: repoDir });

    expect(readFileSync(target, 'utf8')).toBe(before);
    expect(statSync(target).mtimeMs).toBe(beforeMtime);
    const afterLog = readLifecycleLog(dir);
    expect(afterLog.length).toBe(beforeLog.length + 1);
    expect(afterLog[afterLog.length - 1]).toMatchObject({
      op: 'resume',
      idempotent_noop: true,
    });
  });

  it('end_on_ended_is_noop', async () => {
    const { endSession } = await import(PROD.lifecycle);
    const { repoDir, dir } = setupBundle('af-noop-end', 'ended');
    const target = join(dir, 'session.json');
    const summary = join(dir, 'summary.md');
    const before = readFileSync(target, 'utf8');
    const beforeMtime = statSync(target).mtimeMs;
    const beforeSummary = readFileSync(summary, 'utf8');
    const beforeSummaryMtime = statSync(summary).mtimeMs;
    const beforeLog = readLifecycleLog(dir);

    await endSession({
      repoRoot: repoDir,
      handoffSummary: 'noop attempt',
    });

    expect(readFileSync(target, 'utf8')).toBe(before);
    expect(statSync(target).mtimeMs).toBe(beforeMtime);
    expect(readFileSync(summary, 'utf8')).toBe(beforeSummary);
    expect(statSync(summary).mtimeMs).toBe(beforeSummaryMtime);
    const afterLog = readLifecycleLog(dir);
    expect(afterLog.length).toBe(beforeLog.length + 1);
    expect(afterLog[afterLog.length - 1]).toMatchObject({
      op: 'end',
      idempotent_noop: true,
    });
  });

  it('pause_on_ended_errors', async () => {
    const { pauseSession } = await import(PROD.lifecycle);
    const { repoDir, dir } = setupBundle('af-error-pause-ended', 'ended');
    const target = join(dir, 'session.json');
    const before = readFileSync(target, 'utf8');

    let caught;
    try {
      await pauseSession({
        repoRoot: repoDir,
        handoffSummary: 'should fail',
        nextAction: 'should fail',
      });
    } catch (e) {
      caught = e;
    }
    expect(caught, 'expected pauseSession to throw on ended bundle').toBeDefined();
    // Stable error code per research §C. Pinned to the single code the
    // implementation actually emits (TASK-008 LOW #5 polish — was a
    // three-alternation regex).
    expect(caught.code).toBe('E_INVALID_TRANSITION');
    // State untouched.
    expect(readFileSync(target, 'utf8')).toBe(before);
  });
});
