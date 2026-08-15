// src/subagent-log.js
// TASK-219 — pure, testable core for the SubagentStop persistence hook.
//
// WHY: the SubagentStop payload (see hooks/persist-subagent.mjs) carries
// last_assistant_message VERBATIM — the subagent's final answer, served in
// full, no transcript parsing required. Today that value only survives if
// the ORCHESTRATOR is alive to relay it into the session bundle's
// subagent_results (capped at 15 entries, ~1000 chars each — a curated
// index, not a durable record; see state/README.md's "Compaction" section
// and this file's AC7 note below). This module builds a full, uncapped,
// append-only record of every subagent's result, independent of whether
// the orchestrator ever reads the hook payload back.
//
// AC7 (how the two logs coexist): this log is the RAW, machine-written,
// append-only source of truth for "what did each subagent return" — every
// entry, full last_assistant_message, no cap, no curation. The bundle's
// subagent_results stays the orchestrator's CURATED summary (bounded,
// human-authored gist) for quick session recall. Neither replaces the
// other; a missing/rotated bundle entry can always be recovered from this
// log by session_id + agent_id.
//
// Never throws: every exported function is designed to degrade to a safe
// default (null / best-effort record) rather than propagate an exception,
// because the hook that calls this module must always exit 0 (AC5 — see
// hooks/persist-subagent.mjs's header for the exit-2-vs-persist decision).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Build the durable log record for one SubagentStop event.
 *
 * Tolerates a malformed/partial payload (missing fields, wrong types) — a
 * field that isn't present or isn't a string is recorded as null rather
 * than throwing or omitting the record entirely. Losing the record because
 * one field was odd would defeat the ticket's whole point (AC2).
 *
 * @param {*} payload - parsed SubagentStop hook JSON (may be malformed/partial)
 * @param {{ activeTicket?: string|null }} [opts]
 * @returns {object} the JSONL record to append
 */
export function buildSubagentRecord(payload, { activeTicket = null } = {}) {
  const p = (payload && typeof payload === 'object') ? payload : {};
  // Empty-result contract (fix round, TASK-219 — same argument as the ticket
  // attribution fix): an empty or whitespace-only string is not a value, it
  // is the ABSENCE of one — treating it as one would let e.g. agent_type: ""
  // (confirmed to occur in real payloads: a subagent that emitted a
  // SubagentStop with no matching SubagentStart) read back as if "" were a
  // real, distinct agent type instead of "unknown". Normalize to null so a
  // reader can't mistake absence for a value.
  const str = (v) => (typeof v === 'string' && v.trim().length > 0 ? v : null);

  return {
    captured_at: new Date().toISOString(),
    session_id: str(p.session_id),
    agent_id: str(p.agent_id),
    agent_type: str(p.agent_type),
    ticket: activeTicket ?? null,
    last_assistant_message: str(p.last_assistant_message),
    agent_transcript_path: str(p.agent_transcript_path),
    cwd: str(p.cwd),
    hook_event_name: str(p.hook_event_name),
  };
}

/**
 * Resolve the ticket the orchestrator is currently driving (AC3): follow the
 * pointer -> bundle, then apply this precedence:
 *
 *   1. bundle.active_task, if it is a non-empty string -> use it.
 *   2. else, only when bundle.mode === 'loop', bundle.loop_state.current_ticket,
 *      if it is a non-empty string -> use it.
 *   3. else -> null.
 *
 * WHY this order and WHY the mode guard on step 2 (fix round, post hand-off):
 * `active_task` is a REQUIRED bundle field (state/bundle.schema.json) and is
 * the field the RESUME-FIRST contract itself treats as authoritative (see
 * state/README.md step 3 of the bundle resume path) — it is kept current in
 * BOTH harness mode (the default, human-gated, one-step-at-a-time operating
 * mode) and loop mode. `loop_state.current_ticket`, by contrast, is only
 * ever written by the autonomous drive loop (src/loop-checkpoint.js) — in
 * harness mode (today's default) nothing updates it, so it can sit frozen on
 * whatever ticket a PAST loop run last touched, including one that has since
 * been closed. Reading it unconditionally when active_task is null (the
 * normal state of a session at rest) would silently attribute fresh
 * subagent results to a stale, possibly-closed ticket — worse than `ticket:
 * null`, because null honestly says "unknown" while a stale ticket key
 * confidently asserts something false. That is exactly the failure class
 * CLAUDE.md's "Empty-result contract" section warns against: absence of
 * evidence rendered as evidence of absence (here, a wrong-but-confident
 * answer standing in for "don't know"). Gating step 2 on `mode === 'loop'`
 * confines loop_state reads to the one operating mode where the field is
 * actually kept live.
 *
 * Never throws — any failure (missing pointer, corrupt JSON, missing
 * bundle) resolves to null. A resolution failure is NEVER a reason to drop
 * the subagent record itself; it only means the record is filed with
 * ticket: null.
 *
 * @param {string} repoRoot
 * @returns {string|null}
 */
export function resolveActiveTicket(repoRoot) {
  try {
    const pointerPath = join(repoRoot, 'state', 'session.json');
    if (!existsSync(pointerPath)) return null;
    const pointer = JSON.parse(readFileSync(pointerPath, 'utf8'));
    const sessionId = pointer && pointer.active_session_id;
    if (!sessionId || typeof sessionId !== 'string') return null;

    const bundlePath = join(repoRoot, 'state', 'sessions', sessionId, 'session.json');
    if (!existsSync(bundlePath)) return null;
    const bundle = JSON.parse(readFileSync(bundlePath, 'utf8'));

    if (bundle && typeof bundle.active_task === 'string' && bundle.active_task.length > 0) {
      return bundle.active_task;
    }

    if (bundle && bundle.mode === 'loop') {
      const ticket = bundle.loop_state && bundle.loop_state.current_ticket;
      if (typeof ticket === 'string' && ticket.length > 0) return ticket;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve the destination JSONL log path (AC3 / hook plumbing).
 * Preferred: alongside the active session bundle, so the raw record lives
 * next to the session state it belongs to. Falls back to a repo-root-level
 * log when there is no resolvable active bundle (no pointer, corrupt
 * pointer, pointer with no active_session_id). Never throws.
 *
 * @param {string} repoRoot
 * @returns {string} absolute path to the target .jsonl file
 */
export function resolveLogPath(repoRoot) {
  try {
    const pointerPath = join(repoRoot, 'state', 'session.json');
    if (existsSync(pointerPath)) {
      const pointer = JSON.parse(readFileSync(pointerPath, 'utf8'));
      const sessionId = pointer && pointer.active_session_id;
      if (sessionId && typeof sessionId === 'string') {
        return join(repoRoot, 'state', 'sessions', sessionId, 'subagent-log.jsonl');
      }
    }
  } catch {
    // fall through to the repo-root fallback
  }
  return join(repoRoot, 'state', 'subagent-log.jsonl');
}
