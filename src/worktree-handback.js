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
//      intact and visible in history.
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
//      deletes. removeMergedWorktree() is the one safe-disposal path this
//      module offers, and it refuses (throws) unless it can prove the
//      worktree's branch is fully merged and its working tree is clean — it
//      can never discard unique work.

import { spawnSync } from 'node:child_process';

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
 * Merge `branch` (a worktree's branch) into whatever is currently checked
 * out at `repoRoot`. Never resolves a conflict — aborts and reports instead.
 *
 * @param {{ repoRoot: string, branch: string, message?: string }} opts
 * @returns {{ merged: true, sha: string } | { merged: false, conflict: true, conflictedFiles: string[] }}
 */
export function mergeWorktreeBranch({ repoRoot, branch, message } = {}) {
  if (!repoRoot) throw makeErr('E_ARGS', 'mergeWorktreeBranch: repoRoot is required');
  if (!branch) throw makeErr('E_ARGS', 'mergeWorktreeBranch: branch is required');

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
  // mid-merge (see module doc comment, case 2).
  git(repoRoot, ['merge', '--abort']);

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

/** Parse `git worktree list --porcelain` output into [{ path, branch }]. */
function parseWorktreeList(porcelainOut) {
  const worktrees = [];
  let current = null;
  for (const line of porcelainOut.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current) worktrees.push(current);
      current = { path: line.slice('worktree '.length).trim(), branch: null };
    } else if (line.startsWith('branch ') && current) {
      current.branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '');
    }
  }
  if (current) worktrees.push(current);
  return worktrees;
}

/**
 * Report every worktree (other than the primary checkout) carrying either
 * commits not yet merged into `targetBranch`, or uncommitted working-tree
 * changes. Detection only — never deletes anything.
 *
 * @param {{ repoRoot: string, targetBranch?: string }} opts
 * @returns {Array<{ path: string, branch: string, unmergedCommits: number, dirty: boolean }>}
 */
export function detectOrphanedWorktrees({ repoRoot, targetBranch = 'HEAD' } = {}) {
  if (!repoRoot) throw makeErr('E_ARGS', 'detectOrphanedWorktrees: repoRoot is required');

  const listOut = runGitOrThrow(repoRoot, ['worktree', 'list', '--porcelain'], 'detectOrphanedWorktrees');
  const worktrees = parseWorktreeList(listOut);
  const primaryPath = worktrees[0]?.path;

  const orphans = [];
  for (const wt of worktrees) {
    if (wt.path === primaryPath) continue; // skip the primary checkout
    if (!wt.branch) continue; // detached worktree — out of scope here

    const aheadOut = git(repoRoot, ['rev-list', '--count', `${targetBranch}..${wt.branch}`]);
    const unmergedCommits = aheadOut.status === 0 ? (parseInt(aheadOut.stdout.trim(), 10) || 0) : 0;

    const dirtyOut = git(wt.path, ['status', '--porcelain']);
    const dirty = dirtyOut.status === 0 && dirtyOut.stdout.trim().length > 0;

    if (unmergedCommits > 0 || dirty) {
      orphans.push({ path: wt.path, branch: wt.branch, unmergedCommits, dirty });
    }
  }
  return orphans;
}

/**
 * Remove a worktree, but ONLY if its branch is fully merged into
 * `targetBranch` and its working tree is clean. Refuses (throws) otherwise —
 * the one disposal path this module offers, and it never discards unique
 * work.
 *
 * @param {{ repoRoot: string, worktreePath: string, branch: string, targetBranch?: string }} opts
 * @returns {void}
 */
export function removeMergedWorktree({ repoRoot, worktreePath, branch, targetBranch = 'HEAD' } = {}) {
  if (!repoRoot) throw makeErr('E_ARGS', 'removeMergedWorktree: repoRoot is required');
  if (!worktreePath) throw makeErr('E_ARGS', 'removeMergedWorktree: worktreePath is required');
  if (!branch) throw makeErr('E_ARGS', 'removeMergedWorktree: branch is required');

  const aheadOut = git(repoRoot, ['rev-list', '--count', `${targetBranch}..${branch}`]);
  const unmergedCommits = aheadOut.status === 0 ? (parseInt(aheadOut.stdout.trim(), 10) || 0) : 0;
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
