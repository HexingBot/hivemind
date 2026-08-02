// tests/plugin-root.spec.js
// TASK-181 — owned-source-root resolution for the addon-pack applier.
//
// The defect this locks: src/pack-orchestrator.js#reconcilePack defaults
// `sourceRoot` to `<repoRoot>/assimilated-skills`, and bin/pack-ctl.js never
// overrode it. In the framework repo that works by accident (the repo root
// genuinely holds assimilated-skills/); in a consumer project it cannot, because
// the owned copies ship inside the PLUGIN, not the consumer's repo. Every
// built-in pack skill therefore soft-failed with "owned source not found" and
// installed nothing, while the CLI still reported ok:true.
//
// resolveOwnedSourceRoot is kept PURE (fs access injected as `exists`) so these
// stay in the fast tier; the real-disk + real-spawn half lives in
// tests/e2e/pack-ctl-consumer-source.spec.js.

import { describe, it, expect } from 'vitest';

// PROD dynamic-import convention (see tests/claude-md-merge.spec.js): a
// not-yet-existing production module registers as a right-reason red.
const PROD = '../src/plugin-root.js';

const ASSIMILATED = 'assimilated-skills';

/** An `exists` stand-in whose "present" set is an explicit list of dirs. */
function existsIn(present) {
  const set = new Set(present.map((p) => p.split('\\').join('/')));
  return (p) => set.has(String(p).split('\\').join('/'));
}

