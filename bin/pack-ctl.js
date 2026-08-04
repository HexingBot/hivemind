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
//                     replaced, report}, ...]` alongside the pre-apply `plan`.
//                     TASK-181/183/199 — the run-level `ok` is NOT a bare
//                     pass-through of any single pack's success: it also
//                     prints `planned_install_count`/`installed_count` and
//                     (TASK-199) `planned_replace_count`/`replaced_count`,
//                     and `ok` requires EVERY planned install AND every
//                     planned replace (the ones the apply-time precedence
//                     gate actually attempts -- see src/pack-apply.js's
//                     `shippedPinWins`; a deliberately deferred/kept-as-is
//                     replace is not "planned" in this count, since it is a
//                     designed no-op, not a failure) to have landed, AND no
//                     pack to have hard-aborted. A materialize failure in
//                     EITHER bucket sets `ok:false` with `code`/`message`
//                     naming the shortfall (`E_PACK_APPLY_<KIND>_FAILURE`,
//                     KIND one of aborted|total|partial) -- never a silent
//                     `ok:true` while a nested `packs[].report` entry
//                     records the truth (the Empty-result contract this
//                     ticket closes).
//   assimilate scan --path <skill>
//                     TASK-135. Prints the risky-pattern scan report
//                     ({findings, summary}) for the skill directory at --path,
//                     via src/assimilate.js#computeSkillScan (itself a thin
//                     walk-and-call wrapper over src/skill-scan.js#scanSkillContent
//                     — this CLI reuses that exact function, never
//                     reimplements the scan). Zero writes.
//   assimilate classify --path <skill>
//                     TASK-135. Prints the license verdict ({spdx_id,
//                     classification, detected_via, source_path}) for the
//                     skill directory at --path, via
//                     src/license-detect.js#detectLicense + #classifyLicense
//                     (addon-packs-plan.md §12's nearest-enclosing-wins
//                     fallback chain). Zero writes.
//   assimilate stage --source <path> --resource-id <id> --pack <id@version>
//                     [--origin <o>] [--pin <p>] --repo-root <project-root>
//                     [--decision approve|decline]
//                     [--security-verdict safe|suspicious]
//                     [--security-reasoning <text>]
//                     [--security-override true]
//                     TASK-135. Wraps src/assimilate.js#assimilateSkill
//                     unchanged — this CLI is the ONLY place the human
//                     sign-off (--decision) and the security-reviewer
//                     subagent's verdict (--security-verdict/--security-
//                     override) are ever injected; assimilateSkill itself
//                     stays LLM/network-free, and so does this CLI (both
//                     verdicts are always caller-supplied data, never computed
//                     here). Writes assimilated-skills/<resourceId>/ +
//                     records the integrations.lock.json owner ONLY when
//                     --decision approve is given AND the security-reviewer
//                     verdict is exactly "safe" (or --security-override is
//                     the *exact* string "true" — see the strict-boundary
//                     comment on runAssimilateStage below). DEFAULT-DENY
//                     (TASK-140): this CLI's own --security-verdict flag only
//                     ever accepts safe|suspicious, but the underlying
//                     src/assimilate.js#assimilateSkill gate blocks on ANY
//                     non-"safe" verdict, including an entirely absent one —
//                     every other combination (no --decision, --decision
//                     decline, no --security-verdict at all, or an
//                     un-overridden "suspicious" verdict) writes nothing and
//                     reports a `blocked_*` status with a `reason`.
//
// `--repo-root` is REQUIRED for every subcommand (unlike loop-ctl.js, which
// falls back to CLAUDE_PROJECT_DIR/cwd) — the addon-pack ops always operate on
// an explicit fixture/project root, never an implicit one; AC5 requires a
// missing --repo-root to fail fast with a clear message before any I/O. For
// `assimilate stage`, --repo-root is the TARGET PROJECT root (where
// assimilated-skills/ and integrations.lock.json live — assimilateSkill's own
// `root` opt), distinct from --source (the third-party skill's own directory).
//
// Output contract: identical to bin/loop-ctl.js — one JSON line to stdout,
// `{ ok: true, ... }` on success (exit 0) or `{ ok: false, code, message }` on
// failure (exit 1; `message` also goes to stderr). A blocked_* assimilate
// stage outcome (no write) is still `ok: true, exit 0` — it is a legitimate,
// deterministic result of the gate, not a CLI usage error.

