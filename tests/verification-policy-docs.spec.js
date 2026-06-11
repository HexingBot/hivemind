// tests/verification-policy-docs.spec.js
// TASK-028 — tiered verification policy: doc-layer assertions.
//
// Acceptance criteria covered (fast tier — reads committed files, no disk I/O):
//   AC1 — tasks/schema.json acceptance_criteria description must NO LONGER
//          contain the phrase "at least one test" (the Developer-must-turn-each
//          mandate was tier-blind; it is replaced by the tier rubric).
//   AC2 — CLAUDE.md Testing and Workflow sections must contain:
//          (a) the three tier names (tdd, tests-after, uat-only),
//          (b) the scaled-gate rule: test:changed per ticket, test:all only at
//              release/milestone/publish points (section-scoped, not whole-doc).
//   AC3 — developer.md mentions the tier: TEST phase skipped for non-tdd tiers.
//   AC4 — reviewer.md mentions flagging redundant or duplicative specs as a LOW.
//
// Red reasons:
//   AC1: current schema description says "The Developer must turn each into at
//        least one test." — this will pass once that phrase is removed.
//   AC2(a): CLAUDE.md does not yet contain the three tier names → fails.
//   AC2(b): CLAUDE.md currently says test:all is the per-hand-off gate, not
//            reserved for release/milestone/publish points → fails.
//   AC3: developer.md does not yet mention tier or skipping TEST phase → fails.
//   AC4: reviewer.md does not yet mention redundant/duplicative spec flagging → fails.
//
// Pinned assertion hazard (from pre-flight check, see end of file):
//   No existing spec asserts on the exact words this ticket changes, so there is
//   NO contradictory pinned assertion. The CLAUDE.md Testing prose is not tested
//   by any current spec — only the pointer/bundle/first-chat sections are tested
//   (docs.spec.js) and the per-agent model strategy (agent-models.spec.js).
//
// Section-scoping approach (per TASK-031 review finding: no whole-doc word
// assertions): each multi-section check slices from the `## ` heading that owns
// the content and asserts WITHIN that slice only. Headings are matched by
// line-start `^## ` or `^### `.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './helpers/repoRoot.js';

// ---------------------------------------------------------------------------
// File loaders
// ---------------------------------------------------------------------------
function loadFile(relPath) {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8');
}

/**
 * Slice the text from the first occurrence of `heading` (matched as a line that
 * STARTS with `heading`) to the next same-level `## ` heading (exclusive), or
 * end-of-string. Returns the slice including the heading line itself.
 *
 * headingPrefix: the exact heading text to find, e.g. "## Testing" or
 * "## Workflow". The search matches line-start + exact text (case-sensitive).
 */
