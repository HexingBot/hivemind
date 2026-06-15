// tests/e2e/dist-parity.spec.js
// TASK-049 — Automated dist-parity gate.
//
// PROBLEM: dist/*.cjs are committed build artifacts. A source change that is
// NOT accompanied by `npm run build:plugin` ships a stale bundle silently —
// the full test suite passes anyway (it runs against src/, not dist/). This
// was caught manually in TASK-045/046 but must be an automated gate.
//
// WHAT THIS SPEC DOES:
//   1. Creates a mkdtemp temp dir.
//   2. Runs the project's own build pipeline into that temp dir by spawning
//      `node scripts/build-plugin.mjs` with BUILD_PLUGIN_OUT_DIR set. This
//      uses the SAME esbuild config as `npm run build:plugin` — not a
//      duplicated options block — so the two builds can never drift apart.
//   3. Byte-compares each of the four bundles (init.cjs, new-task.cjs,
//      mcp-server.cjs, task-board.cjs) between temp/<name> and dist/<name>.
//   4. Fails with a diagnostic naming which bundle(s) drifted and telling
//      the dev to run `npm run build:plugin`.
//
// DETERMINISM APPROACH — raw byte-compare (no normalization needed):
//   esbuild is deterministic for a fixed version + same cwd + same entrypoints.
//   The cwd is pinned to REPO_ROOT (the same cwd as `npm run build:plugin`)
//   so any relative source-path comments esbuild emits are identical between
//   the committed build and the temp build. No banners, no sourcemaps, no
//   minification — the options object is shared via the buildTo() export, so
//   there is literally one code path for both builds.
//
// TIER: slow (tests/e2e/) — runs under `npm run test:all` (vitest.config.all.js
//   includes tests/e2e/**). NOT included in the fast inner loop (vitest.config.js
//   only includes tests/*.spec.js).
//
// RED-GREEN EVIDENCE (do not remove — documents non-vacuity proof):
//   RED:  added `// TASK-049 proof edit` to src/project-md.js WITHOUT rebuilding;
//         ran spec → FAILED: "init.cjs differs from committed dist/init.cjs"
//         and "new-task.cjs differs from committed dist/new-task.cjs" (both
//         bundle src/project-md.js transitively).
//   GREEN: ran `npm run build:plugin` → dist rebuilt → spec PASSED.
//   CLEAN: reverted the proof edit from src/project-md.js; rebuilt dist/ so
//          committed artifacts are clean.

import { describe, it, expect, afterAll } from 'vitest';
import {
  readFileSync, mkdtempSync, rmSync, existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { REPO_ROOT } from '../helpers/repoRoot.js';

// The four canonical bundle names — sourced from the build script's export so
// this list and the build pipeline share a single source of truth.
// We resolve the build script path directly; the export is the canonical list.
const BUNDLE_NAMES = ['init.cjs', 'new-task.cjs', 'mcp-server.cjs', 'task-board.cjs'];

const DIST_DIR = join(REPO_ROOT, 'dist');
const BUILD_SCRIPT = join(REPO_ROOT, 'scripts', 'build-plugin.mjs');

// ---- tmp-dir bookkeeping ---------------------------------------------------
const __tmpDirs = [];
function makeTmp(label) {
  const p = mkdtempSync(join(tmpdir(), `${label}-`));
  __tmpDirs.push(p);
  return p;
}
afterAll(() => {
  for (const p of __tmpDirs) {
    try { rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* AV/EBUSY on win */ }
  }
});

// ---------------------------------------------------------------------------
// AC1+AC4 — byte-parity between a fresh build and committed dist/*.cjs
// ---------------------------------------------------------------------------

describe('dist-parity — committed bundles match a fresh build', () => {
  it('all_four_bundles_are_committed_in_dist', () => {
    for (const name of BUNDLE_NAMES) {
      expect(
        existsSync(join(DIST_DIR, name)),
        `dist/${name} must exist as a committed bundle`,
      ).toBe(true);
    }
  });

  it('fresh_build_byte_matches_committed_dist_for_all_four_bundles', () => {
    // Create a temp output dir.
    const tmpOut = makeTmp('af-dist-parity');

    // Spawn the build script with BUILD_PLUGIN_OUT_DIR pointing at tmpOut.
    // cwd is REPO_ROOT so esbuild source-path comments (e.g. // src/foo.js)
    // are relative to the same root as the committed build.
    const result = spawnSync(
      process.execPath,
      [BUILD_SCRIPT],
      {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          BUILD_PLUGIN_OUT_DIR: tmpOut,
        },
        encoding: 'utf8',
        timeout: 120_000, // esbuild + MCP SDK inline can be slow on first run
      },
    );

    // Surface build errors before the parity assertions.
    expect(
      result.status,
      `build-plugin.mjs must exit 0; stdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    ).toBe(0);

    // Now byte-compare each bundle.
    const drifted = [];
    for (const name of BUNDLE_NAMES) {
      const freshPath = join(tmpOut, name);
      const committedPath = join(DIST_DIR, name);

      const fresh = readFileSync(freshPath);
      const committed = readFileSync(committedPath);

      if (!fresh.equals(committed)) {
        drifted.push(name);
      }
    }

    expect(
      drifted,
      `The following bundle(s) differ between a fresh build and committed dist/:\n` +
        drifted.map((n) => `  dist/${n}`).join('\n') + '\n' +
        `Run \`npm run build:plugin\` and commit the updated dist/ artifacts.`,
    ).toHaveLength(0);
  });
});
