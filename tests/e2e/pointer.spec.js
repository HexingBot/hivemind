// tests/pointer.spec.js
// AC1: state/session.json becomes a minimal v2 pointer with exactly three fields.
// AC1 (bundle shape): state/sessions/<id>/session.json carries the v1 shape + session_id.
//
// Maps research §H tests:
//   #1 pointer_v2_shape_minimal
//   #2 bundle_session_json_has_v1_shape_plus_session_id (lives here because the schema lives here)

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

import { REPO_ROOT } from '../helpers/repoRoot.js';
import { PROD, seedActiveBundle, makeSessionId, bundlePath } from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';

import { afterAll } from 'vitest';
afterAll(cleanupAll);

describe('AC1 — pointer file v2 shape', () => {
  it('pointer_v2_shape_minimal — state/session.json parses against the v2 pointer schema', async () => {
    // Production code under test: the v2 pointer schema lives at state/session.schema.json
    // and must be the v2 (3-field) schema, not the v1 schema currently committed.
    // This test reads the committed repo schema and validates the committed pointer file
    // against it. It WILL fail until the schema is rewritten and session.json is
    // demoted to a pointer.
    const schemaPath = join(REPO_ROOT, 'state', 'session.schema.json');
    const pointerPath = join(REPO_ROOT, 'state', 'session.json');
    expect(existsSync(schemaPath), 'state/session.schema.json must exist').toBe(true);
    expect(existsSync(pointerPath), 'state/session.json must exist').toBe(true);

    const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
    const pointer = JSON.parse(readFileSync(pointerPath, 'utf8'));

    // The pointer schema MUST declare schema_version=2 (research §B).
    expect(schema.properties?.schema_version?.const, 'schema.properties.schema_version.const')
      .toBe(2);
    // The pointer schema MUST allow exactly three top-level required fields.
    expect(new Set(schema.required || [])).toEqual(
      new Set(['schema_version', 'active_session_id', 'updated_at']),
    );
    expect(schema.additionalProperties).toBe(false);

    // The actual on-disk pointer file MUST validate against the schema.
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const ok = validate(pointer);
    expect(validate.errors, JSON.stringify(validate.errors)).toBeNull();
    expect(ok).toBe(true);

    // Spot-check field values.
    expect(pointer.schema_version).toBe(2);
    expect(Object.keys(pointer).sort()).toEqual(
      ['active_session_id', 'schema_version', 'updated_at'].sort(),
    );
  });
});

describe('AC1 — bundle session.json carries the v1 shape plus session_id', () => {
  it('bundle_session_json_has_v1_shape_plus_session_id', async () => {
    // The production module exposes the bundle-state schema as JS. Import it from
    // PROD.schemas; the test fails with MODULE_NOT_FOUND until implementation lands.
    const { bundleStateSchema } = await import(PROD.schemas);

    // Seed a bundle on disk via the fixture helper and validate it against the schema.
    const repoDir = makeTmpDir('af-bundle');
    const id = makeSessionId();
    const dir = bundlePath(repoDir, id);
    const { sessionJson } = seedActiveBundle(dir, { session_id: id });

    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(bundleStateSchema);
    expect(validate(sessionJson)).toBe(true);

    // schema_version is the renamed top-level field (see ticket comment 2026-05-24).
    expect(bundleStateSchema.required).toContain('schema_version');
    expect(bundleStateSchema.required).toContain('session_id');
    expect(bundleStateSchema.properties.schema_version.const).toBe(2);

    // Field set: the v1 fields plus session_id and lifecycle_state.
    const props = Object.keys(bundleStateSchema.properties);
    for (const f of [
      'schema_version', 'session_id', 'lifecycle_state',
      'updated_at', 'active_task', 'workflow_step',
      'next_action', 'handoff_summary',
    ]) {
      expect(props).toContain(f);
    }
  });
});

describe('AC1 — v1->v2 lift detection rule (research §B)', () => {
  it('lift_detects_v1_state_and_refuses_when_sessions_dir_nonempty', async () => {
    const { detectStateVersion, liftV1ToV2 } = await import(PROD.migrate);

    // v1 fixture lives under tests/fixtures/
    const v1Path = join(REPO_ROOT, 'tests', 'fixtures', 'v1-state.json');
    const v1Raw = JSON.parse(readFileSync(v1Path, 'utf8'));

    // Detection rule: top-level "version": 1 + workflow_step => v1
    expect(detectStateVersion(v1Raw)).toBe(1);

    // Detection rule: top-level "schema_version": 2 + active_session_id => v2
    expect(detectStateVersion({
      schema_version: 2,
      active_session_id: null,
      updated_at: '2026-05-24T12:00:00Z',
    })).toBe(2);

    // Lift refuses when state/sessions/ is non-empty per resolved Q #10.
    const repoDir = makeTmpDir('af-lift');
    // Pre-seed a bundle directory so liftV1ToV2 sees state/sessions/ non-empty.
    seedActiveBundle(bundlePath(repoDir, makeSessionId()));
    // liftV1ToV2 is async; use .rejects.toThrow to await the rejection.
    await expect(liftV1ToV2({ repoRoot: repoDir, v1Payload: v1Raw }))
      .rejects.toThrow(/sessions.*not.*empty|already.*lifted/i);
  });
});
