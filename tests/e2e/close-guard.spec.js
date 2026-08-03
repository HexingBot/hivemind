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

// ===========================================================================
// AC4 (TASK-099) — Gate 2: uat-only closes in loop mode additionally require
// loop_auth.uat_delegated_to_orchestrator OR an explicit human verdict marker
// on the ticket's uat comment. Gate 1 (auto_close_on_green_review) is held
// TRUE throughout this section so every case below isolates Gate 2 alone.
// ===========================================================================
function makeUatTask(key, comments = []) {
  return { ...makeTask(key), verification_tier: 'uat-only', comments };
}

const DELEGATED_UAT_COMMENT = {
  author: 'uat',
  at: '2026-07-06T00:00:00Z',
  body: 'Step 1: expected X, observed X, verdict PASS — verified by Orchestrator at the human\'s request.\nOverall result: PASS.',
};

// TASK-186 fix round — the structured "Verdict:" label is now MANDATORY (the
// label-free legacy path is removed from loop mode's Gate 2 marker; see the
// P0 regression lock below), so this fixture uses the literal "Verdict:"
// convention rather than the pre-fix-round "verdict PASS" (no colon) prose.
const BARE_HUMAN_UAT_COMMENT = {
  author: 'uat',
  at: '2026-07-06T00:00:00Z',
  body: 'Step 1: expected X, observed X. Verdict: PASS.\nOverall result: PASS.',
};

describe('AC4 (TASK-099) — loopModeCloseGuard Gate 2: uat-only delegation', () => {
  it('throws UatDelegationGuardError when uat_delegated_to_orchestrator is not granted and the uat comment shows only delegated-verification phrasing', async () => {
    const { loopModeCloseGuard, UatDelegationGuardError } = await import(CLOSE_GUARD_URL);
    const { root } = makeRepoWithMode({
      mode: 'loop',
      loopAuth: { auto_close_on_green_review: true },
    });
    const task = makeUatTask('TASK-220', [DELEGATED_UAT_COMMENT]);

    let caught;
    try {
      await loopModeCloseGuard({ repoRoot: root, task });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UatDelegationGuardError);
    expect(caught.code).toBe('LOOP_UAT_DELEGATION_REQUIRED');
  });

  it('resolves when uat_delegated_to_orchestrator is granted, even though the uat comment shows only delegated-verification phrasing', async () => {
    const { loopModeCloseGuard } = await import(CLOSE_GUARD_URL);
    const { root } = makeRepoWithMode({
      mode: 'loop',
      loopAuth: { auto_close_on_green_review: true, uat_delegated_to_orchestrator: true },
    });
    const task = makeUatTask('TASK-221', [DELEGATED_UAT_COMMENT]);

    await expect(loopModeCloseGuard({ repoRoot: root, task })).resolves.not.toThrow();
  });

  it('resolves when uat_delegated_to_orchestrator is not granted but the uat comment carries an explicit human verdict marker (bare PASS, no delegation phrasing)', async () => {
    const { loopModeCloseGuard } = await import(CLOSE_GUARD_URL);
    const { root } = makeRepoWithMode({
      mode: 'loop',
      loopAuth: { auto_close_on_green_review: true },
    });
    const task = makeUatTask('TASK-222', [BARE_HUMAN_UAT_COMMENT]);

    await expect(loopModeCloseGuard({ repoRoot: root, task })).resolves.not.toThrow();
  });

  it('does not apply Gate 2 to non-uat-only tickets (tdd-tier ticket with no uat comment closes normally once Gate 1 is satisfied)', async () => {
    const { loopModeCloseGuard } = await import(CLOSE_GUARD_URL);
    const { root } = makeRepoWithMode({
      mode: 'loop',
      loopAuth: { auto_close_on_green_review: true },
    });
    const task = makeTask('TASK-223'); // verification_tier: 'tdd', no comments

    await expect(loopModeCloseGuard({ repoRoot: root, task })).resolves.not.toThrow();
  });
});

// ===========================================================================
// TASK-099 review M1 [src/close-guard.js:69] — the marker must anchor on the
// SKILL.md "Overall result: PASS|FAIL" recording convention and must reject
// outright whenever a FAIL verdict appears anywhere in the comment. The
// pre-fix implementation was a bare /\bPASS\b/i anywhere in the body, which
// FAILS OPEN: a recorded overall FAIL (or a "FAIL — but PASS on retry" aside)
// still contained the substring "PASS" and so wrongly satisfied the marker.
// ===========================================================================
const OVERALL_FAIL_UAT_COMMENT = {
  author: 'uat',
  at: '2026-07-06T00:00:00Z',
  body: 'Step 1: expected X, observed X, verdict PASS.\nStep 2: expected Y, observed Z, verdict FAIL.\nOverall result: FAIL.',
};

const FAIL_BUT_PASS_ON_RETRY_UAT_COMMENT = {
  author: 'uat',
  at: '2026-07-06T00:00:00Z',
  body: 'Step 1: expected X, observed X — FAIL, but PASS on retry.\nOverall result: PASS.',
};

const EMPTY_BODY_UAT_COMMENT = {
  author: 'uat',
  at: '2026-07-06T00:00:00Z',
  body: '',
};

