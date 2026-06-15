// tests/e2e/skill-routes.spec.js
// TASK-053 — e2e regression locks for the skill routes added to createBoardServer.
//
// Routes under test:
//   GET  /api/skills                          → 200 JSON array { id, label, description } (NO invocation)
//   POST /api/chat/:sessionId/skill { skillId } → 200 { ok: true } for known id;
//                                                  400/404 for unknown id
//
// Key safety assertion: unknown skillId → rejected, session.send NOT called.
// Known skillId → 200, session.send called with the resolved invocation.
//
// Uses the same fake bridge pattern as tests/e2e/chat-routes.spec.js.
// No real `claude` is spawned.

import {
  describe, it, expect, beforeEach, afterEach,
} from 'vitest';
import {
  mkdtempSync, rmSync, mkdirSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createBoardServer } from '../../src/task-board.js';
import { makeRepoSkeleton } from '../helpers/fixtures.js';

// ===========================================================================
// Fake bridge — same as chat-routes.spec.js, extended to track send() calls.
// ===========================================================================
function makeFakeBridge() {
  const sessions = new Map();
  return {
    sessions,
    create(sessionId) {
      if (sessions.has(sessionId)) throw new Error(`duplicate session: ${sessionId}`);
      const sendCalls = [];
      const session = {
        id: sessionId,
        stopped: false,
        send(text) { sendCalls.push(text); },
        subscribe() {},
        _sendCalls: sendCalls,
      };
      sessions.set(sessionId, session);
      return session;
    },
    get(sessionId) { return sessions.get(sessionId); },
    has(sessionId) { return sessions.has(sessionId); },
    stop(sessionId) { sessions.delete(sessionId); },
  };
}

