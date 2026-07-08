// tests/pack-descriptor.spec.js
// TASK-115 — Addon-pack descriptor schema + validator (Wave 1, Phase A).
//
// AC1 — a JSON schema file exists on disk and is loaded by the validator via
//        an inlined JSON import (esbuild-safe, mirrors tasks/schema.json /
//        state/PROJECT.schema.json).
// AC2 — validatePackDescriptor(obj) accepts a valid sample design-power
//        descriptor and reports the offending field for each of: unknown
//        resource.kind, unknown resource.scope, a missing required top-level
//        field, and a resource.required outside {hard, soft}.
// AC3 — resource.fallback, when present, must reference another resource id
//        declared in the same descriptor; a dangling fallback is rejected.
//        This is a semantic check beyond pure JSON-schema. A fallback that
//        references its OWN resource id is also rejected — "another" resource
//        id, per AC3's wording, excludes self (TASK-115 review MEDIUM fix).
// AC4 — covered by the tests below: one valid-descriptor acceptance plus at
//        least the four rejection cases from AC2 plus the AC3 dangling and
//        self-fallback cases. Resource ids must also be unique within a
//        descriptor (review LOW fix) — a duplicate id is rejected, since
//        downstream (and the fallback check itself) treats ids as unique keys.
//
// Pure logic, no disk I/O beyond reading the schema file itself — fast tier.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './helpers/repoRoot.js';
import { validatePackDescriptor } from '../src/pack-descriptor.js';

const SCHEMA_PATH = join(REPO_ROOT, 'state', 'pack-descriptor.schema.json');

// A minimal-but-representative design-power descriptor, per
// docs/design/addon-packs.md §8 and docs/design/addon-packs-plan.md §2.
const VALID_DESCRIPTOR = {
  id: 'design-power',
  name: 'Diseño Poderoso',
  version: '0.1.0',
  core_compat: '>=1.0.0',
  trigger: {
    intake_question: 'Is this project design-heavy?',
    activates_when: 'answer == yes',
  },
  project_md_contribution: ['perfil_proyecto', 'tier'],
  profile: {
    base_questions: [],
    conditional_rules: [],
    complexity_fn: 'score -> LIGERO | MEDIO | COMPLETO',
  },
  resources: [
    {
      id: 'frontend-design',
      kind: 'plugin',
      origin: 'anthropic/frontend-design',
      pin: '1.0.0',
      scope: 'project',
      required: 'hard',
      // TASK-123 — activate_when + install are OPTIONAL descriptor-data
      // fields (docs/design/addon-packs.md §8.1): activation/exclusion is
      // expressed as data (this predicate + the fallback field below), not
      // hardcoded core logic. Predicate EVALUATION is deferred to Phase D/F
      // — this descriptor only needs to round-trip the strings.
      activate_when: 'always',
      install: 'claude plugin add anthropic/frontend-design',
    },
    {
      id: 'firecrawl',
      kind: 'mcp',
      origin: 'vendor/firecrawl',
      pin: 'abc123def',
      scope: 'project',
      required: 'soft',
      fallback: 'frontend-design',
    },
  ],
  gate_scopes: ['design_pipeline'],
  pipeline: ['reference', 'research', 'art-direction'],
};

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

describe('TASK-115 AC1 — pack descriptor schema file', () => {
  it('schema_file_exists_on_disk', () => {
    expect(existsSync(SCHEMA_PATH), 'state/pack-descriptor.schema.json must exist').toBe(true);
  });

  it('schema_file_is_valid_json_with_expected_shape', () => {
    const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
    expect(schema.type).toBe('object');
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.resources).toBeDefined();
  });
});

describe('TASK-115 AC2/AC4 — validatePackDescriptor accepts a valid descriptor', () => {
  it('accepts_a_valid_design_power_descriptor', () => {
    const result = validatePackDescriptor(VALID_DESCRIPTOR);
    expect(
      result.valid,
      'valid descriptor must pass: ' + JSON.stringify(result.errors, null, 2),
    ).toBe(true);
    expect(result.errors).toBeNull();
  });
});

