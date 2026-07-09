// tests/design-power-descriptor.spec.js
// TASK-130 — FP-2: the production design-power pack descriptor
// (packs/design-power/descriptor.json). This is the one minimal machine
// validity lock the ticket calls for: a data-regression sensor over the
// descriptor's shape and its cross-references into src/design-profile.js
// (resourceActivations/pipelineSteps/deriveProfileFields), which
// state/pack-descriptor.schema.json alone cannot express (it validates
// envelope shape, not cross-file predicate/key alignment).
//
// Pure logic, no disk I/O beyond the module's own static JSON import — fast tier.

import { describe, it, expect } from 'vitest';

import { DESIGN_POWER_DESCRIPTOR } from '../src/builtin-packs.js';
import { validatePackDescriptor } from '../src/pack-descriptor.js';
import {
  scoreComplexity,
  resourceActivations,
  pipelineSteps,
  deriveProfileFields,
} from '../src/design-profile.js';

// A representative design_heavy=='yes' full-profile answer set — exercises
// every branch of the Fase-1 interview so resourceActivations/pipelineSteps
// return their full key sets regardless of which branch is truthy for this
// particular answer set (AC only needs the KEY SET, not the boolean values).
const FULL_PROFILE_ANSWERS = {
  design_heavy: 'yes',
  estimated_screens: 10,
  stakes: 'real',
  design_ambition: 'branded',
  ui_framework: 'react',
  has_canvas_render: 'no',
  motion_required: 'yes',
  motion_layer: 'dom',
  needs_research: 'need-research',
  assets_required: ['icons-custom', 'illustrations'],
};

describe('AC1 — descriptor is schema-valid', () => {
  it('validatePackDescriptor_reports_valid_true', () => {
    const { valid, errors } = validatePackDescriptor(DESIGN_POWER_DESCRIPTOR);
    expect(valid, `expected a valid descriptor, got errors: ${JSON.stringify(errors)}`).toBe(true);
  });
});

describe('AC2 — every resource id is a real resourceActivations key', () => {
  it('resource_ids_are_a_subset_of_resourceActivations_keys', () => {
    const result = scoreComplexity(FULL_PROFILE_ANSWERS);
    const knownKeys = new Set(Object.keys(resourceActivations(result)));

    const resourceIds = DESIGN_POWER_DESCRIPTOR.resources.map((r) => r.id);
    expect(resourceIds.length).toBeGreaterThan(0);
    for (const id of resourceIds) {
      expect(knownKeys.has(id), `resource id "${id}" is not a key of resourceActivations(...)`).toBe(true);
    }
  });
});

describe('AC3 — project_md_contribution matches deriveProfileFields keys', () => {
  it('project_md_contribution_deep_equals_deriveProfileFields_return_keys', () => {
    const expectedKeys = Object.keys(deriveProfileFields(FULL_PROFILE_ANSWERS)).sort();
    const actualKeys = [...DESIGN_POWER_DESCRIPTOR.project_md_contribution].sort();
    expect(actualKeys).toEqual(expectedKeys);
  });
});

describe('AC4 — pipeline matches pipelineSteps keys', () => {
  it('pipeline_deep_equals_pipelineSteps_keys', () => {
    const result = scoreComplexity(FULL_PROFILE_ANSWERS);
    const expectedKeys = Object.keys(pipelineSteps(result)).sort();
    const actualKeys = [...DESIGN_POWER_DESCRIPTOR.pipeline].sort();
    expect(actualKeys).toEqual(expectedKeys);
  });
});

describe('AC5 — gsap and openart are absent from resources[] (product decision)', () => {
  it('gsap_is_absent', () => {
    const ids = DESIGN_POWER_DESCRIPTOR.resources.map((r) => r.id);
    expect(ids).not.toContain('gsap');
  });

  it('openart_is_absent', () => {
    const ids = DESIGN_POWER_DESCRIPTOR.resources.map((r) => r.id);
    expect(ids).not.toContain('openart');
  });
});