// ===========================================================================
// Helper: start server, return { server, baseUrl, port }.
// ===========================================================================
function startServer(repoRoot, bridge) {
  return new Promise((resolve, reject) => {
    const server = createBoardServer({ repoRoot, bridge });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}`, port });
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

// ===========================================================================
// Suite: GET /api/skills
// ===========================================================================
describe('TASK-053 — GET /api/skills', () => {
  let repoRoot;
  let server;
  let baseUrl;
  let bridge;

  beforeEach(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), 'skill-routes-spec-'));
    makeRepoSkeleton(repoRoot, {});
    // Add a commands/ dir with one fixture command so the catalog is non-empty.
    const commandsDir = join(repoRoot, 'commands');
    mkdirSync(commandsDir, { recursive: true });
    writeFileSync(
      join(commandsDir, 'test-cmd.md'),
      '---\ndescription: A test catalog command\n---\n\n# /agentic-framework:test-cmd\n',
      'utf8',
    );
    bridge = makeFakeBridge();
    ({ server, baseUrl } = await startServer(repoRoot, bridge));
  });

  afterEach(async () => {
    if (server) await closeServer(server);
    if (repoRoot) rmSync(repoRoot, { recursive: true, force: true });
  });

  it('GET /api/skills returns 200', async () => {
    const res = await fetch(`${baseUrl}/api/skills`);
    expect(res.status, 'GET /api/skills must return 200').toBe(200);
  });

  it('GET /api/skills returns a JSON array', async () => {
    const res = await fetch(`${baseUrl}/api/skills`);
    const body = await res.json();
    expect(Array.isArray(body), '/api/skills must return a JSON array').toBe(true);
  });

  it('GET /api/skills entries have id, label, description', async () => {
    const res = await fetch(`${baseUrl}/api/skills`);
    const skills = await res.json();
    expect(skills.length, 'must have at least one skill (fixture + curated)').toBeGreaterThan(0);
    for (const s of skills) {
      expect(typeof s.id, 'each entry must have a string id').toBe('string');
      expect(typeof s.label, 'each entry must have a string label').toBe('string');
      expect(typeof s.description, 'each entry must have a string description').toBe('string');
    }
  });

  it('GET /api/skills entries do NOT expose invocation field', async () => {
    const res = await fetch(`${baseUrl}/api/skills`);
    const skills = await res.json();
    for (const s of skills) {
      expect(
        Object.prototype.hasOwnProperty.call(s, 'invocation'),
        `skill entry ${s.id} must not expose the invocation field to the client`,
      ).toBe(false);
    }
  });

  it('GET /api/skills includes the fixture command entry', async () => {
    const res = await fetch(`${baseUrl}/api/skills`);
    const skills = await res.json();
    const found = skills.find((s) => s.id === 'test-cmd');
    expect(found, 'test-cmd fixture entry must appear in /api/skills').toBeTruthy();
    expect(found.description).toBe('A test catalog command');
  });

  it('GET /api/skills includes the curated help entry', async () => {
    const res = await fetch(`${baseUrl}/api/skills`);
    const skills = await res.json();
    const helpEntry = skills.find((s) => s.id === 'help');
    expect(helpEntry, 'curated help entry must appear in /api/skills').toBeTruthy();
  });
});

// ===========================================================================
// Suite: POST /api/chat/:sessionId/skill — unknown id → rejected, no send
// ===========================================================================
describe('TASK-053 — POST /api/chat/:sessionId/skill unknown id', () => {
  let repoRoot;
  let server;
  let baseUrl;
  let bridge;

  beforeEach(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), 'skill-routes-unknown-'));
    makeRepoSkeleton(repoRoot, {});
    bridge = makeFakeBridge();
    ({ server, baseUrl } = await startServer(repoRoot, bridge));
  });

  afterEach(async () => {
    if (server) await closeServer(server);
    if (repoRoot) rmSync(repoRoot, { recursive: true, force: true });
  });

  it('unknown skillId → 400 or 404', async () => {
    const sessionId = 'skill-test-unknown';
    bridge.create(sessionId);

    const res = await fetch(`${baseUrl}/api/chat/${sessionId}/skill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillId: 'totally-unknown-skill-xyzzy' }),
    });
    expect(
      [400, 404],
      `unknown skillId must return 400 or 404, got ${res.status}`,
    ).toContain(res.status);
  });

  it('unknown skillId → session.send is NOT called', async () => {
    const sessionId = 'skill-test-no-send';
    const session = bridge.create(sessionId);

    await fetch(`${baseUrl}/api/chat/${sessionId}/skill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillId: 'totally-unknown-skill-xyzzy' }),
    });

    expect(
      session._sendCalls.length,
      'session.send must NOT be called for an unknown skill id',
    ).toBe(0);
  });
});

// ===========================================================================
// Suite: POST /api/chat/:sessionId/skill — known id → 200, send called
// ===========================================================================
describe('TASK-053 — POST /api/chat/:sessionId/skill known id', () => {
  let repoRoot;
  let server;
  let baseUrl;
  let bridge;

  beforeEach(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), 'skill-routes-known-'));
    makeRepoSkeleton(repoRoot, {});
    // Seed a known command so the catalog has a real entry.
    const commandsDir = join(repoRoot, 'commands');
    mkdirSync(commandsDir, { recursive: true });
    writeFileSync(
      join(commandsDir, 'my-skill.md'),
      '---\ndescription: A test skill\n---\n\n# /agentic-framework:my-skill\n',
      'utf8',
    );
    bridge = makeFakeBridge();
    ({ server, baseUrl } = await startServer(repoRoot, bridge));
  });

  afterEach(async () => {
    if (server) await closeServer(server);
    if (repoRoot) rmSync(repoRoot, { recursive: true, force: true });
  });

  it('known skillId (from commands/) → 200', async () => {
    const sessionId = 'skill-test-known';
    bridge.create(sessionId);

    const res = await fetch(`${baseUrl}/api/chat/${sessionId}/skill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillId: 'my-skill' }),
    });
    expect(res.status, 'known skillId must return 200').toBe(200);
  });

  it('known skillId (from commands/) → session.send called with the resolved invocation', async () => {
    const sessionId = 'skill-test-send';
    const session = bridge.create(sessionId);

    await fetch(`${baseUrl}/api/chat/${sessionId}/skill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillId: 'my-skill' }),
    });

    expect(
      session._sendCalls.length,
      'session.send must be called exactly once for a known skill id',
    ).toBe(1);
    expect(
      session._sendCalls[0],
      'session.send must be called with /agentic-framework:my-skill',
    ).toBe('/agentic-framework:my-skill');
  });

  it('known skillId (curated help) → 200 and session.send called', async () => {
    const sessionId = 'skill-test-help';
    const session = bridge.create(sessionId);

    const res = await fetch(`${baseUrl}/api/chat/${sessionId}/skill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillId: 'help' }),
    });
    expect(res.status, 'curated help skill must return 200').toBe(200);
    expect(
      session._sendCalls.length,
      'session.send must be called for the curated help skill',
    ).toBe(1);
    // Invocation is the plain-text help prompt (non-empty)
    expect(session._sendCalls[0].length).toBeGreaterThan(0);
  });

  it('missing skillId field → 400', async () => {
    const sessionId = 'skill-test-missing';
    bridge.create(sessionId);

    const res = await fetch(`${baseUrl}/api/chat/${sessionId}/skill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ other: 'field' }),
    });
    expect(res.status, 'missing skillId field must return 400').toBe(400);
  });

  it('wrong Content-Type → 415', async () => {
    const sessionId = 'skill-test-ct';
    bridge.create(sessionId);

    const res = await fetch(`${baseUrl}/api/chat/${sessionId}/skill`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'hello',
    });
    expect(res.status, 'wrong Content-Type must return 415').toBe(415);
  });

  it('auto-creates session if absent (same as chat POST)', async () => {
    // Do NOT pre-create the session — the route should auto-create it.
    const sessionId = 'skill-auto-create-session';
    // Session does not exist yet in bridge.

    const res = await fetch(`${baseUrl}/api/chat/${sessionId}/skill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillId: 'my-skill' }),
    });
    expect(res.status, 'skill route must auto-create session and return 200').toBe(200);
    // Session should now exist in bridge.
    expect(
      bridge.has(sessionId),
      'session must have been auto-created by the skill route',
    ).toBe(true);
  });
});
