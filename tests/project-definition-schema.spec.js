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

// =====================================================================
// TASK-124 — PROJECT.md gains two optional design-profile fields for the
// Diseño Poderoso pack: `tier` (scalar enum) and `perfil_proyecto` (a
// permissive inline-object map, encoded/parsed exactly like agent_models).
// This is the CONTAINER + plumbing only — no scoring/question logic.
// =====================================================================
describe('TASK-124 AC2/AC3/AC5 — tier + perfil_proyecto schema shape', () => {
  it('schema_has_tier_as_optional_enum_scalar', () => {
    const schema = loadSchema();
    expect(schema.properties.tier, 'tier must be defined in schema properties').toBeDefined();
    expect(schema.properties.tier.type).toBe('string');
    expect(schema.properties.tier.enum).toEqual(['LIGERO', 'MEDIO', 'COMPLETO']);
    const required = schema.required ?? [];
    expect(required).not.toContain('tier');
  });

  it('schema_accepts_valid_tier_value', () => {
    const schema = loadSchema();
    const ajv = buildAjv();
    const validate = ajv.compile(schema);

    const frontmatter = { ...EXISTING_VALID_FRONTMATTER, tier: 'COMPLETO' };
    expect(
      validate(frontmatter),
      'schema must accept a valid tier value — errors: ' + JSON.stringify(validate.errors),
    ).toBe(true);
  });

  it('schema_rejects_out_of_enum_tier_value', () => {
    const schema = loadSchema();
    const ajv = buildAjv();
    const validate = ajv.compile(schema);

    const frontmatter = { ...EXISTING_VALID_FRONTMATTER, tier: 'HUGE' };
    expect(validate(frontmatter)).toBe(false);
  });

  it('schema_has_perfil_proyecto_as_permissive_object_of_strings', () => {
    const schema = loadSchema();
    expect(
      schema.properties.perfil_proyecto,
      'perfil_proyecto must be defined in schema properties',
    ).toBeDefined();
    expect(schema.properties.perfil_proyecto.type).toBe('object');
    // Permissive: concrete keys are filled in later by the Phase E scoring
    // ticket, so any key is allowed as long as the value is a string.
    expect(schema.properties.perfil_proyecto.additionalProperties).toEqual({ type: 'string' });
    const required = schema.required ?? [];
    expect(required).not.toContain('perfil_proyecto');
  });

  it('schema_accepts_perfil_proyecto_map', () => {
    const schema = loadSchema();
    const ajv = buildAjv();
    const validate = ajv.compile(schema);

    const frontmatter = {
      ...EXISTING_VALID_FRONTMATTER,
      perfil_proyecto: { functionality: 'high', beauty: 'high', framework: 'vue' },
    };
    expect(
      validate(frontmatter),
      'schema must accept a perfil_proyecto map — errors: ' + JSON.stringify(validate.errors),
    ).toBe(true);
  });

  it('schema_rejects_non_string_perfil_proyecto_value', () => {
    const schema = loadSchema();
    const ajv = buildAjv();
    const validate = ajv.compile(schema);

    const frontmatter = {
      ...EXISTING_VALID_FRONTMATTER,
      perfil_proyecto: { functionality: 5 },
    };
    expect(validate(frontmatter)).toBe(false);
  });

  it('additionalProperties_false_still_holds_with_the_two_new_keys', () => {
    const schema = loadSchema();
    expect(schema.additionalProperties).toBe(false);

    const ajv = buildAjv();
    const validate = ajv.compile(schema);
    const withUnrelatedUnknown = {
      ...EXISTING_VALID_FRONTMATTER,
      tier: 'LIGERO',
      perfil_proyecto: { functionality: 'low' },
      an_unrelated_unknown_key: 'nope',
    };
    expect(validate(withUnrelatedUnknown)).toBe(false);
  });
});
