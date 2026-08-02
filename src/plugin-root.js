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

// TASK-183 AC10 — CONTESTED, now resolved. The 2026-08-02 deep review's pass 1
// flagged this walk as MEDIUM ("walks to the filesystem root, accepts any
// stray assimilated-skills/ it finds"); pass 2's verifier REFUTED it,
// reasoning that exploiting a NEAR ancestor requires write access to a tree
// the resolver already implicitly trusts (wherever the running file itself
// lives) — an attacker with that access could tamper with the plugin's own
// files directly and would not need this walk at all.
//
// Both are partly right. A compromised NEAR ancestor is not meaningfully
// worse than a compromised plugin install, as pass 2 argues. But the walk as
// originally written had NO upper bound at all: on a deeply nested `selfDir`
// it keeps climbing past every plausible install boundary, all the way to a
// FAR ancestor shared by unrelated software (a user's home directory, a
// drive root) that could hold its OWN unrelated `assimilated-skills/` — no
// attacker and no compromised trust required, just an unlucky coincidence of
// directory names picking up someone else's files. That risk survives pass
// 2's own framing and costs nothing to close.
//
// DECISION: bound the walk rather than (a) leave it unbounded, matching pass
// 1's MEDIUM as still-live, or (b) add stronger hardening (e.g. requiring a
// provenance check on an ancestor-discovered root) — the latter is
// unwarranted complexity for a risk this walk only ever hands back a PATH
// from; the actual trust boundary is materialize-time SKILL.md validation
// (isRealOwnedSkillCopy, src/pack-apply.js#executeInstall) and, when a
// stage-time baseline exists, the TASK-142 content-integrity re-hash — both
// of which apply regardless of which candidate in the search path won. Every
// real launch mode (framework bin/, bundled dist/ under a plugin cache)
// resolves within 1-2 ancestor levels; MAX_ANCESTOR_LEVELS below is far more
// generous than any plausible install nesting while still meaningfully
// bounding the blast radius on a pathologically deep `selfDir`.
const MAX_ANCESTOR_LEVELS = 12;

/**
 * Every ancestor of `dir`, nearest first, including `dir` itself, bounded to
 * MAX_ANCESTOR_LEVELS (TASK-183 AC10, see the decision above) — never walks
 * all the way to the filesystem root on a deeply nested `dir`. The
 * fixed-point check (`parent === current`) still terminates early on a
 * shallow path, so this is correct for POSIX and Windows drive roots alike.
 */
function ancestorsOf(dir) {
  const out = [];
  let current = dir;
  for (let i = 0; i < MAX_ANCESTOR_LEVELS; i++) {
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
