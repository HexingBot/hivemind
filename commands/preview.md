---
description: Start the Agentic OS web console focused on the Preview panel, where you can start/stop/restart your app and view its live output (iframe for web apps, log stream for process mode). Use this when you want to launch or inspect the app preview without navigating through the full console.
---

# /agentic-framework-beta:preview

Start the Agentic OS web console with the Preview panel already selected. The console server is the same self-contained bundle used by `/agentic-framework:console`; this command simply deep-links the browser to the Preview tab.

## Step 1 — Launch the console server in the background

Run the shipped, self-contained bundle via the Bash tool with `run_in_background: true`:

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/task-board.cjs --port 4517
```

The bundle binds `127.0.0.1:4517` and prints one line to stdout:

```
Task board: http://127.0.0.1:4517
```

## Step 2 — Surface the Preview URL to the human

Tell the human the console is running and give them the deep-link URL that opens directly on the Preview panel:

> The Agentic OS console is running. Open **http://127.0.0.1:4517/?tab=preview** in your browser to go straight to the Preview panel. From there you can Start / Stop / Restart your app and watch the log or iframe live. Tell me when you are done and I will stop the server.

The `?tab=preview` query parameter is honoured on page load — the Preview tab is selected automatically, with no extra click required.

## What the Preview panel does

| App type | Preview mode | What you see |
|---|---|---|
| Web app (url/port derivable) | **web** | Live iframe pointed at your app |
| Process / CLI (no port) | **process** | Streaming log view |
| No preview configured | **none** | "No preview configured" hint |

The panel exposes three buttons: **Start**, **Stop**, and **Restart**. These call the board's REST API (`POST /api/preview/start|stop|restart`) and the status chip updates live via SSE (`GET /api/preview/stream`).

## Preview configuration (PROJECT.md)

The resolver reads your `PROJECT.md` frontmatter. Add any of these fields to configure preview:

```yaml
preview_command: npm start        # command to run (optional — inferred if absent)
preview_url: http://localhost:3000 # explicit URL for the iframe (optional)
preview_port: 3000                # port to derive the iframe URL (optional)
preview_mode: web                 # force 'web' or 'process' (optional)
```

If none of these fields are present the resolver falls back to your `package.json` scripts (`dev` > `start` > `serve`). If a port is detectable the panel shows a web iframe; otherwise it shows a process log. See the orchestrator-routing skill for the full precedence rules.

## Notes

- The server is identical to the one started by `/agentic-framework:console` — if that server is already running, just open **http://127.0.0.1:4517/?tab=preview** directly without restarting.
- Both `?tab=preview` (query parameter) and `#preview` (hash) are honoured as deep-link forms.
- **Trust model** — the console is local-only (`127.0.0.1`), single-user, and protected by a Host-header allowlist. It is not exposed to the network.
- To stop the server: kill the background shell that launched it (e.g. via the KillShell tool or by terminating the background task).
