// tests/verification-policy-docs.spec.js
// TASK-028 — tiered verification policy: doc-layer assertions.
//
// Acceptance criteria covered (fast tier — reads committed files, no disk I/O):
//   AC1 — tasks/schema.json acceptance_criteria description must NO LONGER
//          contain the phrase "at least one test" (the Developer-must-turn-each
//          mandate was tier-blind; it is replaced by the tier rubric).
//   AC2 — CLAUDE.md Testing and Workflow sections must contain:
//          (a) the two LIVE tier names (tests-after, uat-only) — TASK-212
//              (2026-08-13 human decision) retired the third tier, `tdd`; the
//              section keeps mentioning `tdd` ONLY as an explicitly retired
//              historical note, which this file separately pins so a future
//              edit cannot silently re-promote it back to a live/assignable
//              tier without this lock going red,
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

/** Collapse whitespace runs (including newlines) to a single space, so a
 * phrase that word-wraps across source lines can still be pinned as one
 * contiguous string (same convention as tests/agility-doc-locks.spec.js). */
function normalizeWs(text) {
  return text.replace(/\s+/g, ' ');
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
  it('testing_section_contains_both_live_tier_names', () => {
    const text = loadFile('CLAUDE.md');
    const section = sliceSection(text, '## Testing');
    expect(
      section,
      'CLAUDE.md must contain a "## Testing" section',
    ).not.toBeNull();

    expect(section).toMatch(/\btests-after\b/);
    expect(section).toMatch(/\buat-only\b/);
  });

  // TASK-212 (2026-08-13 human decision) retired the `tdd` tier. This lock
  // replaces the old "three tier names" assertion: `tdd` must still be
  // mentioned (as a historical/retired note — the ~101 tickets that used it
  // are not rewritten), but MUST be marked explicitly retired, never left to
  // read as a currently-assignable tier. If a future edit drops the
  // "retired" framing while still naming `tdd`, this goes red.
  it('testing_section_marks_tdd_as_retired_not_assignable', () => {
    const text = loadFile('CLAUDE.md');
    const section = sliceSection(text, '## Testing');
    expect(section).not.toBeNull();

    expect(section).toMatch(/\btdd\b/);
    const retiredNearTdd = /retired[\s\S]{0,80}`tdd`|`tdd`[\s\S]{0,80}retired/i;
    expect(
      retiredNearTdd.test(section),
      'CLAUDE.md Testing section must mark `tdd` as explicitly retired, not a currently-assignable tier',
    ).toBe(true);
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
// L8 (TASK-033) — drift guard: the VERIFICATION_TIER enum sources agree
// ===========================================================================
// Three places independently declare a tier enum, but — as of TASK-212's fix
// round (REQUEST-CHANGES HIGH) — they are NOT all the same set on purpose:
//   1. tasks/schema.json  — the on-disk STORAGE schema (ajv validates task
//      files). Deliberately a SUPERSET: it also accepts the write-frozen
//      historical value "tdd" so the ~101 tickets that legitimately carry it
//      stay writable (appendComment/transitionStatus re-validate the WHOLE
//      stored object on every write) — see the schema's own description.
//   2. src/task-store.js  — VERIFICATION_TIERS constant (ASSIGNMENT guard in
//      createTask: what a NEW ticket may declare).
//   3. src/mcp-server.js  — zod VERIFICATION_TIER enum (MCP create_task tool
//      input schema — the other NEW-assignment door).
// The two invariants this drift guard actually enforces:
//   (a) the two ASSIGNMENT surfaces (2, 3) must be identical to each other —
//       if they drift (e.g. someone adds "fast-follow" only to zod) the
//       accept/reject behavior diverges across doors while the suite stays
//       green.
//   (b) the STORAGE schema (1) must equal the assignment set PLUS exactly
//       {"tdd"} — no more, no less. A schema that also silently grew a
//       fourth value, or that DROPPED "tdd" again, is a drift this guard
//       must catch.
// This fast-tier spec reads the committed source files and compares the sets.
// ===========================================================================
describe('L8 — TASK-033/TASK-212 drift guard: VERIFICATION_TIER enum sources agree on the split invariant', () => {
  function readTierArrays() {
    const schema = JSON.parse(loadFile('tasks/schema.json'));
    const schemaEnum = schema.properties?.verification_tier?.enum;
    expect(
      Array.isArray(schemaEnum),
      'tasks/schema.json must declare a verification_tier enum array',
    ).toBe(true);

    const taskStoreSrc = loadFile('src/task-store.js');
    const tsMatch = taskStoreSrc.match(/const VERIFICATION_TIERS\s*=\s*\[([^\]]+)\]/);
    expect(
      tsMatch,
      'src/task-store.js must declare `const VERIFICATION_TIERS = [...]`',
    ).toBeTruthy();
    const taskStoreTiers = tsMatch[1]
      .split(',')
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean)
      .sort();

    const mcpSrc = loadFile('src/mcp-server.js');
    const mcpMatch = mcpSrc.match(/const VERIFICATION_TIER\s*=\s*z\.enum\(\[([^\]]+)\]\)/);
    expect(
      mcpMatch,
      'src/mcp-server.js must declare `const VERIFICATION_TIER = z.enum([...])`',
    ).toBeTruthy();
    const mcpTiers = mcpMatch[1]
      .split(',')
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean)
      .sort();

    return { schemaSorted: [...schemaEnum].sort(), taskStoreTiers, mcpTiers };
  }

  it('the two NEW-assignment surfaces (task-store, mcp-server) declare identical enums', () => {
    const { taskStoreTiers, mcpTiers } = readTierArrays();
    expect(
      mcpTiers,
      `src/mcp-server.js VERIFICATION_TIER must equal src/task-store.js VERIFICATION_TIERS.\n` +
        `task-store: ${JSON.stringify(taskStoreTiers)}\nmcp-server: ${JSON.stringify(mcpTiers)}`,
    ).toEqual(taskStoreTiers);
  });

  it('the storage schema equals the assignment set plus exactly the frozen historical "tdd" value', () => {
    const { schemaSorted, taskStoreTiers } = readTierArrays();
    const expectedSchemaSet = [...taskStoreTiers, 'tdd'].sort();
    expect(
      schemaSorted,
      `tasks/schema.json enum must equal the assignment set plus "tdd".\n` +
        `assignment: ${JSON.stringify(taskStoreTiers)}\nschema: ${JSON.stringify(schemaSorted)}\n` +
        `expected schema: ${JSON.stringify(expectedSchemaSet)}`,
    ).toEqual(expectedSchemaSet);
    // The assignment surfaces themselves must NEVER accept "tdd" — that is
    // the actual policy enforcement point (TASK-212's fix round HIGH).
    expect(
      taskStoreTiers.includes('tdd'),
      'the assignment surfaces (task-store.js/mcp-server.js) must NOT accept "tdd" — only the storage schema does',
    ).toBe(false);
  });
});

