// tests/requires-uat.spec.js
// TASK-221 — requires_uat field on tasks/schema.json + its default.
//
// Acceptance criteria covered (fast tier — pure logic, reads committed files,
// no mkdtemp / process spawns):
//   AC1 — tasks/schema.json declares requires_uat as an optional boolean with
//         its own description, and additionalProperties: false keeps
//         validating every other field the same way.
//   AC2 — the default when the field is absent is false, demonstrated with a
//         real, already-closed ticket that does not carry the field.
//   AC6 (indirectly) — the real-ticket case in AC2 reads tasks/ read-only;
//         nothing here writes to any tasks/*.json.
//   AC7 — minimal regression locks: at least one case with requires_uat true,
//         one with false, and one without the field at all, demonstrating all
//         three validate against the schema and that requiresUat() resolves
//         the documented default.
//
// requiresUat() itself (src/task-store.js) is the single place TASK-220 and
// TASK-222 are meant to read the default from — this spec pins its contract
// directly rather than each future caller re-deriving `=== true`.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { REPO_ROOT } from './helpers/repoRoot.js';
import { requiresUat, TASK_FILENAME_RE } from '../src/task-store.js';

function loadSchema() {
  return JSON.parse(readFileSync(join(REPO_ROOT, 'tasks', 'schema.json'), 'utf8'));
}

function makeAjv() {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv;
}

/** A minimal valid task payload without requires_uat. */
function baseTask(overrides = {}) {
  return {
    key: 'TASK-001',
    title: 'A test task',
    description: 'For requires_uat schema tests.',
    acceptance_criteria: ['works'],
    status: 'todo',
    priority: 'medium',
    labels: [],
    assignee: null,
    depends_on: [],
    linked_commits: [],
    linked_prs: [],
    comments: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    jira_key: null,
    ...overrides,
  };
}

// ===========================================================================
// AC1 — schema declares requires_uat as an optional boolean
// ===========================================================================
describe('AC1 — schema: requires_uat field', () => {
  it('schema_declares_requires_uat_as_an_optional_boolean', () => {
    const schema = loadSchema();
    const prop = schema.properties?.requires_uat;
    expect(prop, 'tasks/schema.json must declare a requires_uat property').toBeTruthy();
    expect(prop.type).toBe('boolean');
    expect(schema.required).not.toContain('requires_uat');
    expect(
      typeof prop.description === 'string' && prop.description.length > 0,
      'requires_uat must carry its own non-empty description',
    ).toBe(true);
  });

  it.each([true, false])('schema_accepts_requires_uat_%s', (value) => {
    const ajv = makeAjv();
    const validate = ajv.compile(loadSchema());
    const task = baseTask({ requires_uat: value });
    const ok = validate(task);
    expect(
      ok,
      `schema must accept requires_uat: ${value} — errors: ${JSON.stringify(validate.errors)}`,
    ).toBe(true);
  });

  it('schema_rejects_a_non_boolean_requires_uat', () => {
    const ajv = makeAjv();
    const validate = ajv.compile(loadSchema());
    const task = baseTask({ requires_uat: 'yes' });
    const ok = validate(task);
    expect(ok, 'schema must reject a non-boolean requires_uat value').toBe(false);
  });
});

// ===========================================================================
// AC2/AC7 — absent requires_uat still validates; default is false
// ===========================================================================
describe('AC2/AC7 — requires_uat absent: schema still validates, default is false', () => {
  it('schema_still_accepts_a_task_without_requires_uat', () => {
    const ajv = makeAjv();
    const validate = ajv.compile(loadSchema());
    const task = baseTask(); // no requires_uat key
    const ok = validate(task);
    expect(
      ok,
      'schema must still accept tasks without requires_uat — ' + JSON.stringify(validate.errors),
    ).toBe(true);
  });

  it('a_real_already_closed_ticket_without_requires_uat_defaults_to_false', () => {
    // AC2 — demonstrate the default on a real ticket, not a synthetic fixture.
    // Deliberately picks the lowest-numbered `status: done` ticket lacking the
    // field, rather than hard-coding one key, so this stays true regardless of
    // which specific ticket a future reader opens this file next to.
    const tasksDir = join(REPO_ROOT, 'tasks');
    const files = readdirSync(tasksDir).filter((f) => TASK_FILENAME_RE.test(f)).sort();
    expect(files.length, 'the real tasks/ corpus must be non-empty for this demonstration').toBeGreaterThan(0);

    const candidate = files
      .map((f) => JSON.parse(readFileSync(join(tasksDir, f), 'utf8')))
      .find((t) => t.status === 'done' && !Object.prototype.hasOwnProperty.call(t, 'requires_uat'));

    expect(
      candidate,
      'expected at least one already-closed ticket with no requires_uat field (AC6: the ~206 pre-existing closed tickets are not retrofitted)',
    ).toBeTruthy();
    expect(Object.prototype.hasOwnProperty.call(candidate, 'requires_uat')).toBe(false);
    expect(requiresUat(candidate)).toBe(false);
  });
});

// ===========================================================================
// AC7 — requiresUat() helper: true / false / absent all resolve correctly
// ===========================================================================
describe('AC7 — requiresUat() helper: true/false/absent regression locks', () => {
  it('requiresUat_returns_true_when_the_field_is_exactly_true', () => {
    expect(requiresUat({ requires_uat: true })).toBe(true);
  });

  it('requiresUat_returns_false_when_the_field_is_exactly_false', () => {
    expect(requiresUat({ requires_uat: false })).toBe(false);
  });

  it('requiresUat_returns_false_when_the_field_is_absent', () => {
    expect(requiresUat({})).toBe(false);
  });
});
