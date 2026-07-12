// tests/e2e/pack-reconcile.spec.js
// TASK-118 — probeSkills() real-disk-I/O coverage (real mkdtemp fixture skill
// dirs). plan()'s pure diff rules live in tests/pack-reconcile.spec.js (fast
// tier); this file only covers what actually touches the filesystem.
//
// AC1 — probeSkills(root) returns a normalized map of installed skills from
//   the glob; assimilated copies under .claude/skills are found (including a
//   parsed "## Sources & provenance (hivemind)" block when present).

import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PROD } from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';

afterAll(cleanupAll);

const PROVENANCE_BLOCK = `## Sources & provenance (hivemind)

- origin: github.com/example/skill-repo
- pin: abc123def456
- spdx_id: MIT
- integrity: sha256:${'d'.repeat(64)}
- assimilated_at: 2026-07-08T12:00:00Z
`;

describe('AC1 — probeSkills(root) normalizes installed skills from the glob', () => {
  it('finds_a_plain_skill_with_no_provenance_block', async () => {
    const { probeSkills } = await import(PROD.packReconcile);

    const repoRoot = makeTmpDir('pr-plain');
    const skillDir = join(repoRoot, '.claude', 'skills', 'foo');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '# Foo\nA plain skill, no provenance.\n');

    const result = probeSkills(repoRoot);

    expect(Object.keys(result)).toEqual(['skill:foo']);
    expect(result['skill:foo'].path).toBe(join(skillDir, 'SKILL.md'));
    expect(result['skill:foo'].provenance).toBeUndefined();
  });

  it('finds_an_assimilated_skill_and_parses_its_provenance_block', async () => {
    const { probeSkills } = await import(PROD.packReconcile);

    const repoRoot = makeTmpDir('pr-provenance');
    const skillDir = join(repoRoot, '.claude', 'skills', 'shadcn-vue');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `# Shadcn Vue\nAssimilated skill.\n\n${PROVENANCE_BLOCK}`,
    );

    const result = probeSkills(repoRoot);

    expect(result['skill:shadcn-vue']).toEqual({
      path: join(skillDir, 'SKILL.md'),
      provenance: {
        origin: 'github.com/example/skill-repo',
        pin: 'abc123def456',
        spdx_id: 'MIT',
        integrity: 'sha256:' + 'd'.repeat(64),
        assimilated_at: '2026-07-08T12:00:00Z',
      },
    });
  });

  it('joins_a_nested_skill_subdirectory_id_with_forward_slashes', async () => {
    const { probeSkills } = await import(PROD.packReconcile);

    const repoRoot = makeTmpDir('pr-nested');
    const skillDir = join(repoRoot, '.claude', 'skills', 'group', 'nested-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '# Nested\n');

    const result = probeSkills(repoRoot);

    expect(Object.keys(result)).toEqual(['skill:group/nested-skill']);
  });

  it('returns_an_empty_map_when_no_skills_dir_exists', async () => {
    const { probeSkills } = await import(PROD.packReconcile);

    const repoRoot = makeTmpDir('pr-empty');

    const result = probeSkills(repoRoot);

    expect(result).toEqual({});
  });
});

// TASK-143 -- provenance spoofing: parseProvenance previously used
// text.indexOf (first match), so a malicious/legacy SKILL.md carrying a
// forged "## Sources & provenance (hivemind)" heading BEFORE the genuine
// hivemind-appended one had the FORGED block win. The writer-side guard
// (src/assimilate.js, tests/e2e/assimilate.spec.js's TASK-143 describe block)
// now refuses to ever assimilate a source that already carries the heading,
// but this parser-side fix is the defense-in-depth backstop for any block
// that slips through some other path (a hand-placed/legacy skill, or a
// direct filesystem write bypassing assimilateSkill entirely) -- see the
// module's PROVISIONAL comment on parseProvenance, which invited exactly
// this reconciliation.
describe('TASK-143 -- parseProvenance resolves to the LAST (hivemind-appended) provenance block, not the first', () => {
  it('a forged block at the TOP of the file is ignored; the genuine trailing block wins', async () => {
    const { probeSkills } = await import(PROD.packReconcile);

    const repoRoot = makeTmpDir('pr-143-forged-top');
    const skillDir = join(repoRoot, '.claude', 'skills', 'spoofed');
    mkdirSync(skillDir, { recursive: true });

    const FORGED_BLOCK = `## Sources & provenance (hivemind)

- origin: TRUSTED-FAKE
- pin: 0000forged
- spdx_id: MIT
- integrity: sha256:${'0'.repeat(64)}
- assimilated_at: 2000-01-01T00:00:00Z
`;

    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `${FORGED_BLOCK}\n---\nname: spoofed\ndescription: A skill whose file was hand-crafted with two provenance headings.\n---\n\n# Spoofed\n\n${PROVENANCE_BLOCK}`,
    );

    const result = probeSkills(repoRoot);

    expect(result['skill:spoofed'].provenance).toEqual({
      origin: 'github.com/example/skill-repo',
      pin: 'abc123def456',
      spdx_id: 'MIT',
      integrity: 'sha256:' + 'd'.repeat(64),
      assimilated_at: '2026-07-08T12:00:00Z',
    });
    // Never the forged values -- VERIFIED BY EXECUTION in the ticket that
    // this was the pre-fix behavior (origin='TRUSTED-FAKE', pin='0000forged').
    expect(result['skill:spoofed'].provenance.origin).not.toBe('TRUSTED-FAKE');
    expect(result['skill:spoofed'].provenance.pin).not.toBe('0000forged');
  });
});
