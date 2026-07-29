// src/plugin-root.js
// TASK-181 — resolve the directory holding a pack's OWNED skill copies
// (`assimilated-skills/`) for the applier's `sourceRoot`.
//
// The defect this fixes: src/pack-orchestrator.js#reconcilePack defaults
// `sourceRoot` to `<repoRoot>/assimilated-skills` (src/pack-apply.js's own
// DEFAULT_SOURCE_SUBDIR), and bin/pack-ctl.js never overrode it. In the
// FRAMEWORK repo that works by accident, because the repo root genuinely holds
// assimilated-skills/. In a CONSUMER project it cannot: the owned copies ship
// inside the plugin, not in the consumer's repo. Every built-in pack skill
// therefore soft-failed at materialize with `owned source not found` and
// installed nothing — while the CLI still printed ok:true, which is how this
// survived multiple releases unnoticed.
//
// Resolution order follows the precedent already in this repo
// (src/claude-settings.js#33 CLAUDE_PLUGIN_ROOT-first, bin/brain-launch.js#26's
// candidate chain) rather than inventing a new mechanism:
//
//   0. HIVEMIND_OWNED_SOURCE_ROOT — explicit operator/test override, returned
//      VERBATIM and deliberately NOT existence-checked (see below).
//   1. CLAUDE_PLUGIN_ROOT — set by Claude Code for a plugin-installed run.
//   2. Ancestors of the running file — covers both launch modes without any
//      env var: bin/pack-ctl.js (ESM, framework repo) and dist/pack-ctl.cjs
//      (bundled, plugin cache). Never uses process.cwd(), which is the
//      consumer's directory and would resolve to the original bug.
//   3. repoRoot — last, so the framework-repo behavior that works today is
//      preserved exactly when nothing earlier matches.
//
// Candidates 1-3 are accepted only if they actually CONTAIN the owned copies;
// a stale CLAUDE_PLUGIN_ROOT must not win by mere presence, or the resolver
// would hand back a confident path with nothing in it — the same failure with a
// new spelling. The explicit override at 0 is the one exception: an operator who
// names a path deserves a loud failure at materialize rather than a silent swap
// to some other directory.

import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

export const OWNED_SOURCE_SUBDIR = 'assimilated-skills';

/**
 * Every ancestor of `dir`, nearest first, including `dir` itself.
 * Terminates on the filesystem root (dirname stops changing) rather than
 * counting levels, so it is correct for POSIX and Windows drive roots alike.
 */
function ancestorsOf(dir) {
  const out = [];
  let current = dir;
  // Bounded by the path's own depth; the fixed-point check is the real guard.
  for (;;) {
    out.push(current);
    const parent = dirname(current);
    if (!parent || parent === current) break;
    current = parent;
  }
  return out;
}

/**
 * Resolve the owned-copy source root to hand to src/pack-apply.js#applyPlan.
 *
 * @param {object} [opts]
 * @param {Record<string,string|undefined>} [opts.env] - environment to read.
 * @param {string} [opts.selfDir] - directory of the RUNNING file. Callers pass
 *   `__dirname` when it exists (the esbuild CJS bundle, where esbuild rewrites
 *   `import.meta` to `{}` so `import.meta.url` is undefined) and
 *   `dirname(fileURLToPath(import.meta.url))` otherwise (native ESM).
 * @param {string} [opts.repoRoot] - the target project root; the last-resort
 *   candidate, preserving today's framework-repo behavior.
 * @param {(p: string) => boolean} [opts.exists] - injected for pure unit tests.
 * @returns {string|undefined} Absolute path to an existing owned-copy directory,
 *   the verbatim explicit override, or undefined when nothing holds owned copies
 *   (callers must be able to tell "not found" from a guess).
 */
export function resolveOwnedSourceRoot({
  env = process.env,
  selfDir,
  repoRoot,
  exists = existsSync,
} = {}) {
  if (env && env.HIVEMIND_OWNED_SOURCE_ROOT) return env.HIVEMIND_OWNED_SOURCE_ROOT;

  const bases = [];
  if (env && env.CLAUDE_PLUGIN_ROOT) bases.push(env.CLAUDE_PLUGIN_ROOT);
  if (selfDir) bases.push(...ancestorsOf(selfDir));
  if (repoRoot) bases.push(repoRoot);

  for (const base of bases) {
    const candidate = join(base, OWNED_SOURCE_SUBDIR);
    if (exists(candidate)) return candidate;
  }
  return undefined;
}
