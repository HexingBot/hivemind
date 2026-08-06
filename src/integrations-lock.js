// src/integrations-lock.js
// TASK-116 — integrations.lock.json schema + atomic store with ownership edges.
// Wave-1 contract for the addon-pack reconciler (docs/design/addon-packs-plan.md
// §2). Ownership is tracked as owners[] EDGES (pack-id@version strings), NOT a
// counter — the Nix reachability model: a resource is safe to remove only when
// owners is empty, never on a decrement-to-zero counter a lost edge could
// desync. Physical removal is deliberately left to the applier (a later
// ticket): dropOwner only ever empties the owners array, never deletes the
// entry, so isOrphaned has something to report.
//
// readLock/writeLock are the only functions here that touch disk; writeLock
// goes through atomicWriteFile (src/atomic-write.js) so a crash mid-write
// never corrupts the lockfile. addOwner/dropOwner/isOrphaned are pure in-
// memory helpers — no I/O, no validation, just owners[] bookkeeping.

import { readFile } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { atomicWriteFile } from './atomic-write.js';

// TASK-023 convention (see src/project-md.js, src/task-store.js): the schema
// is inlined via a JSON import rather than an import.meta.url-relative fs
// read, so esbuild can bundle it into the self-contained dist/*.cjs plugin
// entrypoints. state/integrations-lock.schema.json remains the on-disk
// source of truth.
import __schema from '../state/integrations-lock.schema.json' with { type: 'json' };

/**
 * Thrown by addOwner/dropOwner/isOrphaned when `id` is not a key of
 * lock.resources. Fail loud on a typo'd/unregistered id rather than silently
 * no-op — mirrors UnknownNodeIdError in src/knowledge-graph.js.
 */
export class UnknownResourceIdError extends Error {
  constructor(id) {
    super(`integrations-lock: resource id "${id}" does not exist in lock.resources`);
    this.name = 'UnknownResourceIdError';
    this.code = 'E_LOCK_UNKNOWN_ID';
    this.id = id;
  }
}

// ----- ajv compile-once-per-process, mirroring src/task-store.js's
// validate-before-write convention. -----
let _validate = null;

function getValidator() {
  if (_validate) return _validate;
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  _validate = ajv.compile(__schema);
  return _validate;
}

function validateLockOrThrow(lock) {
  const validate = getValidator();
  const ok = validate(lock);
  if (ok) return;
  const errors = validate.errors || [];
  const msg = errors.map((e) => `${e.instancePath || '/'} ${e.message}`).join('; ');
  const err = new Error(`integrations.lock.json payload failed schema validation: ${msg}`);
  err.code = 'E_LOCK_INVALID';
  err.errors = errors;
  throw err;
}

/**
 * Read and parse a lockfile from `path`. Not schema-validated on read (an
 * older/newer schema_version should still be readable so a caller can decide
 * how to react) — validate-before-write is where the contract is enforced,
 * matching src/task-store.js and src/bundle.js.
 *
 * @param {string} path - absolute path to integrations.lock.json
 * @returns {Promise<object>} the parsed lock
 */
export async function readLock(path) {
  const text = await readFile(path, 'utf8');
  return JSON.parse(text);
}

/**
 * Validate `lock` against the schema, then write it to `path` atomically via
 * atomicWriteFile. An invalid payload never reaches disk (zero mutation on
 * failure).
 *
 * @param {string} path - absolute path to integrations.lock.json
 * @param {object} lock - the full lock payload ({schema_version, resources})
 */
export async function writeLock(path, lock) {
  validateLockOrThrow(lock);
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  await atomicWriteFile(path, JSON.stringify(lock, null, 2) + '\n');
}

function getEntryOrThrow(lock, id) {
  const entry = lock && lock.resources && lock.resources[id];
  if (!entry) throw new UnknownResourceIdError(id);
  return entry;
}

/**
 * Add an ownership edge to resource `id`. Idempotent: adding an edge that is
 * already present is a no-op. Mutates `lock` in place and returns it.
 *
 * @param {object} lock
 * @param {string} id - resource id, e.g. "mcp:firecrawl"
 * @param {string} owner - pack-id@version edge, e.g. "design-power@0.1.0"
 */
