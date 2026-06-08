// tests/lifecycle-polish.spec.js
// TASK-008 — failing suite for the 5 LOW findings deferred from TASK-004 review.
//
// LOW #1: .claude/agents/researcher.md must call out that Write-tool scoping is
//         convention-only and not SDK-enforced. Source-grep.
// LOW #2: src/lifecycle.js#loadActiveBundleWithFallback must NOT silently target
//         the most-recent bundle when the pointer is null; it must surface
//         E_NO_ACTIVE_SESSION instead of falling through to E_INVALID_TRANSITION.
//         A non-null pointer pointing at an ended bundle still emits
//         E_INVALID_TRANSITION on pause (existing contract).
// LOW #3: src/lifecycle.js#endSession must write summary.md through the same
//         atomic temp+rename recipe used for session.json, not plain
//         writeFileSync.
// LOW #4: src/migrate.js must document the deliberate non-verbatim defaults
//         (lifecycle_state, open_questions, blockers, decisions,
//         subagent_results, pending_human_confirmation) it injects on lift.
// LOW #5: the existing pause_on_ended_errors test in lifecycle.spec.js pinned a
//         three-alternation regex; this file adds a sibling assertion pinning
//         the exact error code (the existing test is also tightened in the
//         same commit, see tests/lifecycle.spec.js).
//
// The tests use the same mocking + fixture conventions as
// tests/atomic-write.spec.js so the recipe assertions stay consistent.

import { describe, it, expect, vi, afterEach, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PROD, makeSessionId, seedActiveBundle, seedBundleInState, bundlePath,
  makeRepoSkeleton,
} from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';

afterAll(cleanupAll);

// Same mocking shape as atomic-write.spec.js — we intentionally do NOT trap
// writeFileSync at the module level because the fixture helpers use it to seed
// bundles. The LOW #3 test re-imports node:fs separately so it can spy on
// writeFileSync only for the production-code window between fixture setup and
// the endSession call.
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    openSync: vi.fn(real.openSync),
    writeSync: vi.fn(real.writeSync),
    fsyncSync: vi.fn(real.fsyncSync),
    closeSync: vi.fn(real.closeSync),
    renameSync: vi.fn(real.renameSync),
    writeFileSync: vi.fn(real.writeFileSync),
  };
});

afterEach(() => {
  vi.clearAllMocks();
});

const __thisDir = dirname(fileURLToPath(import.meta.url));
const __repoRoot = join(__thisDir, '..', '..');

/* -------------------------------------------------------------------------- */
/* LOW #1 — researcher.md prose calls out SDK-unenforced Write scope         */
/* -------------------------------------------------------------------------- */

describe('TASK-008 LOW #1 — researcher.md Write-scope caveat', () => {
  it('researcher_md_body_explains_write_scope_is_convention_only', () => {
    const p = join(__repoRoot, '.claude', 'agents', 'researcher.md');
    const text = readFileSync(p, 'utf8');
    // Look for an explicit statement that writes outside .claude/skills/ are
    // convention-only and not enforced by the SDK / harness layer. Loose
    // whitespace handling so the impl can reflow the prose freely.
    const pattern =
      /writes?\s+outside\s+`?\.claude\/skills\/`?[^.\n]*?(convention[- ]only|not\s+(?:sdk|harness)[- ]enforced)/i;
    expect(text, 'researcher.md must document that Write scope is convention-only')
      .toMatch(pattern);
  });
});

/* -------------------------------------------------------------------------- */
/* LOW #2 — loadActiveBundleWithFallback error-code clarity                  */
/* -------------------------------------------------------------------------- */

