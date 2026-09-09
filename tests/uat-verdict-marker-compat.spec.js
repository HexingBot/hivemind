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
// its verification_tier or status, and asserts the validated count is AT
// LEAST the audited figure (45, a floor, not an exact match — the code below
// uses toBeGreaterThanOrEqual so a growing corpus never breaks this sensor)
// — a silent corpus SHRINK (e.g. a ticket file deleted or a comment
// rewritten) fails loudly here instead of quietly narrowing what AC4's proof
// actually covers.
//
// FIX-ROUND AMENDMENT (TASK-186, HIGH finding): the structured "Verdict:"
// convention is now MANDATORY for hasExplicitHumanVerdictMarker (the
// label-free legacy path is removed from loop mode's Gate 2 — see
// src/close-guard.js's doc comment). This flips exactly ONE real ticket,
// TASK-133, from old=true (it satisfied the pre-TASK-186 token scan via a
// label-free "Overall result: PASS" body) to new=false (it carries no
// literal "Verdict:" label on any step, so the now-mandatory structured
// check rejects it). This is the single documented exception AC4's "old===
// new" equality allows: TASK-133 is already `status: "done"`, and
// closeGuard/hasExplicitHumanVerdictMarker is only ever invoked at close
// time — an already-closed ticket is never re-gated, so the flip has zero
// real effect. Every other ticket in the 45-ticket corpus is unaffected
// (verified below): the equality assertion still holds for all of them.
//
// DECISION (stated in the TASK-186 hand-off): every pre-existing free-text
// uat comment is a NEW-LEGACY-PATH case, not a migration — no tasks/*.json
// file is rewritten by this ticket. hasRecordedUatVerdict (task-store.js,
// harness-mode gate) and hasExplicitHumanVerdictMarker (close-guard.js,
// loop-mode Gate 2) both changed. Both changes are, for real on-disk data,
// additive-only for every ticket except a small, individually-documented
// exception set: no already-done ticket flips from gate-satisfying to
// gate-denying WITHOUT that flip being named, explained, and confirmed
// zero-real-effect (already `status: "done"`, and these predicates are only
// ever evaluated at close time — TASK-133 below for loop mode; TASK-222's
// DOCUMENTED_COVERAGE_GAP_EXCEPTION_KEYS below for harness mode).
//   - hasRecordedUatVerdict: old behavior was "does ANY author:'uat' comment
//     exist" (always true once one exists). New behavior (TASK-186) narrows
//     to "does the LAST uat comment have a non-empty body naming a
//     recognizable verdict word (PASS)", and (TASK-222) further narrows to
//     "...AND, when the body uses numbered steps, do those steps' own label
//     numbers cover every AC index 1..N". Proven below: true for all 46 real
//     tickets except the 5 TASK-222 documented exceptions.
//   - hasExplicitHumanVerdictMarker: old behavior is reimplemented verbatim
//     below as oldHasExplicitHumanVerdictMarker (the pre-TASK-186
//     token-scan). Proven below: NEW === OLD for 44 of the 45 real tickets'
//     last uat comment (full equality, not merely non-regression — no other
//     case in tasks/ today would newly reject a body that used to pass). The
//     sole documented exception is TASK-133 (see the fix-round amendment
//     above): it is excluded from the strict equality loop and asserted
//     separately as the one intentional, corpus-safe flip.
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

// TASK-186 fix round — the single documented exception to the old===new
// equality below (see the fix-round amendment comment at the top of this
// file): TASK-133 satisfied the pre-fix-round marker via the label-free
// legacy path, which the HIGH fix removes from loop mode entirely. TASK-133
// is already `status: "done"`, so this flip has no real effect.
const DOCUMENTED_LEGACY_PATH_EXCEPTION_KEYS = ['TASK-133'];