// ===========================================================================
// TASK-213 — three rules against empty tests: doc-lock sensor
// ===========================================================================
// Placement decision (developer, TASK-213): added here rather than a new file
// or tests/agility-doc-locks.spec.js. This file already asserts on the same
// topic (tier/verification policy prose across CLAUDE.md, developer.md,
// reviewer.md); agility-doc-locks.spec.js is scoped to a DIFFERENT topic (the
// R2 review-depth rubric and the R3 pre-hand-off checklist from TASK-078/
// TASK-216) and mixing TASK-213's three rules into it would conflate two
// unrelated lock lineages the way the TASK-078 header itself warns against.
//
// Parity note (same convention as agility-doc-locks.spec.js): only the
// plugin-root copies (agents/, skills/) are read below. tests/agents-parity.spec.js
// already fails on any divergence between the plugin-root and .claude/ copies,
// so re-asserting against the .claude/ copies here would be redundant (LOW at
// review, per the documented convention).
//
// Test budget (Regla 3, self-applied): this ticket (TASK-213) has 8
// acceptance criteria; the 5 `it` blocks below are within that cap, no
// justification needed.
//
// RED-GREEN PLANT PROTOCOL (reported in the hand-off, not committed): each
// assertion below was verified able to fail for the right reason by
// temporarily deleting the target rule's prose from the working-tree file,
// running this spec file alone to confirm the correct assertion went red with
// the correct message, then restoring via `git checkout -- <path>` and
// re-running to confirm green — before this commit landed. See the hand-off
// for the captured output.

