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
//
//      DISPOSAL-TIME node_modules GUARD (TASK-198 fix round, HIGH): a
//      provisioned worktree's `node_modules` is a junction/symlink pointing
//      at the PRIMARY checkout's real `node_modules`
//      (src/worktree-provision.js). That junction is gitignored, so it is
//      invisible to every guard above — including `git status --porcelain`,
//      which is what makes this the worst kind of hazard: it passes on the
//      ordinary happy path. Reproduced against real git (2.53.0.windows.2):
//      a clean, merged, non-dirty worktree with such a junction still has
//      the PRIMARY's real `node_modules` **recursively emptied** by a
//      plain, non-force `git worktree remove` — `git` treats the whole
//      worktree directory as disposable and recurses THROUGH the junction
//      into whatever it points at. Immediately before invoking `git
//      worktree remove`, this function `lstat`s the worktree's
//      `node_modules` and, if it is a symlink/junction, unlinks it
//      NON-recursively first (`rmSync(recursive: false)` — the exact same
//      shape `worktree-provision.js`'s `relink` action already uses, and
//      confirmed there that the foreign target survives it). This is done
//      unconditionally rather than refusing: removing a symlink/junction
//      itself never touches what it points at, so there is no data-loss
//      risk to gate behind a manual step, and refusing would only force
//      every caller to duplicate this exact unlink by hand before calling
//      this function. A directory that is NOT a symlink/junction at the
//      TOP LEVEL (the worktree's own real `node_modules`, e.g.
//      unprovisioned) is left alone — it belongs to the worktree being
//      disposed of, not the primary, and ordinarily `git worktree remove`
//      deleting it is correct.
//
//      RESIDUAL RISK, not a live regression (TASK-198 deferral item 2,
//      MEDIUM-1): this guard only `lstat`s the TOP-LEVEL `node_modules` —
//      it does not descend. A real `node_modules` directory containing a
//      NESTED symlink/junction one level down would pass this guard
//      untouched, and `git worktree remove` would recurse through THAT
//      nested link the same way it recurses through a top-level one
//      (reproduced by the reviewer). "Deleting it along with the rest of
//      the tree is correct" above is therefore only true for a real
//      `node_modules` with no nested links inside it — no path in this
//      framework currently creates the nested shape (`worktree-provision.js`
//      only ever creates the top-level link, and this repo's own
//      `npm install` produces zero `node_modules` symlinks), which is why
//      this is accepted as residual rather than fixed by descending into
//      every entry on every disposal.
//
// MODULE INVARIANT (TASK-195 fix round 3): no raw `git()` result may be read
// as a state assertion — i.e. no call site may collapse a `status` field to
// a bare "did the checked-for state hold" boolean. Four consecutive review
// rounds each closed one such site and opened a new one, because a plain
// git command has (at least) three distinct outcomes — "yes", "no", and "git
// itself could not answer" — and reading only two of them is exactly the
// TASK-192 empty-result-contract defect class applied to process exit
// status. Every call site in this module goes through one of three
// sanctioned shapes:
//   - `runGitOrThrow` — any non-zero exit is a failure, full stop (used
//     whenever there is no meaningful "no" outcome, only "yes" or "error").
//   - a dedicated three-valued probe like `probeMergeHead` below — used
//     whenever a non-zero exit can legitimately mean either "no" (e.g. exit
//     1 from `--verify -q`) or "git failed" (any other exit), and those two
//     must not be conflated.
//   - inline handling where every non-yes/no outcome, including a raw git
//     failure, folds into the CONSERVATIVE disposition (a throw, or the
//     alarm-raising answer) rather than the benign one — see
//     mergeWorktreeBranch's merge invocation, its conflict-status read, and
//     its abort-status check, plus the dirty checks in
//     detectOrphanedWorktrees and removeMergedWorktree, below.
// A new git call that reads `.status === 0` (or `!== 0`) as its only
// disposition and folds the "neither yes nor no" case into the BENIGN
// outcome has re-introduced this bug. Do not add one.

