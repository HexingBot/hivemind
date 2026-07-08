// tests/license-detect.spec.js
// TASK-117 AC1-AC3, AC5 -- pure normalize/classify + the injected GitHub-API stub
// branch of detectLicense (no real network, so it stays in the fast tier).
// Maps docs/design/addon-packs-plan.md §12.

import { describe, it, expect } from 'vitest';
import { normalizeLicenseString, classifyLicense, detectLicense } from '../src/license-detect.js';

describe('normalizeLicenseString', () => {
  it('maps common spellings to canonical SPDX ids', () => {
    expect(normalizeLicenseString('MIT License')).toBe('MIT');
    expect(normalizeLicenseString('Apache 2.0')).toBe('Apache-2.0');
    expect(normalizeLicenseString('Apache License 2.0')).toBe('Apache-2.0');
  });

  it('maps deprecated GPL/LGPL/AGPL aliases to canonical -only ids', () => {
    expect(normalizeLicenseString('GPL-2.0')).toBe('GPL-2.0-only');
    expect(normalizeLicenseString('GPL-3.0')).toBe('GPL-3.0-only');
    expect(normalizeLicenseString('LGPL-2.1')).toBe('LGPL-2.1-only');
    expect(normalizeLicenseString('AGPL-3.0')).toBe('AGPL-3.0-only');
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(normalizeLicenseString('  mit  ')).toBe('MIT');
    expect(normalizeLicenseString('apache-2.0')).toBe('Apache-2.0');
  });

  it('passes unrecognized strings through unchanged (trimmed)', () => {
    expect(normalizeLicenseString('MPL-2.0')).toBe('MPL-2.0');
    expect(normalizeLicenseString('  LicenseRef-Custom  ')).toBe('LicenseRef-Custom');
  });

  it('returns null for nullish/empty input', () => {
    expect(normalizeLicenseString(null)).toBeNull();
    expect(normalizeLicenseString(undefined)).toBeNull();
    expect(normalizeLicenseString('')).toBeNull();
    expect(normalizeLicenseString('   ')).toBeNull();
  });
});

describe('classifyLicense', () => {
  it('classifies the permissive allowlist as permissive', () => {
    for (const id of ['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'CC0-1.0', 'Unlicense', '0BSD']) {
      expect(classifyLicense(id), id).toBe('permissive');
    }
  });

  it('classifies GPL/AGPL/LGPL families (both -only and -or-later) as copyleft', () => {
    for (const id of [
      'GPL-2.0-only', 'GPL-2.0-or-later', 'GPL-3.0-only', 'GPL-3.0-or-later',
      'LGPL-2.1-only', 'LGPL-2.1-or-later', 'LGPL-3.0-only', 'LGPL-3.0-or-later',
      'AGPL-3.0-only', 'AGPL-3.0-or-later',
    ]) {
      expect(classifyLicense(id), id).toBe('copyleft');
    }
  });

  it('classifies deprecated GPL/AGPL aliases as copyleft too', () => {
    expect(classifyLicense('GPL-2.0')).toBe('copyleft');
    expect(classifyLicense('AGPL-3.0')).toBe('copyleft');
  });

  it('classifies everything else as unknown -- an allowlist for permissive, not a denylist', () => {
    expect(classifyLicense('MPL-2.0')).toBe('unknown');
    expect(classifyLicense('LicenseRef-Custom')).toBe('unknown');
    expect(classifyLicense(null)).toBe('unknown');
  });
});

describe('classifyLicense -- compound expressions', () => {
  it('OR classifies permissive if any disjunct is permissive', () => {
    expect(classifyLicense('MIT OR Apache-2.0')).toBe('permissive');
    expect(classifyLicense('GPL-3.0-only OR MIT')).toBe('permissive');
  });

  it('AND classifies copyleft/gate when any conjunct is copyleft', () => {
    expect(classifyLicense('MIT AND GPL-3.0-only')).toBe('copyleft');
  });
});

describe('detectLicense -- GitHub API branch (injected stub, no network)', () => {
  it('uses the GitHub Licenses API result when no earlier signal is available', async () => {
    const result = await detectLicense({
      github: { owner: 'acme', repo: 'widgets' },
      fetchGithubLicense: async () => ({ license: { spdx_id: 'MIT' } }),
    });
    expect(result.spdx_id).toBe('MIT');
    expect(result.detected_via).toBe('github-api');
  });

  it('treats 404 (null), "other", and "NOASSERTION" as no signal, not a match', async () => {
    for (const body of [null, { license: { spdx_id: 'other' } }, { license: { spdx_id: 'NOASSERTION' } }]) {
      const result = await detectLicense({
        github: { owner: 'acme', repo: 'widgets' },
        fetchGithubLicense: async () => body,
      });
      expect(result.detected_via, JSON.stringify(body)).toBe('none');
      expect(result.spdx_id, JSON.stringify(body)).toBeNull();
    }
  });

  it('skips the API step entirely when no fetcher is injected (never hits the network)', async () => {
    const result = await detectLicense({ github: { owner: 'acme', repo: 'widgets' } });
    expect(result.detected_via).toBe('none');
    expect(result.spdx_id).toBeNull();
  });
});

describe('detectLicense -- none found', () => {
  it('returns spdx_id=null classified unknown, never permissive, with the full result shape', async () => {
    const result = await detectLicense({});
    expect(result.spdx_id).toBeNull();
    expect(result.detected_via).toBe('none');
    expect(result.source_path).toBeNull();
    expect(typeof result.checked_at).toBe('string');
    expect(Object.keys(result).sort()).toEqual(['checked_at', 'detected_via', 'source_path', 'spdx_id']);
    expect(classifyLicense(result.spdx_id)).toBe('unknown');
  });
});
