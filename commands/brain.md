---
description: EXPERIMENTAL opt-in. Bring up the wisearcher "brain" (Neo4j + Qdrant via docker compose, then the MCP server) and report its health, so research and knowledge tools run against the cited graph instead of the local grep KB. The grep KB is the supported default for knowledge-heavy sessions; only reach for this if you specifically want the graph-backed path and accept its Docker/infra footprint.
---

# /hivemind:brain (EXPERIMENTAL)

Start and health-check the wisearcher **brain** — the out-of-process knowledge service hivemind
calls over MCP (see `.knowledge/derived/brain-contract.md`). The brain is **demoted to
experimental, opt-in status** (TASK-079): it carries a real Docker/infra maintenance surface for
a path no drive ticket has actually needed. The local grep KB (`knowledge/entries/`) is the
supported default for knowledge-heavy sessions — reach for this command only when you
specifically want the cited Neo4j+Qdrant graph and accept that footprint, not as a routine
session-start step.

## What it does

1. Resolves the wisearcher repo (`WISEARCHER_PATH`, else a sibling of the plugin root).
2. Brings up the brain stack idempotently: `docker compose up -d` (Neo4j + Qdrant).
3. Probes health and reports it:

   ```
   node ${CLAUDE_PLUGIN_ROOT}/dist/brain-launch.cjs --health
   ```

   This prints `kb_health` JSON — `{neo4j, qdrant, voyage, ok}`. `ok: true` means hivemind's
   brain-client will run reads/writes against the graph; otherwise it stays on the grep KB.

## Reporting to the human

State plainly whether the brain is **on** (`ok: true` → graph-backed research + node writes) or
hivemind is running in **grep-fallback** mode, and if the latter, which dependency is down
(`neo4j` / `qdrant` / `voyage`) and the one-line fix (start Docker, set `VOYAGE_API_KEY`, or set
`WISEARCHER_PATH`). Never imply the brain is on when `ok` is false — the fallback must be visible.

## Notes

- Auth: the brain reuses the Claude Code subscription via the `claude` CLI; `ANTHROPIC_API_KEY`
  is stripped from the spawned environment.
- Lifecycle: the launch script is invoked on demand (this command, the smoke harness) rather than
  hard-coded into a committed `.mcp.json` entry — this also makes the command work on a plugin
  install, where no repo-relative `bin/` exists on disk.
