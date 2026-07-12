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
