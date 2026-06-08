// tests/project-schema.spec.js
// TASK-011 — state/PROJECT.schema.json must validate a freshly-written
// PROJECT.md frontmatter and reject schema_version omissions / unknown
// project types.
//
// Covers AC7. The schema declares draft-2020-12 (per TASK-002 convention),
// so this test imports Ajv from 'ajv/dist/2020.js'.

import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { PROD } from '../helpers/fixtures.js';
import { REPO_ROOT } from '../helpers/repoRoot.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';

afterAll(cleanupAll);

const FIXED_NOW = '2026-05-26T12:00:00Z';
const FROZEN_TAXONOMY = ['web-saas', 'cli-tool', 'data-pipeline', 'ml-model', 'library', 'other'];

const SCHEMA_PATH = join(REPO_ROOT, 'state', 'PROJECT.schema.json');

function loadSchema() {
  expect(existsSync(SCHEMA_PATH), 'state/PROJECT.schema.json must exist').toBe(true);
  return JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
}

function buildAjv() {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv;
}

describe('PROJECT.schema.json — validation', () => {
  it('schema_validates_freshly_written_frontmatter', async () => {
    const { writeProjectMd, readProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-pmd-schema-ok');
    await writeProjectMd({
      repoRoot: repoDir,
      answers: {
        project_name: 'schema-ok-demo',
        project_type: 'web-saas',
        project_description: 'd',
        target_users: 't',
        success_criteria: 's',
        frontend_framework: 'React',
        backend_framework: 'FastAPI',
        database: 'Postgres',
        deployment_target: 'Fly.io',
      },
      now: () => FIXED_NOW,
    });

    const out = await readProjectMd({ repoRoot: repoDir });
    // Frontmatter is the machine-readable subset of the answers map. The
    // reader is the canonical source of "what's in the frontmatter".
    const frontmatter = out.frontmatter;
    expect(frontmatter, 'readProjectMd must surface a frontmatter object').toBeDefined();

    const schema = loadSchema();
    const ajv = buildAjv();
    const validate = ajv.compile(schema);
    const ok = validate(frontmatter);
    expect(
      ok,
      'freshly-written frontmatter failed schema: ' + JSON.stringify(validate.errors, null, 2),
    ).toBe(true);
  });

  it('schema_requires_schema_version_field', () => {
    const schema = loadSchema();
    const ajv = buildAjv();
    const validate = ajv.compile(schema);

    const frontmatter = {
      name: 'no-version-demo',
      type: 'web-saas',
      created_at: FIXED_NOW,
      // schema_version intentionally omitted
    };
    const ok = validate(frontmatter);
    expect(ok).toBe(false);
    // The error list must mention schema_version somewhere.
    const errStr = JSON.stringify(validate.errors);
    expect(errStr).toMatch(/schema_version/);
  });

  it('schema_rejects_unknown_project_type', () => {
    const schema = loadSchema();
    const ajv = buildAjv();
    const validate = ajv.compile(schema);

    const frontmatter = {
      name: 'bad-type-demo',
      type: 'unknown-type',
      created_at: FIXED_NOW,
      schema_version: 1,
    };
    const ok = validate(frontmatter);
    expect(ok).toBe(false);

    // Sanity: the schema must mirror the FROZEN_TAXONOMY enum, so a valid
    // type passes the same shape.
    for (const t of FROZEN_TAXONOMY) {
      const okType = validate({
        name: 'ok',
        type: t,
        created_at: FIXED_NOW,
        schema_version: 1,
      });
      expect(okType, `type "${t}" must be accepted by the schema`).toBe(true);
    }
  });
});
