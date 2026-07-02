// tests/e2e/close-guard.spec.js
// TASK-082 — deep-review S1: loop-mode close guard, the injectable policy seam.
//
// TEST MODE — src/close-guard.js does NOT exist yet. Every import below fails
// with "Cannot find module …close-guard.js" until IMPL creates it — the
// expected tests-first failure for a brand-new module (mirrors the TASK-075
// precedent for src/loop-auth.js).
//
// SEAM CONTRACT encoded here:
//   - New module src/close-guard.js exports:
//       * `LoopCloseGuardError` — Error subclass, `.name ===
//         'LoopCloseGuardError'`, `.code === 'LOOP_CLOSE_GUARD_DENIED'`.
//       * `loopModeCloseGuard({ repoRoot, task, key })` — async function.
//         Reads the active bundle's `mode` (via src/operating-mode.js's
//         getMode, which already defaults to 'harness' on any missing/corrupt
//         pointer or bundle) and, when mode === 'loop', reads
//         bundle.loop_auth directly (same readPointer/readBundleSession
//         primitives src/operating-mode.js and src/loop-auth.js already use —
//         this module reads bundle state itself; it does NOT need a new
//         export added to loop-auth.js).
//         - mode !== 'loop' (including 'harness' or no active session) ->
//           resolves without throwing (no-op).
//         - mode === 'loop' && loop_auth.auto_close_on_green_review !== true
//           -> throws LoopCloseGuardError.
//         - mode === 'loop' && loop_auth.auto_close_on_green_review === true
//           -> resolves without throwing.
//   - This is the exact shape task-store.transitionStatus/closeTask's
//     `closeGuard` param expects: `async ({ repoRoot, task, key }) => void`,
//     called ONLY when status === 'done', AFTER the uat-only guard and BEFORE
//     any disk write. task-store.js itself imports NOTHING from
//     close-guard.js, operating-mode.js, bundle.js, or loop-auth.js — the MCP
//     layer (src/mcp-server.js) is what imports loopModeCloseGuard and passes
//     it as `closeGuard` into transitionStatus/closeTask. This is the
//     "task-store must not hard-couple to bundle internals" requirement.

import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';
import { makeRepoSkeleton } from '../helpers/fixtures.js';

afterAll(cleanupAll);

const __thisDir = dirname(fileURLToPath(import.meta.url));
const __srcDir = join(__thisDir, '..', '..', 'src');
const CLOSE_GUARD_URL = pathToFileURL(join(__srcDir, 'close-guard.js')).href;
const TASK_STORE_URL = pathToFileURL(join(__srcDir, 'task-store.js')).href;

/** Write pointer + active bundle with the given mode/loop_auth under a fresh tmp repo. */
function makeRepoWithMode({ mode, loopAuth, sessionId = '20260702T120000Z-c105e6a1', noBundle = false } = {}) {
  const root = makeTmpDir('af-closeguard');
  mkdirSync(join(root, 'state'), { recursive: true });

  writeFileSync(
    join(root, 'state', 'session.json'),
    JSON.stringify({
      schema_version: 2,
      active_session_id: sessionId,
      updated_at: '2026-07-02T12:00:00Z',
    }, null, 2),
    'utf8',
  );

  if (!noBundle) {
    const bundleDir = join(root, 'state', 'sessions', sessionId);
    mkdirSync(bundleDir, { recursive: true });
    writeFileSync(
      join(bundleDir, 'session.json'),
      JSON.stringify({
        schema_version: 2,
        session_id: sessionId,
        lifecycle_state: 'active',
        updated_at: '2026-07-02T12:00:00Z',
        active_task: 'TASK-082',
        workflow_step: 'impl',
        next_action: 'close_task guard specs',
        handoff_summary: 'in progress',
        open_questions: [],
        blockers: [],
        decisions: [],
        subagent_results: [],
        pending_human_confirmation: null,
        ...(mode !== undefined ? { mode } : {}),
        ...(loopAuth !== undefined ? { loop_auth: loopAuth } : {}),
      }, null, 2),
      'utf8',
    );
  }

  return { root, sessionId };
}

function readTaskFileBytes(repoDir, key) {
  return readFileSync(join(repoDir, 'tasks', `${key}.json`), 'utf8');
}

function makeTask(key) {
  return {
    key,
    title: `Fixture ${key}`,
    description: 'Fixture task for TASK-082 close-guard e2e specs.',
    acceptance_criteria: ['covered by TASK-082 specs'],
    status: 'todo',
    priority: 'medium',
    labels: [],
    assignee: null,
    depends_on: [],
    linked_commits: [],
    linked_prs: [],
    comments: [],
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    jira_key: null,
    verification_tier: 'tdd',
  };
}