export function addOwner(lock, id, owner) {
  const entry = getEntryOrThrow(lock, id);
  if (!Array.isArray(entry.owners)) entry.owners = [];
  if (!entry.owners.includes(owner)) entry.owners.push(owner);
  return lock;
}

/**
 * Drop an ownership edge from resource `id`. Never deletes the entry itself
 * — even when this empties owners[] — because physical removal is the
 * applier's job, not the store's (see isOrphaned below). Mutates `lock` in
 * place and returns it.
 *
 * @param {object} lock
 * @param {string} id
 * @param {string} owner
 */
export function dropOwner(lock, id, owner) {
  const entry = getEntryOrThrow(lock, id);
  entry.owners = (entry.owners || []).filter((o) => o !== owner);
  return lock;
}

/**
 * True iff resource `id` has zero ownership edges — the Nix reachability
 * signal that it is safe for the applier to remove. Does not itself remove
 * anything.
 *
 * @param {object} lock
 * @param {string} id
 * @returns {boolean}
 */
export function isOrphaned(lock, id) {
  const entry = getEntryOrThrow(lock, id);
  return Array.isArray(entry.owners) && entry.owners.length === 0;
}

// ---------------------------------------------------------------------------
// TASK-202 — pack-id parsing + same-pack stale-version edge hygiene.
//
// Owner edges are ALWAYS composed as `${descriptor.id}@${descriptor.version}`
// (src/pack-orchestrator.js's `owner` default). parseOwnerEdge below is the
// ONE place in the codebase that parses that shape back apart — so a future
// change to the composition format has exactly one parser to update, never
// several independently-drifting copies.
// ---------------------------------------------------------------------------

/**
 * Parse an owner edge string into its pack-id and version. Uses the LAST '@'
 * (not the first) — well-defined for the documented `id@version` shape even
 * if a pack id itself ever contained '@' (descriptor ids are free-form
 * strings; nothing in src/pack-descriptor.js's schema forbids it), since a
 * VERSION containing '@' is not a documented shape at all.
 *
 * Malformed input — no '@' at all, an empty id before it, or an empty
 * version after it — returns `null` rather than guessing a split. Every
 * caller below treats `null` as "cannot be attributed to any pack-id, leave
 * it alone" — never as "assume packId === owner" or any other guess. Fail
 * safe over guessing: this repo has already lost owner edges once to an
 * over-eager normalization (TASK-200's reset-and-re-add bug), and a wrong
 * guess here would risk the same class of loss in the opposite direction —
 * silently coalescing two UNRELATED owners because a malformed string
 * happened to parse the same way.
 *
 * @param {string} owner
 * @returns {{ packId: string, version: string } | null}
 */
export function parseOwnerEdge(owner) {
  if (typeof owner !== 'string') return null;
  const at = owner.lastIndexOf('@');
  // at === -1: no '@' at all. at === 0: empty id (owner starts with '@').
  // at === owner.length - 1: empty version (owner ends with '@').
  if (at <= 0 || at === owner.length - 1) return null;
  return { packId: owner.slice(0, at), version: owner.slice(at + 1) };
}

/**
 * Drop any PRIOR owner edge that parses to the SAME packId as `currentOwner`
 * but a DIFFERENT version — the phantom same-pack stale-version edge a
 * version-bumped re-materialize would otherwise leave behind forever, since
 * preserve-and-union (TASK-200) deliberately never resets owners[] wholesale
 * and nothing else ever clears these. Called by
 * src/pack-apply.js#executeInstall BEFORE addOwner unions the current run's
 * edge in.
 *
 * An edge identical to `currentOwner` itself is kept (not stale — it's the
 * exact edge about to be re-added anyway; addOwner's own idempotency handles
 * the no-op). An edge that fails to parse, or whose packId differs from
 * `currentOwner`'s, is left completely untouched — this function only ever
 * removes a same-packId/different-version pair, nothing else. A malformed
 * `currentOwner` (parseOwnerEdge returns null) is a no-op — nothing can be
 * attributed to it, so nothing is dropped.
 *
 * @param {string[]} owners - prior owners[] (never mutated — returns a new array).
 * @param {string} currentOwner - this run's owner edge, about to be addOwner'd.
 * @returns {string[]}
 */