describe('TASK-213 Regla 1 — observable-case list derived before dispatch (CLAUDE.md + SKILL.md Workflow)', () => {
  it('regla1_derivation_before_dispatch_documented_in_claude_md_and_skill_md', () => {
    // Harm this prevents: if Regla 1's "derive from the AC, before dispatch,
    // never from the code" mechanism silently drops out of the Workflow docs,
    // tests-after tickets regress to Developer-authored-and-Developer-checked
    // tests with no independent case source — the exact defect TASK-213 exists
    // to close.
    const claudeSection = sliceSection(loadFile('CLAUDE.md'), '## Workflow');
    expect(claudeSection, 'CLAUDE.md must contain a "## Workflow" section').not.toBeNull();
    expect(claudeSection).toMatch(/Regla 1, TASK-213/);
    expect(claudeSection).toMatch(/never the Developer, and never from reading the code/);

    const skillText = normalizeWs(loadFile('skills/orchestrator-routing/SKILL.md'));
    expect(skillText).toMatch(/Regla 1, TASK-213/);
    expect(skillText).toMatch(/never the Developer, and never from reading the code/);
  });
});

describe('TASK-213 Regla 1 — silent case changes escalate, and are a HIGH finding', () => {
  it('developer_escalates_and_reviewer_pins_high', () => {
    // Harm this prevents: without a documented escalation duty and a matching
    // HIGH finding, a Developer could quietly water down a ticket's
    // Orchestrator-derived cases to make them pass, with no review
    // consequence — laundering the exact gap Regla 1 exists to close.
    const devText = loadFile('agents/developer.md');
    expect(devText).toMatch(/stop and escalate to the Orchestrator/);

    const revText = normalizeWs(loadFile('agents/reviewer.md'));
    expect(revText).toMatch(/observable-case list \(Regla 1\)[\s\S]{0,200}is a \*\*HIGH\*\* finding/);
  });
});

describe('TASK-213 Regla 2 — every new test names the harm it prevents (developer.md + reviewer.md MEDIUM)', () => {
  it('harm_naming_rule_and_medium_severity_documented', () => {
    // Harm this prevents: without an objective, checkable form for "names the
    // harm", a Reviewer cannot tell a real regression lock from a vibes-based
    // test that merely restates the implementation — the failure mode Regla 2
    // exists to close, and the one TASK-218's future gate depends on.
    const devText = loadFile('agents/developer.md');
    expect(devText).toMatch(/must name, in one line[\s\S]{0,80}concrete harm it prevents/);
    expect(devText).toMatch(/A new test that lands without that line is a MEDIUM finding at review/);

    const revText = loadFile('agents/reviewer.md');
    expect(revText).toMatch(/harm it prevents \(Regla 2\)\*\* is a \*\*MEDIUM\*\* finding/);
  });
});

describe('TASK-213 Regla 3 — per-ticket new-test cap, with severities for exceeding it', () => {
  it('numeric_cap_and_severities_documented', () => {
    // Harm this prevents: a qualitative-only budget ("don't pad tests") lets
    // unjustified test accumulation creep back in silently, one ticket at a
    // time, with nothing that can be checked mechanically — Regla 3 replaces
    // that with a number and a stated consequence for exceeding it.
    const devText = loadFile('agents/developer.md');
    expect(devText).toMatch(/new specs may not exceed the ticket's acceptance-criterion count/);
    expect(devText).toMatch(/without justification is a MEDIUM finding/);

    const revText = loadFile('agents/reviewer.md');
    expect(revText).toMatch(
      /acceptance-criterion count without explicit justification in the hand-off \(Regla 3\)\*\* is a \*\*MEDIUM\*\* finding/,
    );
    expect(revText).toMatch(/Exceeding the cap WITH justification is not a finding/);
  });
});

describe('TASK-213 AC5 — Regla 3 integrated into New-test budget, not duplicated alongside it', () => {
  it('exactly_one_new_test_budget_section_carries_both_rules', () => {
    // Harm this prevents: a second, parallel "cap" section next to the
    // existing New-test budget would give the Reviewer two authoritative-
    // looking rules that can silently diverge over time — this pins there is
    // exactly one section, and it carries both Regla 2 and Regla 3.
    const devText = loadFile('agents/developer.md');
    const headingMatches = devText.match(/^## New-test budget/gm) ?? [];
    expect(headingMatches.length, 'developer.md must have exactly one "## New-test budget" heading').toBe(1);

    const section = sliceSection(devText, '## New-test budget (Regla 2 + Regla 3, TASK-213, 2026-08-13 human decision)');
    expect(section, 'the New-test budget section must exist with the Regla 2 + Regla 3 heading').not.toBeNull();
    expect(section).toMatch(/must name, in one line/); // Regla 2
    expect(section).toMatch(/The cap \(Regla 3\)/); // Regla 3
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
//     Asserts: /model/i, /reviewer/i && /inherit/i, /developer/i && /sonnet/i
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
