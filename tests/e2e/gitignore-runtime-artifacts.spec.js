// tests/e2e/gitignore-runtime-artifacts.spec.js
// TASK-083 AC2 — scoped .gitignore patterns for runtime-only artifacts:
//   state/.lock          (the advisory session lock, src/session-lock.js:42)
//   state/**/*.tmp.*      (orphan atomic-write siblings under state/, incl.
//                          bundle session.json/manifest.json tmps)
//   tasks/*.tmp.*         (orphan atomic-write siblings under tasks/)
// per src/atomic-write.js's `${base}.tmp.${pid}-${randomHex}` naming
// convention. None of these should ever be committed — a broad `git add -A`
// mid-run would otherwise stage a live lock file or a half-written orphan.
//
// The patterns must be SCOPED: they must not swallow the tracked bundle/task
// files that live alongside them (state/session.json, a bundle's own
// session.json, lifecycle.log, or tasks/TASK-NNN.json) — that's what makes
// this a targeted carve-out rather than a blanket `state/`/`tasks/` ignore.
//
// This spec fails today: .gitignore has no state/.lock, state/**/*.tmp.*, or
// tasks/*.tmp.* patterns, so `git check-ignore` reports every representative
// runtime-artifact path as NOT ignored (exit 1).

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';

import { REPO_ROOT } from '../helpers/repoRoot.js';

function checkIgnoreExitCode(relPath) {
  // git check-ignore: exit 0 = ignored, exit 1 = not ignored, >1 = fatal error.
  // Paths are pattern-matched against .gitignore; they need not exist on disk.
  const r = spawnSync('git', ['check-ignore', '-q', relPath], {
    cwd: REPO_ROOT, encoding: 'utf8',
  });
  return r.status;
}

describe('AC2 — scoped gitignore patterns for runtime artifacts', () => {
  it('git_ignores_lock_and_scoped_tmp_globs_but_not_tracked_state_or_task_files', () => {
    const mustBeIgnored = [
      'state/.lock',
      'state/sessions/20260702T000000Z-deadbeef/session.json.tmp.12345-abcdef01cdef',
      'state/sessions/20260702T000000Z-deadbeef/manifest.json.tmp.999-aa11bb22cc33',
      'state/session.json.tmp.4242-00ff11ee22dd',
      'tasks/TASK-999.json.tmp.12345-abcdef01cdef',
      'tasks/index.json.tmp.777-00112233aabb',
    ];
    for (const rel of mustBeIgnored) {
      const status = checkIgnoreExitCode(rel);
      expect(
        status,
        `${rel} should be git-ignored (git check-ignore exit 0); got exit ${status}`,
      ).toBe(0);
    }

    const mustNotBeIgnored = [
      'state/session.json',
      'tasks/TASK-001.json',
      'tasks/index.json',
      'state/sessions/20260702T000000Z-deadbeef/session.json',
      'state/sessions/20260702T000000Z-deadbeef/manifest.json',
      'state/sessions/20260702T000000Z-deadbeef/lifecycle.log',
    ];
    for (const rel of mustNotBeIgnored) {
      const status = checkIgnoreExitCode(rel);
      expect(
        status,
        `${rel} must NOT be git-ignored (it's a tracked file); got exit ${status} (0 means ignored)`,
      ).not.toBe(0);
    }
  });
});
