// tests/task-store-close-guards.spec.js
// TASK-082 — deep-review S1: deterministic gate enforcement at mutation seams.
//
// TEST MODE — these specs encode acceptance criteria 1 and 3 (the store-level
// halves) BEFORE any implementation lands. They MUST FAIL against the current
// src/task-store.js:
//   - AC1 (uat-only done-guard): transitionStatus does not yet check
//     verification_tier/comments before writing 'done' -> the "throws"
//     assertions fail because no error is thrown (wrong-reason-safe: these are
//     assertion failures on missing behavior, not import errors).
//   - AC3 (close_task atomicity, store half): task-store.js does not yet
//     export `closeTask` -> calling it throws "closeTask is not a function"
//     (TypeError), which is the expected tests-first failure for a
//     not-yet-added export on an already-existing module.
//
// SEAM CONTRACT encoded here (see handoff notes for the full writeup):
//   - task-store.js exports a new `UatGuardError` class: `.name ===
//     'UatGuardError'`, `.code === 'UAT_GUARD_REQUIRED'`, message matches /uat/i.
//   - transitionStatus({ repoRoot, key, status, now, closeGuard }) — NEW
//     optional `closeGuard` param. When status === 'done':
//       1. the uat-only guard runs unconditionally (self-contained, no bundle
//          access — task.verification_tier + task.comments only);
//       2. if `closeGuard` is a function, `await closeGuard({ repoRoot, task,
//          key })` runs next and may throw to block the write.
//     Both checks run BEFORE any disk I/O, so a thrown guard leaves the task
//     file untouched. Transitions to any status OTHER than 'done' never run
//     either guard.
//   - task-store.js exports `closeTask({ repoRoot, key, comment,
//     linked_commits, linked_prs, now, closeGuard })` — a NEW function that
//     performs status->done + comment append + linked_commits/linked_prs
//     append + index regen in ONE read-validate-write pass (a single
//     atomicWriteFiles call, mirroring transitionStatus/appendComment). Runs
//     the same uat-only guard and optional closeGuard as transitionStatus,
//     PLUS a commit-sha shape check (`/^[0-9a-f]{7,40}$/i`) against every
//     entry in `linked_commits`. All validation happens before any disk I/O,
//     so any failure (uat guard, closeGuard, bad sha) leaves both the task
//     file AND index.json byte-unchanged.

import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { makeRepoSkeleton } from './helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from './helpers/tmpRepo.js';

afterAll(cleanupAll);

function readTaskFile(repoDir, key) {
  return JSON.parse(readFileSync(join(repoDir, 'tasks', `${key}.json`), 'utf8'));
}

function readTaskFileBytes(repoDir, key) {
  return readFileSync(join(repoDir, 'tasks', `${key}.json`), 'utf8');
}

function readIndexBytes(repoDir) {
  return readFileSync(join(repoDir, 'tasks', 'index.json'), 'utf8');
}

/** Minimal schema-valid task builder. */
function makeTask({
  key,
  verification_tier,
  comments = [],
  status = 'todo',
  linked_commits = [],
  linked_prs = [],
}) {
  return {
    key,
    title: `Fixture ${key}`,
    description: 'Fixture task for TASK-082 close-guard specs.',
    acceptance_criteria: ['covered by TASK-082 specs'],
    status,
    priority: 'medium',
    labels: [],
    assignee: null,
    depends_on: [],
    linked_commits,
    linked_prs,
    comments,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    jira_key: null,
    ...(verification_tier !== undefined ? { verification_tier } : {}),
  };
}

