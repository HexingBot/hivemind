import { describe, it, expect, vi } from 'vitest';
import { createBrainClient } from '../src/brain-client.js';

// Wrap a value the way the wisearcher MCP server does: one TextContent block of JSON.
const txt = (v) => ({ content: [{ type: 'text', text: JSON.stringify(v) }] });
const toolError = (msg) => ({ isError: true, content: [{ type: 'text', text: msg }] });

function fakeClient(handlers) {
  return {
    calls: [],
    closed: false,
    async callTool({ name, arguments: args }) {
      this.calls.push({ name, args });
      const h = handlers[name];
      const out = typeof h === 'function' ? h(args) : h;
      // a handler may return a full MCP result (isError/content) or a bare value to wrap
      return out && (out.content || out.isError) ? out : txt(out ?? null);
    },
    async close() { this.closed = true; },
  };
}

function makeClient(over = {}) {
  const knowledge = {
    lookupKnowledge: vi.fn(async () => ({ kb_hits: [{ id: 'e1', score: 3, used: false }] })),
    recordKbReuse: vi.fn(async () => {}),
  };
  const logger = { warn: vi.fn() };
  const client = over.client;
  const brain = createBrainClient({
    repoRoot: '/repo', client, knowledge, logger,
    now: () => '2026-06-24T00:00:00Z',
    ...over.opts,
  });
  return { brain, knowledge, logger, client };
}

describe('brain-client — healthy path', () => {
  it('search hits the brain when kb_health is ok', async () => {
    const client = fakeClient({
      kb_health: { ok: true, neo4j: true, qdrant: true, voyage: true },
      kb_search: [{ text: 'a widget', source_id: 's1', origin: 'o', title: 'T', score: 1 }],
    });
    const { brain, knowledge } = makeClient({ client });

    const res = await brain.search({ topic: 't', question: 'widget' });

    expect(res.source).toBe('brain');
    expect(res.hits).toHaveLength(1);
    expect(res.hits[0].source_id).toBe('s1');
    expect(knowledge.lookupKnowledge).not.toHaveBeenCalled();
    expect(client.calls.map((c) => c.name)).toEqual(['kb_health', 'kb_search']);
  });

  it('assert writes to the brain and returns the claim id', async () => {
    const client = fakeClient({
      kb_health: { ok: true },
      kb_assert: { claim_id: 'c1', entity_id: 'Decision:abc', source_id: 'hivemind:s' },
    });
    const { brain } = makeClient({ client });

    const out = await brain.assert({ topic: 'p', text: 'x', type: 'Decision', marker: 'EXPLICIT', source_tier: 'T1', source_ref: 's' });

    expect(out).toMatchObject({ source: 'brain', claim_id: 'c1' });
    expect(brain.pending).toHaveLength(0);
  });
});