describe('TASK-099 review M1 — Gate 2 marker anchors on the overall-result line and rejects any FAIL verdict', () => {
  it('an "Overall result: FAIL" comment does NOT satisfy the marker (blocks, even though a per-step PASS is present)', async () => {
    const { loopModeCloseGuard, UatDelegationGuardError } = await import(CLOSE_GUARD_URL);
    const { root } = makeRepoWithMode({
      mode: 'loop',
      loopAuth: { auto_close_on_green_review: true },
    });
    const task = makeUatTask('TASK-226', [OVERALL_FAIL_UAT_COMMENT]);

    await expect(loopModeCloseGuard({ repoRoot: root, task })).rejects.toBeInstanceOf(UatDelegationGuardError);
  });

  it('a "FAIL — but PASS on retry" aside does NOT satisfy the marker (blocks — any FAIL token anywhere voids it)', async () => {
    const { loopModeCloseGuard, UatDelegationGuardError } = await import(CLOSE_GUARD_URL);
    const { root } = makeRepoWithMode({
      mode: 'loop',
      loopAuth: { auto_close_on_green_review: true },
    });
    const task = makeUatTask('TASK-227', [FAIL_BUT_PASS_ON_RETRY_UAT_COMMENT]);

    await expect(loopModeCloseGuard({ repoRoot: root, task })).rejects.toBeInstanceOf(UatDelegationGuardError);
  });

  it('a convention-format comment (per-step verdicts + "Overall result: PASS", no FAIL anywhere) still satisfies the marker', async () => {
    // Same fixture as the BARE_HUMAN_UAT_COMMENT case above — restated here as
    // the M1 positive control so the fix's red-first run is not solely
    // negative assertions. Not counted as a separate regression: it exercises
    // the same allow-path already asserted by
    // "resolves when uat_delegated_to_orchestrator is not granted but the uat
    // comment carries an explicit human verdict marker" above.
    const { loopModeCloseGuard } = await import(CLOSE_GUARD_URL);
    const { root } = makeRepoWithMode({
      mode: 'loop',
      loopAuth: { auto_close_on_green_review: true },
    });
    const task = makeUatTask('TASK-228', [BARE_HUMAN_UAT_COMMENT]);

    await expect(loopModeCloseGuard({ repoRoot: root, task })).resolves.not.toThrow();
  });
});

// ===========================================================================
// TASK-099 review L2 [tests/e2e/close-guard.spec.js] — two missing matrix
// cells.
// ===========================================================================
describe('TASK-099 review L2 — Gate 2 matrix: ordering and empty-body cells', () => {
  it('Gate 1 fires before Gate 2: uat_delegated_to_orchestrator alone (auto_close_on_green_review false) still blocks with LoopCloseGuardError', async () => {
    const { loopModeCloseGuard, LoopCloseGuardError } = await import(CLOSE_GUARD_URL);
    const { root } = makeRepoWithMode({
      mode: 'loop',
      loopAuth: { uat_delegated_to_orchestrator: true }, // auto_close_on_green_review absent (falsy)
    });
    const task = makeUatTask('TASK-229', [BARE_HUMAN_UAT_COMMENT]);

    await expect(loopModeCloseGuard({ repoRoot: root, task })).rejects.toBeInstanceOf(LoopCloseGuardError);
  });

  it('an empty-body uat comment does not satisfy the marker (blocks)', async () => {
    const { loopModeCloseGuard, UatDelegationGuardError } = await import(CLOSE_GUARD_URL);
    const { root } = makeRepoWithMode({
      mode: 'loop',
      loopAuth: { auto_close_on_green_review: true },
    });
    const task = makeUatTask('TASK-230', [EMPTY_BODY_UAT_COMMENT]);

    await expect(loopModeCloseGuard({ repoRoot: root, task })).rejects.toBeInstanceOf(UatDelegationGuardError);
  });
});

// ===========================================================================
// AC4 (TASK-099) — composition: transitionStatus({..., closeGuard:
// loopModeCloseGuard}) enforces Gate 2 end-to-end for uat-only tickets.
// ===========================================================================
describe('AC4 (TASK-099) — transitionStatus composed with loopModeCloseGuard enforces Gate 2', () => {
  it('blocks a uat-only close-to-done in loop mode when only delegated-verification phrasing is on the uat comment, and leaves the task file untouched', async () => {
    const { transitionStatus } = await import(TASK_STORE_URL);
    const { loopModeCloseGuard, UatDelegationGuardError } = await import(CLOSE_GUARD_URL);

    const { root } = makeRepoWithMode({
      mode: 'loop',
      loopAuth: { auto_close_on_green_review: true },
    });
    makeRepoSkeleton(root, { tasks: { 'TASK-224': makeUatTask('TASK-224', [DELEGATED_UAT_COMMENT]) } });
    const before = readTaskFileBytes(root, 'TASK-224');

    await expect(
      transitionStatus({
        repoRoot: root,
        key: 'TASK-224',
        status: 'done',
        closeGuard: loopModeCloseGuard,
      }),
    ).rejects.toBeInstanceOf(UatDelegationGuardError);

    expect(readTaskFileBytes(root, 'TASK-224')).toBe(before);
  });

  it('allows a uat-only close-to-done in loop mode once the uat comment carries an explicit human verdict marker', async () => {
    const { transitionStatus } = await import(TASK_STORE_URL);
    const { loopModeCloseGuard } = await import(CLOSE_GUARD_URL);

    const { root } = makeRepoWithMode({
      mode: 'loop',
      loopAuth: { auto_close_on_green_review: true },
    });
    makeRepoSkeleton(root, { tasks: { 'TASK-225': makeUatTask('TASK-225', [BARE_HUMAN_UAT_COMMENT]) } });

    await transitionStatus({
      repoRoot: root,
      key: 'TASK-225',
      status: 'done',
      closeGuard: loopModeCloseGuard,
    });

    const after = JSON.parse(readTaskFileBytes(root, 'TASK-225'));
    expect(after.status).toBe('done');
  });
});