// ===========================================================================
// AC1 — uat-only done-guard (store level)
// ===========================================================================
describe('AC1 — transitionStatus enforces the uat-only done-guard', () => {
  it('uat_only_task_without_uat_comment_transitioning_to_done_throws_typed_error', async () => {
    const { transitionStatus, UatGuardError } = await import('../src/task-store.js');

    const repoDir = makeTmpDir('af-uatguard-block');
    makeRepoSkeleton(repoDir, {
      tasks: {
        'TASK-201': makeTask({ key: 'TASK-201', verification_tier: 'uat-only', comments: [] }),
      },
    });
    const before = readTaskFileBytes(repoDir, 'TASK-201');

    await expect(
      transitionStatus({ repoRoot: repoDir, key: 'TASK-201', status: 'done' }),
    ).rejects.toThrow(/uat/i);

    // Assert it is the TYPED error, not an incidental message match.
    let caught;
    try {
      await transitionStatus({ repoRoot: repoDir, key: 'TASK-201', status: 'done' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UatGuardError);
    expect(caught.code).toBe('UAT_GUARD_REQUIRED');

    // No partial write — file byte-identical.
    expect(readTaskFileBytes(repoDir, 'TASK-201')).toBe(before);
  });

  it('uat_only_task_with_uat_comment_transitions_to_done_normally', async () => {
    const { transitionStatus } = await import('../src/task-store.js');

    const repoDir = makeTmpDir('af-uatguard-allow');
    makeRepoSkeleton(repoDir, {
      tasks: {
        'TASK-202': makeTask({
          key: 'TASK-202',
          verification_tier: 'uat-only',
          status: 'in_review', // TASK-187 AC2 — done requires this predecessor state
          comments: [{ author: 'uat', at: '2026-07-01T01:00:00Z', body: 'all steps PASS' }],
        }),
      },
    });

    await transitionStatus({ repoRoot: repoDir, key: 'TASK-202', status: 'done' });

    expect(readTaskFile(repoDir, 'TASK-202').status).toBe('done');
  });

  it('non_uat_only_tier_is_unaffected_by_the_uat_guard', async () => {
    const { transitionStatus } = await import('../src/task-store.js');

    const repoDir = makeTmpDir('af-uatguard-tdd-tier');
    makeRepoSkeleton(repoDir, {
      tasks: {
        'TASK-203': makeTask({
          key: 'TASK-203',
          verification_tier: 'tdd',
          status: 'in_review', // TASK-187 AC2
          comments: [{ author: 'reviewer', at: '2026-07-01T01:00:00Z', body: 'APPROVE.' }], // TASK-187 AC3
          linked_commits: ['abc1234'], // TASK-187 AC3
        }),
      },
    });

    await transitionStatus({ repoRoot: repoDir, key: 'TASK-203', status: 'done' });

    expect(readTaskFile(repoDir, 'TASK-203').status).toBe('done');
  });

  it('transitions_other_than_done_are_unaffected_by_the_uat_guard', async () => {
    const { transitionStatus } = await import('../src/task-store.js');

    const repoDir = makeTmpDir('af-uatguard-non-done');
    makeRepoSkeleton(repoDir, {
      tasks: {
        'TASK-204': makeTask({ key: 'TASK-204', verification_tier: 'uat-only', comments: [] }),
      },
    });

    await transitionStatus({ repoRoot: repoDir, key: 'TASK-204', status: 'in_progress' });

    expect(readTaskFile(repoDir, 'TASK-204').status).toBe('in_progress');
  });
});

// ===========================================================================
// AC3 — closeTask: single validate-then-atomic pass, all-or-nothing.
// ===========================================================================
describe('AC3 — closeTask applies transition + comment + commits + prs + index in one pass', () => {
  it('close_task_happy_path_applies_everything_in_one_call', async () => {
    const { closeTask } = await import('../src/task-store.js');

    const repoDir = makeTmpDir('af-closetask-happy');
    makeRepoSkeleton(repoDir, {
      tasks: {
        'TASK-205': makeTask({
          key: 'TASK-205',
          verification_tier: 'tdd',
          status: 'in_review', // TASK-187 AC2
          comments: [{ author: 'reviewer', at: '2026-07-01T02:00:00Z', body: 'LGTM' }],
        }),
      },
    });
    writeFileSync(
      join(repoDir, 'tasks', 'index.json'),
      JSON.stringify({ generated_at: '2000-01-01T00:00:00Z', tasks: [] }, null, 2),
      'utf8',
    );

    const fixedNow = '2026-07-02T12:00:00Z';
    await closeTask({
      repoRoot: repoDir,
      key: 'TASK-205',
      comment: { author: 'developer', body: 'Ship it.' },
      linked_commits: ['abc1234'],
      linked_prs: ['https://example.com/pr/1'],
      now: () => fixedNow,
    });

    const after = readTaskFile(repoDir, 'TASK-205');
    expect(after.status).toBe('done');
    expect(after.updated_at).toBe(fixedNow);
    expect(after.comments).toHaveLength(2);
    expect(after.comments[0].author).toBe('reviewer'); // preserved, in order
    expect(after.comments[1]).toMatchObject({ author: 'developer', body: 'Ship it.' });
    expect(after.linked_commits).toContain('abc1234');
    expect(after.linked_prs).toContain('https://example.com/pr/1');

    const idx = JSON.parse(readIndexBytes(repoDir));
    const entry = idx.tasks.find((t) => t.key === 'TASK-205');
    expect(entry).toBeDefined();
    expect(entry.status).toBe('done');
  });

  it('close_task_invalid_commit_sha_leaves_task_file_and_index_byte_unchanged', async () => {
    const { closeTask } = await import('../src/task-store.js');

    const repoDir = makeTmpDir('af-closetask-badsha');
    makeRepoSkeleton(repoDir, {
      tasks: {
        'TASK-206': makeTask({
          key: 'TASK-206',
          verification_tier: 'tdd',
          status: 'in_review', // TASK-187 AC2 — isolates this test to the sha-format check
          comments: [{ author: 'reviewer', at: '2026-07-01T02:00:00Z', body: 'LGTM' }], // TASK-187 AC3
        }),
      },
    });
    writeFileSync(
      join(repoDir, 'tasks', 'index.json'),
      JSON.stringify({ generated_at: '2000-01-01T00:00:00Z', tasks: [] }, null, 2),
      'utf8',
    );
    const beforeTask = readTaskFileBytes(repoDir, 'TASK-206');
    const beforeIndex = readIndexBytes(repoDir);

    await expect(
      closeTask({
        repoRoot: repoDir,
        key: 'TASK-206',
        comment: { author: 'developer', body: 'Ship it.' },
        linked_commits: ['not-a-real-sha!'],
        linked_prs: [],
      }),
    ).rejects.toThrow(/sha|commit/i);

    expect(readTaskFileBytes(repoDir, 'TASK-206')).toBe(beforeTask);
    expect(readIndexBytes(repoDir)).toBe(beforeIndex);
  });

  it('close_task_uat_guard_firing_leaves_task_file_and_index_byte_unchanged', async () => {
    const { closeTask, UatGuardError } = await import('../src/task-store.js');

    const repoDir = makeTmpDir('af-closetask-uatguard');
    makeRepoSkeleton(repoDir, {
      tasks: {
        'TASK-207': makeTask({ key: 'TASK-207', verification_tier: 'uat-only', comments: [] }),
      },
    });
    writeFileSync(
      join(repoDir, 'tasks', 'index.json'),
      JSON.stringify({ generated_at: '2000-01-01T00:00:00Z', tasks: [] }, null, 2),
      'utf8',
    );
    const beforeTask = readTaskFileBytes(repoDir, 'TASK-207');
    const beforeIndex = readIndexBytes(repoDir);

    let caught;
    try {
      await closeTask({
        repoRoot: repoDir,
        key: 'TASK-207',
        comment: { author: 'developer', body: 'Ship it.' },
        linked_commits: [],
        linked_prs: [],
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UatGuardError);

    expect(readTaskFileBytes(repoDir, 'TASK-207')).toBe(beforeTask);
    expect(readIndexBytes(repoDir)).toBe(beforeIndex);
  });

  // deep-review MEDIUM-1 — the uat-only guard must evaluate ON-DISK comments
  // only, never the incoming `comment` param. Without this lock, closeTask
  // could be made to self-satisfy its own uat-only requirement by simply
  // passing { author: 'uat', ... } as the closing comment — the exact bypass
  // this ticket's guard exists to prevent.
  it('close_task_cannot_self_satisfy_the_uat_guard_via_its_own_comment_param', async () => {
    const { closeTask, UatGuardError } = await import('../src/task-store.js');

    const repoDir = makeTmpDir('af-closetask-uatguard-selfsatisfy');
    makeRepoSkeleton(repoDir, {
      tasks: {
        'TASK-208': makeTask({ key: 'TASK-208', verification_tier: 'uat-only', comments: [] }),
      },
    });
    writeFileSync(
      join(repoDir, 'tasks', 'index.json'),
      JSON.stringify({ generated_at: '2000-01-01T00:00:00Z', tasks: [] }, null, 2),
      'utf8',
    );
    const beforeTask = readTaskFileBytes(repoDir, 'TASK-208');
    const beforeIndex = readIndexBytes(repoDir);

    let caught;
    try {
      await closeTask({
        repoRoot: repoDir,
        key: 'TASK-208',
        // The comment being APPENDED claims author 'uat', but no such comment
        // exists on disk yet — the guard must not treat the incoming comment
        // as satisfying its own precondition.
        comment: { author: 'uat', body: 'All steps PASS.' },
        linked_commits: [],
        linked_prs: [],
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UatGuardError);

    expect(readTaskFileBytes(repoDir, 'TASK-208')).toBe(beforeTask);
    expect(readIndexBytes(repoDir)).toBe(beforeIndex);
  });
});

// ===========================================================================
// TASK-186 AC2 + AC6 — harness-mode checkUatGuard (the ONLY defense in
// harness mode — there is no closeGuard composed there) previously asked
// only "does an author:'uat' comment exist", not "does it record a
// verdict". Replays adversarial probes A1/A2/A3 verbatim
// (state/sessions/20260708T154259Z-29a27eda/artifacts/ac-fidelity-round2.mjs)
// as permanent regression locks — before this fix all three MISSED (closed
// to done). Design decision (AC6): harness mode's assumption is that a human
// is genuinely present, so the fix stays a light content check — a non-empty
// body naming a recognizable verdict word (PASS) — rather than the full
// structured per-step machinery loop mode's Gate 2 enforces in
// src/close-guard.js. That asymmetry is deliberate and documented on
// hasRecordedUatVerdict's doc comment.
// ===========================================================================
describe('TASK-186 AC2/AC6 — harness-mode checkUatGuard requires a recognizable verdict, not mere presence', () => {
  it('A1 — a uat comment whose own recorded verdict is FAIL does not satisfy the gate', async () => {
    const { closeTask, UatGuardError } = await import('../src/task-store.js');

    const repoDir = makeTmpDir('af-a1-explicit-fail');
    makeRepoSkeleton(repoDir, {
      tasks: {
        'TASK-901': makeTask({
          key: 'TASK-901',
          verification_tier: 'uat-only',
          comments: [{
            author: 'uat',
            at: '2026-08-02T00:00:00Z',
            body: '1. Run it, expect the banner. Observed: crash. FAIL\n\nOverall result: FAIL',
          }],
        }),
      },
    });

    let caught;
    try {
      await closeTask({
        repoRoot: repoDir,
        key: 'TASK-901',
        comment: { author: 'orchestrator', body: 'Closing.' },
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UatGuardError);
  });

  it('A2 — an empty uat comment body does not satisfy the gate', async () => {
    const { closeTask, UatGuardError } = await import('../src/task-store.js');

    const repoDir = makeTmpDir('af-a2-empty-body');
    makeRepoSkeleton(repoDir, {
      tasks: {
        'TASK-902': makeTask({
          key: 'TASK-902',
          verification_tier: 'uat-only',
          comments: [{ author: 'uat', at: '2026-08-02T00:00:00Z', body: '' }],
        }),
      },
    });

    let caught;
    try {
      await closeTask({
        repoRoot: repoDir,
        key: 'TASK-902',
        comment: { author: 'orchestrator', body: 'Closing.' },
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UatGuardError);
  });

  it('A3 — a uat comment with unrelated content and no verdict word does not satisfy the gate', async () => {
    const { closeTask, UatGuardError } = await import('../src/task-store.js');

    const repoDir = makeTmpDir('af-a3-unrelated');
    makeRepoSkeleton(repoDir, {
      tasks: {
        'TASK-903': makeTask({
          key: 'TASK-903',
          verification_tier: 'uat-only',
          comments: [{
            author: 'uat',
            at: '2026-08-02T00:00:00Z',
            body: 'Reminder: order sandwiches for the Thursday planning session.',
          }],
        }),
      },
    });

    let caught;
    try {
      await closeTask({
        repoRoot: repoDir,
        key: 'TASK-903',
        comment: { author: 'orchestrator', body: 'Closing.' },
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UatGuardError);
  });

  // TASK-186 fix round (MEDIUM) — the committed A1 lock above only holds for
  // bodies with NO "pass" token anywhere. UAT_VERDICT_WORD_RE is a bare
  // /\bpass\b/i scan, so one word of realistic noise (a passing step sitting
  // next to a failing one, with an honest "Overall result: FAIL" line) flips
  // the harness-mode gate straight back to satisfied. Fix: also reject when
  // the body records an explicit overall FAIL.
  it('a mixed body (one step PASS, one step FAIL, "Overall result: FAIL") does NOT satisfy the harness-mode gate', async () => {
    const { closeTask, UatGuardError } = await import('../src/task-store.js');

    const repoDir = makeTmpDir('af-a1-mixed-overall-fail');
    makeRepoSkeleton(repoDir, {
      tasks: {
        'TASK-905': makeTask({
          key: 'TASK-905',
          verification_tier: 'uat-only',
          comments: [{
            author: 'uat',
            at: '2026-08-02T00:00:00Z',
            body: 'Step 1: expected X, observed X. Verdict: PASS.\nStep 2: expected Y, observed crash. Verdict: FAIL.\nOverall result: FAIL.',
          }],
        }),
      },
    });

    let caught;
    try {
      await closeTask({
        repoRoot: repoDir,
        key: 'TASK-905',
        comment: { author: 'orchestrator', body: 'Closing.' },
      });
    } catch (err) {
      caught = err;
    }
    expect(
      caught,
      'a body recording "Overall result: FAIL" must not satisfy the harness-mode gate merely because '
        + 'the word "pass" appears in one of its passing steps',
    ).toBeInstanceOf(UatGuardError);
  });

  // TASK-186 fix round (MEDIUM, second round) — the first fix round's
  // OVERALL_FAIL_RE only rejected the literal "Overall result: FAIL" line.
  // Two realistic shapes still fail open: a body that records a step-level
  // FAIL with no overall line at all, and a body that states the overall
  // result without the word "result" ("Overall: FAIL."). Verified live
  // against the real tasks/ corpus before tightening (see the fix-round
  // hand-off): none of the 45 real uat bodies carries either pattern, so
  // this tightening is corpus-safe.
  it('a body with a step-level "Verdict: FAIL" and no overall-result line at all does NOT satisfy the harness-mode gate', async () => {
    const { closeTask, UatGuardError } = await import('../src/task-store.js');

    const repoDir = makeTmpDir('af-a1-fail-no-overall-line');
    makeRepoSkeleton(repoDir, {
      tasks: {
        'TASK-906': makeTask({
          key: 'TASK-906',
          verification_tier: 'uat-only',
          comments: [{
            author: 'uat',
            at: '2026-08-02T00:00:00Z',
            body: 'Step 1: expected X, observed X. Verdict: PASS.\nStep 2: expected Y, observed crash. Verdict: FAIL.',
          }],
        }),
      },
    });

    let caught;
    try {
      await closeTask({
        repoRoot: repoDir,
        key: 'TASK-906',
        comment: { author: 'orchestrator', body: 'Closing.' },
      });
    } catch (err) {
      caught = err;
    }
    expect(
      caught,
      'a recorded per-step "Verdict: FAIL" must not satisfy the harness-mode gate just because the '
        + 'body has no separate "Overall result:" line for OVERALL_FAIL_RE to anchor on',
    ).toBeInstanceOf(UatGuardError);
  });

  it('a body stating "Overall: FAIL." (no "result") does NOT satisfy the harness-mode gate', async () => {
    const { closeTask, UatGuardError } = await import('../src/task-store.js');

    const repoDir = makeTmpDir('af-a1-overall-no-result-word');
    makeRepoSkeleton(repoDir, {
      tasks: {
        'TASK-907': makeTask({
          key: 'TASK-907',
          verification_tier: 'uat-only',
          comments: [{
            author: 'uat',
            at: '2026-08-02T00:00:00Z',
            body: 'Step 1: Verdict: PASS.\nOverall: FAIL.',
          }],
        }),
      },
    });

    let caught;
    try {
      await closeTask({
        repoRoot: repoDir,
        key: 'TASK-907',
        comment: { author: 'orchestrator', body: 'Closing.' },
      });
    } catch (err) {
      caught = err;
    }
    expect(
      caught,
      'a body stating "Overall: FAIL." must not satisfy the harness-mode gate just because it omits '
        + 'the word "result" from OVERALL_FAIL_RE\'s anchor',
    ).toBeInstanceOf(UatGuardError);
  });

  it('positive control — a bare "All steps PASS." body still satisfies the gate (unaffected legacy convention)', async () => {
    const { closeTask } = await import('../src/task-store.js');

    const repoDir = makeTmpDir('af-a-positive-pass');
    makeRepoSkeleton(repoDir, {
      tasks: {
        'TASK-904': makeTask({
          key: 'TASK-904',
          verification_tier: 'uat-only',
          status: 'in_review', // TASK-187 AC2
          comments: [{ author: 'uat', at: '2026-08-02T00:00:00Z', body: 'All steps PASS.' }],
        }),
      },
    });

    await closeTask({
      repoRoot: repoDir,
      key: 'TASK-904',
      comment: { author: 'orchestrator', body: 'Closing.' },
    });
    expect(readTaskFile(repoDir, 'TASK-904').status).toBe('done');
  });
});

// ===========================================================================
// TASK-188 AC2/AC4 — replays adversarial probe A6 (state/sessions/
// 20260708T154259Z-29a27eda/artifacts/ac-fidelity-round2.mjs) as a permanent
// regression lock. A6: closeTask's own closing comment claims author:
// 'reviewer' with NO prior reviewer comment on record — a "review" the
// orchestrator fabricated as the closing remark, in the same call as the
// close, with no reviewer subagent having run. Previously MISSED (closeTask
// accepted it unconditionally, verification_tier: 'tests-after'); now
// CAUGHT: closeTask rejects any comment.author === 'reviewer' outright,
// because a review's legitimacy is defined by being recorded as a SEPARATE,
// pre-existing comment (see hasCommentFromAuthor — the seam TASK-187 builds
// its close precondition on), never fabricated as the terminal closing
// remark in the same call. This is deliberately narrower than "detect who is
// really calling" (impossible at this primitive — every write flows through
// the same MCP surface regardless of claimed author; see the TASK-188
// hand-off): it closes exactly the shape A6 demonstrated, without inventing
// an identity mechanism this ticket explicitly rejected.
// ===========================================================================
describe('TASK-188 AC2/AC4 — A6 probe replay: closeTask rejects a self-authored "reviewer" closing comment', () => {
  it('A6 — closing comment author:"reviewer" with no prior reviewer comment on record is REJECTED', async () => {
    const { closeTask, ClosingCommentAuthorError } = await import('../src/task-store.js');

    const repoDir = makeTmpDir('af-a6-reviewer-closing-comment');
    makeRepoSkeleton(repoDir, {
      tasks: {
        'TASK-910': makeTask({ key: 'TASK-910', verification_tier: 'tests-after', comments: [] }),
      },
    });
    const before = readTaskFileBytes(repoDir, 'TASK-910');

    let caught;
    try {
      await closeTask({
        repoRoot: repoDir,
        key: 'TASK-910',
        comment: { author: 'reviewer', body: 'APPROVE. All acceptance criteria met.' },
      });
    } catch (err) {
      caught = err;
    }
    expect(
      caught,
      "the orchestrator must not be able to author the reviewer's own approval as the closing comment "
        + '— nothing binds an author:"reviewer" comment to an actual reviewer having run',
    ).toBeInstanceOf(ClosingCommentAuthorError);
    expect(caught.code).toBe('E_INVALID_CLOSING_COMMENT_AUTHOR');
    expect(readTaskFileBytes(repoDir, 'TASK-910')).toBe(before);
  });

  it('positive control — closing with a PRE-EXISTING reviewer comment already on record, and a non-reviewer closing-comment author, succeeds', async () => {
    const { closeTask, hasCommentFromAuthor } = await import('../src/task-store.js');

    const repoDir = makeTmpDir('af-a6-reviewer-precedent-ok');
    makeRepoSkeleton(repoDir, {
      tasks: {
        'TASK-911': makeTask({
          key: 'TASK-911',
          verification_tier: 'tests-after',
          status: 'in_review', // TASK-187 AC2
          comments: [{ author: 'reviewer', at: '2026-08-02T00:00:00Z', body: 'APPROVE.' }],
        }),
      },
    });

    await closeTask({
      repoRoot: repoDir,
      key: 'TASK-911',
      comment: { author: 'orchestrator', body: 'Reviewer approved. Closing.' },
      linked_commits: ['abc1234'], // TASK-187 AC3 — tests-after tier requires non-empty linked_commits too
    });

    const after = readTaskFile(repoDir, 'TASK-911');
    expect(after.status).toBe('done');
    expect(hasCommentFromAuthor(after, 'reviewer')).toBe(true);
  });
});

// ===========================================================================
// TASK-188 AC4 — the comment author is constrained to a known enum
// (COMMENT_AUTHORS, mirrored from tasks/schema.json's comments.items.
// properties.author enum) rather than an arbitrary string.
// ===========================================================================
describe('TASK-188 AC4 — comment author is constrained to a known enum', () => {
  it('appendComment rejects an author outside the known enum', async () => {
    const { appendComment } = await import('../src/task-store.js');
    const repoDir = makeTmpDir('af-author-enum-append-reject');
    makeRepoSkeleton(repoDir, { tasks: { 'TASK-912': makeTask({ key: 'TASK-912' }) } });

    await expect(
      appendComment({
        repoRoot: repoDir, key: 'TASK-912', author: 'tester', body: 'hi',
      }),
    ).rejects.toThrow(/author/i);
  });

  it('appendComment accepts every author in COMMENT_AUTHORS, including backlog-seeder', async () => {
    const { appendComment, COMMENT_AUTHORS } = await import('../src/task-store.js');
    const repoDir = makeTmpDir('af-author-enum-append-accept');
    makeRepoSkeleton(repoDir, { tasks: { 'TASK-913': makeTask({ key: 'TASK-913' }) } });

    for (const author of COMMENT_AUTHORS) {
      await appendComment({
        repoRoot: repoDir, key: 'TASK-913', author, body: `from ${author}`,
      });
    }
    const task = readTaskFile(repoDir, 'TASK-913');
    expect(task.comments.map((c) => c.author)).toEqual(COMMENT_AUTHORS);
  });

  it('closeTask rejects an unknown comment author before any disk write', async () => {
    const { closeTask } = await import('../src/task-store.js');
    const repoDir = makeTmpDir('af-author-enum-close-reject');
    makeRepoSkeleton(repoDir, { tasks: { 'TASK-914': makeTask({ key: 'TASK-914' }) } });
    const before = readTaskFileBytes(repoDir, 'TASK-914');

    await expect(
      closeTask({
        repoRoot: repoDir, key: 'TASK-914', comment: { author: 'random-string', body: 'x' },
      }),
    ).rejects.toThrow(/author/i);
    expect(readTaskFileBytes(repoDir, 'TASK-914')).toBe(before);
  });
});

// ===========================================================================
// TASK-188 — hasCommentFromAuthor: the seam TASK-187's close precondition
// ("has a reviewer comment been recorded on this task?") builds on.
// ===========================================================================
describe('TASK-188 — hasCommentFromAuthor: the seam TASK-187 consumes', () => {
  it('returns false when no comment from the given author exists', async () => {
    const { hasCommentFromAuthor } = await import('../src/task-store.js');
    expect(hasCommentFromAuthor({ comments: [] }, 'reviewer')).toBe(false);
    expect(hasCommentFromAuthor({}, 'reviewer')).toBe(false);
    expect(hasCommentFromAuthor(null, 'reviewer')).toBe(false);
  });

  it('returns true once at least one comment carries the given author, regardless of content', async () => {
    const { hasCommentFromAuthor } = await import('../src/task-store.js');
    const task = {
      comments: [{ author: 'developer', body: 'x' }, { author: 'reviewer', body: 'LGTM' }],
    };
    expect(hasCommentFromAuthor(task, 'reviewer')).toBe(true);
    expect(hasCommentFromAuthor(task, 'uat')).toBe(false);
  });
});

// ===========================================================================
// TASK-187 — A5/P9 probe replay (state/sessions/20260708T154259Z-29a27eda/
// artifacts/ac-fidelity-round2.mjs and ac-fidelity-probes.mjs). Ports the two
// adversarial probes as permanent regression specs, per the
// hive-adversarial-improve protocol's replayable-fixture rule (AC7).
//
// A5 (AC2) — before this ticket, a tdd ticket created `status: todo` could be
// closed straight to `done` in a single closeTask call: never in_progress,
// never in_review, no review of any kind. Nothing enforced that ANY
// review-implying state was ever visited. Now CAUGHT:
// InvalidPredecessorStateError.
//
// P9 (AC3) — before this ticket, a tdd ticket whose ACs demanded captured
// red-run evidence could close with the 4-word comment "Done." and no
// linked_commits — nothing mechanically related the AC's evidence promise to
// a receipt. Now CAUGHT: CloseEvidenceError. Isolated from A5 by starting the
// fixture at status 'in_review' (the predecessor-state precondition already
// satisfied), so this probe exercises the evidence check specifically.
// ===========================================================================
describe('TASK-187 — A5/P9 probe replay: done requires a valid predecessor state and evidence proportional to tier', () => {
  it('A5 — a tdd ticket closed straight from todo to done in one hop (no in_progress, no in_review, no review at all) is REJECTED', async () => {
    const { closeTask, InvalidPredecessorStateError } = await import('../src/task-store.js');

    const repoDir = makeTmpDir('af-a5-todo-to-done');
    makeRepoSkeleton(repoDir, {
      tasks: {
        'TASK-950': makeTask({
          key: 'TASK-950', verification_tier: 'tdd', status: 'todo', comments: [],
        }),
      },
    });
    const before = readTaskFileBytes(repoDir, 'TASK-950');

    let caught;
    try {
      await closeTask({
        repoRoot: repoDir, key: 'TASK-950', comment: { author: 'orchestrator', body: 'Done.' },
      });
    } catch (err) {
      caught = err;
    }
    expect(
      caught,
      'a tdd ticket must not be closeable straight from todo — done is reachable only from a '
        + 'predecessor state that implies a review occurred',
    ).toBeInstanceOf(InvalidPredecessorStateError);
    expect(caught.code).toBe('E_INVALID_DONE_PREDECESSOR');
    expect(readTaskFileBytes(repoDir, 'TASK-950')).toBe(before);
  });

  it('P9 — a tdd ticket demanding captured red-run evidence closes with a four-word comment and no linked_commits: REJECTED for missing evidence', async () => {
    const { closeTask, CloseEvidenceError } = await import('../src/task-store.js');

    const repoDir = makeTmpDir('af-p9-no-evidence');
    makeRepoSkeleton(repoDir, {
      tasks: {
        // status is already 'in_review' so this isolates the EVIDENCE check
        // (AC3) from the predecessor-state check (AC2, covered by A5 above).
        'TASK-951': makeTask({
          key: 'TASK-951', verification_tier: 'tdd', status: 'in_review', comments: [],
        }),
      },
    });
    const before = readTaskFileBytes(repoDir, 'TASK-951');

    let caught;
    try {
      await closeTask({
        repoRoot: repoDir, key: 'TASK-951', comment: { author: 'orchestrator', body: 'Done.' },
      });
    } catch (err) {
      caught = err;
    }
    expect(
      caught,
      'a tdd ticket must not close with zero evidence — no pre-existing reviewer comment, no linked_commits',
    ).toBeInstanceOf(CloseEvidenceError);
    expect(caught.code).toBe('E_CLOSE_EVIDENCE_REQUIRED');
    expect(readTaskFileBytes(repoDir, 'TASK-951')).toBe(before);
  });

  // Positive control — once BOTH the predecessor state and the evidence
  // requirement are satisfied, the ticket closes normally.
  it('positive control — in_review + pre-existing reviewer comment + linked_commits closes normally', async () => {
    const { closeTask } = await import('../src/task-store.js');

    const repoDir = makeTmpDir('af-a5-p9-positive');
    makeRepoSkeleton(repoDir, {
      tasks: {
        'TASK-952': makeTask({
          key: 'TASK-952',
          verification_tier: 'tdd',
          status: 'in_review',
          comments: [{ author: 'reviewer', at: '2026-08-02T00:00:00Z', body: 'APPROVE.' }],
        }),
      },
    });

    await closeTask({
      repoRoot: repoDir,
      key: 'TASK-952',
      comment: { author: 'developer', body: 'Shipped per review.' },
      linked_commits: ['abc1234'],
    });

    const after = readTaskFile(repoDir, 'TASK-952');
    expect(after.status).toBe('done');
  });

  // AC6 — the escape hatch: a legitimate exception bypasses both checks and
  // records an auditable marker comment.
  it('AC6 — exception:{reason} bypasses both checks and records an auditable [CLOSE-EXCEPTION] comment', async () => {
    const { closeTask } = await import('../src/task-store.js');

    const repoDir = makeTmpDir('af-a5-p9-exception');
    makeRepoSkeleton(repoDir, {
      tasks: {
        'TASK-953': makeTask({
          key: 'TASK-953', verification_tier: 'tdd', status: 'todo', comments: [],
        }),
      },
    });

    await closeTask({
      repoRoot: repoDir,
      key: 'TASK-953',
      comment: { author: 'orchestrator', body: "Won't do — superseded by TASK-960." },
      exception: { reason: "Won't-do closure; ticket superseded, never implemented." },
    });

    const after = readTaskFile(repoDir, 'TASK-953');
    expect(after.status).toBe('done');
    expect(after.comments).toHaveLength(2);
    expect(after.comments[0].author).toBe('orchestrator');
    expect(after.comments[0].body).toMatch(/^\[CLOSE-EXCEPTION\]/);
    expect(after.comments[1].body).toBe("Won't do — superseded by TASK-960.");
  });

  it('AC6 — exception without a non-empty reason is rejected before any disk write', async () => {
    const { closeTask } = await import('../src/task-store.js');

    const repoDir = makeTmpDir('af-a5-p9-exception-bad');
    makeRepoSkeleton(repoDir, {
      tasks: {
        'TASK-954': makeTask({
          key: 'TASK-954', verification_tier: 'tdd', status: 'todo', comments: [],
        }),
      },
    });
    const before = readTaskFileBytes(repoDir, 'TASK-954');

    await expect(
      closeTask({
        repoRoot: repoDir,
        key: 'TASK-954',
        comment: { author: 'orchestrator', body: 'Closing.' },
        exception: { reason: '   ' },
      }),
    ).rejects.toThrow(/non-empty/i);
    expect(readTaskFileBytes(repoDir, 'TASK-954')).toBe(before);
  });
});
