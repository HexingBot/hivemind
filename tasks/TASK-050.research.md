# TASK-050 Research Note — Persistent Headless Orchestrator Session over the Existing `claude` Login

**Date:** 2026-06-15
**Researcher:** Researcher subagent (claude-sonnet-4-6)
**Epic:** Agentic OS Web Console

This note de-risks the core unknown of the "Agentic OS web console" epic: whether a local Node server can hold a persistent, streaming orchestrator session that **reuses the user's existing `claude` CLI login** with no API key and no new billing relationship. Each of the six research questions is answered below with citations to the official Claude Code documentation at `code.claude.com`.

---

## 1. Persistent Streaming Session

**Question:** Can `claude` run as a long-lived process accepting multiple user turns and emitting assistant/tool events as a stream?

**Answer: YES**, via `--input-format stream-json` combined with `--output-format stream-json`.

### Confirmed flags (from the official CLI reference)

| Flag | Purpose |
|---|---|
| `-p` / `--print` | Non-interactive print mode (required for all programmatic use) |
| `--output-format stream-json` | Newline-delimited JSON events on stdout; values: `text`, `json`, `stream-json` |
| `--input-format stream-json` | Accept NDJSON user turns on stdin; values: `text`, `stream-json` |
| `--include-partial-messages` | Emit token-level deltas in real time; requires `-p` and `--output-format stream-json` |
| `--verbose` | Required to emit the `system/init` event (carries `session_id` and model metadata) |
| `--replay-user-messages` | Re-emit each user message on stdout as acknowledgment; requires both `stream-json` flags |
| `--resume` / `-r` | Resume a specific session by ID or name |
| `--continue` / `-c` | Resume the most recent session in the current directory |
| `--session-id` | Supply a specific UUID to use as the session ID for this conversation |
| `--dangerously-skip-permissions` | Skip permission prompts (equivalent to `--permission-mode bypassPermissions`) |
| `--permission-mode` | `default`, `acceptEdits`, `plan`, `auto`, `dontAsk`, `bypassPermissions` |
| `--allowedTools` | Auto-approve named tools without prompting |

