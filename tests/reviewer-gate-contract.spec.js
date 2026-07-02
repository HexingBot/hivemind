// tests/reviewer-gate-contract.spec.js
// TASK-081 — doc-lock the repaired reviewer re-verification gate.
//
// Three defects were found live at review time (deep-review Q1):
//   (a) `npm run test:changed` uses bare `--changed`, which diffs against a
//       clean HEAD. Once the Developer's diff is committed, that selects ZERO
//       specs and exits 0 — the reviewer's "green must reproduce as green"
//       check was a silent false positive on every ticket. Fix: a `test:since`
//       script (`vitest run --config vitest.config.all.js --changed`) that
//       accepts a base ref via `npm run test:since -- <base-ref>`.
//   (b) The `--changed`/`--since` import graph is blind to files read via
//       `fs.readFileSync` (parity/live-state/doc-lock sensors) rather than
//       imported — an md-only ticket would run zero sensors. Fix: `npm test`
//       (fast tier) is now mandatory alongside test:changed/test:since at the
//       per-ticket gate in CLAUDE.md, agents/reviewer.md, agents/developer.md.
//   (c) agents/reviewer.md declared the calibration check HIGH/BLOCK but
//       invoked it as `node bin/check-calibration.js ...`, which is outside
//       the reviewer's Bash allowlist (only `npm run check:*` etc. is
//       allowed) — the mandatory blocker was un-runnable by the role that
//       must run it. Fix: reviewer.md now invokes the allowlisted
//       `npm run check:calibration -- <args>` form exclusively.
//
// This spec pins the contract so none of the three regress silently. It is a
// pure doc/config read — no disk mutation, no process spawn — so it lives in
// the fast tier (tests/*.spec.js), not tests/e2e/.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './helpers/repoRoot.js';

function loadFile(relPath) {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8');
}

// ===========================================================================
// (i) package.json: test:since script exists with the exact vitest form
// ===========================================================================
describe('TASK-081 (i) — package.json declares test:since', () => {
  it('test_since_script_is_the_exact_vitest_changed_form', () => {
    const pkg = JSON.parse(loadFile('package.json'));
    expect(
      pkg.scripts?.['test:since'],
      'package.json scripts.test:since must exist',
    ).toBe('vitest run --config vitest.config.all.js --changed');
  });
});

// ===========================================================================
// (ii) CLAUDE.md + reviewer.md + developer.md each mention test:since AND
//      the per-ticket fast-tier (`npm test`) requirement
// ===========================================================================
describe('TASK-081 (ii) — gate docs mention test:since and the fast-tier requirement', () => {
  const DOCS = [
    'CLAUDE.md',
    '.claude/agents/reviewer.md',
    '.claude/agents/developer.md',
  ];

  for (const relPath of DOCS) {
    it(`${relPath}_mentions_test_since_and_npm_test_fast_tier`, () => {
      const text = loadFile(relPath);

      expect(
        text.includes('test:since'),
        `${relPath} must mention test:since (the committed-range re-verification form)`,
      ).toBe(true);

      expect(
        text.includes('npm test'),
        `${relPath} must mention npm test (the mandatory fast-tier leg of the per-ticket gate)`,
      ).toBe(true);
      expect(
        /fast tier/i.test(text),
        `${relPath} must describe npm test as the fast tier in the per-ticket gate`,
      ).toBe(true);
    });
  }
});

// ===========================================================================
// (iii) reviewer.md: allowlisted calibration form only, no bare `node`
// ===========================================================================
describe('TASK-081 (iii) — reviewer.md calibration gate uses the allowlisted npm form', () => {
  it('reviewer_md_invokes_calibration_via_npm_run_check_calibration', () => {
    const text = loadFile('.claude/agents/reviewer.md');
    expect(
      text.includes('npm run check:calibration --'),
      'reviewer.md must invoke calibration via the allowlisted `npm run check:calibration -- <args>` form',
    ).toBe(true);
  });

  it('reviewer_md_does_not_invoke_the_unallowlisted_bare_node_form', () => {
    const text = loadFile('.claude/agents/reviewer.md');
    expect(
      text.includes('node bin/check-calibration.js'),
      'reviewer.md must not invoke `node bin/check-calibration.js` directly — ' +
        '`node` is not in the reviewer Bash allowlist, so a bare-node invocation ' +
        'is a blocker the reviewer role cannot actually run',
    ).toBe(false);
  });
});
