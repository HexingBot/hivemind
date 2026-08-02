// tests/uat-verdict-marker-compat.spec.js
// TASK-186 AC4 — backward-compatibility sensor for the structured-verdict fix
// in src/close-guard.js and src/task-store.js. A token-scan-over-prose gate
// cannot be made reliable by extending the token list (V1 was the proof), so
// the fix replaces it with a structured per-step check — but every
// pre-existing free-text `uat` comment in the repo's OWN tasks/ must either
// still satisfy the gate under the documented legacy path, or be migrated.
// This is a PERMANENT sensor (not a one-off proof script): it reads the
// repo's real tasks/*.json — same precedent as tests/graph-freshness.spec.js
// reading tasks/ + knowledge/graph/graph.json, and
// tests/use-case-policy.spec.js reading USE-CASES.md — a synchronous read of
// already-committed files, not mkdtemp/process-spawn I/O, so it belongs in
// the fast tier per vitest.config.js's tier boundary (folder = tier) and
// therefore runs in both `npm test` and `npm run test:all`.
//
// SCOPE (orchestrator amendment, post-implementation cross-ticket audit): a
// real-corpus grep found 45 tickets carrying a free-text `uat` comment (not
// 29 — the earlier count scoped to status:done + verification_tier:uat-only
// only). AC4 says "run the check against all 45, not a sample", so this
// sensor validates every ticket with ANY author:'uat' comment, regardless of
// its verification_tier or status, and asserts the validated count is
// exactly the audited figure (45) — a silent corpus shrink (e.g. a ticket
// file deleted or a comment rewritten) fails loudly here instead of quietly
// narrowing what AC4's proof actually covers.
//
// DECISION (stated in the TASK-186 hand-off): every pre-existing free-text
// uat comment is a NEW-LEGACY-PATH case, not a migration — no tasks/*.json
// file is rewritten by this ticket. hasRecordedUatVerdict (task-store.js,
// harness-mode gate) and hasExplicitHumanVerdictMarker (close-guard.js,
// loop-mode Gate 2) both changed. Both changes are, for real on-disk data,
// additive-only: no already-done ticket flips from gate-satisfying to
// gate-denying.
//   - hasRecordedUatVerdict: old behavior was "does ANY author:'uat' comment
//     exist" (always true once one exists). New behavior narrows to "does
//     the LAST uat comment have a non-empty body naming a recognizable
//     verdict word (PASS)". Proven below: true for all 45 real tickets.
//   - hasExplicitHumanVerdictMarker: old behavior is reimplemented verbatim
//     below as oldHasExplicitHumanVerdictMarker (the pre-TASK-186
//     token-scan). Proven below: NEW === OLD for all 45 real tickets' last
//     uat comment — the fix never flips a real recorded verdict from
//     accepted to rejected. (It is allowed to newly REJECT bodies that were
//     never exercised by a real close, and none of the real data does — the
//     assertion below is full equality, not merely non-regression,
//     precisely because no such case exists in tasks/ today.)
//
// Neither predicate is actually INVOKED for a non-uat-only ticket during a
// real close (checkUatGuard/loopModeCloseGuard's Gate 2 both short-circuit
// on verification_tier !== 'uat-only'), so the 16 tests-after/undefined-tier
// tickets in the 45 are not literally gated by either function today — this
// sensor still runs both predicates against their real bodies for the fuller
// proof the audit asked for, and because a future ticket could plausibly
// widen either gate's tier scope.
//
// SCHEMA DECISION (orchestrator amendment): the structured verdict is
// encoded entirely INSIDE the existing `body` string (the "Verdict: PASS"
// per-step label convention) — no new comment fields, no
// tasks/schema.json change. This sidesteps the schema's
// `additionalProperties: false` on comment items entirely and avoids
// colliding with the queued TASK-189 schema change.
//
// RED-GREEN EVIDENCE: this sensor was authored and run green against
// tasks/ as it stood at TASK-186 implementation time. See the TASK-186
// hand-off for the verbatim node-script proof this spec formalizes.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './helpers/repoRoot.js';
import { TASK_FILENAME_RE, hasRecordedUatVerdict } from '../src/task-store.js';
import { hasExplicitHumanVerdictMarker } from '../src/close-guard.js';

