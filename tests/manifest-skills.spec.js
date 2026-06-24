// tests/manifest-skills.spec.js
// Phase 3 (P3.2) — the six vendored manifest skills ship in BOTH skills/<name>/ (plugin
// root) and .claude/skills/<name>/ (live dev mirror), byte-identical, each with name +
// description frontmatter. Mirrors the established skills-parity pattern (graphify, mcp-server).
// The skill set is cross-checked against the manifest-policy catalog so the two never drift.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './helpers/repoRoot.js';
import { MANIFESTS } from '../src/manifest-policy.js';

const SKILLS = MANIFESTS.map((m) => m.skill); // impl-screen-specs, ...

function frontmatterOf(md) {
  const m = md.match(/^---\s*\n([\s\S]*?)\n---\s*(\n|$)/);
  return m ? m[1] : '';
}

describe('P3.2 — vendored manifest skills', () => {
  it('the policy catalog names exactly the six manifest skills', () => {
    expect(SKILLS).toHaveLength(6);
    expect(SKILLS).toEqual(expect.arrayContaining([
      'impl-screen-specs', 'impl-api-contracts', 'impl-state-schemas',
      'impl-component-catalog', 'impl-project-structure', 'impl-block-tasks',
    ]));
  });

  it.each(SKILLS)('%s ships at the plugin root and the dev mirror, byte-identical', (skill) => {
    const plugin = join(REPO_ROOT, 'skills', skill, 'SKILL.md');
    const dev = join(REPO_ROOT, '.claude', 'skills', skill, 'SKILL.md');
    expect(existsSync(plugin), `${plugin} must exist`).toBe(true);
    expect(existsSync(dev), `${dev} must exist`).toBe(true);
    expect(readFileSync(plugin, 'utf8')).toBe(readFileSync(dev, 'utf8'));
  });

  it.each(SKILLS)('%s opens with frontmatter carrying its name + a description', (skill) => {
    const fm = frontmatterOf(readFileSync(join(REPO_ROOT, 'skills', skill, 'SKILL.md'), 'utf8'));
    expect(new RegExp(`^name:\\s*${skill}\\b`, 'm').test(fm), `name: ${skill}`).toBe(true);
    expect(/^description:\s*\S+/m.test(fm), 'non-empty description:').toBe(true);
  });

  it.each(SKILLS)('%s states the verification_tier gate', (skill) => {
    const md = readFileSync(join(REPO_ROOT, 'skills', skill, 'SKILL.md'), 'utf8');
    expect(/verification_tier|manifest-policy/.test(md)).toBe(true);
  });
});
