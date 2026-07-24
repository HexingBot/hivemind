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
  // TASK-178 — the four Wave-2 TRACKED (non-assimilated) human-installed
  // resources (Impeccable, Taste Skill, Higgsfield, 21st.dev Magic) are
  // kind:plugin/kind:mcp, report-only entries: the human installs them
  // manually, so they are deliberately NOT wired into
  // src/design-profile.js#resourceActivations (which would require them to
  // be gated by the Fase-1 interview like frontend-design/shadcn/openart
  // are). They are excluded from this membership check by design, not
  // oversight — see packs/design-power/README.md.
  const TRACKED_NOT_GATED_IDS = new Set(['impeccable', 'taste-skill', 'higgsfield', '21st-dev-magic']);

  it('resource_ids_are_a_subset_of_resourceActivations_keys', () => {
    const result = scoreComplexity(FULL_PROFILE_ANSWERS);
    const knownKeys = new Set(Object.keys(resourceActivations(result)));

    const resourceIds = DESIGN_POWER_DESCRIPTOR.resources
      .map((r) => r.id)
      .filter((id) => !TRACKED_NOT_GATED_IDS.has(id));
    expect(resourceIds.length).toBeGreaterThan(0);
    for (const id of resourceIds) {
      expect(knownKeys.has(id), `resource id "${id}" is not a key of resourceActivations(...)`).toBe(true);
    }
  });

  it('tracked_not_gated_resources_are_genuinely_absent_from_resourceActivations_keys', () => {
    // Non-vacuity: proves the exclusion above is excluding something real,
    // not a no-op filter over ids that would have passed anyway.
    const result = scoreComplexity(FULL_PROFILE_ANSWERS);
    const knownKeys = new Set(Object.keys(resourceActivations(result)));
    for (const id of TRACKED_NOT_GATED_IDS) {
      expect(DESIGN_POWER_DESCRIPTOR.resources.map((r) => r.id)).toContain(id);
      expect(knownKeys.has(id), `expected "${id}" to be absent from resourceActivations keys`).toBe(false);
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

describe('AC6 — tracked-tool marker substring locks commands/design-pack.md Step 6a (TASK-179)', () => {
  // commands/design-pack.md Step 6a keys the tracked-tool offer on the exact
  // substring "not gated by resourceActivations" inside each resource's
  // activate_when. Nothing else locks that coupling, so a future descriptor
  // reword could silently empty Step 6's offer without any test noticing.
  // This regression lock pins the marker-matched id set to the known tracked
  // four (the same TRACKED_NOT_GATED_IDS set as AC2 above) so a drift in the
  // marker text itself — not just the ids it covers — fails loudly.
  const TRACKED_TOOL_IDS = new Set(['impeccable', 'taste-skill', 'higgsfield', '21st-dev-magic']);
  const MARKER = 'not gated by resourceActivations';

  it('marker_substring_matches_exactly_the_tracked_tool_ids', () => {
    const markedIds = DESIGN_POWER_DESCRIPTOR.resources
      .filter((r) => typeof r.activate_when === 'string' && r.activate_when.includes(MARKER))
      .map((r) => r.id)
      .sort();
    expect(markedIds).toEqual([...TRACKED_TOOL_IDS].sort());
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
