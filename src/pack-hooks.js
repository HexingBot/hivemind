// src/pack-hooks.js
// TASK-127 — Pack hooks: turn an active-pack set (src/pack-registry.js) into
// wizard contributions (Phase D-2, docs/design/addon-packs-plan.md §5/§8).
// Second link of the Option-C hybrid registration hook: the pack DESCRIPTOR
// (src/pack-descriptor.js / state/pack-descriptor.schema.json) is the
// declarative allowlist; a pack MODULE supplies named PURE exports core
// invokes only for the surfaces the descriptor declares. This module is that
// invocation boundary for the two Phase-D-2 surfaces: intake questions and
// PROJECT.md field contributions.
//
// PURE throughout: no fs/network/clock/random. src/pack-registry.js's
// resolveActivePacks() returns `{ active: descriptor[], skipped }` — bare
// descriptor OBJECTS, with no module code attached (Phase D-1 is
// deliberately data-only). Binding a descriptor to its pack's actual code
// (reading/importing the module off disk) is I/O and belongs to the wiring
// ticket (TASK-128, bin/init.js), not here. This module instead defines and
// consumes a small ACTIVE-PACK ADAPTER shape:
//
//   ActivePack = {
//     descriptor: object,   // an admitted descriptor (pack-registry.js's
//                            // `active[]` entries) — must carry `id` and
//                            // `project_md_contribution`.
//     module: {
//       questions?: Array<object>,               // consumed by collectPackQuestions
//       deriveProjectMd?: (answers: object) => object, // consumed by applyProjectMdContributions
//     },
//   }
//
// The caller (bin/init.js, in TASK-128) is responsible for zipping each
// `resolveActivePacks().active` descriptor with its already-loaded pack
// module into this shape before calling either collector below. For
// design-power: module.questions = DESIGN_PROFILE_QUESTIONS,
// module.deriveProjectMd = deriveProfileFields (src/design-profile.js).
//
// Neither export here reaches to disk to discover packs or modules — both
// take the ActivePack array as a plain argument, keeping this module fast-tier
// testable and trivially pure/deterministic.

// ---------------------------------------------------------------------------
// collectPackQuestions — append active-pack questions after core questions.
// ---------------------------------------------------------------------------

/**
 * Concatenate each active pack's `module.questions` onto the core question
 * list, appended strictly AFTER all core questions so every pack question's
 * forward-only `when(answers)` predicate (src/question-engine.js — no
 * lookahead) can only reference ids that already precede it: core ids, or an
 * earlier pack's ids in the same call. Packs are processed in the order given
 * in `activePacks` (src/pack-registry.js's `active` array is already sorted
 * by descriptor id, for reproducible injection order).
 *
 * Collision guard: this throws a PACK-ATTRIBUTED error (naming both the
 * offending pack id and the colliding question id) the moment a pack
 * question's id collides with a core id OR with an id already contributed by
 * an earlier pack in this same call. This check runs before
 * runQuestionnaire() ever sees the combined list, so the failure names the
 * offending pack instead of surfacing only as the engine's later generic
 * "duplicate question id" throw (src/question-engine.js:53-57).
 *
 * Zero active packs is a strict no-op: the core list is returned unchanged
 * (same question objects, not copies) — injection is additive and
 * off-by-default.
 *
 * @param {Array<object>} coreQuestions - the core intake question list (e.g.
 *   buildIntakeQuestions() from src/question-library.js). Never mutated.
 * @param {Array<{descriptor: object, module: {questions?: Array<object>}}>} activePacks
 * @returns {Array<object>} core questions followed by each pack's questions,
 *   in pack order.
 */
export function collectPackQuestions(coreQuestions, activePacks) {
  if (!Array.isArray(activePacks) || activePacks.length === 0) {
    return coreQuestions;
  }

  const seenIds = new Set(coreQuestions.map((q) => q.id));
  const combined = [...coreQuestions];

  for (const pack of activePacks) {
    const packId = pack && pack.descriptor && pack.descriptor.id;
    const questions = (pack && pack.module && pack.module.questions) || [];
    for (const q of questions) {
      if (seenIds.has(q.id)) {
        throw new Error(
          `collectPackQuestions: pack "${packId}" question id "${q.id}" collides with ` +
          'an existing question id (a core question, or a question already ' +
          'contributed by an earlier active pack) — pack question ids must be unique',
        );
      }
      seenIds.add(q.id);
      combined.push(q);
    }
  }

  return combined;
}

// ---------------------------------------------------------------------------
// applyProjectMdContributions — run each pack's derive fn, enforce isolation.
// ---------------------------------------------------------------------------

/**
 * Run each active pack's `module.deriveProjectMd(answers)` and merge its
 * returned fields into a copy of `answers`. Each pack's derived output is
 * validated against its OWN descriptor's `project_md_contribution` allowlist
 * (the isolation envelope, docs/design/addon-packs.md §8) before anything
 * from that pack is merged: every key the derive fn returns must be a member
 * of `descriptor.project_md_contribution`. A derived key outside that
 * envelope throws a PACK-ATTRIBUTED isolation error (naming the pack id and
 * the offending key) and merges NOTHING for that pack — all-or-nothing, so a
 * partially-valid derive result can never leak an unauthorized field.
 *
 * `answers` itself is never mutated; a new object is returned. Packs lacking
 * a `module.deriveProjectMd` contribute nothing (treated as an empty derive).
 * Every pack's derive fn is called with the ORIGINAL `answers` passed in —
 * packs are independent contributors, not a pipeline, so one pack's output
 * never becomes another pack's input.
 *
 * Zero active packs is a strict no-op: a shallow copy of `answers`, deep-equal
 * to the input, is returned — injection is additive and off-by-default.
 *
 * @param {Array<{descriptor: object, module: {deriveProjectMd?: (answers: object) => object}}>} activePacks
 * @param {object} answers - the wizard's accumulated answers map.
 * @returns {object} a new object: `answers` merged with every active pack's
 *   validated contribution.
 */
export function applyProjectMdContributions(activePacks, answers) {
  const merged = { ...answers };
  if (!Array.isArray(activePacks) || activePacks.length === 0) {
    return merged;
  }

  for (const pack of activePacks) {
    const descriptor = (pack && pack.descriptor) || {};
    const packId = descriptor.id;
    const deriveFn = pack && pack.module && pack.module.deriveProjectMd;
    if (typeof deriveFn !== 'function') continue;

    const result = deriveFn(answers) || {};
    const allowed = new Set(
      Array.isArray(descriptor.project_md_contribution) ? descriptor.project_md_contribution : [],
    );

    const offending = Object.keys(result).filter((key) => !allowed.has(key));
    if (offending.length > 0) {
      throw new Error(
        `applyProjectMdContributions: pack "${packId}" derived key(s) ` +
        `${JSON.stringify(offending)} outside its declared project_md_contribution ` +
        `${JSON.stringify([...allowed])} — refusing to merge any field from this pack ` +
        '(all-or-nothing isolation)',
      );
    }

    Object.assign(merged, result);
  }

  return merged;
}
