// scripts/entrypoint-names.mjs
// TASK-197 fix round — MEDIUM-2: ENTRYPOINT_NAMES pulled out of
// build-plugin.mjs into its own data-only module with ZERO imports, so a
// runtime-only consumer (src/worktree-handback.js's getGeneratedArtifactPaths)
// can depend on "the list of dist/ bundle names" WITHOUT transitively pulling
// in esbuild — a devDependency only (package.json), which fails
// ERR_MODULE_NOT_FOUND in a real plugin install (a git-URL clone ships no
// node_modules; see build-plugin.mjs's own header for why dist/*.cjs exist at
// all) and could never be bundled itself (esbuild ships a native binary).
//
// build-plugin.mjs re-exports this list rather than defining it, so there is
// still exactly ONE list — AC4's "no second source of truth" is unaffected by
// this split; only WHICH file OWNS the literal changed.

// The canonical bundle output filenames — exported so both the build script
// and any runtime-only consumer can enumerate them without duplicating
// knowledge or importing build tooling.
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
