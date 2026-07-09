#!/usr/bin/env node
// bin/pack-ctl.js
// TASK-134 — CLI wrapper exposing the deterministic addon-pack ops
// (resolveDesired / pack-reconcile / pack-orchestrator) so a plugin-installed
// project (no framework src/ on disk) can drive the Wave-1 (skills-only)
// reconciler via ${CLAUDE_PLUGIN_ROOT}/dist/pack-ctl.cjs. Mirrors
// bin/loop-ctl.js -> dist/loop-ctl.cjs exactly (arg parsing, `--repo-root`,
// single-JSON-line stdout, non-zero exit on error, zero external deps) — see
// that file's header for the established precedent this ticket copies.
//
// Subcommands:
//   resolve          --repo-root <path>
//                     Reads the fixture project's PROJECT.md tier/perfil_proyecto
//                     (src/project-md.js) and the built-in active pack
//                     descriptors (src/builtin-packs.js, loaded via
//                     src/pack-loader.js#loadActivePacks), reconstructs the
//                     {tier, axes, activations} shape resourceActivations()
//                     expects (profileResultFromFrontmatter, below), and
//                     prints the resolved desired resource set — identical to
//                     calling src/pack-resources.js#resolveDesired() directly
//                     for every active pack, flattened in pack order
//                     (aggregateDesired, below).
//   reconcile-plan   --repo-root <path>
//                     Same desired-set resolution as `resolve`, diffed against
//                     the fixture's actual on-disk skills (src/pack-reconcile.js
//                     #probeSkills) and integrations.lock.json (read-only; a
//                     missing lockfile is treated as empty, never created) via
//                     src/pack-reconcile.js#plan(). Prints
//                     {install,remove,replace,report}. Zero writes.
//   reconcile-apply  --repo-root <path>
//                     Computes the same plan as `reconcile-plan` (printed
//                     verbatim as `plan`, letting a second run's freshly
//                     recomputed plan prove idempotency), then actually
//                     materializes it — once per active pack, via
//                     src/pack-orchestrator.js#reconcilePack (which owns the
//                     lock read/write atomicity and the leave-and-report hard/
//                     soft failure handling; this CLI does not reimplement any
//                     of that). Prints `packs: [{id, owner, aborted, installed,
//                     report}, ...]` alongside the pre-apply `plan`.
//
// `--repo-root` is REQUIRED for every subcommand (unlike loop-ctl.js, which
// falls back to CLAUDE_PROJECT_DIR/cwd) — the addon-pack ops always operate on
// an explicit fixture/project root, never an implicit one; AC5 requires a
// missing --repo-root to fail fast with a clear message before any I/O.
//
// Output contract: identical to bin/loop-ctl.js — one JSON line to stdout,
// `{ ok: true, ... }` on success (exit 0) or `{ ok: false, code, message }` on
// failure (exit 1; `message` also goes to stderr).

import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { readProjectMd } from '../src/project-md.js';
import { scoreComplexity } from '../src/design-profile.js';
import { loadActivePacks } from '../src/pack-loader.js';
import { BUILTIN_PACK_DESCRIPTORS, BUILTIN_PACK_MODULES } from '../src/builtin-packs.js';
import { resolveDesired } from '../src/pack-resources.js';
import { probeSkills, plan } from '../src/pack-reconcile.js';
import { readLock } from '../src/integrations-lock.js';
import { reconcilePack } from '../src/pack-orchestrator.js';

const LOCK_FILENAME = 'integrations.lock.json';

const SUBCOMMANDS = new Set(['resolve', 'reconcile-plan', 'reconcile-apply']);

// Every subcommand currently accepts exactly one flag. Kept as a map (rather
// than a bare array) to mirror bin/loop-ctl.js's FLAG_SPEC shape so a future
// subcommand-specific flag slots in the same way.
const FLAG_SPEC = {
  resolve: ['--repo-root'],
  'reconcile-plan': ['--repo-root'],
  'reconcile-apply': ['--repo-root'],
};

