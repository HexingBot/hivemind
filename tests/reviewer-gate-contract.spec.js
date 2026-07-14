// tests/reviewer-gate-contract.spec.js
// TASK-081 — doc-lock the repaired reviewer re-verification gate.
//
// Three defects were found live at review time (deep-review Q1):
//   (a) `npm run test:changed` uses bare `--changed`, which diffs against a
//       clean HEAD. Once the Developer's diff is committed, that selects ZERO
//       specs and exits 0 — the reviewer's "green must reproduce as green"
//       check was a silent false positive on every ticket. Fix: `test:since`
//       delegates to scripts/test-since.mjs, a validating wrapper (see
//       tests/test-since.spec.js + tests/e2e/test-since.spec.js), invoked via
//       `npm run test:since -- <base-ref>`.
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
// A follow-up review (HIGH-1) found the FIRST cut of (a) was itself a silent
// false positive: the bare `vitest --changed <ref>` npm script fired the same
// zero-specs bug on an all-digit ref (cac coerces it to a JS number; vitest's
// git module drops non-string `changedSince`) and on an invalid ref (git
// fails, but vitest's tinyexec wrapper doesn't throw by default, so it reads
// empty stdout as "0 files changed"). scripts/test-since.mjs closes both:
// resolves + validates the ref with `git rev-parse --verify` before invoking
// vitest, fails loudly on a bad ref, and forwards a guaranteed-non-numeric
// `<full-sha>~0` form. See scripts/test-since.mjs's header for the full
// mechanism and tests/test-since.spec.js for the mocked-exec regression lock.
//
// This spec pins the doc/config CONTRACT so none of the above regress
// silently. It is a pure doc/config read — no disk mutation, no process
// spawn — so it lives in the fast tier (tests/*.spec.js), not tests/e2e/.
//
// Section-scoping note (MEDIUM-1, ride-along finding on the HIGH-1 review):
// whole-file `includes('npm test') && includes('fast tier')` checks are
// non-discriminating where a doc already contains those words for an
// unrelated reason — e.g. CLAUDE.md's "### Which command, when" section had
// a *pre-existing*, unrelated "npm test ... the whole fast tier" row (the
// pre-deploy-smoke situation) before this ticket ever touched the per-ticket
// gate row. Each (ii) assertion below anchors to the SPECIFIC line/paragraph
// this ticket edited (the per-ticket gate table row; the numbered
// verification step; the scaled-gate Rules bullet) so that reverting just
// that edit — and only that edit — fails the check.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './helpers/repoRoot.js';

function loadFile(relPath) {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8');
}

/**
 * Slice from the first line that STARTS WITH `headingText` to the next
 * same-level heading (exclusive), or end-of-string. Mirrors the pattern in
 * tests/verification-policy-docs.spec.js.
 */
