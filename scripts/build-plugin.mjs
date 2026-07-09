// scripts/build-plugin.mjs
// TASK-023 — Plugin chain P3: bundle the plugin's standalone Node entrypoints
// into self-contained, committed dist/*.cjs artifacts.
//
// WHY bundle: a real (git-URL) plugin install git-clones the repo, so no
// node_modules ships; ESM `import` ignores NODE_PATH; ${CLAUDE_PLUGIN_ROOT} is
// ephemeral. esbuild inlines EVERY dependency (src/* modules + ajv + ajv-formats
// + gray-matter) AND the JSON schemas (now imported via `with { type: 'json' }`
// in src/task-store.js + src/project-md.js), so `node dist/init.cjs` carries
// everything and resolves nothing at runtime.
//
// The bundles are the SHIPPED entrypoints (see .claude-plugin/shipped-bin.json);
// bin/*.js + src/* remain the dev/test sources (`npm test` runs against src/).
// TASK-026 P6 added the third entry: src/mcp-server.js -> dist/mcp-server.cjs,
// which inlines @modelcontextprotocol/sdk + zod (both devDependencies) so the
// shipped MCP server resolves nothing at runtime. It carries NO shebang (it is
// invoked as `node dist/mcp-server.cjs` from .mcp.json, not as a bin/*).
//
// NO banner: bin/init.js and bin/new-task.js already carry a
// `#!/usr/bin/env node` shebang and esbuild preserves it. Adding a banner.js
// shebang would emit a SECOND shebang on line 2 (a SyntaxError) — guarded by the
// `exactly_one_shebang` spec in tests/plugin-deps.spec.js.
//
// TASK-049 — OUTPUT-DIR OVERRIDE:
//   Set BUILD_PLUGIN_OUT_DIR env var to redirect output (used by the dist-parity
//   spec to rebuild into a temp dir for byte-comparison). Default is dist/ as
//   before — a plain `npm run build:plugin` is byte-unchanged.
//   The ENTRYPOINT_NAMES export allows the parity spec to enumerate the
//   expected bundle filenames without duplicating knowledge — its length is
//   the current entrypoint count, not a number worth hard-coding in prose.
//
// TASK-097 — added the seventh entry: bin/loop-ctl.js -> dist/loop-ctl.cjs, the
// CLI wrapper exposing session-lock/operating-mode/loop-checkpoint/loop-auth
// so a plugin-installed project can drive the loop via
// ${CLAUDE_PLUGIN_ROOT}/dist/loop-ctl.cjs (see commands/loop.md, commands/mode.md,
// the orchestrator-routing SKILL.md).
//
// TASK-134 — added the eighth entry: bin/pack-ctl.js -> dist/pack-ctl.cjs, the
// CLI wrapper exposing the deterministic addon-pack ops (resolveDesired /
// pack-reconcile / pack-orchestrator) so a plugin-installed project can drive
// resolve/reconcile-plan/reconcile-apply via ${CLAUDE_PLUGIN_ROOT}/dist/pack-ctl.cjs.

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

const __dir = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dir, '..');
const DEFAULT_OUT_DIR = join(REPO_ROOT, 'dist');

// The canonical bundle output filenames — exported so the parity spec can
// enumerate them without duplicating knowledge here.
export const ENTRYPOINT_NAMES = [
  'init.cjs',
  'new-task.cjs',
  'mcp-server.cjs',
  'task-board.cjs',
  'report-framework-bug.cjs',
  'brain-launch.cjs',
  'loop-ctl.cjs',
  'pack-ctl.cjs',
];

/**
 * Build all plugin bundles (see ENTRYPOINT_NAMES) into `outDir`.
 * cwd MUST be the repo root so esbuild source-path comments are identical
 * between the committed build and a parity-check temp build.
 *
 * @param {string} outDir  Absolute path to the output directory.
 */
export async function buildTo(outDir) {
  mkdirSync(outDir, { recursive: true });

  // Entrypoint -> output bundle (derived from outDir so callers can redirect).
  const entrypoints = [
    { entry: join(REPO_ROOT, 'bin', 'init.js'), outfile: join(outDir, 'init.cjs') },
    { entry: join(REPO_ROOT, 'bin', 'new-task.js'), outfile: join(outDir, 'new-task.cjs') },
    // TASK-026 P6 — the MCP task-store server. Same options; the SDK + zod inline.
    { entry: join(REPO_ROOT, 'src', 'mcp-server.js'), outfile: join(outDir, 'mcp-server.cjs') },
    // TASK-034 — the kanban task board server. Zero external deps; inlines task-store.
    { entry: join(REPO_ROOT, 'bin', 'task-board.js'), outfile: join(outDir, 'task-board.cjs') },
    // TASK-010 — framework bug reporter CLI.
    { entry: join(REPO_ROOT, 'bin', 'report-framework-bug.js'), outfile: join(outDir, 'report-framework-bug.cjs') },
    // Phase 6 — the brain launcher (zero-dep): brings up the wisearcher stack + execs its MCP.
    // Shipped so an installed plugin can bootstrap the brain without a build step.
    { entry: join(REPO_ROOT, 'bin', 'brain-launch.js'), outfile: join(outDir, 'brain-launch.cjs') },
    // TASK-097 — the loop-control CLI: wraps session-lock/operating-mode/
    // loop-checkpoint/loop-auth so a plugin install (no framework src/ on
    // disk) can drive the autonomous loop.
    { entry: join(REPO_ROOT, 'bin', 'loop-ctl.js'), outfile: join(outDir, 'loop-ctl.cjs') },
    // TASK-134 — the pack-control CLI: wraps resolveDesired/pack-reconcile/
    // pack-orchestrator so a plugin install (no framework src/ on disk) can
    // resolve/reconcile-plan/reconcile-apply the addon-pack surface.
    { entry: join(REPO_ROOT, 'bin', 'pack-ctl.js'), outfile: join(outDir, 'pack-ctl.cjs') },
  ];

  for (const { entry, outfile } of entrypoints) {
    await build({
      entryPoints: [entry],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node20',
      outfile,
      // Inline everything — no externals. The schemas are inlined via their
      // `with { type: 'json' }` imports; ajv/ajv-formats/gray-matter are pulled
      // in from devDependencies at build time.
      logLevel: 'info',
    });
    // eslint-disable-next-line no-console
    console.log(`built ${outfile}`);
  }
}

// When invoked directly (not imported), run main() which respects
// BUILD_PLUGIN_OUT_DIR for output-dir override. Default is dist/.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const outDir = process.env.BUILD_PLUGIN_OUT_DIR
    ? process.env.BUILD_PLUGIN_OUT_DIR
    : DEFAULT_OUT_DIR;

  buildTo(outDir).catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
