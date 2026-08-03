#!/usr/bin/env node
// scripts/test-changed.mjs — validating wrapper behind `npm run test:changed`.
//
// TASK-194: `npm run test:changed` used to be a bare `vitest run --changed
// --config vitest.config.all.js` in package.json — no wrapper, so there was
// nowhere for a marker to live. `--changed` with no ref compares against
// UNCOMMITTED state only (vitest's VitestGit.findChangedFiles branches on
// `typeof changedSince === 'string'`; with no ref it skips getFilesSince
// entirely and only checks staged+unstaged — see git.*.js under
// node_modules/vitest/dist/chunks/, pinned by
// tests/vitest-changed-algorithm-pin.spec.js). That means a clean tree, or a
// tree immediately after committing, selects ZERO specs — and vitest's own
// `passWithNoTests` defaults to `true`, so it exits 0 either way. A
// zero-selection run is visually indistinguishable from "everything passed".
// This command is the FIRST step in the per-ticket hand-off gate (CLAUDE.md),
// so a developer who commits and then runs it as a final sanity check gets a
// confident green from a run that verified nothing.
//
// This is the SAME defect class TASK-192 closed for `scripts/test-since.mjs`
// (see that file's header and CLAUDE.md's "Empty-result contract" section)
// — reused here, not reinvented: `hasAnyUncommittedChanges` (exported from
// test-since.mjs) is the refless sibling of `hasAnyChangedFiles`, sharing
// the same git-command mechanism.
//
// Design choices specific to `test:changed` (deliberately NOT a copy of
// test-since.mjs's full behavior):
//
//   - Marker name is `TEST_CHANGED_ZERO_SELECTION`, not
//     `TEST_SINCE_ZERO_SELECTION` — this command is `test:changed`, not
//     `test:since`, and a `TEST_SINCE_`-prefixed marker firing from a
//     different command would read wrong to whoever greps stderr for it.
//     Same shape (`<COMMAND>_ZERO_SELECTION: reason=<reason>`), one
//     convention, not a second one.
//   - Only the cheap git check runs — there is no `vitest list` pre-check
//     here, unlike test-since.mjs's `no-spec-matched` branch. That pre-check
//     costs ~5s (TASK-192's measured figure) purely to distinguish
//     "non-empty diff, matched" from "non-empty diff, zero specs matched".
//     `test:changed` is the FAST inner-loop command, run far more often
//     than `test:since`, so paying 5s on every invocation would be a
//     materially worse trade than the ambiguity it would close — see
//     CLAUDE.md's Empty-result contract, AC5 ("prefer a cheaper signal over
//     a thorough one"). The case that actually matters for `test:changed` —
//     a clean tree, or a tree just after committing — is the ONE the cheap
//     git check alone (milliseconds) already answers correctly. A non-empty
//     uncommitted diff that the import graph fails to route (a docs-only
//     edit, say) still silently selects zero specs here, same as it always
//     has; that residual gap is accepted, not new, and unaffected by this
//     change.
//   - Zero selection is NEVER fatal here either, for the identical reason
//     TASK-192 rejected a hard-fail design for test:since: a clean tree is
//     the COMMON, legitimate state for this command (arguably more so than
//     for test:since, since `test:changed` is invoked constantly during
//     normal iteration). A non-zero exit on zero-selection would red-gate
//     ordinary use. This was considered and explicitly rejected.
//
// The real `vitest run --changed` exit code is always passed through
// unchanged — a wrapper that swallowed a genuine test failure would be far
// worse than the ambiguity it fixes.

import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { hasAnyUncommittedChanges } from './test-since.mjs';

function main(argv = process.argv.slice(2)) {
  if (!hasAnyUncommittedChanges()) {
    process.stderr.write(
      'test:changed: TEST_CHANGED_ZERO_SELECTION: reason=empty-diff — no staged or\n'
        + 'unstaged changes (clean tree, or everything already committed) — a zero-spec\n'
        + 'result below is expected here, not a failure. Once your diff is committed, use\n'
        + '`npm run test:since -- <base-ref>` to reproduce this selection against a\n'
        + 'committed range instead.\n',
    );
  }

  const result = spawnSync(
    'vitest',
    ['run', '--changed', '--config', 'vitest.config.all.js', ...argv],
    { stdio: 'inherit', shell: true },
  );

  if (result.error) {
    process.stderr.write(`test:changed: failed to launch vitest: ${result.error.message}\n`);
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
