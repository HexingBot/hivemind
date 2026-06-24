# esbuild bundling + .mcp.json interpolation (MCP server)

## esbuild: add the third entry

`scripts/build-plugin.mjs` already bundles `bin/init.js` and `bin/new-task.js`
into `dist/*.cjs`. Add `src/mcp-server.js → dist/mcp-server.cjs` with the SAME
options (`bundle:true, platform:'node', format:'cjs', target:'node20'`). esbuild
inlines `@modelcontextprotocol/sdk` + `zod` (both devDependencies) into the
single `.cjs`, so the shipped bundle resolves nothing at runtime — the same
reason the spike abandoned the `${CLAUDE_PLUGIN_DATA}/node_modules` + `NODE_PATH`
approach.

## esbuild gotchas with @modelcontextprotocol/sdk → CJS/node20

- **No externals needed.** The SDK is pure JS/TS with no native addons; it
  bundles cleanly to a single CJS file. Do NOT mark it `external` (that would
  reintroduce the no-node_modules-at-runtime problem).
- **No banner shebang.** Unlike `bin/*.js`, `src/mcp-server.js` has no
  `#!/usr/bin/env node` shebang and does not need one — `.mcp.json` invokes it as
  `node dist/mcp-server.cjs`. Do not add a banner (the existing
  `exactly_one_shebang` guard only concerns the bin entries).
- **Top-level await.** The CJS format does not allow top-level `await`. Keep the
  `await server.connect(...)` inside an `async main()` and call `main()` — never
  `await` at module top level. (The quickstart already does this.)
- **`import.meta` is empty under CJS.** Do not rely on `import.meta.url` for
  paths or for an entrypoint guard. Use `require.main === module` (esbuild emits
  it correctly for CJS) or keep the module import-only and call `main()` from the
  bundled entry. This mirrors the TASK-023 lesson that moved `task-store.js` off
  `import.meta.url` to a `with { type: 'json' }` import.
- **zod/v4 subpath.** The SDK README example imports `zod/v4` in places; the
  Claude-Desktop quickstart installs `zod@3` and imports bare `zod`. Use bare
  `import { z } from 'zod'` with `zod@^3.25` — that range is the SDK's documented
  back-compat floor and bundles without the `zod/v4` subpath wrinkle.
- **Dynamic requires.** The SDK does not do problematic dynamic `require()` for
  the stdio path; if a future transport pulls one in, esbuild will warn at build
  time — treat any esbuild warning about unresolved dynamic require as a release
  blocker and add the dep, not an `external`.

After bundling, smoke-test: `node dist/mcp-server.cjs` should print the stderr
banner and wait on stdin. A crash on start is almost always a bundling miss.

## .mcp.json (plugin-bundled stdio server)

```json
{
  "mcpServers": {
    "hivemind-tasks": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/dist/mcp-server.cjs"],
      "env": { "CLAUDE_PROJECT_DIR": "${CLAUDE_PROJECT_DIR}" }
    }
  }
}
```

- **`${CLAUDE_PLUGIN_ROOT}`** — absolute path to the plugin's own install dir.
  Supported in plugin `.mcp.json` interpolation; use it to locate the bundled
  server artifact. Points at the immutable cache — fine for *reading* the bundle,
  never for project I/O.
- **`${CLAUDE_PROJECT_DIR}`** — the project root Claude Code was launched in.
  Substituted into the server's `env` so the spawned `node` process sees
  `process.env.CLAUDE_PROJECT_DIR`. This is how the server binds `repoRoot` to
  the user's repo. Confirmed: `CLAUDE_PROJECT_DIR` is exported to MCP
  subprocesses (per plugins-reference §Environment variables, cited in §B.1 of
  the spike).
- **No `NODE_PATH`.** Because esbuild inlines the SDK, the bundle needs no
  external module resolution. Drop the `NODE_PATH: "${CLAUDE_PLUGIN_DATA}/..."`
  line from the §E.1 sketch — it predates the P3 bundling decision.
- Point `args` at `dist/mcp-server.cjs` (the bundle), NOT `src/mcp-server.js`
  (the dev source, which has unbundled `import`s and would fail post-install).

## plugin.json + shipped-bin wiring (same change)

- Re-add `"mcpServers": "./.mcp.json"` to `.claude-plugin/plugin.json` (it was
  removed in TASK-021 / superseded by TASK-027 P7 precisely because `.mcp.json`
  did not exist yet — P6 re-adds the key and the file together; see the comment
  in `tests/plugin-scaffold.spec.js` `plugin_mcpServers_is_unset_until_...`).
- Add `"dist/mcp-server.cjs"` to `.claude-plugin/shipped-bin.json`'s `bin` array
  so the bundle ships and any shipped-bin allowlist test passes.
- A "no dangling mcpServers reference" guard lives in
  `tests/publish-config.spec.js` — once `.mcp.json` exists, that invariant flips
  from "must be absent" to "must resolve."

## Test-suite touch points the impl phase MUST update

- `tests/plugin-scaffold.spec.js` pins the skills inventory:
  `REPO_LOCAL_SKILLS = ['orchestrator-routing', 'tech-training-template'].sort()`
  and asserts `skillEntries.toEqual(REPO_LOCAL_SKILLS)`. Adding the `mcp-server`
  skill REQUIRES adding `'mcp-server'` to that array (it becomes a 3-element
  sorted list). Otherwise the "no global sweep" test fails.
- Follow the established skills-parity pattern: ship the skill in BOTH
  `.claude/skills/mcp-server/` (dev source) AND `skills/mcp-server/` (plugin
  root), byte-identical SKILL.md — mirror `tests/orchestrator-routing-skill.spec.js`'s
  parity assertion if a drift-guard for this skill is added.
- The `plugin_mcpServers_is_unset_until_the_mcp_server_ships_in_P6` assertion in
  `plugin-scaffold.spec.js` expects `manifest.mcpServers` to be **undefined**;
  P6 must flip it to expect `"./.mcp.json"`.
