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
//
// TASK-142 — TOCTOU close (A3): src/assimilate.js#assimilateSkill already
// records a stage-time `content_integrity` in THIS SAME lockfile at approve
// time, before any materialize (the owned copy is staged, the lock entry is
// written, but nothing is live yet — see that module's approve-path). Before
// copying an install op's owned source into the live tree, executeInstall
// below re-hashes the CURRENT staged bytes (hashOwnedSkillDir, exported
// below) and compares against that recorded baseline. A mismatch means the
// staged copy changed AFTER a human approved it and BEFORE this reconcile-
// apply run — content tampering, or at minimum an un-vetted edit — so the op
// throws ContentIntegrityMismatchError, which the existing hard/soft
// dispatch above turns into either a HardResourceFailureError abort or a
// leave-and-report entry. Either way NOTHING is copied and the lock entry is
// NEVER re-blessed with a fresh hash of the mismatched bytes — closing the
// exact bug where a stale `integrity: sha256:hashDir(liveDir)` computed
// AFTER the copy just re-certified whatever had just been copied, tampered
// or not.
//
// BACKWARD-COMPAT (documented, tested — tests/e2e/pack-apply.spec.js's
// TASK-142 describe block): an id with NO prior lock entry (never went
// through assimilateSkill — a hand-placed owned copy, or a fixture in a unit
// test) or a PRE-TASK-142 entry that carries only the legacy `integrity`
// field has no stage-time content_integrity baseline to verify against.
// Verification is skipped for that combination — inventing a retroactive
// baseline would be indistinguishable from the very TOCTOU gap this closes —
// and the pre-existing single-hash-of-what-was-just-copied behavior
// (`integrity: sha256:hashDir(liveDir)`) is preserved unchanged for it. This
// is a least-surprise, fail-safe default: a legacy/no-baseline resource never
// gets WORSE (it behaves exactly as it always did), while every resource
// that carries a real baseline gets the new tamper-check for free.

import {
  existsSync, mkdirSync, cpSync, rmSync, readdirSync, readFileSync,
} from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';

import { readLock, writeLock, addOwner, dropOwner, isOrphaned } from './integrations-lock.js';

const SKILL_ID_PREFIX = 'skill:';
const DEFAULT_SOURCE_SUBDIR = 'assimilated-skills';
const LIVE_SKILLS_SUBDIR = ['.claude', 'skills'];
const SKILL_FILENAME = 'SKILL.md';

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

/**
 * TASK-142 — thrown by executeInstall when the CURRENT staged bytes under
 * assimilated-skills/<id>/ no longer hash to the content_integrity the lock
 * recorded at assimilate/approve time. Caught by applyPlan's existing
 * hard/soft dispatch exactly like any other install failure (see the module
 * header's TOCTOU-close note) — never bypassed, never silently re-hashed.
 */
