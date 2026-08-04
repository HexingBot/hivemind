// tests/e2e/git-worktree-handback.spec.js
// TASK-195 — Worktree isolation for concurrent developer spawns.
//
// AC5: follow the precedent of tests/e2e/git-pathspec-commit-isolation.spec.js
// (which reproduces the shared-index hazard and locks TASK-191's pathspec
// mitigation). This spec reproduces the ANALOGOUS demonstration for worktree
// isolation against real git in a temp repo: two worktrees, staging and
// committing different files in each, asserting the commits did NOT capture
// each other's staged work — i.e. the index is genuinely not shared (unlike
// the single-shared-tree case git-pathspec-commit-isolation.spec.js covers).
// It also locks src/worktree-handback.js's three handback cases (merge,
// conflict, orphan detection/disposal) against real git.

import { describe, it, expect, afterAll } from 'vitest';
import { writeFileSync, appendFileSync, existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';
import { mergeWorktreeBranch, detectOrphanedWorktrees, removeMergedWorktree } from '../../src/worktree-handback.js';

afterAll(() => cleanupAll());

/** Run a git command in `cwd`, throwing with stderr on non-zero exit. */
function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed (exit ${r.status}): ${r.stderr}`);
  }
  return r.stdout;
}

/** Normalize a path for cross-representation comparison: Windows can hand
 * back an 8.3 short form (`RAFAEL~1`) from `os.tmpdir()` while `git worktree
 * list` reports the resolved long form with forward slashes — realpath +
 * slash normalization makes the two comparable. */
function toPosix(p) {
  // realpathSync.native (not the plain JS realpathSync) is required on
  // Windows to expand an 8.3 short-name component (e.g. `RAFAEL~1`) — which
  // `os.tmpdir()` can hand back — to the long form git itself reports.
  return realpathSync.native(p).replace(/\\/g, '/');
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

describe('AC5 — worktree isolation genuinely does not share one index', () => {
  it('committing_in_one_worktree_does_not_capture_a_siblings_staged_work_in_another_worktree', () => {
    const dir = makeTmpDir('wt-index-isolation');
    initRepo(dir);

    // Baseline commit on the primary checkout.
    writeFileSync(join(dir, 'baseline.txt'), 'baseline\n');
    git(dir, ['add', 'baseline.txt']);
    git(dir, ['commit', '-q', '-m', 'baseline']);

    // Two isolated worktrees, each on its own new branch off the baseline —
    // this is what the Agent tool's isolation: 'worktree' option gives each
    // concurrent developer spawn.
    const wtA = join(makeTmpDir('wt-a-parent'), 'wt-a');
    const wtB = join(makeTmpDir('wt-b-parent'), 'wt-b');
    git(dir, ['worktree', 'add', '-b', 'agent-a', wtA]);
    git(dir, ['worktree', 'add', '-b', 'agent-b', wtB]);

    // Agent A stages its own file...
    writeFileSync(join(wtA, 'fileA.txt'), 'a-content\n');
    git(wtA, ['add', 'fileA.txt']);
    // ...and in the same window, agent B stages ITS own, disjoint file in ITS
    // OWN worktree (the analogue of the TASK-191 incident's interleaving,
    // now happening in separate working trees rather than one shared tree).
    writeFileSync(join(wtB, 'fileB.txt'), 'b-content\n');
    git(wtB, ['add', 'fileB.txt']);

    // Agent A commits with a PLAIN `git commit` — no pathspec discipline at
    // all. Under the pre-TASK-191 shared-index hazard this exact sequence
    // swept up the sibling's staged file (see git-pathspec-commit-isolation
    // .spec.js's first test). Here it must NOT, because wtA and wtB each
    // have their own index.
    git(wtA, ['commit', '-q', '-m', 'agent A: fileA.txt only, plain commit']);

    const committedInA = filesInHead(wtA);
    expect(committedInA).toEqual(['fileA.txt']);

    // Agent B's staged file is untouched — still staged in B's own worktree,
    // never committed, never observed by A's commit.
    const statusB = git(wtB, ['status', '--porcelain']);
    expect(statusB).toContain('A  fileB.txt');

    // Commit B too, to set up the handback tests below.
    git(wtB, ['commit', '-q', '-m', 'agent B: fileB.txt only, plain commit']);
    const committedInB = filesInHead(wtB);
    expect(committedInB).toEqual(['fileB.txt']);
  });
});

describe('AC2 — mergeWorktreeBranch: handback path (non-conflicting)', () => {
  it('merges_a_worktree_branch_into_the_primary_checkout_cleanly', () => {
    const dir = makeTmpDir('wt-merge-clean');
    initRepo(dir);
    writeFileSync(join(dir, 'baseline.txt'), 'baseline\n');
    git(dir, ['add', 'baseline.txt']);
    git(dir, ['commit', '-q', '-m', 'baseline']);

    const wt = join(makeTmpDir('wt-merge-clean-wt'), 'wt');
    git(dir, ['worktree', 'add', '-b', 'agent-a', wt]);
    writeFileSync(join(wt, 'fileA.txt'), 'a-content\n');
    git(wt, ['add', 'fileA.txt']);
    git(wt, ['commit', '-q', '-m', 'agent A: add fileA']);

    const result = mergeWorktreeBranch({ repoRoot: dir, branch: 'agent-a', message: 'handback: agent-a' });

    expect(result.merged).toBe(true);
    expect(typeof result.sha).toBe('string');
    expect(existsSync(join(dir, 'fileA.txt'))).toBe(true);

    // The primary checkout's status is clean after a successful merge.
    const status = git(dir, ['status', '--porcelain']);
    expect(status.trim()).toBe('');
  });
});

describe('AC2/AC3 — mergeWorktreeBranch: conflict is surfaced, never auto-resolved', () => {
  it('a_same_path_collision_aborts_the_merge_and_reports_the_conflicted_file_instead_of_picking_a_side', () => {
    const dir = makeTmpDir('wt-merge-conflict');
    initRepo(dir);
    writeFileSync(join(dir, 'shared.txt'), 'line1\n');
    git(dir, ['add', 'shared.txt']);
    git(dir, ['commit', '-q', '-m', 'baseline']);

    const wtA = join(makeTmpDir('wt-conflict-a'), 'wt');
    const wtB = join(makeTmpDir('wt-conflict-b'), 'wt');
    git(dir, ['worktree', 'add', '-b', 'agent-a', wtA]);
    git(dir, ['worktree', 'add', '-b', 'agent-b', wtB]);

    // Both agents independently edit the SAME line of the SAME file — the
    // exact same-path collision the pathspec protocol alone cannot detect.
    appendFileSync(join(wtA, 'shared.txt'), 'a-edit\n');
    git(wtA, ['add', 'shared.txt']);
    git(wtA, ['commit', '-q', '-m', 'agent A: edit shared.txt']);

    appendFileSync(join(wtB, 'shared.txt'), 'b-edit\n');
    git(wtB, ['add', 'shared.txt']);
    git(wtB, ['commit', '-q', '-m', 'agent B: edit shared.txt']);

    // Merge A first — clean, no conflict yet.
    const mergeA = mergeWorktreeBranch({ repoRoot: dir, branch: 'agent-a', message: 'handback: agent-a' });
    expect(mergeA.merged).toBe(true);

    // Merge B now collides with A's already-landed edit on the same line.
    const mergeB = mergeWorktreeBranch({ repoRoot: dir, branch: 'agent-b', message: 'handback: agent-b' });

    expect(mergeB.merged).toBe(false);
    expect(mergeB.conflict).toBe(true);
    expect(mergeB.conflictedFiles).toEqual(['shared.txt']);

    // The primary checkout is left CLEAN, not parked mid-conflict — no
    // lingering MERGE_HEAD, no conflict markers blocking the next commit.
    expect(existsSync(join(dir, '.git', 'MERGE_HEAD'))).toBe(false);
    const status = git(dir, ['status', '--porcelain']);
    expect(status.trim()).toBe('');

    // B's own commit is untouched on its own branch — nothing was resolved
    // or discarded, only reported.
    const bLog = git(dir, ['log', '-1', '--format=%s', 'agent-b']);
    expect(bLog.trim()).toBe('agent B: edit shared.txt');
  });
});

describe('AC2 — detectOrphanedWorktrees and removeMergedWorktree: orphan handling', () => {
  it('flags_a_worktree_with_unmerged_commits_and_a_worktree_with_uncommitted_changes_but_not_a_clean_merged_one', () => {
    const dir = makeTmpDir('wt-orphans');
    initRepo(dir);
    writeFileSync(join(dir, 'baseline.txt'), 'baseline\n');
    git(dir, ['add', 'baseline.txt']);
    git(dir, ['commit', '-q', '-m', 'baseline']);

    // Orphan 1: committed work never merged back (the agent died right
    // after committing, before handback happened). Tmp-dir labels
    // deliberately avoid the words "unmerged"/"dirty"/"clean" — the mkdtemp
    // path is embedded verbatim in git's own error text, and an assertion
    // that regex-matches error MESSAGES against those same words would
    // pass on the path text alone even if the real guard were removed (this
    // was caught live by this ticket's red-green plant; see the hand-off).
    // Assertions below key off the module's `err.code` instead.
    const wtUnmerged = join(makeTmpDir('wt-orphan-1'), 'wt');
    git(dir, ['worktree', 'add', '-b', 'agent-unmerged', wtUnmerged]);
    writeFileSync(join(wtUnmerged, 'orphan.txt'), 'orphaned work\n');
    git(wtUnmerged, ['add', 'orphan.txt']);
    git(wtUnmerged, ['commit', '-q', '-m', 'agent: unmerged orphan commit']);

    // Orphan 2: uncommitted working tree, nothing committed at all (the
    // agent died mid-edit).
    const wtDirty = join(makeTmpDir('wt-orphan-2'), 'wt');
    git(dir, ['worktree', 'add', '-b', 'agent-dirty', wtDirty]);
    writeFileSync(join(wtDirty, 'dirty.txt'), 'uncommitted\n');
    git(wtDirty, ['add', 'dirty.txt']);
    // No commit — left dirty.

    // A well-behaved worktree: committed AND merged AND clean.
    const wtClean = join(makeTmpDir('wt-orphan-3'), 'wt');
    git(dir, ['worktree', 'add', '-b', 'agent-clean', wtClean]);
    writeFileSync(join(wtClean, 'clean.txt'), 'delivered\n');
    git(wtClean, ['add', 'clean.txt']);
    git(wtClean, ['commit', '-q', '-m', 'agent: delivered work']);
    const mergeClean = mergeWorktreeBranch({ repoRoot: dir, branch: 'agent-clean', message: 'handback: agent-clean' });
    expect(mergeClean.merged).toBe(true);

    const orphans = detectOrphanedWorktrees({ repoRoot: dir });
    const orphanPaths = orphans.map((o) => o.path.replace(/\\/g, '/'));

    const wtUnmergedPosix = toPosix(wtUnmerged);
    const wtDirtyPosix = toPosix(wtDirty);
    const wtCleanPosix = toPosix(wtClean);

    expect(orphanPaths).toContain(wtUnmergedPosix);
    expect(orphanPaths).toContain(wtDirtyPosix);
    expect(orphanPaths).not.toContain(wtCleanPosix);

    const unmergedEntry = orphans.find((o) => o.path.replace(/\\/g, '/') === wtUnmergedPosix);
    expect(unmergedEntry.unmergedCommits).toBeGreaterThan(0);
    expect(unmergedEntry.dirty).toBe(false);

    const dirtyEntry = orphans.find((o) => o.path.replace(/\\/g, '/') === wtDirtyPosix);
    expect(dirtyEntry.dirty).toBe(true);

    // removeMergedWorktree refuses the unmerged orphan (would discard work) —
    // asserted via err.code, not a message regex (see the comment above the
    // tmp-dir labels for why a message regex is unreliable here).
    let unmergedThrown = null;
    try {
      removeMergedWorktree({ repoRoot: dir, worktreePath: wtUnmerged, branch: 'agent-unmerged', targetBranch: 'HEAD' });
    } catch (e) {
      unmergedThrown = e;
    }
    expect(unmergedThrown).not.toBeNull();
    expect(unmergedThrown.code).toBe('E_WORKTREE_UNMERGED');

    // ...and refuses the dirty orphan (would discard uncommitted work).
    let dirtyThrown = null;
    try {
      removeMergedWorktree({ repoRoot: dir, worktreePath: wtDirty, branch: 'agent-dirty', targetBranch: 'HEAD' });
    } catch (e) {
      dirtyThrown = e;
    }
    expect(dirtyThrown).not.toBeNull();
    expect(dirtyThrown.code).toBe('E_WORKTREE_DIRTY');

    // ...but succeeds for the clean, fully-merged worktree.
    removeMergedWorktree({ repoRoot: dir, worktreePath: wtClean, branch: 'agent-clean', targetBranch: 'HEAD' });
    const listAfter = git(dir, ['worktree', 'list']);
    // MEDIUM-2 (TASK-195 fix round): assert against wtCleanPosix — computed
    // above BEFORE removal, since realpath fails once the directory is gone
    // — not the raw backslash `join()` path. `git worktree list` reports
    // forward-slash paths even on Windows (confirmed by attack A11), so the
    // raw path never appears in `listAfter` whether or not removal
    // happened; that made this assertion pass vacuously either way.
    expect(listAfter).not.toContain(wtCleanPosix);
  });
});

// ---------------------------------------------------------------------------
// TASK-195 fix round — REQUEST-CHANGES attack replays.
//
// Each block below replays one attack from the review's full-depth battery
// (see the orchestrator comment on tasks/TASK-195.json) against the SAME
// module, asserting the fix's outcome: refusal, not deletion/destruction.
// Every assertion keys off `err.code`, never a message regex or a raw
// backslash path (per MEDIUM-2's lesson, applied here too).
// ---------------------------------------------------------------------------

describe('HIGH-1 (A6) — removeMergedWorktree fails CLOSED, not open, on a typo\'d targetBranch', () => {
  it('throws_E_GIT_FAILED_instead_of_treating_an_unresolvable_targetBranch_as_zero_unmerged_commits', () => {
    const dir = makeTmpDir('wt-attack-a6');
    initRepo(dir);
    writeFileSync(join(dir, 'baseline.txt'), 'baseline\n');
    git(dir, ['add', 'baseline.txt']);
    git(dir, ['commit', '-q', '-m', 'baseline']);

    const wt = join(makeTmpDir('wt-attack-a6-wt'), 'wt');
    git(dir, ['worktree', 'add', '-b', 'agent-a6', wt]);
    writeFileSync(join(wt, 'unmerged.txt'), 'never landed\n');
    git(wt, ['add', 'unmerged.txt']);
    git(wt, ['commit', '-q', '-m', 'unmerged work']);
    const wtPosix = toPosix(wt);

    // `branch` matches what the worktree actually has checked out — this
    // isolates HIGH-1 (the rev-list fail-open defect) from HIGH-2 (the
    // actual-state-verification defect), which A4 below exercises instead.
    let thrown = null;
    try {
      removeMergedWorktree({
        repoRoot: dir,
        worktreePath: wt,
        branch: 'agent-a6',
        targetBranch: 'definitely-not-a-real-branch-mian',
      });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).not.toBeNull();
    expect(thrown.code).toBe('E_GIT_FAILED');

    // Refused, not deleted.
    const listAfter = git(dir, ['worktree', 'list']);
    expect(listAfter).toContain(wtPosix);
  });
});

describe('HIGH-1 (detectOrphanedWorktrees) — fails CLOSED on a git rev-list failure instead of under-reporting', () => {
  it('throws_E_GIT_FAILED_when_targetBranch_does_not_resolve_instead_of_silently_finding_nothing', () => {
    const dir = makeTmpDir('wt-attack-detect-failclosed');
    initRepo(dir);
    writeFileSync(join(dir, 'baseline.txt'), 'baseline\n');
    git(dir, ['add', 'baseline.txt']);
    git(dir, ['commit', '-q', '-m', 'baseline']);

    const wt = join(makeTmpDir('wt-attack-detect-wt'), 'wt');
    git(dir, ['worktree', 'add', '-b', 'agent-x', wt]);
    writeFileSync(join(wt, 'unmerged.txt'), 'never landed\n');
    git(wt, ['add', 'unmerged.txt']);
    git(wt, ['commit', '-q', '-m', 'unmerged work']);

    let thrown = null;
    try {
      detectOrphanedWorktrees({ repoRoot: dir, targetBranch: 'definitely-not-a-real-branch' });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).not.toBeNull();
    expect(thrown.code).toBe('E_GIT_FAILED');
  });
});

describe('HIGH-2 (A4) — removeMergedWorktree verifies actual checked-out state, catching a post-creation branch rename', () => {
  it('throws_E_WORKTREE_BRANCH_MISMATCH_when_the_branch_was_renamed_after_the_caller_captured_the_old_name', () => {
    const dir = makeTmpDir('wt-attack-a4');
    initRepo(dir);
    writeFileSync(join(dir, 'baseline.txt'), 'baseline\n');
    git(dir, ['add', 'baseline.txt']);
    git(dir, ['commit', '-q', '-m', 'baseline']);

    const wt = join(makeTmpDir('wt-attack-a4-wt'), 'wt');
    git(dir, ['worktree', 'add', '-b', 'agent-original-name', wt]);
    writeFileSync(join(wt, 'unmerged.txt'), 'never landed\n');
    git(wt, ['add', 'unmerged.txt']);
    git(wt, ['commit', '-q', '-m', 'unmerged work']);
    const wtPosix = toPosix(wt);

    // Branch renamed after the worktree (and the caller's captured branch
    // name) existed — git updates the worktree's own checkout to the new
    // name, so the old name the caller still holds no longer matches what
    // is actually checked out there.
    git(wt, ['branch', '-m', 'agent-original-name', 'agent-renamed']);

    let thrown = null;
    try {
      removeMergedWorktree({ repoRoot: dir, worktreePath: wt, branch: 'agent-original-name', targetBranch: 'HEAD' });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).not.toBeNull();
    // Caught by the HIGH-2 actual-state check before the HIGH-1 rev-list
    // check is even reached — defense in depth: the old name no longer
    // resolves at all, but the mismatch is detected first.
    expect(thrown.code).toBe('E_WORKTREE_BRANCH_MISMATCH');

    const listAfter = git(dir, ['worktree', 'list']);
    expect(listAfter).toContain(wtPosix);
  });
});

describe('HIGH-2 (A1) — removeMergedWorktree refuses a detached-HEAD worktree instead of deleting a unique commit', () => {
  it('throws_E_WORKTREE_DETACHED_and_leaves_the_unique_commit_reachable', () => {
    const dir = makeTmpDir('wt-attack-a1');
    initRepo(dir);
    writeFileSync(join(dir, 'baseline.txt'), 'baseline\n');
    git(dir, ['add', 'baseline.txt']);
    git(dir, ['commit', '-q', '-m', 'baseline']);

    // A branch that IS fully merged (points at the same commit as HEAD),
    // used as the caller's claimed `branch` argument — isolates the
    // detached-state defect from the unrelated unmerged-commits check.
    git(dir, ['branch', 'looks-merged']);

    const headSha = git(dir, ['rev-parse', 'HEAD']).trim();
    const wt = join(makeTmpDir('wt-attack-a1-wt'), 'wt');
    git(dir, ['worktree', 'add', '--detach', wt, headSha]);
    const wtPosix = toPosix(wt);

    // A commit reachable from NOTHING except this detached worktree's HEAD.
    writeFileSync(join(wt, 'unique.txt'), 'only lives here\n');
    git(wt, ['add', 'unique.txt']);
    git(wt, ['commit', '-q', '-m', 'unique detached commit']);
    const uniqueSha = git(wt, ['rev-parse', 'HEAD']).trim();

    let thrown = null;
    try {
      removeMergedWorktree({ repoRoot: dir, worktreePath: wt, branch: 'looks-merged', targetBranch: 'HEAD' });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).not.toBeNull();
    expect(thrown.code).toBe('E_WORKTREE_DETACHED');

    // Refused, not deleted — the worktree is still present...
    const listAfter = git(dir, ['worktree', 'list']);
    expect(listAfter).toContain(wtPosix);
    // ...and the unique commit is still reachable (nothing was lost).
    const catFileOut = git(wt, ['cat-file', '-e', uniqueSha]);
    expect(catFileOut).toBe('');
  });
});

describe('HIGH-2 (A7/A12) — removeMergedWorktree refuses when the worktree\'s real branch differs from the claim', () => {
  it('throws_E_WORKTREE_BRANCH_MISMATCH_instead_of_deleting_a_worktree_with_real_unmerged_commits', () => {
    const dir = makeTmpDir('wt-attack-a7');
    initRepo(dir);
    writeFileSync(join(dir, 'baseline.txt'), 'baseline\n');
    git(dir, ['add', 'baseline.txt']);
    git(dir, ['commit', '-q', '-m', 'baseline']);

    // A branch that IS fully merged, distinct from the worktree's real branch.
    git(dir, ['branch', 'looks-merged']);

    const wtReal = join(makeTmpDir('wt-attack-a7-wt'), 'wt');
    git(dir, ['worktree', 'add', '-b', 'agent-real', wtReal]);
    writeFileSync(join(wtReal, 'unmerged.txt'), 'never landed\n');
    git(wtReal, ['add', 'unmerged.txt']);
    git(wtReal, ['commit', '-q', '-m', 'unmerged work']);
    const wtRealPosix = toPosix(wtReal);

    // Caller claims (wrongly, whether by stale state or typo) that this
    // worktree is on the already-merged branch.
    let thrown = null;
    try {
      removeMergedWorktree({ repoRoot: dir, worktreePath: wtReal, branch: 'looks-merged', targetBranch: 'HEAD' });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).not.toBeNull();
    expect(thrown.code).toBe('E_WORKTREE_BRANCH_MISMATCH');

    const listAfter = git(dir, ['worktree', 'list']);
    expect(listAfter).toContain(wtRealPosix);
  });
});

describe('MEDIUM-1 (A10) — mergeWorktreeBranch refuses when a merge is already parked, instead of misattributing or destroying it', () => {
  it('throws_E_MERGE_IN_PROGRESS_and_leaves_the_pre_existing_parked_merge_untouched', () => {
    const dir = makeTmpDir('wt-attack-a10');
    initRepo(dir);
    writeFileSync(join(dir, 'base.txt'), 'base\n');
    git(dir, ['add', 'base.txt']);
    git(dir, ['commit', '-q', '-m', 'baseline']);
    const defaultBranch = git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();

    // Two branches that diverge on base.txt.
    git(dir, ['branch', 'primary-conflict-b']);
    git(dir, ['checkout', '-q', 'primary-conflict-b']);
    writeFileSync(join(dir, 'base.txt'), 'b version\n');
    git(dir, ['commit', '-q', '-am', 'b edits base.txt']);
    git(dir, ['checkout', '-q', defaultBranch]);
    writeFileSync(join(dir, 'base.txt'), 'default version\n');
    git(dir, ['commit', '-q', '-am', 'default edits base.txt']);

    // Park an UNRELATED conflicted merge directly in the primary checkout —
    // nothing to do with any worktree handback — and leave it unresolved.
    const conflictResult = spawnSync('git', ['merge', 'primary-conflict-b'], { cwd: dir, encoding: 'utf8' });
    expect(conflictResult.status).not.toBe(0);
    expect(existsSync(join(dir, '.git', 'MERGE_HEAD'))).toBe(true);

    // A worktree with an entirely unrelated file, never touching base.txt.
    const wt = join(makeTmpDir('wt-attack-a10-wt'), 'wt');
    git(dir, ['worktree', 'add', '-b', 'agent-c', wt]);
    writeFileSync(join(wt, 'other.txt'), 'other content\n');
    git(wt, ['add', 'other.txt']);
    git(wt, ['commit', '-q', '-m', 'agent C: add other.txt only']);

    let thrown = null;
    try {
      mergeWorktreeBranch({ repoRoot: dir, branch: 'agent-c', message: 'handback: agent-c' });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).not.toBeNull();
    expect(thrown.code).toBe('E_MERGE_IN_PROGRESS');

    // The PRE-EXISTING parked merge must be untouched — not aborted, not
    // resolved, not blamed on a file the handback branch never touched.
    expect(existsSync(join(dir, '.git', 'MERGE_HEAD'))).toBe(true);
    const status = git(dir, ['status', '--porcelain']);
    expect(status).toContain('UU base.txt');
    expect(status).not.toContain('other.txt');
  });
});

describe('MEDIUM-3 (A9) — detectOrphanedWorktrees sees a dirty DETACHED worktree instead of being blind to it', () => {
  it('reports_a_dirty_detached_worktree_with_branch_null', () => {
    const dir = makeTmpDir('wt-attack-a9');
    initRepo(dir);
    writeFileSync(join(dir, 'baseline.txt'), 'baseline\n');
    git(dir, ['add', 'baseline.txt']);
    git(dir, ['commit', '-q', '-m', 'baseline']);

    const headSha = git(dir, ['rev-parse', 'HEAD']).trim();
    const wt = join(makeTmpDir('wt-attack-a9-wt'), 'wt');
    git(dir, ['worktree', 'add', '--detach', wt, headSha]);
    const wtPosix = toPosix(wt);

    // Agent crashed mid-edit, detached HEAD, uncommitted change — never
    // committed, so no branch anywhere points at this state.
    writeFileSync(join(wt, 'crash.txt'), 'mid-edit\n');
    git(wt, ['add', 'crash.txt']);

    const orphans = detectOrphanedWorktrees({ repoRoot: dir });
    const entry = orphans.find((o) => o.path.replace(/\\/g, '/') === wtPosix);

    expect(entry).toBeDefined();
    expect(entry.branch).toBeNull();
    expect(entry.dirty).toBe(true);
  });
});

describe('MEDIUM-4 — removeMergedWorktree requires targetBranch explicitly, no silent ambient-HEAD default', () => {
  it('throws_E_ARGS_when_targetBranch_is_omitted', () => {
    const dir = makeTmpDir('wt-attack-medium4');
    initRepo(dir);
    writeFileSync(join(dir, 'baseline.txt'), 'baseline\n');
    git(dir, ['add', 'baseline.txt']);
    git(dir, ['commit', '-q', '-m', 'baseline']);

    const wt = join(makeTmpDir('wt-attack-medium4-wt'), 'wt');
    git(dir, ['worktree', 'add', '-b', 'agent-medium4', wt]);

    let thrown = null;
    try {
      removeMergedWorktree({ repoRoot: dir, worktreePath: wt, branch: 'agent-medium4' });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).not.toBeNull();
    expect(thrown.code).toBe('E_ARGS');
  });
});
