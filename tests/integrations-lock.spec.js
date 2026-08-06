// tests/integrations-lock.spec.js
// TASK-116 — integrations.lock.json schema + ownership-edge helpers.
// Pure logic + schema shape only, no disk I/O (fast tier). The readLock/
// writeLock round-trip (real fs + atomicWriteFile) lives in
// tests/e2e/integrations-lock.spec.js.
//
// Acceptance criteria covered here:
//   AC1 (schema half) — a JSON schema for integrations.lock.json exists and
//     accepts/rejects payloads as expected.
//   AC2 — addOwner/dropOwner mutate the owners array; isOrphaned(lock,id)
//     returns true iff owners is empty.
//   AC3 — data-loss regression lock: a resource owned by two packs, after
//     dropOwner for one, remains present with a one-element owners array and
//     isOrphaned=false.
//   AC4 — dropOwner of the last owner leaves the entry present but
//     isOrphaned=true (physical removal is the applier's job, not the store's).

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { REPO_ROOT } from './helpers/repoRoot.js';
import { PROD } from './helpers/fixtures.js';

const SCHEMA_PATH = join(REPO_ROOT, 'state', 'integrations-lock.schema.json');

function loadSchema() {
  expect(existsSync(SCHEMA_PATH), 'state/integrations-lock.schema.json must exist').toBe(true);
  return JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
}

function buildAjv() {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv;
}

/** Minimal schema-valid resource entry builder. */
function makeEntry(owners) {
  return {
    kind: 'skill',
    origin: 'github.com/example/skills',
    pin: 'abc123def456',
    integrity: 'sha256:' + 'a'.repeat(64),
    scope: 'project',
    owners,
    required: 'soft',
    installed_at: '2026-07-08T12:00:00Z',
    install_method: 'assimilated',
    verified: 'unsigned',
  };
}

function makeLock(resources) {
  return { schema_version: 1, resources };
}

// ===========================================================================
// AC1 (schema half) — shape assertions.
// ===========================================================================
describe('AC1 — integrations-lock.schema.json shape', () => {
  it('accepts_a_well_formed_lock', () => {
    const schema = loadSchema();
    const validate = buildAjv().compile(schema);
    const lock = makeLock({ 'skill:shadcn-vue': makeEntry(['design-power@0.1.0']) });
    expect(validate(lock), JSON.stringify(validate.errors)).toBe(true);
  });

  it('rejects_an_entry_missing_a_required_field', () => {
    const schema = loadSchema();
    const validate = buildAjv().compile(schema);
    const entry = makeEntry([]);
    delete entry.integrity;
    const lock = makeLock({ 'skill:shadcn-vue': entry });
    expect(validate(lock)).toBe(false);
  });

  it('rejects_an_unknown_top_level_property', () => {
    const schema = loadSchema();
    const validate = buildAjv().compile(schema);
    const lock = { ...makeLock({}), unexpected: true };
    expect(validate(lock)).toBe(false);
  });

  it('rejects_an_unknown_entry_kind', () => {
    const schema = loadSchema();
    const validate = buildAjv().compile(schema);
    const entry = makeEntry([]);
    entry.kind = 'plugin-store'; // not in the mcp|skill|plugin enum
    const lock = makeLock({ 'x:y': entry });
    expect(validate(lock)).toBe(false);
  });

  it('rejects_a_truncated_integrity_digest', () => {
    // TASK-119 (carried LOW from TASK-118 review): the pattern used to accept
    // any length of hex ([0-9a-f]+); tightened to exactly 64 chars so a
    // truncated sha256 digest is caught at write time, not silently stored.
    const schema = loadSchema();
    const validate = buildAjv().compile(schema);
    const entry = makeEntry(['design-power@0.1.0']);
    entry.integrity = 'sha256:' + 'a'.repeat(63); // one char short of a full digest
    const lock = makeLock({ 'skill:shadcn-vue': entry });
    expect(validate(lock)).toBe(false);
  });
});