describe('TASK-008 LOW #2 — pause error code with null pointer', () => {
  it('pause_with_null_pointer_throws_E_NO_ACTIVE_SESSION_even_when_ended_bundle_exists', async () => {
    const { pauseSession } = await import(PROD.lifecycle);
    const repoDir = makeTmpDir('af-no-active-session');
    const id = makeSessionId(101);
    const bundleDir = bundlePath(repoDir, id);
    // Seed an ended bundle on disk. The pointer is cleared (active_session_id
    // = null) which is what `endSession` leaves behind after a clean close.
    seedBundleInState(bundleDir, 'ended', { session_id: id });
    makeRepoSkeleton(repoDir, {
      pointer: {
        schema_version: 2,
        active_session_id: null,
        updated_at: '2026-05-24T12:00:00Z',
      },
    });

    let caught;
    try {
      await pauseSession({
        repoRoot: repoDir,
        handoffSummary: 'should fail with no-active-session',
        nextAction: 'should fail',
      });
    } catch (e) {
      caught = e;
    }
    expect(caught, 'expected pauseSession to throw').toBeDefined();
    // The whole point of the LOW: this case used to fall through to the
    // most-recent ended bundle and surface E_INVALID_TRANSITION. We want a
    // distinct, accurate error code instead.
    expect(caught.code).toBe('E_NO_ACTIVE_SESSION');
  });

  it('pause_with_non_null_pointer_to_ended_bundle_still_throws_E_INVALID_TRANSITION', async () => {
    const { pauseSession } = await import(PROD.lifecycle);
    const repoDir = makeTmpDir('af-ended-with-pointer');
    const id = makeSessionId(102);
    const bundleDir = bundlePath(repoDir, id);
    seedBundleInState(bundleDir, 'ended', { session_id: id });
    // Pointer is non-null and points at the ended bundle. This is an
    // anomalous-but-possible state (e.g., the pointer-clear write after
    // endSession crashed). The existing contract is: pause emits
    // E_INVALID_TRANSITION on an ended bundle when the bundle is loadable
    // via the pointer.
    makeRepoSkeleton(repoDir, {
      pointer: {
        schema_version: 2,
        active_session_id: id,
        updated_at: '2026-05-24T12:00:00Z',
      },
    });

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
    expect(caught, 'expected pauseSession to throw').toBeDefined();
    expect(caught.code).toBe('E_INVALID_TRANSITION');
  });
});

/* -------------------------------------------------------------------------- */
/* LOW #3 — endSession writes summary.md atomically                          */
/* -------------------------------------------------------------------------- */

