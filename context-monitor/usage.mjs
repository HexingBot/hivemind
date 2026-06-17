/**
 * usage.mjs — Pure logic for context-window usage monitoring.
 *
 * This module contains ONLY pure, side-effect-free functions that can be unit
 * tested without any I/O. Flag-file writing, hook integration, and statusline
 * output are handled by the scripts that import this module.
 *
 * Exported interface:
 *   THRESHOLD          {number}  — Flush trigger at this usage percentage (35).
 *   readUsagePercent   {function} — Extract used_percentage from statusline JSON.
 *   shouldFlush        {function} — Pure decision: should a flush be triggered?
 *   armedFlagName      {function} — Returns the armed flag filename for a session.
 *   instructedFlagName {function} — Returns the instructed sentinel filename for a session.
 *
 * State-machine overview ("exactly once per crossing"):
 *   armed flag       (.flush-<id>)      — set by statusline when usage first >= THRESHOLD
 *   instructed flag  (.instructed-<id>) — set by stop-hook after emitting the one-time block
 *   re-arm           — statusline removes BOTH when usage drops below THRESHOLD
 *   clear/compact    — session-start removes BOTH so the next crossing re-arms cleanly
 *
 * Deliberate trade-off: "exactly once per crossing" is favored over "nag every turn".
 * If the model ignores the single instruction, re-arm happens when % next drops below
 * THRESHOLD (e.g. after a /compact that reduces usage) or after a /clear.
 */

/**
 * The usage percentage at which a flush should be initiated.
 * This is the ONLY magic number for the flush threshold — all other scripts
 * must import this constant rather than hardcoding a value.
 * @type {number}
 */
export const THRESHOLD = 35;

/**
 * Extract the numeric used_percentage from a parsed statusline JSON object.
 *
 * @param {object|null|undefined} statuslineInput - Parsed statusline JSON.
 * @returns {number|null} The used_percentage, or null if unavailable/malformed.
 */
export function readUsagePercent(statuslineInput) {
  if (statuslineInput == null) return null;
  const cw = statuslineInput.context_window;
  if (cw == null) return null;
  const pct = cw.used_percentage;
  if (typeof pct !== 'number') return null;
  return pct;
}

/**
 * Pure decision: should a flush be triggered right now?
 *
 * Returns true ONLY when:
 *   - percent is a number >= THRESHOLD, AND
 *   - alreadyFlagged is false/falsy  (idempotency: never re-fire while flagged)
 *
 * Returns false when percent is null (unknown usage = no flush).
 *
 * @param {number|null} percent      - Current usage percentage, or null.
 * @param {boolean}     alreadyFlagged - True if the flag file already exists.
 * @returns {boolean}
 */
export function shouldFlush(percent, alreadyFlagged) {
  if (percent === null || typeof percent !== 'number') return false;
  if (alreadyFlagged) return false;
  return percent >= THRESHOLD;
}

/**
 * Returns the filename (not full path) for the per-session armed flag.
 * The armed flag signals that usage has crossed the threshold for this session.
 *
 * @param {string|null|undefined} sessionId
 * @returns {string}
 */
export function armedFlagName(sessionId) {
  return `.flush-${sessionId || 'default'}`;
}

/**
 * Returns the filename (not full path) for the per-session instructed sentinel.
 * The instructed sentinel signals that the stop-hook has already emitted its
 * one-time block instruction for the current crossing.
 *
 * @param {string|null|undefined} sessionId
 * @returns {string}
 */
export function instructedFlagName(sessionId) {
  return `.instructed-${sessionId || 'default'}`;
}
