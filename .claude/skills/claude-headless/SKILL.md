---
name: claude-headless
description: >
  Load this skill when building or maintaining the orchestrator-session bridge
  (the web console's Node.js bridge that spawns `claude` as a child process),
  when writing any code that invokes `claude -p` in streaming headless mode,
  or when parsing stream-json events from a `claude` subprocess (text deltas,
  tool_use/tool_result, subagent spawns, turn-complete markers, errors).
  Triggers: files named *bridge*, *console-server*, *headless*, or any code
  calling `spawn('claude', ...)` or reading `--output-format stream-json` output.
---

# claude-headless — Streaming Headless Orchestrator Session

## When to Use This Skill

Use when editing the web console bridge (any file that spawns `claude` as a
subprocess and relays its stdout as SSE or WebSocket events), when writing
Node.js integration tests for the bridge, or when debugging stream-json
parse errors. Also load when handling `--resume`/session-continuity logic.

## Core Workflows

### 1. Spawn a persistent streaming session

```js
import { spawn } from 'node:child_process';

function spawnOrchestrator(projectRoot, resumeSessionId = null) {
  const argv = [
    '-p',
    '--output-format', 'stream-json',
    '--input-format',  'stream-json',
    '--verbose',                         // required for system/init event
    '--include-partial-messages',        // token-level text deltas
    '--permission-mode', 'bypassPermissions',
    '--allowedTools', 'Read,Edit,Write,Bash,Agent',
  ];
  if (resumeSessionId) argv.push('--resume', resumeSessionId);

  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;    // must be absent to use subscription auth
  delete env.ANTHROPIC_AUTH_TOKEN; // safety: prevent bearer-token override

  return spawn('claude', argv, {
    cwd: projectRoot,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}
```

### 2. Write a user turn to stdin

```js
function sendTurn(child, text) {
  const line = JSON.stringify({
    type: 'user',
    message: { role: 'user', content: text },
  });
  child.stdin.write(line + '\n');
}
```

### 3. Parse stdout events (line-by-line NDJSON)

```js
import { createInterface } from 'node:readline';

function attachParser(child, onEvent) {
  const rl = createInterface({ input: child.stdout });
  rl.on('line', (raw) => {
    let ev;
    try { ev = JSON.parse(raw); } catch { return; }
    onEvent(ev);
  });
}
```

### 4. Normalize raw events to UI events

```js
function normalize(ev) {
  // Session started — capture session_id here
  if (ev.type === 'system' && ev.subtype === 'init')
    return { kind: 'session-start', sessionId: ev.session_id, model: ev.model };

  if (ev.type === 'stream_event') {
    const e = ev.event;
    if (e.type === 'content_block_start') {
      if (e.content_block?.type === 'tool_use') {
        const isSubagent = ['Agent', 'Task'].includes(e.content_block.name);
        return isSubagent
          ? { kind: 'subagent-start', name: e.content_block.input?.subagent_type }
          : { kind: 'tool-start', name: e.content_block.name, id: e.content_block.id };
      }
    }
    if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta')
      return { kind: 'text', delta: e.delta.text, fromSubagent: !!ev.parent_tool_use_id };
    if (e.type === 'content_block_stop')
      return { kind: 'tool-end' };
    if (e.type === 'message_stop')
      return { kind: 'turn-end' };
  }

  if (ev.type === 'result')
    return { kind: 'turn-complete', cost: ev.total_cost_usd, durationMs: ev.duration_ms, isError: ev.is_error };

  if (ev.type === 'system' && ev.subtype === 'api_retry')
    return { kind: 'warning', message: `API retry attempt ${ev.attempt}/${ev.max_retries}: ${ev.error}` };

  return null; // ignore unknown types
}
```

### 5. Graceful shutdown

```js
function shutdown(child) {
  child.stdin.end(); // process finishes current work then exits
}
```

### 6. Crash recovery with --resume

```js
let storedSessionId = null; // set from session-start event

function respawn(projectRoot) {
  return spawnOrchestrator(projectRoot, storedSessionId);
}
```

## Best Practices

- **Do** delete `ANTHROPIC_API_KEY` from the child env — if present, it overrides subscription auth and charges API rates.
- **Do** capture `session_id` from the first `system/init` event and persist it for `--resume` on crash recovery.
- **Do** use `--verbose` — it is required for the `system/init` event; without it, `session_id` is not emitted until the `result` event.
- **Do** use SSE (`text/event-stream`) for server→browser push and a separate `POST` endpoint for browser→server user turns — zero npm dependencies.
- **Do** write one user turn per line (`\n`-terminated NDJSON) to stdin, then wait for the `result` event before sending the next turn.
- **Do not** use `--bare` — it disables CLAUDE.md, `.claude/agents/`, skills, and MCP servers, and breaks subscription OAuth auth (requires `ANTHROPIC_API_KEY`).
- **Do not** set `ANTHROPIC_API_KEY` in the child env unless you intentionally want API-key billing.
- **Do not** spawn multiple orchestrator sessions against the same `state/` directory — use a PID lock file at `state/.bridge.lock`.

## Common Pitfalls

- **`system/init` never arrives:** `--verbose` was omitted. Add it.
- **`content_block_start` for subagent shows `name: "Task"` not `"Agent"`:** CLI version is pre-v2.1.63. Check both names.
- **stdin write is ignored / process exits immediately:** the process received EOF on stdin (e.g., you piped a string instead of keeping the pipe open). Keep `child.stdin` open and write turns individually.
- **`ANTHROPIC_API_KEY` in the user's shell env bills their API account:** always `delete env.ANTHROPIC_API_KEY` before spawning.
- **Subscription auth not working in `-p` mode:** verify the user has claimed their Agent SDK credit (required since June 15, 2026) and that `CLAUDE_CODE_OAUTH_TOKEN` or the keychain credential from `claude auth login` is present.
- **Token deltas not streaming:** `--include-partial-messages` was omitted. Required for `content_block_delta` events.

## Verification

After any change to the spawn recipe:

1. Run the integration smoke test: `node tests/e2e/bridge-spawn.spec.js` (to be created in TASK-051).
2. Manually: `node -e "const {spawn}=require('child_process'); const c=spawn('claude',['-p','--output-format','stream-json','--input-format','stream-json','--verbose'],{cwd:process.cwd(),stdio:['pipe','pipe','pipe']}); c.stdout.on('data',d=>process.stdout.write(d)); c.stdin.write(JSON.stringify({type:'user',message:{role:'user',content:'say hello'}})+'\n');"`
3. Confirm first stdout line is `{"type":"system","subtype":"init",...}` with a `session_id`.

## References

Heavy reference material is in `references/`:

- [`references/stream-json-event-catalog.md`](references/stream-json-event-catalog.md) — complete event type catalog with field descriptions.
- [`references/auth-precedence.md`](references/auth-precedence.md) — full credential precedence table and June 2026 billing notes.

## Provenance

- **Authored by:** Researcher subagent on behalf of ticket `TASK-050`.
- **Primary sources:**
  - https://code.claude.com/docs/en/headless
  - https://code.claude.com/docs/en/cli-reference
  - https://code.claude.com/docs/en/authentication
  - https://code.claude.com/docs/en/agent-sdk/streaming-output
  - https://code.claude.com/docs/en/agent-sdk/subagents
  - https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan
- **Last verified:** 2026-06-15.