// ---------------------------------------------------------------------------
// Pre-TASK-186 reference implementation of hasExplicitHumanVerdictMarker,
// reproduced verbatim (see git history of src/close-guard.js before this
// ticket) so the live-repo assertion below is a true OLD-vs-NEW diff, not a
// re-statement of the new logic under a different name.
// ---------------------------------------------------------------------------
const OLD_DELEGATED_MARKER_RE = /verified by orchestrator at the human'?s request/i;
const OLD_OVERALL_PASS_RE = /overall result:?\s*pass\b/i;
const OLD_FAIL_VERDICT_RE = /\bfail(?:ed|ing|s)?\b/i;

function oldHasExplicitHumanVerdictMarker(task) {
  const comments = Array.isArray(task && task.comments) ? task.comments : [];
  const uatComments = comments.filter((c) => c && c.author === 'uat');
  if (uatComments.length === 0) return false;
  const last = uatComments[uatComments.length - 1];
  const body = String((last && last.body) || '');
  if (OLD_DELEGATED_MARKER_RE.test(body)) return false;
  if (OLD_FAIL_VERDICT_RE.test(body)) return false;
  return OLD_OVERALL_PASS_RE.test(body);
}

// Audited figure (orchestrator amendment) — the full real-corpus count of
// tickets carrying at least one author:'uat' comment, as of TASK-186. Locked
// as a floor (not an exact match) so the corpus growing over time doesn't
// break this sensor, while a corpus SHRINK (fewer validated tickets than the
// audited figure) still fails loudly below.
const AUDITED_UAT_COMMENT_TICKET_COUNT = 45;

function loadRealTicketsWithUatComment() {
  const tasksDir = join(REPO_ROOT, 'tasks');
  const files = readdirSync(tasksDir).filter((f) => TASK_FILENAME_RE.test(f));
  return files
    .map((f) => JSON.parse(readFileSync(join(tasksDir, f), 'utf8')))
    .filter((t) => Array.isArray(t.comments) && t.comments.some((c) => c && c.author === 'uat'));
}

describe('TASK-186 AC4 — real tasks/: no ticket with a pre-existing free-text uat comment becomes retroactively invalid', () => {
  it('validates the full audited corpus, not a sample (>= 45 tickets with a real uat comment)', () => {
    const tickets = loadRealTicketsWithUatComment();
    expect(
      tickets.length,
      `expected at least the audited ${AUDITED_UAT_COMMENT_TICKET_COUNT} tickets with a uat comment, `
        + `found ${tickets.length} — AC4's backward-compat proof must cover the full real corpus`,
    ).toBeGreaterThanOrEqual(AUDITED_UAT_COMMENT_TICKET_COUNT);
  });

  it('harness-mode gate: hasRecordedUatVerdict is true for every real ticket with a uat comment (new content check, additive-only)', () => {
    const tickets = loadRealTicketsWithUatComment();
    const failing = tickets.filter((t) => !hasRecordedUatVerdict(t));
    expect(
      failing.map((t) => t.key),
      failing.length > 0
        ? `${failing.length} ticket(s) would now be retroactively invalid under the harness-mode `
          + `content check: ${failing.map((t) => t.key).join(', ')}. Either the real comment needs a `
          + 'recorded PASS verdict, or hasRecordedUatVerdict needs a documented legacy path.'
        : '',
    ).toEqual([]);
  });

  it('loop-mode Gate 2: hasExplicitHumanVerdictMarker (new) agrees exactly with the pre-TASK-186 logic (old) for every real uat comment', () => {
    const tickets = loadRealTicketsWithUatComment();
    const flipped = tickets.filter(
      (t) => hasExplicitHumanVerdictMarker(t) !== oldHasExplicitHumanVerdictMarker(t),
    );
    expect(
      flipped.map((t) => ({
        key: t.key, old: oldHasExplicitHumanVerdictMarker(t), now: hasExplicitHumanVerdictMarker(t),
      })),
      flipped.length > 0
        ? `${flipped.length} ticket(s) flipped marker result under the structured-verdict fix: `
          + `${flipped.map((t) => t.key).join(', ')}. This is the exact retroactive-invalidation AC4 `
          + 'forbids — either the ticket needs deliberate migration, or the new logic needs a '
          + 'documented legacy-path adjustment.'
        : '',
    ).toEqual([]);
  });
});
