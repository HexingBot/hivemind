// tests/orchestrator-skill-v2.spec.js
// TASK-032 — Orchestrator demotion: coverage migrated from
// orchestrator-agent-v2.spec.js (which pinned orchestrator.md) to this file,
// which pins the orchestrator-routing SKILL.md.
//
// The orchestrator.md agent file has been deleted (AC1 of TASK-032). The
// Orchestrator is the main session thread, not a spawnable subagent. All
// operational content — the v2 session model, RESUME-FIRST contract, workflow
// loop, delegation rules — now lives in the orchestrator-routing skill, which
// is byte-identical between .claude/skills/ and plugin-root skills/.
//
// This spec asserts:
//   • The orchestrator.md agent files are ABSENT (no dangling agent definition).
//   • The skill file is PRESENT in both copies and carries the v2 contract.
//   • ZERO v1 session-model markers survive in the skill.
//   • The v2 pointer/bundle contract and RESUME-FIRST sequence are present.
//   • The skill is byte-identical between .claude/skills/ and plugin-root skills/.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './helpers/repoRoot.js';

const DEV_ORCH_AGENT = join(REPO_ROOT, '.claude', 'agents', 'orchestrator.md');
const PLUGIN_ORCH_AGENT = join(REPO_ROOT, 'agents', 'orchestrator.md');

const DEV_SKILL = join(REPO_ROOT, '.claude', 'skills', 'orchestrator-routing', 'SKILL.md');
const PLUGIN_SKILL = join(REPO_ROOT, 'skills', 'orchestrator-routing', 'SKILL.md');

function readSkill() {
  expect(existsSync(DEV_SKILL), '.claude/skills/orchestrator-routing/SKILL.md must exist').toBe(true);
  return readFileSync(DEV_SKILL, 'utf8');
}

