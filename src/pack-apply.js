// src/pack-apply.js
// TASK-119 — Reconcile applier for skills + atomic lock commit. Wave-1
// reconciler core (docs/design/addon-packs-plan.md §2/§7/§8). Executes the
// plan produced by src/pack-reconcile.js's plan() for skill-kind resources
// only (Wave 1 scope); non-skill plan entries never reach this module.
//
// BOUNDARY (locked, TASK-120 aligns to it): the owned/vetted assimilated
// skill copy lives in a repo-tracked staging dir, `assimilated-skills/<id>/`
// (this is what the hivemind-assimilate-skill workflow, TASK-120, writes,
// provenance block included). applyPlan() MATERIALIZES an install by
// copying that owned source into the LIVE dir `.claude/skills/<id>/` — a
// local copy, never a network fetch (§7's whole point: trust moved to
// assimilate time). Dir name == the bare resource id; lock key is
// `skill:<id>`; owned source is `assimilated-skills/<id>/` — kept consistent
// so this lines up with probeSkills()'s id space (src/pack-reconcile.js).
//
// leave-and-report, no rollback (Terraform model, §8): a soft-required
// resource that fails to materialize/remove is captured in the returned
// report and the run continues; a hard-required failure aborts via the typed
// HardResourceFailureError below, but whatever ops already succeeded before
// the failure are NOT undone — the lock is still committed with their
// mutations before the error propagates.
//
// The lockfile is read once at the start and committed via writeLock
// (atomicWriteFile under the hood) exactly ONCE per run, whether the run
// ends in success or a hard abort — never once per op.
//
// `replace` ops (pin drift on an already-installed skill) are NOT executed
// by this Wave-1 applier — that is deferred scope. They are still surfaced
// in the returned report (executed: false) rather than silently dropped, so
// a caller never mistakes "not yet implemented" for "nothing to do".

import {
  existsSync, mkdirSync, cpSync, rmSync, readdirSync, readFileSync,
} from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';

import { readLock, writeLock, addOwner, dropOwner, isOrphaned } from './integrations-lock.js';

const SKILL_ID_PREFIX = 'skill:';
const DEFAULT_SOURCE_SUBDIR = 'assimilated-skills';
const LIVE_SKILLS_SUBDIR = ['.claude', 'skills'];

/**
 * Thrown when a `required: "hard"` resource fails to apply. Aborts the run
 * (see the module header's leave-and-report note — prior successful ops are
 * NOT rolled back; the lock is committed with them before this is thrown).
 */
export class HardResourceFailureError extends Error {
  constructor(id, cause) {
    super(`pack-apply: hard-required resource "${id}" failed to apply: ${cause && cause.message ? cause.message : cause}`);
    this.name = 'HardResourceFailureError';
    this.code = 'E_PACK_APPLY_HARD_FAILURE';
    this.id = id;
    this.cause = cause;
  }
}

function bareSkillId(id) {
  return id.startsWith(SKILL_ID_PREFIX) ? id.slice(SKILL_ID_PREFIX.length) : id;
}

function liveSkillDir(root, bareId) {
  return join(root, ...LIVE_SKILLS_SUBDIR, bareId);
}

// Recursive ignore-nothing directory walk, mirroring the sibling walkers in
// src/pack-reconcile.js and src/license-detect.js (that comment's precedent:
// a native fs.readdirSync recursion is enough here, no glob dependency —
// MINIMALISM.md rung 3). This one collects every file (not just SKILL.md)
// since it hashes a whole materialized skill directory.
function walkAllFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkAllFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

// Content hash of what was installed (the lock entry's `integrity` field) —
// every file's relative path and bytes feed one sha256, so a changed file OR
// a changed file layout changes the digest. Exported (TASK-120) so
// src/assimilate.js hashes the pre-copy source directory with the exact same
// algorithm, rather than a second hand-rolled copy of it.
export function hashDir(dir) {
  const relPaths = walkAllFiles(dir)
    .map((f) => relative(dir, f).split(sep).join('/'))
    .sort();
  const hash = createHash('sha256');
  for (const relPath of relPaths) {
    hash.update(relPath);
    hash.update(readFileSync(join(dir, relPath)));
  }
  return hash.digest('hex');
}

