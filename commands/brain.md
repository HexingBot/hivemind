---
description: Bring up the wisearch "brain" (Neo4j + Qdrant via docker compose, then the MCP server) and report its health, so research and knowledge tools run against the cited graph instead of the local grep KB. Use this at the start of a knowledge-heavy session.
---

# /hivemind:brain

Start and health-check the wisearch **brain** — the out-of-process knowledge service hivemind
calls over MCP (see `.knowledge/derived/brain-contract.md`). The brain is optional: when it is
absent, hivemind degrades gracefully to the local grep KB (`knowledge/entries/`), so this
command is about *upgrading* a session to the cited Neo4j+Qdrant graph, not a prerequisite.

## What it does

1. Resolves the wisearch repo (`WISEARCH_PATH`, else a sibling of the plugin root).
2. Brings up the brain stack idempotently: `docker compose up -d` (Neo4j + Qdrant).
3. Probes health and reports it:

   ```
   node bin/brain-launch.js --health
   ```

   This prints `kb_health` JSON — `{neo4j, qdrant, voyage, ok}`. `ok: true` means hivemind's
   brain-client will run reads/writes against the graph; otherwise it stays on the grep KB.

## Reporting to the human

State plainly whether the brain is **on** (`ok: true` → graph-backed research + node writes) or
hivemind is running in **grep-fallback** mode, and if the latter, which dependency is down
(`neo4j` / `qdrant` / `voyage`) and the one-line fix (start Docker, set `VOYAGE_API_KEY`, or set
`WISEARCH_PATH`). Never imply the brain is on when `ok` is false — the fallback must be visible.

## Notes

- Auth: the brain reuses the Claude Code subscription via the `claude` CLI; `ANTHROPIC_API_KEY`
  is stripped from the spawned environment.
- Lifecycle: hivemind's brain-client spawns `bin/brain-launch.js` on demand, so the wisearch
  path is resolved at runtime rather than hard-coded into a committed `.mcp.json` entry.
