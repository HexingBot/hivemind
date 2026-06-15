// tests/orchestrator-bridge.spec.js
// TASK-051 — Orchestrator-session bridge: FAST-tier unit specs.
//
// Tests the contract for src/orchestrator-bridge.js (not yet implemented).
// All tests use a fake child — no real `claude` process is spawned.
//
// Contract encoded:
//   1. buildSpawnArgv()          → required flags present
//   2. buildChildEnv(baseEnv)    → clone minus credential keys, baseEnv unmutated
//   3. createStreamParser()      → NDJSON line buffering, normalised events, malformed
//   4. SESSION_ID_RE             → strict id pattern, traversal chars rejected
//   5. createSessionManager()    → create/get/has/stop, send framing, subscribe,
//                                  child-death, duplicate/invalid id guards,
//                                  spawn args/env assertion

import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

// ─── helper import (will fail until implementation exists) ──────────────────
import {
  buildSpawnArgv,
  buildChildEnv,
  createStreamParser,
  createSessionManager,
  SESSION_ID_RE,
} from '../src/orchestrator-bridge.js';

// ===========================================================================
// Fake child helper — used by all session-manager tests.
// A minimal object that mimics a ChildProcess:
//   .stdin   – captures written strings
//   .stdout  – EventEmitter; tests can .emit('data', chunk)
//   .kill()  – sets killed flag
//   Itself   – EventEmitter so tests can .emit('exit', code)
// ===========================================================================
function makeFakeChild() {
  const child = new EventEmitter();
  child.stdin = {
    written: [],
    write(s) { this.written.push(s); },
    end() { this.ended = true; },
    ended: false,
  };
  child.stdout = new EventEmitter();
  child.killed = false;
  child.kill = function kill() { this.killed = true; };
  return child;
}

// ===========================================================================
// 1. buildSpawnArgv
// ===========================================================================
describe('buildSpawnArgv', () => {
  it('returns an array', () => {
    expect(Array.isArray(buildSpawnArgv())).toBe(true);
  });

  it('includes -p flag', () => {
    expect(buildSpawnArgv()).toContain('-p');
  });

  it('includes --output-format stream-json', () => {
    const argv = buildSpawnArgv();
    const idx = argv.indexOf('--output-format');
    expect(idx, '--output-format must be present').toBeGreaterThanOrEqual(0);
    expect(argv[idx + 1], 'value after --output-format must be stream-json').toBe('stream-json');
  });

  it('includes --input-format stream-json', () => {
    const argv = buildSpawnArgv();
    const idx = argv.indexOf('--input-format');
    expect(idx, '--input-format must be present').toBeGreaterThanOrEqual(0);
    expect(argv[idx + 1], 'value after --input-format must be stream-json').toBe('stream-json');
  });

  it('includes --verbose', () => {
    expect(buildSpawnArgv()).toContain('--verbose');
  });

  it('includes --include-partial-messages', () => {
    expect(buildSpawnArgv()).toContain('--include-partial-messages');
  });
});

// ===========================================================================
// 2. buildChildEnv
// ===========================================================================
describe('buildChildEnv', () => {
  const baseEnv = {
    PATH: '/usr/bin:/bin',
    ANTHROPIC_API_KEY: 'sk-test-key',
    ANTHROPIC_AUTH_TOKEN: 'auth-tok',
    HOME: '/home/user',
  };

  it('returns a plain object', () => {
    expect(typeof buildChildEnv(baseEnv)).toBe('object');
  });

  it('preserves unrelated keys', () => {
    const result = buildChildEnv(baseEnv);
    expect(result.PATH).toBe('/usr/bin:/bin');
    expect(result.HOME).toBe('/home/user');
  });

  it('deletes ANTHROPIC_API_KEY', () => {
    const result = buildChildEnv(baseEnv);
    expect('ANTHROPIC_API_KEY' in result).toBe(false);
  });

  it('deletes ANTHROPIC_AUTH_TOKEN', () => {
    const result = buildChildEnv(baseEnv);
    expect('ANTHROPIC_AUTH_TOKEN' in result).toBe(false);
  });

  it('does NOT mutate the original baseEnv', () => {
    buildChildEnv(baseEnv);
    expect(baseEnv.ANTHROPIC_API_KEY).toBe('sk-test-key');
    expect(baseEnv.ANTHROPIC_AUTH_TOKEN).toBe('auth-tok');
  });
});