// ===========================================================================
// TASK-142 — two-field integrity (source_integrity + content_integrity)
// alongside the legacy single `integrity` field. AC1 (schema half) + AC5:
// new entries carry the pair; pre-existing single-`integrity` entries must
// keep validating (no forced migration) so writeLock never blocks on an
// old resource sitting untouched elsewhere in the same lockfile.
// ===========================================================================
describe('TASK-142 — schema accepts the new source_integrity/content_integrity pair, keeps legacy `integrity` valid', () => {
  const HASH_A = 'sha256:' + 'a'.repeat(64);
  const HASH_B = 'sha256:' + 'b'.repeat(64);

  it('accepts_an_entry_carrying_only_source_integrity_and_content_integrity_no_legacy_integrity', () => {
    const schema = loadSchema();
    const validate = buildAjv().compile(schema);
    const entry = makeEntry(['design-power@0.1.0']);
    delete entry.integrity;
    entry.source_integrity = HASH_A;
    entry.content_integrity = HASH_B;
    const lock = makeLock({ 'skill:shadcn-vue': entry });
    expect(validate(lock), JSON.stringify(validate.errors)).toBe(true);
  });

  it('accepts_a_pre_existing_entry_carrying_only_the_legacy_integrity_field_unchanged', () => {
    // Regression lock: TASK-142 must never force a migration of already-valid
    // entries just because the schema also learned two new fields.
    const schema = loadSchema();
    const validate = buildAjv().compile(schema);
    const entry = makeEntry(['design-power@0.1.0']); // legacy shape, untouched
    const lock = makeLock({ 'skill:shadcn-vue': entry });
    expect(validate(lock), JSON.stringify(validate.errors)).toBe(true);
  });

  it('rejects_an_entry_with_neither_legacy_integrity_nor_the_new_pair', () => {
    const schema = loadSchema();
    const validate = buildAjv().compile(schema);
    const entry = makeEntry(['design-power@0.1.0']);
    delete entry.integrity; // no legacy field, no replacement pair either
    const lock = makeLock({ 'skill:shadcn-vue': entry });
    expect(validate(lock)).toBe(false);
  });

  it('rejects_an_entry_with_only_content_integrity_and_no_source_integrity_or_legacy_integrity', () => {
    // The pair is required TOGETHER — a lone content_integrity with no
    // source_integrity and no legacy `integrity` satisfies neither anyOf
    // branch.
    const schema = loadSchema();
    const validate = buildAjv().compile(schema);
    const entry = makeEntry(['design-power@0.1.0']);
    delete entry.integrity;
    entry.content_integrity = HASH_B;
    const lock = makeLock({ 'skill:shadcn-vue': entry });
    expect(validate(lock)).toBe(false);
  });

  it('rejects_a_truncated_content_integrity_digest', () => {
    const schema = loadSchema();
    const validate = buildAjv().compile(schema);
    const entry = makeEntry(['design-power@0.1.0']);
    delete entry.integrity;
    entry.source_integrity = HASH_A;
    entry.content_integrity = 'sha256:' + 'b'.repeat(63); // one short
    const lock = makeLock({ 'skill:shadcn-vue': entry });
    expect(validate(lock)).toBe(false);
  });
});