// ===========================================================================
// TASK-108 — loopModeUatCommentGuard: narrow the write-side uat-comment
// fabrication channel (Gate 2 residual). append_comment must REFUSE
// author:'uat' while mode === 'loop' UNLESS
// loop_auth.uat_delegated_to_orchestrator === true. Harness mode (mode !==
// 'loop') is UNAFFECTED — author:'uat' stays freely writable there. Only
// author === 'uat' is gated; any other author is unaffected in loop mode.
//
// TEST MODE — src/close-guard.js does NOT yet export
// `loopModeUatCommentGuard`/`UatCommentGuardError`. These imports fail
// (undefined destructure -> "is not a function" on call) until IMPL adds
// them — the expected tests-first failure for a new export on an
// already-existing module.
// ===========================================================================
describe('TASK-108 — loopModeUatCommentGuard', () => {
  it('throws UatCommentGuardError when mode is loop, author is "uat", and delegation is not granted', async () => {
    const { loopModeUatCommentGuard, UatCommentGuardError } = await import(CLOSE_GUARD_URL);
    const { root } = makeRepoWithMode({ mode: 'loop', loopAuth: {} });

    let caught;
    try {
      await loopModeUatCommentGuard({ repoRoot: root, author: 'uat' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UatCommentGuardError);
    expect(caught.code).toBe('LOOP_UAT_COMMENT_DENIED');
  });

  it('throws UatCommentGuardError when mode is loop, author is "uat", and uat_delegated_to_orchestrator is explicitly false', async () => {
    const { loopModeUatCommentGuard, UatCommentGuardError } = await import(CLOSE_GUARD_URL);
    const { root } = makeRepoWithMode({
      mode: 'loop',
      loopAuth: { uat_delegated_to_orchestrator: false },
    });

    await expect(
      loopModeUatCommentGuard({ repoRoot: root, author: 'uat' }),
    ).rejects.toBeInstanceOf(UatCommentGuardError);
  });

  it('resolves when mode is loop, author is "uat", and uat_delegated_to_orchestrator is granted (the delegated-recording path)', async () => {
    const { loopModeUatCommentGuard } = await import(CLOSE_GUARD_URL);
    const { root } = makeRepoWithMode({
      mode: 'loop',
      loopAuth: { uat_delegated_to_orchestrator: true },
    });

    await expect(
      loopModeUatCommentGuard({ repoRoot: root, author: 'uat' }),
    ).resolves.not.toThrow();
  });

  it('resolves when mode is harness, author "uat", no delegation granted (harness mode is unaffected)', async () => {
    const { loopModeUatCommentGuard } = await import(CLOSE_GUARD_URL);
    const { root } = makeRepoWithMode({ mode: 'harness' });

    await expect(
      loopModeUatCommentGuard({ repoRoot: root, author: 'uat' }),
    ).resolves.not.toThrow();
  });

  it('is a no-op when there is no active session at all (fresh repo, no pointer), even with author "uat"', async () => {
    const { loopModeUatCommentGuard } = await import(CLOSE_GUARD_URL);
    const root = makeTmpDir('af-uatcommentguard-nosession');
    mkdirSync(join(root, 'state'), { recursive: true });

    await expect(
      loopModeUatCommentGuard({ repoRoot: root, author: 'uat' }),
    ).resolves.not.toThrow();
  });

  it('resolves when mode is loop but author is NOT "uat" (e.g. orchestrator), even without delegation granted', async () => {
    const { loopModeUatCommentGuard } = await import(CLOSE_GUARD_URL);
    const { root } = makeRepoWithMode({ mode: 'loop', loopAuth: {} });

    await expect(
      loopModeUatCommentGuard({ repoRoot: root, author: 'orchestrator' }),
    ).resolves.not.toThrow();
  });

  it('resolves when mode is loop but author is NOT "uat" (e.g. developer/reviewer), even without delegation granted', async () => {
    const { loopModeUatCommentGuard } = await import(CLOSE_GUARD_URL);
    const { root } = makeRepoWithMode({ mode: 'loop', loopAuth: {} });

    await expect(
      loopModeUatCommentGuard({ repoRoot: root, author: 'developer' }),
    ).resolves.not.toThrow();
    await expect(
      loopModeUatCommentGuard({ repoRoot: root, author: 'reviewer' }),
    ).resolves.not.toThrow();
  });
});

// ===========================================================================
// TASK-186 — Gate 2's human-verdict marker was a pure TOKEN SCAN: a per-step
// failure phrased "Verdict: PASS (deferred)" contains no FAIL-family token
// and satisfies "Overall result: PASS", so it closed a uat-only ticket to
// done autonomously, in loop mode with uat_delegated_to_orchestrator FALSE,
// while the ticket's own record said an AC crashed. These specs replay the
// round-3b probe fixtures verbatim
// (state/sessions/20260708T154259Z-29a27eda/artifacts/ac-fidelity-round3b.mjs),
// composed EXACTLY as src/mcp-server.js composes the guards
// (loopModeUatCommentGuard on the write path, loopModeCloseGuard as
// closeTask's closeGuard) — calling closeTask() directly without a
// closeGuard bypasses the loop-mode guards entirely and proves nothing (an
// earlier probe run made exactly that mistake and produced three false
// positives — see the artifacts' round-3 vs round-3b note).
//
// AC3 design decision: the marker becomes ARITHMETIC over a per-step list
// rather than pattern-matching prose. A uat comment's body must carry at
// least one literal "Verdict:" label (already the real convention in use —
// see e.g. TASK-109/112/155/170's actual bodies) — this is now MANDATORY,
// not opt-in: a body with no "Verdict:" label anywhere is REJECTED outright,
// there is no more legacy token-scan fallback in loop mode (see the P0
// describe block below, and src/close-guard.js's doc comments, for why that
// fallback was removed). Each recognized step block must end, once
// whitespace-normalized, with EXACTLY "Verdict: PASS" or "Verdict: PASS." —
// nothing else. A qualified, missing, or FAIL verdict on any one step fails
// the whole comment closed. TASK-186 fix round (HIGH, second round) further
// requires (a) the recognized step-block count to be >=
// task.acceptance_criteria.length, and (b) no non-whitespace text outside
// the recognized step blocks and the overall-result line — see the R1/R2/R3
// describe block below for why both are necessary.
// ===========================================================================
const R3B_DENY = {
  auto_close_on_green_review: false,
  uat_delegated_to_orchestrator: false,
  auto_consolidate: false,
  auto_push_after_close: false,
  auto_version_bump_on_milestone: false,
};
const R3B_GRANT_CLOSE = { ...R3B_DENY, auto_close_on_green_review: true };

async function mcpCloseTask({ repoRoot, key, comment, linked_commits = [] }) {
  const { loopModeUatCommentGuard, loopModeCloseGuard } = await import(CLOSE_GUARD_URL);
  const { closeTask } = await import(TASK_STORE_URL);
  await loopModeUatCommentGuard({ repoRoot, author: comment.author });
  return closeTask({
    repoRoot, key, comment, linked_commits, closeGuard: loopModeCloseGuard,
  });
}

async function mcpAppendComment({ repoRoot, key, author, body }) {
  const { loopModeUatCommentGuard } = await import(CLOSE_GUARD_URL);
  const { appendComment } = await import(TASK_STORE_URL);
  await loopModeUatCommentGuard({ repoRoot, author });
  return appendComment({ repoRoot, key, author, body });
}

function rewriteBundleMode(root, sessionId, mode, loopAuth) {
  writeFileSync(join(root, 'state', 'sessions', sessionId, 'session.json'), JSON.stringify({
    schema_version: 2,
    session_id: sessionId,
    lifecycle_state: 'active',
    updated_at: '2026-08-02T00:00:00Z',
    active_task: null,
    workflow_step: 'idle',
    next_action: 'p',
    handoff_summary: 'p',
    open_questions: [],
    blockers: [],
    decisions: [],
    subagent_results: [],
    pending_human_confirmation: null,
    mode,
    loop_auth: loopAuth,
  }, null, 2), 'utf8');
}

describe('TASK-186 — round-3b adversarial probes replayed as permanent regression locks (real mcp-server composition)', () => {
  it('V0 (control) — loop mode + auto_close_on_green_review:false still throws LOOP_CLOSE_GUARD_DENIED', async () => {
    const { createTask } = await import(TASK_STORE_URL);
    const { LoopCloseGuardError } = await import(CLOSE_GUARD_URL);
    const { root } = makeRepoWithMode({ mode: 'loop', loopAuth: R3B_DENY });
    const t = await createTask({
      repoRoot: root, title: 'V0', description: 'd', priority: 'medium',
      acceptance_criteria: ['ships'], verification_tier: 'tests-after',
    });

    let caught;
    try {
      await mcpCloseTask({
        repoRoot: root, key: t.key, comment: { author: 'orchestrator', body: 'Closing.' },
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(LoopCloseGuardError);
    expect(caught.code).toBe('LOOP_CLOSE_GUARD_DENIED');
  });

  it('V1 — Gate 2 vs a real failure phrased "Verdict: PASS (deferred)" (the ticket-title defect) — now CAUGHT', async () => {
    const { createTask } = await import(TASK_STORE_URL);
    const { UatDelegationGuardError } = await import(CLOSE_GUARD_URL);
    const { root, sessionId } = makeRepoWithMode({ mode: 'harness' });
    const t = await createTask({
      repoRoot: root, title: 'V1', description: 'd', priority: 'medium',
      acceptance_criteria: ['CSV export works.', 'XLSX export works.'],
      verification_tier: 'uat-only',
    });
    const body = [
      'UAT script:',
      '1. Run `npm run export -- --format=csv`, expect a CSV. Observed: file created. Verdict: PASS',
      '2. Open the CSV, expect correct headers. Observed: headers present. Verdict: PASS',
      '3. Run with --format=xlsx, expect an XLSX file. Observed: command exited with an unhandled',
      '   TypeError and no file was written; deferred to a follow-up ticket, not a blocker for this',
      '   scope. Verdict: PASS (deferred)',
      '', 'Overall result: PASS',
    ].join('\n');
    await mcpAppendComment({ repoRoot: root, key: t.key, author: 'uat', body });

    // Flip to loop mode WITHOUT the delegation grant — Gate 1 satisfied, Gate 2 not delegated.
    rewriteBundleMode(root, sessionId, 'loop', R3B_GRANT_CLOSE);

    let caught;
    try {
      await mcpCloseTask({
        repoRoot: root, key: t.key, comment: { author: 'orchestrator', body: 'UAT passed. Closing.' },
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UatDelegationGuardError);
    expect(caught.code).toBe('LOOP_UAT_DELEGATION_REQUIRED');
  });

  it('V2 (control) — the literal "Step 1 ... FAILED" + "Overall result: PASS" form still throws LOOP_UAT_DELEGATION_REQUIRED', async () => {
    const { createTask } = await import(TASK_STORE_URL);
    const { UatDelegationGuardError } = await import(CLOSE_GUARD_URL);
    const { root, sessionId } = makeRepoWithMode({ mode: 'harness' });
    const t = await createTask({
      repoRoot: root, title: 'V2', description: 'd', priority: 'medium',
      acceptance_criteria: ['Works.'], verification_tier: 'uat-only',
    });
    await mcpAppendComment({
      repoRoot: root,
      key: t.key,
      author: 'uat',
      body: '1. Step one. Observed: broken. FAILED\n\nOverall result: PASS',
    });
    rewriteBundleMode(root, sessionId, 'loop', R3B_GRANT_CLOSE);

    let caught;
    try {
      await mcpCloseTask({
        repoRoot: root, key: t.key, comment: { author: 'orchestrator', body: 'Closing.' },
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UatDelegationGuardError);
  });

  it('positive control — a cleanly structured multi-step "Verdict: PASS" comment (no delegation phrasing) still satisfies Gate 2', async () => {
    const { createTask } = await import(TASK_STORE_URL);
    const { root, sessionId } = makeRepoWithMode({ mode: 'harness' });
    const t = await createTask({
      repoRoot: root, title: 'V1-positive', description: 'd', priority: 'medium',
      acceptance_criteria: ['CSV export works.', 'XLSX export works.'],
      verification_tier: 'uat-only',
    });
    const body = [
      '1. Run the csv export, expect a CSV. Observed: file created. Verdict: PASS',
      '2. Run the xlsx export, expect an XLSX file. Observed: file created. Verdict: PASS',
      '', 'Overall result: PASS',
    ].join('\n');
    await mcpAppendComment({ repoRoot: root, key: t.key, author: 'uat', body });
    rewriteBundleMode(root, sessionId, 'loop', R3B_GRANT_CLOSE);

    await expect(
      mcpCloseTask({
        repoRoot: root, key: t.key, comment: { author: 'orchestrator', body: 'Closing.' },
      }),
    ).resolves.not.toThrow();
  });
});

// ===========================================================================
// TASK-186 fix round (HIGH, second round) — R1/R2/R3: splitIntoStepBlocks
// discarded everything BEFORE the first recognized step-start line and
// everything AFTER the "Overall result:" line outright. The only defense
// over that discarded text was the FAIL-token backstop — the exact losing
// arms race this ticket exists to end. R1 hides the real failure in a
// preamble; R2 hides it in a postscript; R3 proves the step-count-floor half
// of the fix (evaluateStructuredStepVerdicts now requires the recognized
// step-block count to be >= task.acceptance_criteria.length) is NOT
// sufficient on its own — it pads the step count to match the AC count with
// two individually clean "Verdict: PASS" steps while disclosing the real
// crash only in a preamble line, so only the companion fix (reject any
// non-whitespace text outside the recognized step blocks and the overall
// line) closes it. All three composed exactly as src/mcp-server.js composes
// the guards, same round-3b discipline as V0/V1/V2 above. Reproduced live
// against the pre-fix modules: hasExplicitHumanVerdictMarker === true for
// all three (see the fix-round hand-off for the captured red-run output).
//
// A cleanly structured multi-step comment with no preamble/postscript is
// already covered by the "positive control" test directly above this block
// (same 2-step/2-AC shape) — not repeated here to keep the new-test budget
// clean.
// ===========================================================================
describe('TASK-186 fix round (HIGH) — R1/R2/R3: preamble/postscript/padded-step-count evasion no longer bypasses Gate 2', () => {
  it('R1 (preamble) — a crash disclosed only in text BEFORE the first recognized step is REJECTED (not closed)', async () => {
    const { UatDelegationGuardError } = await import(CLOSE_GUARD_URL);
    const { createTask } = await import(TASK_STORE_URL);
    const { root, sessionId } = makeRepoWithMode({ mode: 'harness' });
    const t = await createTask({
      repoRoot: root, title: 'R1', description: 'd', priority: 'medium',
      acceptance_criteria: ['CSV export works.', 'XLSX export works.'],
      verification_tier: 'uat-only',
    });
    const body = [
      'UAT script (note: the xlsx export crashed with an unhandled TypeError, no file written — '
        + 'deferring to a follow-up ticket, not a blocker for this scope):',
      '1. Run `npm run export -- --format=csv`, expect a CSV. Observed: file created. Verdict: PASS',
      '',
      'Overall result: PASS',
    ].join('\n');
    await mcpAppendComment({ repoRoot: root, key: t.key, author: 'uat', body });

    // Flip to loop mode WITHOUT the delegation grant — Gate 1 satisfied, Gate 2 not delegated.
    rewriteBundleMode(root, sessionId, 'loop', R3B_GRANT_CLOSE);

    let caught;
    try {
      await mcpCloseTask({
        repoRoot: root, key: t.key, comment: { author: 'orchestrator', body: 'UAT passed. Closing.' },
      });
    } catch (err) {
      caught = err;
    }
    expect(caught, 'a crash disclosed only in preamble text before the first recognized step must not '
      + 'close the ticket').toBeInstanceOf(UatDelegationGuardError);
    expect(caught && caught.code).toBe('LOOP_UAT_DELEGATION_REQUIRED');
  });

  it('R2 (postscript) — the same crash disclosure placed AFTER "Overall result: PASS" is REJECTED (not closed)', async () => {
    const { UatDelegationGuardError } = await import(CLOSE_GUARD_URL);
    const { createTask } = await import(TASK_STORE_URL);
    const { root, sessionId } = makeRepoWithMode({ mode: 'harness' });
    const t = await createTask({
      repoRoot: root, title: 'R2', description: 'd', priority: 'medium',
      acceptance_criteria: ['CSV export works.', 'XLSX export works.'],
      verification_tier: 'uat-only',
    });
    const body = [
      '1. Run `npm run export -- --format=csv`, expect a CSV. Observed: file created. Verdict: PASS',
      '',
      'Overall result: PASS',
      '',
      '(note: the xlsx export crashed with an unhandled TypeError, no file written — deferring to a '
        + 'follow-up ticket, not a blocker for this scope.)',
    ].join('\n');
    await mcpAppendComment({ repoRoot: root, key: t.key, author: 'uat', body });

    rewriteBundleMode(root, sessionId, 'loop', R3B_GRANT_CLOSE);

    let caught;
    try {
      await mcpCloseTask({
        repoRoot: root, key: t.key, comment: { author: 'orchestrator', body: 'UAT passed. Closing.' },
      });
    } catch (err) {
      caught = err;
    }
    expect(caught, 'a crash disclosed only in postscript text after the overall-result line must not '
      + 'close the ticket').toBeInstanceOf(UatDelegationGuardError);
    expect(caught && caught.code).toBe('LOOP_UAT_DELEGATION_REQUIRED');
  });

  it('R3 (padded step count) — matching the AC count with clean per-step verdicts does not launder a crash disclosed only in the preamble', async () => {
    const { UatDelegationGuardError } = await import(CLOSE_GUARD_URL);
    const { createTask } = await import(TASK_STORE_URL);
    const { root, sessionId } = makeRepoWithMode({ mode: 'harness' });
    const t = await createTask({
      repoRoot: root, title: 'R3', description: 'd', priority: 'medium',
      acceptance_criteria: ['CSV export works.', 'XLSX export works.'],
      verification_tier: 'uat-only',
    });
    const body = [
      'NOTE: xlsx export actually crashed with a TypeError and produced no file; recording below '
        + 'anyway per template.',
      '1. Run `npm run export -- --format=csv`, expect a CSV. Observed: file created. Verdict: PASS',
      '2. Run with --format=xlsx, expect an XLSX file. Observed: file created. Verdict: PASS',
      '',
      'Overall result: PASS',
    ].join('\n');
    await mcpAppendComment({ repoRoot: root, key: t.key, author: 'uat', body });

    rewriteBundleMode(root, sessionId, 'loop', R3B_GRANT_CLOSE);

    let caught;
    try {
      await mcpCloseTask({
        repoRoot: root, key: t.key, comment: { author: 'orchestrator', body: 'UAT passed. Closing.' },
      });
    } catch (err) {
      caught = err;
    }
    expect(caught, 'a step count matching the AC count must not exempt a preamble that discloses a '
      + 'real failure — the step-count floor alone is not sufficient, the extraneous-text rejection is '
      + 'what closes this one').toBeInstanceOf(UatDelegationGuardError);
    expect(caught && caught.code).toBe('LOOP_UAT_DELEGATION_REQUIRED');
  });
});

// ===========================================================================
// TASK-108 (scope addition, fix-round fold-in) — FAIL_VERDICT_RE widened from
// /\bfail\b/i to also match FAILED/failing/fails, so a self-contradictory
// "Step 2 FAILED ... Overall result: PASS" body no longer satisfies
// hasExplicitHumanVerdictMarker (and thus no longer bypasses Gate 2's
// loopModeCloseGuard).
// ===========================================================================
describe('TASK-108 — FAIL_VERDICT_RE widened to FAILED/failing/fails', () => {
  it('a body with "Step 2 FAILED" (past tense) does NOT satisfy the marker, even though the overall line says PASS', async () => {
    const { loopModeCloseGuard, UatDelegationGuardError } = await import(CLOSE_GUARD_URL);
    const { root } = makeRepoWithMode({
      mode: 'loop',
      loopAuth: { auto_close_on_green_review: true },
    });
    const task = makeUatTask('TASK-231', [{
      author: 'uat',
      at: '2026-07-14T00:00:00Z',
      body: 'Step 1: expected X, observed X, verdict PASS.\nStep 2: expected Y, observed Z, verdict FAILED.\nOverall result: PASS.',
    }]);

    await expect(loopModeCloseGuard({ repoRoot: root, task })).rejects.toBeInstanceOf(UatDelegationGuardError);
  });

  it('a body with "failing" (present participle) does NOT satisfy the marker', async () => {
    const { loopModeCloseGuard, UatDelegationGuardError } = await import(CLOSE_GUARD_URL);
    const { root } = makeRepoWithMode({
      mode: 'loop',
      loopAuth: { auto_close_on_green_review: true },
    });
    const task = makeUatTask('TASK-232', [{
      author: 'uat',
      at: '2026-07-14T00:01:00Z',
      body: 'Step 1: expected X, observed a failing endpoint.\nOverall result: PASS.',
    }]);

    await expect(loopModeCloseGuard({ repoRoot: root, task })).rejects.toBeInstanceOf(UatDelegationGuardError);
  });

  it('a body with "fails" (present tense, third person) does NOT satisfy the marker', async () => {
    const { loopModeCloseGuard, UatDelegationGuardError } = await import(CLOSE_GUARD_URL);
    const { root } = makeRepoWithMode({
      mode: 'loop',
      loopAuth: { auto_close_on_green_review: true },
    });
    const task = makeUatTask('TASK-233', [{
      author: 'uat',
      at: '2026-07-14T00:02:00Z',
      body: 'Step 1: this fails intermittently but retry PASS.\nOverall result: PASS.',
    }]);

    await expect(loopModeCloseGuard({ repoRoot: root, task })).rejects.toBeInstanceOf(UatDelegationGuardError);
  });

  it('a clean all-PASS body with no FAIL/FAILED/failing/fails token anywhere still satisfies the marker (positive control, unaffected by the widening)', async () => {
    const { loopModeCloseGuard } = await import(CLOSE_GUARD_URL);
    const { root } = makeRepoWithMode({
      mode: 'loop',
      loopAuth: { auto_close_on_green_review: true },
    });
    const task = makeUatTask('TASK-234', [BARE_HUMAN_UAT_COMMENT]);

    await expect(loopModeCloseGuard({ repoRoot: root, task })).resolves.not.toThrow();
  });
});

// ===========================================================================
// TASK-186 fix round (HIGH) — P0: the structured convention was OPT-IN by
// whoever wrote the comment. VERDICT_LABEL_PRESENT_RE only activated the
// structured per-step check when the literal "Verdict:" label was present
// ANYWHERE in the body; a body that recorded a real failure using bare
// "PASS"/"PASS (deferred)" tokens with NO "Verdict:" label anywhere fell
// straight through to the legacy FAIL-token/OVERALL_PASS_RE scan, where
// "crashed", "TypeError", and "deferred" contain no FAIL-family token and
// "Overall result: PASS" satisfies OVERALL_PASS_RE — closing the ticket
// autonomously in loop mode with uat_delegated_to_orchestrator FALSE. This is
// the reviewer's exact reproduction (composed through the real guards exactly
// as src/mcp-server.js composes them — loopModeUatCommentGuard on the write
// path, loopModeCloseGuard as closeTask's closeGuard — the same round-3b
// discipline as the block above; calling closeTask() directly without a
// closeGuard proves nothing).
//
// FIX: the structured convention is now MANDATORY for Gate 2's marker — there
// is no more label-free legacy path in loop mode (see hasExplicitHumanVerdict
// Marker's doc comment in src/close-guard.js for the corpus-safety reasoning:
// exactly one real ticket, TASK-133, used the label-free legacy path, it is
// already `done`, and closeGuard never re-runs on an already-closed ticket).
// ===========================================================================
describe('TASK-186 fix round (HIGH) — P0: label-free failure phrased without FAIL-words no longer bypasses Gate 2', () => {
  it('a real crash recorded as bare "PASS"/"PASS (deferred)" with NO "Verdict:" label anywhere is REJECTED (not closed)', async () => {
    const { UatDelegationGuardError } = await import(CLOSE_GUARD_URL);
    const { createTask } = await import(TASK_STORE_URL);
    const { root, sessionId } = makeRepoWithMode({ mode: 'harness' });
    const t = await createTask({
      repoRoot: root, title: 'P0', description: 'd', priority: 'medium',
      acceptance_criteria: ['CSV export works.', 'XLSX export works.'],
      verification_tier: 'uat-only',
    });
    // Verbatim reproduction from the review: no "Verdict:" label anywhere,
    // a real crash recorded, and no FAIL-family token in the body.
    const body = [
      '1. Run the export, expect a CSV. Observed: file created. PASS',
      '2. Open it, expect headers. Observed: headers present. PASS',
      '3. Run with --format=xlsx, expect an XLSX. Observed: crashed with an unhandled',
      '   TypeError, no file written; deferred to a follow-up, not a blocker here. PASS (deferred)',
      '',
      'Overall result: PASS',
    ].join('\n');
    await mcpAppendComment({ repoRoot: root, key: t.key, author: 'uat', body });

    // Flip to loop mode WITHOUT the delegation grant — Gate 1 satisfied, Gate 2 not delegated.
    rewriteBundleMode(root, sessionId, 'loop', R3B_GRANT_CLOSE);

    let caught;
    try {
      await mcpCloseTask({
        repoRoot: root, key: t.key, comment: { author: 'orchestrator', body: 'UAT passed. Closing.' },
      });
    } catch (err) {
      caught = err;
    }
    expect(caught, 'expected close_task to be blocked by Gate 2 — a crash recorded without the '
      + 'literal "Verdict:" label must not close the ticket just because it also lacks a FAIL-family '
      + 'token').toBeInstanceOf(UatDelegationGuardError);
    expect(caught && caught.code).toBe('LOOP_UAT_DELEGATION_REQUIRED');
  });
});

// ===========================================================================
// TASK-186 fix round (LOW) — STEP_START_RE's "Step N:"/"N)" forms and the
// no-step-line single-block fallback previously had no committed spec
// inputs; every structured-path spec used "N." numbering. These exercise
// each form so the branches cannot be silently deleted.
// ===========================================================================
describe('TASK-186 fix round (LOW) — STEP_START_RE numbering-form and fallback coverage', () => {
  it('the "Step N)" numbering form is recognized by the structured per-step check', async () => {
    const { loopModeCloseGuard } = await import(CLOSE_GUARD_URL);
    const { root } = makeRepoWithMode({
      mode: 'loop',
      loopAuth: { auto_close_on_green_review: true },
    });
    const task = makeUatTask('TASK-240', [{
      author: 'uat',
      at: '2026-08-02T00:00:00Z',
      body: 'Step 1) expected X, observed X. Verdict: PASS\nStep 2) expected Y, observed Y. Verdict: PASS\nOverall result: PASS',
    }]);

    await expect(loopModeCloseGuard({ repoRoot: root, task })).resolves.not.toThrow();
  });

  it('the bare "N)" numbering form is recognized by the structured per-step check', async () => {
    const { loopModeCloseGuard } = await import(CLOSE_GUARD_URL);
    const { root } = makeRepoWithMode({
      mode: 'loop',
      loopAuth: { auto_close_on_green_review: true },
    });
    const task = makeUatTask('TASK-241', [{
      author: 'uat',
      at: '2026-08-02T00:00:00Z',
      body: '1) expected X, observed X. Verdict: PASS\n2) expected Y, observed Y. Verdict: PASS\nOverall result: PASS',
    }]);

    await expect(loopModeCloseGuard({ repoRoot: root, task })).resolves.not.toThrow();
  });

  it('a body with no numbered step lines at all falls back to a single whole-body block (positive: ends cleanly with Verdict: PASS)', async () => {
    const { loopModeCloseGuard } = await import(CLOSE_GUARD_URL);
    const { root } = makeRepoWithMode({
      mode: 'loop',
      loopAuth: { auto_close_on_green_review: true },
    });
    const task = makeUatTask('TASK-242', [{
      author: 'uat',
      at: '2026-08-02T00:00:00Z',
      body: 'Ran the whole checklist by hand, everything matched. Verdict: PASS\nOverall result: PASS',
    }]);

    await expect(loopModeCloseGuard({ repoRoot: root, task })).resolves.not.toThrow();
  });

  it('a body with no numbered step lines at all falls back to a single whole-body block (negative: ends with Verdict: FAIL)', async () => {
    const { loopModeCloseGuard, UatDelegationGuardError } = await import(CLOSE_GUARD_URL);
    const { root } = makeRepoWithMode({
      mode: 'loop',
      loopAuth: { auto_close_on_green_review: true },
    });
    const task = makeUatTask('TASK-243', [{
      author: 'uat',
      at: '2026-08-02T00:00:00Z',
      body: 'Ran the whole checklist by hand, something broke. Verdict: FAIL\nOverall result: FAIL',
    }]);

    await expect(loopModeCloseGuard({ repoRoot: root, task })).rejects.toBeInstanceOf(UatDelegationGuardError);
  });
});
