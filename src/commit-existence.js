// src/commit-existence.js
// TASK-234 (WG-H-011, wargaming 2026-09-16) — "does this sha actually exist in
// this repo", answered with THREE outcomes and never two.
//
// Before this module, `closeTask` validated linked_commits for SHAPE only
// (/^[0-9a-f]{7,40}$/i), so an invented-but-well-formed sha satisfied the
// close evidence a reader later takes as proof the work landed. The obvious
// fix — "reject a sha git cannot resolve" — is a TRAP on its own: git is
// legitimately unable to answer in a sandbox with no git binary, in a plain
// mkdtemp fixture that is not a work tree, in a shallow clone, or when the
// commit lives in a sibling repo. Collapsing that into "missing" would reject
// legitimate closes; collapsing it into "present" is exactly the silent
// acceptance WG-H-011 measured. So the contract (CLAUDE.md's Empty-result
// contract, TASK-192) is three states, always distinguishable by the caller:
//
//   'verified'     — git ran and resolved the sha to a commit object.
//   'not-found'    — git ran, in a real work tree, and said no such commit.
//   'unverifiable' — git could not answer at all; carries a `reason`.
//
// Never throws: a verification helper that throws on a missing git binary
// would turn "cannot know" into a hard failure of the operation it advises.

import { execFileSync } from 'node:child_process';

export const COMMIT_STATE = {
  VERIFIED: 'verified',
  NOT_FOUND: 'not-found',
  UNVERIFIABLE: 'unverifiable',
};

/**
 * Resolve every sha in `shas` against the git repository at `repoRoot`.
 *
 * @param {string} repoRoot
 * @param {string[]} shas
 * @returns {{checked: boolean, reason: string|null, commits: Array<{sha: string, state: string, reason: string|null}>}}
 *   `checked: false` always carries a `reason` naming WHY nothing could be
 *   resolved ('none-linked' — nothing to check, not an error; 'git-unavailable'
 *   — no git binary on PATH; 'not-a-git-repo' — repoRoot is not inside a work
 *   tree), and every sha in `commits` is then state 'unverifiable' carrying
 *   that same reason. `checked: true` partitions every input sha into
 *   'verified' / 'not-found'.
 */
export function verifyCommitExistence(repoRoot, shas) {
  const list = Array.isArray(shas) ? shas.filter((s) => typeof s === 'string') : [];
  if (list.length === 0) {
    return { checked: false, reason: 'none-linked', commits: [] };
  }
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: repoRoot, stdio: 'pipe' });
  } catch (err) {
    const reason = err && err.code === 'ENOENT' ? 'git-unavailable' : 'not-a-git-repo';
    return {
      checked: false,
      reason,
      commits: list.map((sha) => ({ sha, state: COMMIT_STATE.UNVERIFIABLE, reason })),
    };
  }
  const commits = list.map((sha) => {
    try {
      execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: repoRoot, stdio: 'pipe' });
      return { sha, state: COMMIT_STATE.VERIFIED, reason: null };
    } catch (err) {
      // A git that failed for a NON-resolution reason (killed, out of memory,
      // a corrupted object store) is not evidence the sha is fake. Only a
      // clean non-zero exit from cat-file is.
      if (err && typeof err.status === 'number') {
        return { sha, state: COMMIT_STATE.NOT_FOUND, reason: null };
      }
      return { sha, state: COMMIT_STATE.UNVERIFIABLE, reason: 'git-error' };
    }
  });
  return { checked: true, reason: null, commits };
}