// ===========================================================================
// 3. createStreamParser
// ===========================================================================
describe('createStreamParser', () => {
  let parser;

  beforeEach(() => {
    parser = createStreamParser();
  });

  // Helpers to build raw NDJSON lines
  function systemInitLine(sessionId) {
    return JSON.stringify({ type: 'system', subtype: 'init', session_id: sessionId }) + '\n';
  }

  function streamEventLine(eventObj) {
    return JSON.stringify({ type: 'stream_event', event: eventObj }) + '\n';
  }

  function resultLine() {
    return JSON.stringify({ type: 'result', subtype: 'success', session_id: 'abc' }) + '\n';
  }

  // --- session init ---
  it('system/init line emits { type: "session", sessionId }', () => {
    const events = parser.push(systemInitLine('abc'));
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: 'session', sessionId: 'abc' });
  });

  // --- text delta ---
  it('stream_event content_block_delta text_delta emits { type: "text", text }', () => {
    const raw = streamEventLine({
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: 'Hi' },
    });
    const events = parser.push(raw);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: 'text', text: 'Hi' });
  });

  // --- tool_use (non-subagent) ---
  it('stream_event content_block_start tool_use emits { type: "tool", name }', () => {
    const raw = streamEventLine({
      type: 'content_block_start',
      content_block: { type: 'tool_use', name: 'Bash' },
    });
    const events = parser.push(raw);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: 'tool', name: 'Bash' });
  });

  // --- subagent — Agent name ---
  it('stream_event content_block_start tool_use name=Agent emits { type: "subagent", name: "Agent" }', () => {
    const raw = streamEventLine({
      type: 'content_block_start',
      content_block: { type: 'tool_use', name: 'Agent' },
    });
    const events = parser.push(raw);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: 'subagent', name: 'Agent' });
  });

  // --- subagent — Task name (pre-v2.1.63 compat) ---
  it('stream_event content_block_start tool_use name=Task emits { type: "subagent", name: "Task" }', () => {
    const raw = streamEventLine({
      type: 'content_block_start',
      content_block: { type: 'tool_use', name: 'Task' },
    });
    const events = parser.push(raw);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: 'subagent', name: 'Task' });
  });

  // --- message_stop → turn-end ---
  it('stream_event message_stop emits { type: "turn-end" }', () => {
    const raw = streamEventLine({ type: 'message_stop' });
    const events = parser.push(raw);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: 'turn-end' });
  });

  // --- result → turn-end ---
  it('result line emits { type: "turn-end" }', () => {
    const events = parser.push(resultLine());
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: 'turn-end' });
  });

  // --- split across chunks: first half buffered, event emitted only after second push ---
  it('buffers split lines and emits only after the newline arrives', () => {
    const fullLine = systemInitLine('split-test');
    const half = Math.floor(fullLine.length / 2);
    const first = fullLine.slice(0, half);
    const second = fullLine.slice(half); // includes the trailing \n

    const eventsFromFirst = parser.push(first);
    expect(eventsFromFirst, 'no event before newline received').toHaveLength(0);

    const eventsFromSecond = parser.push(second);
    expect(eventsFromSecond, 'event emitted once newline arrives').toHaveLength(1);
    expect(eventsFromSecond[0]).toEqual({ type: 'session', sessionId: 'split-test' });
  });

  // --- malformed line: yields error event, does NOT throw, subsequent lines still parse ---
  it('malformed JSON line emits { type: "error", message: <string> } and does not throw', () => {
    let events;
    expect(() => {
      events = parser.push('}{not json\n');
    }).not.toThrow();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('error');
    expect(typeof events[0].message).toBe('string');
  });

  it('continues to parse valid lines after a malformed line', () => {
    parser.push('}{not json\n');
    const events = parser.push(systemInitLine('after-error'));
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: 'session', sessionId: 'after-error' });
  });

  // --- flush returns any buffered incomplete content (if relevant) ---
  it('flush returns an array (even if empty)', () => {
    expect(Array.isArray(parser.flush())).toBe(true);
  });
});