export function dropStaleSameOwnerEdges(owners, currentOwner) {
  const list = Array.isArray(owners) ? owners : [];
  const current = parseOwnerEdge(currentOwner);
  if (!current) return list.slice();
  return list.filter((o) => {
    if (o === currentOwner) return true;
    const parsed = parseOwnerEdge(o);
    if (!parsed) return true;
    return !(parsed.packId === current.packId && parsed.version !== current.version);
  });
}

/**
 * TASK-207 — true iff `owners` holds at least one edge that CANNOT be
 * attributed to the same packId as `currentOwner` -- i.e. some OTHER pack
 * (or an edge too malformed to prove sameness) already holds this resource.
 * Used by src/assimilate.js to distinguish a legitimate same-pack
 * re-assimilation (never a collision -- must behave exactly as before) from
 * a genuinely foreign pack joining ownership of an already-owned resourceId
 * (a real collision -- see that module's TASK-207 header comment for the
 * full field-by-field decision this gates).
 *
 * Empty/absent `owners` is never foreign (nobody currently holds the
 * resource). An edge identical to `currentOwner` itself is never foreign
 * (trivially the same pack). A `currentOwner` that fails to parse treats
 * EVERY existing owner as foreign -- fail-safe, mirroring
 * dropStaleSameOwnerEdges's own "cannot be attributed, treat conservatively"
 * doctrine, just inverted: there, an unattributable edge is left alone
 * (never dropped); here, an unattributable relationship is never assumed
 * safe (never treated as same-pack).
 *
 * @param {string[]} owners
 * @param {string} currentOwner
 * @returns {boolean}
 */
export function hasForeignOwner(owners, currentOwner) {
  const list = Array.isArray(owners) ? owners : [];
  if (list.length === 0) return false;
  const current = parseOwnerEdge(currentOwner);
  return list.some((o) => {
    if (o === currentOwner) return false;
    if (!current) return true;
    const parsed = parseOwnerEdge(o);
    if (!parsed) return true;
    return parsed.packId !== current.packId;
  });
}

/**
 * TASK-202 AC3 — the mechanical SENSOR for the condition dropStaleSameOwnerEdges
 * exists to prevent: an owners[] array carrying two or more edges that parse
 * to the SAME packId with DIFFERENT versions (a stranded phantom edge from a
 * version bump that never got cleared — whether by a regression in this
 * write path, or a lockfile written/hand-edited outside it entirely). Pure,
 * no I/O.
 *
 * A malformed edge (parseOwnerEdge returns null) is excluded from grouping —
 * it cannot be attributed to any packId, so it can neither trigger nor mask
 * a finding.
 *
 * @param {string[]} owners
 * @returns {string[]} the distinct packIds with more than one version present
 *   (empty ⇒ hygienic).
 */
export function findDuplicatePackIdOwners(owners) {
  const versionsByPackId = new Map();
  for (const o of Array.isArray(owners) ? owners : []) {
    const parsed = parseOwnerEdge(o);
    if (!parsed) continue;
    if (!versionsByPackId.has(parsed.packId)) versionsByPackId.set(parsed.packId, new Set());
    versionsByPackId.get(parsed.packId).add(parsed.version);
  }
  const dupes = [];
  for (const [packId, versions] of versionsByPackId) {
    if (versions.size > 1) dupes.push(packId);
  }
  return dupes;
}

/**
 * TASK-202 AC3 — scans every resource in a full lock payload for the
 * findDuplicatePackIdOwners condition. Returns one `{ id, packIds }` entry
 * per offending resource (empty ⇒ the whole lockfile is hygienic). Pure, no
 * I/O — the live-repo sensor in tests/integrations-lock.spec.js owns reading
 * integrations.lock.json off disk and calling this, mirroring
 * tests/graph-freshness.spec.js's own reads-the-repo's-own-committed-files
 * precedent.
 *
 * @param {object} lock - { schema_version, resources } (or any object
 *   carrying a `resources` map of the same shape).
 * @returns {{ id: string, packIds: string[] }[]}
 */
export function findLockResourcesWithDuplicatePackIdOwners(lock) {
  const resources = (lock && lock.resources) || {};
  const offenders = [];
  for (const [id, entry] of Object.entries(resources)) {
    const dupes = findDuplicatePackIdOwners(entry && entry.owners);
    if (dupes.length > 0) offenders.push({ id, packIds: dupes });
  }
  return offenders;
}
