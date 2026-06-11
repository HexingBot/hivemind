---
description: Start a local kanban task board server and open the URL in the browser. Serves all tasks from the local task store with drag-and-drop status transitions.
---

# /agentic-framework:task-status

Start the kanban task board server for the local task store. The board renders all tasks grouped into five status columns (todo, in_progress, in_review, blocked, done). Dragging a card between columns POSTs a status transition that routes through the task store's atomic-write + index-regeneration path.

## Step 1 — Launch the server in the background

Run the shipped, self-contained bundle via the Bash tool with `run_in_background: true`:

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/task-board.cjs
```

The bundle binds `127.0.0.1` on a free ephemeral port and prints one line to stdout:

```
Task board: http://127.0.0.1:<port>
```

Capture that line to extract the URL.

## Step 2 — Surface the URL to the human

Tell the human the board is running and give them the printed URL so they can open it in their browser. Example:

> The task board is running at **http://127.0.0.1:PORT**. Open that URL in your browser to view and update tasks. Press Ctrl+C in the terminal to stop the server.

## Notes

- The server resolves the task store location from `CLAUDE_PROJECT_DIR` (falling back to the current working directory), so it reads the same `tasks/` directory the orchestrator manages.
- All status mutations route through `src/task-store.js` (atomic write + `index.json` regeneration) — the board cannot corrupt a ticket.
- The page requires no network access; all assets are inline. It works offline.
- Refreshing the page reflects any on-disk changes made since the last load.
- To stop the server, send SIGINT (Ctrl+C) to the background process.
