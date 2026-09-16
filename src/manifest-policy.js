// manifest-policy — catalog of the Spine's six language-agnostic manifests (Phase 3). Manifests
// are now OPTIONAL tooling a developer may choose to produce/update whenever it helps, at any
// point in the work — TASK-230 (2026-09-16 human decision, Mato: "Elimínalo. Ya no necesitamos
// esa parte. Elimina el TDD.") retired the gate that used to require one BEFORE code on
// tests-after tickets. That gate was the same class of "process gate before code" that the
// free-movement policy (CLAUDE.md's Workflow section, "Movimiento libre en el desarrollo")
// eliminates for every other pre-code step; it survived an earlier pass by accident, not by
// decision, and TASK-230 is that decision. No verification_tier requires a manifest before code.
// The reviewer does NOT treat a missing manifest as a finding — `agents/reviewer.md` and
// `reviews/REVIEWER-CHECKLIST.md` have never mentioned manifests outside the unrelated
// Observability/OTel item; a prior version of this file's header claimed otherwise, which was
// false and has been removed. See PLAN.md Phase 3 and the vendored impl-* manifest skills for
// what each manifest captures when a developer opts in.
// TASK-212 — the 'tdd' tier is retired (2026-08-13 human decision); 'tests-after' is the default
// tier for all real work.

/** The six language-agnostic manifests, each produced by its vendored skill. */
export const MANIFESTS = [
  { id: 'SCREEN_SPECS', skill: 'impl-screen-specs', file: 'implementation/SCREEN_SPECS.md',
    purpose: 'Per-screen spec: components, data, API calls, user actions, states, i18n.' },
  { id: 'API_CONTRACTS', skill: 'impl-api-contracts', file: 'implementation/API_CONTRACTS.md',
    purpose: 'Endpoint table by module: method, path, auth, request/response, cache keys.' },
  { id: 'STATE_SCHEMAS', skill: 'impl-state-schemas', file: 'implementation/STATE_SCHEMAS.md',
    purpose: 'Server/query state + UI state stores; cache-invalidation rules.' },
  { id: 'COMPONENT_CATALOG', skill: 'impl-component-catalog', file: 'implementation/COMPONENT_CATALOG.md',
    purpose: 'Shared UI components, one canonical entry per input type; props + behavior.' },
  { id: 'PROJECT_STRUCTURE', skill: 'impl-project-structure', file: 'implementation/PROJECT_STRUCTURE.md',
    purpose: 'Annotated source tree, module boundaries, ADR-decided stack assumptions.' },
  { id: 'BLOCK_TASKS', skill: 'impl-block-tasks', file: 'implementation/BLOCK_TASKS.md',
    purpose: 'Work blocks broken into tasks with testable + observable acceptance criteria.' },
];

const MANIFEST_IDS = new Set(MANIFESTS.map((m) => m.id));

// Absent verification_tier means tests-after (matches tasks/schema.json's backward-compatible default).
const DEFAULT_TIER = 'tests-after';

/**
 * Does a ticket at this verification_tier need a manifest before code? Always false — TASK-230
 * (2026-09-16 human decision) removed the pre-code manifest gate for every tier. Kept as a
 * function (rather than deleted) because callers ask this question and the answer is now a
 * constant fact worth naming, not a per-tier lookup.
 */
export function requiresManifest(_verificationTier) {
  return false;
}

/** Look up a manifest descriptor by id (e.g. 'API_CONTRACTS'). */
export function manifestById(id) {
  return MANIFESTS.find((m) => m.id === id) || null;
}

/**
 * Which manifests are relevant to a ticket, as an informational lookup — not a gate. `manifests`
 * may name the specific manifests the ticket touches (filtered to known ids); when omitted, all
 * six are the candidate set. `required` is always `false` (TASK-230, 2026-09-16 human decision):
 * no verification_tier requires a manifest before code, so the field records that fact rather than
 * branching on tier. Kept on the return shape for backward compatibility with existing callers.
 */
export function gateForTicket({ verification_tier, manifests } = {}) {
  const tier = verification_tier || DEFAULT_TIER;

  const ids = Array.isArray(manifests) && manifests.length > 0
    ? manifests.filter((id) => MANIFEST_IDS.has(id))
    : MANIFESTS.map((m) => m.id);
  const resolved = ids.map(manifestById).filter(Boolean);

  return {
    required: false,
    tier,
    manifests: resolved,
    reason: `verification_tier '${tier}' — manifests are optional tooling a developer may use at any point in the work (TASK-230, 2026-09-16 human decision)`,
  };
}
