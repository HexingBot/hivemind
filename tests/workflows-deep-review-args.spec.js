// tests/workflows-deep-review-args.spec.js
// TASK-190 — deep-review.js arg-shape guard: docs document a CLI-style string
// invocation ("base=<ref> ticket=<key>"), but the pre-fix workflow read args
// as an OBJECT (args.base / args.ticket) — silently discarding every real
// invocation. Two human-requested deep reviews were launched with explicit
// base=/ticket= and both silently reviewed origin/main...HEAD with no ticket
// anchor, reporting success.
//
// Canonical-shape decision (AC2): STRING is canonical. It matches
// deep-research.js's existing string-arg convention (already correct — see
// AC5 note below) and the documented invocation at
// skills/orchestrator-routing/SKILL.md ("/deep-review base=<git-ref>
// ticket=<TASK-key>"). The live incident itself is the proof: the runtime
// handed this script a raw string on both failed runs, so `args.base` /
// `args.ticket` property access silently read `undefined` off a string with
// no warning. An object shape was never actually reachable in production.
// The fix parses the documented string; the docs do not change.
//
// AC3 decision: an args value that cannot be parsed at all — wrong TYPE
// (object/array/number/boolean), or a non-empty string with zero
// recognizable base=/ticket= tokens — REFUSES to run: it logs a prominent
// [error] and returns an error-shaped result before dispatching any agent.
// This mirrors deep-research.js's existing `typeof args !== 'string'`
// refuse-and-return-early precedent (AC5: deep-research already does this
// correctly and needs no fix). A string with SOME recognizable tokens plus
// unrecognized noise (unknown keys, malformed tokens) WARNS naming exactly
// what was ignored and proceeds using the recognized fields. Per-field
// invalid VALUES (bad git ref, bad ticket key) keep the pre-existing
// [warn]-and-fall-back-to-default behavior unchanged (AC4 non-regression).
// null/undefined/empty-string args is the documented "both fields optional"
// case — defaults silently, no warning.
//
// Harness note: deep-review.js is a Workflow script, not an ES module with
// exported functions — the runtime injects args/phase/log/pipeline/agent/
// parallel/budget/workflow as free variables over the script body (see
// workflows-materializer.spec.js's whole-body AsyncFunction-construction
// precedent, which proves the body parses). These specs reuse that same
// reconstruction technique but INVOKE the function with mocked
// agent/pipeline/parallel so the real arg-parsing logic executes end-to-end,
// rather than re-implementing it in the test.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './helpers/repoRoot.js';

const DEEP_REVIEW_PATH = join(REPO_ROOT, 'workflows', 'deep-review.js');

/** Extract the workflow body (everything after the `export const meta = {...};` block). */
function extractBody(src) {
  const metaStart = src.indexOf('export const meta =');
  if (metaStart < 0) throw new Error('export const meta = not found');
  const metaEndToken = '\n};';
  const metaEndIdx = src.indexOf(metaEndToken, metaStart);
  if (metaEndIdx < 0) throw new Error('meta block closing }; not found');
  return src.slice(metaEndIdx + metaEndToken.length);
}

/**
 * Build a callable AsyncFunction from deep-review.js's current body, matching
 * the exact param list the production runtime is known to inject (per
 * workflows-materializer.spec.js).
 */
function buildDeepReview() {
  const src = readFileSync(DEEP_REVIEW_PATH, 'utf8');
  const body = extractBody(src);
  // eslint-disable-next-line no-new-func
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  return new AsyncFunction(
    'args', 'phase', 'log', 'pipeline', 'agent', 'parallel', 'budget', 'workflow',
    body,
  );
}

/** No-findings agent mock — dimensions report nothing, so the verify stage never fires. */
function makeMocks() {
  const logs = [];
  const agentCalls = [];
  const log = (msg) => { logs.push(String(msg)); };
  const agent = async (prompt, opts) => {
    agentCalls.push({ prompt, opts });
    return { findings: [] };
  };
  const pipeline = async (items, stage1, stage2) => Promise.all(
    items.map(async (item) => stage2(await stage1(item))),
  );
  const parallel = async (fns) => Promise.all(fns.map((fn) => fn()));
  const phase = () => {};
  const budget = {};
  const workflow = {};
  return { logs, agentCalls, log, agent, pipeline, parallel, phase, budget, workflow };
}

