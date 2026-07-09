// tests/assimilate-skill.spec.js
// TASK-136 — the `hivemind-assimilate-skill` skill ships in BOTH locations,
// byte-identical (the established skills-parity mirror pattern).
//
// The hivemind-assimilate-skill skill operationalizes the third-party-skill
// adoption protocol (docs/design/addon-packs.md §4/§7, addon-packs-plan.md
// §7/§12) and is placed in BOTH skills/hivemind-assimilate-skill/ (plugin
// root, distributed) and .claude/skills/hivemind-assimilate-skill/ (live dev
// mirror), with byte-identical SKILL.md (mirroring graphify, mcp-server,
// orchestrator-routing). This spec is the drift-guard AC4/AC5 call for,
// mirroring tests/graphify-skill.spec.js exactly.
//
// It PASSES NOW: both skill copies already exist on disk. It is a REGRESSION
// LOCK — it fails only if a future change lets the two copies drift, or
// deletes one.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './helpers/repoRoot.js';

const SKILL_REL = join('hivemind-assimilate-skill', 'SKILL.md');
const PLUGIN_SKILL = join(REPO_ROOT, 'skills', SKILL_REL);
const DEV_SKILL = join(REPO_ROOT, '.claude', 'skills', SKILL_REL);

/** Parse the frontmatter block (text between the first two `---` fences). */
function frontmatterOf(mdText) {
  const m = mdText.match(/^---\s*\n([\s\S]*?)\n---\s*(\n|$)/);
  return m ? m[1] : '';
}

describe('TASK-136 — hivemind-assimilate-skill ships at the plugin root', () => {
  it('plugin_skill_file_exists', () => {
    expect(
      existsSync(PLUGIN_SKILL),
      'skills/hivemind-assimilate-skill/SKILL.md must exist (the plugin-root copy)',
    ).toBe(true);
  });

  it('skill_opens_with_frontmatter_carrying_name_and_description', () => {
    expect(existsSync(PLUGIN_SKILL)).toBe(true);
    const fm = frontmatterOf(readFileSync(PLUGIN_SKILL, 'utf8'));
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
});

describe('TASK-136 — hivemind-assimilate-skill is mirrored into .claude/skills (parity)', () => {
  it('dev_copy_exists', () => {
    expect(
      existsSync(DEV_SKILL),
      '.claude/skills/hivemind-assimilate-skill/SKILL.md must mirror the plugin copy',
    ).toBe(true);
  });

  it('plugin_and_dev_skill_md_are_byte_identical', () => {
    expect(existsSync(PLUGIN_SKILL), 'plugin skill must exist').toBe(true);
    expect(existsSync(DEV_SKILL), 'dev skill must exist').toBe(true);
    const pluginBytes = readFileSync(PLUGIN_SKILL);
    const devBytes = readFileSync(DEV_SKILL);
    expect(
      pluginBytes.equals(devBytes),
      'skills/hivemind-assimilate-skill/SKILL.md must be byte-identical to the .claude/skills copy',
    ).toBe(true);
  });
});