function kebabToCamel(flag) {
  return flag.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/** Parse argv (after the subcommand token) into a plain object. Unknown flags
 * and missing values throw immediately (typo protection, no I/O yet) —
 * mirrors bin/loop-ctl.js#parseFlags. */
export function parseFlags(subcommand, argv) {
  const known = new Set(FLAG_SPEC[subcommand] || []);
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!known.has(flag)) throw new Error(`unknown flag for ${subcommand}: ${flag}`);
    const value = argv[++i];
    if (value === undefined) throw new Error(`flag ${flag} requires a value`);
    out[kebabToCamel(flag)] = value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// profileResultFromFrontmatter — the reverse of
// src/design-profile.js#deriveProfileFields. PROJECT.md only ever persists
// the FLAT string-scalar perfil_proyecto map (src/project-md.js's inline-
// object frontmatter encoding cannot round-trip nested objects/arrays), so a
// project's real scoreComplexity(answers) result is never re-readable
// directly — this reconstructs the {tier, axes, activations} shape
// resourceActivations()/resolveDesired() need FROM that flat map, field for
// field, the exact inverse of deriveProfileFields' own `raw` -> perfil_proyecto
// String() mapping. Pure — no I/O.
//
// When no design profile was ever derived for this project (design_heavy !==
// 'yes' at intake — src/builtin-packs.js's deriveProjectMdGated gate — so
// PROJECT.md carries neither `tier` nor `perfil_proyecto` at all), this
// delegates to a REAL scoreComplexity({}) call rather than hand-crafting an
// equivalent object, so the "no design profile" default can never drift from
// the one true source of that shape.
//
// @param {{tier?: string, perfil_proyecto?: Record<string,string>}} answers -
//   the `answers` object readProjectMd() returns (or an equivalent stand-in).
// @returns {{tier: string, score: number, axes: {functionality: number, beauty: number}, activations: object}}
export function profileResultFromFrontmatter(answers) {
  const { tier, perfil_proyecto: p } = answers || {};
  if (tier === undefined || !p || Object.keys(p).length === 0) {
    return scoreComplexity({});
  }
  const toBool = (v) => v === 'true';
  return {
    tier,
    score: Number(p.score) || 0,
    axes: {
      functionality: Number(p.functionality) || 0,
      beauty: Number(p.beauty) || 0,
    },
    activations: {
      design_heavy: toBool(p.design_heavy),
      framework: p.framework ?? null,
      is_canvas: toBool(p.is_canvas),
      ui_outside_canvas: toBool(p.ui_outside_canvas),
      motion_required: toBool(p.motion_required),
      motion_layer: p.motion_layer ?? null,
      needs_research: toBool(p.needs_research),
      assets: toBool(p.assets),
      assets_list: p.assets_list ? p.assets_list.split('+') : [],
    },
  };
}

/**
 * Flatten src/pack-resources.js#resolveDesired() across every active pack, in
 * pack order — never a reimplementation of resolveDesired's own filtering,
 * just the per-pack concatenation glue a multi-pack Wave-1 caller needs.
 *
 * @param {Array<{descriptor: object, module: object}>} activePacks -
 *   src/pack-loader.js#loadActivePacks()'s own `.activePacks` shape.
 * @param {object} profileResult - scoreComplexity(answers)'s return value
 *   (or profileResultFromFrontmatter's reconstruction of it).
 * @returns {Array<object>}
 */
export function aggregateDesired(activePacks, profileResult) {
  const out = [];
  for (const { descriptor } of activePacks) {
    out.push(...resolveDesired(descriptor, profileResult));
  }
  return out;
}

/** Read PROJECT.md + resolve the active built-in packs + reconstruct the
 * profile result — the shared setup every subcommand needs. Real disk I/O
 * (readProjectMd); throws (PROJECT.md-not-found's own clear message) before
 * any lock/skill I/O ever happens. */
async function loadProfile(repoRoot) {
  const { answers } = await readProjectMd({ repoRoot });
  const profileResult = profileResultFromFrontmatter(answers);
  const { activePacks } = loadActivePacks({
    descriptors: BUILTIN_PACK_DESCRIPTORS,
    moduleRegistry: BUILTIN_PACK_MODULES,
  });
  return { profileResult, activePacks };
}

/** Read the lockfile if present, else the canonical empty shape — read-only,
 * never creates the file (mirrors src/pack-orchestrator.js's own default
 * shape, but without that module's create-if-missing write, since a
 * read-only subcommand must make zero writes). */
async function readLockTolerant(lockPath) {
  if (!existsSync(lockPath)) return { schema_version: 1, resources: {} };
  return readLock(lockPath);
}

async function run(subcommand, flags) {
  if (!flags.repoRoot) throw new Error('--repo-root is required');
  const repoRoot = flags.repoRoot;

  switch (subcommand) {
    case 'resolve': {
      const { profileResult, activePacks } = await loadProfile(repoRoot);
      return { desired: aggregateDesired(activePacks, profileResult) };
    }
    case 'reconcile-plan': {
      const { profileResult, activePacks } = await loadProfile(repoRoot);
      const desired = aggregateDesired(activePacks, profileResult);
      const actual = probeSkills(repoRoot);
      const lock = await readLockTolerant(join(repoRoot, LOCK_FILENAME));
      return { plan: plan(desired, lock, actual) };
    }
    case 'reconcile-apply': {
      const { profileResult, activePacks } = await loadProfile(repoRoot);
      const desired = aggregateDesired(activePacks, profileResult);
      const actual = probeSkills(repoRoot);
      const lock = await readLockTolerant(join(repoRoot, LOCK_FILENAME));
      // Computed BEFORE applying so a second run's freshly recomputed plan
      // (against the now-materialized state) is the idempotency proof — see
      // this module's header.
      const computedPlan = plan(desired, lock, actual);

      const packs = [];
      for (const { descriptor } of activePacks) {
        const owner = `${descriptor.id}@${descriptor.version}`;
        const result = await reconcilePack({ repoRoot, descriptor, profileResult, owner });
        packs.push({
          id: descriptor.id,
          owner,
          aborted: result.aborted,
          installed: result.installed.map((op) => op.id),
          report: result.report,
        });
      }

      return { plan: computedPlan, packs };
    }
    default:
      throw new Error(`unknown subcommand: ${subcommand}`);
  }
}

async function main() {
  const [subcommand, ...rest] = process.argv.slice(2);
  if (!subcommand || !SUBCOMMANDS.has(subcommand)) {
    throw new Error(`usage: pack-ctl <${[...SUBCOMMANDS].join('|')}> [--flags]`);
  }
  const flags = parseFlags(subcommand, rest);
  const result = await run(subcommand, flags);
  const payload = { ok: true, ...result };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(payload));
}

// Only run when invoked as the entry script (not on import from tests).
const __isEntry = import.meta.url
  ? Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href
  : (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module);

if (__isEntry) {
  main().catch((err) => {
    const payload = { ok: false, code: err.code || 'E_ARGS', message: err.message };
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(payload));
    // eslint-disable-next-line no-console
    console.error(err.message);
    process.exit(1);
  });
}

export { run };
