// brain-client — hivemind's seam to the wisearcher MCP "brain". Every call is wrapped so a
// brain error/absence degrades GRACEFULLY to the local grep KB (src/knowledge.js): reads fall
// back to lookupKnowledge; writes (assert) queue and no-op. The degradation is logged ONCE at
// warn and surfaced as events, never silent. See .knowledge/derived/brain-contract.md.
//
// The wisearcher MCP server has NO internal fallback (Voyage/Neo4j/Qdrant are hard deps that
// raise) — so the fallback lives here, at the client boundary. The transport/client is
// injectable so the logic is unit-testable without a running brain.

import { lookupKnowledge as _lookupKnowledge, recordKbReuse as _recordKbReuse } from './knowledge.js';

function makeErr(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

const defaultLogger = {
  warn(msg) { console.error(msg); },   // stdout carries protocol; logs go to stderr
};

/**
 * @param {object} opts
 * @param {string} opts.repoRoot
 * @param {object} [opts.client]   pre-connected MCP client: { callTool({name,arguments}), close() }
 * @param {function} [opts.connect] async () => client — lazy real connection (used if no client)
 * @param {object} [opts.knowledge] { lookupKnowledge, recordKbReuse } (injectable grep KB)
 * @param {object} [opts.logger]   { warn(msg) }
 * @param {function} [opts.now]    () => ISO timestamp
 */
export function createBrainClient({
  repoRoot,
  client = null,
  connect = null,
  knowledge = { lookupKnowledge: _lookupKnowledge, recordKbReuse: _recordKbReuse },
  logger = defaultLogger,
  now = () => new Date().toISOString(),
} = {}) {
  const subs = new Set();
  let _client = client;
  let _available = null;        // null = not yet probed, true, false
  let _degradedLogged = false;
  const pending = [];           // assert() calls queued while the brain is unavailable

  function emit(ev) {
    for (const cb of subs) { try { cb(ev); } catch { /* a bad subscriber never breaks the seam */ } }
  }
  function subscribe(cb) { subs.add(cb); return () => subs.delete(cb); }

  function degrade(reason) {
    if (!_degradedLogged) {
      _degradedLogged = true;
      logger.warn(`[brain] unavailable — falling back to grep KB: ${reason}`);
    }
  }

  async function getClient() {
    if (_client) return _client;
    if (connect) { _client = await connect(); return _client; }
    throw makeErr('E_BRAIN_NO_CLIENT', 'no MCP client or connect() provided to brain-client');
  }

  // Call a brain tool; throw on transport error or tool-reported error. Parses the first
  // TextContent block as JSON (the wisearcher server returns json.dumps(result)).
  async function callRaw(name, args) {
    const c = await getClient();
    const res = await c.callTool({ name, arguments: args || {} });
    if (res && res.isError) {
      const text = res.content && res.content[0] && res.content[0].text;
      throw makeErr('E_BRAIN_TOOL', `${name}: ${text || 'tool error'}`);
    }
    const text = res && res.content && res.content[0] && res.content[0].text;
    return text == null ? null : JSON.parse(text);
  }

  async function health() {
    try { return await callRaw('kb_health', {}); }
    catch (err) { return { ok: false, error: err.message }; }
  }

  // Memoized availability probe — runs kb_health once and remembers the verdict.
  async function ensureAvailable() {
    if (_available !== null) return _available;
    const h = await health();
    _available = !!(h && h.ok);
    if (!_available) degrade((h && h.error) || 'kb_health reported not ok');
    return _available;
  }

  async function search({ topic, question, top_k = 8, min_score = 0 }) {
    emit({ type: 'brain-query', op: 'search', question, at: now() });
    if (await ensureAvailable()) {
      try {
        const hits = await callRaw('kb_search', { topic, query: question, top_k, min_score });
        emit({ type: 'brain-hit', op: 'search', count: hits.length, at: now() });
        return { source: 'brain', hits };
      } catch (err) {
        degrade(err.message);
        emit({ type: 'brain-fallback', op: 'search', reason: err.message, at: now() });
      }
    } else {
      emit({ type: 'brain-fallback', op: 'search', reason: 'unavailable', at: now() });
    }
    const res = await knowledge.lookupKnowledge({ repoRoot, question });
    return { source: 'grep', hits: res.kb_hits };
  }

  // Write a hivemind node (task/decision/skill) into the canonical graph. When the brain is
  // down the node is queued (never lost) and the caller is told it was not yet persisted.
  async function assert(node) {
    emit({ type: 'brain-query', op: 'assert', at: now() });
    if (await ensureAvailable()) {
      try {
        const out = await callRaw('kb_assert', node);
        emit({ type: 'brain-hit', op: 'assert', claim_id: out.claim_id, at: now() });
        return { source: 'brain', ...out };
      } catch (err) {
        degrade(err.message);
      }
    }
    pending.push(node);
    emit({ type: 'brain-fallback', op: 'assert', reason: 'queued', at: now() });
    return { source: 'queued', queued: true, pending: pending.length };
  }

  // Canonical-graph reads. Unlike search (which falls back to the grep KB), these return
  // { source: 'unavailable' } when the brain is down so the caller can fall back to the LOCAL
  // graph projection (src/graph-sync.js owns that fallback — the brain-client doesn't know it).
  async function neighbors({ canonical_id }) {
    emit({ type: 'brain-query', op: 'neighbors', at: now() });
    if (await ensureAvailable()) {
      try {
        const r = await callRaw('kb_neighbors', { canonical_id });
        emit({ type: 'brain-hit', op: 'neighbors', count: (r.neighbors || []).length, at: now() });
        return { source: 'brain', neighbors: r.neighbors };
      } catch (err) {
        degrade(err.message);
        emit({ type: 'brain-fallback', op: 'neighbors', reason: err.message, at: now() });
      }
    } else {
      emit({ type: 'brain-fallback', op: 'neighbors', reason: 'unavailable', at: now() });
    }
    return { source: 'unavailable', neighbors: null };
  }

  async function get({ name, type }) {
    emit({ type: 'brain-query', op: 'get', at: now() });
    if (await ensureAvailable()) {
      try {
        const entity = await callRaw('kb_get', { name, type });
        emit({ type: 'brain-hit', op: 'get', found: !!entity, at: now() });
        return { source: 'brain', entity };
      } catch (err) {
        degrade(err.message);
        emit({ type: 'brain-fallback', op: 'get', reason: err.message, at: now() });
      }
    } else {
      emit({ type: 'brain-fallback', op: 'get', reason: 'unavailable', at: now() });
    }
    return { source: 'unavailable', entity: null };
  }

  // Wisdom layer (Phase 5): generate an agent SKILL.md / a human lesson from a graph cluster.
  // Brain-only (no grep fallback for generation) — returns { source: 'unavailable' } when down so
  // the caller can skip persisting.
  async function generateSkill({ name, type }) {
    emit({ type: 'brain-query', op: 'generate-skill', at: now() });
    if (await ensureAvailable()) {
      try {
        const r = await callRaw('kb_generate_skill', { name, type });
        emit({ type: 'brain-hit', op: 'generate-skill', name: r.name, at: now() });
        return { source: 'brain', ...r };
      } catch (err) {
        degrade(err.message);
        emit({ type: 'brain-fallback', op: 'generate-skill', reason: err.message, at: now() });
      }
    } else {
      emit({ type: 'brain-fallback', op: 'generate-skill', reason: 'unavailable', at: now() });
    }
    return { source: 'unavailable', skill_md: null };
  }

  async function generateLesson({ name, mission, type }) {
    emit({ type: 'brain-query', op: 'generate-lesson', at: now() });
    if (await ensureAvailable()) {
      try {
        const r = await callRaw('kb_generate_lesson', { name, mission, type });
        emit({ type: 'brain-hit', op: 'generate-lesson', name: r.name, at: now() });
        return { source: 'brain', ...r };
      } catch (err) {
        degrade(err.message);
        emit({ type: 'brain-fallback', op: 'generate-lesson', reason: err.message, at: now() });
      }
    } else {
      emit({ type: 'brain-fallback', op: 'generate-lesson', reason: 'unavailable', at: now() });
    }
    return { source: 'unavailable', lesson_md: null };
  }

  async function close() {
    if (_client && typeof _client.close === 'function') await _client.close();
  }

  return {
    search,
    assert,
    neighbors,
    get,
    generateSkill,
    generateLesson,
    health,
    ensureAvailable,
    subscribe,
    close,
    get available() { return _available; },
    get pending() { return pending.slice(); },
  };
}

/**
 * Build a lazy `connect` that spawns the wisearcher MCP over stdio. Not unit-tested (it spawns
 * a real process); used by the launcher wiring in P1.3. Credentials are inherited from the
 * environment; ANTHROPIC_API_KEY is intentionally NOT injected (subscription CLI auth).
 */
export function createStdioConnect({ command, args = [], env, cwd } = {}) {
  return async function connect() {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
    const transport = new StdioClientTransport({ command, args, env, cwd });
    const client = new Client({ name: 'hivemind', version: '0' }, { capabilities: {} });
    await client.connect(transport);
    return client;
  };
}