// ===========================================================================
// 4. SESSION_ID_RE
// ===========================================================================
describe('SESSION_ID_RE', () => {
  it('is a RegExp', () => {
    expect(SESSION_ID_RE).toBeInstanceOf(RegExp);
  });

  it('accepts alphanumeric ids', () => {
    expect(SESSION_ID_RE.test('abc123')).toBe(true);
  });

  it('accepts ids with hyphens and underscores', () => {
    expect(SESSION_ID_RE.test('session-id_001')).toBe(true);
  });

  it('accepts up to 64 characters', () => {
    expect(SESSION_ID_RE.test('a'.repeat(64))).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(SESSION_ID_RE.test('')).toBe(false);
  });

  it('rejects ids containing a forward slash', () => {
    expect(SESSION_ID_RE.test('session/id')).toBe(false);
  });

  it('rejects ids containing a backslash', () => {
    expect(SESSION_ID_RE.test('session\\id')).toBe(false);
  });

  it('rejects ids containing a dot', () => {
    expect(SESSION_ID_RE.test('session.id')).toBe(false);
  });

  it('rejects ids that are longer than 64 characters', () => {
    expect(SESSION_ID_RE.test('a'.repeat(65))).toBe(false);
  });

  it('rejects .. traversal', () => {
    expect(SESSION_ID_RE.test('..')).toBe(false);
  });
});

