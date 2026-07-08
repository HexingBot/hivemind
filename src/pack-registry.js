// src/pack-registry.js
// TASK-126 — Pack registry: load + validate active packs, resolve core_compat
// (Phase D-1, docs/design/addon-packs-plan.md §5/§8). First link of the
// Option-C hybrid registration hook: the pack DESCRIPTOR is the declarative
// allowlist core reads; this module decides, given a set of already-loaded
// descriptors, which ones are ADMITTED into the active-pack set later
// pipeline/question-injection phases (Phase D-2+) consume.
//
// Deliberately split pure vs I/O (ticket instruction): resolveActivePacks()
// below takes already-parsed descriptor OBJECTS and a hookApiVersion string
// and does zero disk I/O — no readFileSync, no globbing. A future loader that
// reads *.json descriptor files off disk belongs in a separate module (and a
// slow e2e spec), never here, so this resolution stays fast-tier testable.

import { validatePackDescriptor } from './pack-descriptor.js';

// The hook-API version core currently advertises. Packs declare compatibility
// against this via their descriptor's `core_compat` field (a semver range,
// e.g. ">=1.0.0" — state/pack-descriptor.schema.json). Bump this only when
// core's registration-hook contract (trigger/profile/resources/gate_scopes/
// pipeline shape) changes in a way packs need to react to.
export const HOOK_API_VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// Minimal internal semver-range check.
//
// package.json carries no `semver` dependency (checked before writing this),
// and the only core_compat forms present in the schema/example descriptors
// (state/pack-descriptor.schema.json, tests/pack-descriptor.spec.js) are
// simple single-operator comparisons like ">=1.0" / ">=1.0.0". Pulling in the
// `semver` package for that one comparison would cost a new dependency for
// behavior a ~20-line helper covers exactly and testably (Ponytail ladder:
// stop at "minimal custom" once stdlib/existing deps don't reach). Supports
// >=, >, <=, <, and bare "=" (exact) against X, X.Y, or X.Y.Z version forms.
// ---------------------------------------------------------------------------

function parseVersionParts(version) {
  const parts = String(version).trim().split('.').map((p) => Number.parseInt(p, 10));
  const [major, minor, patch] = parts;
  return [major || 0, minor || 0, patch || 0];
}

function compareVersions(a, b) {
  const pa = parseVersionParts(a);
  const pb = parseVersionParts(b);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

const RANGE_PATTERN = /^\s*(>=|<=|>|<|=)?\s*(\d+(?:\.\d+){0,2})\s*$/;

/**
 * @param {string} range - a core_compat range string, e.g. ">=1.0.0".
 * @param {string} version - the version to test against the range (HOOK_API_VERSION).
 * @returns {boolean} whether `version` satisfies `range`. An unrecognized/
 *   malformed range is treated as NOT satisfied (fails closed, never silently
 *   admits an incompatible pack).
 */
function satisfiesCoreCompat(range, version) {
  if (typeof range !== 'string') return false;
  const match = RANGE_PATTERN.exec(range);
  if (!match) return false;
  const [, operator = '=', target] = match;
  const cmp = compareVersions(version, target);
  switch (operator) {
    case '>=':
      return cmp >= 0;
    case '>':
      return cmp > 0;
    case '<=':
      return cmp <= 0;
    case '<':
      return cmp < 0;
    case '=':
      return cmp === 0;
    default:
      return false;
  }
}

function describeSkip(descriptor) {
  return descriptor && typeof descriptor.id === 'string' ? descriptor.id : '<unknown>';
}

/**
 * Resolve the ordered active-pack set from a list of already-loaded pack
 * descriptors, given the hook-API version core advertises.
 *
 * PURE: no I/O, no reads from disk or network. Every descriptor is validated
 * with validatePackDescriptor() before its core_compat is even considered —
 * an invalid descriptor never reaches the compat check. A pack that fails
 * either check is never silently dropped: it is reported in `skipped` with a
 * pack-attributed reason string (leave-and-report, matching the
 * src/pack-apply.js / src/pack-reconcile.js skip-report convention already
 * used elsewhere in the reconciler — one bad pack does not abort the whole
 * registry).
 *
 * @param {object[]} descriptors - candidate pack descriptor objects.
 * @param {string} [hookApiVersion] - defaults to HOOK_API_VERSION.
 * @returns {{ active: object[], skipped: Array<{ pack_id: string, reason: string }> }}
 *   `active` is sorted by descriptor id (ascending, string comparison) so
 *   downstream question/field injection order is deterministic and
 *   reproducible regardless of input order.
 */
export function resolveActivePacks(descriptors, hookApiVersion = HOOK_API_VERSION) {
  const candidates = Array.isArray(descriptors) ? descriptors : [];
  const active = [];
  const skipped = [];

  for (const descriptor of candidates) {
    const packId = describeSkip(descriptor);

    const validation = validatePackDescriptor(descriptor);
    if (!validation.valid) {
      skipped.push({
        pack_id: packId,
        reason: `invalid descriptor: ${JSON.stringify(validation.errors)}`,
      });
      continue;
    }

    if (!satisfiesCoreCompat(descriptor.core_compat, hookApiVersion)) {
      skipped.push({
        pack_id: packId,
        reason: `core_compat "${descriptor.core_compat}" is not satisfied by HOOK_API_VERSION "${hookApiVersion}"`,
      });
      continue;
    }

    active.push(descriptor);
  }

  active.sort((a, b) => {
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });

  return { active, skipped };
}
