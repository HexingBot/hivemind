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
// TASK-176 — generic (non-design) activation seam: resourceActivations()
// (src/design-profile.js) is a hardcoded closed-world map of design-power's
// OWN resource ids only, so a pack unrelated to the design profile (e.g. the
// assimilated `watch` pack, packs/watch/descriptor.json) could never be
// activated — its resource id is simply absent from that map, and
// `undefined !== true` excludes it forever. Rather than teach
// resourceActivations about non-design resources (which would break its own
// closed-world contract and couple an unrelated pack to the design-profile
// module), a resource that opts in with the literal sentinel string
// `activate_when: "always"` is now kept UNCONDITIONALLY, before
// resourceActivations is even consulted. This is additive and backward
// compatible: every existing design-power resource's `activate_when` is a
// freeform descriptive string (e.g. "always (design_heavy)", "tier !=
// LIGERO") that never equals the exact sentinel "always", so their
// activation continues to route through resourceActivations exactly as
// before (see tests/pack-resources.spec.js's regression lock).
//
// Pure — no fs/network/clock/random, mirroring src/design-profile.js and
// src/pack-reconcile.js#plan's own purity contract. Not a bundled plugin
// entrypoint (see scripts/build-plugin.mjs ENTRYPOINT_NAMES) — no
// `npm run build:plugin` rebuild needed for this ticket.

import { resourceActivations } from './design-profile.js';

// The exact-string sentinel a resource's `activate_when` must equal to be
// kept unconditionally (TASK-176). Deliberately an exact-equality check, not
// a substring/prefix match, so it can never accidentally collide with a
// longer descriptive activate_when string that merely contains this word.
const ALWAYS_ACTIVATE_SENTINEL = 'always';

/**
 * Intersect a pack descriptor's resources[] against either (a) the
 * unconditional TASK-176 "always" sentinel, or (b) the activation map for
 * THIS project's scored design profile: a resource is kept iff
 * `resource.activate_when === 'always'` OR
 * resourceActivations(profileResult)[resource.id] is exactly `true`. A
 * resource id absent from resourceActivations' keys (e.g. a descriptor typo,
 * or a resource the activation predicates don't know about) is never
 * silently activated via path (b) — `undefined !== true`, so it is excluded,
 * matching §5.2's own closed-world contract. The §8.1 canvas-gating
 * exclusion (ui_outside_canvas==false disables shadcn-vue/shadcn-ui/
 * playwright) is inherited for free from resourceActivations — it is NOT
 * re-implemented here.
 *
 * @param {{resources?: Array<object>}} descriptor - a validated pack
 *   descriptor (src/pack-descriptor.js#validatePackDescriptor); only
 *   `descriptor.resources` is read. A missing/non-array `resources` is
 *   treated as empty rather than throwing.
 * @param {{tier: string, axes: object, activations: object}} profileResult -
 *   the return value of scoreComplexity(answers). Only ever read (via
 *   resourceActivations) for a resource whose `activate_when` is NOT the
 *   "always" sentinel — a descriptor made up entirely of "always" resources
 *   (e.g. packs/watch/descriptor.json) never touches `profileResult` at all,
 *   so an arbitrary or even malformed/empty profileResult is safe to pass
 *   for such a descriptor.
 * @returns {Array<object>} the subset of descriptor.resources that are
 *   activated for this profile, in descriptor order, as the SAME object
 *   references (no cloning) — the shape src/pack-reconcile.js#plan's
 *   `desired` parameter expects.
 */
export function resolveDesired(descriptor, profileResult) {
  const resources = Array.isArray(descriptor?.resources) ? descriptor.resources : [];
  // Lazy + memoized: resourceActivations(profileResult) is only ever computed
  // if some resource actually needs it (short-circuited by the "always" check
  // below), and at most once per call even when several resources do.
  let activations;
  const getActivations = () => {
    if (activations === undefined) activations = resourceActivations(profileResult);
    return activations;
  };
  return resources.filter((resource) => resource
    && (resource.activate_when === ALWAYS_ACTIVATE_SENTINEL || getActivations()[resource.id] === true));
}
