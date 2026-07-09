// src/builtin-packs.js
// TASK-129 — close the unfed-registration-hook gap TASK-128 flagged: bin/init.js
// accepted packDescriptors/packModules but nothing in production supplied them,
// so src/pack-loader.js#loadActivePacks() was always a strict no-op end-to-end.
// This module is that "something": it registers the design-power pack as an
// ALWAYS-LOADED first-party candidate (discovery Option C) so its single
// unconditional `design_heavy` gate question is injected into every project
// intake by default, per docs/design/design-profile-spec.md.
//
// Descriptor placement note: the FP-1 seed descriptor lives in its own JSON
// file, packs/design-power/descriptor.json, rather than inline in this module.
// FP-2 (TASK-130) owns the REAL resource pins/origins/gate_scopes/pipeline —
// dropping that data in means overwriting packs/design-power/descriptor.json
// in place (same id, same file, same import here) with zero churn to this
// module's wiring. The seed here is deliberately minimal: just enough to pass
// validatePackDescriptor() (state/pack-descriptor.schema.json) and declare
// project_md_contribution: ['perfil_proyecto', 'tier'] — the two frontmatter
// keys src/design-profile.js#deriveProfileFields is allowed to write.
//
// Module binding: DESIGN_PROFILE_QUESTIONS and deriveProfileFields are
// imported directly from src/design-profile.js (Phase E) — this file adds NO
// scoring/derivation logic of its own, only the thin self-gate documented
// below (AC3: "not a reimplementation").
//
// The self-gate (critical — see docs/design/design-profile-spec.md §4 and
// TASK-129's AC2): scoreComplexity()/deriveProfileFields() do NOT return an
// empty perfil_proyecto when design_heavy !== 'yes' — they return a real (if
// all-false/zero) activations map, which would otherwise leak
// design_heavy:'false', score:'0', etc. into EVERY non-design project's
// PROJECT.md the instant design-power becomes always-loaded. deriveProjectMd
// below adds exactly one gate on top of the real function: a design_heavy
// answer other than 'yes' contributes NOTHING (an empty object), matching
// pre-TASK-129 behavior (no design-power pack at all) exactly. This is a gate
// over the real deriveProfileFields call, not a parallel implementation — the
// 'yes' branch below calls deriveProfileFields verbatim with no transformation.

import { DESIGN_PROFILE_QUESTIONS, deriveProfileFields } from './design-profile.js';
import __designPowerDescriptor from '../packs/design-power/descriptor.json' with { type: 'json' };

export const DESIGN_POWER_DESCRIPTOR = __designPowerDescriptor;

/**
 * Thin off-by-default gate around the REAL deriveProfileFields (see header).
 * @param {object} answers
 * @returns {{tier?: string, perfil_proyecto?: Record<string,string>}}
 */
function deriveProjectMdGated(answers) {
  if (!answers || answers.design_heavy !== 'yes') return {};
  return deriveProfileFields(answers);
}

export const DESIGN_POWER_MODULE = {
  questions: DESIGN_PROFILE_QUESTIONS,
  deriveProjectMd: deriveProjectMdGated,
};

// The built-in first-party candidate set bin/init.js passes BY DEFAULT to
// src/pack-loader.js#loadActivePacks(). A caller that explicitly supplies its
// own packDescriptors/packModules (e.g. tests, or a future --no-builtin-packs
// escape hatch) overrides this default entirely — JS default-parameter
// semantics, not a merge. Future built-in (first-party) packs are added here
// as additional descriptor/module pairs — a single accretion point.
export const BUILTIN_PACK_DESCRIPTORS = [DESIGN_POWER_DESCRIPTOR];
export const BUILTIN_PACK_MODULES = { [DESIGN_POWER_DESCRIPTOR.id]: DESIGN_POWER_MODULE };
