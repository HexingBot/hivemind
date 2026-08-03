// tests/uat-doc-example-lock.spec.js
// TASK-196 AC1/AC3 — pins the UAT-recording convention documented in
// skills/orchestrator-routing/SKILL.md against the REAL loop-mode guard
// (src/close-guard.js's hasExplicitHumanVerdictMarker), instead of
// re-encoding the accepted grammar as a second set of regexes here (a second
// copy of the contract would drift exactly like the docs did — see the
// ticket for the full rationale). The published worked example is extracted
// verbatim from the doc by a stable marker and run through the live guard;
// a doc that stops matching what the guard accepts fails this lock.
//
// RED-RUN (AC1): before this ticket's doc fix landed, SKILL.md carried no
// `<!-- UAT-WORKED-EXAMPLE:START -->` marker at all (the UAT-recording
// convention was prose-only, with no example proven against the guard) —
// this spec's own vacuity guard ("extracted example is non-empty") failed
// loudly for that reason. See the ticket hand-off for the captured verbatim
// red output.
//
// Only the plugin-root copy is read here — tests/orchestrator-routing-skill.spec.js
// already fails on any byte divergence between skills/ and .claude/skills/,
// so re-asserting the same content against the .claude/ copy here would be
// redundant (same convention documented in tests/agility-doc-locks.spec.js).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './helpers/repoRoot.js';
import { hasExplicitHumanVerdictMarker } from '../src/close-guard.js';

const SKILL_PATH = join(REPO_ROOT, 'skills', 'orchestrator-routing', 'SKILL.md');
const START_MARKER = '<!-- UAT-WORKED-EXAMPLE:START -->';
const END_MARKER = '<!-- UAT-WORKED-EXAMPLE:END -->';

/**
 * Extract the raw text strictly between START_MARKER and END_MARKER in
 * SKILL.md. Throws (loudly, not an empty-string pass-through) if either
 * marker is missing or the extracted text is empty/whitespace-only — the
 * Empty-result contract (CLAUDE.md) this repo has hit before: an empty
 * extraction must never silently render as "nothing to check".
 */
function extractWorkedExample() {
  const text = readFileSync(SKILL_PATH, 'utf8');
  const startIdx = text.indexOf(START_MARKER);
  const endIdx = text.indexOf(END_MARKER);
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    throw new Error(
      `uat-doc-example-lock: could not find a well-formed ${START_MARKER} ... `
        + `${END_MARKER} block in ${SKILL_PATH} — the doc no longer publishes a `
        + 'worked example for this lock to check (or the markers were removed/reordered).',
    );
  }
  const raw = text.slice(startIdx + START_MARKER.length, endIdx).trim();
  if (raw === '') {
    throw new Error(
      'uat-doc-example-lock: the extracted worked-example block is empty — '
        + 'a doc-lock must never treat an empty extraction as "nothing to check" '
        + '(see CLAUDE.md\'s Empty-result contract).',
    );
  }
  return raw;
}

/** Count numbered step-start lines ("1.", "2)", "Step 3:", ...) in the raw
 * example text — used only to size the fixture task's acceptance_criteria
 * to match the doc's own published step count, never to decide accept/reject
 * (that decision is made exclusively by the real hasExplicitHumanVerdictMarker). */
function countStepLines(raw) {
  return raw
    .split(/\r?\n/)
    .filter((line) => /^(?:step\s*)?\d+[.):]/i.test(line.trim()))
    .length;
}

function taskWithAcCount(n, body) {
  return {
    key: 'TASK-DOC-EXAMPLE',
    acceptance_criteria: Array.from({ length: n }, (_, i) => `AC ${i + 1}`),
    comments: [{ author: 'uat', at: '2026-08-02T00:00:00Z', body }],
  };
}