// ===========================================================================
// AC2 — loopModeCloseGuard itself (module-level contract)
// ===========================================================================
describe('AC2 — loopModeCloseGuard', () => {
  it('is a no-op when there is no active session (fresh repo, no pointer)', async () => {
    const { loopModeCloseGuard } = await import(CLOSE_GUARD_URL);
    const root = makeTmpDir('af-closeguard-nosession');
    mkdirSync(join(root, 'state'), { recursive: true });

    await expect(loopModeCloseGuard({ repoRoot: root })).resolves.not.toThrow();
  });

  it('is a no-op when the active bundle mode is harness', async () => {
    const { loopModeCloseGuard } = await import(CLOSE_GUARD_URL);
    const { root } = makeRepoWithMode({ mode: 'harness' });

    await expect(loopModeCloseGuard({ repoRoot: root })).resolves.not.toThrow();
  });

  it('throws LoopCloseGuardError when mode is loop and auto_close_on_green_review is not true', async () => {
    const { loopModeCloseGuard, LoopCloseGuardError } = await import(CLOSE_GUARD_URL);
    const { root } = makeRepoWithMode({ mode: 'loop', loopAuth: {} });

    let caught;
    try {
      await loopModeCloseGuard({ repoRoot: root });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(LoopCloseGuardError);
    expect(caught.code).toBe('LOOP_CLOSE_GUARD_DENIED');
  });

  it('throws LoopCloseGuardError when mode is loop and auto_close_on_green_review is explicitly false', async () => {
    const { loopModeCloseGuard, LoopCloseGuardError } = await import(CLOSE_GUARD_URL);
    const { root } = makeRepoWithMode({
      mode: 'loop',
      loopAuth: { auto_close_on_green_review: false },
    });

    await expect(loopModeCloseGuard({ repoRoot: root })).rejects.toBeInstanceOf(LoopCloseGuardError);
  });

  it('resolves without throwing when mode is loop and auto_close_on_green_review is true', async () => {
    const { loopModeCloseGuard } = await import(CLOSE_GUARD_URL);
    const { root } = makeRepoWithMode({
      mode: 'loop',
      loopAuth: { auto_close_on_green_review: true },
    });

    await expect(loopModeCloseGuard({ repoRoot: root })).resolves.not.toThrow();
  });
});

// ===========================================================================
// AC2 — composition: transitionStatus({..., closeGuard: loopModeCloseGuard})
// enforces the loop-mode gate end-to-end, and task-store is inert without it.
// ===========================================================================
describe('AC2 — transitionStatus composed with loopModeCloseGuard', () => {
  it('blocks close-to-done in unauthorized loop mode and leaves the task file untouched', async () => {
    const { transitionStatus } = await import(TASK_STORE_URL);
    const { loopModeCloseGuard, LoopCloseGuardError } = await import(CLOSE_GUARD_URL);

    const { root } = makeRepoWithMode({ mode: 'loop', loopAuth: {} });
    makeRepoSkeleton(root, { tasks: { 'TASK-210': makeTask('TASK-210') } });
    const before = readTaskFileBytes(root, 'TASK-210');

    await expect(
      transitionStatus({
        repoRoot: root,
        key: 'TASK-210',
        status: 'done',
        closeGuard: loopModeCloseGuard,
      }),
    ).rejects.toBeInstanceOf(LoopCloseGuardError);

    expect(readTaskFileBytes(root, 'TASK-210')).toBe(before);
  });

  it('allows close-to-done in loop mode once auto_close_on_green_review is true', async () => {
    const { transitionStatus } = await import(TASK_STORE_URL);
    const { loopModeCloseGuard } = await import(CLOSE_GUARD_URL);

    const { root } = makeRepoWithMode({
      mode: 'loop',
      loopAuth: { auto_close_on_green_review: true },
    });
    makeRepoSkeleton(root, { tasks: { 'TASK-211': makeTask('TASK-211') } });

    await transitionStatus({
      repoRoot: root,
      key: 'TASK-211',
      status: 'done',
      closeGuard: loopModeCloseGuard,
    });

    const after = JSON.parse(readTaskFileBytes(root, 'TASK-211'));
    expect(after.status).toBe('done');
  });

  it('is a no-op seam: omitting closeGuard entirely leaves loop mode unenforced (task-store stays inert without composition)', async () => {
    const { transitionStatus } = await import(TASK_STORE_URL);

    const { root } = makeRepoWithMode({ mode: 'loop', loopAuth: {} });
    makeRepoSkeleton(root, { tasks: { 'TASK-212': makeTask('TASK-212') } });

    // No closeGuard passed -> task-store itself does not know about loop mode.
    await transitionStatus({ repoRoot: root, key: 'TASK-212', status: 'done' });

    const after = JSON.parse(readTaskFileBytes(root, 'TASK-212'));
    expect(after.status).toBe('done');
  });
});
