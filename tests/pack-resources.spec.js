// tests/pack-resources.spec.js
// TASK-131 — FP-3: resolveDesired(descriptor, profileResult), the pure glue
// between the scored design profile (TASK-125, src/design-profile.js) and
// the reconciler (TASK-118, src/pack-reconcile.js#plan). Intersects a pack
// descriptor's resources[] against resourceActivations(profileResult): a
// resource is kept iff resourceActivations(profileResult)[resource.id] is
// exactly `true`.
//
// Pure logic, no disk I/O of its own — fast tier. The descriptor fixture
// used is the REAL production descriptor (src/builtin-packs.js#DESIGN_POWER_
// DESCRIPTOR, backed by packs/design-power/descriptor.json, TASK-130) and
// every profileResult is produced by the REAL scoreComplexity(answers) — not
// a hand-faked activations map — so these tests exercise the real §5.2
// activation predicates end-to-end, including the §8.1 canvas exclusion,
// rather than re-asserting a parallel implementation of them.
//
// Acceptance criteria covered:
//   AC1 — COMPLETO + framework==vue + ui_outside_canvas includes
//     ui-ux-pro-max, shadcn-vue, playwright; excludes shadcn/ui.
//   AC2 — the same profile with ui_outside_canvas flipped to false drops
//     shadcn-vue, shadcn/ui, and playwright (the §8.1 canvas exclusion,
//     inherited from resourceActivations rather than re-implemented here).
//   AC3 — a LIGERO profile yields only the always-on resource(s)
//     (frontend-design) or an empty set — never a MEDIO/COMPLETO-only
//     resource (ui-ux-pro-max, playwright).
//   AC4 — a resource id present in descriptor.resources but absent from
//     resourceActivations' keys is never silently activated; resolveDesired
//     performs no I/O.

import { describe, it, expect } from 'vitest';

import { resolveDesired } from '../src/pack-resources.js';
import { scoreComplexity, resourceActivations } from '../src/design-profile.js';
import { DESIGN_POWER_DESCRIPTOR } from '../src/builtin-packs.js';

const ALL_RESOURCE_IDS = DESIGN_POWER_DESCRIPTOR.resources.map((r) => r.id);

function idsOf(resources) {
  return resources.map((r) => r.id).sort();
}

// ---------------------------------------------------------------------------
// Table-driven cases: canvas, non-canvas, LIGERO (x2), unknown-id (AC4).
// Each case supplies real `answers` fed through the real scoreComplexity, an
// (optional) descriptor override, and the expected included/excluded ids.
// ---------------------------------------------------------------------------

const COMPLETO_VUE_BASE_ANSWERS = {
  design_heavy: 'yes',
  estimated_screens: 10, // F bucket 2 (fHigh)
  stakes: 'real',
  design_ambition: 'branded', // B = 2 (bHigh) -> tier COMPLETO
  ui_framework: 'vue',
  has_canvas_render: 'yes',
  motion_required: 'no',
  needs_research: 'have-direction',
  assets_required: ['none'],
};

const CASES = [
  {
    name: 'AC1 — COMPLETO + vue + ui_outside_canvas=yes: ui-ux-pro-max, shadcn-vue, playwright in; shadcn/ui out',
    answers: { ...COMPLETO_VUE_BASE_ANSWERS, ui_outside_canvas: 'yes' },
    includes: ['ui-ux-pro-max', 'shadcn-vue', 'playwright'],
    excludes: ['shadcn/ui'],
  },
  {
    name: 'AC2 — same COMPLETO+vue profile, ui_outside_canvas=no: canvas exclusion drops shadcn-vue, shadcn/ui, playwright',
    answers: { ...COMPLETO_VUE_BASE_ANSWERS, ui_outside_canvas: 'no' },
    includes: ['frontend-design', 'ui-ux-pro-max'],
    excludes: ['shadcn-vue', 'shadcn/ui', 'playwright'],
  },
  {
    name: 'AC3a — LIGERO via design_heavy=no: desired set is empty (frontend-design itself is gated off)',
    answers: { design_heavy: 'no' },
    includes: [],
    excludes: ALL_RESOURCE_IDS,
  },
  {
    name: 'AC3b — LIGERO via design_heavy=yes but low F/B: only frontend-design, never a MEDIO/COMPLETO-only resource',
    answers: {
      design_heavy: 'yes',
      estimated_screens: 1, // F = 0
      stakes: 'low',
      design_ambition: 'utilitarian', // B = 0 -> tier LIGERO
      ui_framework: 'other', // keeps shadcn-vue/shadcn-ui out regardless of domUi
      has_canvas_render: 'no',
      motion_required: 'no',
      needs_research: 'have-direction',
      assets_required: ['none'],
    },
    includes: ['frontend-design'],
    excludes: ['ui-ux-pro-max', 'shadcn-vue', 'shadcn/ui', 'firecrawl', 'playwright'],
  },
  {
    name: 'AC4 — a resource id absent from resourceActivations keys is never silently activated',
    answers: { ...COMPLETO_VUE_BASE_ANSWERS, ui_outside_canvas: 'yes' },
    descriptor: {
      ...DESIGN_POWER_DESCRIPTOR,
      resources: [
        ...DESIGN_POWER_DESCRIPTOR.resources,
        {
          id: 'totally-fake-resource',
          kind: 'mcp',
          origin: 'nowhere',
          pin: '0.0.0',
          scope: 'project',
          required: 'soft',
        },
      ],
    },
    includes: ['ui-ux-pro-max', 'shadcn-vue', 'playwright'],
    excludes: ['shadcn/ui', 'totally-fake-resource'],
  },
];

