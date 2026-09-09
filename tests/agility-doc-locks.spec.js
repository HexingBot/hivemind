// tests/agility-doc-locks.spec.js
// TASK-078 — MEDIUM-2 carried from the TASK-077 review: the R2 (review depth
// rubric) and R3 (pre-hand-off checklist) prose landed in TASK-077/TASK-078
// with NO doc-lock spec of its own. This file is a new lock, sanctioned for
// this uat-only ticket by explicit orchestrator ruling recorded on the ticket
// (the lock is the carried MEDIUM's remedy, not per-ticket spec accretion).
//
// Scope decision (developer, TASK-078): a NEW file rather than extending
// tests/orchestrator-skill-v2.spec.js — the prose being locked spans THREE
// files (SKILL.md, agents/developer.md, agents/reviewer.md), not just the
// orchestrator skill, so folding it into a skill-only spec file would
// conflate concerns. A dedicated file keeps the R2+R3 lock coherent and
// separately greppable.
//
// Parity note: only the plugin-root copies (skills/, agents/) are read here.
// tests/agents-parity.spec.js and tests/orchestrator-skill-v2.spec.js already
// fail on any divergence between the plugin-root and .claude/ copies, so
// re-asserting content against the .claude/ copies here would be redundant
// (flagged LOW at review, same convention documented in
// tests/orchestrator-routing-skill.spec.js).
//
// RED-GREEN PLANT PROTOCOL (reported in the hand-off, not committed): every
// assertion group below was verified able to fail for the right reason by
// temporarily mutating the target prose in the working tree (one mutation at
// a time: renaming the checklist heading, dropping the "Never downgrade"
// sentence, reverting the hard 150-line threshold back to "roughly"), running
// this spec file alone to confirm the RIGHT assertion went red, then
// restoring the file from git (`git checkout -- <path>`) and re-running to
// confirm green — before this commit landed. See the hand-off for the exact
// commands run.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './helpers/repoRoot.js';

const SKILL_PATH = join(REPO_ROOT, 'skills', 'orchestrator-routing', 'SKILL.md');
const DEVELOPER_PATH = join(REPO_ROOT, 'agents', 'developer.md');
const REVIEWER_PATH = join(REPO_ROOT, 'agents', 'reviewer.md');

function load(path) {
  return readFileSync(path, 'utf8');
}

/** Collapse all whitespace runs (including newlines) to a single space, so a
 * phrase that happens to word-wrap across source lines can still be pinned
 * as one contiguous string. */
function normalize(text) {
  return text.replace(/\s+/g, ' ');
}

// ---------------------------------------------------------------------------
// R2 — Review depth rubric (agility R2, sharpened by TASK-078 MEDIUM-1)
// ---------------------------------------------------------------------------
describe('R2 — review depth rubric: light/full depth table (SKILL.md)', () => {
  it('depth_table_header_and_rows_present', () => {
    const text = load(SKILL_PATH);
    expect(text.includes('| Depth | When |'), 'depth table header must be present').toBe(true);
    expect(/\|\s*`light`\s*\|/.test(text), 'light row must be present').toBe(true);
    expect(/\|\s*`full`\s*\|/.test(text), 'full row must be present').toBe(true);
  });

  it('threshold_is_a_hard_150_line_cutoff_not_the_old_fuzzy_wording', () => {
    // MEDIUM-1: "roughly under 150 (approximate, not a hard cutoff)" is gone;
    // replaced with a hard, reproducible threshold anchored to a named command.
    const text = load(SKILL_PATH);
    expect(
      text.includes('roughly under 150'),
      'the old fuzzy "roughly under 150" wording must not survive',
    ).toBe(false);
    expect(text.includes('under 150'), 'the light row must state the under-150 threshold').toBe(true);
    expect(
      text.includes('git diff --shortstat'),
      'the threshold must be anchored to a concrete, reproducible command',
    ).toBe(true);
  });

  it('security_surface_and_core_tdd_logic_have_concrete_definitions', () => {
    // MEDIUM-1: the two fuzzy surfaces get file/path anchors so two sessions
    // compute the same depth from the same diff.
    const text = load(SKILL_PATH);
    expect(text.includes('Security surface'), 'security surface must have a concrete definition').toBe(true);
    expect(
      text.includes('src/task-board.js'),
      'security surface definition must anchor the board-server route handlers',
    ).toBe(true);
    expect(
      text.includes('src/session-lock.js') && text.includes('src/close-guard.js'),
      'security surface definition must anchor the session-lock/close-guard modules',
    ).toBe(true);
    expect(
      text.includes('Core `tdd`-tier logic'),
      'core tdd-tier logic must have a concrete definition',
    ).toBe(true);
  });

  // TASK-212 (2026-08-13 human decision) retired the `tdd` verification tier.
  // Decision recorded on the ticket: the "Core `tdd`-tier logic" review-depth
  // trigger is NOT deleted and NOT replaced by a new criterion (that broader
  // rubric change is TASK-216's, landing after this ticket) — it is frozen as
  // an explicitly historical marker, scoped to the ~101 tickets that carried
  // tier `tdd` before the retirement, and can never fire for a newly-assigned
  // ticket going forward.
  it('core_tdd_logic_trigger_is_pinned_as_a_frozen_historical_marker_not_a_live_tier', () => {
    const text = normalize(load(SKILL_PATH));
    expect(
      text.includes('HISTORICAL TRIGGER, FROZEN'),
      'the Core `tdd`-tier logic definition must be explicitly marked as a frozen historical trigger',
    ).toBe(true);
    expect(
      /101 (historical )?`?tdd`?-tier tickets|~101 tickets/.test(text) || text.includes('~101 historical'),
      'the definition must scope itself to the ~101 historical tdd-tier tickets',
    ).toBe(true);
    expect(
      text.includes('can never fire for a newly-assigned'),
      'the definition must state it can never fire for a new ticket (the tdd tier no longer exists)',
    ).toBe(true);
  });
});