// ===========================================================================
// AC2 — addOwner/dropOwner mutate owners[]; isOrphaned iff owners is empty.
// ===========================================================================
describe('AC2 — ownership-edge helpers', () => {
  it('addOwner_appends_a_new_owner_edge', async () => {
    const { addOwner } = await import(PROD.integrationsLock);
    const lock = makeLock({ 'skill:shadcn-vue': makeEntry([]) });

    addOwner(lock, 'skill:shadcn-vue', 'design-power@0.1.0');

    expect(lock.resources['skill:shadcn-vue'].owners).toEqual(['design-power@0.1.0']);
  });

  it('addOwner_is_idempotent_for_a_duplicate_edge', async () => {
    const { addOwner } = await import(PROD.integrationsLock);
    const lock = makeLock({ 'skill:shadcn-vue': makeEntry(['design-power@0.1.0']) });

    addOwner(lock, 'skill:shadcn-vue', 'design-power@0.1.0');

    expect(lock.resources['skill:shadcn-vue'].owners).toEqual(['design-power@0.1.0']);
  });

  it('dropOwner_removes_the_named_edge', async () => {
    const { dropOwner } = await import(PROD.integrationsLock);
    const lock = makeLock({ 'skill:shadcn-vue': makeEntry(['design-power@0.1.0']) });

    dropOwner(lock, 'skill:shadcn-vue', 'design-power@0.1.0');

    expect(lock.resources['skill:shadcn-vue'].owners).toEqual([]);
  });

  it('isOrphaned_true_iff_owners_empty', async () => {
    const { isOrphaned } = await import(PROD.integrationsLock);
    const lock = makeLock({
      'skill:empty': makeEntry([]),
      'skill:owned': makeEntry(['design-power@0.1.0']),
    });

    expect(isOrphaned(lock, 'skill:empty')).toBe(true);
    expect(isOrphaned(lock, 'skill:owned')).toBe(false);
  });

  it('unknown_resource_id_throws_UnknownResourceIdError', async () => {
    const { addOwner, dropOwner, isOrphaned, UnknownResourceIdError } = await import(PROD.integrationsLock);
    const lock = makeLock({});

    expect(() => addOwner(lock, 'skill:missing', 'design-power@0.1.0')).toThrow(UnknownResourceIdError);
    expect(() => dropOwner(lock, 'skill:missing', 'design-power@0.1.0')).toThrow(UnknownResourceIdError);
    expect(() => isOrphaned(lock, 'skill:missing')).toThrow(UnknownResourceIdError);
  });
});

// ===========================================================================
// AC3 — data-loss regression lock: dropping one of TWO owners must not wipe
// the resource or the surviving edge.
// ===========================================================================
describe('AC3 — data-loss regression lock (two owners, drop one)', () => {
  it('surviving_owner_remains_after_dropping_the_other', async () => {
    const { dropOwner, isOrphaned } = await import(PROD.integrationsLock);
    const lock = makeLock({
      'mcp:firecrawl': makeEntry(['design-power@0.1.0', 'search-pack@2.0.0']),
    });

    dropOwner(lock, 'mcp:firecrawl', 'design-power@0.1.0');

    expect(lock.resources['mcp:firecrawl']).toBeDefined();
    expect(lock.resources['mcp:firecrawl'].owners).toEqual(['search-pack@2.0.0']);
    expect(isOrphaned(lock, 'mcp:firecrawl')).toBe(false);
  });
});

// ===========================================================================
// AC4 — dropping the LAST owner leaves the entry present, only isOrphaned flips.
// ===========================================================================
describe('AC4 — last-owner drop leaves entry present, orphaned', () => {
  it('entry_survives_last_owner_drop_and_isOrphaned_flips_true', async () => {
    const { dropOwner, isOrphaned } = await import(PROD.integrationsLock);
    const lock = makeLock({ 'mcp:firecrawl': makeEntry(['design-power@0.1.0']) });

    dropOwner(lock, 'mcp:firecrawl', 'design-power@0.1.0');

    expect(lock.resources['mcp:firecrawl']).toBeDefined();
    expect(lock.resources['mcp:firecrawl'].owners).toEqual([]);
    expect(isOrphaned(lock, 'mcp:firecrawl')).toBe(true);
  });
});

