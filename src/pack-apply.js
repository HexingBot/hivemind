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

// TASK-182 — dual-copy precedence (human decision, direction (a), recorded on
// the ticket 2026-08-04): "the reconciler retires the project-scope resource
// when the plugin ships the same resource id at an equal-or-newer pin; the
// project-scope copy survives only when it is ahead of the plugin." Also
// settles the TASK-181 accident: applyPlan's search-path precedence (below)
// let a STALE project copy silently shadow a NEWER plugin copy purely by
// existsSync ordering, with no pin awareness at all -- the exact inversion of
// this rule.
//
// The wrinkle the direction does not settle on its own: `pin` is documented
// (state/integrations-lock.schema.json) as "commit-sha or exact semver --
// never a range", and a git-sha pin has NO natural order. Given an installed
// pin A and a shipped pin B, no arithmetic says which is newer unless BOTH
// happen to parse as semver (major.minor.patch). INVESTIGATED alternatives
// (recorded, not merely asserted):
//   - an ORDERABLE VERSION FIELD alongside the sha (schema addition +
//     lockfile migration for every existing entry) -- rejected as more
//     machinery than this ticket's single concrete case (watch) justifies,
//     and the schema already permits an exact-semver `pin` today, so a pack
//     that wants orderability can already choose that shape without a schema
//     change.
//   - PROVENANCE-BASED ordering (resolve from "when was each pin adopted")
//     -- rejected because the PLUGIN's candidate is never itself a lock
//     entry (assimilateSkill only records an entry for a PROJECT's own
//     staged/installed copy), so there is no "installed_at" to compare the
//     plugin's shipped pin against in the first place; this doesn't actually
//     resolve the comparison it would need to resolve.
//   - EQUALITY-ONLY (retire only on a byte-identical pin, keep-and-surface on
//     any divergence) -- the always-safe fallback, but leaves the exact
//     scenario AC6 exists to test (a genuinely newer plugin pin) unresolved.
// CHOSEN: semver-aware comparison, reusing the pin field's ALREADY-PERMITTED
// semver shape (no schema/migration cost) -- decidable when both sides parse
// as semver, honestly 'undecidable' otherwise. Per the repo's Empty-result
// contract, 'undecidable' must stay distinguishable from 'equal' and must
// NEVER silently resolve to retiring the project's copy -- every caller below
// treats it as the safe keep-both-and-surface outcome. In production, a real
// git-sha `watch` pin divergence is therefore always 'undecidable' today
// (reported, kept) unless/until a pack chooses to pin via semver instead.
const SEMVER_TRIAD_RE = /^(\d+)\.(\d+)\.(\d+)/;

/**
 * Compare an INSTALLED (project-scope, already-in-the-lock) pin against a
 * SHIPPED (plugin-desired, from the active descriptor's `resource.pin`) pin.
 * Pure, no I/O. See the block comment above for the full decision record.
 *
 * @param {string} installedPin
 * @param {string} shippedPin
 * @returns {'equal'|'installed-newer'|'shipped-newer'|'undecidable'}
 */
export function comparePinPrecedence(installedPin, shippedPin) {
  if (installedPin === shippedPin) return 'equal';
  const a = typeof installedPin === 'string' ? installedPin.match(SEMVER_TRIAD_RE) : null;
  const b = typeof shippedPin === 'string' ? shippedPin.match(SEMVER_TRIAD_RE) : null;
  if (!a || !b) return 'undecidable';
  for (let i = 1; i <= 3; i++) {
    const na = Number(a[i]);
    const nb = Number(b[i]);
    if (na !== nb) return na > nb ? 'installed-newer' : 'shipped-newer';
  }
  // Identical major.minor.patch (only a pre-release/build suffix differs, or
  // no suffix at all beyond what SEMVER_TRIAD_RE captured) -- treated as
  // equal, not undecidable; the numeric triad is what's actually orderable.
  return 'equal';
}

/** True iff `precedence` means the PLUGIN's shipped pin should win (equal-or-
 * newer, per the chosen rule above) -- the single predicate every call site
 * below shares, so "equal-or-newer" is defined in exactly one place. */
