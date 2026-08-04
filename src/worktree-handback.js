// src/worktree-handback.js
// TASK-195 — Handback machinery for commits made inside an isolated
// `git worktree` (the Agent tool's `isolation: 'worktree'` option).
//
// Git worktrees share ONE object database but each has its own branch, index,
// and working tree — so a commit made inside a worktree already exists in the
// repo, on that worktree's own branch. "Handback" is therefore a normal git
// merge of that branch into the main line, performed by the ORCHESTRATOR
// after the spawned agent returns — never by the spawned agent itself, which
// has no visibility into siblings or the main line's current state.
//
// See skills/orchestrator-routing/SKILL.md's "Worktree isolation for
// concurrent developer spawns" section for the full policy (when to isolate,
// primary-vs-backstop framing against TASK-191's pathspec protocol). This
// module implements the three cases that section specifies:
//
//   1. mergeWorktreeBranch — how a worktree commit reaches the main line.
//      Merge, not rebase or cherry-pick: a rebase would rewrite the worktree
//      branch's commit SHAs, invalidating any hand-off report that already
//      names them; a cherry-pick risks silently dropping commits if the
//      wrong range is named. `git merge --no-ff` keeps the branch's commits
//      intact and visible in history. Refuses up front (E_MERGE_IN_PROGRESS)
//      if a merge is already parked in `repoRoot` — proceeding would
//      misattribute that unrelated merge's conflicts to this handback and
//      destroy it on abort (TASK-195 fix round, MEDIUM-1).
//
//   2. Conflict handling (inside mergeWorktreeBranch) — ABORT, never
//      resolve. The instant git reports a conflict, the merge is aborted
//      (`git merge --abort`) and a structured report is returned instead.
//      This is deliberate: an aborted merge leaves the main line clean, so a
//      stalled handback can never itself become a new shared-state hazard (a
//      conflicted tree left in place would block every subsequent commit,
//      by any agent, until resolved). Resolution is always a
//      terminate-then-retry decision for the Orchestrator or a human — this
//      module never auto-resolves and never picks a side. This is precisely
//      the same-path collision TASK-191's pathspec protocol left silent;
//      here it is surfaced instead of decided.
//
//   3. detectOrphanedWorktrees / removeMergedWorktree — an agent that dies
//      mid-work leaves a worktree with either unmerged commits or a dirty
//      working tree. detectOrphanedWorktrees() only reports; it never
//      deletes, and now also reports dirty DETACHED worktrees (branch: null)
//      rather than skipping them (TASK-195 fix round, MEDIUM-3).
//      removeMergedWorktree() is the one safe-disposal path this module
//      offers. It fails CLOSED rather than open: any git failure while
//      proving merged-ness throws rather than being read as "0 unmerged"
//      (HIGH-1), and it verifies the worktree's ACTUAL checked-out state via
//      `git worktree list --porcelain` instead of trusting the caller's
//      `branch` argument — refusing on a detached worktree or a branch
//      mismatch (HIGH-2) — before it ever runs the merged-ness check.
//      Residual caveat: gitignored untracked content in the worktree is
//      invisible to both `git status --porcelain` and git's own removal
//      check, so it is silently discarded on removal — this module cannot
//      see it either. "Never discards unique work" therefore excludes
//      gitignored content; see the SKILL prose for the same caveat.

import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';

function git(cwd, args) {
  return spawnSync('git', args, { cwd, encoding: 'utf8' });
}

function runGitOrThrow(cwd, args, label) {
  const r = git(cwd, args);
  if (r.status !== 0) {
    throw makeErr('E_GIT_FAILED', `${label}: git ${args.join(' ')} failed (exit ${r.status}): ${r.stderr}`);
  }
  return r.stdout;
}

