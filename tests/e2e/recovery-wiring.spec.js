// tests/e2e/recovery-wiring.spec.js
// TASK-083 AC1 — src/recovery.js's sweepAndRecover({bundleDir}) is fully
// implemented and unit-tested (tests/e2e/atomic-write.spec.js calls it
// directly), but as of TASK-083 it has ZERO production call sites: no
// bundle-load seam ever invokes it. That means the documented contract
// ("crash mid-write leaves an orphan tmp; recovery.sweepAndRecover() promotes
// or deletes orphans on next read" — src/atomic-write.js's own header comment)
// is currently false. A bundle whose session.json got corrupted by an
// interrupted write is permanently unreadable by any new chat's RESUME FIRST
// step until a human manually deletes/renames files.
//
// This spec seeds exactly the case recovery.js documents in its own header:
//   "tmp present, target present but unparseable -> promote newest tmp"
// at the seam every new chat depends on (resumeFromPointer, src/lifecycle.js)
// and asserts the promoted content comes back — proving sweepAndRecover ran
// BEFORE the read, not that corrupt bytes were somehow parsed successfully.
//
// Today (no call site wired in) this spec fails: resumeFromPointer's
// readBundleSession() does a raw JSON.parse(readFileSync(session.json)) and
// throws a SyntaxError on the corrupt target.

import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

import { PROD, bundlePath, makeRepoSkeleton } from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';

afterAll(cleanupAll);

describe('AC1 — sweepAndRecover wired into the resumeFromPointer bundle-load seam', () => {
  it('resume_from_pointer_recovers_orphan_tmp_over_corrupt_target', async () => {
    const { resumeFromPointer } = await import(PROD.lifecycle);

    const repoDir = makeTmpDir('af-recovery-wiring');
    const sessionId = '20260702T120000Z-deadbeef';
    const bundleDir = bundlePath(repoDir, sessionId);
    mkdirSync(bundleDir, { recursive: true });

    // Target on disk is CORRUPT — simulating a crash that truncated a prior
    // write partway through the rename window described in src/atomic-write.js.
    writeFileSync(
      join(bundleDir, 'session.json'),
      '{"schema_version": 2, "session_id": "trunc',
      'utf8',
    );

    // The orphan tmp is the sibling that WOULD have been renamed onto
    // session.json had the crash not interrupted it. Naming convention
    // matches src/atomic-write.js exactly: `${base}.tmp.${pid}-${randomHex}`.
    const promotedState = {
      schema_version: 2,
      session_id: sessionId,
      lifecycle_state: 'active',
      updated_at: '2026-07-02T12:00:00Z',
      active_task: null,
      workflow_step: 'impl',
      next_action: 'promoted from orphan tmp by sweepAndRecover',
      handoff_summary: 'recovered handoff',
      open_questions: [],
      blockers: [],
      decisions: [],
      subagent_results: [],
      pending_human_confirmation: null,
    };
    const tmpSuffix = `${process.pid}-${randomBytes(6).toString('hex')}`;
    const tmpPath = join(bundleDir, `session.json.tmp.${tmpSuffix}`);
    writeFileSync(tmpPath, JSON.stringify(promotedState, null, 2) + '\n', 'utf8');

    makeRepoSkeleton(repoDir, {
      pointer: {
        schema_version: 2,
        active_session_id: sessionId,
        updated_at: '2026-07-02T12:00:00Z',
      },
    });

    const result = await resumeFromPointer({ repoRoot: repoDir });

    // The promoted content is what comes back.
    expect(result.handoff_summary).toBe('recovered handoff');
    expect(result.next_action).toBe('promoted from orphan tmp by sweepAndRecover');

    // On-disk: the corrupt target has been replaced by the promoted content,
    // and the orphan tmp is gone (recovery.js's own promote-then-cleanup
    // contract — see src/recovery.js's "Clean up any remaining tmps" step).
    expect(existsSync(tmpPath), 'orphan tmp should be consumed by the sweep').toBe(false);
    const onDisk = JSON.parse(readFileSync(join(bundleDir, 'session.json'), 'utf8'));
    expect(onDisk.handoff_summary).toBe('recovered handoff');
  });
});
