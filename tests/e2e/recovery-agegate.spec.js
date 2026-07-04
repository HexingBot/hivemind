// tests/e2e/recovery-agegate.spec.js
// TASK-085 AC6 — deep-review S4 scope extension (L1 from the TASK-083
// review, "symmetry check"): src/task-store.js's sweepTasksTmpFiles gained
// a ~60s mtime age-gate in TASK-083 (see tests/e2e/task-store-resilience.spec.js
// AC3) so a sweep never reaps a tmp file that might still be mid-flight
// (atomic-write.js's own two-phase prepare-then-rename window). src/recovery.js's
// sweepAndRecover({bundleDir}) — the SAME class of housekeeping sweep, but for
// state/sessions/<id>/session.json.tmp.* bundle tmps — never received the
// matching age-gate. When the bundle's session.json target is present and
// parseable, sweepAndRecover deletes EVERY session.json.tmp.* file it finds,
// unconditionally, with no age check at all. A concurrent reader (e.g. a
// second orchestrator process, or the drive loop, calling sweepAndRecover via
// resumeFromPointer/lifecycle.js) can therefore delete a fresh, still-being-
// written tmp out from under an in-flight atomicWriteFile() call.
//
// This spec fails today: sweepAndRecover has no age-gate, so it reaps the
// FRESH tmp exactly as eagerly as the stale one.

import { describe, it, expect, afterAll } from 'vitest';
import {
  writeFileSync, existsSync, utimesSync, mkdirSync,
} from 'node:fs';
import { join } from 'node:path';

import { PROD } from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';

afterAll(cleanupAll);

describe('TASK-085 AC6 — sweepAndRecover bundle-tmp reaping gains the ~60s age-gate', () => {
  it('sweep_and_recover_preserves_fresh_orphan_tmp_but_reaps_stale_one', async () => {
    const { sweepAndRecover } = await import(PROD.recovery);

    const bundleDir = makeTmpDir('af-recovery-agegate');
    mkdirSync(bundleDir, { recursive: true });

    // A valid, parseable target — sweepAndRecover's "target exists and
    // parseable -> delete every tmp" branch is exactly the one that
    // currently has no age-gate.
    const target = join(bundleDir, 'session.json');
    writeFileSync(target, JSON.stringify({
      schema_version: 2,
      session_id: 'af-recovery-agegate',
      lifecycle_state: 'active',
    }, null, 2) + '\n', 'utf8');

    // Fresh tmp — mtime is "now" (just written), simulating a writer that is
    // mid-way through atomicWriteFile's prepare/rename window.
    const freshTmp = join(bundleDir, 'session.json.tmp.11111-aaaaaaaaaaaa');
    writeFileSync(freshTmp, 'in-flight-write-bytes', 'utf8');

    // Stale tmp — backdated well past any reasonable age-gate threshold,
    // simulating a genuine crash orphan from a prior process.
    const staleTmp = join(bundleDir, 'session.json.tmp.22222-bbbbbbbbbbbb');
    writeFileSync(staleTmp, 'orphaned-crash-bytes', 'utf8');
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    utimesSync(staleTmp, fiveMinutesAgo, fiveMinutesAgo);

    sweepAndRecover({ bundleDir });

    expect(
      existsSync(freshTmp),
      'a fresh (just-written) bundle tmp must survive the sweep — it may be an in-flight write',
    ).toBe(true);
    expect(
      existsSync(staleTmp),
      'a stale (>60s old) bundle tmp must still be reaped as a crash orphan',
    ).toBe(false);

    // The valid target itself must be untouched either way.
    expect(existsSync(target)).toBe(true);
  });
});
