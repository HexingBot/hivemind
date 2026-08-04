// src/worktree-provision.js
// TASK-198 — Defect 2: an isolated worktree's own `node_modules` is an EMPTY
// directory. Node's parent-directory module-resolution fallback still
// satisfies ordinary `import`s (the ancestor walk reaches the primary
// checkout's real `node_modules`, since a worktree under `.claude/worktrees/`
// is nested inside the primary repo tree) — which is what makes the empty
// directory dangerous rather than obviously broken. Two things do NOT work
// through that fallback:
//   1. Code that does a literal `fs` path lookup against
//      `<root>/node_modules/...` instead of real module resolution (see
//      tests/vitest-changed-algorithm-pin.spec.js, fixed separately by
//      switching to `require.resolve`).
//   2. `npm run build:plugin` — esbuild's own dependency resolution does not
//      necessarily replicate Node's ancestor walk, so a build run with cwd
//      inside a worktree can emit different bytes than the same build run in
//      the primary checkout (dist-parity false-positive; TASK-198 incident).
//
// DECISION (human-made, recorded in TASK-198): link the worktree's
// `node_modules` to the primary checkout's — a directory junction on
// Windows, a symlink on POSIX — rather than running a real `npm install`
// inside every worktree. Rationale: near-instant, no extra disk cost, and
// every build is byte-identical because it is literally the same dependency
// tree, not a re-resolved copy of it.
//
// ACCEPTED RISK (state, do not leave implicit): a worktree checked out at a
// commit with a DIVERGENT `package.json`/`package-lock.json` would still use
// the PRIMARY checkout's installed deps, which could be wrong for that
// commit. This is accepted because agent worktrees created via the `Agent`
// tool's `isolation: 'worktree'` option are short-lived branches off current
// HEAD, not long-running divergent checkouts — the dependency tree at HEAD
// and at the worktree's branch point are, by construction, the same tree.
//
// PROVISIONING SEAM (state plainly): no code in this repository runs
// automatically between `git worktree add` and a spawned subagent's first
// tool call — that boundary is entirely inside the Agent tool's own
// implementation (part of the harness, not this repo). There is no
// PostToolUse/worktree-creation hook wired in hooks/hooks.json, and none is
// invented here (a hook that never fires would be worse than no hook: it
// would look like coverage while providing none). The nearest seam actually
// inside this repo's control is documented in
// skills/orchestrator-routing/SKILL.md: run `provisionWorktreeNodeModules`
// (via `node scripts/provision-worktree.mjs <worktreePath>`) as the FIRST
// action once a worktree-isolated spawn is known to exist, before relying on
// anything built inside it.

import {
  lstatSync, existsSync, readdirSync, rmSync, symlinkSync, realpathSync,
} from 'node:fs';
import { join } from 'node:path';