export class ContentIntegrityMismatchError extends Error {
  constructor(id, expected, actual) {
    super(`pack-apply: content integrity mismatch for "${id}": staged content now hashes to ${actual}, but the lock recorded ${expected} at assimilate/approve time -- refusing to materialize (the staged copy changed after stage-approve, before reconcile-apply)`);
    this.name = 'ContentIntegrityMismatchError';
    this.code = 'E_PACK_APPLY_CONTENT_INTEGRITY_MISMATCH';
    this.id = id;
    this.expected = expected;
    this.actual = actual;
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

// TASK-142 — hashOwnedSkillDir's canonicalization is the ONE documented rule
// (resolving the ticket's chicken-and-egg) used IDENTICALLY by the writer
// (src/assimilate.js, which calls this exported function) and this verifier:
// SKILL.md's own `- content_integrity: <value>` line is part of the bytes an
// owned skill directory is hashed over, but it also ATTESTS TO that hash —
// a self-reference.
//
// TASK-142 HIGH FIX (reviewer-reproduced post-approve tamper hole): the
// original rule canonicalized the WHOLE line (`/^- content_integrity:.*$/m`)
// regardless of its value, so an attacker who appended text to that exact
// line AFTER approve had the appended bytes erased before hashing ever saw
// them — undetected tampering, materialized verbatim into the live tree.
// The rule is now narrower on TWO axes:
//   1. VALUE shape — only a well-formed value (a real sha256 digest, or the
//      transient write-time placeholder "(pending)") is canonicalized away.
//      Anything else on that exact line — most importantly a valid hash
//      with attacker-appended trailing text — FAILS to match and is left IN
//      the hashed bytes, so the tamper changes the digest instead of being
//      silently erased.
//   2. LOCATION — canonicalization only ever looks at text AFTER the
//      "## Sources & provenance (hivemind)" heading (PROVENANCE_HEADING,
//      matching src/assimilate.js's writer and src/pack-reconcile.js's
//      parser). A skill BODY that happens to contain a decoy line shaped
//      like `- content_integrity: sha256:...` sits BEFORE that heading (the
//      block is always appended, never prepended) and is therefore never
//      touched — it hashes as ordinary body content, same as any other line.
// Within the block, canonicalization additionally requires EXACTLY ONE
// well-formed match; zero (the tamper case) or more than one (a structurally
// malformed block) both leave the block's bytes UNCHANGED for hashing —
// fail-closed by construction (the anomaly stays in the digest and causes a
// mismatch), never a thrown exception that could short-circuit the caller's
// normal mismatch-report path.
// TASK-149 — exported so src/assimilate.js and src/pack-reconcile.js import
// this SAME literal instead of each keeping an independent copy: pre-fix, the
// heading string existed as three separate copies, and if they ever drifted
// canonicalizeSkillTextForContentHash below would silently stop finding the
// heading, skip canonicalization, and every untampered skill would
// false-mismatch at reconcile (fail-closed but WRONG -- legit installs would
// break). This module is the shared home because it is the only one of the
// three with no import edge FROM the other two (src/assimilate.js already
// imports hashDir/hashOwnedSkillDir from here; src/pack-reconcile.js imports
// nothing from either sibling) -- adding this export creates no cycle.
export const PROVENANCE_HEADING = '## Sources & provenance (hivemind)';
const CONTENT_INTEGRITY_VALUE_RE = /^- content_integrity: (sha256:[0-9a-f]{64}|\(pending\))\s*$/m;
const CONTENT_INTEGRITY_HASH_PLACEHOLDER_LINE = '- content_integrity: <redacted-for-hash>';

function canonicalizeSkillTextForContentHash(text) {
  const headingIdx = text.lastIndexOf(PROVENANCE_HEADING);
  if (headingIdx === -1) return text; // no provenance block at all -- hash the file as-is.

  const before = text.slice(0, headingIdx);
  const block = text.slice(headingIdx);

  const matches = block.match(new RegExp(CONTENT_INTEGRITY_VALUE_RE.source, 'gm'));
  if (!matches || matches.length !== 1) return text; // 0 or >1 well-formed matches -- do not canonicalize.

  return before + block.replace(CONTENT_INTEGRITY_VALUE_RE, CONTENT_INTEGRITY_HASH_PLACEHOLDER_LINE);
}

/**
 * Content hash of an OWNED skill directory (assimilated-skills/<id>/ or, once
 * materialized, .claude/skills/<id>/) — TASK-142's `content_integrity`.
 * Identical to hashDir's relPath+bytes-per-file algorithm, except the
 * top-level SKILL.md's WELL-FORMED `- content_integrity: <value>` line,
 * scoped to inside the provenance block, is canonicalized away first (see
 * canonicalizeSkillTextForContentHash above) so the hash never depends on
 * its own recorded value — the chicken-and-egg fix. Anything that doesn't
 * match that narrow shape (tampered trailing text, a decoy line outside the
 * block, a malformed/duplicated block) is hashed AS-IS, not canonicalized.
 *
 * @param {string} dir - the owned skill directory to hash.
 * @param {{ skillText?: string }} [opts] - `skillText`, when given, is used
 *   INSTEAD of reading SKILL_FILENAME from `dir` — lets a caller preview the
 *   hash an in-memory rewritten SKILL.md text would produce without writing
 *   it to disk first (src/assimilate.js uses this both for the
 *   pending_approval preview, against the untouched `source` dir, and for
 *   the real approve-time write, against the freshly-copied `ownedDir`
 *   before its SKILL.md has been overwritten with the final rescoped text).
 * @returns {string} hex sha256 digest (no `sha256:` prefix — same convention as hashDir).
 */
export function hashOwnedSkillDir(dir, opts = {}) {
  const { skillText } = opts;
  const relPaths = walkAllFiles(dir)
    .map((f) => relative(dir, f).split(sep).join('/'))
    .sort();
  const hash = createHash('sha256');
  for (const relPath of relPaths) {
    hash.update(relPath);
    if (relPath === SKILL_FILENAME) {
      const text = skillText !== undefined ? skillText : readFileSync(join(dir, relPath), 'utf8');
      hash.update(canonicalizeSkillTextForContentHash(text), 'utf8');
    } else {
      hash.update(readFileSync(join(dir, relPath)));
    }
  }
  return hash.digest('hex');
}

// install op = { id: "skill:<bareId>", resource: <descriptor resource> }.
// Materializes the owned copy, then records/updates the lock entry with the
// pack as an owner. Throws on failure (missing owned source, fs error) —
// the caller decides hard-abort vs soft-report.
function executeInstall(lock, op, { root, sourceRoot, sourceRoots, owner }) {
  const { id, resource } = op;
  const bareId = resource.id;
  // TASK-181 — owned copies can live in more than one place, so this is a
  // SEARCH PATH, not a single directory. The project's own
  // `<repoRoot>/assimilated-skills/` comes first (that is where
  // src/assimilate.js stages a skill the project itself adopted, and a local
  // adoption must always beat a built-in of the same id), with the plugin's own
  // owned copies as the fallback that makes built-in packs work in a consumer
  // project at all. A single-element path is exactly the old behavior.
  const searchPath = Array.isArray(sourceRoots) && sourceRoots.length ? sourceRoots : [sourceRoot];
  const sourceDir = searchPath
    .filter(Boolean)
    .map((base) => join(base, bareId))
    .find((dir) => existsSync(dir));
  if (!sourceDir) {
    const tried = searchPath.filter(Boolean).map((base) => join(base, bareId)).join(', ');
    throw new Error(`owned source not found for "${bareId}": ${tried}`);
  }

  // TASK-142 — TOCTOU close: verify BEFORE touching the live tree at all (see
  // the module header). A stage-time baseline only exists when the CURRENT
  // lock entry already carries BOTH new-style fields (an entry with only the
  // legacy `integrity`, or no entry at all, has nothing to verify against —
  // documented backward-compat, see the module header).
  const priorEntry = lock.resources[id];
  const hasStageTimeBaseline = Boolean(priorEntry && priorEntry.content_integrity && priorEntry.source_integrity);
  if (hasStageTimeBaseline) {
    const actualContentIntegrity = `sha256:${hashOwnedSkillDir(sourceDir)}`;
    if (actualContentIntegrity !== priorEntry.content_integrity) {
      throw new ContentIntegrityMismatchError(id, priorEntry.content_integrity, actualContentIntegrity);
    }
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
    // TASK-142 — a verified baseline is carried FORWARD unchanged (it was
    // already proven to match the bytes just copied); never recomputed from
    // liveDir, which is exactly the "re-bless with a fresh hash" pattern this
    // ticket closes. A no-baseline (legacy/no-prior-entry) install keeps the
    // pre-TASK-142 behavior of hashing what was just copied.
    ...(hasStageTimeBaseline
      ? { source_integrity: priorEntry.source_integrity, content_integrity: priorEntry.content_integrity }
      : { integrity: `sha256:${hashDir(liveDir)}` }),
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
 * @param {string[]} [opts.sourceRoots] - TASK-181. Ordered SEARCH PATH of
 *   owned-copy dirs, first match wins per resource. Supersedes `sourceRoot`
 *   when non-empty. Exists because a built-in pack's owned copy ships with the
 *   PLUGIN while a project's self-assimilated skill lives under its own root —
 *   one directory cannot serve both. `<root>/assimilated-skills` is prepended
 *   by default so a local adoption always beats a built-in of the same id.
 * @returns {Promise<{ report: object[] }>} apply-time report entries — soft
 *   failures and deferred (unexecuted) replace ops. Does not include the
 *   planner's own report (that stays the caller's to inspect separately).
 * @throws {HardResourceFailureError} on a hard-required resource's failure;
 *   the lock is still committed with whatever ops already succeeded.
 */
export async function applyPlan({
  plan, lockPath, root, owner,
  sourceRoot = join(root, DEFAULT_SOURCE_SUBDIR),
  sourceRoots,
}) {
  const lock = await readLock(lockPath);
  const report = [];

  // The project's own staging dir always leads the search path; extra roots
  // (the plugin's owned copies) are fallbacks appended in caller order, deduped
  // so a framework-repo run — where repoRoot IS the plugin root — does not probe
  // the same directory twice.
  const searchPath = [...new Set([sourceRoot, ...(sourceRoots || [])].filter(Boolean))];

  async function abort(id, cause) {
    await writeLock(lockPath, lock); // leave-and-report: persist prior successful ops
    throw new HardResourceFailureError(id, cause);
  }

  for (const op of plan.install || []) {
    try {
      executeInstall(lock, op, { root, sourceRoots: searchPath, owner });
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