function makeErr(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

/** Lines matching git's porcelain=v1 unmerged-entry codes (both sides touched the path). */
const UNMERGED_STATUS_RE = /^(UU|AA|DD|AU|UA|UD|DU) /;

/**
 * Count commits reachable from `branch` but not `targetBranch`, failing
 * CLOSED (throwing E_GIT_FAILED) if git cannot answer, rather than reading a
 * `rev-list` failure as "0 unmerged commits" — see the TASK-195 fix round's
 * HIGH-1 finding: an unresolvable `branch` (renamed/deleted) or a typo'd
 * `targetBranch` used to be silently coerced to zero, which is what let
 * removeMergedWorktree delete worktrees with real unmerged commits still on
 * them.
 */
function countUnmergedCommits(repoRoot, targetBranch, branch, label) {
  const aheadOut = git(repoRoot, ['rev-list', '--count', `${targetBranch}..${branch}`]);
  if (aheadOut.status !== 0) {
    throw makeErr(
      'E_GIT_FAILED',
      `${label}: git rev-list --count ${targetBranch}..${branch} failed (exit ${aheadOut.status}): ${aheadOut.stderr}`,
    );
  }
  const n = parseInt(aheadOut.stdout.trim(), 10);
  if (Number.isNaN(n)) {
    throw makeErr(
      'E_GIT_FAILED',
      `${label}: git rev-list --count ${targetBranch}..${branch} returned unparseable output: ${JSON.stringify(aheadOut.stdout)}`,
    );
  }
  return n;
}

/** Normalize a filesystem path for cross-representation comparison: resolve
 * symlinks / Windows 8.3 short names to the canonical long form, then use
 * forward slashes — `git worktree list --porcelain` reports forward-slash
 * paths even on Windows, and a caller-supplied path may be a backslash
 * `join()` result or an 8.3 short form from `os.tmpdir()`. Falls back to a
 * plain slash-normalized path if the target no longer exists on disk. */
function normalizeForCompare(p) {
  try {
    return realpathSync.native(p).replace(/\\/g, '/');
  } catch {
    return String(p).replace(/\\/g, '/');
  }
}

/** Parse `git worktree list --porcelain` output into [{ path, branch, detached }]. */
function parseWorktreeList(porcelainOut) {
  const worktrees = [];
  let current = null;
  for (const line of porcelainOut.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current) worktrees.push(current);
      current = { path: line.slice('worktree '.length).trim(), branch: null, detached: false };
    } else if (line.startsWith('branch ') && current) {
      current.branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '');
    } else if (line === 'detached' && current) {
      current.detached = true;
    }
  }
  if (current) worktrees.push(current);
  return worktrees;
}

/** Find the `git worktree list --porcelain` entry for `worktreePath`, ground
 * truth for what that worktree actually has checked out (TASK-195 fix round,
 * HIGH-2) — never trust a caller-supplied `branch` argument alone. */
function findWorktreeEntry(repoRoot, worktreePath, label) {
  const listOut = runGitOrThrow(repoRoot, ['worktree', 'list', '--porcelain'], label);
  const worktrees = parseWorktreeList(listOut);
  const target = normalizeForCompare(worktreePath);
  const entry = worktrees.find((wt) => normalizeForCompare(wt.path) === target);
  if (!entry) {
    throw makeErr(
      'E_WORKTREE_NOT_FOUND',
      `${label}: ${worktreePath} is not a worktree of the repo at ${repoRoot} (per git worktree list)`,
    );
  }
  return entry;
}

/**
 * Merge `branch` (a worktree's branch) into whatever is currently checked
 * out at `repoRoot`. Never resolves a conflict — aborts and reports instead.
 * Refuses up front if a merge is already in progress at `repoRoot`.
 *
 * @param {{ repoRoot: string, branch: string, message?: string }} opts
 * @returns {{ merged: true, sha: string } | { merged: false, conflict: true, conflictedFiles: string[] }}
 */