// ===========================================================================
// TASK-202 AC5 — parseOwnerEdge: the ONE named place pack-id parsing lives.
// Assumption stated in the function's own doc comment: owner strings are
// `${descriptor.id}@${descriptor.version}` (src/pack-orchestrator.js). A
// malformed owner string (no '@', empty id, empty version) deliberately
// returns null rather than guessing a split -- fail-safe over guessing.
// ===========================================================================
describe('TASK-202 AC5 — parseOwnerEdge: pack-id parsing, one named place', () => {
  it('splits a well-formed owner edge on the LAST @', async () => {
    const { parseOwnerEdge } = await import(PROD.integrationsLock);
    expect(parseOwnerEdge('watch@2.0.0')).toEqual({ packId: 'watch', version: '2.0.0' });
  });

  it('uses the LAST @ even when the pack id itself contains one', async () => {
    const { parseOwnerEdge } = await import(PROD.integrationsLock);
    expect(parseOwnerEdge('scope@pack@1.0.0')).toEqual({ packId: 'scope@pack', version: '1.0.0' });
  });

  it('returns null for a string with no @ at all', async () => {
    const { parseOwnerEdge } = await import(PROD.integrationsLock);
    expect(parseOwnerEdge('watch')).toBeNull();
  });

  it('returns null for an empty pack id (owner starts with @)', async () => {
    const { parseOwnerEdge } = await import(PROD.integrationsLock);
    expect(parseOwnerEdge('@1.0.0')).toBeNull();
  });

  it('returns null for an empty version (owner ends with @)', async () => {
    const { parseOwnerEdge } = await import(PROD.integrationsLock);
    expect(parseOwnerEdge('watch@')).toBeNull();
  });

  it('returns null for a non-string input', async () => {
    const { parseOwnerEdge } = await import(PROD.integrationsLock);
    expect(parseOwnerEdge(undefined)).toBeNull();
    expect(parseOwnerEdge(null)).toBeNull();
    expect(parseOwnerEdge(42)).toBeNull();
  });
});

// ===========================================================================
// TASK-202 AC2 — dropStaleSameOwnerEdges: unit coverage on the pure helper
// itself (the e2e strand-level proof lives in tests/e2e/pack-apply.spec.js's
// TASK-202 describe block, exercised through applyPlan).
// ===========================================================================
describe('TASK-202 AC2 — dropStaleSameOwnerEdges: same-packId/different-version edges are dropped, nothing else is', () => {
  it('drops a prior edge sharing the current owner\'s packId but a different version', async () => {
    const { dropStaleSameOwnerEdges } = await import(PROD.integrationsLock);
    const result = dropStaleSameOwnerEdges(['design-power@0.1.0', 'watch@1.0.0'], 'watch@2.0.0');
    expect(result).toEqual(['design-power@0.1.0']);
  });

  it('keeps an edge that already exactly equals the current owner (not stale)', async () => {
    const { dropStaleSameOwnerEdges } = await import(PROD.integrationsLock);
    const result = dropStaleSameOwnerEdges(['design-power@0.1.0', 'watch@1.0.0'], 'watch@1.0.0');
    expect(result).toEqual(['design-power@0.1.0', 'watch@1.0.0']);
  });

  it('leaves a malformed prior edge untouched rather than guessing it is stale', async () => {
    const { dropStaleSameOwnerEdges } = await import(PROD.integrationsLock);
    const result = dropStaleSameOwnerEdges(['not-a-valid-edge', 'watch@1.0.0'], 'watch@2.0.0');
    expect(result).toEqual(['not-a-valid-edge']);
  });

  it('is a no-op (returns a copy of owners unchanged) when currentOwner itself is malformed', async () => {
    const { dropStaleSameOwnerEdges } = await import(PROD.integrationsLock);
    const owners = ['design-power@0.1.0', 'watch@1.0.0'];
    const result = dropStaleSameOwnerEdges(owners, 'not-a-valid-edge');
    expect(result).toEqual(owners);
    expect(result).not.toBe(owners); // never mutates/aliases the input array
  });

  it('never drops a sibling pack\'s edge, only the same-packId stale one', async () => {
    const { dropStaleSameOwnerEdges } = await import(PROD.integrationsLock);
    const result = dropStaleSameOwnerEdges(
      ['design-power@0.1.0', 'other-pack@3.0.0', 'watch@1.0.0'],
      'watch@2.0.0',
    );
    expect(result).toEqual(['design-power@0.1.0', 'other-pack@3.0.0']);
  });
});

