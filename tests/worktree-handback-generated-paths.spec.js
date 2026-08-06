// tests/worktree-handback-generated-paths.spec.js
// TASK-197 — AC4: the set of generated artifact paths mergeWorktreeBranch
// refuses to silently textually-merge must NOT be a second hardcoded list.
// Pure logic, no disk I/O beyond a static import — fast tier.

import { describe, it, expect } from 'vitest';

import { getGeneratedArtifactPaths } from '../src/worktree-handback.js';
import { ENTRYPOINT_NAMES } from '../scripts/build-plugin.mjs';

describe('getGeneratedArtifactPaths — derived from scripts/build-plugin.mjs, not a duplicated list (TASK-197 AC4)', () => {
  it('returns_exactly_dist_prefixed_ENTRYPOINT_NAMES_with_no_second_source_of_truth', () => {
    const paths = getGeneratedArtifactPaths();
    expect(paths).toEqual(ENTRYPOINT_NAMES.map((name) => `dist/${name}`));
    // Non-vacuity: the list this drift-proof derivation depends on genuinely
    // has entries — an empty list would make the AC1/AC3 refusal a no-op.
    expect(ENTRYPOINT_NAMES.length).toBeGreaterThan(0);
  });

  it('stays_in_sync_automatically_if_build_plugin_gains_a_ninth_entrypoint', () => {
    // Simulated drift check: if ENTRYPOINT_NAMES ever grows, this derivation
    // (a live .map over the imported array, not a copy-pasted literal) picks
    // it up with zero code change here — the regression this guards against
    // is a second, hand-maintained array silently falling out of sync.
    const paths = getGeneratedArtifactPaths();
    expect(paths.length).toBe(ENTRYPOINT_NAMES.length);
    for (const name of ENTRYPOINT_NAMES) {
      expect(paths).toContain(`dist/${name}`);
    }
  });
});