describe('TASK-196 AC1/AC3 — SKILL.md UAT worked example vs the live loop-mode guard', () => {
  it('the doc publishes a non-empty worked example (vacuity guard)', () => {
    const raw = extractWorkedExample();
    expect(raw.length).toBeGreaterThan(0);
  });

  it('the published worked example is ACCEPTED by hasExplicitHumanVerdictMarker', () => {
    const raw = extractWorkedExample();
    const stepCount = countStepLines(raw);
    expect(stepCount, 'the worked example must contain at least one numbered step').toBeGreaterThan(0);
    const task = taskWithAcCount(stepCount, raw);
    expect(
      hasExplicitHumanVerdictMarker(task),
      `the doc's own published worked example was REJECTED by the live guard:\n${raw}`,
    ).toBe(true);
  });

  // TASK-196 fix round (MEDIUM-2; comment reworded round 3 per LOW-1 — the
  // original wording misattributed the trailing-period claim to the
  // overall-line bullet) — the docs claim the guard tolerates the short
  // "Overall: PASS" form (no "result") on the overall line (SKILL.md:468-469).
  // The optional trailing period is documented only for the STEP LABEL
  // (SKILL.md:463: "an optional trailing period is fine"); the overall-line
  // bullet itself says "with nothing appended" (SKILL.md:468) and makes no
  // period claim. STRICT_OVERALL_RE tolerates a trailing period on the
  // overall line too (close-guard.js's evaluateStructuredStepVerdicts doc
  // comment says so explicitly) — real guard behavior, not a SKILL.md claim
  // about the overall line — so this second assertion locks that behavior
  // rather than restating a doc sentence that doesn't exist for this region.
  // The canonical example above exercises neither transform (it reads
  // "Overall result: PASS", no period), so without both assertions a future
  // narrowing of STRICT_OVERALL_RE could silently drop either tolerance
  // while this file stayed green. Both transforms apply to the extracted
  // example itself (never a spec-local re-encoding of the grammar),
  // consistent with this file's derived-from-doc design.
  describe('AC3 documented tolerances — transforms of the doc example are still ACCEPTED', () => {
    it('the short "Overall:" form (result omitted) is ACCEPTED by hasExplicitHumanVerdictMarker', () => {
      const raw = extractWorkedExample();
      const stepCount = countStepLines(raw);
      const mutated = raw.replace(
        /^([ \t]*overall)(?:\s+result)?(\s*:\s*pass\.?)([ \t]*)$/im,
        '$1$2$3',
      );
      expect(mutated, 'mutation must actually change the text').not.toBe(raw);
      const task = taskWithAcCount(stepCount, mutated);
      expect(
        hasExplicitHumanVerdictMarker(task),
        `the documented short "Overall:" form was REJECTED by the live guard:\n${mutated}`,
      ).toBe(true);
    });

    it('an optional trailing period on the overall-result line is ACCEPTED by hasExplicitHumanVerdictMarker', () => {
      const raw = extractWorkedExample();
      const stepCount = countStepLines(raw);
      const mutated = raw.replace(
        /^([ \t]*overall(?:\s+result)?\s*:\s*pass)\.?([ \t]*)$/im,
        '$1.$2',
      );
      expect(mutated, 'mutation must actually change the text').not.toBe(raw);
      const task = taskWithAcCount(stepCount, mutated);
      expect(
        hasExplicitHumanVerdictMarker(task),
        `the documented trailing-period tolerance was REJECTED by the live guard:\n${mutated}`,
      ).toBe(true);
    });
  });

  describe('AC3 non-vacuity-by-mutation — each mutation of the doc example is REJECTED', () => {
    it('mutation: strip the "Verdict:" label from the first step', () => {
      const raw = extractWorkedExample();
      const stepCount = countStepLines(raw);
      const mutated = raw.replace(/Verdict:\s*(PASS|FAIL)/i, '$1');
      expect(mutated, 'mutation must actually change the text').not.toBe(raw);
      const task = taskWithAcCount(stepCount, mutated);
      expect(hasExplicitHumanVerdictMarker(task)).toBe(false);
    });

    it('mutation: add a preamble line before the first step', () => {
      const raw = extractWorkedExample();
      const stepCount = countStepLines(raw);
      const mutated = `UAT script:\n${raw}`;
      const task = taskWithAcCount(stepCount, mutated);
      expect(hasExplicitHumanVerdictMarker(task)).toBe(false);
    });

    it('mutation: append trailing prose to the overall-result line', () => {
      const raw = extractWorkedExample();
      const stepCount = countStepLines(raw);
      const mutated = raw.replace(
        /^[ \t]*(overall(?:\s+result)?\s*:\s*pass\.?)\s*$/im,
        '$1 (deferred — see note)',
      );
      expect(mutated, 'mutation must actually change the text').not.toBe(raw);
      const task = taskWithAcCount(stepCount, mutated);
      expect(hasExplicitHumanVerdictMarker(task)).toBe(false);
    });
  });
});