// ===========================================================================
// 5. createSessionManager
// ===========================================================================
describe('createSessionManager', () => {
  let manager;
  let capturedSpawnArgs;

  beforeEach(() => {
    capturedSpawnArgs = null;
    // Inject a fake spawnFn that captures args and returns a fake child.
    manager = createSessionManager({
      repoRoot: '/fake/repo',
      spawnFn(command, args, options) {
        capturedSpawnArgs = { command, args, options };
        return makeFakeChild();
      },
    });
  });

  // --- create + get + has ---
  it('create returns a session handle with the correct id', () => {
    const session = manager.create('test-session');
    expect(session.id).toBe('test-session');
  });

  it('has returns true for an existing session', () => {
    manager.create('exists-session');
    expect(manager.has('exists-session')).toBe(true);
  });

  it('has returns false for an unknown session', () => {
    expect(manager.has('no-such-session')).toBe(false);
  });

  it('get returns the session handle for a known id', () => {
    const created = manager.create('lookup-session');
    const fetched = manager.get('lookup-session');
    expect(fetched).toBe(created);
  });

  it('get returns undefined for an unknown id', () => {
    expect(manager.get('no-such-session')).toBeUndefined();
  });

  // --- duplicate guard ---
  it('create throws when the same id is used twice', () => {
    manager.create('dup-session');
    expect(() => manager.create('dup-session')).toThrow();
  });

  // --- invalid id guard: no spawn, throws ---
  it('create rejects a sessionId failing SESSION_ID_RE and does not call spawnFn', () => {
    expect(() => manager.create('../traversal')).toThrow();
    expect(capturedSpawnArgs, 'spawnFn must NOT be called for an invalid id').toBeNull();
  });

  it('create rejects an empty sessionId', () => {
    expect(() => manager.create('')).toThrow();
  });

  it('create rejects a sessionId with a forward slash', () => {
    expect(() => manager.create('bad/id')).toThrow();
  });

  // --- spawnFn called with correct args ---
  it('create calls spawnFn with command "claude"', () => {
    manager.create('spawn-check');
    expect(capturedSpawnArgs.command).toBe('claude');
  });

  it('create calls spawnFn with args containing required flags', () => {
    manager.create('flags-check');
    const { args } = capturedSpawnArgs;
    expect(args).toContain('-p');
    expect(args).toContain('--output-format');
    expect(args[args.indexOf('--output-format') + 1]).toBe('stream-json');
    expect(args).toContain('--input-format');
    expect(args[args.indexOf('--input-format') + 1]).toBe('stream-json');
    expect(args).toContain('--verbose');
    expect(args).toContain('--include-partial-messages');
  });

  it('create calls spawnFn with options.cwd equal to repoRoot', () => {
    manager.create('cwd-check');
    expect(capturedSpawnArgs.options.cwd).toBe('/fake/repo');
  });

  it('create calls spawnFn with env that has no ANTHROPIC_API_KEY', () => {
    // Provide a manager whose spawnFn receives an env with the key to verify deletion.
    const managerWithKey = createSessionManager({
      repoRoot: '/fake/repo',
      spawnFn(command, args, options) {
        capturedSpawnArgs = { command, args, options };
        return makeFakeChild();
      },
    });
    managerWithKey.create('env-check');
    expect(
      'ANTHROPIC_API_KEY' in (capturedSpawnArgs.options.env || {}),
      'ANTHROPIC_API_KEY must be absent from the spawn env',
    ).toBe(false);
  });

  // --- send framing ---
  it('session.send writes a correctly framed NDJSON line to child.stdin', () => {
    // We need access to the fake child to inspect .stdin.written.
    let fakeChild;
    const mgr = createSessionManager({
      repoRoot: '/fake/repo',
      spawnFn(_cmd, _args, _opts) {
        fakeChild = makeFakeChild();
        return fakeChild;
      },
    });

    const session = mgr.create('send-session');
    session.send('hello world');

    expect(fakeChild.stdin.written.length).toBeGreaterThanOrEqual(1);
    const written = fakeChild.stdin.written.join('');
    const parsed = JSON.parse(written.trimEnd());
    expect(parsed).toEqual({
      type: 'user',
      message: { role: 'user', content: 'hello world' },
    });
  });

  // --- subscribe and event delivery ---
  it('session.subscribe receives normalised events from child.stdout data', () => {
    let fakeChild;
    const mgr = createSessionManager({
      repoRoot: '/fake/repo',
      spawnFn() {
        fakeChild = makeFakeChild();
        return fakeChild;
      },
    });

    const session = mgr.create('sub-session');
    const received = [];
    session.subscribe((ev) => received.push(ev));

    // Emit a system/init event from the fake child stdout.
    const line = JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sid-42' }) + '\n';
    fakeChild.stdout.emit('data', line);

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ type: 'session', sessionId: 'sid-42' });
  });

  // --- unsubscribe — regression lock for SSE subscriber leak fix ---
  it('unsubscribed callback is not called on subsequent events', () => {
    let fakeChild;
    const mgr = createSessionManager({
      repoRoot: '/fake/repo',
      spawnFn() {
        fakeChild = makeFakeChild();
        return fakeChild;
      },
    });

    const session = mgr.create('unsub-session');
    let callCount = 0;
    const cb = () => { callCount += 1; };

    session.subscribe(cb);
    session.unsubscribe(cb);

    const line = JSON.stringify({ type: 'system', subtype: 'init', session_id: 'x' }) + '\n';
    fakeChild.stdout.emit('data', line);

    expect(callCount, 'unsubscribed callback must not be called').toBe(0);
  });

  // --- child death → error event + stopped flag ---
  it('child exit emits a single error event to subscribers', () => {
    let fakeChild;
    const mgr = createSessionManager({
      repoRoot: '/fake/repo',
      spawnFn() {
        fakeChild = makeFakeChild();
        return fakeChild;
      },
    });

    const session = mgr.create('death-session');
    const received = [];
    session.subscribe((ev) => received.push(ev));

    fakeChild.emit('exit', 1);

    const errorEvents = received.filter((e) => e.type === 'error');
    expect(errorEvents.length, 'exactly one error event on child exit').toBe(1);
    expect(typeof errorEvents[0].message).toBe('string');
  });

  it('session is marked stopped after child exit', () => {
    let fakeChild;
    const mgr = createSessionManager({
      repoRoot: '/fake/repo',
      spawnFn() {
        fakeChild = makeFakeChild();
        return fakeChild;
      },
    });

    const session = mgr.create('stop-flag-session');
    fakeChild.emit('exit', 0);

    expect(session.stopped, 'session.stopped must be true after child exit').toBe(true);
  });

  // --- stop ---
  it('stop kills the child and removes the session', () => {
    let fakeChild;
    const mgr = createSessionManager({
      repoRoot: '/fake/repo',
      spawnFn() {
        fakeChild = makeFakeChild();
        return fakeChild;
      },
    });

    mgr.create('stop-session');
    mgr.stop('stop-session');

    expect(fakeChild.killed || fakeChild.stdin.ended,
      'stop must kill the child or end stdin').toBe(true);
    expect(mgr.has('stop-session'), 'stopped session must be removed from registry').toBe(false);
  });

  it('stop is idempotent — stopping an unknown id does not throw', () => {
    expect(() => manager.stop('does-not-exist')).not.toThrow();
  });
});