function throwIfCalled(name) {
  return async (...callArgs) => {
    throw new Error(`${name} must not be called: ${JSON.stringify(callArgs)}`);
  };
}

// ---------------------------------------------------------------------------
// AC1 — red-run evidence: the documented string form must anchor base/ticket.
// ---------------------------------------------------------------------------

describe('AC1 — documented string form must be honoured (tests-first red-run evidence)', () => {
  it('invoking with the documented "base=<ref> ticket=<KEY>" string anchors baseRef and ticketKey with no warning', async () => {
    const fn = buildDeepReview();
    const mocks = makeMocks();

    await fn('base=bc585e3 ticket=TASK-181', mocks.phase, mocks.log, mocks.pipeline, mocks.agent, mocks.parallel, mocks.budget, mocks.workflow);

    const startLine = mocks.logs.find((l) => l.startsWith('Deep review starting'));
    expect(startLine, 'a "Deep review starting" log line must be emitted').toBeDefined();

    // Pre-fix (buggy) behavior: args.base and args.ticket are undefined when args
    // is the documented string, so this line reads "base: origin/main" with no
    // ", ticket: ..." suffix. This assertion is the tests-first RED evidence —
    // it must FAIL against the unfixed script and PASS once args is parsed.
    expect(startLine).toBe('Deep review starting — base: bc585e3, ticket: TASK-181');

    const warnLines = mocks.logs.filter((l) => l.includes('[warn]') || l.includes('[error]'));
    expect(warnLines, 'a correctly-formed documented invocation must emit no warning').toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC4 — shape guard covered for each distinct bad input (adapted to the
// string-canonical decision recorded above).
// ---------------------------------------------------------------------------

describe('AC4 — shape guard: distinct bad-input categories', () => {
  it('args as an object (the previously-assumed shape) refuses to run and dispatches no agent', async () => {
    const fn = buildDeepReview();
    const mocks = makeMocks();
    // Use throwIfCalled for agent/pipeline/parallel — refusal must happen BEFORE
    // any of them are invoked.
    const result = await fn(
      { base: 'bc585e3', ticket: 'TASK-181' },
      mocks.phase, mocks.log,
      throwIfCalled('pipeline'), throwIfCalled('agent'), throwIfCalled('parallel'),
      mocks.budget, mocks.workflow,
    );

    expect(result.summary.refused, 'an object-shaped args must set summary.refused').toBe(true);
    expect(result.confirmed).toEqual([]);
    const errLines = mocks.logs.filter((l) => l.includes('[error]'));
    expect(errLines.length, 'refusal must be logged prominently').toBeGreaterThan(0);
  });

  it('args as an object with entirely unknown keys also refuses (wrong type, never reaches key inspection)', async () => {
    const fn = buildDeepReview();
    const mocks = makeMocks();
    const result = await fn(
      { foo: 'bar' },
      mocks.phase, mocks.log,
      throwIfCalled('pipeline'), throwIfCalled('agent'), throwIfCalled('parallel'),
      mocks.budget, mocks.workflow,
    );
    expect(result.summary.refused).toBe(true);
  });

  it('args as null defaults silently — no warning, no refusal (both fields are documented-optional)', async () => {
    const fn = buildDeepReview();
    const mocks = makeMocks();
    await fn(null, mocks.phase, mocks.log, mocks.pipeline, mocks.agent, mocks.parallel, mocks.budget, mocks.workflow);

    const startLine = mocks.logs.find((l) => l.startsWith('Deep review starting'));
    expect(startLine).toBe('Deep review starting — base: origin/main');
    const warnLines = mocks.logs.filter((l) => l.includes('[warn]') || l.includes('[error]'));
    expect(warnLines).toEqual([]);
  });

  it('args as undefined defaults silently — no warning, no refusal', async () => {
    const fn = buildDeepReview();
    const mocks = makeMocks();
    await fn(undefined, mocks.phase, mocks.log, mocks.pipeline, mocks.agent, mocks.parallel, mocks.budget, mocks.workflow);

    const startLine = mocks.logs.find((l) => l.startsWith('Deep review starting'));
    expect(startLine).toBe('Deep review starting — base: origin/main');
    const warnLines = mocks.logs.filter((l) => l.includes('[warn]') || l.includes('[error]'));
    expect(warnLines).toEqual([]);
  });

  it('a non-empty string with zero recognizable base=/ticket= tokens refuses to run', async () => {
    const fn = buildDeepReview();
    const mocks = makeMocks();
    const result = await fn(
      'this is not key=value shaped at all',
      mocks.phase, mocks.log,
      throwIfCalled('pipeline'), throwIfCalled('agent'), throwIfCalled('parallel'),
      mocks.budget, mocks.workflow,
    );
    // "not" and "shaped" DO contain no '=' but "at" etc. never match key=value;
    // none of the whitespace-split tokens contain '=' in this string, so nothing
    // parses — this must refuse.
    expect(result.summary.refused).toBe(true);
  });

  it('a string with a recognized field plus unrecognized noise warns naming what was ignored, and still applies the recognized field', async () => {
    const fn = buildDeepReview();
    const mocks = makeMocks();
    await fn(
      'base=bc585e3 foo=bar',
      mocks.phase, mocks.log, mocks.pipeline, mocks.agent, mocks.parallel,
      mocks.budget, mocks.workflow,
    );
    const startLine = mocks.logs.find((l) => l.startsWith('Deep review starting'));
    expect(startLine).toBe('Deep review starting — base: bc585e3');
    const warnLines = mocks.logs.filter((l) => l.includes('[warn]'));
    expect(warnLines.some((l) => l.includes('foo=bar')), `expected a warning naming the ignored token; got: ${JSON.stringify(warnLines)}`).toBe(true);
  });

  it('args with a present-but-invalid base keeps the existing [warn]-and-fallback behavior (non-regression)', async () => {
    const fn = buildDeepReview();
    const mocks = makeMocks();
    await fn(
      'base=--evil-flag',
      mocks.phase, mocks.log, mocks.pipeline, mocks.agent, mocks.parallel,
      mocks.budget, mocks.workflow,
    );
    const startLine = mocks.logs.find((l) => l.startsWith('Deep review starting'));
    expect(startLine).toBe('Deep review starting — base: origin/main');
    const warnLines = mocks.logs.filter((l) => l.includes('[warn]'));
    expect(warnLines.some((l) => l.includes('args.base') && l.includes('git-ref allowlist'))).toBe(true);
  });

  it('args with a present-but-invalid ticket keeps the existing [warn]-and-drop behavior (non-regression)', async () => {
    const fn = buildDeepReview();
    const mocks = makeMocks();
    await fn(
      'ticket=not-a-real-key',
      mocks.phase, mocks.log, mocks.pipeline, mocks.agent, mocks.parallel,
      mocks.budget, mocks.workflow,
    );
    const startLine = mocks.logs.find((l) => l.startsWith('Deep review starting'));
    expect(startLine).toBe('Deep review starting — base: origin/main');
    const warnLines = mocks.logs.filter((l) => l.includes('[warn]'));
    expect(warnLines.some((l) => l.includes('args.ticket') && l.includes('TASK-NNN'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC6 — end-to-end: a ticket-anchored run actually anchors the AC-compliance
// dimension's prompt on the ticket, instead of falling back to the no-ticket
// generic-smells prompt.
// ---------------------------------------------------------------------------

describe('AC6 — ticket-anchored run reaches the AC-compliance dimension', () => {
  it('a valid ticket arg makes the ac-compliance prompt read the ticket ACs, not the no-ticket fallback', async () => {
    const fn = buildDeepReview();
    const mocks = makeMocks();
    await fn(
      'base=bc585e3 ticket=TASK-181',
      mocks.phase, mocks.log, mocks.pipeline, mocks.agent, mocks.parallel,
      mocks.budget, mocks.workflow,
    );

    const acCall = mocks.agentCalls.find((c) => c.opts && c.opts.label === 'review:ac-compliance');
    expect(acCall, 'an ac-compliance dimension agent call must have been dispatched').toBeDefined();
    expect(acCall.prompt).toContain('tasks/TASK-181.json');
    expect(acCall.prompt).not.toContain('No ticket key was supplied');
  });

  it('an unanchored run (no ticket) falls back to the no-ticket generic-smells prompt', async () => {
    const fn = buildDeepReview();
    const mocks = makeMocks();
    await fn(
      'base=bc585e3',
      mocks.phase, mocks.log, mocks.pipeline, mocks.agent, mocks.parallel,
      mocks.budget, mocks.workflow,
    );

    const acCall = mocks.agentCalls.find((c) => c.opts && c.opts.label === 'review:ac-compliance');
    expect(acCall).toBeDefined();
    expect(acCall.prompt).toContain('No ticket key was supplied');
  });
});
