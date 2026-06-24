// src/schemas.js
// JSON Schemas as JS objects, for direct import + ajv compilation.
// Also re-exported from this single module so tests can `import { ... } from 'schemas.js'`
// without juggling JSON imports / assertion syntax.
//
// Note on the two independent schema_version dimensions:
//   * The bundle-STATE version is `2`. It lives in BOTH `state/session.json`
//     (the pointer file) and inside each bundle's `session.json`. This
//     tracks the shape of the orchestrator-state payload.
//   * The bundle-LAYOUT version is `1`. It lives in `manifest.json` and
//     tracks the directory structure of a bundle (what files are present:
//     session.json, manifest.json, lifecycle.log, summary.md, etc.).
// They are independent on purpose: the state payload can evolve without
// renaming the bundle's files, and the bundle layout can grow new optional
// files without invalidating older state payloads. Do not try to unify
// them — different change axes deserve different version numbers.

export const pointerSchema = {
  $id: 'https://hivemind.local/state/session.schema.json',
  title: 'SessionPointer',
  description:
    'Pointer file. Names the currently-active session bundle under state/sessions/. Read first on every new chat.',
  type: 'object',
  required: ['schema_version', 'active_session_id', 'updated_at'],
  additionalProperties: false,
  properties: {
    schema_version: { const: 2 },
    active_session_id: {
      type: ['string', 'null'],
      pattern: '^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$',
      description:
        'ID of the bundle under state/sessions/. Null = no active session (idle between sessions).',
    },
    updated_at: { type: 'string', format: 'date-time' },
  },
};

// Bundle-state schema (state/sessions/<id>/session.json). Per resolved Q #8 the
// version field is named schema_version (matching the pointer), not version.
// Field set: every v1 field, plus session_id, plus lifecycle_state.
export const bundleStateSchema = {
  $id: 'https://hivemind.local/state/sessions/bundle.schema.json',
  title: 'BundleSession',
  description:
    'Per-session orchestrator state living inside a portable bundle at ' +
    'state/sessions/<id>/session.json. Per resolved Q #8 the version field ' +
    'is named schema_version (matching the pointer file). The length caps ' +
    'that lived on next_action and subagent_results[].summary in the v1 ' +
    'schema were removed: in practice the orchestrator writes multi-paragraph ' +
    'handoff text and 2-4 paragraph subagent summaries, and capping those ' +
    'at 300/1000 characters caused the live bundle to fail validation. ' +
    'subagent_results items also declare two optional fields the orchestrator ' +
    'uses (`task`: free-text label for the run, `agentId`: SendMessage ' +
    'continuation handle) — they are typed explicitly rather than waved ' +
    'through with additionalProperties: true, so the schema still documents ' +
    'the full payload shape.',
  type: 'object',
  required: [
    'schema_version',
    'session_id',
    'lifecycle_state',
    'updated_at',
    'active_task',
    'workflow_step',
    'next_action',
    'handoff_summary',
  ],
  additionalProperties: false,
  properties: {
    schema_version: { const: 2 },
    session_id: {
      type: 'string',
      pattern: '^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$',
    },
    lifecycle_state: { type: 'string', enum: ['active', 'paused', 'ended'] },
    updated_at: { type: 'string', format: 'date-time' },
    active_task: {
      type: ['string', 'null'],
      pattern: '^TASK-[0-9]{3,}$',
    },
    workflow_step: {
      type: 'string',
      enum: ['idle', 'fetch', 'research', 'test', 'impl', 'review', 'update'],
    },
    next_action: {
      type: ['string', 'null'],
      description:
        'Multi-paragraph description of the next step on resume. ' +
        'Intentionally uncapped — see schema description.',
    },
    handoff_summary: { type: 'string' },
    open_questions: { type: 'array', default: [], items: { type: 'string' } },
    blockers: { type: 'array', default: [], items: { type: 'string' } },
    decisions: {
      type: 'array',
      default: [],
      items: {
        type: 'object',
        required: ['at', 'decision', 'rationale'],
        additionalProperties: false,
        properties: {
          at: { type: 'string', format: 'date-time' },
          decision: { type: 'string' },
          rationale: { type: 'string' },
        },
      },
    },
    subagent_results: {
      type: 'array',
      default: [],
      items: {
        type: 'object',
        required: ['agent', 'at', 'summary'],
        additionalProperties: false,
        properties: {
          agent: { type: 'string', enum: ['researcher', 'developer', 'reviewer'] },
          at: { type: 'string', format: 'date-time' },
          summary: {
            type: 'string',
            description:
              'Multi-paragraph subagent return summary. ' +
              'Intentionally uncapped — see schema description.',
          },
          artifacts: { type: 'array', default: [], items: { type: 'string' } },
          task: {
            type: 'string',
            description:
              "Optional free-text label naming the run this subagent did " +
              "(e.g. 'TASK-004 phase 3a implementation').",
          },
          agentId: {
            type: 'string',
            description:
              'Optional SendMessage continuation handle for re-spawning ' +
              'the same subagent in a later turn.',
          },
        },
      },
    },
    pending_human_confirmation: { type: ['string', 'null'], default: null },
    mode: {
      type: 'string',
      enum: ['harness', 'loop'],
      default: 'harness',
      description:
        "Operating mode of the active session. 'harness' = default, human-gated, " +
        "one-step-at-a-time. 'loop' = autonomous drive loop is active. Absence is " +
        "treated as 'harness' (backward-compatible). TASK-063.",
    },
    loop_auth: {
      type: 'object',
      description:
        'Standing-authorization switches for the autonomous drive loop. ' +
        'All default false (most conservative). See commands/loop.md.',
      additionalProperties: false,
      properties: {
        auto_close_on_green_review: { type: 'boolean', default: false },
        auto_push_after_close: { type: 'boolean', default: false },
        uat_delegated_to_orchestrator: { type: 'boolean', default: false },
        auto_version_bump_on_milestone: { type: 'boolean', default: false },
      },
    },
    loop_state: {
      type: 'object',
      description:
        'Runtime state for the autonomous drive loop (TASK-062). Stored in the bundle ' +
        'so crash-recovery can resume. Free-form — contents evolve with the loop implementation.',
      additionalProperties: true,
    },
  },
};

// Manifest schema (state/sessions/<id>/manifest.json). manifest.schema_version
// is independent of the bundle session.schema_version; the manifest tracks the
// bundle-layout version, currently 1.
export const manifestSchema = {
  $id: 'https://hivemind.local/state/sessions/manifest.schema.json',
  title: 'BundleManifest',
  type: 'object',
  required: ['session_id', 'schema_version', 'created_at', 'host', 'snapshot_transcript'],
  additionalProperties: true, // tolerate forward-compat fields
  properties: {
    session_id: { type: 'string', pattern: '^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$' },
    schema_version: { const: 1 },
    created_at: { type: 'string', format: 'date-time' },
    host: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    snapshot_transcript: { type: 'boolean' },
    transcript_refs: { type: 'array', items: { type: 'object' } },
    lifted_from_v1: { type: 'boolean' },
  },
};