// install op = { id: "skill:<bareId>", resource: <descriptor resource> }.
// Materializes the owned copy, then records/updates the lock entry with the
// pack as an owner. Throws on failure (missing owned source, fs error) —
// the caller decides hard-abort vs soft-report.
function executeInstall(lock, op, { root, sourceRoot, owner }) {
  const { id, resource } = op;
  const bareId = resource.id;
  const sourceDir = join(sourceRoot, bareId);
  if (!existsSync(sourceDir)) {
    throw new Error(`owned source not found for "${bareId}": ${sourceDir}`);
  }

  const liveDir = liveSkillDir(root, bareId);
  mkdirSync(dirname(liveDir), { recursive: true });
  // TASK-120 (carried LOW from the TASK-119 review): cpSync alone MERGES into
  // a pre-existing live dir, so a stale file that the new owned source no
  // longer carries would survive a re-materialize. Clean-replace first so
  // re-materialize is idempotent.
  rmSync(liveDir, { recursive: true, force: true });
  cpSync(sourceDir, liveDir, { recursive: true });

  lock.resources[id] = {
    kind: 'skill',
    origin: resource.origin,
    pin: resource.pin,
    integrity: `sha256:${hashDir(liveDir)}`,
    scope: resource.scope,
    owners: [],
    required: resource.required,
    installed_at: new Date().toISOString(),
    install_method: 'assimilated',
    verified: 'unsigned',
  };
  addOwner(lock, id, owner);
}

// remove op = { id: "skill:<bareId>", entry: <lock entry, plan-time snapshot> }.
// `entry.required` is only ever used for the hard/soft decision on failure —
// the removal decision itself (isOrphaned) is re-derived from the CURRENT
// on-disk `lock`, never trusted from the plan's (possibly stale) snapshot.
// This is the "still-owned resource is never deleted" guarantee.
function executeRemove(lock, op, { root, owner }) {
  const { id } = op;
  dropOwner(lock, id, owner);
  if (!isOrphaned(lock, id)) return; // still wanted by another owner -> leave in place

  const liveDir = liveSkillDir(root, bareSkillId(id));
  if (existsSync(liveDir)) rmSync(liveDir, { recursive: true, force: true });
  delete lock.resources[id];
}

/**
 * Execute a reconcile plan (src/pack-reconcile.js's plan() output) for
 * skill-kind resources, committing the lockfile atomically once at the end.
 *
 * @param {object} opts
 * @param {{ install: object[], remove: object[], replace: object[], report: object[] }} opts.plan
 * @param {string} opts.lockPath - absolute path to integrations.lock.json.
 * @param {string} opts.root - project/repo root (live dir is <root>/.claude/skills).
 * @param {string} opts.owner - this run's ownership edge, e.g. "design-power@0.1.0".
 * @param {string} [opts.sourceRoot] - owned-copy staging dir; defaults to
 *   <root>/assimilated-skills (docs/design/addon-packs-plan.md §7).
 * @returns {Promise<{ report: object[] }>} apply-time report entries — soft
 *   failures and deferred (unexecuted) replace ops. Does not include the
 *   planner's own report (that stays the caller's to inspect separately).
 * @throws {HardResourceFailureError} on a hard-required resource's failure;
 *   the lock is still committed with whatever ops already succeeded.
 */
export async function applyPlan({ plan, lockPath, root, owner, sourceRoot = join(root, DEFAULT_SOURCE_SUBDIR) }) {
  const lock = await readLock(lockPath);
  const report = [];

  async function abort(id, cause) {
    await writeLock(lockPath, lock); // leave-and-report: persist prior successful ops
    throw new HardResourceFailureError(id, cause);
  }

  for (const op of plan.install || []) {
    try {
      executeInstall(lock, op, { root, sourceRoot, owner });
    } catch (err) {
      if (op.resource.required === 'hard') await abort(op.id, err);
      report.push({ id: op.id, reason: err.message, blocking: false });
    }
  }

  for (const op of plan.remove || []) {
    try {
      executeRemove(lock, op, { root, owner });
    } catch (err) {
      if (op.entry.required === 'hard') await abort(op.id, err);
      report.push({ id: op.id, reason: err.message, blocking: false });
    }
  }

  for (const op of plan.replace || []) {
    // Deferred, not this wave's scope (see module header) — reported, not
    // silently dropped, so a caller can see the gap.
    report.push({
      id: op.id,
      reason: 'replace is not yet executed by the Wave-1 applier (install/remove only)',
      blocking: false,
      executed: false,
    });
  }

  await writeLock(lockPath, lock);
  return { report };
}
