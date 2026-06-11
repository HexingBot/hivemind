// tests/agent-models.spec.js
// TASK-031 — Per-agent model assignment: reviewer on Fable 5, developer/researcher on Sonnet.
//
// AC map:
//   AC1 — reviewer.md frontmatter assigns model: fable
//          (alias verified against code.claude.com sub-agents docs — `fable` is
//          an accepted shorthand in the `model:` frontmatter field)
//   AC2 — developer.md and researcher.md frontmatter assign model: sonnet
//   AC3 — orchestrator.md must have NO model: line
//          (TASK-032 removes the orchestrator agent file entirely; we assert
//          there is no dangling model assignment so the main thread keeps
//          running whatever the session runs)
//   AC4 — CLAUDE.md documents the per-agent model strategy, mentioning
//          reviewer + fable and developer/researcher + sonnet
//
// Parsing strategy: slice between the first two `---` fence lines to isolate
// YAML frontmatter, then match each line with a focused regex. This is the
// same read-file + string-slice idiom used in agents-parity.spec.js and
// docs.spec.js — no external YAML parser required.
//
// Scope note: parity assertions (byte-identical plugin-root copies) are
// already owned by tests/agents-parity.spec.js — do NOT duplicate them here.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './helpers/repoRoot.js';

const AGENTS_DIR = join(REPO_ROOT, '.claude', 'agents');

/**
 * Read a .claude/agents/<name>.md file and return the raw text of its YAML
 * frontmatter block (between the first pair of `---` fence lines).
 * Returns an empty string when no frontmatter is present.
 */
function readFrontmatter(agentName) {
  const text = readFileSync(join(AGENTS_DIR, `${agentName}.md`), 'utf8');
  const lines = text.split(/\r?\n/);

  // Find the opening --- (must be line 0 for valid frontmatter)
  if (lines[0].trim() !== '---') return '';

  // Find the closing ---
  const closeIdx = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (closeIdx === -1) return '';

  // Return the lines between the two fences, joined back.
  return lines.slice(1, closeIdx).join('\n');
}

describe('TASK-031 — AC1: reviewer.md frontmatter assigns model: fable', () => {
  it('reviewer_md_has_model_fable', () => {
    const fm = readFrontmatter('reviewer');
    // model: fable — the alias verified against the Claude Code sub-agents docs.
    expect(
      /^model:\s*fable\s*$/m.test(fm),
      `reviewer.md frontmatter must contain "model: fable" — got:\n${fm}`,
    ).toBe(true);
  });
});

describe('TASK-031 — AC2: developer.md frontmatter assigns model: sonnet', () => {
  it('developer_md_has_model_sonnet', () => {
    const fm = readFrontmatter('developer');
    expect(
      /^model:\s*sonnet\s*$/m.test(fm),
      `developer.md frontmatter must contain "model: sonnet" — got:\n${fm}`,
    ).toBe(true);
  });
});

describe('TASK-031 — AC2: researcher.md frontmatter assigns model: sonnet', () => {
  it('researcher_md_has_model_sonnet', () => {
    const fm = readFrontmatter('researcher');
    expect(
      /^model:\s*sonnet\s*$/m.test(fm),
      `researcher.md frontmatter must contain "model: sonnet" — got:\n${fm}`,
    ).toBe(true);
  });
});

describe('TASK-031 — AC3: orchestrator.md has NO model: key (TASK-032 removal pending)', () => {
  it('orchestrator_md_has_no_model_key', () => {
    const fm = readFrontmatter('orchestrator');
    // The orchestrator runs as the main thread; no model: line should exist so
    // it inherits whatever model the session is started with (Fable 5 in
    // production). Asserting absence now prevents a dangling assignment from
    // accidentally landing before TASK-032 removes the file entirely.
    expect(
      /^model:/m.test(fm),
      `orchestrator.md frontmatter must NOT contain a "model:" key — it should run as the session model (no override).\nFrontmatter found:\n${fm}`,
    ).toBe(false);
  });
});

describe('TASK-031 — AC4: CLAUDE.md documents the per-agent model strategy', () => {
  it('claude_md_documents_per_agent_model_strategy', () => {
    const text = readFileSync(join(REPO_ROOT, 'CLAUDE.md'), 'utf8');

    // Must mention the concept of per-agent model assignment.
    // We match loosely so wording can evolve without breaking this assertion.
    expect(
      /model/i.test(text),
      'CLAUDE.md must mention "model" as part of the per-agent strategy docs',
    ).toBe(true);

    // reviewer → fable
    expect(
      /reviewer/i.test(text) && /fable/i.test(text),
      'CLAUDE.md must mention both "reviewer" and "fable" to document that reviewer runs on Fable 5',
    ).toBe(true);

    // developer and researcher → sonnet
    expect(
      /developer/i.test(text) && /researcher/i.test(text) && /sonnet/i.test(text),
      'CLAUDE.md must mention "developer", "researcher", and "sonnet" to document the model tiering',
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TASK-036 AC5 — section-scoped: "## Per-Agent Model Assignment" must point at
// PROJECT.md as the canonical knob for overriding per-agent models.
//
// Parsing strategy: slice between the `## Per-Agent Model Assignment` heading
// and the NEXT `## ` heading to isolate that section body, then assert that
// the word `PROJECT.md` appears within it. This prevents a false-positive from
// a match elsewhere in CLAUDE.md (e.g. the First-chat routing section).
//
// FAILS NOW: the current section body says to edit the `model:` frontmatter
// file directly — it does not yet mention PROJECT.md as the canonical knob.
// ---------------------------------------------------------------------------
describe('TASK-036 — AC5: CLAUDE.md Per-Agent Model Assignment section mentions PROJECT.md', () => {
  it('per_agent_model_section_points_at_project_md_as_canonical_knob', () => {
    const text = readFileSync(join(REPO_ROOT, 'CLAUDE.md'), 'utf8');

    // Find the section heading.
    const headingRegex = /^## Per-Agent Model Assignment\s*$/m;
    const headingMatch = text.match(headingRegex);
    expect(
      headingMatch,
      'CLAUDE.md must contain a "## Per-Agent Model Assignment" heading',
    ).not.toBeNull();

    const sectionStart = headingMatch.index + headingMatch[0].length;
    const afterSection = text.slice(sectionStart);

    // Find the next ## heading to bound the section.
    const nextHeadingMatch = afterSection.match(/\n## /);
    const sectionBody = nextHeadingMatch
      ? afterSection.slice(0, nextHeadingMatch.index)
      : afterSection;

    // The section body must name PROJECT.md as the place to set per-agent models.
    expect(
      sectionBody,
      '"## Per-Agent Model Assignment" section must mention PROJECT.md as the canonical knob for model overrides',
    ).toMatch(/PROJECT\.md/);
  });
});
