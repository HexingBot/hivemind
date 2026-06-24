// manifest-policy — the tier gate for the Spine's spec layer (Phase 3). Decides whether a ticket
// must produce/update a language-agnostic manifest BEFORE code, based on its verification_tier:
// core work (tdd / tests-after) blueprints the hard stuff first; uat-only glue skips it. The
// orchestrator consults this before dispatching a developer; the reviewer treats a missing
// required manifest as a HIGH finding. See PLAN.md Phase 3 and the vendored impl-* manifest skills.

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

// Absent verification_tier means tdd (matches tasks/schema.json's backward-compatible default).
const DEFAULT_TIER = 'tdd';
// Tiers that require a manifest before code. uat-only glue (config/docs/wiring) is exempt.
const MANIFEST_REQUIRED_TIERS = new Set(['tdd', 'tests-after']);

/** Does a ticket at this verification_tier need a manifest before code? */
export function requiresManifest(verificationTier) {
  const tier = verificationTier || DEFAULT_TIER;
  return MANIFEST_REQUIRED_TIERS.has(tier);
}

/** Look up a manifest descriptor by id (e.g. 'API_CONTRACTS'). */
export function manifestById(id) {
  return MANIFESTS.find((m) => m.id === id) || null;
}

/**
 * The gate decision for a ticket. `manifests` may name the specific manifests the ticket touches
 * (filtered to known ids); when omitted, all six are the candidate set. Returns whether a manifest
 * is required before code, the resolved manifest descriptors, and a human-readable reason.
 */
export function gateForTicket({ verification_tier, manifests } = {}) {
  const tier = verification_tier || DEFAULT_TIER;
  const required = requiresManifest(tier);

  const ids = Array.isArray(manifests) && manifests.length > 0
    ? manifests.filter((id) => MANIFEST_IDS.has(id))
    : MANIFESTS.map((m) => m.id);
  const resolved = ids.map(manifestById).filter(Boolean);

  return {
    required,
    tier,
    manifests: resolved,
    reason: required
      ? `verification_tier '${tier}' is core work — emit/update its manifest(s) before code`
      : `verification_tier '${tier}' is glue — manifests skipped`,
  };
}