describe('R2 — one-way escalation: "Never downgrade" sentence pinned in both SKILL.md and reviewer.md', () => {
  it('skill_states_never_downgrade_full_to_light', () => {
    const text = load(SKILL_PATH);
    expect(text.includes('downgrade `full` to `light`')).toBe(true);
  });

  it('reviewer_states_never_downgrade_full_to_light', () => {
    const text = load(REVIEWER_PATH);
    expect(text.includes('downgrade `full` to `light`')).toBe(true);
  });
});

describe('R2 — five recurring HIGH-severity classes named in both SKILL.md and reviewer.md', () => {
  const CLASSES = ['unspecced path', 'vacuous sensor', 'stale dist', 'parity drift', 'calibration laundering'];

  it('skill_light_protocol_names_all_five_classes', () => {
    const text = normalize(load(SKILL_PATH));
    for (const c of CLASSES) {
      expect(text.includes(c), `SKILL.md must name the "${c}" HIGH class`).toBe(true);
    }
  });

  it('reviewer_light_protocol_names_all_five_classes', () => {
    const text = normalize(load(REVIEWER_PATH));
    for (const c of CLASSES) {
      expect(text.includes(c), `reviewer.md must name the "${c}" HIGH class`).toBe(true);
    }
  });
});

describe('R2 — tier-audit (E2) referenced in SKILL.md, HIGH "tier misassignment" pinned in reviewer.md', () => {
  it('skill_references_the_tier_audit', () => {
    const text = load(SKILL_PATH);
    expect(/tier-audit/i.test(text), 'SKILL.md must reference the tier-audit').toBe(true);
  });

  it('reviewer_pins_the_tier_misassignment_high_finding', () => {
    const text = load(REVIEWER_PATH);
    expect(
      text.includes('HIGH "tier misassignment" finding'),
      'reviewer.md must pin the exact HIGH "tier misassignment" finding name',
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// R3 — Pre-hand-off checklist (agility R3, TASK-078)
// ---------------------------------------------------------------------------
describe('R3 — developer.md carries the 5-item pre-hand-off checklist headings', () => {
  it('checklist_section_heading_present', () => {
    const text = load(DEVELOPER_PATH);
    expect(text.includes('## Pre-hand-off checklist (agility R3)')).toBe(true);
  });

  it('all_five_item_lead_ins_present', () => {
    const text = load(DEVELOPER_PATH);
    const items = [
      '**Unspecced path exercised**',
      '**Every new sensor/lock is red-green planted**',
      'rebuilt if bundled `src/` or `bin/` was touched',
      '**Parity copies byte-identical if any copy was touched**',
      '**Calibration markers preserved downstream (no laundering)**',
    ];
    for (const item of items) {
      expect(text.includes(item), `developer.md checklist must carry "${item}"`).toBe(true);
    }
  });

  it('output_section_requires_a_per_item_outcome_statement', () => {
    const text = load(DEVELOPER_PATH);
    expect(
      text.includes('Pre-hand-off checklist outcomes (agility R3)'),
      'Output section must require stating the checklist outcomes',
    ).toBe(true);
    expect(/done.*n\/a|n\/a.*done/.test(normalize(text))).toBe(true);
  });
});

describe('R3 — reviewer.md: missing checklist outcomes is a MEDIUM finding', () => {
  it('checklist_verification_section_heading_present', () => {
    const text = load(REVIEWER_PATH);
    expect(text.includes('## Pre-hand-off checklist verification (agility R3)')).toBe(true);
  });

  it('missing_or_incomplete_checklist_is_pinned_as_medium', () => {
    const text = normalize(load(REVIEWER_PATH));
    expect(
      text.includes('is a **MEDIUM** finding'),
      'reviewer.md must state the missing-checklist-outcomes finding is MEDIUM',
    ).toBe(true);
    // The five item names must be echoed so the Reviewer knows what to check.
    for (const c of ['unspecced path', 'red-green plant', 'dist/ rebuild', 'parity', 'calibration laundering']) {
      expect(text.includes(c), `reviewer.md checklist-verification section must name "${c}"`).toBe(true);
    }
  });

  it('contrasts_a_false_stated_outcome_as_already_high_not_a_second_medium', () => {
    const text = normalize(load(REVIEWER_PATH));
    expect(
      /contradicts.*already covered by the existing HIGH/.test(text),
      'reviewer.md must contrast a diff-contradicted checklist claim as HIGH, not a second MEDIUM',
    ).toBe(true);
  });
});
