// src/session-projection.js
// TASK-055 — bounded session-state projection for GET /api/session.
//
// Reuses the RESUME-FIRST read path (readPointer → readBundleSession) and
// returns a SAFE, BOUNDED plain object. Never dumps the full bundle.
// Never throws — corrupt/absent state → idle projection.

import { readPointer } from './pointer.js';
import { readBundleSession } from './bundle.js';

// ---------------------------------------------------------------------------
// Cap constants (named so tests can assert against them).
// ---------------------------------------------------------------------------
export const CAP_NEXT_ACTION = 280;  // chars; append '…' if cut
export const CAP_FIELD = 200;        // chars for open_questions / blockers / decision text
export const CAP_LIST = 5;           // max items for open_questions / blockers
export const CAP_DECISIONS = 2;      // max recent decisions returned

// ---------------------------------------------------------------------------
// Truncation helper.
// ---------------------------------------------------------------------------
function truncate(str, max, ellipsis = '…') {
  if (typeof str !== 'string') return str;
  if (str.length <= max) return str;
  return str.slice(0, max) + ellipsis;
}

// ---------------------------------------------------------------------------
// Idle projection — returned when there is no active session or on error.
// ---------------------------------------------------------------------------
function idleProjection(extras = {}) {
  return {
    idle: true,
    workflow_step: 'idle',
    active_task: null,
    open_questions: [],
    blockers: [],
    next_action: null,
    recent_decisions: [],
    ...extras,
  };
}

// ---------------------------------------------------------------------------
// Public — projectSessionState({ repoRoot })
// Returns a bounded projection; never throws.
// ---------------------------------------------------------------------------
export function projectSessionState({ repoRoot }) {
  // Step 1: read the pointer.
  let pointer;
  try {
    pointer = readPointer(repoRoot);
  } catch (err) {
    return idleProjection({ error: String(err && err.message || err) });
  }

  if (!pointer || pointer.active_session_id == null) {
    return idleProjection();
  }

  // Step 2: read the bundle session.
  let bundle;
  try {
    bundle = readBundleSession(repoRoot, pointer.active_session_id);
  } catch (err) {
    // Missing or corrupt bundle → idle, not a 500.
    return idleProjection({ error: String(err && err.message || err) });
  }

  // Step 3: build a BOUNDED projection — never return the raw bundle.
  const openQuestions = Array.isArray(bundle.open_questions)
    ? bundle.open_questions.slice(0, CAP_LIST).map((q) => truncate(String(q), CAP_FIELD))
    : [];

  const blockers = Array.isArray(bundle.blockers)
    ? bundle.blockers.slice(0, CAP_LIST).map((b) => truncate(String(b), CAP_FIELD))
    : [];

  // recent_decisions: last CAP_DECISIONS entries, each truncated.
  const rawDecisions = Array.isArray(bundle.decisions) ? bundle.decisions : [];
  const recentDecisions = rawDecisions
    .slice(-CAP_DECISIONS)
    .map((d) => ({
      at: d && d.at != null ? d.at : undefined,
      decision: truncate(String(d && d.decision != null ? d.decision : d), CAP_FIELD),
    }));

  const nextAction = bundle.next_action != null
    ? truncate(String(bundle.next_action), CAP_NEXT_ACTION)
    : null;

  return {
    idle: false,
    lifecycle_state: bundle.lifecycle_state,
    workflow_step: bundle.workflow_step,
    active_task: bundle.active_task ?? null,
    open_questions: openQuestions,
    blockers: blockers,
    next_action: nextAction,
    recent_decisions: recentDecisions,
    updated_at: bundle.updated_at,
  };
}
