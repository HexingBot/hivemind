// tests/agent-models.spec.js
// TASK-031 — Per-agent model assignment: reviewer on inherit (default main model), developer/researcher on Sonnet.
// TASK-042 — Retired reviewer's fable pin → inherit (Fable 5 no longer available).
//
// AC map:
//   AC1 — reviewer.md frontmatter assigns model: inherit
//          (alias verified against code.claude.com sub-agents docs — `inherit`
//          tracks the session's main model, currently Opus 4.8)
//   AC2 — developer.md and researcher.md frontmatter assign model: sonnet
//   AC3 — orchestrator.md must be ABSENT (TASK-032 removed the orchestrator agent
//          file entirely; the Orchestrator is the main session thread, not a
//          subagent; asserting absence prevents a dangling assignment from landing)
//   AC4 — CLAUDE.md documents the per-agent model strategy, mentioning
//          reviewer + inherit and developer/researcher + sonnet, with the
//          assertions scoped to the '## Per-Agent Model Assignment' section and
//          including the per-project override clause (PROJECT.md / --apply-models)
//
// Parsing strategy: slice between the first two `---` fence lines to isolate
// YAML frontmatter, then match each line with a focused regex. This is the
// same read-file + string-slice idiom used in agents-parity.spec.js and
// docs.spec.js — no external YAML parser required.
//
// Scope note: parity assertions (byte-identical plugin-root copies) are
// already owned by tests/agents-parity.spec.js — do NOT duplicate them here.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
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

describe('TASK-031/TASK-042 — AC1: reviewer.md frontmatter assigns model: inherit', () => {
  it('reviewer_md_has_model_inherit', () => {
    const fm = readFrontmatter('reviewer');
    // model: inherit — tracks the session's main model (currently Opus 4.8).
    // TASK-042: retired fable pin; fable is no longer available to this account.
    expect(
      /^model:\s*inherit\s*$/m.test(fm),
      `reviewer.md frontmatter must contain "model: inherit" — got:\n${fm}`,
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

describe('TASK-031/TASK-032 — AC3: orchestrator agent file is absent', () => {
  it('orchestrator_agent_file_is_absent', () => {
    // TASK-032 removed orchestrator.md entirely. The Orchestrator is the main
    // session thread and inherits whatever model the session runs with (Opus 4.8
    // in production as of TASK-042). Asserting file absence preserves the intent of the
    // original no-model-key test: there can be no dangling model assignment
    // when the file does not exist at all.
    expect(
      existsSync(join(AGENTS_DIR, 'orchestrator.md')),
      'orchestrator.md must NOT exist — the Orchestrator is the main session thread (TASK-032)',
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TASK-031 AC4 / TASK-032 / TASK-036 AC5 / TASK-042 — section-scoped doc assertions.
//
// Parsing strategy: slice between the `## Per-Agent Model Assignment` heading
// and the NEXT `## ` heading to isolate that section body, then assert within
// that slice. This prevents false-positives from words appearing elsewhere in
// CLAUDE.md (e.g. the First-chat routing section mentions "developer").
//
// Assertions:
//   (a) reviewer + inherit appear together in the section (TASK-042: was fable).
//   (b) developer + researcher + sonnet appear together in the section.
//   (c) PROJECT.md is named as the canonical knob (TASK-036 AC5).
//   (d) The per-project override clause mentions --apply-models (TASK-032).
// ---------------------------------------------------------------------------

/**
 * Return the text of the '## Per-Agent Model Assignment' section from CLAUDE.md,
 * bounded by the next '## ' heading (or end of file).
 */
function readPerAgentModelSection() {
  const text = readFileSync(join(REPO_ROOT, 'CLAUDE.md'), 'utf8');
  const headingRegex = /^## Per-Agent Model Assignment\s*$/m;
  const headingMatch = text.match(headingRegex);
  if (!headingMatch) return null;
  const afterSection = text.slice(headingMatch.index + headingMatch[0].length);
  const nextHeadingMatch = afterSection.match(/\n## /);
  return nextHeadingMatch ? afterSection.slice(0, nextHeadingMatch.index) : afterSection;
}

describe('TASK-031 — AC4: CLAUDE.md Per-Agent Model Assignment section documents model strategy', () => {
  it('section_heading_exists', () => {
    const text = readFileSync(join(REPO_ROOT, 'CLAUDE.md'), 'utf8');
    expect(
      text,
      'CLAUDE.md must contain a "## Per-Agent Model Assignment" heading',
    ).toMatch(/^## Per-Agent Model Assignment\s*$/m);
  });

  it('section_documents_reviewer_on_inherit', () => {
    const section = readPerAgentModelSection();
    expect(section, 'Per-Agent Model Assignment section must be present').not.toBeNull();
    // reviewer → inherit: both words must appear within the section body.
    // TASK-042: retired fable pin; reviewer now inherits the session's main model.
    expect(
      /reviewer/i.test(section) && /inherit/i.test(section),
      '"## Per-Agent Model Assignment" section must mention both "reviewer" and "inherit"',
    ).toBe(true);
  });

  it('section_documents_developer_and_researcher_on_sonnet', () => {
    const section = readPerAgentModelSection();
    expect(section, 'Per-Agent Model Assignment section must be present').not.toBeNull();
    // developer and researcher → sonnet: all three words within the section.
    expect(
      /developer/i.test(section) && /researcher/i.test(section) && /sonnet/i.test(section),
      '"## Per-Agent Model Assignment" section must mention "developer", "researcher", and "sonnet"',
    ).toBe(true);
  });

  it('section_points_at_project_md_as_canonical_knob', () => {
    const section = readPerAgentModelSection();
    expect(section, 'Per-Agent Model Assignment section must be present').not.toBeNull();
    expect(
      section,
      '"## Per-Agent Model Assignment" section must mention PROJECT.md as the canonical knob for model overrides',
    ).toMatch(/PROJECT\.md/);
  });

  it('section_mentions_apply_models_override_clause', () => {
    const section = readPerAgentModelSection();
    expect(section, 'Per-Agent Model Assignment section must be present').not.toBeNull();
    // The per-project override clause: --apply-models flag or an equivalent
    // mention of the override mechanism.
    expect(
      /--apply-models|apply.models/i.test(section),
      '"## Per-Agent Model Assignment" section must document the --apply-models override clause',
    ).toBe(true);
  });
});