// ---------------------------------------------------------------------------
// Absence guard — the agent files must be gone (TASK-032 AC1)
// ---------------------------------------------------------------------------
describe('TASK-032 — orchestrator.md agent files are absent (demotion complete)', () => {
  it('dev_orchestrator_agent_file_is_absent', () => {
    expect(
      existsSync(DEV_ORCH_AGENT),
      '.claude/agents/orchestrator.md must NOT exist — the Orchestrator is the main thread',
    ).toBe(false);
  });

  it('plugin_orchestrator_agent_file_is_absent', () => {
    expect(
      existsSync(PLUGIN_ORCH_AGENT),
      'agents/orchestrator.md must NOT exist — the Orchestrator is the main thread',
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Skill presence — coverage moved here from the deleted agent file
// ---------------------------------------------------------------------------
describe('TASK-032 — orchestrator-routing skill exists in both copies', () => {
  it('dev_skill_file_exists', () => {
    expect(existsSync(DEV_SKILL), '.claude/skills/orchestrator-routing/SKILL.md must exist').toBe(true);
  });

  it('plugin_skill_file_exists', () => {
    expect(existsSync(PLUGIN_SKILL), 'skills/orchestrator-routing/SKILL.md must exist').toBe(true);
  });

  it('skill_copies_are_byte_identical', () => {
    expect(existsSync(DEV_SKILL)).toBe(true);
    expect(existsSync(PLUGIN_SKILL)).toBe(true);
    const devBytes = readFileSync(DEV_SKILL);
    const pluginBytes = readFileSync(PLUGIN_SKILL);
    expect(
      pluginBytes.equals(devBytes),
      'skills/orchestrator-routing/SKILL.md must be byte-identical to .claude/skills/orchestrator-routing/SKILL.md',
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// v1 marker absence — migrated from orchestrator-agent-v2.spec.js
// ---------------------------------------------------------------------------
describe('TASK-025 — orchestrator-routing skill carries ZERO v1 session-model markers', () => {
  it('no_updated_at_archive_scheme', () => {
    const text = readSkill();
    expect(
      /sessions\/<updated_at>/.test(text),
      'v1 archive path sessions/<updated_at> must be gone',
    ).toBe(false);
    expect(
      /<updated_at>\.json/.test(text),
      'v1 <updated_at>.json archive token must be gone',
    ).toBe(false);
  });

  it('no_single_source_of_truth_applied_to_session_json', () => {
    const text = readSkill();
    expect(
      /single source of truth/i.test(text),
      'the "single source of truth" framing of session.json is v1 — must be gone',
    ).toBe(false);
  });

  it('no_idle_template_reset_language', () => {
    const text = readSkill();
    expect(
      /idle template/i.test(text),
      'the "reset to idle template" archive language is v1 — must be gone',
    ).toBe(false);
  });

  it('no_session_json_tmp_atomic_recipe', () => {
    const text = readSkill();
    expect(
      /session\.json\.tmp/.test(text),
      'the inline session.json.tmp atomic-rename recipe is v1 detail — must be gone',
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// v2 contract presence — migrated from orchestrator-agent-v2.spec.js
// ---------------------------------------------------------------------------
describe('TASK-025 — orchestrator-routing skill carries the v2 pointer/bundle contract', () => {
  it('mentions_the_pointer_with_active_session_id', () => {
    const text = readSkill();
    expect(text.includes('state/session.json')).toBe(true);
    expect(
      text.includes('active_session_id'),
      'must reference the pointer field active_session_id',
    ).toBe(true);
    expect(/pointer/i.test(text)).toBe(true);
  });

  it('mentions_the_bundle_directory', () => {
    const text = readSkill();
    expect(
      /state\/sessions\/<active_session_id>\//.test(text)
        || /state\/sessions\/<[^>]*session[^>]*>\//.test(text),
      'must reference the bundle dir state/sessions/<active_session_id>/',
    ).toBe(true);
  });

  it('carries_the_four_step_resume_first_sequence', () => {
    const text = readSkill();
    expect(/RESUME[- ]FIRST/i.test(text)).toBe(true);
    // The four-step chain: pointer -> bundle session.json -> task -> restate.
    expect(/state\/sessions\/.*session\.json/s.test(text)).toBe(true);
    expect(/tasks\/<active_task>\.json|active_task/.test(text)).toBe(true);
    expect(/restate/i.test(text)).toBe(true);
    expect(/handoff_summary/.test(text)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// New operational content — migrated from orchestrator.md, now locked here
// ---------------------------------------------------------------------------
describe('TASK-032 — orchestrator-routing skill carries the full operational manual', () => {
  it('documents_delegation_protocol', () => {
    const text = readSkill();
    expect(/parallel/i.test(text), 'skill must mention parallel subagent spawning').toBe(true);
    expect(/fresh context/i.test(text), 'skill must mention fresh context for subagents').toBe(true);
  });

  it('documents_tdd_single_spawn_two_commit_discipline', () => {
    const text = readSkill();
    // TASK-076: the two-spawn TEST/IMPL protocol is retired in favor of a single
    // spawn with a two-commit discipline (test: commit strictly before impl
    // commit, plus captured red-run evidence in the hand-off).
    expect(/test:.*commit/i.test(text), 'skill must document the test: commit').toBe(true);
    expect(/impl commit/i.test(text), 'skill must document the impl commit').toBe(true);
    expect(
      /red.run|red output/i.test(text),
      'skill must document captured red-run evidence',
    ).toBe(true);
    expect(
      /strictly (before|precede)/i.test(text),
      'skill must state the test: commit strictly precedes the impl commit',
    ).toBe(true);
  });

  it('documents_reviewer_isolation', () => {
    const text = readSkill();
    expect(
      /reviewer.*fresh context|fresh context.*reviewer|Reviewer isolation/i.test(text),
      'skill must document reviewer fresh-context isolation',
    ).toBe(true);
  });

  it('documents_ticket_update_protocol', () => {
    const text = readSkill();
    // Ticket-update protocol: status done, linked_commits, updated_at, index.json.
    expect(/status.*done|done.*status/i.test(text)).toBe(true);
    expect(/linked_commits/.test(text)).toBe(true);
    expect(/tasks\/index\.json/.test(text)).toBe(true);
  });

  it('documents_session_checkpointing', () => {
    const text = readSkill();
    expect(/checkpoint|meaningful transition/i.test(text)).toBe(true);
  });

  it('documents_project_context_read_before_starting_work', () => {
    const text = readSkill();
    // Migrated from orchestrator.md's Inputs section (TASK-032 review HIGH-1):
    // read project-context.md before starting work; may not exist on fresh
    // clones — proceed with sensible defaults.
    expect(
      /\.claude\/agents\/project-context\.md/.test(text),
      'skill must instruct reading .claude/agents/project-context.md before starting work',
    ).toBe(true);
    expect(
      /sensible defaults/i.test(text),
      'skill must carry the fresh-clone fallback (proceed with sensible defaults)',
    ).toBe(true);
  });

  it('documents_session_close_out', () => {
    const text = readSkill();
    // The session end/pause lifecycle.
    expect(/\bend\b.*bundle|bundle.*\bend\b|close.out|summary\.md/i.test(text)).toBe(true);
  });

  it('documents_guardrails', () => {
    const text = readSkill();
    expect(/Guardrails/i.test(text)).toBe(true);
    // The key guardrail: code changes belong to the Developer.
    expect(/Developer subagent|belongs to the Developer/i.test(text)).toBe(true);
  });
});
