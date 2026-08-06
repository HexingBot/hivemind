// tests/worktree-handback-generated-paths.spec.js
// TASK-197 — AC4: the set of generated artifact paths mergeWorktreeBranch
// refuses to silently textually-merge must NOT be a second hardcoded list.
// Pure logic, no disk I/O beyond a static import — fast tier.
//
// Imports scripts/entrypoint-names.mjs directly (TASK-197 fix round,
// MEDIUM-2) — the data-only module getGeneratedArtifactPaths itself depends
// on, not scripts/build-plugin.mjs (which pulls in esbuild).

import { describe, it, expect } from 'vitest';

import { getGeneratedArtifactPaths } from '../src/worktree-handback.js';
import { ENTRYPOINT_NAMES } from '../scripts/entrypoint-names.mjs';

describe('getGeneratedArtifactPaths — derived from scripts/entrypoint-names.mjs, not a duplicated list (TASK-197 AC4)', () => {
  it('returns_exactly_dist_prefixed_ENTRYPOINT_NAMES_with_no_second_source_of_truth', () => {
    const paths = getGeneratedArtifactPaths();
    // toEqual asserts deep equality INCLUDING order and length, which already
    // entails both "same count" and "every name present" — a separate test
    // for either would be pure new-test-budget redundancy (TASK-197 fix
    // round, LOW-1: a prior version had one; removed).
    expect(paths).toEqual(ENTRYPOINT_NAMES.map((name) => `dist/${name}`));
    // Non-vacuity: the list this drift-proof derivation depends on genuinely
    // has entries — an empty list would make the AC1/AC3 refusal a no-op.
    expect(ENTRYPOINT_NAMES.length).toBeGreaterThan(0);
  });
});