function sliceSection(text, headingText) {
  const lines = text.split('\n');
  const startIdx = lines.findIndex((l) => l.startsWith(headingText));
  if (startIdx === -1) return null;

  // Determine heading level (count leading `#`).
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

// ===========================================================================
// AC1 — tasks/schema.json: acceptance_criteria description must not mandate
//        "at least one test"
// ===========================================================================
describe('AC1 — schema: acceptance_criteria description no longer mandates at-least-one-test', () => {
  it('acceptance_criteria_description_omits_at_least_one_test_phrase', () => {
    // RED: current description = "Falsifiable criteria for 'done'. The Developer
    // must turn each into at least one test."
    const schema = JSON.parse(loadFile('tasks/schema.json'));
    const desc = schema.properties?.acceptance_criteria?.description ?? '';
    expect(
      desc.toLowerCase().includes('at least one test'),
      'acceptance_criteria description must not contain "at least one test" — ' +
        'the tier rubric replaces the blanket mandate. Current value: ' +
        JSON.stringify(desc),
    ).toBe(false);
  });
});

// ===========================================================================
// AC2 — CLAUDE.md: Testing section contains tier names + scaled-gate rule
// ===========================================================================
describe('AC2 — CLAUDE.md: Testing section has tier rubric + scaled gate', () => {
  it('testing_section_contains_all_three_tier_names', () => {
    // RED: CLAUDE.md Testing section does not yet contain these tier names.
    const text = loadFile('CLAUDE.md');
    const section = sliceSection(text, '## Testing');
    expect(
      section,
      'CLAUDE.md must contain a "## Testing" section',
    ).not.toBeNull();

    expect(section).toMatch(/\btdd\b/);
    expect(section).toMatch(/\btests-after\b/);
    expect(section).toMatch(/\buat-only\b/);
  });

  it('testing_section_names_scaled_gate_rule', () => {
    // RED: current CLAUDE.md Testing section says test:all is the per-hand-off
    // gate, not reserved for release/milestone/publish points.
    // TARGET: test:changed is the per-ticket gate; test:all is reserved for
    // release / milestone / publish.
    const text = loadFile('CLAUDE.md');
    const section = sliceSection(text, '## Testing');
    expect(section).not.toBeNull();

    // The section must mention test:changed as the per-ticket instrument.
    expect(section).toMatch(/test:changed/);

    // The section must say test:all is reserved for release or milestone or
    // publish (any of the three is sufficient; we match loosely).
    expect(section).toMatch(/test:all\b[\s\S]{0,300}(release|milestone|publish)/);
  });

  it('workflow_section_assigns_tier_at_ticket_read_time', () => {
    // RED: Workflow step 4 currently says "Tests first" unconditionally, with
    // no mention of the tier.
    const text = loadFile('CLAUDE.md');
    const section = sliceSection(text, '## Workflow');
    expect(
      section,
      'CLAUDE.md must contain a "## Workflow" section',
    ).not.toBeNull();

    // Orchestrator assigns tier at read time.
    expect(section).toMatch(/tier/i);
    // At minimum one of the tier names appears in the Workflow description.
    expect(section).toMatch(/tdd|tests-after|uat-only/);
  });
});

// ===========================================================================
// AC3 — developer.md: tier-aware TEST phase behavior
// ===========================================================================
describe('AC3 — developer.md: tier-aware TEST phase', () => {
  it('developer_md_mentions_tier_and_skip_behavior', () => {
    // RED: developer.md has no mention of verification_tier or skipping TEST.
    // We check both the .claude/agents/ copy and the plugin-root agents/ copy
    // (they must be byte-identical per agents-parity, so checking one is
    // sufficient, but checking the canonical .claude/agents/ is the safest).
    const text = loadFile('.claude/agents/developer.md');

    // Must mention the concept of tier.
    expect(
      text.toLowerCase().includes('tier'),
      'developer.md must mention "tier" to document the tier-aware behavior',
    ).toBe(true);

    // Must indicate that the TEST phase is skipped for non-tdd tiers.
    // Accept "skip" OR "skipped" with tier context nearby.
    const tierSkipRe = /(skip|skipped)[\s\S]{0,200}(tests-after|uat-only)|(tests-after|uat-only)[\s\S]{0,200}(skip|skipped)/i;
    expect(
      tierSkipRe.test(text),
      'developer.md must indicate that the TEST phase is skipped for tests-after / uat-only tiers',
    ).toBe(true);
  });
});

// ===========================================================================
// AC4 — reviewer.md: flags redundant/duplicative new specs as LOW
// ===========================================================================
describe('AC4 — reviewer.md: redundant spec flagging', () => {
  it('reviewer_md_flags_redundant_specs_as_low', () => {
    // RED: reviewer.md has no mention of redundant/duplicative spec flagging.
    const text = loadFile('.claude/agents/reviewer.md');

    // Must mention flagging redundant or duplicative specs explicitly.
    const redundantRe = /redundant|duplicat/i;
    expect(
      redundantRe.test(text),
      'reviewer.md must mention flagging redundant or duplicative new specs',
    ).toBe(true);

    // Must indicate that finding is LOW severity.
    const lowRe = /\bLOW\b/;
    expect(
      lowRe.test(text),
      'reviewer.md must explicitly classify the redundant-spec finding as LOW severity',
    ).toBe(true);
  });
});

// ===========================================================================
// Pinned-assertion collision report (for Orchestrator)
// ===========================================================================
// Pre-flight check results — existing specs that read CLAUDE.md:
//
//   tests/docs.spec.js:23-24  (claude_md_explains_pointer_file)
//     Asserts: text.toMatch(/pointer/i) and text.toMatch(/active_session_id/)
//     and text.toMatch(/state\/sessions\//)
//     → These match stable RESUME FIRST prose. The TASK-028 rewrite does NOT
//       remove the RESUME FIRST section (only Workflow step 4 + Testing changes).
//       NO COLLISION.
//
//   tests/agent-models.spec.js:97-119  (claude_md_documents_per_agent_model_strategy)
//     Asserts: /model/i, /reviewer/i && /fable/i, /developer/i && /sonnet/i
//     → The Per-Agent Model Assignment section is not touched by TASK-028.
//       NO COLLISION.
//
//   tests/e2e/init.spec.js:337-363  (claude_md_has_first_chat_routing_above_resume_first)
//     Asserts: ## First-chat routing heading exists; ## RESUME FIRST heading exists;
//     First-chat appears before RESUME FIRST.
//     → Neither heading is removed by TASK-028.
//       NO COLLISION.
//
// Conclusion: ZERO existing assertions are broken by the TASK-028 CLAUDE.md rewrite.
// No contradictory state between new and existing specs.
