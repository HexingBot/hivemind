// tests/preview-resolver.spec.js
// TASK-065 — Fast-tier (pure-logic) spec for src/preview-resolver.js.
//
// ACs covered here:
//   AC1 — module exports resolvePreviewConfig function with the correct signature.
//
// Design note: resolvePreviewConfig({repoRoot}) requires real disk access to read
// PROJECT.md and package.json — it has no injectable pure-logic seam. The full
// behavioral tests (configured > inferred > none precedence, mode derivation, port
// heuristic, backward-compat) live in tests/e2e/preview-resolver.spec.js (slow tier).
// This fast-tier spec is intentionally minimal: it asserts the export shape and
// confirms the module fails for the right reason (missing file, not typo/parse error)
// when the function is invoked without a real repo root.
//
// All tests MUST FAIL with "Cannot find module …preview-resolver.js" until
// src/preview-resolver.js is created in the IMPL phase.

import { describe, it, expect } from 'vitest';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ---------------------------------------------------------------------------
// Resolve the production module via file URL — same pattern used by
// tests/operating-mode.spec.js and tests/helpers/fixtures.js PROD map.
// Dynamic import means the whole suite fails at collection time with
// "Cannot find module" — the correct RED state for TEST mode.
// ---------------------------------------------------------------------------
const __thisDir = dirname(fileURLToPath(import.meta.url));
const __srcDir = join(__thisDir, '..', 'src');
const PREVIEW_RESOLVER_URL = pathToFileURL(join(__srcDir, 'preview-resolver.js')).href;

// ---------------------------------------------------------------------------
// AC1 — the module must export resolvePreviewConfig as a function.
// ---------------------------------------------------------------------------
describe('AC1 — preview-resolver module exports resolvePreviewConfig', () => {
  it('module exports resolvePreviewConfig as a function', async () => {
    const mod = await import(PREVIEW_RESOLVER_URL);
    expect(typeof mod.resolvePreviewConfig).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// AC1 — resolvePreviewConfig({repoRoot}) rejects when repoRoot has no
// PROJECT.md AND no package.json rather than throwing an unhandled error.
// This confirms the "no-throw on none" contract (AC4) is enforced at the
// module level: even a wholly absent repo returns {mode:'none',source:'none'}.
// This test requires a path that exists on disk as a directory but has no
// PROJECT.md and no package.json; we use os.tmpdir() which always exists.
// ---------------------------------------------------------------------------
describe('AC4 — resolvePreviewConfig returns {mode:none,source:none} for empty dir (no throw)', () => {
  it('returns mode=none, source=none for a dir with no PROJECT.md and no package.json', async () => {
    const { resolvePreviewConfig } = await import(PREVIEW_RESOLVER_URL);
    const { tmpdir } = await import('node:os');
    // Use a guaranteed-existing dir that has neither PROJECT.md nor package.json.
    // (If tmpdir itself happened to have them in some exotic env, the test would
    // fail for the wrong reason — acceptable given the probability.)
    const result = await resolvePreviewConfig({ repoRoot: tmpdir() });
    expect(result.mode).toBe('none');
    expect(result.source).toBe('none');
    // command and url must be null when there is nothing to resolve.
    expect(result.command).toBeNull();
    expect(result.url).toBeNull();
  });
});