// ===========================================================================
// TASK-202 AC3 — findDuplicatePackIdOwners / findLockResourcesWithDuplicatePackIdOwners:
// the mechanical sensor for the phantom-edge condition itself. Unit tests
// here PLANT the condition to prove the sensor is non-vacuous (it genuinely
// fails when the condition is present); the live-repo assertion below is the
// permanent sensor that actually runs in npm test/test:all.
// ===========================================================================
describe('TASK-202 AC3 — findDuplicatePackIdOwners: mechanical sensor for the condition itself', () => {
  it('PLANTED FAILURE: flags a packId with two different versions represented', async () => {
    const { findDuplicatePackIdOwners } = await import(PROD.integrationsLock);
    const dupes = findDuplicatePackIdOwners(['design-power@0.1.0', 'watch@1.0.0', 'watch@2.0.0']);
    expect(dupes).toEqual(['watch']);
  });

  it('reports hygienic (empty) when every packId has at most one version', async () => {
    const { findDuplicatePackIdOwners } = await import(PROD.integrationsLock);
    expect(findDuplicatePackIdOwners(['design-power@0.1.0', 'watch@2.0.0'])).toEqual([]);
  });

  it('does not flag the SAME edge repeated (identical packId AND version)', async () => {
    const { findDuplicatePackIdOwners } = await import(PROD.integrationsLock);
    expect(findDuplicatePackIdOwners(['watch@1.0.0', 'watch@1.0.0'])).toEqual([]);
  });

  it('excludes malformed edges from grouping -- they neither trigger nor mask a finding', async () => {
    const { findDuplicatePackIdOwners } = await import(PROD.integrationsLock);
    expect(findDuplicatePackIdOwners(['not-a-valid-edge', 'watch@1.0.0'])).toEqual([]);
  });
});

describe('TASK-202 AC3 — findLockResourcesWithDuplicatePackIdOwners: PLANTED FAILURE proves the resource-level scan is non-vacuous', () => {
  it('names the offending resource id and its duplicated packId(s)', async () => {
    const { findLockResourcesWithDuplicatePackIdOwners } = await import(PROD.integrationsLock);
    const lock = makeLock({
      'skill:watch': makeEntry(['design-power@0.1.0', 'watch@1.0.0', 'watch@2.0.0']),
      'skill:clean': makeEntry(['design-power@0.1.0']),
    });
    const offenders = findLockResourcesWithDuplicatePackIdOwners(lock);
    expect(offenders).toEqual([{ id: 'skill:watch', packIds: ['watch'] }]);
  });

  it('returns empty for a fully hygienic lock', async () => {
    const { findLockResourcesWithDuplicatePackIdOwners } = await import(PROD.integrationsLock);
    const lock = makeLock({
      'skill:a': makeEntry(['design-power@0.1.0']),
      'skill:b': makeEntry(['watch@2.0.0']),
    });
    expect(findLockResourcesWithDuplicatePackIdOwners(lock)).toEqual([]);
  });
});

// ===========================================================================
// TASK-202 AC3 — permanent live-repo sensor. Reads the repo's own committed
// integrations.lock.json (sync fs read, no mkdtemp/process I/O -- same
// fast-tier precedent as tests/graph-freshness.spec.js and
// tests/use-case-policy.spec.js) and fails naming any resource that carries
// the phantom-edge condition. Runs automatically in both `npm test` and
// `npm run test:all` -- "so a regression is caught mechanically rather than
// by inspection" (AC3's own wording).
// ===========================================================================
describe('TASK-202 AC3 — live-repo sensor: no resource in integrations.lock.json carries duplicate-packId owner edges', () => {
  it('no_resource_has_two_owner_edges_for_the_same_pack_id_at_different_versions', async () => {
    const { findLockResourcesWithDuplicatePackIdOwners } = await import(PROD.integrationsLock);
    const lockPath = join(REPO_ROOT, 'integrations.lock.json');
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    const offenders = findLockResourcesWithDuplicatePackIdOwners(lock);
    expect(offenders, JSON.stringify(offenders)).toEqual([]);
  });
});