import { spawnSync } from 'node:child_process';
import { realpathSync, lstatSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// TASK-197 fix round — MEDIUM-2: imports the data-only
// scripts/entrypoint-names.mjs, NOT scripts/build-plugin.mjs. build-plugin.mjs
// top-level-imports esbuild (a devDependency only), which is absent in a real
// plugin install (a git-URL clone ships no node_modules) and cannot itself be
// bundled (esbuild ships a native binary) — importing it from a module a
// plugin install actually loads (this one; see skills/orchestrator-routing/
// SKILL.md's handback protocol) breaks that install with
// ERR_MODULE_NOT_FOUND. entrypoint-names.mjs has zero imports, so this stays
// safe. build-plugin.mjs re-exports the same array, so there is still exactly
// one list (AC4) — only which file OWNS the literal changed.
import { ENTRYPOINT_NAMES } from '../scripts/entrypoint-names.mjs';

// TASK-197 — GENERATED-ARTIFACT MERGE HAZARD.
//
// On 2026-08-03, TASK-193 (main tree) and TASK-189 (isolated worktree) both
// branched from d3c80c1 and both regenerated dist/*.cjs independently.
// mergeWorktreeBranch merged the two branches with NO conflict reported —
// git treats a generated bundle as ordinary text and happily splices
// non-overlapping hunks from two DIFFERENT builds into one file. The result
// matched neither build and was only caught by the unrelated dist-parity
// sensor (TASK-049); had that sensor not existed, a spliced bundle would
// have shipped. A conflict would have been the SAFE outcome here — a
// successful textual merge of a generated artifact is the dangerous one,
// because it is silent.
//
// MITIGATION CHOSEN: option 3 from the ticket (refuse when both sides
// independently modified a generated path since diverging), not option 1
// (exclude + always take target side) or option 2 (detect + auto-rebuild).
// Rationale, recorded here because it is the one non-obvious decision in
// this module's addition:
//   - This repo's house style for exactly this class of hazard (see the
//     MODULE INVARIANT above, and the E_NODE_MODULES_* typed-refusal family)
//     is fail-closed and loud, never silent-and-self-healing. Option 2 would
//     be the first place in this module that runs a BUILD as a side effect
//     of a MERGE — new failure surface (a build can itself fail, hang, or
//     drift the merge commit's tree out from under the caller) in exchange
//     for automating a step a human/Orchestrator can trivially run by hand
//     (`npm run build:plugin`) once told to.
//   - Option 1 (silently take target side, then rebuild) throws away
//     whichever side's regeneration was NOT already on the target branch
//     without ever telling the operator a second build happened to exist —
//     the same "silent" shape as the original defect, just relocated.
//   - Option 3 converts the silent case into EXACTLY the conflict it should
//     have been: it refuses BEFORE the merge is attempted, names the
//     colliding path(s), and leaves both branches and the target tree
//     completely untouched — the same "abort, never resolve, hand back to
//     the Orchestrator/human" shape mergeWorktreeBranch already uses for a
//     real content conflict, so this is not a new decision axis, only a new
//     trigger for an existing one.
//
// COST: a merge that used to succeed automatically whenever both sides
// touched dist/*.cjs (the overwhelmingly common case for two developer
// spawns landing in the same window — dist/ changes on almost every ticket
// that touches bin/ or src/) is now REFUSED, and this refusal is TERMINAL
// for automated handback of that branch (TASK-197 fix round, MEDIUM-1: an
// earlier version of this comment, and of the SKILL.md prose, wrongly
// claimed the operator could rebuild and "re-attempt the merge" — verified
// against real git that this does NOT work: the merge base is unchanged by
// a rebuild, so the target's own already-committed dist/ modification since
// that base still exists, and `mergeWorktreeBranch` refuses again,
// unconditionally, for the SAME branch). There is no retry loop through
// this function. The only way out is the manual path this function
// explicitly does NOT protect (see the residual below): merge the SOURCE
// changes by hand (a plain `git merge`, resolving the generated-path
// conflict however is appropriate, or simply taking one side and
// discarding the other's stale bytes), then run `npm run build:plugin` on
// the merged source tree, then verify with `npm run test:all`'s
// dist-parity check before committing. This is deliberately more friction
// than option 2's auto-heal, traded for never silently shipping a spliced
// bundle.
//
// WHAT THIS DOES NOT PROTECT AGAINST (the residual, stated explicitly per
// the ticket's demand):
//   - This module has NO independent way to know a path is "generated" —
//     it can only refuse for paths a caller told it about. The set used
//     here (getGeneratedArtifactPaths, below) is derived from
//     scripts/entrypoint-names.mjs's ENTRYPOINT_NAMES, which covers the
//     dist/ bundles this repo's OWN build produces. Any other generated
//     artifact in this repo or a consuming project (a different build
//     tool, a generated lockfile, a codegen'd file this list doesn't know
//     about) is silently unprotected — the exact TASK-197 defect can still
//     occur for any generated path outside this list.
//   - This is a MERGE-TIME check keyed on "did both sides touch this path
//     since their common ancestor". It does not catch the case where only
//     ONE side touched a generated path but the OTHER side's unmerged
//     source changes would have produced different bytes for that same
//     path had it been rebuilt — that is exactly what dist-parity
//     (tests/e2e/dist-parity.spec.js) exists to catch post-merge, and this
//     check does not replace it.
//   - It protects mergeWorktreeBranch only. And because a refusal is
//     TERMINAL for that function (see COST above), EVERY refusal's
//     practical consequence is that the operator falls back to exactly
//     that unprotected manual path — a plain `git merge` outside this
//     module (or a rebase, or a cherry-pick), which carries the full
//     original TASK-197 silent-splice risk with no guard at all. This is
//     not a rare escape hatch; it is the ONLY resolution path this
//     mitigation leaves, so it is worth stating plainly rather than
//     leaving it to be inferred from the two bullets above.

/**
 * The set of generated bundle paths (repo-root-relative, forward-slash,
 * matching `git diff --name-only` output on every platform) this module
 * refuses to silently textually-merge. Derived directly from
 * scripts/entrypoint-names.mjs's ENTRYPOINT_NAMES — a zero-import data
 * module both this file and tests/e2e/dist-parity.spec.js import (TASK-197
 * fix round, MEDIUM-2: NOT scripts/build-plugin.mjs, which top-level-imports
 * esbuild, a devDependency absent from a real plugin install) — so there is
 * exactly one list of "what dist/ contains" in this repo, not a second copy
 * that can drift (TASK-197 AC4; this repo has been bitten by exactly that
 * class of duplication before).
 *
 * @returns {string[]}
 */
export function getGeneratedArtifactPaths() {
  return ENTRYPOINT_NAMES.map((name) => `dist/${name}`);
}

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

/**
 * Three-valued probe for whether `ref` resolves to a commit in `repoRoot`
 * via `git rev-parse --verify -q <ref>` — the module invariant's canonical
 * probe shape, and the SINGLE implementation both call sites that need it
 * share (TASK-195's `probeMergeHead` below, and TASK-197's branch-existence
 * check in `detectGeneratedArtifactCollision`), rather than two copies that
 * could drift. Never conflates a probe FAILURE with "absent": exits 0 when
 * `ref` resolves, 1 when it does not (git's documented `--verify -q`
 * "missing ref" signal), and anything else (observed: 128) is a git-level
 * error that must be surfaced, not silently read as either state (TASK-195
 * fix round 3, MEDIUM — the shared fix for the fail-open shape found latent
 * at two call sites: the up-front parked-merge check and the post-failure
 * abort-routing check).
 *
 * @returns {'present' | 'absent'}
 */
function probeRefExists(repoRoot, ref, label) {
  const r = git(repoRoot, ['rev-parse', '--verify', '-q', ref]);
  if (r.status === 0) return 'present';
  if (r.status === 1) return 'absent';
  throw makeErr(
    'E_GIT_FAILED',
    `${label}: git rev-parse --verify -q ${ref} failed unexpectedly (exit ${r.status}): ${r.stderr}`,
  );
}

/**
 * Three-valued probe for whether a merge is currently parked in `repoRoot`
 * (i.e. `MERGE_HEAD` exists) — a specialization of probeRefExists above.
 *
 * @returns {'present' | 'absent'}
 */
export function probeMergeHead(repoRoot, label) {
  return probeRefExists(repoRoot, 'MERGE_HEAD', label);
}

/** Normalize a filesystem path for cross-representation comparison: resolve
 * symlinks / Windows 8.3 short names to the canonical long form, then — on
 * win32 only — rewrite to forward slashes, since `git worktree list
 * --porcelain` reports forward-slash paths even on Windows, and a
 * caller-supplied path may be a backslash `join()` result or an 8.3 short
 * form from `os.tmpdir()`. The rewrite is gated on `process.platform ===
 * 'win32'` (TASK-195 fix round 2, LOW-1): an unconditional backslash rewrite
 * is an over-normalization vector on POSIX, where `\` is a legal filename
 * character — a directory literally named `a\b` would otherwise compare
 * equal to the path `a/b`. Git never emits backslash-separated paths on
 * POSIX, so no rewrite is needed there. Falls back to a plain (still
 * platform-gated) normalized path if the target no longer exists on disk. */
export function normalizeForCompare(p) {
  try {
    const resolved = realpathSync.native(p);
    return process.platform === 'win32' ? resolved.replace(/\\/g, '/') : resolved;
  } catch {
    const s = String(p);
    return process.platform === 'win32' ? s.replace(/\\/g, '/') : s;
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
 * Detect whether both `targetRef` (the checkout at `repoRoot`, always
 * `'HEAD'`) and `branch` have independently modified a generated artifact
 * path (per getGeneratedArtifactPaths) since their common ancestor — the
 * exact precondition under which git's textual merge splices two
 * independently-generated builds together without reporting a conflict
 * (TASK-197).
 *
 * Two DELIBERATE, DOCUMENTED "return no collision" legs, and nothing else
 * (TASK-197 fix round, HIGH — the original version folded EVERY non-zero
 * `merge-base` exit into this bucket, which is exactly the fail-open shape
 * the MODULE INVARIANT above forbids: it cannot distinguish "branch does
 * not exist" from "git itself could not answer for an unrelated,
 * potentially environmental, reason" (spawn error, EMFILE, an AV/indexer
 * lock — both would-be culprits can share the SAME non-zero exit code, 128,
 * as an unresolvable branch name), so the fix checks branch existence via
 * probeRefExists FIRST, as an independent, targeted signal, rather than
 * inferring it from merge-base's exit code):
 *   1. `branch` does not resolve at all (probeRefExists === 'absent') — the
 *      real `git merge` attempt immediately below this check will fail on
 *      its own, for its own, more specific reason (an unresolvable branch
 *      name). No merge is going to succeed either way, so returning "no
 *      collision" here does not hide anything.
 *   2. `branch` DOES resolve, but shares no common ancestor with `HEAD`
 *      (`git merge-base` exit 1, git's documented "no merge base" signal) —
 *      genuinely unrelated histories cannot splice (there is no shared base
 *      content to textually merge), and the real `git merge --no-ff` below
 *      refuses on its own ("refusing to merge unrelated histories").
 * Any OTHER `merge-base` exit — with `branch` already confirmed to exist —
 * is a genuine, unenumerated git-level anomaly and is surfaced as
 * `E_GIT_FAILED`, never silently read as "no collision" (this is the actual
 * fix: previously this leg was indistinguishable from leg 1 above and got
 * the same free pass). A `git diff` failure AFTER merge-base has already
 * resolved is a different matter — at that point all three refs are
 * known-good, so any failure is a genuine anomaly and is surfaced via
 * runGitOrThrow (E_GIT_FAILED) exactly as before.
 *
 * A path both sides changed to BYTE-IDENTICAL content (TASK-197 fix round,
 * LOW-3) is dropped from the result: there is no splice hazard when both
 * tips already carry the same bytes for that path — nothing would actually
 * be merged wrong. Compared via blob hash (`git rev-parse <ref>:<path>`),
 * not working-tree content, since `branch` need not be checked out anywhere
 * for this to run. If either side's blob lookup itself fails (e.g. the path
 * was DELETED on one side, so `<ref>:<path>` no longer resolves) this is
 * conservatively NOT treated as proof of identity — the path stays in the
 * result — matching this module's fail-closed style rather than silently
 * dropping a real collision because a byte-comparison happened to fail.
 *
 * @returns {string[]} the colliding generated paths, empty if none.
 */
function detectGeneratedArtifactCollision(repoRoot, branch, label) {
  const generatedPaths = getGeneratedArtifactPaths();

  if (probeRefExists(repoRoot, branch, label) === 'absent') return [];

  const mergeBaseOut = git(repoRoot, ['merge-base', 'HEAD', branch]);
  if (mergeBaseOut.status === 1) return [];
  if (mergeBaseOut.status !== 0) {
    throw makeErr(
      'E_GIT_FAILED',
      `${label}: git merge-base HEAD ${branch} failed unexpectedly (exit ${mergeBaseOut.status}): ${mergeBaseOut.stderr}`,
    );
  }
  const mergeBase = mergeBaseOut.stdout.trim();
  // Same class as the HIGH above (TASK-197 fix round): exit 0 with EMPTY
  // stdout is not reachable against real git (a real base is always
  // printed on exit 0), but silently proceeding on it would issue
  // `git diff --name-only ..HEAD` — a malformed-but-git-accepted range that
  // resolves to `HEAD..HEAD` and yields an empty diff, folding this
  // unexpected outcome into "no collision" exactly like the exit-code bug
  // just fixed. Distinguished in the message from the exit-1 "no common
  // ancestor" case above, which is a legitimate, expected empty result.
  if (!mergeBase) {
    throw makeErr(
      'E_GIT_FAILED',
      `${label}: git merge-base HEAD ${branch} exited 0 (success) but printed no base — not the documented ` +
      'exit-1 "no common ancestor" case; treating this as "no collision" would issue a malformed HEAD..HEAD diff',
    );
  }

  const targetChanged = new Set(
    runGitOrThrow(repoRoot, ['diff', '--name-only', `${mergeBase}..HEAD`], label)
      .split('\n').map((l) => l.trim()).filter(Boolean),
  );
  const branchChanged = new Set(
    runGitOrThrow(repoRoot, ['diff', '--name-only', `${mergeBase}..${branch}`], label)
      .split('\n').map((l) => l.trim()).filter(Boolean),
  );

  const collisions = generatedPaths.filter((p) => targetChanged.has(p) && branchChanged.has(p));

  return collisions.filter((p) => {
    const headBlob = git(repoRoot, ['rev-parse', `HEAD:${p}`]);
    const branchBlob = git(repoRoot, ['rev-parse', `${branch}:${p}`]);
    if (headBlob.status !== 0 || branchBlob.status !== 0) return true;
    return headBlob.stdout.trim() !== branchBlob.stdout.trim();
  });
}

/**
 * Merge `branch` (a worktree's branch) into whatever is currently checked
 * out at `repoRoot`. Never resolves a conflict — aborts and reports instead.
 * Refuses up front if a merge is already in progress at `repoRoot`, or if
 * both sides independently modified a generated artifact path since
 * diverging (TASK-197 — see detectGeneratedArtifactCollision and the module
 * doc comment's "GENERATED-ARTIFACT MERGE HAZARD" section for the full
 * rationale, cost, and residual).
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
  // a merge this function did not start. Uses the shared three-valued probe
  // (TASK-195 fix round 3) rather than reading the raw exit status inline —
  // a probe FAILURE here must not be read as "no merge parked": doing so
  // would let execution proceed into a parked-merge situation this check
  // exists to catch, and the abort further down could then destroy that
  // unrelated merge's partial resolution.
  if (probeMergeHead(repoRoot, 'mergeWorktreeBranch') === 'present') {
    throw makeErr(
      'E_MERGE_IN_PROGRESS',
      `mergeWorktreeBranch: refusing to merge ${branch} into ${repoRoot} — a merge is already in progress ` +
      'there (MERGE_HEAD exists); resolve or abort it before handing back another branch',
    );
  }

  // TASK-197 — refuse BEFORE attempting the merge if both sides
  // independently modified a generated artifact path since diverging: this
  // is the exact silent-splice precondition (see the module doc comment).
  // Checked ahead of the merge attempt, not after, so the target tree is
  // never even touched — the same "leave everything untouched, hand back
  // to a human/Orchestrator" shape as the real-conflict abort path below,
  // just triggered earlier and without ever starting a merge at all.
  const generatedCollisions = detectGeneratedArtifactCollision(repoRoot, branch, 'mergeWorktreeBranch');
  if (generatedCollisions.length > 0) {
    throw makeErr(
      'E_GENERATED_ARTIFACT_BOTH_SIDES_MODIFIED',
      `mergeWorktreeBranch: refusing to merge ${branch} into ${repoRoot} — both sides independently modified ` +
      `generated artifact path(s) since diverging: ${generatedCollisions.join(', ')}. A textual merge here would ` +
      'silently splice two independently-generated builds together, producing an artifact matching neither ' +
      '(TASK-197). Resolve by hand: merge the SOURCE changes only (or rebuild after merging), then rebuild ' +
      "with `npm run build:plugin` and re-verify with `npm run test:all`'s dist-parity check before committing.",
    );
  }

  const args = ['merge', '--no-ff', branch];
  args.push('-m', message || `merge worktree branch ${branch}`);
  const r = git(repoRoot, args);

  if (r.status === 0) {
    const sha = runGitOrThrow(repoRoot, ['rev-parse', 'HEAD'], 'mergeWorktreeBranch').trim();
    return { merged: true, sha };
  }

  // Non-zero exit — but a failed `git merge` does not always mean a merge
  // was actually STARTED: an unresolvable branch name or a dirty primary
  // tree both fail before MERGE_HEAD is ever written (verified against real
  // git). Probe MERGE_HEAD (the SAME shared helper as the up-front check
  // above, not a hand-rolled re-read of the exit status — TASK-195 fix
  // round 3) BEFORE doing anything abort-related (TASK-195 fix round 2,
  // MEDIUM-1) — the prior version unconditionally ran `git merge --abort`
  // here, which itself fails ("There is no merge to abort") for exactly
  // these two cases, and that abort failure was misrouted to
  // E_MERGE_ABORT_FAILED — a FALSE "may be left mid-merge; manual
  // intervention required" while the repo was actually clean. An operator
  // acting on that false claim (e.g. `git reset --hard`) in the
  // dirty-primary-tree case would have destroyed the very uncommitted edit
  // that caused the refusal. A probe FAILURE here must not be silently read
  // as "not started": that under-fire would skip the abort on a merge that
  // genuinely DID start and conflict, leaving the repo parked mid-merge
  // while the thrown E_MERGE_FAILED below falsely claims otherwise (fix
  // round 3's MEDIUM, chain (a)).
  const mergeWasStarted = probeMergeHead(repoRoot, 'mergeWorktreeBranch') === 'present';

  if (mergeWasStarted) {
    // Determine whether this is a real content conflict (git leaves conflict
    // markers + unmerged index entries) via `git status` rather than parsing
    // locale-dependent stdout text. A failed `git status` here must be
    // surfaced, not silently read as "no conflicts" via `.stdout || ''`
    // (TASK-195 fix round 2, LOW-1 — same seam as MEDIUM-1): that would
    // mislabel a real conflict as an unrelated merge failure while leaving
    // the merge parked instead of aborting it.
    const statusOut = git(repoRoot, ['status', '--porcelain=v1']);
    if (statusOut.status !== 0) {
      throw makeErr(
        'E_GIT_FAILED',
        `mergeWorktreeBranch: git status --porcelain=v1 failed while inspecting a conflicted merge of ${branch} ` +
        `(exit ${statusOut.status}): ${statusOut.stderr}`,
      );
    }
    const conflictedFiles = statusOut.stdout
      .split('\n')
      .filter((l) => UNMERGED_STATUS_RE.test(l))
      .map((l) => l.slice(3).trim());

    // A merge that genuinely started is always aborted, so the main line
    // never ends up parked mid-merge (see module doc comment, case 2). Check
    // the abort's own exit status instead of discarding it: a failed abort
    // must be surfaced, not silently swallowed while a half-merged state is
    // left behind. This is now reachable ONLY when a merge was actually in
    // progress, so E_MERGE_ABORT_FAILED can no longer over-fire.
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
  }

  // Either not a content conflict at all (e.g. unknown branch, dirty target
  // tree — MERGE_HEAD never existed, so no abort was even attempted), or a
  // merge that started but left no unmerged index entries — surface the
  // real git failure rather than mislabeling either case.
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
 * only — never deletes anything. Fails CLOSED on BOTH legs, never
 * under-reporting: an unresolvable `targetBranch` throws `E_GIT_FAILED` (the
 * ahead-count leg), and a worktree whose own `git status` cannot answer —
 * e.g. a corrupted per-worktree git-dir pointer or index, a realistic
 * crashed-agent artifact — is reported `dirty: true` rather than read as
 * clean (the dirty leg; TASK-195 fix round 2, MEDIUM-2 — an earlier version
 * of this comment claimed fail-closed behavior for both legs while the
 * dirty leg still read a `git status` failure as "not dirty").
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

    // Fails CLOSED (TASK-195 fix round 2, MEDIUM-2): a `git status` failure
    // in THIS worktree (e.g. a corrupted git-dir pointer/index) is reported
    // dirty rather than read as clean — the population this function exists
    // to find includes exactly this kind of crashed-agent artifact.
    const dirtyOut = git(wt.path, ['status', '--porcelain']);
    const dirty = dirtyOut.status !== 0 || dirtyOut.stdout.trim().length > 0;

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
 * Disposal ordering (TASK-198 fix round, HIGH): if the worktree's
 * `node_modules` is a symlink/junction (the shape `worktree-provision.js`
 * creates), it is unlinked non-recursively BEFORE `git worktree remove`
 * runs — see the module doc comment's "DISPOSAL-TIME node_modules GUARD"
 * for why this must happen unconditionally, not as an opt-in.
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

  // Sever a node_modules junction/symlink BEFORE disposal (TASK-198 fix
  // round, HIGH) — see the module doc comment for the full reproduction and
  // rationale. `lstat` (never `stat`/`existsSync`, which FOLLOW the link and
  // would report on the primary's real node_modules instead of the link
  // itself) the worktree's node_modules; a non-existent path is fine (never
  // provisioned — nothing to sever) and a real, non-symlink directory is
  // left untouched (it belongs to the worktree, not the primary).
  const worktreeNodeModules = join(worktreePath, 'node_modules');
  let nodeModulesLstat;
  try {
    nodeModulesLstat = lstatSync(worktreeNodeModules);
  } catch (e) {
    // Only a genuinely missing path (ENOENT — never provisioned; nothing to
    // sever) is read as "absent" (TASK-198 deferral item 1, MEDIUM-2). A
    // transient EPERM/EBUSY (AV scan, ACL contention) on a STILL-PRESENT
    // junction used to be swallowed by a bare `catch`, which fails OPEN on
    // this data-loss path: the sever step would be silently skipped and
    // `git worktree remove` would proceed to recurse through the junction
    // into the primary's real node_modules — the exact hazard this guard
    // exists to close. This contradicts the module invariant at :83-89
    // (that invariant was scoped to `git()` results; this reads an `fs`
    // result instead, which is how it slipped past). Refuse with a typed
    // error on anything other than ENOENT, matching this module's other
    // typed-error refusals rather than guessing "nothing to sever".
    if (e.code === 'ENOENT') {
      nodeModulesLstat = null;
    } else {
      throw makeErr(
        'E_NODE_MODULES_LSTAT_FAILED',
        `removeMergedWorktree: refusing to remove ${worktreePath} — lstat of its node_modules at ` +
        `${worktreeNodeModules} failed for a reason other than the path being absent (${e.code || e.message}); ` +
        'treating an unreadable-but-possibly-present junction as "nothing to sever" would let ' +
        '`git worktree remove` recurse through it and destroy the primary checkout\'s real node_modules',
      );
    }
  }
  if (nodeModulesLstat && nodeModulesLstat.isSymbolicLink()) {
    try {
      // recursive: false — the same shape worktree-provision.js's 'relink'
      // action uses. Removing a symlink/junction itself never deletes
      // through it; on some platforms recursive: true on a symlink to a
      // directory would delete through it (TASK-198 deferral item 3 —
      // softened from an earlier, empirically-overstated claim that this was
      // unconditionally "the exact bug this fix closes": on Windows,
      // rmSync(recursive: true) on a junction unlinks the link and the
      // target SURVIVES; `git worktree remove`, not `rmSync`, is this
      // module's actual destruction vector — see the module doc comment).
      // recursive: false is kept regardless, since it is the same safe shape
      // used elsewhere in this codebase and costs nothing.
      rmSync(worktreeNodeModules, { recursive: false, force: true });
    } catch (e) {
      throw makeErr(
        'E_NODE_MODULES_UNLINK_FAILED',
        `removeMergedWorktree: refusing to remove ${worktreePath} — failed to unlink its node_modules ` +
        `junction/symlink at ${worktreeNodeModules} before disposal (leaving it in place would let ` +
        `\`git worktree remove\` recurse THROUGH it and destroy the primary checkout's real node_modules): ` +
        `${e.message}`,
      );
    }
  }

  runGitOrThrow(repoRoot, ['worktree', 'remove', worktreePath], 'removeMergedWorktree');
}