function shippedPinWins(precedence) {
  return precedence === 'equal' || precedence === 'shipped-newer';
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

// TASK-183 — a bare `existsSync(dir)` only ever proved a DIRECTORY exists, not
// that it holds a real owned skill copy (unlike src/assimilate.js's own
// source-validation, which requires a readable SKILL.md before assimilating
// anything). Before TASK-181 there was a single sourceRoot, so nothing could
// shadow it; the multi-root search path TASK-181 introduced made this
// load-bearing — an EMPTY assimilated-skills/<id>/ passed the old check and
// shadowed a perfectly good candidate later in the search path, silently
// materializing an empty skill dir and blessing it with the empty-tree
// SHA-256 as a "verified" integrity. This applies the SAME SKILL.md-presence
// rule assimilate.js already uses, so an invalid/empty candidate is skipped
// in favour of the next entry instead of winning by mere existsSync presence.
function isRealOwnedSkillCopy(dir) {
  const skillPath = join(dir, SKILL_FILENAME);
  if (!existsSync(skillPath)) return false;
  try {
    readFileSync(skillPath);
    return true;
  } catch {
    return false;
  }
}

// install op = { id: "skill:<bareId>", resource: <descriptor resource> }.
// Materializes the owned copy, then records/updates the lock entry with the
// pack as an owner. Throws on failure (no valid owned source, fs error) —
// the caller decides hard-abort vs soft-report.
//
// TASK-183 AC9 — this function's ONLY caller (applyPlan, below) always builds
// and passes `sourceRoots` (never a bare `sourceRoot`) — the old
// `sourceRoots.length ? sourceRoots : [sourceRoot]` fallback was therefore
// unreachable dead code. Removed rather than kept "for safety"; `sourceRoots`
// is now the sole, required search-path input.
//
// TASK-182 — `projectSourceRoot`, when given, is the ONE entry in
// `sourceRoots` that represents the project's own default staging dir
// (applyPlan's `sourceRoot` param, always searchPath[0]). It is excluded from
// the search ONLY when there is a real, DECIDABLE divergence between the
// prior lock entry's pin and what's currently desired AND the plugin's
// shipped pin wins (comparePinPrecedence, above) — otherwise the pre-existing
// TASK-181 project-leads order is completely untouched (a fresh install with
// no prior entry, an installed-newer/undecidable divergence, or no
// divergence at all all fall through unchanged). Returns retirement metadata
// so both applyPlan loops (install/replace) can announce it identically —
// see the "must never be silent" constraint on TASK-182.
function executeInstall(lock, op, {
  root, sourceRoots, owner, projectSourceRoot,
}) {
  const { id, resource } = op;
  const bareId = resource.id;

  const priorEntry = lock.resources[id];
  const hasPriorPin = Boolean(priorEntry && priorEntry.pin !== undefined);
  const pinDiverges = hasPriorPin && priorEntry.pin !== resource.pin;
  const precedence = pinDiverges ? comparePinPrecedence(priorEntry.pin, resource.pin) : null;
  const retiring = pinDiverges && shippedPinWins(precedence);

  // TASK-181 — owned copies can live in more than one place, so this is a
  // SEARCH PATH, not a single directory. applyPlan (the only caller) always
  // leads this array with the project's own `<repoRoot>/assimilated-skills/`
  // (where src/assimilate.js stages a skill the project itself adopted, so a
  // local adoption always beats a built-in of the same id BY DEFAULT), with
  // the plugin's own owned copies as fallbacks that make built-in packs work
  // in a consumer project at all. TASK-182 narrows that default: when
  // `retiring` is true, the project's own candidate is dropped from the
  // search entirely so this materialize cannot re-select the very stale
  // content driving the divergence it exists to resolve.
  const effectiveSourceRoots = retiring && projectSourceRoot
    ? (sourceRoots || []).filter((base) => base !== projectSourceRoot)
    : sourceRoots;
  const candidates = (Array.isArray(effectiveSourceRoots) ? effectiveSourceRoots : [])
    .filter(Boolean)
    .map((base) => join(base, bareId));
  // TASK-183 AC2 — an invalid/empty candidate is skipped in favour of the
  // next entry; if NO candidate is valid the resource fails loudly (an
  // Error, dispatched by the caller into either a report entry naming what
  // was tried, or a hard abort) instead of silently materializing nothing.
  const sourceDir = candidates.find((dir) => isRealOwnedSkillCopy(dir));
  if (!sourceDir) {
    throw new Error(`owned source not found for "${bareId}" (no candidate held a readable ${SKILL_FILENAME}): ${candidates.join(', ')}`);
  }

  // TASK-142 — TOCTOU close: verify BEFORE touching the live tree at all (see
  // the module header). A stage-time baseline only exists when the CURRENT
  // lock entry already carries BOTH new-style fields (an entry with only the
  // legacy `integrity`, or no entry at all, has nothing to verify against —
  // documented backward-compat, see the module header). TASK-182: the
  // baseline is ALSO only meaningful when we are re-materializing the SAME
  // pin that was staged — a deliberate pin switch (this ticket's retire
  // path) makes the OLD baseline describe different content by definition,
  // so comparing fresh (correct) content against a stale baseline would
  // always false-mismatch. Gated on pin equality, never on `retiring` alone,
  // so a same-pin re-verify (the pre-existing TASK-142 contract) is
  // completely unaffected.
  const samePinAsBaseline = !hasPriorPin || priorEntry.pin === resource.pin;
  const hasStageTimeBaseline = samePinAsBaseline
    && Boolean(priorEntry && priorEntry.content_integrity && priorEntry.source_integrity);
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

  // TASK-200 (from TASK-182's gating review, MEDIUM-3) — a re-materialize
  // used to hard-reset owners to [] here, relying on the addOwner call below
  // to re-add ONLY the current run's pack. Any owner edge belonging to a
  // DIFFERENT pack was silently dropped in the process. Latent before
  // TASK-182 (only reachable on the unusual staged-but-not-live install
  // path); TASK-182 routed plan.replace through this SAME function, putting
  // it on the routine plugin-wins retire path -- every future retire runs
  // through here.
  //
  // Fix: PRESERVE prior owners across the reset and union the current run's
  // owner in via addOwner below, rather than resetting. Checked before
  // choosing this over an explicit reset-with-proof:
  //   - dropOwner/isOrphaned (src/integrations-lock.js) are the only other
  //     readers of owners[]; both operate on whatever the array holds at
  //     call time with exact-string membership/emptiness checks -- neither
  //     assumes or requires a fresh reset here.
  //   - executeRemove's "still-owned resource is never deleted" guarantee
  //     (isOrphaned, re-derived from the CURRENT on-disk lock) is exactly
  //     the guarantee a reset BREAKS: a dropped sibling edge would make
  //     that pack's resource look orphaned and eligible for removal in a
  //     LATER, unrelated run -- preserving is required BY that guarantee,
  //     not merely compatible with it.
  //   - no reset-with-proof is available: the condition that makes the drop
  //     live is simply two packs declaring the same resource id, which nothing
  //     in src/pack-descriptor.js's schema forbids -- so "no sibling edge can
  //     exist at this point" cannot be proven in general.
  const priorOwners = Array.isArray(priorEntry && priorEntry.owners) ? priorEntry.owners : [];
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
    owners: priorOwners,
    required: resource.required,
    installed_at: new Date().toISOString(),
    install_method: 'assimilated',
    verified: 'unsigned',
  };
  addOwner(lock, id, owner);

  // TASK-182 — retirement metadata for the caller (applyPlan) to announce;
  // "the retire is user-visible and must be announced, never silent" (the
  // ticket's second hard constraint). Undefined fromPin/precedence when there
  // was nothing to retire (a plain install/reinstall) — retired is always a
  // real boolean either way, never merely absent, so a caller can check it
  // without an existence test.
  return {
    retired: retiring,
    fromPin: hasPriorPin ? priorEntry.pin : undefined,
    toPin: resource.pin,
    precedence,
  };
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
      const result = executeInstall(lock, op, {
        root, sourceRoots: searchPath, owner, projectSourceRoot: sourceRoot,
      });
      // TASK-182 — "the retire is user-visible and must be announced, never
      // silent": a fresh install can itself retire a divergent STAGED (but
      // not-yet-live) project pin in favor of the plugin's — see
      // executeInstall's own header for why this reaches the install bucket
      // rather than replace (TASK-121 staged-vs-live).
      if (result && result.retired) {
        report.push({
          id: op.id,
          reason: `installed "${op.id}" from the plugin's shipped pin "${result.toPin}", superseding a divergent staged project pin "${result.fromPin}" (${result.precedence}, TASK-182 direction (a)) -- if this resource was also reachable under a project-scope alias, that alias now resolves through the plugin's own copy instead`,
          blocking: false,
          executed: true,
          retired: true,
        });
      }
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
    // TASK-182 — dual-copy precedence (human decision, direction (a)):
    // "equal-or-newer" plugin pin retires the stale project-scope copy in
    // place (never a bare REMOVE — AC5). Any other outcome (project
    // genuinely ahead, or a comparison this ticket's chosen rule cannot
    // decide at all) stays on the pre-existing deferred/keep-as-is path, the
    // Wave-1 applier's original scope for `replace` — reported either way,
    // never silently dropped.
    const precedence = comparePinPrecedence(op.from, op.to);
    if (!shippedPinWins(precedence)) {
      const reason = precedence === 'installed-newer'
        ? `installed pin "${op.from}" is ahead of the shipped pin "${op.to}" for "${op.id}" -- the project-scope copy is a deliberate override; kept as-is (TASK-182 direction (a))`
        : `pin drift for "${op.id}" (installed "${op.from}" vs shipped "${op.to}") cannot be ordered (non-semver pin on at least one side) -- keeping the currently-installed project-scope copy rather than risk retiring a deliberate override; review manually (TASK-182's documented residual: "cannot determine" must never silently resolve to a retire)`;
      report.push({ id: op.id, reason, blocking: false, executed: false });
      continue;
    }

    try {
      executeInstall(lock, { id: op.id, resource: op.resource }, {
        root, sourceRoots: searchPath, owner, projectSourceRoot: sourceRoot,
      });
      report.push({
        id: op.id,
        reason: `retired the project-scope copy of "${op.id}" (pin "${op.from}") in favor of the plugin's shipped pin "${op.to}" (${precedence}, TASK-182 direction (a)) -- if this resource was reachable under a project-scope alias (e.g. an unnamespaced skill/command name), that alias now resolves through the plugin's own copy instead; update any script or doc that named the old alias`,
        blocking: false,
        executed: true,
        retired: true,
      });
    } catch (err) {
      if (op.resource.required === 'hard') await abort(op.id, err);
      report.push({ id: op.id, reason: err.message, blocking: false });
    }
  }

  await writeLock(lockPath, lock);
  return { report };
}