// TASK-222 AC4/AC5/AC6/AC7 — hasRecordedUatVerdict (harness mode) gained a
// per-AC coverage layer on top of its pre-existing light presence check (see
// its doc comment in src/task-store.js): when a uat comment's body carries
// recognized numbered step blocks, their OWN label numbers must now cover
// every AC index 1..N, not just meet a block-count floor. Run against the
// full real corpus (AC7's mandated corpus check — see
// tests/task-store-close-guards.spec.js's TASK-222 describe block for the
// store-level regression locks), exactly 5 of 46 real tickets with a uat
// comment flip from old=true to new=false: TASK-052, TASK-053, TASK-054,
// TASK-055, TASK-068. Every one shares the same shape — the recorded UAT
// script numbers fewer steps than the ticket's full AC count, because a
// meta/process AC ("if a pure-logic helper is added it needs a regression
// lock", "dist/ rebuilt and npm run test:all green at hand-off") was
// satisfied but never given its own dedicated numbered step. This is exactly
// the presence-vs-coverage gap TASK-222 exists to close — the pre-TASK-222
// check never looked at step count or numbering at all, so it silently
// accepted a body that (by the ticket's own recorded UAT script) demonstrably
// covers fewer ACs than it claims. All five are already `status: "done"`;
// hasRecordedUatVerdict is only ever evaluated at close time and never
// re-validates an already-closed ticket, so — same "zero real effect"
// precedent as the TASK-133 loop-mode exception above — this flip changes
// nothing about those tickets' actual state.
const DOCUMENTED_COVERAGE_GAP_EXCEPTION_KEYS = ['TASK-052', 'TASK-053', 'TASK-054', 'TASK-055', 'TASK-068'];

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

  it('harness-mode gate: hasRecordedUatVerdict is true for every real ticket with a uat comment except the TASK-222 documented coverage-gap exceptions', () => {
    const tickets = loadRealTicketsWithUatComment()
      .filter((t) => !DOCUMENTED_COVERAGE_GAP_EXCEPTION_KEYS.includes(t.key));
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

  it('TASK-222 AC7 — the 5 documented coverage-gap exceptions flip old=true -> new=false, and are already `done` so the flip has no real effect', () => {
    const tickets = loadRealTicketsWithUatComment()
      .filter((t) => DOCUMENTED_COVERAGE_GAP_EXCEPTION_KEYS.includes(t.key));
    expect(tickets.map((t) => t.key).sort()).toEqual([...DOCUMENTED_COVERAGE_GAP_EXCEPTION_KEYS].sort());
    for (const t of tickets) {
      expect(t.status, `${t.key} must already be "done" — an active/open ticket flipping to reject `
        + 'would be a real regression, not a documented no-op exception').toBe('done');
      // Confirm this is genuinely a NEW rejection (not already-false before
      // TASK-222): the pre-TASK-222 check was pure presence/PASS-word/no-FAIL
      // with no step-number awareness at all, reproduced verbatim here.
      const comments = Array.isArray(t.comments) ? t.comments : [];
      const uatComments = comments.filter((c) => c && c.author === 'uat');
      const lastBody = String((uatComments[uatComments.length - 1] || {}).body || '').trim();
      const oldWouldPass = lastBody !== ''
        && !/verdict\s*:\s*fail/i.test(lastBody)
        && !/overall(?:\s+result)?\s*:?\s*fail/i.test(lastBody)
        && /\bpass\b/i.test(lastBody);
      expect(oldWouldPass, `${t.key} was expected to satisfy the pre-TASK-222 presence-only check `
        + '(that is WHY it is a documented flip, not an already-false case)').toBe(true);
      expect(hasRecordedUatVerdict(t), `${t.key} was expected to be rejected by the new per-AC `
        + 'coverage layer (its recorded UAT script numbers fewer steps than its full AC count)').toBe(false);
    }
  });

  it('loop-mode Gate 2: hasExplicitHumanVerdictMarker (new) agrees exactly with the pre-TASK-186 logic (old) for every real uat comment except the one documented legacy-path exception', () => {
    const tickets = loadRealTicketsWithUatComment()
      .filter((t) => !DOCUMENTED_LEGACY_PATH_EXCEPTION_KEYS.includes(t.key));
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

  it('the one documented legacy-path exception (TASK-133) flips old=true -> new=false, and is already `done` so the flip has no real effect', () => {
    const tickets = loadRealTicketsWithUatComment()
      .filter((t) => DOCUMENTED_LEGACY_PATH_EXCEPTION_KEYS.includes(t.key));
    expect(tickets.map((t) => t.key)).toEqual(DOCUMENTED_LEGACY_PATH_EXCEPTION_KEYS);
    for (const t of tickets) {
      expect(oldHasExplicitHumanVerdictMarker(t), `${t.key} was expected to satisfy the pre-fix-round `
        + 'legacy token scan (that is WHY it is the documented exception)').toBe(true);
      expect(hasExplicitHumanVerdictMarker(t), `${t.key} was expected to be rejected by the now-mandatory `
        + 'structured "Verdict:" convention (it carries no such label)').toBe(false);
      expect(t.status, `${t.key} must already be "done" — an active/open ticket flipping to reject would `
        + 'be a real regression, not a documented no-op exception').toBe('done');
    }
  });
});
