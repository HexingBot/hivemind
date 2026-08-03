// tests/e2e/test-changed.spec.js
// TASK-194 — end-to-end regression lock: the real `scripts/test-changed.mjs`
// process, spawned exactly as `npm run test:changed` would invoke it, prints
// a self-describing TEST_CHANGED_ZERO_SELECTION marker on a clean tree
// (AC2/AC3), prints no marker and actually runs the matched test on a real
// uncommitted change the import graph routes (AC6 — the other branch), and
// still exits non-zero on a genuine test failure (AC4). Uses a disposable
// git+vitest fixture repo (never the framework's own tasks/ + live commit
// history), same pattern as tests/e2e/test-since.spec.js.

import {
  describe, it, expect, afterAll,
} from 'vitest';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from '../helpers/repoRoot.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';

const SCRIPT = join(REPO_ROOT, 'scripts', 'test-changed.mjs');

afterAll(cleanupAll);

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

/** A minimal real git repo with one spec file, committed (clean tree). */
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
  git(repoRoot, ['add', '-A']);
  git(repoRoot, ['commit', '-q', '-m', 'init']);

  return repoRoot;
}

function runWrapper(repoRoot) {
  return spawnSync(process.execPath, [SCRIPT], { cwd: repoRoot, encoding: 'utf8' });
}

describe('TASK-194 — test-changed.mjs is self-describing on zero-selection, never fatal on it', () => {
  it(
    'a_clean_tree_prints_the_empty_diff_marker_and_exits_zero',
    () => {
      const repoRoot = buildFixture('af-test-changed-empty-diff');
      const result = runWrapper(repoRoot);

      expect(result.status, `stderr: ${result.stderr}`).toBe(0);
      expect(result.stderr).toMatch(/TEST_CHANGED_ZERO_SELECTION: reason=empty-diff/);
      expect(result.stdout).toMatch(/No test files found/);
    },
    30_000,
  );

  it(
    'an_uncommitted_change_the_import_graph_routes_prints_no_marker_and_actually_runs_the_test',
    () => {
      const repoRoot = buildFixture('af-test-changed-matched');
      // Uncommitted (unstaged) edit to the spec file itself — must select it
      // normally, with no marker, proving the new pre-check doesn't regress
      // the primary, matched path.
      writeFileSync(
        join(repoRoot, 'tests', 'sample.spec.js'),
        "import { describe, it, expect } from 'vitest';\n"
          + "describe('sample', () => { it('passes-renamed', () => { expect(1).toBe(1); }); });\n",
      );

      const result = runWrapper(repoRoot);

      expect(result.status, `stderr: ${result.stderr}`).toBe(0);
      expect(result.stderr).not.toMatch(/TEST_CHANGED_ZERO_SELECTION/);
      expect(result.stdout).toMatch(/1 passed/);
    },
    30_000,
  );

  it(
    'AC4_a_genuine_test_failure_still_exits_non_zero_through_the_wrapper',
    () => {
      const repoRoot = buildFixture('af-test-changed-real-failure');
      // Uncommitted edit that makes the assertion genuinely fail.
      writeFileSync(
        join(repoRoot, 'tests', 'sample.spec.js'),
        "import { describe, it, expect } from 'vitest';\n"
          + "describe('sample', () => { it('fails', () => { expect(1).toBe(2); }); });\n",
      );

      const result = runWrapper(repoRoot);

      expect(result.status, `stderr: ${result.stderr}`).not.toBe(0);
      expect(result.stderr).not.toMatch(/TEST_CHANGED_ZERO_SELECTION/);
      expect(result.stdout).toMatch(/1 failed/);
    },
    30_000,
  );
});
