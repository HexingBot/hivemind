// src/pack-loader.js
// TASK-128 — Minimal pack-loading seam: binds descriptor objects to their
// pack modules and runs them through the registry (src/pack-registry.js) to
// produce the ActivePack[] adapter set src/pack-hooks.js consumes.
//
// SCOPE NOTE (flagged for the Orchestrator, not resolved here): this loader
// takes descriptors + a module registry as explicit ARGUMENTS — it does NOT
// scan disk for pack descriptor files. There is no on-disk discovery
// convention for "where a project's active packs live" anywhere in
// docs/design/addon-packs-plan.md yet; that convention is Phase F's concern
// (§ "Phase F — The design-power pack (data + uat)"), which also owns the
// real resource pins/origins this ticket is explicitly barred from
// authoring. Inventing a discovery mechanism now would exceed TASK-128's
// minimal-wiring scope. Because of this, bin/init.js's default call (no
// descriptors/modules supplied) is a strict no-op — the mechanism is wired
// end-to-end and proven against a test fixture, but nothing feeds it in a
// real run yet. A future Phase-F ticket wires the real discovery source
// (however it is decided) to this same loadActivePacks() call.
//
// Pure/I-O-free: no fs, no network, no clock, no random. Mirrors
// src/pack-hooks.js's purity contract.

import { resolveActivePacks } from './pack-registry.js';

/**
 * @param {object} [opts]
 * @param {object[]} [opts.descriptors] - candidate pack descriptor objects.
 *   Defaults to [] (no-op).
 * @param {Record<string, {questions?: Array<object>, deriveProjectMd?: (answers: object) => object}>} [opts.moduleRegistry]
 *   - map of descriptor id -> pack module. Defaults to {} (no-op). A
 *   descriptor admitted by resolveActivePacks with no matching entry here
 *   binds to an empty module ({}) — collectPackQuestions/
 *   applyProjectMdContributions both already treat a moduleless pack as
 *   contributing nothing, so this never throws.
 * @param {string} [opts.hookApiVersion] - forwarded to resolveActivePacks;
 *   defaults to HOOK_API_VERSION there when omitted.
 * @returns {{ activePacks: Array<{descriptor: object, module: object}>, skipped: Array<{pack_id: string, reason: string}> }}
 */
export function loadActivePacks({ descriptors = [], moduleRegistry = {}, hookApiVersion } = {}) {
  const { active, skipped } = hookApiVersion === undefined
    ? resolveActivePacks(descriptors)
    : resolveActivePacks(descriptors, hookApiVersion);

  const activePacks = active.map((descriptor) => ({
    descriptor,
    module: moduleRegistry[descriptor.id] || {},
  }));

  return { activePacks, skipped };
}
