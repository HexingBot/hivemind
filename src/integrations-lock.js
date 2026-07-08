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