export function mergeWorktreeBranch({ repoRoot, branch, message } = {}) {
  if (!repoRoot) throw makeErr('E_ARGS', 'mergeWorktreeBranch: repoRoot is required');
  if (!branch) throw makeErr('E_ARGS', 'mergeWorktreeBranch: branch is required');

  // Refuse if a merge is already parked in `repoRoot` (TASK-195 fix round,
  // MEDIUM-1) — proceeding would attempt a merge on top of an unrelated
  // conflicted merge, misattribute ITS conflicted files to this handback,
  // and the abort below would destroy whatever partial resolution exists in
  // a merge this function did not start.
  const mergeHeadCheck = git(repoRoot, ['rev-parse', '--verify', '-q', 'MERGE_HEAD']);
  if (mergeHeadCheck.status === 0) {
    throw makeErr(
      'E_MERGE_IN_PROGRESS',
      `mergeWorktreeBranch: refusing to merge ${branch} into ${repoRoot} — a merge is already in progress ` +
      'there (MERGE_HEAD exists); resolve or abort it before handing back another branch',
    );
  }

  const args = ['merge', '--no-ff', branch];
  args.push('-m', message || `merge worktree branch ${branch}`);
  const r = git(repoRoot, args);

  if (r.status === 0) {
    const sha = runGitOrThrow(repoRoot, ['rev-parse', 'HEAD'], 'mergeWorktreeBranch').trim();
    return { merged: true, sha };
  }

  // Non-zero exit — determine whether this is a real content conflict (git
  // leaves conflict markers + unmerged index entries) via `git status`
  // rather than parsing locale-dependent stdout text.
  const statusOut = git(repoRoot, ['status', '--porcelain=v1']).stdout || '';
  const conflictedFiles = statusOut
    .split('\n')
    .filter((l) => UNMERGED_STATUS_RE.test(l))
    .map((l) => l.slice(3).trim());

  // Always abort — conflict or not — so the main line never ends up parked
  // mid-merge (see module doc comment, case 2). Check the abort's own exit
  // status instead of discarding it (TASK-195 fix round, MEDIUM-1): a failed
  // abort must be surfaced, not silently swallowed while a half-merged state
  // is left behind.
  const abortResult = git(repoRoot, ['merge', '--abort']);
  if (abortResult.status !== 0) {
    throw makeErr(
      'E_MERGE_ABORT_FAILED',
      `mergeWorktreeBranch: merge of ${branch} failed and \`git merge --abort\` itself failed (exit ` +
      `${abortResult.status}): ${abortResult.stderr} — ${repoRoot} may be left mid-merge; manual intervention required`,
    );
  }

  if (conflictedFiles.length > 0) {
    return { merged: false, conflict: true, conflictedFiles };
  }

  // Not a content conflict (e.g. unknown branch, dirty target tree) —
  // surface the real git failure rather than mislabeling it a conflict.
  throw makeErr(
    'E_MERGE_FAILED',
    `mergeWorktreeBranch: git merge ${branch} failed for a reason other than a content conflict: ${r.stderr}`,
  );
}

/**
 * Report every worktree (other than the primary checkout) carrying either
 * commits not yet merged into `targetBranch`, or uncommitted working-tree
 * changes — including a DETACHED worktree with a dirty working tree
 * (reported with `branch: null`; TASK-195 fix round, MEDIUM-3). Detection
 * only — never deletes anything. Fails CLOSED (throws E_GIT_FAILED) if git
 * cannot determine a branch's ahead-count, rather than under-reporting.
 *
 * @param {{ repoRoot: string, targetBranch?: string }} opts
 * @returns {Array<{ path: string, branch: string | null, unmergedCommits: number, dirty: boolean }>}
 */
export function detectOrphanedWorktrees({ repoRoot, targetBranch = 'HEAD' } = {}) {
  if (!repoRoot) throw makeErr('E_ARGS', 'detectOrphanedWorktrees: repoRoot is required');

  const listOut = runGitOrThrow(repoRoot, ['worktree', 'list', '--porcelain'], 'detectOrphanedWorktrees');
  const worktrees = parseWorktreeList(listOut);
  const primaryPath = worktrees[0]?.path;

  const orphans = [];
  for (const wt of worktrees) {
    if (wt.path === primaryPath) continue; // skip the primary checkout

    // A detached worktree has no branch to rank against targetBranch, so its
    // ahead-count is always 0 — but unlike before, it is NOT skipped
    // outright: the dirty check below needs no branch, so a crashed agent
    // left in detached HEAD with uncommitted changes is still found.
    const unmergedCommits = wt.branch
      ? countUnmergedCommits(repoRoot, targetBranch, wt.branch, 'detectOrphanedWorktrees')
      : 0;

    const dirtyOut = git(wt.path, ['status', '--porcelain']);
    const dirty = dirtyOut.status === 0 && dirtyOut.stdout.trim().length > 0;

    if (unmergedCommits > 0 || dirty) {
      orphans.push({ path: wt.path, branch: wt.branch, unmergedCommits, dirty });
    }
  }
  return orphans;
}

