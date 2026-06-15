// tests/project-definition-schema.spec.js
// TASK-045 — PROJECT.md definition sections: problem, goals, scope (in/out).
//
// AC1 — state/PROJECT.schema.json gains four optional properties:
//   problem_statement (string), goals (array of strings),
//   scope_in (array of strings), scope_out (array of strings).
// additionalProperties:false must be preserved. All existing valid fixtures
// must still validate.
//
// Pure schema-shape assertions; no disk I/O. Fast tier (tests/*.spec.js).

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { REPO_ROOT } from './helpers/repoRoot.js';

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

// A minimal valid frontmatter that would be written by an existing PROJECT.md
// (only the schema-required keys, no new fields).
const EXISTING_VALID_FRONTMATTER = {
  name: 'existing-project',
  type: 'web-saas',
  created_at: '2026-05-26T12:00:00Z',
  schema_version: 1,
};

// A valid frontmatter that also carries agent_models (an existing optional field).
const EXISTING_WITH_AGENT_MODELS = {
  name: 'models-project',
  type: 'cli-tool',
  created_at: '2026-05-26T12:00:00Z',
  schema_version: 1,
  agent_models: {
    reviewer: 'opus',
    developer: 'sonnet',
  },
};

describe('TASK-045 AC1 — PROJECT.schema.json gains four optional definition fields', () => {
  it('schema_has_problem_statement_as_optional_string', () => {
    const schema = loadSchema();
    // The schema must define problem_statement as a property.
    expect(
      schema.properties,
      'schema must have a properties map',
    ).toBeDefined();
    expect(
      schema.properties.problem_statement,
      'problem_statement must be defined in schema properties',
    ).toBeDefined();
    // It must be typed as string.
    expect(schema.properties.problem_statement.type).toBe('string');
    // It must NOT appear in the required array (optional).
    const required = schema.required ?? [];
    expect(required).not.toContain('problem_statement');
  });

  it('schema_has_goals_as_optional_array_of_strings', () => {
    const schema = loadSchema();
    expect(
      schema.properties.goals,
      'goals must be defined in schema properties',
    ).toBeDefined();
    expect(schema.properties.goals.type).toBe('array');
    // Items must be typed as string.
    expect(schema.properties.goals.items).toBeDefined();
    expect(schema.properties.goals.items.type).toBe('string');
    const required = schema.required ?? [];
    expect(required).not.toContain('goals');
  });

  it('schema_has_scope_in_as_optional_array_of_strings', () => {
    const schema = loadSchema();
    expect(
      schema.properties.scope_in,
      'scope_in must be defined in schema properties',
    ).toBeDefined();
    expect(schema.properties.scope_in.type).toBe('array');
    expect(schema.properties.scope_in.items).toBeDefined();
    expect(schema.properties.scope_in.items.type).toBe('string');
    const required = schema.required ?? [];
    expect(required).not.toContain('scope_in');
  });

  it('schema_has_scope_out_as_optional_array_of_strings', () => {
    const schema = loadSchema();
    expect(
      schema.properties.scope_out,
      'scope_out must be defined in schema properties',
    ).toBeDefined();
    expect(schema.properties.scope_out.type).toBe('array');
    expect(schema.properties.scope_out.items).toBeDefined();
    expect(schema.properties.scope_out.items.type).toBe('string');
    const required = schema.required ?? [];
    expect(required).not.toContain('scope_out');
  });

  it('additionalProperties_false_is_preserved', () => {
    const schema = loadSchema();
    // additionalProperties must remain false to prevent schema drift.
    expect(schema.additionalProperties).toBe(false);
  });

  it('existing_frontmatter_without_new_fields_still_validates', () => {
    const schema = loadSchema();
    const ajv = buildAjv();
    const validate = ajv.compile(schema);

    const ok = validate(EXISTING_VALID_FRONTMATTER);
    expect(
      ok,
      'existing minimal frontmatter must still pass schema: ' +
        JSON.stringify(validate.errors, null, 2),
    ).toBe(true);
  });

  it('existing_frontmatter_with_agent_models_still_validates', () => {
    const schema = loadSchema();
    const ajv = buildAjv();
    const validate = ajv.compile(schema);

    const ok = validate(EXISTING_WITH_AGENT_MODELS);
    expect(
      ok,
      'existing frontmatter with agent_models must still pass schema: ' +
        JSON.stringify(validate.errors, null, 2),
    ).toBe(true);
  });

  it('new_fields_validate_when_all_four_are_supplied', () => {
    const schema = loadSchema();
    const ajv = buildAjv();
    const validate = ajv.compile(schema);

    const richFrontmatter = {
      ...EXISTING_VALID_FRONTMATTER,
      problem_statement: 'Teams lose context when switching between projects.',
      goals: ['reduce onboarding time', 'improve knowledge retention'],
      scope_in: ['project intake wizard', 'agent briefing generation'],
      scope_out: ['deployment tooling', 'CI/CD pipeline management'],
    };

    const ok = validate(richFrontmatter);
    expect(
      ok,
      'frontmatter with all four new optional fields must pass schema: ' +
        JSON.stringify(validate.errors, null, 2),
    ).toBe(true);
  });

  it('schema_rejects_unknown_additional_property', () => {
    const schema = loadSchema();
    const ajv = buildAjv();
    const validate = ajv.compile(schema);

    const withUnknown = {
      ...EXISTING_VALID_FRONTMATTER,
      this_field_does_not_exist: 'should fail',
    };

    const ok = validate(withUnknown);
    expect(ok).toBe(false);
  });
});