describe('brain-client — graceful fallback', () => {
  it('falls back to the grep KB when the brain is unhealthy', async () => {
    const client = fakeClient({ kb_health: { ok: false, error: 'neo4j down' } });
    const { brain, knowledge, logger } = makeClient({ client });

    const res = await brain.search({ topic: 't', question: 'widget' });

    expect(res.source).toBe('grep');
    expect(res.hits).toEqual([{ id: 'e1', score: 3, used: false }]);
    expect(knowledge.lookupKnowledge).toHaveBeenCalledWith({ repoRoot: '/repo', question: 'widget' });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toMatch(/falling back to grep KB/);
  });

  it('falls back for a single call when a brain tool errors mid-flight', async () => {
    const client = fakeClient({
      kb_health: { ok: true },
      kb_search: () => toolError('StoreError: qdrant unreachable'),
    });
    const { brain, knowledge, logger } = makeClient({ client });

    const res = await brain.search({ topic: 't', question: 'q' });

    expect(res.source).toBe('grep');
    expect(knowledge.lookupKnowledge).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('queues asserts (never loses them) when the brain is down', async () => {
    const client = fakeClient({ kb_health: { ok: false } });
    const { brain } = makeClient({ client });

    const a = await brain.assert({ topic: 'p', text: 'one', type: 'Task', marker: 'ASSUMED', source_tier: 'T3', source_ref: 's' });
    const b = await brain.assert({ topic: 'p', text: 'two', type: 'Task', marker: 'ASSUMED', source_tier: 'T3', source_ref: 's' });

    expect(a).toMatchObject({ source: 'queued', queued: true });
    expect(b.pending).toBe(2);
    expect(brain.pending.map((n) => n.text)).toEqual(['one', 'two']);
  });

  it('logs the degradation exactly once and probes health only once', async () => {
    const client = fakeClient({ kb_health: { ok: false } });
    const { brain, logger } = makeClient({ client });

    await brain.search({ topic: 't', question: 'a' });
    await brain.search({ topic: 't', question: 'b' });
    await brain.assert({ topic: 'p', text: 'x', type: 'Task', marker: 'ASSUMED', source_tier: 'T3', source_ref: 's' });

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(client.calls.filter((c) => c.name === 'kb_health')).toHaveLength(1);
  });
});

describe('brain-client — events & lifecycle', () => {
  it('emits brain-query then brain-hit on a healthy search', async () => {
    const client = fakeClient({ kb_health: { ok: true }, kb_search: [] });
    const { brain } = makeClient({ client });
    const events = [];
    brain.subscribe((e) => events.push(e.type));

    await brain.search({ topic: 't', question: 'q' });

    expect(events).toEqual(['brain-query', 'brain-hit']);
  });

  it('emits brain-query then brain-fallback when unavailable', async () => {
    const client = fakeClient({ kb_health: { ok: false } });
    const { brain } = makeClient({ client });
    const events = [];
    brain.subscribe((e) => events.push(e.type));

    await brain.search({ topic: 't', question: 'q' });

    expect(events).toEqual(['brain-query', 'brain-fallback']);
  });

  it('health() returns ok:false instead of throwing when the transport dies', async () => {
    const client = { async callTool() { throw new Error('EPIPE'); } };
    const { brain } = makeClient({ client });

    const h = await brain.health();
    expect(h.ok).toBe(false);
    expect(h.error).toMatch(/EPIPE/);
  });

  it('close() closes the underlying client', async () => {
    const client = fakeClient({ kb_health: { ok: true } });
    const { brain } = makeClient({ client });
    await brain.close();
    expect(client.closed).toBe(true);
  });
});

describe('brain-client — canonical-graph reads', () => {
  it('neighbors returns brain results when available', async () => {
    const client = fakeClient({ kb_health: { ok: true }, kb_neighbors: { canonical_id: 'a', neighbors: ['b', 'c'] } });
    const { brain } = makeClient({ client });
    expect(await brain.neighbors({ canonical_id: 'a' })).toEqual({ source: 'brain', neighbors: ['b', 'c'] });
  });

  it('neighbors reports unavailable (not grep) when the brain is down', async () => {
    const client = fakeClient({ kb_health: { ok: false } });
    const { brain, knowledge } = makeClient({ client });
    const r = await brain.neighbors({ canonical_id: 'a' });
    expect(r).toEqual({ source: 'unavailable', neighbors: null });
    expect(knowledge.lookupKnowledge).not.toHaveBeenCalled(); // graph reads don't fall back to grep
  });

  it('get returns the entity when available and unavailable when down', async () => {
    const up = fakeClient({ kb_health: { ok: true }, kb_get: { canonical_id: 'e1', canonical_name: 'Voyage' } });
    const { brain } = makeClient({ client: up });
    expect((await brain.get({ name: 'Voyage' })).entity.canonical_id).toBe('e1');

    const down = fakeClient({ kb_health: { ok: false } });
    const { brain: brain2 } = makeClient({ client: down });
    expect(await brain2.get({ name: 'Voyage' })).toEqual({ source: 'unavailable', entity: null });
  });
});

describe('brain-client — wisdom generation', () => {
  it('generateSkill/generateLesson return the brain result when available', async () => {
    const client = fakeClient({
      kb_health: { ok: true },
      kb_generate_skill: { name: 'X', skill_md: '# X' },
      kb_generate_lesson: { name: 'X', lesson_md: '# lesson' },
    });
    const { brain } = makeClient({ client });
    expect(await brain.generateSkill({ name: 'X' })).toMatchObject({ source: 'brain', skill_md: '# X' });
    expect(await brain.generateLesson({ name: 'X', mission: 'm' })).toMatchObject({ source: 'brain', lesson_md: '# lesson' });
  });

  it('report unavailable when the brain is down (no grep fallback for generation)', async () => {
    const client = fakeClient({ kb_health: { ok: false } });
    const { brain, knowledge } = makeClient({ client });
    expect(await brain.generateSkill({ name: 'X' })).toEqual({ source: 'unavailable', skill_md: null });
    expect(await brain.generateLesson({ name: 'X', mission: 'm' })).toEqual({ source: 'unavailable', lesson_md: null });
    expect(knowledge.lookupKnowledge).not.toHaveBeenCalled();
  });
});