// ===========================================================================
// TASK-207 (review follow-up, MEDIUM-1) — hasForeignOwner: direct unit
// coverage of the fail-safe branches (unparseable currentOwner, unparseable
// prior edge, empty owners), matching the six-case precedent already set for
// its sibling parseOwnerEdge above (tests/integrations-lock.spec.js:270-302).
// The e2e-level proof that hasForeignOwner is WIRED correctly into
// src/assimilate.js lives in tests/e2e/assimilate.spec.js's TASK-207 block;
// these specs are about the pure predicate's own contract in isolation.
// ===========================================================================
describe('TASK-207 (review follow-up) — hasForeignOwner: foreign-owner-edge detection, fail-safe on anything unparseable', () => {
  it('false for empty/absent owners -- nobody currently holds the resource, so it is never foreign', async () => {
    const { hasForeignOwner } = await import(PROD.integrationsLock);
    expect(hasForeignOwner([], 'design-power@0.1.0')).toBe(false);
    expect(hasForeignOwner(undefined, 'design-power@0.1.0')).toBe(false);
  });

  it('false when every owner edge shares the current owner\'s packId (a version bump, or the exact edge repeated)', async () => {
    const { hasForeignOwner } = await import(PROD.integrationsLock);
    expect(hasForeignOwner(['design-power@0.1.0'], 'design-power@0.2.0')).toBe(false);
    expect(hasForeignOwner(['design-power@0.1.0', 'design-power@0.1.0'], 'design-power@0.1.0')).toBe(false);
    expect(hasForeignOwner(['watch@1.0.0', 'watch@0.9.0'], 'watch@2.0.0')).toBe(false);
  });

  it('true when at least one owner edge parses to a DIFFERENT packId, regardless of the other edges present', async () => {
    const { hasForeignOwner } = await import(PROD.integrationsLock);
    expect(hasForeignOwner(['design-power@0.1.0'], 'watch@1.0.0')).toBe(true);
    // A sibling foreign edge is still foreign even when the CURRENT owner's
    // own edge is present in the same array (own-edge presence is not an
    // excuse for a DIFFERENT edge's packId).
    expect(hasForeignOwner(['design-power@0.1.0', 'watch@1.0.0'], 'watch@1.0.0')).toBe(true);
    expect(hasForeignOwner(['design-power@0.1.0', 'watch@1.0.0'], 'watch@2.0.0')).toBe(true);
  });

  it('an edge IDENTICAL to currentOwner is never foreign, even without parsing it', async () => {
    const { hasForeignOwner } = await import(PROD.integrationsLock);
    // 'not-a-valid-edge' cannot be parsed, but the exact-string branch
    // short-circuits before parseOwnerEdge ever runs on it.
    expect(hasForeignOwner(['not-a-valid-edge'], 'not-a-valid-edge')).toBe(false);
  });

  it('FAIL-SAFE: a currentOwner that fails to parse treats EVERY existing owner as foreign', async () => {
    const { hasForeignOwner } = await import(PROD.integrationsLock);
    expect(hasForeignOwner(['design-power@0.1.0'], 'not-a-valid-owner')).toBe(true);
    expect(hasForeignOwner(['design-power@0.1.0'], '')).toBe(true);
  });

  it('FAIL-SAFE: a prior owner edge that fails to parse is treated as foreign -- cannot prove sameness', async () => {
    const { hasForeignOwner } = await import(PROD.integrationsLock);
    expect(hasForeignOwner(['not-a-valid-edge'], 'design-power@0.1.0')).toBe(true);
  });
});
