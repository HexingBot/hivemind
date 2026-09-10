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
// TASK-216 (2026-08-13 human decision) retired the R2 review-depth rubric and
// its `light` level. The R2 describe blocks that used to live in this file
// (the light/full depth table, the one-way-escalation "never downgrade"
// sentence, and the light-protocol's own restatement of the five recurring
// HIGH-severity classes) are removed below — that prose no longer exists in
// SKILL.md or agents/reviewer.md, so a lock pinning it would pin an absence.
// The five recurring classes are NOT lost: they survive, unconditionally (not
// depth-gated), in agents/developer.md's Pre-hand-off checklist and
// agents/reviewer.md's "Pre-hand-off checklist verification" section, both of
// which the surviving R3 describe blocks below already lock. The
// Tier-audit (E2) sensor is untouched by this retirement (TASK-218 owns any
// future rewrite of that section) and is still locked by the surviving
// describe block below, retitled to drop the now-inaccurate "R2 —" prefix.
// This file is not emptied by the retirement: the R3 half fixes something
// still real (the pre-hand-off checklist prose), so it stays.
//
// Parity note: only the plugin-root copies (skills/, agents/) are read here.
// tests/agents-parity.spec.js and tests/orchestrator-skill-v2.spec.js already
// fail on any divergence between the plugin-root and .claude/ copies, so
// re-asserting content against the .claude/ copies here would be redundant
// (flagged LOW at review, same convention documented in
// tests/orchestrator-routing-skill.spec.js).
//
// RED-GREEN PLANT PROTOCOL (reported in the hand-off, not committed): every
// surviving assertion below was re-verified able to fail for the right
// reason after the TASK-216 edit, by temporarily mutating the target prose
// in the working tree, running this spec file alone to confirm the RIGHT
// assertion went red, then restoring the file from git (`git checkout --
// <path>`) and re-running to confirm green — before this commit landed. See
// the hand-off for the exact commands run.

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
// E2 — Tier-audit (survives the TASK-216 retirement of R2; owned by TASK-218)
// ---------------------------------------------------------------------------
describe('E2 — tier-audit referenced in SKILL.md, HIGH "tier misassignment" pinned in reviewer.md', () => {
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
      /contradicts.*is a HIGH finding.*not a second MEDIUM/.test(text),
      'reviewer.md must contrast a diff-contradicted checklist claim as HIGH, not a second MEDIUM',
    ).toBe(true);
  });
});