describe('TASK-115 AC2 — rejection cases report the offending field', () => {
  it('rejects_unknown_resource_kind', () => {
    const bad = clone(VALID_DESCRIPTOR);
    bad.resources[0].kind = 'gizmo';

    const result = validatePackDescriptor(bad);
    expect(result.valid).toBe(false);
    expect(result.errors, 'errors must be reported').not.toBeNull();
    const hit = result.errors.some((e) => (e.instancePath || '').includes('/resources/0/kind'));
    expect(hit, 'an error must point at resources/0/kind: ' + JSON.stringify(result.errors)).toBe(true);
  });

  it('rejects_unknown_resource_scope', () => {
    const bad = clone(VALID_DESCRIPTOR);
    bad.resources[0].scope = 'global';

    const result = validatePackDescriptor(bad);
    expect(result.valid).toBe(false);
    const hit = result.errors.some((e) => (e.instancePath || '').includes('/resources/0/scope'));
    expect(hit, 'an error must point at resources/0/scope: ' + JSON.stringify(result.errors)).toBe(true);
  });

  it('rejects_a_missing_required_top_level_field', () => {
    const bad = clone(VALID_DESCRIPTOR);
    delete bad.core_compat;

    const result = validatePackDescriptor(bad);
    expect(result.valid).toBe(false);
    const hit = result.errors.some(
      (e) => e.message && e.message.includes('core_compat'),
    );
    expect(hit, 'an error must name the missing core_compat field: ' + JSON.stringify(result.errors)).toBe(true);
  });

  it('rejects_resource_required_outside_hard_or_soft', () => {
    const bad = clone(VALID_DESCRIPTOR);
    bad.resources[0].required = 'maybe';

    const result = validatePackDescriptor(bad);
    expect(result.valid).toBe(false);
    const hit = result.errors.some((e) => (e.instancePath || '').includes('/resources/0/required'));
    expect(hit, 'an error must point at resources/0/required: ' + JSON.stringify(result.errors)).toBe(true);
  });
});

describe('TASK-115 AC3 — dangling fallback is rejected (semantic check)', () => {
  it('rejects_a_fallback_that_does_not_reference_an_existing_resource_id', () => {
    const bad = clone(VALID_DESCRIPTOR);
    bad.resources[1].fallback = 'does-not-exist';

    const result = validatePackDescriptor(bad);
    expect(result.valid).toBe(false);
    const hit = result.errors.some((e) => (e.instancePath || '').includes('/resources/1/fallback'));
    expect(hit, 'an error must point at resources/1/fallback: ' + JSON.stringify(result.errors)).toBe(true);
  });

  it('rejects_a_fallback_that_references_its_own_resource_id', () => {
    const bad = clone(VALID_DESCRIPTOR);
    // "firecrawl" falls back to itself — not "another" resource id (AC3).
    bad.resources[1].fallback = bad.resources[1].id;

    const result = validatePackDescriptor(bad);
    expect(result.valid).toBe(false);
    const hit = result.errors.some((e) => (e.instancePath || '').includes('/resources/1/fallback'));
    expect(hit, 'an error must point at resources/1/fallback for a self-fallback: ' + JSON.stringify(result.errors)).toBe(true);
  });
});

describe('TASK-115 review fix — resource ids must be unique within a descriptor', () => {
  it('rejects_duplicate_resource_ids', () => {
    const bad = clone(VALID_DESCRIPTOR);
    bad.resources[1].id = bad.resources[0].id;
    // Drop the fallback so this test isolates the duplicate-id check from the
    // fallback check (a fallback referencing a now-duplicated id is a
    // separate concern the two checks don't need to entangle).
    delete bad.resources[1].fallback;

    const result = validatePackDescriptor(bad);
    expect(result.valid).toBe(false);
    const hit = result.errors.some((e) => (e.instancePath || '').includes('/resources/') && (e.instancePath || '').includes('/id'));
    expect(hit, 'an error must point at a resource id: ' + JSON.stringify(result.errors)).toBe(true);
  });
});

