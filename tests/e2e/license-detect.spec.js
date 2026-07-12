// tests/e2e/license-detect.spec.js
// TASK-117 AC4 -- detectLicense's file-based fallback chain (real disk I/O via
// makeTmpDir): SPDX header -> LICENSE file (skill subdir before repo root) ->
// package.json -> README "License" section. Maps docs/design/addon-packs-plan.md §12.

import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';
import { detectLicense, classifyLicense } from '../../src/license-detect.js';

afterAll(cleanupAll);

function skeleton(label) {
  const repoRoot = makeTmpDir(label);
  const skillDir = join(repoRoot, 'skills', 'my-skill');
  mkdirSync(skillDir, { recursive: true });
  return { repoRoot, skillDir };
}

describe('detectLicense -- SPDX header step conflicts with a disagreeing LICENSE file (TASK-150 spoof surfacing)', () => {
  it('keeps the header as spdx_id/detected_via (backward-compat) but now surfaces a conflict with a disagreeing repo-root LICENSE', async () => {
    const { repoRoot, skillDir } = skeleton('lic-header');
    writeFileSync(join(repoRoot, 'LICENSE'), 'Apache License\nVersion 2.0, January 2004\n');
    writeFileSync(join(skillDir, 'SKILL.md'), '<!-- SPDX-License-Identifier: MIT -->\n# My Skill\n');

    const result = await detectLicense({ skillDir, repoRoot });
    expect(result.spdx_id).toBe('MIT');
    expect(result.detected_via).toBe('spdx-header');
    expect(result.source_path).toBe(join(skillDir, 'SKILL.md'));
    // TASK-150: before the fix this returned only the 4 base keys (a clean,
    // unconflicted MIT verdict). The repo-root LICENSE disagrees (Apache-2.0),
    // so the fix must now surface a `conflict` field.
    expect(Object.keys(result).sort()).toEqual(['checked_at', 'conflict', 'detected_via', 'source_path', 'spdx_id']);
    expect(result.conflict).toEqual({
      header_spdx: 'MIT',
      header_source_path: join(skillDir, 'SKILL.md'),
      license_file_spdx: 'Apache-2.0',
      license_file_source_path: join(repoRoot, 'LICENSE'),
    });
  });
});

describe('detectLicense -- TASK-150 AC1 red inject: forged in-source SPDX header vs. the skill\'s own real copyleft LICENSE', () => {
  it('surfaces the conflict instead of a clean permissive verdict', async () => {
    const { repoRoot, skillDir } = skeleton('lic-spoof');
    // A forged MIT header lives in a source file the skill ships...
    writeFileSync(join(skillDir, 'helper.js'), '// SPDX-License-Identifier: MIT\nmodule.exports = {};\n');
    // ...while the skill's REAL LICENSE file is GPL-3.0.
    writeFileSync(
      join(skillDir, 'LICENSE'),
      'GNU GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007\n\nCopyright (C) 2026 Example Author\n',
    );

    const result = await detectLicense({ skillDir, repoRoot });

    // Header still resolves spdx_id/detected_via (additive fix, not a
    // behavior swap) -- classifyLicense(result.spdx_id) alone would still say
    // 'permissive', which is exactly the false-clean signal this ticket is
    // about. The fix pairs it with a conflict field naming the real,
    // more-restrictive LICENSE-file classification so the approval package
    // can no longer present a clean permissive verdict for this skill.
    expect(result.spdx_id).toBe('MIT');
    expect(result.detected_via).toBe('spdx-header');
    expect(classifyLicense(result.spdx_id)).toBe('permissive');

    expect(result.conflict).toEqual({
      header_spdx: 'MIT',
      header_source_path: join(skillDir, 'helper.js'),
      license_file_spdx: 'GPL-3.0-only',
      license_file_source_path: join(skillDir, 'LICENSE'),
    });
    expect(classifyLicense(result.conflict.license_file_spdx)).toBe('copyleft');
  });
});

describe('detectLicense -- TASK-150 AC2 no-conflict fast paths (unchanged behavior)', () => {
  it('header-only, no LICENSE file anywhere: still classifies from the header, no conflict field', async () => {
    const { repoRoot, skillDir } = skeleton('lic-header-only');
    writeFileSync(join(skillDir, 'SKILL.md'), '<!-- SPDX-License-Identifier: MIT -->\n# My Skill\n');

    const result = await detectLicense({ skillDir, repoRoot });
    expect(result.spdx_id).toBe('MIT');
    expect(result.detected_via).toBe('spdx-header');
    expect(result.conflict).toBeUndefined();
    expect(Object.keys(result).sort()).toEqual(['checked_at', 'detected_via', 'source_path', 'spdx_id']);
  });

  it('LICENSE-only, no header: still classifies from the LICENSE file, no conflict field', async () => {
    const { repoRoot, skillDir } = skeleton('lic-license-only');
    writeFileSync(join(skillDir, 'LICENSE'), 'MIT License\n\nCopyright (c) 2026 Acme\n');
    writeFileSync(join(skillDir, 'SKILL.md'), '# My Skill\nno header here\n');

    const result = await detectLicense({ skillDir, repoRoot });
    expect(result.spdx_id).toBe('MIT');
    expect(result.detected_via).toBe('license-file');
    expect(result.conflict).toBeUndefined();
  });

  it('header and LICENSE agree: same result as before, no conflict field', async () => {
    const { repoRoot, skillDir } = skeleton('lic-agree');
    writeFileSync(join(skillDir, 'LICENSE'), 'MIT License\n\nCopyright (c) 2026 Acme\n');
    writeFileSync(join(skillDir, 'SKILL.md'), '<!-- SPDX-License-Identifier: MIT -->\n# My Skill\n');

    const result = await detectLicense({ skillDir, repoRoot });
    expect(result.spdx_id).toBe('MIT');
    expect(result.detected_via).toBe('spdx-header');
    expect(result.source_path).toBe(join(skillDir, 'SKILL.md'));
    expect(result.conflict).toBeUndefined();
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
