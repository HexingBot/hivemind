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

import {
  describe, it, expect, afterAll,
} from 'vitest';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from '../helpers/repoRoot.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';

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

// TASK-192 AC4 — real (not mocked) zero-selection regression lock: a
// disposable git+vitest fixture repo (never the framework's own tasks/ +
// live commit history, which siblings mutate concurrently) proves the
// wrapper's two TEST_SINCE_ZERO_SELECTION markers fire for the right real
// git/vitest state, and neither one turns the process exit non-zero — see
// the "Empty-result contract" section of CLAUDE.md for why a resolved-ref
// zero-selection must stay non-fatal.
afterAll(cleanupAll);

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

/** A minimal real git repo with one spec file and one file no spec imports. */
function buildFixture(label) {
  const repoRoot = makeTmpDir(label);
  git(repoRoot, ['init', '-q']);
  git(repoRoot, ['config', 'user.email', 'test@test.com']);
  git(repoRoot, ['config', 'user.name', 'test']);

  writeFileSync(join(repoRoot, 'package.json'), JSON.stringify({ name: 'fixture', version: '0.0.0', type: 'module' }));
  // No `vitest/config` import (the fixture has no node_modules of its own) —
  // a plain object export is all `defineConfig` does under the hood.
  writeFileSync(join(repoRoot, 'vitest.config.all.js'), "export default { test: { include: ['tests/**/*.spec.js'] } };\n");
  mkdirSync(join(repoRoot, 'tests'));
  writeFileSync(
    join(repoRoot, 'tests', 'sample.spec.js'),
    "import { describe, it, expect } from 'vitest';\n"
      + "describe('sample', () => { it('passes', () => { expect(1).toBe(1); }); });\n",
  );
  writeFileSync(join(repoRoot, 'data.json'), '{"a":1}\n');
  git(repoRoot, ['add', '-A']);
  git(repoRoot, ['commit', '-q', '-m', 'init']);

  return repoRoot;
}

function runWrapper(repoRoot, ref) {
  return spawnSync(process.execPath, [SCRIPT, ref], { cwd: repoRoot, encoding: 'utf8' });
}

describe('TASK-192 AC4 — real zero-selection runs are self-describing, never fatal', () => {
  it(
    'a_genuinely_empty_diff_prints_the_empty_diff_marker_and_exits_zero',
    () => {
      const repoRoot = buildFixture('af-test-since-empty-diff');
      // ref === HEAD on a clean tree: committed diff, staged, and unstaged
      // are all empty by construction.
      const result = runWrapper(repoRoot, 'HEAD');

      expect(result.status, `stderr: ${result.stderr}`).toBe(0);
      expect(result.stderr).toMatch(/TEST_SINCE_ZERO_SELECTION: reason=empty-diff/);
      expect(result.stderr).not.toMatch(/reason=no-spec-matched/);
    },
    30_000,
  );

  it(
    'a_real_non_empty_diff_the_import_graph_cannot_route_prints_the_no_spec_matched_marker_and_still_exits_zero',
    () => {
      const repoRoot = buildFixture('af-test-since-no-spec-matched');
      // A real committed change to a file no spec imports: non-empty diff,
      // but vitest's own --changed selection matches zero specs.
      writeFileSync(join(repoRoot, 'data.json'), '{"a":2}\n');
      git(repoRoot, ['add', '-A']);
      git(repoRoot, ['commit', '-q', '-m', 'change data.json only']);

      const result = runWrapper(repoRoot, 'HEAD~1');

      // Deliberately NOT fatal (CLAUDE.md's Empty-result contract, TASK-192):
      // a docs/config/fs-read-only change legitimately produces this same
      // shape, so this must stay a non-blocking, self-describing marker.
      expect(result.status, `stderr: ${result.stderr}`).toBe(0);
      expect(result.stderr).toMatch(/TEST_SINCE_ZERO_SELECTION: reason=no-spec-matched/);
      expect(result.stderr).not.toMatch(/reason=empty-diff/);
    },
    30_000,
  );

  it(
    'a_real_non_empty_diff_the_import_graph_DOES_route_prints_no_marker_and_actually_runs_the_test',
    () => {
      const repoRoot = buildFixture('af-test-since-matched');
      // Control: touching the spec file itself must select it normally —
      // proves the new pre-check doesn't regress the primary, matched path.
      writeFileSync(
        join(repoRoot, 'tests', 'sample.spec.js'),
        "import { describe, it, expect } from 'vitest';\n"
          + "describe('sample', () => { it('passes-renamed', () => { expect(1).toBe(1); }); });\n",
      );
      git(repoRoot, ['add', '-A']);
      git(repoRoot, ['commit', '-q', '-m', 'rename test']);

      const result = runWrapper(repoRoot, 'HEAD~1');

      expect(result.status, `stderr: ${result.stderr}`).toBe(0);
      expect(result.stderr).not.toMatch(/TEST_SINCE_ZERO_SELECTION/);
      expect(result.stdout).toMatch(/1 passed/);
    },
    30_000,
  );
});