/**
 * Remove a worktree, but ONLY if its ACTUAL checked-out branch matches
 * `branch`, that branch is fully merged into `targetBranch`, and its working
 * tree is clean. Refuses (throws) otherwise.
 *
 * `targetBranch` has NO default (TASK-195 fix round, MEDIUM-4) — this is a
 * destructive operation and must not silently bind to whatever the primary
 * checkout happens to have checked out; the caller must state its intent.
 *
 * Caveat: gitignored untracked content in the worktree is invisible to
 * `git status --porcelain` and to git's own removal check, so it is
 * silently discarded on removal. This function cannot see it either — "it
 * never discards unique work" does not cover gitignored content.
 *
 * @param {{ repoRoot: string, worktreePath: string, branch: string, targetBranch: string }} opts
 * @returns {void}
 */
export function removeMergedWorktree({ repoRoot, worktreePath, branch, targetBranch } = {}) {
  if (!repoRoot) throw makeErr('E_ARGS', 'removeMergedWorktree: repoRoot is required');
  if (!worktreePath) throw makeErr('E_ARGS', 'removeMergedWorktree: worktreePath is required');
  if (!branch) throw makeErr('E_ARGS', 'removeMergedWorktree: branch is required');
  if (!targetBranch) {
    throw makeErr(
      'E_ARGS',
      "removeMergedWorktree: targetBranch is required (no default) — this destructive operation must not " +
      "silently bind to whatever the primary checkout happens to have checked out; pass the intended target " +
      "explicitly, e.g. targetBranch: 'HEAD' if that really is the intent",
    );
  }

  // Verify the worktree's ACTUAL checked-out state instead of trusting the
  // caller's `branch` claim (TASK-195 fix round, HIGH-2) — `git worktree
  // list --porcelain` is ground truth and this module already parses it.
  const entry = findWorktreeEntry(repoRoot, worktreePath, 'removeMergedWorktree');
  if (entry.detached) {
    throw makeErr(
      'E_WORKTREE_DETACHED',
      `removeMergedWorktree: refusing to remove ${worktreePath} — it is in detached HEAD state, not on a ` +
      `branch, so the claim that branch ${branch} is merged cannot be verified against what this worktree ` +
      'actually has checked out',
    );
  }
  if (entry.branch !== branch) {
    throw makeErr(
      'E_WORKTREE_BRANCH_MISMATCH',
      `removeMergedWorktree: refusing to remove ${worktreePath} — it has ${entry.branch} checked out, not ` +
      `the claimed ${branch}; the merged-ness check would have run against the wrong branch`,
    );
  }

  // Fails CLOSED (throws E_GIT_FAILED) rather than treating a git failure as
  // zero unmerged commits (TASK-195 fix round, HIGH-1).
  const unmergedCommits = countUnmergedCommits(repoRoot, targetBranch, branch, 'removeMergedWorktree');
  if (unmergedCommits > 0) {
    throw makeErr(
      'E_WORKTREE_UNMERGED',
      `removeMergedWorktree: refusing to remove ${worktreePath} — branch ${branch} has ` +
      `${unmergedCommits} commit(s) not yet merged into ${targetBranch}`,
    );
  }

  const dirtyOut = git(worktreePath, ['status', '--porcelain']);
  if (dirtyOut.status !== 0 || dirtyOut.stdout.trim().length > 0) {
    throw makeErr(
      'E_WORKTREE_DIRTY',
      `removeMergedWorktree: refusing to remove ${worktreePath} — working tree is dirty or unreadable`,
    );
  }

  runGitOrThrow(repoRoot, ['worktree', 'remove', worktreePath], 'removeMergedWorktree');

}
