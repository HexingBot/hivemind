# UAT baseline: the frozen cutoff and why it exists

## Where this is enforced

`src/uat-audit.js` exports `UAT_BASELINE_CUTOFF_DATE` — the single, canonical value the
audit command reads. This document is the explanation that constant points back to
(TASK-223 AC3): the date is not a magic literal buried in the CLI, it lives here, with the
reasoning below, and the code carries only a short comment pointing at this file.

```
UAT_BASELINE_CUTOFF_DATE = "2026-09-09"
```

Run the audit with `npm run audit:uat` (or `node bin/audit-uat.js [--json]`).

**TASK-225 — CI gate.** `npm run gate:uat` (`bin/ci-uat-gate.js`, wired into `.github/workflows/ci.yml`'s
`uat-gate` job) promotes this same cutoff into a build-blocking check, scoped to only the
tickets that actually needed a UAT verdict (`src/uat-gate.js`'s `needsUat` — the same
`verification_tier === 'uat-only' || requiresUat(task)` union `checkUatGuard` enforces at
close time). It reads `UAT_BASELINE_CUTOFF_DATE` from `src/uat-audit.js` too — there is no
second cutoff constant. See `bin/ci-uat-gate.js`'s header for its three-outcome exit-code
contract (`zero-examined` / `compliant` both exit `0` with a distinguishing marker,
`violations` exits `2`, a board-read failure exits `1`).

## Why a cutoff, and why this date (TASK-223)

TASK-223 grew out of an adversarial review of the UAT close-guard fix (2026-09-09):
closing the hole going forward (TASK-220/TASK-221/TASK-222 — `requires_uat`, the close
guard, per-AC coverage) says nothing about tickets that were *already* `done` before those
guards existed. Retroactively demanding a `uat` comment on hundreds of months-old closed
tickets would produce exactly one outcome: someone (human or agent) fabricates a
plausible-looking `uat` comment after the fact to make the sensor pass. A fabricated
verdict is **worse** than an honestly-absent one — the absence is at least truthful about
what was and wasn't verified.

**Decision, taken up front, not discovered by the audit:** tickets closed on or before
**2026-09-09** are frozen as a documented historical baseline. They are never migrated, and
the audit command reports them as baseline — informational, never as a violation. Only
tickets closed **after** that date are held to the current UAT-recording standard; a
`done` ticket that should have carried a valid `uat` verdict and doesn't, closed after the
cutoff, is a real, actionable regression.

2026-09-09 is the date this decision was made and the date the baseline below was measured
— the cutoff is the day the freeze took effect, not an arbitrarily chosen earlier date.

### Closed-date proxy

`tasks/schema.json` carries no dedicated `closed_at` field. The audit uses a task's
`updated_at` as a proxy for "when this ticket closed": `closeTask`/`transitionStatus`
(`src/task-store.js`) both refresh `updated_at` on every write, including the transition to
`done`, so for a `done` ticket `updated_at` is the timestamp of its most recent write —
which, absent a later out-of-band edit, is the close itself. This is documented as a proxy,
not a guarantee, in `src/uat-audit.js`'s `closedAtOf` comment. An undated or unparseable
`updated_at` fails closed toward the **baseline** side (never silently promoted to
"actionable") — the real board never hits this branch (every `done` ticket has a valid
`updated_at`), but the function is answerable for it if that ever changes.

### What "a valid UAT verdict" means

The audit does not re-derive its own notion of "has UAT been recorded" — it imports and
calls `hasRecordedUatVerdict` from `src/task-store.js`, the exact function `checkUatGuard`
uses to gate a `done` transition today (TASK-222's per-acceptance-criterion coverage rule
included). A ticket is a "finding" (baseline or actionable) if and only if
`hasRecordedUatVerdict(task)` is `false` for a `status: "done"` task — regardless of that
task's own `verification_tier` or `requires_uat` value. This is deliberately broader than
"tickets the current close guard would have blocked": the whole point of this audit is the
debt accumulated under tiers (`tdd`, no tier at all, `tests-after` without
`requires_uat: true`) that were never gated on UAT in the first place — see the measured
breakdown below.

