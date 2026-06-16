---
description: Open the knowledge graph visualization in the browser. Launches the board server and directs the user to the /graph view showing all nodes and edges in the project knowledge graph.
---

# /agentic-framework:graph

Launch the board server in the background and open the knowledge graph
visualization at `http://127.0.0.1:4517/graph`. The graph view renders all
nodes and edges from `knowledge/graph/graph.json` as an interactive
force-directed diagram.

## Step 1 — Launch the board server in the background

Run the shipped, self-contained bundle via the Bash tool with `run_in_background: true`:

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/task-board.cjs --port 4517
```

The bundle binds `127.0.0.1:4517` and prints one line to stdout:

```
Task board: http://127.0.0.1:4517
```

## Step 2 — Direct the user to the graph view

Tell the user the server is running and give them the graph URL:

> The knowledge graph is running at **http://127.0.0.1:4517/graph**. Open that URL in your browser to explore the project graph. The raw JSON is also available at http://127.0.0.1:4517/api/graph. Tell me when you are done and I will stop the server.

## Notes

- **Graph data** is loaded from `knowledge/graph/graph.json` under the project
  root. If no graph exists yet, the page renders an empty canvas (no crash).
- **Read-only view** — the `/graph` page renders the graph; mutations go through
  `src/knowledge-graph.js` (`addNode`, `addEdge`, etc.) via the orchestrator or
  a script. See the `graphify` skill for the full API.
- **Trust model** — the server is local-only (`127.0.0.1`), single-user, and
  protected by a Host-header allowlist. It is not exposed to the network.
- The server resolves the project root from `CLAUDE_PROJECT_DIR` (falling back
  to the current working directory), so it reads the same `knowledge/` directory
  the orchestrator manages.
- All assets are inline; the page works offline.
- The raw graph JSON is also served at `http://127.0.0.1:4517/api/graph`
  (useful for scripting or debugging).
- To stop the server: kill the background shell that launched it (e.g. via the
  KillShell tool or by terminating the background task).
