// tests/e2e/license-detect.spec.js
// TASK-117 AC4 -- detectLicense's file-based fallback chain (real disk I/O via
// makeTmpDir): SPDX header -> LICENSE file (skill subdir before repo root) ->
// package.json -> README "License" section. Maps docs/design/addon-packs-plan.md §12.

import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';
import { detectLicense } from '../../src/license-detect.js';

afterAll(cleanupAll);

function skeleton(label) {
  const repoRoot = makeTmpDir(label);
  const skillDir = join(repoRoot, 'skills', 'my-skill');
  mkdirSync(skillDir, { recursive: true });
  return { repoRoot, skillDir };
}

describe('detectLicense -- SPDX header step (wins over repo-root LICENSE)', () => {
  it('finds a header in the skill\'s own file and stops there', async () => {
    const { repoRoot, skillDir } = skeleton('lic-header');
    writeFileSync(join(repoRoot, 'LICENSE'), 'Apache License\nVersion 2.0, January 2004\n');
    writeFileSync(join(skillDir, 'SKILL.md'), '<!-- SPDX-License-Identifier: MIT -->\n# My Skill\n');

    const result = await detectLicense({ skillDir, repoRoot });
    expect(result.spdx_id).toBe('MIT');
    expect(result.detected_via).toBe('spdx-header');
    expect(result.source_path).toBe(join(skillDir, 'SKILL.md'));
    expect(Object.keys(result).sort()).toEqual(['checked_at', 'detected_via', 'source_path', 'spdx_id']);
  });
});

describe('detectLicense -- LICENSE file step (nearest-enclosing wins)', () => {
  it('falls back to repo-root LICENSE when the skill has no header or LICENSE', async () => {
    const { repoRoot, skillDir } = skeleton('lic-root');
    writeFileSync(join(repoRoot, 'LICENSE'), 'MIT License\n\nCopyright (c) 2026 Acme\n');
    writeFileSync(join(skillDir, 'SKILL.md'), '# My Skill\nno header here\n');

    const result = await detectLicense({ skillDir, repoRoot });
    expect(result.spdx_id).toBe('MIT');
    expect(result.detected_via).toBe('license-file');
    expect(result.source_path).toBe(join(repoRoot, 'LICENSE'));
  });

  it('prefers the skill subdirectory\'s own LICENSE over the repo root\'s', async () => {
    const { repoRoot, skillDir } = skeleton('lic-nearest');
    writeFileSync(join(repoRoot, 'LICENSE'), 'MIT License\n\nCopyright (c) 2026 Acme\n');
    writeFileSync(
      join(skillDir, 'LICENSE'),
      'GNU GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007\n',
    );

    const result = await detectLicense({ skillDir, repoRoot });
    expect(result.spdx_id).toBe('GPL-3.0-only');
    expect(result.detected_via).toBe('license-file');
    expect(result.source_path).toBe(join(skillDir, 'LICENSE'));
  });
});

describe('detectLicense -- package.json step', () => {
  it('reads the `license` field when no header or LICENSE file exists', async () => {
    const { repoRoot, skillDir } = skeleton('lic-pkg');
    writeFileSync(join(repoRoot, 'package.json'), JSON.stringify({ name: 'acme-widgets', license: 'ISC' }));
    writeFileSync(join(skillDir, 'SKILL.md'), '# My Skill\n');

    const result = await detectLicense({ skillDir, repoRoot });
    expect(result.spdx_id).toBe('ISC');
    expect(result.detected_via).toBe('package.json');
    expect(result.source_path).toBe(join(repoRoot, 'package.json'));
  });
});

describe('detectLicense -- README "License" section step', () => {
  it('extracts the license from a README section as the last resort before none', async () => {
    const { repoRoot, skillDir } = skeleton('lic-readme');
    writeFileSync(
      join(repoRoot, 'README.md'),
      '# Widgets\n\nSome docs.\n\n## License\n\nThis project is licensed under the MIT License.\n',
    );
    writeFileSync(join(skillDir, 'SKILL.md'), '# My Skill\n');

    const result = await detectLicense({ skillDir, repoRoot });
    expect(result.spdx_id).toBe('MIT');
    expect(result.detected_via).toBe('readme');
    expect(result.source_path).toBe(join(repoRoot, 'README.md'));
  });
});

describe('detectLicense -- none found', () => {
  it('returns spdx_id=null / detected_via=none when nothing matches anywhere in the chain', async () => {
    const { repoRoot, skillDir } = skeleton('lic-none');
    writeFileSync(join(skillDir, 'SKILL.md'), '# My Skill\nnothing to see here\n');

    const result = await detectLicense({ skillDir, repoRoot });
    expect(result.spdx_id).toBeNull();
    expect(result.detected_via).toBe('none');
    expect(result.source_path).toBeNull();
  });
});
