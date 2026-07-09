// src/pack-loader.js
// TASK-128 — Minimal pack-loading seam: binds descriptor objects to their
// pack modules and runs them through the registry (src/pack-registry.js) to
// produce the ActivePack[] adapter set src/pack-hooks.js consumes.
//
// SCOPE NOTE (flagged for the Orchestrator, not resolved here): this loader
// takes descriptors + a module registry as explicit ARGUMENTS — it does NOT
// scan disk for pack descriptor files. There is no general on-disk discovery
// convention for "where a project's active packs live" anywhere in
// docs/design/addon-packs-plan.md yet; that convention (for arbitrary
// third-party packs) remains a future Phase-F concern.
//
// TASK-129 update: bin/init.js's default call is NO LONGER a strict no-op.
// src/builtin-packs.js registers the design-power pack as an ALWAYS-LOADED
// first-party candidate (discovery Option C) and bin/init.js now defaults
// packDescriptors/packModules to that module's BUILTIN_PACK_DESCRIPTORS /
// BUILTIN_PACK_MODULES instead of [] / {}. A caller (or test) that supplies
// its own packDescriptors/packModules explicitly still overrides this
// default entirely, including opting out with [] / {} for a true zero-pack
// run. A general discovery mechanism for OTHER (non-built-in) packs is still
// unbuilt and remains Phase F's concern.
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
