// tests/assimilate-skill.spec.js
// TASK-136 — originally: the `hivemind-assimilate-skill` skill shipped in BOTH
// locations, byte-identical (the established skills-parity mirror pattern).
//
// TASK-154 — RESCOPED: hivemind-assimilate-skill is now FRAMEWORK-ONLY (same
// two-channel split TASK-153 introduced for hive-self-improve /
// hive-adversarial-improve). It documents the `bin/*.js` vendoring path for
// bringing a skill INTO the hivemind framework itself, which is meaningless in
// a downstream consumer project — so it now lives in .claude/skills/ ONLY,
// deliberately ABSENT from plugin-root skills/. The byte-identity dogfood
// assumption this file encoded no longer holds; this spec is RELAXED to a
// framework-only existence check, mirroring how TASK-153 relaxed the same
// assumption for hive-adversarial-improve / hive-self-improve (see
// tests/plugin-scaffold.spec.js's FRAMEWORK_ONLY_SKILLS channel).
//
// Its consumer-facing counterpart, `assimilate-current-project`, ships in
// plugin-root skills/ ONLY (not dogfooded into .claude/skills/ — same
// -current-project pattern as hive-self-improve-current-project /
// hive-adversarial-improve-current-project). This file also carries a
// dedicated frontmatter/content sensor for that new skill, mirroring the
// depth of coverage this file already gave hivemind-assimilate-skill.
//
// It PASSES NOW: both skills exist on disk in their (post-TASK-154) single
// locations. It is a REGRESSION LOCK — it fails if a future change relocates
// either skill, or drops required frontmatter/guard content.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './helpers/repoRoot.js';

const ASSIMILATE_SKILL_REL = join('hivemind-assimilate-skill', 'SKILL.md');
const PLUGIN_ASSIMILATE_SKILL = join(REPO_ROOT, 'skills', ASSIMILATE_SKILL_REL);
const DEV_ASSIMILATE_SKILL = join(REPO_ROOT, '.claude', 'skills', ASSIMILATE_SKILL_REL);

const CURRENT_PROJECT_SKILL_REL = join('assimilate-current-project', 'SKILL.md');
const PLUGIN_CURRENT_PROJECT_SKILL = join(REPO_ROOT, 'skills', CURRENT_PROJECT_SKILL_REL);
const DEV_CURRENT_PROJECT_SKILL = join(REPO_ROOT, '.claude', 'skills', CURRENT_PROJECT_SKILL_REL);

/** Parse the frontmatter block (text between the first two `---` fences). */
function frontmatterOf(mdText) {
  const m = mdText.match(/^---\s*\n([\s\S]*?)\n---\s*(\n|$)/);
  return m ? m[1] : '';
}

describe('TASK-154 — hivemind-assimilate-skill is FRAMEWORK-ONLY (.claude/skills/ only)', () => {
  it('dev_copy_exists_with_required_frontmatter', () => {
    expect(
      existsSync(DEV_ASSIMILATE_SKILL),
      '.claude/skills/hivemind-assimilate-skill/SKILL.md must exist (framework-only home)',
    ).toBe(true);
    const fm = frontmatterOf(readFileSync(DEV_ASSIMILATE_SKILL, 'utf8'));
    expect(fm.length, 'skill must open with a --- frontmatter block').toBeGreaterThan(0);
    expect(
      /^name:\s*hivemind-assimilate-skill\b/m.test(fm),
      'frontmatter name: must be hivemind-assimilate-skill',
    ).toBe(true);
    expect(
      /^description:\s*\S+/m.test(fm),
      'frontmatter must carry a non-empty description:',
    ).toBe(true);
  });

  it('plugin_root_copy_does_NOT_exist_not_shipped_to_consumers', () => {
    expect(
      existsSync(PLUGIN_ASSIMILATE_SKILL),
      'skills/hivemind-assimilate-skill/SKILL.md must NOT exist (framework-only, never shipped)',
    ).toBe(false);
  });

  it('body_notes_the_current_project_variant_is_the_right_entry_in_a_consumer_project', () => {
    const body = readFileSync(DEV_ASSIMILATE_SKILL, 'utf8');
    expect(
      /assimilate-current-project/.test(body),
      'hivemind-assimilate-skill must reference assimilate-current-project as the consumer-project entry point',
    ).toBe(true);
    expect(
      /isFrameworkRepo/.test(body),
      'hivemind-assimilate-skill must gate on isFrameworkRepo (TASK-152)',
    ).toBe(true);
  });
});

