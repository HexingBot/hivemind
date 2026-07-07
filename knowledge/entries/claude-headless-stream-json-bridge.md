---
id: claude-headless-stream-json-bridge
problem: >
  Need to spawn `claude` as a persistent streaming subprocess that reuses
  the user's existing Claude subscription login, accepts multiple user
  turns over stdin, and emits assistant/tool/subagent events over stdout —
  without requiring an API key or a new billing relationship. This is the
  core of the "agentic OS web console" orchestrator-session bridge.
symptoms:
  - "how to spawn claude as a long-lived headless process"
  - "ANTHROPIC_API_KEY silently overrides subscription auth in -p mode"
  - "system/init event carries the session_id for --resume"
  - "Agent SDK credit pool billing split (June 2026)"
  - "stream-json stdin envelope undocumented"
solution: >
  Spawn `claude -p --output-format stream-json --input-format stream-json
  --verbose --include-partial-messages` via Node's built-in
  child_process.spawn, with cwd = project root and ANTHROPIC_API_KEY
  DELETED from the child env (if present it overrides subscription OAuth).
  One child per browser tab; hold it open and write one NDJSON user-message
  object per turn to stdin. Capture session_id from the first
  {"type":"system","subtype":"init"} event and use `--resume <id>` to
  recover after a crash. Switch on stdout event `type`:
  "system"(init) → session ready; "stream_event" → inspect nested
  event.type (content_block_delta/text_delta = text chunk;
  content_block_start/tool_use = tool or subagent start, name "Agent"/"Task"
  = subagent; message_stop = turn-end); "result" → turn complete; a
  non-null parent_tool_use_id marks events originating inside a subagent.
  Relay normalized events to the browser over SSE; deliver user turns via a
  separate POST. NOTE (2026-06-15): headless `-p` draws from a separate
  monthly Agent SDK credit pool within the subscription (Pro $20/mo) — no
  API key, but a distinct credit bucket the user must claim once.
  The stdin envelope {"type":"user","message":{"role":"user","content":"..."}}
  is community-confirmed but not officially documented — smoke-test it
  before building the full bridge.
tags: [claude-cli, headless, stream-json, subscription-auth, sse, web-console]
projects: [hivemind]
created_at: "2026-06-15T19:00:00Z"
last_seen_at: "2026-06-15T19:00:00Z"
source_urls:
  - "https://code.claude.com/docs/en/headless"
  - "https://code.claude.com/docs/en/cli-reference"
  - "https://code.claude.com/docs/en/authentication"
  - "https://code.claude.com/docs/en/agent-sdk/streaming-output"
  - "https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan"
  - "https://github.com/anthropics/claude-code/issues/24594"
supersedes: []
superseded_by: null
source_tier: T3
---

## Why CLI-spawn (not the Agent SDK in-process)

The web console's value is that the browser chat drives the **real**
orchestrator — same skills, agents, MCP, and `orchestrator-routing` skill the
user already has. Spawning the installed `claude` CLI reuses all of that
verbatim with zero reimplementation and, critically, reuses the **existing
subscription login** (no API key, no new bill). The Agent SDK in-process would
require either an `ANTHROPIC_API_KEY` (a new per-token cost) or duplicating the
plugin's agent wiring. Under the epic's hard constraints — *no extra cost,
nothing to install* — CLI-spawn wins on both.

## The no-API-key spawn recipe

```js
const child = spawn('claude', [
  '-p',
  '--output-format', 'stream-json',
  '--input-format', 'stream-json',
  '--verbose',
  '--include-partial-messages',
  '--permission-mode', 'bypassPermissions',
  '--allowedTools', 'Read,Edit,Write,Bash,Agent',
], {
  cwd: projectRoot,
  env: (() => { const e = { ...process.env }; delete e.ANTHROPIC_API_KEY; delete e.ANTHROPIC_AUTH_TOKEN; return e; })(),
});
```

Deleting `ANTHROPIC_API_KEY` is **mandatory**: per the authentication docs the
API key takes precedence over the subscription OAuth credential, so leaving it
set would silently route usage to a pay-per-token API bill — exactly what the
cost constraint forbids.

## stdout event → normalized UI event mapping

| stdout `type` | nested signal | UI event |
|---|---|---|
| `system` / `init` | carries `session_id` | session-ready (store id for `--resume`) |
| `stream_event` | `content_block_delta` + `text_delta` | append assistant text |
| `stream_event` | `content_block_start` + `tool_use` (name ≠ Agent/Task) | tool chip |
| `stream_event` | `content_block_start` + `tool_use` (name = Agent/Task) | subagent chip ("▸ spawned …") |
| `stream_event` | `message_stop` | turn-end (trigger board/state refresh) |
| `result` | `is_error`, `total_cost_usd` | turn complete / error |
| any | `parent_tool_use_id` non-null | event originated inside a subagent |

## Billing asterisk (2026-06-15)

Headless `-p` no longer shares the interactive-chat rate limits; it consumes a
separate monthly **Agent SDK credit** pool tied to the subscription tier. No new
API key and no new billing relationship, but it is a distinct, capped bucket the
user claims once via an Anthropic email. Honest framing for users: *"no new cost,
but it counts against your plan's agent-credit allowance."*
