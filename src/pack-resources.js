// src/pack-resources.js
// TASK-131 — FP-3: the pure glue between the scored design profile
// (src/design-profile.js#scoreComplexity, TASK-125) and a pack descriptor's
// resources[] (packs/design-power/descriptor.json, TASK-130). Builds the
// "desired" resource set src/pack-reconcile.js#plan(desired, lock, actual)
// consumes (FP-4/TASK-132): plan() expects `desired` to be an array of the
// descriptor's own resource objects (each with kind/id/pin/... — see
// pack-reconcile.js's JSDoc and its "resource.kind !== 'skill'" report
// branch), so resolveDesired returns descriptor resource objects verbatim,
// never bare ids and never clones.
//
// Pure — no fs/network/clock/random, mirroring src/design-profile.js and
// src/pack-reconcile.js#plan's own purity contract. Not a bundled plugin
// entrypoint (see scripts/build-plugin.mjs ENTRYPOINT_NAMES) — no
// `npm run build:plugin` rebuild needed for this ticket.

import { resourceActivations } from './design-profile.js';

/**
 * Intersect a pack descriptor's resources[] against the activation map for
 * THIS project's scored design profile: a resource is kept iff
 * resourceActivations(profileResult)[resource.id] is exactly `true`. A
 * resource id absent from resourceActivations' keys (e.g. a descriptor typo,
 * or a resource the activation predicates don't know about) is never
 * silently activated — `undefined !== true`, so it is excluded, matching
 * §5.2's own closed-world contract. The §8.1 canvas-gating exclusion
 * (ui_outside_canvas==false disables shadcn-vue/shadcn-ui/playwright) is
 * inherited for free from resourceActivations — it is NOT re-implemented
 * here.
 *
 * @param {{resources?: Array<object>}} descriptor - a validated pack
 *   descriptor (src/pack-descriptor.js#validatePackDescriptor); only
 *   `descriptor.resources` is read. A missing/non-array `resources` is
 *   treated as empty rather than throwing.
 * @param {{tier: string, axes: object, activations: object}} profileResult -
 *   the return value of scoreComplexity(answers).
 * @returns {Array<object>} the subset of descriptor.resources that are
 *   activated for this profile, in descriptor order, as the SAME object
 *   references (no cloning) — the shape src/pack-reconcile.js#plan's
 *   `desired` parameter expects.
 */
export function resolveDesired(descriptor, profileResult) {
  const resources = Array.isArray(descriptor?.resources) ? descriptor.resources : [];
  const activations = resourceActivations(profileResult);
  return resources.filter((resource) => resource && activations[resource.id] === true);
}