**Sources:** [CLI reference — flags table](https://code.claude.com/docs/en/cli-reference), [Headless mode docs](https://code.claude.com/docs/en/headless)

### Stdin message envelope (one JSON line per user turn)

The format documented by community reverse-engineering and consistent with the SDK's wire protocol is:

```json
{"type": "user", "message": {"role": "user", "content": "<user turn text>"}}
```

A process closure (stdin EOF) is the graceful shutdown signal — the process finishes any pending work and exits. The `--replay-user-messages` flag causes each received user message to be echoed on stdout for acknowledgment.

**Note:** The exact `--input-format stream-json` envelope is described in community sources (confirmed by the open GitHub issue #24594 [DOCS] noting it is "undocumented beyond the CLI flags table") and by the devlog at avasdream.com. The SDK's wire format (via `@anthropic-ai/claude-agent-sdk`) uses the same NDJSON convention. Mark as **verify** against a live process before TASK-051 ships — write a small integration test that writes one message and reads back the first `result` event.

### Stdout event schema (switch on `type`)

The stream emits newline-delimited JSON. The top-level `type` values to switch on:

| `type` | Meaning | Key subfields |
|---|---|---|
| `"system"` | Infrastructure events | `subtype`: `"init"` (first event, carries `session_id`, model, tools) or `"api_retry"` |
| `"stream_event"` | Raw API token/tool streaming event (with `--include-partial-messages`) | `event.type` (see below), `parent_tool_use_id`, `session_id` |
| `"assistant"` | Complete assistant message (without partial streaming) | `message.content[]` — array of `text` or `tool_use` content blocks |
| `"user"` | Echo of the user message (with `--replay-user-messages`) | `message.content` |
| `"result"` | Turn complete / session complete | `subtype` (`"success"` / `"error"`), `session_id`, `total_cost_usd`, `duration_ms`, `is_error` |

Within `type: "stream_event"`, the nested `event.type` values (Claude API streaming events):

| `event.type` (nested) | Meaning |
|---|---|
| `"message_start"` | New assistant message beginning |
| `"content_block_start"` | New content block; `content_block.type` is `"text"` or `"tool_use"` |
| `"content_block_delta"` | Incremental chunk; `delta.type` is `"text_delta"` (text) or `"input_json_delta"` (tool input) |
| `"content_block_stop"` | Content block complete |
| `"message_delta"` | Message-level update (stop reason, usage) |
| `"message_stop"` | Assistant message complete |

**Subagent/Task spawn detection:** when the orchestrator invokes a subagent (developer/reviewer/researcher), a `content_block_start` event appears with `content_block.type = "tool_use"` and `content_block.name = "Agent"` (was `"Task"` before v2.1.63 — check both for compatibility). All subsequent stream events belonging to that subagent's execution carry `parent_tool_use_id` set to the `tool_use` block's `id`.

**Sources:** [Headless — stream responses](https://code.claude.com/docs/en/headless#stream-responses), [Agent SDK streaming output](https://code.claude.com/docs/en/agent-sdk/streaming-output), [Subagents — detecting invocation](https://code.claude.com/docs/en/agent-sdk/subagents#detecting-subagent-invocation), [GitHub issue #24594](https://github.com/anthropics/claude-code/issues/24594)

---

## 2. Auth / Cost (HARD CONSTRAINT)

**Question:** Does a spawned `claude` process reuse the existing interactive login (subscription) with NO API key and NO separate per-token bill?

**Answer: YES, with an important caveat about June 15, 2026.**

### Authentication precedence (official docs)

Claude Code selects credentials in this order (highest priority first):

1. Cloud provider env vars (`CLAUDE_CODE_USE_BEDROCK`, etc.)
2. `ANTHROPIC_AUTH_TOKEN` env var
3. `ANTHROPIC_API_KEY` env var — **always used when present in `-p` mode**
4. `apiKeyHelper` script
5. `CLAUDE_CODE_OAUTH_TOKEN` — long-lived token from `claude setup-token`
6. Subscription OAuth credentials from `/login` — **the default for Pro/Max/Team/Enterprise**

The subscription OAuth path (item 6) is the default for interactive users and is what the bridge must use. **If `ANTHROPIC_API_KEY` is present in the environment, it overrides the subscription and will be billed at API rates.** The bridge's spawn recipe must explicitly `unset` or exclude `ANTHROPIC_API_KEY` from the child process's environment.

### The June 15, 2026 billing split

Starting June 15, 2026, Anthropic created a **separate monthly Agent SDK credit pool** for programmatic (`-p` / Agent SDK) usage. This credit is distinct from interactive chat usage limits:

- Pro: $20/month credit; Max 5x: $100/month; Max 20x: $200/month
- Credits are consumed at standard API list prices (no subscription discount), do not roll over
- When the credit is exhausted: automations stop (or flow to overage billing if enabled)
- **No new API key is required** — usage still draws from the subscription OAuth token

The bridge still uses the existing subscription login. The user must claim their Agent SDK credit (one-time action via the June 8 claim email). Without claiming, `-p` usage is capped by the new pool mechanics.

**The constraint is SATISFIED** (no new API key, reuses the subscription login), but the user must be aware that `claude -p` usage now draws from a separate monthly credit pool, not their interactive chat limits.

**To guarantee the no-API-key path on spawn:**

```js
const env = { ...process.env };
delete env.ANTHROPIC_API_KEY;       // prevent API-key billing override
delete env.ANTHROPIC_AUTH_TOKEN;    // prevent bearer-token override (optional safety)
// CLAUDE_CODE_OAUTH_TOKEN is fine to leave if set — it uses the subscription
const child = spawn('claude', argv, { cwd: projectRoot, env });
```

**Sources:** [Authentication — credential precedence](https://code.claude.com/docs/en/authentication#authentication-precedence), [Generate a long-lived token](https://code.claude.com/docs/en/authentication#generate-a-long-lived-token), [Use the Agent SDK with your Claude plan](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan), [Claude subscription billing split June 2026](https://blog.vibecoder.me/anthropic-claude-subscription-billing-split-june-2026)

---

## 3. Session Continuity

**Question:** How to keep conversation memory across user turns within one browser tab?

### Option A — Single long-lived process (RECOMMENDED)

Spawn one `claude` process per browser tab at session start with `--input-format stream-json --output-format stream-json --verbose`. Write each user turn as one NDJSON line to stdin. Keep the process alive for the tab's lifetime. On `result` event, the turn is complete; write the next user message to stdin to start the next turn.

- `session_id` is received from the first `system/init` event's `session_id` field
- Conversation history is held in the process's in-memory context (no disk round-trip per turn)
- On process crash: respawn with `--resume <session_id>` (captured from init event) to reload the transcript from `~/.claude/` storage
- Graceful shutdown: close stdin; the process finishes pending work and exits

### Option B — Per-turn `claude -p --resume <session-id>`

Spawn a fresh `claude` process for each user turn with `--resume <last_session_id>`. After the `result` event, capture the `session_id` from the result and use it in the next spawn.

- Transcript is re-serialized and deserialized from disk on each turn (latency)
- No process management needed between turns
- Slower startup per turn (~0.5–2s overhead)
- Less complex process supervision

### Recommendation: Option A

Option A is clearly preferable for a chat UI: lower latency per turn, no disk serialization overhead, and MCP servers / CLAUDE.md stay loaded between turns without re-parsing. The only added complexity is keeping a `ChildProcess` handle alive per browser tab. Option B is a valid fallback if the process dies unexpectedly — store the `session_id` from the init event and pass it to `--resume` on restart.

**Continuity model for TASK-051:**
- On tab open: spawn process, wait for `system/init` → capture `session_id`
- On each user message: write NDJSON line to stdin, stream stdout events to browser
- On `result` event: turn complete, await next user input
- On process exit / crash: respawn with `--resume <stored_session_id>`
- On tab close: send stdin EOF, process drains and exits

**Sources:** [CLI reference — --resume / --continue](https://code.claude.com/docs/en/cli-reference), [Headless — continue conversations](https://code.claude.com/docs/en/headless#continue-conversations), [Running Claude Code in a Loop (DEV Community)](https://dev.to/agentdm/running-claude-code-in-a-loop-the-script-that-turns-it-into-a-persistent-agent-4i3f)

---

## 4. Alternative — Agent SDK In-Process

**Question:** Does the Claude Agent SDK (TypeScript) also reuse the subscription login with no API key?

The `@anthropic-ai/claude-agent-sdk` TypeScript package wraps the same `claude` CLI binary. It invokes `claude` as a subprocess internally and surfaces the same streaming events as typed objects (`SDKPartialAssistantMessage`, `AssistantMessage`, `ResultMessage`). Authentication is handled by the underlying CLI binary — the same credential precedence applies.

**However, the SDK introduces a meaningful "nothing to install" friction:**
- It requires `npm install @anthropic-ai/claude-agent-sdk` as a project dependency
- The framework's current board server (`src/task-board.js`) has a zero-dependency Node http server design
- Adding an npm package (even one that wraps the existing `claude` CLI) breaks the zero-dep constraint

**Additionally:** `--bare` mode (recommended for scripted SDK calls) explicitly skips `CLAUDE_CODE_OAUTH_TOKEN` and **requires** `ANTHROPIC_API_KEY` or `apiKeyHelper` for authentication — which violates the no-API-key constraint.

**Verdict: CLI-spawn wins.** The in-process SDK approach would add a package dependency and the recommended bare mode breaks the subscription-auth path. CLI-spawn is zero-dep (Node's built-in `child_process.spawn`), uses the subscription login naturally, and loads CLAUDE.md + `.claude/` exactly as an interactive session would.

**Sources:** [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview), [Headless — bare mode](https://code.claude.com/docs/en/headless#start-faster-with-bare-mode), [Agent SDK — TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript)

---

## 5. Working Directory + Concurrency

**Question:** Can the spawned session run with cwd = the user's project, and what about two sessions writing `state/` simultaneously?

### Working directory

`child_process.spawn` accepts a `cwd` option. Set `cwd: projectRoot` (the repo root). With the full (non-bare) invocation, Claude Code auto-discovers:
- `CLAUDE.md` (project instructions)
- `.claude/agents/` (developer/reviewer/researcher definitions)
- `.claude/skills/` (skills)
- `state/` (session state, task store)
- Any MCP servers configured in `.mcp.json`

No special `--add-dir` flag is needed for the project root itself — it is the working directory. `--add-dir` is for granting access to directories **outside** the cwd.

**Permission mode for unattended bridge:** use `--permission-mode bypassPermissions` (equivalent to `--dangerously-skip-permissions`) for a fully autonomous bridge, or `--allowedTools "Read,Edit,Write,Bash,Agent"` to auto-approve specific tools while leaving others requiring a permission prompt (which the bridge must relay to the browser UI). For the initial implementation `bypassPermissions` is simplest.

### One-orchestrator-at-a-time hazard

If the user has a terminal Claude Code session running AND the web console has a live bridge session, both processes can concurrently read/write `state/sessions/<id>/session.json`. This can cause:
- Lost writes (last writer wins)
- Corrupt JSON (partial write race — partially mitigated by the atomic-rename pattern already used in this project)
- Diverged session state (two sessions each believe they are the active orchestrator)

**Recommended mitigation:** write a **lock file** at `state/.bridge.lock` containing the bridge session's PID when the web console spawns a session. Before spawning, check for the lock file:
- If absent: write lock, spawn
- If present and PID is alive: refuse to spawn, surface a UI error ("An orchestrator session is already running — close the other terminal session first")
- If present and PID is dead (stale lock): remove and proceed

This is a soft lock (advisory), not a hard OS-level exclusive lock, but it is sufficient for local single-user use. The lock is cleared on normal bridge shutdown or bridge process exit.

**Sources:** [CLI reference — --add-dir, --permission-mode, --dangerously-skip-permissions](https://code.claude.com/docs/en/cli-reference), [knowledge/entries/windows-atomic-rename-not-truly-atomic.md](../knowledge/entries/windows-atomic-rename-not-truly-atomic.md)

---

## 6. Browser Transport

**Question:** SSE or WebSocket for relaying events from the zero-dep Node http server to the browser?

### SSE (Server-Sent Events) — RECOMMENDED

- **Zero-dep on the server:** implemented with `res.writeHead(200, {'Content-Type': 'text/event-stream', ...})` and `res.write('data: ...\n\n')` using Node's built-in `http` module — no additional package needed
- **One-way push:** the server pushes events downstream; the browser sends user messages via a separate `POST /turn` endpoint (plain JSON body). This matches the natural flow of the CLI bridge: stdout events → SSE → browser; user input → POST → stdin
- **Auto-reconnect:** the browser's native `EventSource` API handles reconnection with `Last-Event-ID` header, enabling seamless recovery if the SSE connection drops
- **Proxy/firewall friendly:** SSE is HTTP/1.1 over a single connection; no upgrade handshake; works through most local reverse proxies and OS firewalls without configuration

### WebSocket — Not recommended for this scope

WebSocket requires an HTTP upgrade handshake and a stateful duplex socket. While Node's `http` module can detect the `Upgrade` header, a production-quality WebSocket server needs frame parsing, masking, and ping/pong — typically provided by a library (`ws`). Implementing WebSocket from scratch in a zero-dep server is non-trivial and error-prone.

The bidirectional capability of WebSocket is not needed here: the bridge is effectively one-way (server → browser) with occasional user turns (browser → server via POST). SSE is a better fit for this asymmetric pattern.

**Transport design:**
- `GET /console/events` → SSE stream; bridge writes one `data:` line per normalized UI event
- `POST /console/turn` → JSON body `{"text": "user message"}` → bridge writes to `claude` stdin; returns `202 Accepted`
- `POST /console/stop` → sends stdin EOF to the child process; returns `200`

**Sources:** [MDN — Server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events), [MDN — EventSource](https://developer.mozilla.org/en-US/docs/Web/API/EventSource), [Node.js http module docs](https://nodejs.org/api/http.html)

---

## Recommended Bridge Architecture

### Process model

One `claude` child process per browser tab, kept alive for the tab's lifetime. Spawn at first SSE connection; kill on tab disconnect.

**Spawn recipe (exact argv + env):**

```js
import { spawn } from 'node:child_process';

function spawnOrchestrator(projectRoot, sessionId = null) {
  const argv = [
    '-p',                            // print/non-interactive mode
    '--output-format', 'stream-json', // NDJSON events on stdout
    '--input-format', 'stream-json',  // NDJSON user turns on stdin
    '--verbose',                      // emit system/init with session_id
    '--include-partial-messages',     // token-level deltas for live text
    '--permission-mode', 'bypassPermissions', // unattended
    '--allowedTools', 'Read,Edit,Write,Bash,Agent', // auto-approve core tools
  ];
  if (sessionId) argv.push('--resume', sessionId);

  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;   // guarantee subscription-auth path
  delete env.ANTHROPIC_AUTH_TOKEN;

  return spawn('claude', argv, {
    cwd: projectRoot,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}
```

**Session-id capture:** read `stdout` line-by-line; on first `type: "system", subtype: "init"` event, extract and store `session_id`. Persist it in memory for the tab's lifetime (used in `--resume` on respawn).

### Stdin message framing

Each user turn: write one line to `child.stdin`:

```js
child.stdin.write(
  JSON.stringify({ type: 'user', message: { role: 'user', content: userText } }) + '\n'
);
```

Graceful shutdown: `child.stdin.end()`.

### Stdout event → normalized UI event mapping

| Raw `type` | Raw `event.type` (if `stream_event`) | Normalized UI event |
|---|---|---|
| `system` / `init` | — | `{kind:"session-start", sessionId, model}` |
| `stream_event` | `content_block_delta` + `delta.type == "text_delta"` | `{kind:"text", delta: delta.text}` |
| `stream_event` | `content_block_start` + `content_block.type == "tool_use"` | `{kind:"tool-start", name: content_block.name, id: content_block.id}` |
| `stream_event` | `content_block_start` + `content_block.name in ["Agent","Task"]` | `{kind:"subagent-start", agentType: input.subagent_type}` |
| `stream_event` | `content_block_stop` (after tool_use) | `{kind:"tool-end", id}` |
| `stream_event` | `message_stop` | `{kind:"turn-end"}` |
| `result` | — | `{kind:"turn-complete", cost: total_cost_usd, durationMs}` |
| `system` / `api_retry` | — | `{kind:"warning", message: "Retrying (attempt N)..."}` |
| error on stderr / exit code ≠ 0 | — | `{kind:"error", message}` |

Parent_tool_use_id: non-null on stream_events from inside a subagent — prepend an indent/nesting marker in the UI.

### Transport

SSE for server→browser; `POST /console/turn` for browser→server. Zero additional npm packages.

```
Browser                        Node Bridge                    claude process
  |  GET /console/events ------> open SSE stream                  |
  |                               spawn claude -----------------> |
  |  <--------- data: session-start (from system/init) ---------  |
  |  <--------- data: text (stream_event text_delta) -----------  |
  |  <--------- data: tool-start (content_block_start) ---------  |
  |  <--------- data: subagent-start (Agent tool) --------------  |
  |  <--------- data: turn-complete (result event) -------------  |
  |  POST /console/turn {"text":"..."} -> write to child.stdin    |
  |  <--------- data: text ... data: turn-complete -------------  |
  |  disconnect tab / POST /console/stop -> child.stdin.end()     |
```

### Session continuity model

- `session_id` captured from `system/init`, stored in server-side tab state
- Restart/failure: if `child.exitCode !== null` unexpectedly, respawn with `--resume <stored_session_id>` to restore full transcript from `~/.claude/`
- Tab close: `child.stdin.end()` → process finishes current turn and exits cleanly
- Lock file: `state/.bridge.lock` (PID) prevents concurrent orchestrator sessions

---

## Go / No-Go

**GO.**

All six research questions resolve favorably:

1. The CLI fully supports a long-lived streaming session with `--input-format stream-json --output-format stream-json --verbose --include-partial-messages`; the stdout event schema is well-documented.
2. Subscription OAuth auth is the default; the spawned process inherits the existing `claude` login with no API key required, provided `ANTHROPIC_API_KEY` is absent from the child's environment. The June 15, 2026 billing split does NOT require a new API key — it draws from a subscription credit pool.
3. A single long-lived process per tab is the recommended continuity model; `--resume` is the crash-recovery path.
4. The Agent SDK in-process alternative adds a package dependency and breaks subscription auth in bare mode; CLI-spawn is strictly better for the no-extra-cost + zero-dep constraints.
5. `cwd: projectRoot` gives the process full access to CLAUDE.md, `.claude/`, `state/`; a PID lock file mitigates the concurrent-session hazard.
6. SSE + POST is the correct transport for a zero-dep Node server.

**Blocker to verify before TASK-051 ships:** the exact stdin NDJSON envelope for `--input-format stream-json` is **not officially documented** (GitHub issue #24594 is open). The community-reverse-engineered format `{"type":"user","message":{"role":"user","content":"<text>"}}` is consistently reported and matches the SDK wire format, but TASK-051 should write a 10-line integration test (`spawn claude -p --input-format stream-json --output-format stream-json --verbose`, write one line, assert `result` event received) before building the full bridge. This is a low-risk verify step, not a blocker to starting TASK-051.

---

*Skill artifact created: `.claude/skills/claude-headless/SKILL.md`*
*Primary sources: [code.claude.com/docs/en/headless](https://code.claude.com/docs/en/headless), [code.claude.com/docs/en/cli-reference](https://code.claude.com/docs/en/cli-reference), [code.claude.com/docs/en/authentication](https://code.claude.com/docs/en/authentication), [code.claude.com/docs/en/agent-sdk/streaming-output](https://code.claude.com/docs/en/agent-sdk/streaming-output), [code.claude.com/docs/en/agent-sdk/subagents](https://code.claude.com/docs/en/agent-sdk/subagents)*