function sliceSection(text, headingText) {
  const lines = text.split('\n');
  const startIdx = lines.findIndex((l) => l.startsWith(headingText));
  if (startIdx === -1) return null;

  const level = headingText.match(/^(#+)/)[1].length;
  const closeRe = new RegExp(`^${'#'.repeat(level)}[^#]`);

  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (closeRe.test(lines[i])) {
      endIdx = i;
      break;
    }
  }
  return lines.slice(startIdx, endIdx).join('\n');
}

/** Slice from the first occurrence of `startNeedle` to the next occurrence of `endNeedle` (exclusive), or end-of-string. */
function sliceBetween(text, startNeedle, endNeedle) {
  const start = text.indexOf(startNeedle);
  if (start === -1) return null;
  const end = text.indexOf(endNeedle, start + startNeedle.length);
  return end === -1 ? text.slice(start) : text.slice(start, end);
}

// ===========================================================================
// (i) package.json: test:since delegates to the validating wrapper script
// ===========================================================================
describe('TASK-081 (i) — package.json declares test:since', () => {
  it('test_since_script_delegates_to_the_validating_wrapper', () => {
    const pkg = JSON.parse(loadFile('package.json'));
    expect(
      pkg.scripts?.['test:since'],
      'package.json scripts.test:since must delegate to scripts/test-since.mjs — ' +
        'a raw `vitest --changed <ref>` reintroduces the HIGH-1 numeric-ref / invalid-ref silent-zero bug',
    ).toBe('node scripts/test-since.mjs');
  });

  it('the_wrapper_script_it_delegates_to_exists', () => {
    expect(existsSync(join(REPO_ROOT, 'scripts', 'test-since.mjs'))).toBe(true);
  });
});

// ===========================================================================
// (ii) CLAUDE.md + reviewer.md + developer.md: section-scoped assertions on
//      the exact lines/paragraphs this ticket edited
// ===========================================================================
describe('TASK-081 (ii) — CLAUDE.md per-ticket gate row requires test:since + npm test', () => {
  it('per_ticket_hand_off_gate_row_names_both_test_since_and_npm_test', () => {
    const text = loadFile('CLAUDE.md');
    const row = text.split('\n').find((l) => l.includes('Per-ticket hand-off gate'));
    expect(row, 'CLAUDE.md must have a "Per-ticket hand-off gate" table row').toBeTruthy();
    expect(row).toMatch(/test:since/);
    expect(row).toMatch(/npm test/);
    expect(row).toMatch(/fast tier/i);
  });

  it('rules_section_states_npm_test_is_mandatory_at_the_per_ticket_gate', () => {
    const text = loadFile('CLAUDE.md');
    const section = sliceSection(text, '### Rules');
    expect(section, 'CLAUDE.md must contain a "### Rules" section').not.toBeNull();
    expect(section).toMatch(/test:since/);
    expect(section).toMatch(/npm test.{0,10}is mandatory/);
  });

  it('which_command_when_section_treats_a_zero_specs_result_as_a_gate_failure', () => {
    const text = loadFile('CLAUDE.md');
    const section = sliceSection(text, '### Which command, when');
    expect(section, 'CLAUDE.md must contain a "### Which command, when" section').not.toBeNull();
    expect(section).toMatch(/zero-specs result from `test:since` is a gate FAILURE/);
  });

  // TASK-109 — the third (computed-dynamic-import) blind-spot class, distinct
  // from the fs-read blind spot this same section already documents.
  it('which_command_when_section_documents_the_computed_dynamic_import_blind_spot', () => {
    const text = loadFile('CLAUDE.md');
    const section = sliceSection(text, '### Which command, when');
    expect(section, 'CLAUDE.md must contain a "### Which command, when" section').not.toBeNull();
    expect(section).toMatch(/computed dynamic import/i);
    expect(section).toMatch(/pathToFileURL/);
    // Must state it defeats BOTH test:changed and test:since.
    expect(section).toMatch(/defeats \*\*both\*\* `test:changed`[\s\S]{0,400}`test:since`/);
    // Must document the compensation recipe: run the affected spec directly.
    expect(section).toMatch(/npx vitest run/);
  });
});

describe('TASK-081 (ii) — reviewer.md step 2 requires test:since + npm test + zero-specs-is-failure', () => {
  it('step2_names_test_since_npm_test_fast_tier_and_the_zero_specs_failure_rule', () => {
    const text = loadFile('.claude/agents/reviewer.md');
    const step2 = sliceBetween(text, '2. **Re-run verification', '3. **Read the diff.**');
    expect(step2, 'reviewer.md must have step 2, "Re-run verification..."').toBeTruthy();
    expect(step2).toMatch(/test:since/);
    expect(step2).toMatch(/npm test/);
    expect(step2).toMatch(/fast tier/i);
    expect(step2).toMatch(/gate FAILURE/);
  });

  // TASK-109 — step 2 also names the computed-dynamic-import blind spot so
  // re-verification does not silently under-select on a src-only change whose
  // spec is outside the diff range.
  it('step2_names_the_computed_dynamic_import_blind_spot_class', () => {
    const text = loadFile('.claude/agents/reviewer.md');
    const step2 = sliceBetween(text, '2. **Re-run verification', '3. **Read the diff.**');
    expect(step2, 'reviewer.md must have step 2, "Re-run verification..."').toBeTruthy();
    expect(step2).toMatch(/dynamic import/i);
    expect(step2).toMatch(/npx vitest run/);
  });
});

describe('TASK-081 (ii) — developer.md IMPL step 4 requires test:since + npm test + zero-specs-is-failure', () => {
  it('step4_names_test_since_npm_test_fast_tier_and_the_zero_specs_failure_rule', () => {
    const text = loadFile('.claude/agents/developer.md');
    const step4 = sliceBetween(text, '4. Run the per-ticket gate:', '5. Run the project');
    expect(step4, 'developer.md must have step 4, "Run the per-ticket gate..."').toBeTruthy();
    expect(step4).toMatch(/test:since/);
    expect(step4).toMatch(/npm test/);
    expect(step4).toMatch(/fast tier/i);
    expect(step4).toMatch(/gate FAILURE/);
  });
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