## Measured baseline

**Originally measured 2026-09-09 (ticket text, morning of the day the freeze decision was
made):** 214 tickets total, 206 `done`, 161 of those `done` tickets missing a valid `uat`
verdict. Tier breakdown of the 161: 100 `tdd`, 31 with no `verification_tier` field at all
(historical default, pre-dates the field), 30 `tests-after`. Zero `uat-only`.

**Re-measured for this ticket's implementation, 2026-09-09 (`npm run audit:uat --json`),
against the live board — these are the numbers this ticket's hand-off reports, and they
differ from the ones above:**

```
cutoff_date: 2026-09-09
tickets_on_board: 221
done_tickets_examined: 210
missing_uat_total: 169
baseline (frozen, closed on/before 2026-09-09): 169 — by tier:
  {"(none)": 31, "tests-after": 37, "tdd": 100, "uat-only": 1}
actionable (closed after 2026-09-09): 0
```

**Why the numbers moved, documented so a future reader doesn't mistake drift for a bug:**

1. **The board grew.** Between the original measurement and this one, the same day, more
   tickets landed and closed (`tasks/index.json` went from 214 to 221 total, 206 to 210
   `done`) — this is normal, ongoing work, not a data-quality problem.
2. **`TASK-222` tightened `hasRecordedUatVerdict` while this ticket was in flight.**
   TASK-222 added a per-acceptance-criterion coverage requirement to the harness-mode UAT
   check (a numbered-step `uat` comment must now cover every AC by number, not just meet a
   bare step-count floor). That flips 5 already-`done` tickets from "had a valid verdict"
   to "missing one" under the *current* sensor, even though nothing about those tickets
   changed: **TASK-052, TASK-053, TASK-054, TASK-068** (tier `tests-after`) and **TASK-055**
   (tier `uat-only` — the one `uat-only` finding in the re-measured baseline, explaining why
   the original "zero `uat-only`" claim no longer holds literally). This is a documented,
   zero-real-effect residual — `hasRecordedUatVerdict` is only evaluated at close time and
   never re-validates an already-closed ticket (see TASK-222's own doc comment in
   `src/task-store.js` for the same "zero real effect" reasoning applied there) — but it
   does change what a re-run of *this* audit reports, so it's recorded here rather than
   silently reconciled away.
3. All of the above tickets are already `status: "done"` and closed well before
   2026-09-09 — every one of them lands in the **baseline** bucket, not actionable. The
   **zero actionable** result is the number that matters going forward: it is a *qualified*
   zero (210 tickets examined, 169 landed in baseline, 0 actionable — never an unqualified
   "OK"), and it is what `npm run audit:uat` should keep reporting as new tickets close
   correctly. A future non-zero `actionable.count` is the real regression signal this
   command exists to catch.

## Interpreting a re-run

- **`actionable.count === 0` and `examined_done_count > 0`** — qualified success: the board
  was read fine, N tickets were examined, and none of the post-cutoff ones are missing a
  valid verdict. Exit code `0`.
- **`examined_done_count === 0`** — nothing to examine (an empty board, or one with no
  `done` tickets yet). Distinguishable in the output from the qualified-success case above
  — it is not a claim that "0 tickets are compliant". Exit code `0`.
- **`actionable.count > 0`** — a real, new regression: a ticket closed after the cutoff
  without a valid UAT verdict. Exit code `2`. Investigate the named ticket(s) before
  treating any downstream work as verified.
- **Board unreadable** (e.g. `tasks/` missing, or a task file fails to parse) — the command
  never produces a report at all; it prints `{ok:false, code:'E_BOARD_READ_FAILURE',
  message}` and exits `1`. This is distinct from both zero-result cases above: a failure to
  read is never rendered as a qualified zero.
