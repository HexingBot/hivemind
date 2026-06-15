// src/orchestrator-bridge.js
// TASK-051 — Orchestrator-session bridge.
//
// Exports:
//   buildSpawnArgv()                           → array of CLI flags for `claude`
//   buildChildEnv(baseEnv)                    → clone of baseEnv with credentials removed
//   createStreamParser()                       → stateful NDJSON line-buffering parser
//   SESSION_ID_RE                              → strict session-id pattern (no traversal chars)
//   createSessionManager({ repoRoot, spawnFn }) → session registry (create/get/has/stop)
//
// The real default spawn (when spawnFn is omitted) uses node:child_process.
// Importing this module never spawns anything — the spawn is deferred to create().

import { spawn as nodeSpawn } from 'node:child_process';

// ---------------------------------------------------------------------------
// 1. buildSpawnArgv — required CLI flags for `claude -p` stream-json mode.
// ---------------------------------------------------------------------------
export function buildSpawnArgv() {
  return [
    '-p',
    '--output-format', 'stream-json',
    '--input-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--permission-mode', 'bypassPermissions',
    '--allowedTools', 'Read,Edit,Write,Bash,Agent',
  ];
}

// ---------------------------------------------------------------------------
// 2. buildChildEnv — clone baseEnv with credential keys deleted.
//    Never mutates the original object.
// ---------------------------------------------------------------------------
export function buildChildEnv(baseEnv) {
  const env = { ...baseEnv };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return env;
}

// ---------------------------------------------------------------------------
// 3. createStreamParser — stateful NDJSON line buffer → normalized UI events.
//
// push(chunk: string) → Event[]   (emits zero or more events per chunk)
// flush()             → Event[]   (returns any remaining buffered content;
//                                  for well-formed streams this is always [])
//
// Normalized event shapes (matches spec assertions):
//   { type: 'session',  sessionId }
//   { type: 'text',     text }
//   { type: 'tool',     name }
//   { type: 'subagent', name }
//   { type: 'turn-end' }
//   { type: 'error',    message }
// ---------------------------------------------------------------------------
export function createStreamParser() {
  let buffer = '';

  function normalizeLine(raw) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return { type: 'error', message: `malformed JSON: ${e.message}` };
    }

    // system / init → session
    if (parsed.type === 'system' && parsed.subtype === 'init') {
      return { type: 'session', sessionId: parsed.session_id };
    }

    // result (turn complete) → turn-end
    if (parsed.type === 'result') {
      return { type: 'turn-end' };
    }

    // stream_event wrappers
    if (parsed.type === 'stream_event') {
      const ev = parsed.event;
      if (!ev) return null;

      // message_stop → turn-end
      if (ev.type === 'message_stop') {
        return { type: 'turn-end' };
      }

      // content_block_delta text_delta → text
      if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') {
        return { type: 'text', text: ev.delta.text };
      }

      // content_block_start tool_use → tool or subagent
      if (
        ev.type === 'content_block_start'
        && ev.content_block
        && ev.content_block.type === 'tool_use'
      ) {
        const name = ev.content_block.name;
        if (name === 'Agent' || name === 'Task') {
          return { type: 'subagent', name };
        }
        return { type: 'tool', name };
      }
    }

    // Ignore other known types (message_start, content_block_stop, etc.)
    return null;
  }

  return {
    push(chunk) {
      buffer += chunk;
      const events = [];
      let newlineIdx;

      // Process all complete lines (terminated by \n)
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);

        if (line.length === 0) continue; // skip blank lines

        const event = normalizeLine(line);
        if (event !== null) {
          events.push(event);
        }
      }

      return events;
    },

    flush() {
      // Return any buffered content that never received a newline.
      // Well-formed streams won't have trailing partial lines, so this
      // is usually empty. We don't try to parse partial content here.
      const remaining = buffer.trim();
      buffer = '';
      if (remaining.length === 0) return [];
      // Try to parse what's there; yield error event if malformed.
      const event = normalizeLine(remaining);
      return event !== null ? [event] : [];
    },
  };
}

// ---------------------------------------------------------------------------
// 4. SESSION_ID_RE — strict pattern: alphanumeric + hyphen + underscore, 1–64 chars.
//    Rejects empty strings, dots, slashes, backslashes, and traversal sequences.
// ---------------------------------------------------------------------------
export const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

// ---------------------------------------------------------------------------
// 5. createSessionManager — session registry with injectable spawn function.
//
// Options:
//   repoRoot  {string}    — cwd for the spawned `claude` process
//   spawnFn   {function}  — (command, args, options) → ChildProcess-like object
//                           defaults to node:child_process.spawn
//
// Returns:
//   { create(id), get(id), has(id), stop(id) }
//
// Session handle:
//   { id, stopped, send(text), subscribe(cb) }
// ---------------------------------------------------------------------------
export function createSessionManager({ repoRoot, spawnFn } = {}) {
  const _spawn = spawnFn || function defaultSpawn(command, args, options) {
    return nodeSpawn(command, args, options);
  };

  // Two parallel registries: sessions (handles) and children (raw processes).
  const sessions = new Map(); // id → session handle
  const children = new Map(); // id → child process

  function create(sessionId) {
    // Validate id against SESSION_ID_RE before any spawn.
    if (!SESSION_ID_RE.test(sessionId)) {
      throw new Error(`invalid session id: ${JSON.stringify(sessionId)}`);
    }

    if (sessions.has(sessionId)) {
      throw new Error(`duplicate session id: ${sessionId}`);
    }

    const child = _spawn('claude', buildSpawnArgv(), {
      cwd: repoRoot,
      env: buildChildEnv(process.env),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    children.set(sessionId, child);

    const parser = createStreamParser();
    const subscribers = new Set();

    function broadcast(event) {
      for (const cb of subscribers) {
        try { cb(event); } catch { /* subscriber errors must not crash the bridge */ }
      }
    }

    // Wire child stdout → parser → subscribers
    child.stdout.on('data', (chunk) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      const events = parser.push(text);
      for (const ev of events) {
        broadcast(ev);
      }
    });

    const session = {
      id: sessionId,
      stopped: false,

      send(text) {
        const line = JSON.stringify({
          type: 'user',
          message: { role: 'user', content: text },
        }) + '\n';
        child.stdin.write(line);
      },

      subscribe(cb) {
        subscribers.add(cb);
      },

      unsubscribe(cb) {
        subscribers.delete(cb);
      },
    };

    // Child exit → error event + stopped flag + remove from registry
    child.on('exit', (code) => {
      session.stopped = true;
      sessions.delete(sessionId);
      children.delete(sessionId);
      broadcast({
        type: 'error',
        message: `session ${sessionId} process exited with code ${code}`,
      });
    });

    sessions.set(sessionId, session);
    return session;
  }

  function get(sessionId) {
    return sessions.get(sessionId);
  }

  function has(sessionId) {
    return sessions.has(sessionId);
  }

  function stop(sessionId) {
    if (!sessions.has(sessionId)) return; // idempotent — no-op for unknown id

    const child = children.get(sessionId);
    sessions.delete(sessionId);
    children.delete(sessionId);

    if (child) {
      // Try graceful shutdown first (stdin EOF); fall back to kill.
      try {
        child.stdin.end();
      } catch {
        // stdin may already be closed; try kill instead
        try { child.kill(); } catch { /* ignore */ }
      }
    }
  }

  return { create, get, has, stop };
}
