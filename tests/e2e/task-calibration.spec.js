// tests/e2e/task-calibration.spec.js
// Phase 2 (P2.2) — optional Spine calibration on tasks: marker + source_tier +
// confidence (decomposed components). Additive + backward-compatible: tasks
// without the fields stay valid; invalid enum values are rejected; createTask and
// the MCP create_task tool persist them. Mirrors tests/e2e/verification-tier.spec.js.

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { PROD, makeRepoSkeleton } from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';

afterAll(cleanupAll);

const __repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCHEMA_PATH = join(__repoRoot, 'tasks', 'schema.json');

function makeValidate() {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')));
}
function readTaskFile(repoDir, key) {
  return JSON.parse(readFileSync(join(repoDir, 'tasks', `${key}.json`), 'utf8'));
}
function baseTask(overrides = {}) {
  return {
    key: 'TASK-001', title: 'A test task', description: 'For calibration tests.',
    acceptance_criteria: ['works'], status: 'todo', priority: 'medium', labels: [],
    assignee: null, depends_on: [], linked_commits: [], linked_prs: [], comments: [],
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', jira_key: null,
    ...overrides,
  };
}
const parse = (r) => JSON.parse(r.content[0].text);

describe('P2.2 — schema: calibration fields', () => {
  it('accepts a fully calibrated task', () => {
    const validate = makeValidate();
    const ok = validate(baseTask({
      marker: '[INFERRED:strong]', source_tier: 'T2',
      confidence: { source_credibility: 0.8, assertion_strength: 1, corroboration: 0, verification_status: 0 },
    }));
    expect(ok, JSON.stringify(validate.errors)).toBe(true);
  });

  it('still accepts a task with no calibration (backward-compatible)', () => {
    expect(makeValidate()(baseTask())).toBe(true);
  });

  it('rejects an invalid marker', () => {
    expect(makeValidate()(baseTask({ marker: '[MAYBE]' }))).toBe(false);
  });

  it('rejects an invalid source_tier', () => {
    expect(makeValidate()(baseTask({ source_tier: 'T9' }))).toBe(false);
  });

  it('rejects a confidence component outside [0,1] and unknown keys', () => {
    expect(makeValidate()(baseTask({ confidence: { source_credibility: 1.5 } }))).toBe(false);
    expect(makeValidate()(baseTask({ confidence: { bogus: 0.5 } }))).toBe(false);
  });
});

describe('P2.2 — createTask threads calibration', () => {
  it('persists marker/source_tier/confidence when provided', async () => {
    const { createTask } = await import(PROD.taskStore);
    const repoDir = makeTmpDir('af-cal-create');
    makeRepoSkeleton(repoDir, {});
    const { key } = await createTask({
      repoRoot: repoDir, title: 'Calibrated', description: 'has calibration',
      acceptance_criteria: ['[EXPLICIT] returns 200 on success'], priority: 'high',
      marker: '[EXPLICIT]', source_tier: 'T1',
      confidence: { source_credibility: 1, assertion_strength: 1 },
      now: () => '2026-09-10T12:00:00Z',
    });
    const w = readTaskFile(repoDir, key);
    expect(w.marker).toBe('[EXPLICIT]');
    expect(w.source_tier).toBe('T1');
    expect(w.confidence).toEqual({ source_credibility: 1, assertion_strength: 1 });
  });

  it('omits the fields entirely when not provided', async () => {
    const { createTask } = await import(PROD.taskStore);
    const repoDir = makeTmpDir('af-cal-create-none');
    makeRepoSkeleton(repoDir, {});
    const { key } = await createTask({
      repoRoot: repoDir, title: 'Plain', description: 'no calibration',
      acceptance_criteria: ['works'], priority: 'low', now: () => '2026-09-10T12:00:00Z',
    });
    const w = readTaskFile(repoDir, key);
    expect(Object.prototype.hasOwnProperty.call(w, 'marker')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(w, 'source_tier')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(w, 'confidence')).toBe(false);
  });

  it('rejects an invalid marker without writing anything', async () => {
    const { createTask } = await import(PROD.taskStore);
    const repoDir = makeTmpDir('af-cal-bad');
    makeRepoSkeleton(repoDir, {});
    await expect(createTask({
      repoRoot: repoDir, title: 'Bad', description: 'bad marker',
      acceptance_criteria: ['x'], priority: 'low', marker: '[NOPE]',
      now: () => '2026-09-10T12:00:00Z',
    })).rejects.toThrow();
  });
});

describe('P2.2 — MCP create_task round-trips calibration', () => {
  let repoRoot, client;
  beforeEach(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), 'mcp-cal-'));
    makeRepoSkeleton(repoRoot);
    const { createServer } = await import('../../src/mcp-server.js');
    const server = createServer({ repoRoot });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'cal-test', version: '0.0.0' });
    await Promise.all([server.connect(st), client.connect(ct)]);
  });
  afterEach(async () => {
    if (client) await client.close();
    if (repoRoot) rmSync(repoRoot, { recursive: true, force: true });
  });

  it('persists marker + source_tier + confidence via MCP', async () => {
    const created = parse(await client.callTool({
      name: 'create_task',
      arguments: {
        title: 'MCP calibrated', description: 'via MCP',
        acceptance_criteria: ['[INFERRED:weak] caches for ~60s'], priority: 'medium',
        marker: '[INFERRED:weak]', source_tier: 'T3',
        confidence: { source_credibility: 0.5, assertion_strength: 0.7 },
      },
    }));
    const w = JSON.parse(readFileSync(join(repoRoot, 'tasks', `${created.key}.json`), 'utf8'));
    expect(w.marker).toBe('[INFERRED:weak]');
    expect(w.source_tier).toBe('T3');
    expect(w.confidence.source_credibility).toBe(0.5);
  });
});
