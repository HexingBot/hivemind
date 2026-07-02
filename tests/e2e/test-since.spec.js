// tests/e2e/test-since.spec.js
// TASK-081 HIGH-1 — end-to-end regression lock: the real `scripts/test-since.mjs`
// process, spawned exactly as `npm run test:since -- <ref>` would invoke it,
// must exit non-zero and say why when the ref does not resolve. This is the
// integration-level counterpart to tests/test-since.spec.js's mocked unit
// coverage of resolveSafeRef — it confirms process.exit actually fires with
// the right code, not just that the function returns `ok: false`.
//
// The invalid-ref path returns before vitest would ever be invoked, so this
// spawn is fast (a single failing `git rev-parse`) despite living in the e2e
// tier (real process spawn, per the tier-by-folder convention in CLAUDE.md).

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { REPO_ROOT } from '../helpers/repoRoot.js';

const SCRIPT = join(REPO_ROOT, 'scripts', 'test-since.mjs');

describe('TASK-081 HIGH-1 — test-since.mjs exits non-zero on an unresolvable ref', () => {
  it('invalid_ref_process_exits_non_zero_with_an_explanatory_stderr_message', () => {
    const result = spawnSync(process.execPath, [SCRIPT, 'zzzzzzz'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });

    expect(result.status, `stderr: ${result.stderr}`).not.toBe(0);
    expect(result.stderr).toMatch(/did not resolve to a commit/);
    expect(result.stderr).toMatch(/silently selects zero specs/);
  });

  it('missing_ref_process_exits_non_zero_with_a_usage_message', () => {
    const result = spawnSync(process.execPath, [SCRIPT], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });

    expect(result.status, `stderr: ${result.stderr}`).not.toBe(0);
    expect(result.stderr).toMatch(/usage:/);
  });
});
