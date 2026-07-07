// tests/ticket-write-path-doc-locks.spec.js
// TASK-099 (AC2) — deep-review sweep #2 HIGH finding R4 (F23+F16): three
// canonical prose sites instructed a direct guard-bypassing Edit-to-done,
// contradicting the Ticket-update protocol that exists precisely because
// hand edits skip the uat-only done-guard and the loop-mode close guard
// (TASK-082). This is a NEW dedicated doc-lock file — same precedent as
// tests/agility-doc-locks.spec.js (R2/R3) — rot-proofing the AC1 rewrite so
// the three sites cannot silently regress back to instructing a direct Edit.
//
// Scope: both orchestrator-routing SKILL.md copies (byte-identical per
// tests/orchestrator-skill-v2.spec.js, so asserting on the .claude/ copy is
// sufficient; re-asserting against the plugin-root copy here would be
// redundant, same convention as tests/agility-doc-locks.spec.js) and the
// project-root CLAUDE.md (the live orchestrator contract for this repo,
// never parity-copied).
//
// RED reasons (pre-AC1-rewrite):
//   - SKILL.md's "Ticket source" section says 'To update, use `Edit`
//     against the specific task file' with no mention of the MCP tools.
//   - SKILL.md's "Tools the Orchestrator uses" section lists the local task
//     store (Read/Edit/Glob) as the CURRENT ticket source, with no mention
//     that the MCP tools are the write path.
//   - SKILL.md's Workflow step 6 ("Update ticket") instructs "edit
//     `tasks/<KEY>.json` to set `status: done`" directly, no close_task
//     mention.
//   - CLAUDE.md's Workflow step 7 ("Update the ticket") instructs
//     "transition the task's `status` to `done`" directly, no mention of
//     any MCP tool anywhere in the file.
//   - SKILL.md's Ticket-update protocol intro claims the MCP tools are "the
//     only path that runs the two deterministic mutation-seam guards" —
//     false once src/task-board.js's status endpoint also composes the
//     guard (TASK-099 AC3).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './helpers/repoRoot.js';

const SKILL_PATH = join(REPO_ROOT, '.claude', 'skills', 'orchestrator-routing', 'SKILL.md');
const CLAUDE_MD_PATH = join(REPO_ROOT, 'CLAUDE.md');

function load(path) {
  return readFileSync(path, 'utf8');
}

/**
 * Slice the text from the first line starting with `headingText` to the next
 * same-level heading (exclusive), or end-of-string. Mirrors the sectioning
 * helper in tests/verification-policy-docs.spec.js.
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

/** Collapse whitespace runs (including newlines) to a single space, so a
 * phrase that word-wraps across source lines can still be pinned as one
 * contiguous string (same convention as tests/agility-doc-locks.spec.js). */
function normalize(text) {
  return text.replace(/\s+/g, ' ');
}

// ---------------------------------------------------------------------------
// AC1 — SKILL.md: no canonical step instructs a direct Edit-to-done anymore.
// ---------------------------------------------------------------------------
describe('AC1 (TASK-099) — SKILL.md: Ticket source / Tools / Workflow step 6 name the MCP write path', () => {
  it('ticket_source_section_names_the_mcp_tools_as_the_update_path_not_a_bare_edit', () => {
    const text = load(SKILL_PATH);
    const section = sliceSection(text, '## Ticket source');
    expect(section, 'SKILL.md must contain a "## Ticket source" section').not.toBeNull();
    expect(
      /close_task|transition_status/.test(section),
      'Ticket source section must name close_task/transition_status as the update path',
    ).toBe(true);
    expect(
      /degraded fallback|documented.*fallback/i.test(normalize(section)),
      'Ticket source section must demote a direct Edit to an explicitly-labeled fallback',
    ).toBe(true);
  });

  it('tools_section_lists_mcp_task_store_tools_as_the_write_path', () => {
    const text = load(SKILL_PATH);
    const section = sliceSection(text, '## Tools the Orchestrator uses');
    expect(section, 'SKILL.md must contain a "## Tools the Orchestrator uses" section').not.toBeNull();
    expect(
      /mcp__plugin_hivemind_hivemind-tasks__|MCP task-store tools/.test(section),
      'Tools section must list the MCP task-store tools',
    ).toBe(true);
    expect(
      /close_task/.test(section),
      'Tools section must name close_task specifically',
    ).toBe(true);
    expect(
      /fallback/i.test(section),
      'Tools section must demote the direct Edit-on-tasks/ path to a fallback',
    ).toBe(true);
  });

  it('workflow_step_6_calls_close_task_not_a_bare_edit_to_done', () => {
    const text = load(SKILL_PATH);
    const section = sliceSection(text, '## Workflow (run for every ticket)');
    expect(section, 'SKILL.md must contain a "## Workflow (run for every ticket)" section').not.toBeNull();

    // Step 6 (Update ticket) must name close_task as the mechanism.
    const step6Match = section.match(/6\. \*\*Update ticket\.\*\*[\s\S]*?(?=\n7\. )/);
    expect(step6Match, 'Workflow step 6 ("Update ticket") must be present').not.toBeNull();
    const step6 = normalize(step6Match[0]);
    expect(/close_task/.test(step6), 'Workflow step 6 must name the close_task tool').toBe(true);
    expect(
      /degraded fallback|documented.*fallback/i.test(step6),
      'Workflow step 6 must demote a direct Edit to an explicitly-labeled degraded fallback',
    ).toBe(true);
  });

  it('ticket_update_protocol_no_longer_claims_mcp_is_the_only_path_that_runs_the_guards', () => {
    const text = load(SKILL_PATH);
    const section = sliceSection(text, '## Ticket-update protocol');
    expect(section, 'SKILL.md must contain a "## Ticket-update protocol" section').not.toBeNull();
    expect(
      /(?:is|are) the only path that runs the/.test(section),
      'the old "MCP tools are/is the only path that runs the guards" claim must be gone (the board endpoint runs them too, TASK-099 AC3)',
    ).toBe(false);
    expect(
      /task-board\.js/.test(section),
      'the corrected claim must name the guarded board endpoint (src/task-board.js)',
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CLAUDE.md — Workflow step 7 names the MCP close_task tool.
// ---------------------------------------------------------------------------
describe('AC1 (TASK-099) — CLAUDE.md Workflow step 7 names the MCP write path', () => {
  it('workflow_step_7_calls_close_task_not_a_bare_status_transition', () => {
    const text = load(CLAUDE_MD_PATH);
    const section = sliceSection(text, '## Workflow');
    expect(section, 'CLAUDE.md must contain a "## Workflow" section').not.toBeNull();

    const step7Match = section.match(/7\. \*\*Update the ticket\.\*\*[\s\S]*/);
    expect(step7Match, 'Workflow step 7 ("Update the ticket") must be present').not.toBeNull();
    const step7 = normalize(step7Match[0]);
    expect(/close_task/.test(step7), 'Workflow step 7 must name the close_task tool').toBe(true);
    expect(
      /degraded fallback|documented.*fallback/i.test(step7),
      'Workflow step 7 must demote a direct Edit to an explicitly-labeled degraded fallback',
    ).toBe(true);
  });
});