describe('TASK-008 LOW #3 — endSession summary.md atomic write', () => {
  it('endSession_writes_summary_md_via_temp_then_rename', async () => {
    const fs = await import('node:fs');
    const { endSession } = await import(PROD.lifecycle);

    const repoDir = makeTmpDir('af-summary-atomic');
    const id = makeSessionId(103);
    const bundleDir = bundlePath(repoDir, id);
    seedActiveBundle(bundleDir, { session_id: id });
    makeRepoSkeleton(repoDir, {
      pointer: {
        schema_version: 2,
        active_session_id: id,
        updated_at: '2026-05-24T12:00:00Z',
      },
    });

    // Fixture setup has finished — clear the mock counters so we only observe
    // production-code calls.
    vi.clearAllMocks();

    await endSession({
      repoRoot: repoDir,
      handoffSummary: 'closing the session',
    });

    const summaryTarget = join(bundleDir, 'summary.md');

    // 1. A sibling tmp file was opened with O_CREAT|O_EXCL for summary.md.
    const tmpOpenForSummary = fs.openSync.mock.calls.find(([p, flags]) =>
      String(p).startsWith(summaryTarget + '.tmp.') &&
      typeof flags === 'number' &&
      (flags & fs.constants.O_EXCL) !== 0 &&
      (flags & fs.constants.O_CREAT) !== 0,
    );
    expect(
      tmpOpenForSummary,
      'expected O_CREAT|O_EXCL open on a sibling tmp file for summary.md',
    ).toBeDefined();
    const tmpPath = String(tmpOpenForSummary[0]);

    // 2. rename moved that tmp -> summary.md.
    const renameTmpToTarget = fs.renameSync.mock.calls.find(
      ([src, dst]) => src === tmpPath && dst === summaryTarget,
    );
    expect(
      renameTmpToTarget,
      'rename(tmp, summary.md) must have been called',
    ).toBeDefined();

    // 3. fsync happened before that rename. Pin per-file ordering using the
    //    invocationCallOrder of the tmp's open call as a lower bound — the
    //    fsync that flushes that fd must come after the open and before its
    //    rename.
    const openIdx = Math.min(
      ...fs.openSync.mock.results
        .map((_, i) => i)
        .filter((i) =>
          String(fs.openSync.mock.calls[i][0]).startsWith(summaryTarget + '.tmp.'),
        )
        .map((i) => fs.openSync.mock.invocationCallOrder[i]),
    );
    const renameIdx = Math.min(
      ...fs.renameSync.mock.calls
        .map((_, i) => i)
        .filter((i) => fs.renameSync.mock.calls[i][1] === summaryTarget)
        .map((i) => fs.renameSync.mock.invocationCallOrder[i]),
    );
    const fsyncBetween = fs.fsyncSync.mock.invocationCallOrder.find(
      (order) => order > openIdx && order < renameIdx,
    );
    expect(
      fsyncBetween,
      'fsync must occur between the tmp open and the tmp->summary.md rename',
    ).toBeDefined();

    // 4. Plain writeFileSync must NOT have been called for summary.md.
    const plainSummaryWrite = fs.writeFileSync.mock.calls.find(
      ([p]) => String(p) === summaryTarget,
    );
    expect(
      plainSummaryWrite,
      'summary.md must not be written via plain writeFileSync',
    ).toBeUndefined();

    // 5. Post-condition: summary.md exists and is non-empty.
    const summary = readFileSync(summaryTarget, 'utf8');
    expect(summary.length).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */
/* LOW #4 — migrate.js documents the deliberate defaults                     */
/* -------------------------------------------------------------------------- */

describe('TASK-008 LOW #4 — migrate.js comment on default injection', () => {
  it('migrate_js_explains_non_verbatim_defaults', () => {
    const p = join(__repoRoot, 'src', 'migrate.js');
    const text = readFileSync(p, 'utf8');
    // The comment must (a) live on a comment line and (b) call out one of the
    // deliberately-injected defaults — lifecycle_state, or the
    // open_questions/blockers/decisions/subagent_results/pending_human_confirmation
    // family, or the general "inject default" framing. Loose enough that the
    // impl can phrase it naturally.
    const commentLines = text
      .split('\n')
      .filter((line) => line.trim().startsWith('//'));
    const driftComment = commentLines.find((line) =>
      /(?:lifecycle_state.*['"]active['"]|inject(?:ing|s)?\s+defaults?|non[- ]verbatim|departure\s+from\s+verbatim|defaults?\s+(?:for|when)\s+(?:open_questions|blockers|decisions|subagent_results|pending_human_confirmation))/i
        .test(line),
    );
    expect(
      driftComment,
      'src/migrate.js must contain a one-line comment naming the deliberate ' +
        'non-verbatim defaults injected by the lift',
    ).toBeDefined();
  });
});

/* -------------------------------------------------------------------------- */
/* LOW #5 — pause_on_ended pinned to a single error code                     */
/* -------------------------------------------------------------------------- */

describe('TASK-008 LOW #5 — pause-on-ended exact error code', () => {
  it('pause_on_ended_throws_exactly_E_INVALID_TRANSITION', async () => {
    // This duplicates the spirit of tests/lifecycle.spec.js#pause_on_ended_errors
    // but pins the assertion to the exact error code rather than a three-way
    // alternation regex. The existing test is also tightened in the same
    // commit; this sibling keeps the invariant living next to the rest of
    // the polish suite for clarity.
    const { pauseSession } = await import(PROD.lifecycle);
    const repoDir = makeTmpDir('af-pause-ended-exact');
    const id = makeSessionId(104);
    const bundleDir = bundlePath(repoDir, id);
    seedBundleInState(bundleDir, 'ended', { session_id: id });
    makeRepoSkeleton(repoDir, {
      pointer: {
        schema_version: 2,
        active_session_id: id,
        updated_at: '2026-05-24T12:00:00Z',
      },
    });

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
    expect(caught.code).toBe('E_INVALID_TRANSITION');
  });
});
