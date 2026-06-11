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

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

const __dir = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dir, '..');
const OUT_DIR = join(REPO_ROOT, 'dist');

// Entrypoint -> output bundle.
const ENTRYPOINTS = [
  { entry: join(REPO_ROOT, 'bin', 'init.js'), outfile: join(OUT_DIR, 'init.cjs') },
  { entry: join(REPO_ROOT, 'bin', 'new-task.js'), outfile: join(OUT_DIR, 'new-task.cjs') },
  // TASK-026 P6 — the MCP task-store server. Same options; the SDK + zod inline.
  { entry: join(REPO_ROOT, 'src', 'mcp-server.js'), outfile: join(OUT_DIR, 'mcp-server.cjs') },
  // TASK-034 — the kanban task board server. Zero external deps; inlines task-store.
  { entry: join(REPO_ROOT, 'bin', 'task-board.js'), outfile: join(OUT_DIR, 'task-board.cjs') },
];

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  for (const { entry, outfile } of ENTRYPOINTS) {
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

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