import { pathToFileURL, fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

import { readProjectMd } from '../src/project-md.js';
import { scoreComplexity } from '../src/design-profile.js';
import { loadActivePacks } from '../src/pack-loader.js';
import { BUILTIN_PACK_DESCRIPTORS, BUILTIN_PACK_MODULES } from '../src/builtin-packs.js';
import { resolveDesired } from '../src/pack-resources.js';
import { probeSkills, plan } from '../src/pack-reconcile.js';
import { readLock } from '../src/integrations-lock.js';
import { reconcilePack } from '../src/pack-orchestrator.js';
import { assimilateSkill, computeSkillScan } from '../src/assimilate.js';
import { detectLicense, classifyLicense } from '../src/license-detect.js';
import { resolveOwnedSourceRoot } from '../src/plugin-root.js';
import { comparePinPrecedence, shippedPinWins } from '../src/pack-apply.js';

const LOCK_FILENAME = 'integrations.lock.json';
const SKILL_FILENAME = 'SKILL.md';

// TASK-181 — directory of the RUNNING file, used to locate this plugin's own
// `assimilated-skills/`. Both launch modes must work: native ESM
// (bin/pack-ctl.js in the framework repo) and the esbuild CJS bundle
// (dist/pack-ctl.cjs in a plugin cache). esbuild rewrites `import.meta` to `{}`,
// so `import.meta.url` is undefined there — the same reason __isEntry below
// carries a require.main fallback — while `__dirname` is a genuine CJS global.
// `typeof` guards both directions: __dirname is undefined under ESM, and the
// ternary short-circuits so import.meta is never read in the bundle.
const SELF_DIR = typeof __dirname !== 'undefined'
  ? __dirname
  : dirname(fileURLToPath(import.meta.url));

const SUBCOMMANDS = new Set(['resolve', 'reconcile-plan', 'reconcile-apply', 'assimilate']);

// Every subcommand currently accepts exactly one flag. Kept as a map (rather
// than a bare array) to mirror bin/loop-ctl.js's FLAG_SPEC shape so a future
// subcommand-specific flag slots in the same way.
const FLAG_SPEC = {
  resolve: ['--repo-root'],
  'reconcile-plan': ['--repo-root'],
  'reconcile-apply': ['--repo-root'],
};

// TASK-135 — `assimilate <action> [--flags]` is a nested subcommand: the
// first rest-token after "assimilate" is the action (scan|classify|stage),
// not a flag. Parsed separately from FLAG_SPEC/parseFlags (parseAssimilateArgs,
// below) so the existing single-level subcommands' own contract is untouched.
const ASSIMILATE_ACTIONS = new Set(['scan', 'classify', 'stage']);

const ASSIMILATE_FLAG_SPEC = {
  scan: ['--path'],
  classify: ['--path'],
  stage: [
    '--source', '--resource-id', '--pack', '--origin', '--pin', '--repo-root',
    '--decision', '--security-verdict', '--security-reasoning', '--security-override',
  ],
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

/** Parse `assimilate <action> [--flags]` argv (the argv AFTER the "assimilate"
 * token) into `{action, flags}`. Mirrors parseFlags' own eager-throw-before-
 * I/O contract: an unrecognized action or flag, or a flag missing its value,
 * throws immediately — no I/O has happened yet. */
export function parseAssimilateArgs(argv) {
  const [action, ...rest] = argv;
  if (!action || !ASSIMILATE_ACTIONS.has(action)) {
    throw new Error(`unknown assimilate action: ${action ?? '(none)'} — expected one of ${[...ASSIMILATE_ACTIONS].join('|')}`);
  }
  const known = new Set(ASSIMILATE_FLAG_SPEC[action]);
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (!known.has(flag)) throw new Error(`unknown flag for assimilate ${action}: ${flag}`);
    const value = rest[++i];
    if (value === undefined) throw new Error(`flag ${flag} requires a value`);
    flags[kebabToCamel(flag)] = value;
  }
  return { action, flags };
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

// ---------------------------------------------------------------------------
// TASK-135 — assimilate scan / classify / stage.
// ---------------------------------------------------------------------------

/** `assimilate scan --path <skill>` — the risky-pattern scan report, via
 * src/assimilate.js#computeSkillScan (never reimplemented here). Zero writes. */
async function runAssimilateScan(flags) {
  if (!flags.path) throw new Error('--path is required');
  const sourceSkillPath = join(flags.path, SKILL_FILENAME);
  if (!existsSync(sourceSkillPath)) {
    throw new Error(`assimilate scan: no ${SKILL_FILENAME} found at "${flags.path}"`);
  }
  return { scan: computeSkillScan(flags.path, sourceSkillPath) };
}

/** `assimilate classify --path <skill>` — the license verdict (SPDX id +
 * permissive|copyleft|unknown), via src/license-detect.js's own
 * detectLicense/classifyLicense (addon-packs-plan.md §12's nearest-enclosing
 * fallback chain, never reimplemented here). Zero writes. */
async function runAssimilateClassify(flags) {
  if (!flags.path) throw new Error('--path is required');
  const sourceSkillPath = join(flags.path, SKILL_FILENAME);
  if (!existsSync(sourceSkillPath)) {
    throw new Error(`assimilate classify: no ${SKILL_FILENAME} found at "${flags.path}"`);
  }
  const license = await detectLicense({ skillDir: flags.path });
  return {
    license: {
      spdx_id: license.spdx_id,
      classification: classifyLicense(license.spdx_id),
      detected_via: license.detected_via,
      source_path: license.source_path,
    },
  };
}

// assimilateSkill's own status -> the CLI's `blocked_*` reporting family
// (AC3/AC4: "every other combination writes nothing and exits reporting
// blocked_* with a reason"). 'blocked_security' is already named this way by
// assimilateSkill itself and already carries its own `reason`; only
// 'pending_approval'/'declined' need renaming + a synthesized reason (they
// are no-write-by-design outcomes, not assimilateSkill-reported errors).
const BLOCKED_STATUS_MAP = { pending_approval: 'blocked_pending_approval', declined: 'blocked_declined' };
const BLOCKED_REASON_MAP = {
  pending_approval: 'no --decision was given; nothing is written until an explicit --decision approve',
  declined: 'human decision was --decision decline; a terminal no, nothing is written',
};

/** `assimilate stage ...` — wraps src/assimilate.js#assimilateSkill exactly;
 * --decision/--security-verdict/--security-override are the ONLY channel
 * through which the human sign-off and the (Orchestrator-produced)
 * security-reviewer verdict ever enter this LLM/network-free CLI. */
async function runAssimilateStage(flags) {
  if (!flags.source) throw new Error('--source is required');
  if (!flags.resourceId) throw new Error('--resource-id is required');
  if (!flags.pack) throw new Error('--pack is required');
  if (!flags.repoRoot) throw new Error('--repo-root is required');
  if (flags.decision !== undefined && flags.decision !== 'approve' && flags.decision !== 'decline') {
    throw new Error(`--decision must be "approve" or "decline" (got "${flags.decision}")`);
  }
  if (flags.securityVerdict !== undefined && flags.securityVerdict !== 'safe' && flags.securityVerdict !== 'suspicious') {
    throw new Error(`--security-verdict must be "safe" or "suspicious" (got "${flags.securityVerdict}")`);
  }

  const reviewerVerdict = flags.securityVerdict
    ? { verdict: flags.securityVerdict, reasoning: flags.securityReasoning || '' }
    : null;
  // Strict CLI-boundary parse, mirroring src/assimilate.js's own downstream
  // `reviewerVerdict?.verdict !== 'safe' && securityOverride !== true`
  // default-deny check (TASK-122, inverted TASK-140): ONLY the exact string
  // "true" ever becomes the boolean true. Any other value -- missing,
  // "false", "yes", "1", a typo -- becomes false, so a truthy-but-wrong CLI
  // arg can never accidentally bypass the security gate the way a
  // loosely-truthy check would.
  const securityOverride = flags.securityOverride === 'true';

  const result = await assimilateSkill({
    source: flags.source,
    resourceId: flags.resourceId,
    pack: flags.pack,
    origin: flags.origin,
    pin: flags.pin,
    decision: flags.decision,
    root: flags.repoRoot,
    reviewerVerdict,
    securityOverride,
  });

  if (result.status === 'assimilated') return { assimilate: result };

  // Every non-write outcome is reported under the blocked_* family with a
  // human-readable reason -- never a bare pass-through of assimilateSkill's
  // own status vocabulary, which the CLI's ACs deliberately normalize.
  const status = BLOCKED_STATUS_MAP[result.status] || result.status;
  const reason = result.reason || BLOCKED_REASON_MAP[result.status] || 'nothing was written';
  return { assimilate: { ...result, status, reason } };
}

async function runAssimilate(flags) {
  switch (flags.action) {
    case 'scan': return runAssimilateScan(flags);
    case 'classify': return runAssimilateClassify(flags);
    case 'stage': return runAssimilateStage(flags);
    default:
      throw new Error(`unknown assimilate action: ${flags.action}`);
  }
}

/**
 * TASK-199 — the run-level `ok`/`failureKind` predicate for `reconcile-apply`,
 * extended to see the replace bucket TASK-182 made executable (previously
 * blind to it: bin/pack-ctl.js:461-471 pre-TASK-199 computed
 * `planned_install_count`/`installed_count` from `plan.install` only, so a
 * soft-failing replace op — e.g. a consumer's lockfile owns `skill:watch` at
 * 1.0.0, the plugin ships 2.0.0, and the plugin's owned source copy is
 * missing/corrupt — reported `ok: true`, exit 0, with the truth sitting only
 * in a nested `packs[].report` entry nobody was told to read; the shape
 * CLAUDE.md's Empty-result contract already closed once for installs
 * (TASK-181/183) and TASK-182 silently re-opened for replaces).
 *
 * DECISION (recorded here, not merely asserted): the predicate is EXTENDED,
 * not left report-only — mirroring TASK-181/183's own resolution of the same
 * defect class on the install bucket, so both buckets share one convention
 * on this output object rather than two divergent ones on the same shape.
 * `ok` now requires every planned install AND every planned replace to have
 * landed, plus no pack to have hard-aborted.
 *
 * "Planned" replaces are deliberately narrower than `computedPlan.replace`
 * (every op the PLANNER flagged for replace consideration): a replace op the
 * apply-time precedence gate (src/pack-apply.js#shippedPinWins) DEFERS —
 * installed-newer (a deliberate project override) or undecidable (a
 * non-semver pin divergence, e.g. real git-sha pins, which is what EVERY
 * built-in pack ships today — see this ticket's hand-off for the
 * production-inert note) — is a designed keep-as-is, already announced in
 * `packs[].report`, not a failure. Counting a deferred op as "planned" would
 * make `ok:false` fire on every run that correctly preserves a deliberate
 * override, which is exactly the false-alarm the Empty-result contract's
 * "no-spec-matched" case warns against (CLAUDE.md, Testing section). This
 * recomputes the SAME equal-or-newer decision applyPlan itself makes, via
 * the same exported `comparePinPrecedence`/`shippedPinWins` — never a second,
 * divergent copy of the rule — using `computedPlan.replace`'s own
 * `{from, to}`, which is known before any pack executes.
 *
 * "Landed" replaces come from each pack's own `reconcilePack()` result
 * (`replaced`, TASK-199) — a post-run signal, since only the apply-time
 * report can distinguish a materialized replace from a soft-failed one (a
 * replace target's live dir already existed before the run, so a bare
 * post-probe existence check — the technique `installed` uses — cannot tell
 * "the new content landed" from "the old content is still there").
 *
 * Pure — no I/O — so it is unit-testable independently of the real built-in
 * pack descriptors (whose git-sha pins are exactly what makes the replace
 * bucket production-inert today; see the module-header comment above the
 * `reconcile-apply` subcommand for the printed-shape summary).
 *
 * @param {{ computedPlan: {install: object[], replace: object[]}, packs: Array<{aborted: boolean, installed: string[], replaced: string[]}> }} args
 * @returns {{ ok: boolean, failureKind: string|null, plannedInstallCount: number, installedCount: number, plannedReplaceCount: number, replacedCount: number, anyAborted: boolean }}
 */
export function computeApplyOutcome({ computedPlan, packs }) {
  const plannedInstallCount = computedPlan.install.length;
  const installedCount = packs.reduce((n, p) => n + p.installed.length, 0);

  const plannedReplaceCount = computedPlan.replace
    .filter((op) => shippedPinWins(comparePinPrecedence(op.from, op.to)))
    .length;
  const replacedCount = packs.reduce((n, p) => n + p.replaced.length, 0);

  const anyAborted = packs.some((p) => p.aborted);
  const plannedTotal = plannedInstallCount + plannedReplaceCount;
  const landedTotal = installedCount + replacedCount;
  const failureKind = anyAborted
    ? 'aborted'
    : plannedTotal > 0 && landedTotal === 0
      ? 'total'
      : landedTotal < plannedTotal
        ? 'partial'
        : null;

  return {
    ok: failureKind === null,
    failureKind,
    plannedInstallCount,
    installedCount,
    plannedReplaceCount,
    replacedCount,
    anyAborted,
  };
}

async function run(subcommand, flags) {
  if (subcommand === 'assimilate') return runAssimilate(flags);

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

      // TASK-181 — the owned copies live with the PLUGIN, not in the consumer's
      // repo. Without this, reconcilePack falls back to
      // `<repoRoot>/assimilated-skills`, which exists only in the framework repo
      // — so every built-in pack skill soft-failed with "owned source not found"
      // in every downstream project. Undefined is passed through untouched so
      // reconcilePack keeps its documented default.
      // Fallbacks only: applyPlan always leads with <repoRoot>/assimilated-skills
      // so a skill the project assimilated for itself still wins over a built-in
      // of the same id.
      const sourceRoot = resolveOwnedSourceRoot({ selfDir: SELF_DIR, repoRoot });

      const packs = [];
      for (const { descriptor } of activePacks) {
        const owner = `${descriptor.id}@${descriptor.version}`;
        const packOpts = { repoRoot, descriptor, profileResult, owner };
        if (sourceRoot) packOpts.sourceRoots = [sourceRoot];
        const result = await reconcilePack(packOpts);
        packs.push({
          id: descriptor.id,
          owner,
          aborted: result.aborted,
          installed: result.installed.map((op) => op.id),
          // TASK-199 — the replace-bucket analogue of `installed`, from
          // reconcilePack's own `replaced` (executed:true report entries
          // only — see that function's header for why a post-probe can't be
          // used here the way it is for `installed`).
          replaced: result.replaced.map((op) => op.id),
          report: result.report,
        });
      }

      // TASK-181/183/199 — see computeApplyOutcome's own header for the full
      // decision record (install-bucket precedent, why "planned" replaces
      // exclude the deliberately-deferred TASK-182 keep-as-is branch, and why
      // "landed" replaces can't reuse the post-probe technique `installed`
      // uses). `ok` is full success only: every planned install AND every
      // planned (attempted) replace landed, and no pack hard-aborted.
      const {
        ok, failureKind, plannedInstallCount, installedCount,
        plannedReplaceCount, replacedCount, anyAborted,
      } = computeApplyOutcome({ computedPlan, packs });

      return {
        ok,
        // TASK-183 AC6 — the CLI's documented output contract (this module's
        // header, `{ok:false, code, message}` + non-zero exit + stderr) now
        // actually holds for a materialize failure, not just an argument
        // error: main() below checks `payload.ok` and exits 1 with this
        // message on stderr.
        ...(ok ? {} : {
          code: `E_PACK_APPLY_${failureKind.toUpperCase()}_FAILURE`,
          message: `pack-ctl reconcile-apply: ${failureKind} materialize failure -- installed ${installedCount} of ${plannedInstallCount} planned installs, replaced ${replacedCount} of ${plannedReplaceCount} planned replaces${anyAborted ? ' (a hard-required resource aborted the run)' : ''}`,
        }),
        planned_install_count: plannedInstallCount,
        installed_count: installedCount,
        // TASK-199 — always present (like the install counts above), never
        // conditional on plannedReplaceCount > 0: a caller must be able to
        // tell "no replaces were planned" (0/0) from "replaces were planned
        // and did not land" (planned > landed) without reading packs[].report.
        planned_replace_count: plannedReplaceCount,
        replaced_count: replacedCount,
        source_root: sourceRoot ?? null,
        plan: computedPlan,
        packs,
      };
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

  let flags;
  if (subcommand === 'assimilate') {
    const { action, flags: assimilateFlags } = parseAssimilateArgs(rest);
    flags = { action, ...assimilateFlags };
  } else {
    flags = parseFlags(subcommand, rest);
  }

  const result = await run(subcommand, flags);
  const payload = { ok: true, ...result };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(payload));

  // TASK-183 AC6 — the CLI's own header (`{ok:false, code, message}` +
  // non-zero exit) previously only held for a thrown argument/setup error
  // (caught below); a `run()` result that resolves NORMALLY with `ok:false`
  // (e.g. a reconcile-apply materialize failure) exited 0 with nothing on
  // stderr, contradicting it. DECISION: conform the code to the header
  // rather than rewrite the header — any `ok:false` result now also exits
  // non-zero with its message on stderr, exactly like a thrown error does.
  if (payload.ok === false) {
    if (payload.message) {
      // eslint-disable-next-line no-console
      console.error(payload.message);
    }
    process.exit(1);
  }
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
