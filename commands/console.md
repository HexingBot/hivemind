---
description: Start the Hivemind OS web console (chat with the orchestrator + skill buttons + kanban board with create/drag + live status bar). Use this when you want a browser-based dashboard to drive the framework — create tickets, run skills, chat, and watch the board update in real time.
---

# /hivemind:console

Start the Hivemind OS web console in the background and surface the URL for the human. The console fuses the orchestrator chat, skill action buttons, and the full kanban board (including ticket creation and drag-and-drop status transitions) into a single browser tab.

## Step 1 — Launch the console server in the background

Run the shipped, self-contained bundle via the Bash tool with `run_in_background: true`:

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/task-board.cjs --port 4517
```

The bundle binds `127.0.0.1:4517` and prints one line to stdout:

```
Task board: http://127.0.0.1:4517
```

## Step 2 — Surface the URL to the human

Tell the human the console is running and give them the URL:

> The Hivemind OS console is running at **http://127.0.0.1:4517**. Open that URL in your browser. You can chat with me there, click skill buttons, create tickets, and drag cards between columns. Tell me when you are done and I will stop the server.

## Notes

- **Chat** uses your existing `claude` login — no separate API key or account needed. Conversations draw from your plan's Agent-SDK credit allowance (a usage bucket within your subscription), not a separate purchase.
- **Skills panel** — buttons run the selected skill immediately via the orchestrator. Skills can mutate files and spawn subagents; only run the console on a machine you trust.
- **Board** — all status mutations route through `src/task-store.js` (atomic write + `index.json` regeneration). The board cannot corrupt a ticket.
- **Trust model** — the console is local-only (`127.0.0.1`), single-user, and protected by a Host-header allowlist. It is not exposed to the network.
- The server resolves the task store location from `CLAUDE_PROJECT_DIR` (falling back to the current working directory), so it reads the same `tasks/` directory the orchestrator manages.
- All assets are inline; the page works offline.
- To stop the server: kill the background shell that launched it (e.g. via the KillShell tool or by terminating the background task).