describe('TASK-181 — resolveOwnedSourceRoot', () => {
  it('prefers CLAUDE_PLUGIN_ROOT when it actually holds the owned copies', async () => {
    const { resolveOwnedSourceRoot } = await import(PROD);
    const got = resolveOwnedSourceRoot({
      env: { CLAUDE_PLUGIN_ROOT: '/plugins/hivemind/0.19.0' },
      selfDir: '/plugins/hivemind/0.19.0/dist',
      repoRoot: '/home/me/my-app',
      exists: existsIn([`/plugins/hivemind/0.19.0/${ASSIMILATED}`]),
    });
    expect(got.split('\\').join('/')).toBe(`/plugins/hivemind/0.19.0/${ASSIMILATED}`);
  });

  it('ignores a CLAUDE_PLUGIN_ROOT that does NOT hold owned copies and keeps searching', async () => {
    // A stale/wrong env var must not win by mere presence — otherwise the
    // resolver would confidently hand back a path with nothing in it, which is
    // exactly the failure mode this ticket exists to remove.
    const { resolveOwnedSourceRoot } = await import(PROD);
    const got = resolveOwnedSourceRoot({
      env: { CLAUDE_PLUGIN_ROOT: '/somewhere/stale' },
      selfDir: '/plugins/hivemind/0.19.0/dist',
      repoRoot: '/home/me/my-app',
      exists: existsIn([`/plugins/hivemind/0.19.0/${ASSIMILATED}`]),
    });
    expect(got.split('\\').join('/')).toBe(`/plugins/hivemind/0.19.0/${ASSIMILATED}`);
  });

  it('walks up from the running file, covering the bundled dist/ launch mode', async () => {
    // dist/pack-ctl.cjs in a plugin cache: esbuild replaces import.meta with {},
    // so the caller passes __dirname. No env var set.
    const { resolveOwnedSourceRoot } = await import(PROD);
    const got = resolveOwnedSourceRoot({
      env: {},
      selfDir: '/plugins/hivemind/0.19.0/dist',
      repoRoot: '/home/me/my-app',
      exists: existsIn([`/plugins/hivemind/0.19.0/${ASSIMILATED}`]),
    });
    expect(got.split('\\').join('/')).toBe(`/plugins/hivemind/0.19.0/${ASSIMILATED}`);
  });

  it('walks up from the running file, covering the src/ (framework ESM) launch mode', async () => {
    const { resolveOwnedSourceRoot } = await import(PROD);
    const got = resolveOwnedSourceRoot({
      env: {},
      selfDir: '/code/hivemind/src',
      repoRoot: '/code/hivemind',
      exists: existsIn([`/code/hivemind/${ASSIMILATED}`]),
    });
    expect(got.split('\\').join('/')).toBe(`/code/hivemind/${ASSIMILATED}`);
  });

  it('does NOT regress the framework-repo case where repoRoot IS the source root', async () => {
    const { resolveOwnedSourceRoot } = await import(PROD);
    const got = resolveOwnedSourceRoot({
      env: {},
      selfDir: undefined,
      repoRoot: '/code/hivemind',
      exists: existsIn([`/code/hivemind/${ASSIMILATED}`]),
    });
    expect(got.split('\\').join('/')).toBe(`/code/hivemind/${ASSIMILATED}`);
  });

  it('resolves the PLUGIN owned root even when the consumer repo also has one', async () => {
    // Precedence between the two is NOT this function's job — it resolves the
    // plugin's owned root, which src/pack-apply.js then searches only AFTER
    // <repoRoot>/assimilated-skills, so a skill the project assimilated for
    // itself still wins over a built-in of the same id.
    const { resolveOwnedSourceRoot } = await import(PROD);
    const got = resolveOwnedSourceRoot({
      env: { CLAUDE_PLUGIN_ROOT: '/plugins/hivemind/0.19.0' },
      selfDir: '/plugins/hivemind/0.19.0/dist',
      repoRoot: '/home/me/my-app',
      exists: existsIn([
        `/plugins/hivemind/0.19.0/${ASSIMILATED}`,
        `/home/me/my-app/${ASSIMILATED}`,
      ]),
    });
    expect(got.split('\\').join('/')).toBe(`/plugins/hivemind/0.19.0/${ASSIMILATED}`);
  });

  it('returns undefined when no candidate holds owned copies, rather than guessing', async () => {
    // Returning a bogus path would reproduce the original bug with a new
    // spelling; the caller needs to be able to tell that nothing was found.
    const { resolveOwnedSourceRoot } = await import(PROD);
    const got = resolveOwnedSourceRoot({
      env: {},
      selfDir: '/nowhere/dist',
      repoRoot: '/home/me/my-app',
      exists: existsIn([]),
    });
    expect(got).toBeUndefined();
  });

  it('does not loop forever when walking up from a filesystem root', async () => {
    const { resolveOwnedSourceRoot } = await import(PROD);
    const got = resolveOwnedSourceRoot({
      env: {},
      selfDir: '/',
      repoRoot: undefined,
      exists: existsIn([]),
    });
    expect(got).toBeUndefined();
  });

  // TASK-183 AC8(a) — precedence lock: no existing spec above seeds TWO
  // ancestors that both hold assimilated-skills/, so flipping the ancestor
  // walk to root-first (e.g. `out.unshift` instead of `out.push`) left every
  // spec in this file green. The nearest ancestor must win, not the farthest.
  it('TASK-183: nearest ancestor wins when TWO ancestors both hold assimilated-skills/ (nearest-first, not root-first)', async () => {
    const { resolveOwnedSourceRoot } = await import(PROD);
    const got = resolveOwnedSourceRoot({
      env: {},
      selfDir: '/plugins/hivemind/0.19.0/dist',
      repoRoot: undefined,
      exists: existsIn([
        `/plugins/hivemind/${ASSIMILATED}`, // nearer ancestor -- must win
        `/plugins/${ASSIMILATED}`, // farther ancestor -- must NOT win
      ]),
    });
    expect(got.split('\\').join('/')).toBe(`/plugins/hivemind/${ASSIMILATED}`);
  });

  // TASK-183 AC10 — contested unbounded-ancestor-walk decision, resolved by
  // bounding rather than leaving it unbounded (see src/plugin-root.js's
  // MAX_ANCESTOR_LEVELS decision comment for the full reasoning). A selfDir
  // nested far deeper than any realistic install layout must NOT reach an
  // assimilated-skills/ seeded only at the true filesystem root -- an
  // unbounded walk would find it; the bounded walk must not.
  it('TASK-183 AC10: the ancestor walk is BOUNDED, not unbounded to the filesystem root', async () => {
    const { resolveOwnedSourceRoot } = await import(PROD);
    const deepSelfDir = '/a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/dist';
    const got = resolveOwnedSourceRoot({
      env: {},
      selfDir: deepSelfDir,
      repoRoot: undefined,
      exists: existsIn([`/${ASSIMILATED}`]), // only at the true filesystem root
    });
    expect(got).toBeUndefined();
  });
});