describe('TASK-154 — assimilate-current-project ships at plugin-root skills/ (consumer-shipped)', () => {
  it('plugin_skill_file_exists_with_required_frontmatter', () => {
    expect(
      existsSync(PLUGIN_CURRENT_PROJECT_SKILL),
      'skills/assimilate-current-project/SKILL.md must exist (the plugin-root, consumer-shipped copy)',
    ).toBe(true);
    const fm = frontmatterOf(readFileSync(PLUGIN_CURRENT_PROJECT_SKILL, 'utf8'));
    expect(fm.length, 'skill must open with a --- frontmatter block').toBeGreaterThan(0);
    expect(
      /^name:\s*assimilate-current-project\b/m.test(fm),
      'frontmatter name: must be assimilate-current-project',
    ).toBe(true);
    expect(
      /^description:\s*\S+/m.test(fm),
      'frontmatter must carry a non-empty description:',
    ).toBe(true);
  });

  it('is_NOT_dogfooded_into_dot_claude_skills', () => {
    expect(
      existsSync(DEV_CURRENT_PROJECT_SKILL),
      '.claude/skills/assimilate-current-project/ must NOT exist (framework repo is never "the current project")',
    ).toBe(false);
  });

  it('body_guard_stops_and_points_to_hivemind_assimilate_skill_when_isFrameworkRepo_is_true', () => {
    const body = readFileSync(PLUGIN_CURRENT_PROJECT_SKILL, 'utf8');
    expect(
      /isFrameworkRepo/.test(body),
      'assimilate-current-project must gate on isFrameworkRepo (TASK-152)',
    ).toBe(true);
    expect(
      /hivemind-assimilate-skill/.test(body),
      'assimilate-current-project must point to hivemind-assimilate-skill when run in the framework repo',
    ).toBe(true);
  });

  it('preserves_the_security_invariants_verbatim_in_intent', () => {
    // Default-deny verdict gate, license-is-decision-support-not-safety, and
    // no-auto-adopt-without-human-signoff must all survive the retarget — this
    // is the ticket's hard "preserve every existing security invariant" AC.
    const body = readFileSync(PLUGIN_CURRENT_PROJECT_SKILL, 'utf8');
    expect(/security-reviewer/.test(body), 'must spawn the security-reviewer subagent').toBe(true);
    expect(/'safe'|"safe"|`safe`/.test(body), 'must state the exact-safe default-deny gate').toBe(true);
    expect(
      /decision support/i.test(body),
      'must state license classification is decision support only',
    ).toBe(true);
    expect(
      /human/i.test(body) && /(approve|sign-?off)/i.test(body),
      'must require explicit human approval/sign-off',
    ).toBe(true);
  });
});

describe("TASK-154 — commands/design-pack.md's consumer-facing assimilate step resolves to a shipped skill", () => {
  const DESIGN_PACK_CMD = join(REPO_ROOT, 'commands', 'design-pack.md');

  it('references_assimilate_current_project_not_the_now_framework_only_skill', () => {
    const body = readFileSync(DESIGN_PACK_CMD, 'utf8');
    expect(
      /assimilate-current-project/.test(body),
      'design-pack.md must instruct the human to run assimilate-current-project (the shipped, consumer-facing skill)',
    ).toBe(true);
    expect(
      /hivemind-assimilate-skill/.test(body),
      'design-pack.md must no longer reference the now framework-only hivemind-assimilate-skill',
    ).toBe(false);
  });

  it('the_referenced_skill_actually_ships_at_plugin_root', () => {
    // Closes the loop: the skill design-pack.md points a consumer at must
    // actually exist in the consumer-shipped skills/ tree.
    expect(
      existsSync(PLUGIN_CURRENT_PROJECT_SKILL),
      'skills/assimilate-current-project/SKILL.md must exist for design-pack.md\'s reference to resolve',
    ).toBe(true);
  });
});
