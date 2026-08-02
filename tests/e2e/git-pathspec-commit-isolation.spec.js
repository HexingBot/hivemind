// tests/e2e/git-pathspec-commit-isolation.spec.js
// TASK-191 — Parallel developer spawns share one git index, so explicit-path
// staging alone is not safe.
//
// AC1: a deterministic reproduction. Note on "deterministic" vs "race": the
// real hazard is an OS-scheduling race between two live processes (two
// `developer` spawns), which is inherently flaky to reproduce via real
// concurrency (spawn timing on a shared CI runner cannot be pinned). Rather
// than gamble on process-timing coincidence, this spec reproduces the exact
// SEQUENCED interleaving described in the TASK-191/TASK-184 incident report:
//   1. Agent A stages ONLY its own file (`git add fileA.txt`).
//   2. The sibling agent stages its own file in that same window
//      (`git add fileB.txt`) — this is what a live race would have done
//      non-deterministically; sequencing it explicitly makes the exact
//      failure mode deterministic and CI-safe instead of flaky.
//   3. Agent A commits.
// This is the root-cause mechanism (shared `.git/index`), not a proxy for
// it — any real race that interleaves in this order hits the identical git
// plumbing behavior asserted here. It both reproduces the HAZARD (a plain
// `git commit` after step 2 sweeps up fileB.txt) and locks the CHOSEN
// MITIGATION's behavior (a pathspec-limited `git commit -- fileA.txt` does
// not), directly satisfying AC1's stated fallback: lock the mitigation's
// behavior when a live-race reproduction is impractical.

import { describe, it, expect, afterAll } from 'vitest';
import { writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';

afterAll(() => cleanupAll());

/** Run a git command in `cwd`, throwing with stderr on non-zero exit. */
function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed (exit ${r.status}): ${r.stderr}`);
  }
  return r.stdout;
}

function initRepo(dir) {
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'dev@example.com']);
  git(dir, ['config', 'user.name', 'Test Dev']);
}

/** Files present in the most recent commit, via `git show --stat`. */
function filesInHead(dir) {
  const out = git(dir, ['show', '--stat', '--pretty=format:', 'HEAD']);
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.includes('|'))
    .map((l) => l.split('|')[0].trim());
}

describe('AC1/AC5 — shared-index commit hazard and pathspec-limited mitigation', () => {
  it('plain_commit_after_ad_hoc_add_sweeps_up_a_siblings_concurrently_staged_file', () => {
    const dir = makeTmpDir('git-index-hazard');
    initRepo(dir);

    const fileA = join(dir, 'fileA.txt');
    const fileB = join(dir, 'fileB.txt');
    writeFileSync(fileA, 'a-baseline\n');
    writeFileSync(fileB, 'b-baseline\n');
    git(dir, ['add', 'fileA.txt', 'fileB.txt']);
    git(dir, ['commit', '-q', '-m', 'baseline']);

    // Agent A edits its own file.
    appendFileSync(fileA, 'a-edit\n');
    // The sibling edits ITS own, disjoint file.
    appendFileSync(fileB, 'b-edit\n');

    // Agent A stages ONLY its own file, exactly as briefed pre-TASK-191.
    git(dir, ['add', 'fileA.txt']);
    // Sibling stages its own file in the same shared index in the window
    // before Agent A commits (this is the non-deterministic part of the
    // real incident, made deterministic here by sequencing it explicitly).
    git(dir, ['add', 'fileB.txt']);
    // Agent A commits with a PLAIN `git commit` (no pathspec) — the
    // pre-TASK-191 briefing shape.
    git(dir, ['commit', '-q', '-m', 'agent A: intended fileA.txt only']);

    const committed = filesInHead(dir);
    // THE HAZARD: the commit swept up the sibling's staged file too, despite
    // Agent A having run `git add` with only its own explicit path.
    expect(committed.sort()).toEqual(['fileA.txt', 'fileB.txt']);
  });

  it('pathspec_limited_commit_isolates_own_files_even_when_sibling_has_staged_work', () => {
    const dir = makeTmpDir('git-index-mitigation');
    initRepo(dir);

    const fileA = join(dir, 'fileA.txt');
    const fileB = join(dir, 'fileB.txt');
    writeFileSync(fileA, 'a-baseline\n');
    writeFileSync(fileB, 'b-baseline\n');
    git(dir, ['add', 'fileA.txt', 'fileB.txt']);
    git(dir, ['commit', '-q', '-m', 'baseline']);

    appendFileSync(fileA, 'a-edit\n');
    appendFileSync(fileB, 'b-edit\n');

    git(dir, ['add', 'fileA.txt']);
    // Sibling stages its own file in the same shared index window.
    git(dir, ['add', 'fileB.txt']);

    // THE MITIGATION (agents/developer.md's Git commit protocol): commit is
    // pathspec-limited to exactly the intended files, note `-m` before `--`.
    git(dir, ['commit', '-m', 'agent A: fileA.txt only, pathspec-limited', '--', 'fileA.txt']);

    const committed = filesInHead(dir);
    expect(committed).toEqual(['fileA.txt']);

    // The sibling's staged work is untouched (neither lost nor committed) —
    // it remains staged in the index, exactly as the sibling left it.
    const status = git(dir, ['status', '--porcelain']);
    expect(status).toContain('M  fileB.txt');

    // AC5's real mechanical content is the `expect(committed).toEqual(['fileA.txt'])`
    // assertion above, which IS `git show --stat`'s file list — the same call the
    // developer briefing's mandatory post-commit verification uses. (A prior
    // version of this spec also asserted fileA's on-disk content here, but that
    // check is near-vacuous — it cannot fail short of working-tree destruction —
    // so it has been dropped rather than left to overstate this spec's coverage.)
  });
});