describe.each(CASES)('$name', ({ answers, descriptor, includes, excludes }) => {
  it('resolveDesired includes/excludes the right resource ids', () => {
    const profileResult = scoreComplexity(answers);
    const desired = resolveDesired(descriptor ?? DESIGN_POWER_DESCRIPTOR, profileResult);
    const ids = idsOf(desired);

    for (const id of includes) {
      expect(ids, `expected "${id}" to be in the desired set: ${JSON.stringify(ids)}`).toContain(id);
    }
    for (const id of excludes) {
      expect(ids, `expected "${id}" to be excluded from the desired set: ${JSON.stringify(ids)}`).not.toContain(id);
    }
  });
});

// ---------------------------------------------------------------------------
// AC4 (continued) — sanity check that AC4's unknown-id case actually proves
// something: 'totally-fake-resource' really is absent from resourceActivations'
// own key set, not merely absent from the descriptor's normal resource list.
// ---------------------------------------------------------------------------
describe('AC4 — unknown id is genuinely outside resourceActivations key space', () => {
  it('totally-fake-resource_is_not_a_resourceActivations_key', () => {
    const profileResult = scoreComplexity({ ...COMPLETO_VUE_BASE_ANSWERS, ui_outside_canvas: 'yes' });
    const knownKeys = Object.keys(resourceActivations(profileResult));
    expect(knownKeys).not.toContain('totally-fake-resource');
  });
});

// ---------------------------------------------------------------------------
// Shape + purity — the returned desired set is an array of the descriptor's
// own resource OBJECTS (the shape src/pack-reconcile.js#plan's `desired`
// param expects), and resolveDesired performs no I/O / mutation.
// ---------------------------------------------------------------------------
describe('shape + purity', () => {
  it('returns_the_descriptors_own_resource_objects_not_bare_ids', () => {
    const profileResult = scoreComplexity({ ...COMPLETO_VUE_BASE_ANSWERS, ui_outside_canvas: 'yes' });
    const desired = resolveDesired(DESIGN_POWER_DESCRIPTOR, profileResult);
    expect(desired.length).toBeGreaterThan(0);
    for (const resource of desired) {
      expect(typeof resource).toBe('object');
      expect(resource).toHaveProperty('kind');
      expect(resource).toHaveProperty('pin');
      // Object identity with the descriptor's own array entry — no cloning.
      expect(DESIGN_POWER_DESCRIPTOR.resources).toContain(resource);
    }
  });

  it('is_pure_no_mutation_of_inputs_and_deterministic_across_calls', () => {
    const profileResult = scoreComplexity({ ...COMPLETO_VUE_BASE_ANSWERS, ui_outside_canvas: 'yes' });
    const descriptorSnapshot = JSON.stringify(DESIGN_POWER_DESCRIPTOR);
    const profileSnapshot = JSON.stringify(profileResult);

    const first = idsOf(resolveDesired(DESIGN_POWER_DESCRIPTOR, profileResult));
    const second = idsOf(resolveDesired(DESIGN_POWER_DESCRIPTOR, profileResult));

    expect(first).toEqual(second);
    expect(JSON.stringify(DESIGN_POWER_DESCRIPTOR)).toBe(descriptorSnapshot);
    expect(JSON.stringify(profileResult)).toBe(profileSnapshot);
  });

  it('handles_a_descriptor_with_no_resources_array_by_returning_empty', () => {
    const profileResult = scoreComplexity({ ...COMPLETO_VUE_BASE_ANSWERS, ui_outside_canvas: 'yes' });
    expect(resolveDesired({ id: 'empty-pack' }, profileResult)).toEqual([]);
  });
});