// TASK-123 — extend resources[] with two OPTIONAL descriptor-data fields:
// `activate_when` (an activation predicate over profile variables, e.g.
// "tier>=MEDIO") and `install` (an install command string). Per
// docs/design/addon-packs.md §8.1, exclusion/activation is expressed as
// descriptor DATA (this predicate + the existing `fallback` field), never
// hardcoded core logic — the resource table is a maintained manifest read at
// runtime. This ticket ONLY makes the schema accept + round-trip the two
// fields; predicate EVALUATION is a Phase D/F concern and is explicitly out
// of scope here (no parser/evaluator is exercised or expected).
describe('TASK-123 AC1 — resources[] accepts optional activate_when + install', () => {
  it('accepts_a_resource_with_both_activate_when_and_install', () => {
    // VALID_DESCRIPTOR.resources[0] (frontend-design) already carries both
    // fields (AC4 fixture extension); this pins that the whole descriptor
    // still validates with them present.
    const result = validatePackDescriptor(VALID_DESCRIPTOR);
    expect(
      result.valid,
      'descriptor with activate_when + install must pass: ' + JSON.stringify(result.errors, null, 2),
    ).toBe(true);
    expect(result.errors).toBeNull();
  });

  it('accepts_a_resource_omitting_both_activate_when_and_install', () => {
    // resources[1] (firecrawl) carries neither field — backward compatible
    // with every pre-TASK-123 descriptor/fixture.
    const ok = clone(VALID_DESCRIPTOR);
    expect(ok.resources[1].activate_when).toBeUndefined();
    expect(ok.resources[1].install).toBeUndefined();

    const result = validatePackDescriptor(ok);
    expect(result.valid, 'resource omitting both fields must still validate: ' + JSON.stringify(result.errors)).toBe(true);
  });
});

describe('TASK-123 AC2 — activate_when/install must be non-empty strings when present', () => {
  it('rejects_an_empty_activate_when', () => {
    const bad = clone(VALID_DESCRIPTOR);
    bad.resources[0].activate_when = '';

    const result = validatePackDescriptor(bad);
    expect(result.valid).toBe(false);
    const hit = result.errors.some((e) => (e.instancePath || '').includes('/resources/0/activate_when'));
    expect(hit, 'an error must point at resources/0/activate_when: ' + JSON.stringify(result.errors)).toBe(true);
  });

  it('rejects_a_non_string_activate_when', () => {
    const bad = clone(VALID_DESCRIPTOR);
    bad.resources[0].activate_when = 42;

    const result = validatePackDescriptor(bad);
    expect(result.valid).toBe(false);
    const hit = result.errors.some((e) => (e.instancePath || '').includes('/resources/0/activate_when'));
    expect(hit, 'an error must point at resources/0/activate_when: ' + JSON.stringify(result.errors)).toBe(true);
  });

  it('rejects_an_empty_install', () => {
    const bad = clone(VALID_DESCRIPTOR);
    bad.resources[0].install = '';

    const result = validatePackDescriptor(bad);
    expect(result.valid).toBe(false);
    const hit = result.errors.some((e) => (e.instancePath || '').includes('/resources/0/install'));
    expect(hit, 'an error must point at resources/0/install: ' + JSON.stringify(result.errors)).toBe(true);
  });

  it('rejects_a_non_string_install', () => {
    const bad = clone(VALID_DESCRIPTOR);
    bad.resources[0].install = ['not', 'a', 'string'];

    const result = validatePackDescriptor(bad);
    expect(result.valid).toBe(false);
    const hit = result.errors.some((e) => (e.instancePath || '').includes('/resources/0/install'));
    expect(hit, 'an error must point at resources/0/install: ' + JSON.stringify(result.errors)).toBe(true);
  });
});

describe('TASK-123 AC3 — resources[] stays additionalProperties:false for every other key', () => {
  it('rejects_an_unknown_resource_field_activateWhen_typo', () => {
    const bad = clone(VALID_DESCRIPTOR);
    delete bad.resources[0].activate_when;
    bad.resources[0].activateWhen = 'always'; // typo — camelCase, not the real field

    const result = validatePackDescriptor(bad);
    expect(result.valid).toBe(false);
    expect(result.errors, 'an unknown resource field must still be rejected: ' + JSON.stringify(result.errors)).not.toBeNull();
  });

  it('rejects_an_unknown_resource_field_installl_typo', () => {
    const bad = clone(VALID_DESCRIPTOR);
    delete bad.resources[0].install;
    bad.resources[0].installl = 'claude plugin add anthropic/frontend-design'; // typo — extra "l"

    const result = validatePackDescriptor(bad);
    expect(result.valid).toBe(false);
    expect(result.errors, 'an unknown resource field must still be rejected: ' + JSON.stringify(result.errors)).not.toBeNull();
  });
});