function makeErr(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

/** Directory names a vitest run inside an UNPROVISIONED worktree is known to
 * write into the empty shadow `node_modules` before provisioning ever runs
 * (TASK-198 fix round, MEDIUM-1) — observed live: `.claude/worktrees/
 * agent-a83ac659b232c8f2d/node_modules` contained only `.vite/` and
 * `.vite-temp/` at review time. A directory whose entries are ALL drawn from
 * this set carries no content a human would need to investigate, so it is
 * treated as replace-equivalent to an empty directory rather than refused. */
const KNOWN_CACHE_DIR_NAMES = new Set(['.vite', '.vite-temp', '.cache']);

/**
 * Pure decision function — no fs access. Given a description of what
 * currently sits at the worktree's `node_modules` path, decide what
 * `provisionWorktreeNodeModules` should do about it. Extracted so the
 * decision matrix is unit-testable without real disk I/O (fast tier).
 *
 * @param {{ exists: boolean, isSymlinkOrJunction: boolean, linksToPrimary: boolean, isEmptyDir: boolean, isCacheOnlyDir?: boolean }} state
 * @returns {'create-link' | 'already-linked' | 'relink' | 'replace-empty-dir' | 'replace-cache-only-dir' | 'refuse-nonempty-dir'}
 */
export function decideNodeModulesAction(state) {
  const {
    exists, isSymlinkOrJunction, linksToPrimary, isEmptyDir, isCacheOnlyDir = false,
  } = state;

  if (!exists) return 'create-link';
  if (isSymlinkOrJunction) return linksToPrimary ? 'already-linked' : 'relink';
  // A real directory (not a link). Only ever touch it if it is EMPTY, or
  // its entire contents are known, predictable build/test cache dirs — a
  // non-empty real directory carrying anything else might hold content
  // nothing here knows about (e.g. a manual `npm install` someone ran
  // directly inside the worktree); never silently discard THAT.
  if (isEmptyDir) return 'replace-empty-dir';
  if (isCacheOnlyDir) return 'replace-cache-only-dir';
  return 'refuse-nonempty-dir';
}

/**
 * Provision a worktree's `node_modules` as a junction/symlink to the primary
 * checkout's real `node_modules`, per the TASK-198 decision. Idempotent:
 * running it again on an already-correctly-linked worktree is a no-op.
 * Never deletes a real, non-empty `node_modules` directory — refuses instead
 * (`E_NODE_MODULES_NONEMPTY`), since that shape means something other than
 * this stale-provisioning defect put content there.
 *
 * @param {{ worktreePath: string, primaryRoot: string }} opts
 * @returns {{ action: string, worktreeNodeModules: string, primaryNodeModules: string }}
 */
export function provisionWorktreeNodeModules({ worktreePath, primaryRoot } = {}) {
  if (!worktreePath) throw makeErr('E_ARGS', 'provisionWorktreeNodeModules: worktreePath is required');
  if (!primaryRoot) throw makeErr('E_ARGS', 'provisionWorktreeNodeModules: primaryRoot is required');

  const primaryNodeModules = join(primaryRoot, 'node_modules');
  const worktreeNodeModules = join(worktreePath, 'node_modules');

  // Nothing to link to itself — running this against the primary checkout
  // (e.g. because a caller couldn't tell whether a path was a worktree) is a
  // deliberate no-op, not an error, so callers can call it unconditionally.
  if (realpathAttempt(worktreePath) === realpathAttempt(primaryRoot)) {
    return { action: 'no-op-primary-checkout', worktreeNodeModules, primaryNodeModules };
  }

  if (!existsSync(primaryNodeModules) || readdirSync(primaryNodeModules).length === 0) {
    throw makeErr(
      'E_PRIMARY_NODE_MODULES_MISSING',
      `provisionWorktreeNodeModules: ${primaryNodeModules} does not exist or is empty — nothing to link to. ` +
      'Run `npm install` in the primary checkout first.',
    );
  }

  const exists = existsSync(worktreeNodeModules) || isBrokenLink(worktreeNodeModules);
  let isSymlinkOrJunction = false;
  let linksToPrimary = false;
  let isEmptyDir = false;
  let isCacheOnlyDir = false;

  if (exists) {
    const st = lstatSync(worktreeNodeModules);
    isSymlinkOrJunction = st.isSymbolicLink();
    if (isSymlinkOrJunction) {
      linksToPrimary = realpathAttempt(worktreeNodeModules) === realpathAttempt(primaryNodeModules);
    } else {
      // A real (non-link) entry at the path — must be a directory for a
      // `node_modules` shape to make sense at all. (TASK-198 fix round,
      // LOW-3): a path-that-is-a-file would otherwise throw a raw ENOTDIR
      // straight out of readdirSync; wrap it into a typed refusal naming the
      // provisioning decision instead of leaking an fs internal.
      let entries;
      try {
        entries = readdirSync(worktreeNodeModules);
      } catch (e) {
        throw makeErr(
          'E_NODE_MODULES_UNEXPECTED_TYPE',
          `provisionWorktreeNodeModules: ${worktreeNodeModules} exists but is not a readable directory or ` +
          `symlink/junction (${e.code || e.message}) — investigate before proceeding.`,
        );
      }
      isEmptyDir = entries.length === 0;
      isCacheOnlyDir = !isEmptyDir && entries.every((name) => KNOWN_CACHE_DIR_NAMES.has(name));
    }
  }

  const action = decideNodeModulesAction({
    exists, isSymlinkOrJunction, linksToPrimary, isEmptyDir, isCacheOnlyDir,
  });

  switch (action) {
    case 'already-linked':
      break;
    case 'refuse-nonempty-dir':
      throw makeErr(
        'E_NODE_MODULES_NONEMPTY',
        `provisionWorktreeNodeModules: refusing to touch ${worktreeNodeModules} — it is a real, non-empty ` +
        'directory, not the empty shadow this defect produces, and it contains more than known build/test ' +
        `cache dirs (${[...KNOWN_CACHE_DIR_NAMES].join(', ')}), which provisioning would otherwise replace ` +
        'automatically. Investigate before removing it by hand.',
      );
    case 'relink':
      // A symlink/junction itself is removed non-recursively (recursive:true
      // on a symlink to a directory would, on some platforms, delete through
      // it) — never the case for 'replace-empty-dir'/'replace-cache-only-dir'
      // below, which remove a REAL directory and need recursive:true to
      // succeed at all (rmSync EISDIRs on a real directory with
      // recursive:false).
      rmSync(worktreeNodeModules, { recursive: false, force: true });
      createLink(primaryNodeModules, worktreeNodeModules);
      break;
    case 'replace-empty-dir':
      // Safe: decideNodeModulesAction only reaches this branch when the
      // directory was already confirmed empty above.
      rmSync(worktreeNodeModules, { recursive: true, force: true });
      createLink(primaryNodeModules, worktreeNodeModules);
      break;
    case 'replace-cache-only-dir':
      // Safe (TASK-198 fix round, MEDIUM-1): decideNodeModulesAction only
      // reaches this branch when every entry in the directory is a known
      // build/test cache dir — the exact shape a vitest run inside an
      // unprovisioned worktree writes into the empty shadow before
      // provisioning ever runs. Content this predictable carries nothing a
      // human needs to investigate; refuse-nonempty-dir still covers
      // anything else.
      rmSync(worktreeNodeModules, { recursive: true, force: true });
      createLink(primaryNodeModules, worktreeNodeModules);
      break;
    case 'create-link':
      createLink(primaryNodeModules, worktreeNodeModules);
      break;
    default:
      throw makeErr('E_UNREACHABLE', `provisionWorktreeNodeModules: unknown action ${action}`);
  }

  return { action, worktreeNodeModules, primaryNodeModules };
}

function createLink(target, linkPath) {
  symlinkSync(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
}

function realpathAttempt(p) {
  try {
    return realpathSync.native(p).replace(/\\/g, '/');
  } catch {
    return String(p).replace(/\\/g, '/');
  }
}

/** A dangling symlink fails a plain existsSync (which follows links) but is
 * still something lstatSync can see — checked separately so a broken link
 * left over from a removed primary is treated as "exists" (and relinked)
 * rather than silently falling through to 'create-link' and throwing on the
 * subsequent symlinkSync EEXIST. */
function isBrokenLink(p) {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}
